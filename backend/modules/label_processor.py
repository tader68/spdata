"""
Module xử lý quá trình LABELING (Xử lý data)
Tách biệt với QAProcessor, nhưng học theo flow và cách tích hợp AI.
"""

import os
import json
import uuid
import time
from datetime import datetime
from typing import Dict, List, Any, Optional
import pandas as pd
import threading

from .ai_integration import AIIntegration
from .prompt_generator import PromptGenerator


class LabelProcessor:
    """Class xử lý quy trình gán label cho data bằng AI"""

    def __init__(self):
        self.results_folder = 'results'
        os.makedirs(self.results_folder, exist_ok=True)

        self.prompt_generator = PromptGenerator()

        # Dictionary lưu trạng thái các job đang chạy
        self.active_jobs: Dict[str, Dict[str, Any]] = {}
        self.job_lock = threading.Lock()

    def _generate_label_id(self) -> str:
        """Sinh ID cho Label job"""
        return str(uuid.uuid4())

    def process_labeling(
        self,
        label_data: Dict[str, Any],
        ai_instance: AIIntegration,
        prompt: str,
        guideline_id: str,
        column_mapping: Dict[str, Any] = None,
    ) -> Dict[str, Any]:
        """Bắt đầu job labeling cho toàn bộ dataset.

        Args:
            label_data: Data cần label
            ai_instance: Instance của AI
            prompt: Prompt template (guideline summary cho labeling)
            guideline_id: ID của guideline
            column_mapping: Mapping ý nghĩa các cột
        """
        label_id = self._generate_label_id()

        if column_mapping is None:
            column_mapping = {}
        label_data['column_mapping'] = column_mapping
        has_media = 'media_files' in label_data

        job_info = {
            'label_id': label_id,
            'status': 'processing',
            'start_time': datetime.now().isoformat(),
            'total_rows': len(label_data['data']),
            'processed_rows': 0,
            'results': [],
            'guideline_id': guideline_id,
            'data_id': label_data['data_id'],
            'column_mapping': column_mapping,
            'has_media': has_media,
            'output_config': label_data.get('output_config'),
            'provider': getattr(ai_instance, 'model_name', None),
            'model_version': getattr(ai_instance, 'model_version', None),
            'prompt': prompt,
        }

        if has_media:
            job_info['media_files'] = label_data.get('media_files')

        with self.job_lock:
            self.active_jobs[label_id] = job_info

        thread = threading.Thread(
            target=self._process_label_thread,
            args=(label_id, label_data, ai_instance, prompt),
        )
        thread.start()

        return {'label_id': label_id, 'status': 'processing'}

    def start_label_from_checkpoint(
        self,
        label_id: str,
        checkpoint: Dict[str, Any],
        label_data: Dict[str, Any],
        ai_instance: AIIntegration,
        prompt: str,
    ) -> Dict[str, Any]:
        """Khởi động lại LABELING từ checkpoint đã lưu trên đĩa.

        Chỉ dùng khi server đã restart (không còn active_jobs cũ). Luồng này luôn
        chạy theo chế độ từng dòng (non-batch) để đơn giản hóa resume.
        """

        processed_rows = int(checkpoint.get('processed_rows', 0) or 0)
        existing_results = checkpoint.get('results') or []
        column_mapping = checkpoint.get('column_mapping') or label_data.get('column_mapping') or {}
        has_media = checkpoint.get('has_media') or ('media_files' in label_data)
        output_config = checkpoint.get('output_config') or label_data.get('output_config')

        label_data['column_mapping'] = column_mapping
        if output_config is not None:
            label_data['output_config'] = output_config

        with self.job_lock:
            if label_id in self.active_jobs:
                raise ValueError(
                    f"Label job {label_id} đã tồn tại trong active_jobs, không thể resume từ checkpoint"
                )

            job_info: Dict[str, Any] = {
                'label_id': label_id,
                'status': 'processing',
                'start_time': checkpoint.get('start_time', datetime.now().isoformat()),
                'total_rows': len(label_data['data']),
                'processed_rows': processed_rows,
                'results': existing_results,
                'guideline_id': checkpoint.get('guideline_id'),
                'data_id': checkpoint.get('data_id') or label_data.get('data_id'),
                'column_mapping': column_mapping,
                'has_media': has_media,
                'output_config': output_config,
                'provider': getattr(ai_instance, 'model_name', checkpoint.get('provider')),
                'model_version': getattr(ai_instance, 'model_version', checkpoint.get('model_version')),
                'prompt': prompt or checkpoint.get('prompt'),
            }

            if has_media:
                job_info['media_files'] = checkpoint.get('media_files') or label_data.get('media_files')

            self.active_jobs[label_id] = job_info

        thread = threading.Thread(
            target=self._process_label_thread,
            args=(label_id, label_data, ai_instance, prompt, processed_rows, existing_results, True),
        )
        thread.start()

        return {'label_id': label_id, 'status': 'processing'}

    # ============================
    # Core processing
    # ============================

    def _build_media_index(self, media_files: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
        """Tạo index media theo tên file (không extension, lowercase) để mapping nhanh.

        Logic giống QAProcessor._build_media_index, bao gồm cả alias suffix số
        (ví dụ filename "test_70291.jpg" sẽ map thêm key "70291").
        """
        index: Dict[str, Dict[str, Any]] = {}
        if not media_files or 'files' not in media_files:
            return index

        for mf in media_files['files']:
            filename = mf.get('filename') or ''
            base = os.path.splitext(os.path.basename(filename))[0].lower()
            if not base:
                continue

            if base not in index:
                index[base] = mf

            # Alias 1: bỏ prefix phổ biến như 'image_' hoặc 'img_'
            for prefix in ('image_', 'img_'):
                if base.startswith(prefix):
                    short = base[len(prefix):]
                    if short and short not in index:
                        index[short] = mf

            # Alias 2: suffix sau dấu '_' (kể cả không phải số)
            if '_' in base:
                suffix = base.split('_')[-1]
                if suffix and suffix not in index:
                    index[suffix] = mf
        return index

    def _get_media_for_row(
        self,
        row: Dict[str, Any],
        column_mapping: Dict[str, Any],
        media_index: Dict[str, Dict[str, Any]],
    ) -> Optional[Dict[str, str]]:
        """Lấy thông tin media cho dòng data dựa trên column_mapping và media_index.

        Thuần rule-based, giống với QAProcessor._get_media_for_row.
        """
        if not media_index:
            return None

        media_columns: List[str] = []
        for col_name, cfg in (column_mapping or {}).items():
            cfg = cfg or {}
            ctype = cfg.get('type')
            is_media = cfg.get('isMediaColumn') or ctype in ['media_path', 'media_name']
            if is_media:
                media_columns.append(col_name)

        if not media_columns:
            return None

        for col in media_columns:
            value = row.get(col)
            if value is None:
                continue

            if not isinstance(value, str):
                try:
                    if isinstance(value, (int, float)) and float(value).is_integer():
                        value = str(int(value))
                    else:
                        value = str(value)
                except Exception:
                    value = str(value)

            val = value.strip()
            if not val:
                continue

            base = os.path.splitext(os.path.basename(val))[0].lower()
            if not base:
                continue

            mf = media_index.get(base)
            if mf:
                return {'path': mf.get('path'), 'type': mf.get('type')}

        return None

    def _parse_ai_response(self, response: str) -> Dict[str, Any]:
        """Parse response từ AI (JSON) giống QAProcessor nhưng dùng chung cho labeling.

        Cho phép model trả về JSON có dạng tối thiểu:
        {
          "labels": { ... },
          "explanation": "...",
          "errors": ["..."]
        }
        """
        response = response.strip()
        if response.startswith('```json'):
            response = response[7:]
        if response.startswith('```'):
            response = response[3:]
        if response.endswith('```'):
            response = response[:-3]

        response = response.strip()
        try:
            return json.loads(response)
        except Exception:
            start = response.find('{')
            end = response.rfind('}')
            if start != -1 and end != -1 and end > start:
                candidate = response[start : end + 1]
                try:
                    return json.loads(candidate)
                except Exception:
                    pass
            raise

    def _process_label_thread(
        self,
        label_id: str,
        label_data: Dict[str, Any],
        ai_instance: AIIntegration,
        prompt: str,
        start_index: int = 0,
        existing_results: Optional[List[Dict[str, Any]]] = None,
        force_no_batch: bool = False,
    ) -> None:
        """Thread xử lý labeling.

        Mặc định xử lý từng dòng; nếu dataset KHÔNG có media và LABEL_BATCH_SIZE>1
        thì chuyển sang chế độ batch text-only để tận dụng TPM.
        """
        try:
            data_rows = label_data['data']
            has_media = 'media_files' in label_data
            column_mapping = label_data.get('column_mapping', {}) or {}
            columns_to_keep = set(column_mapping.keys()) if column_mapping else None
            guideline_rules = label_data.get('guideline_rules')
            output_config = label_data.get('output_config') or []

            # Nếu không có media và batch_size > 1 thì dùng chế độ batch text-only.
            # batch_size lấy từ env LABEL_BATCH_SIZE, nếu không có thì auto tính theo
            # RPD của model Gemini và target rows/day.
            batch_size = 1
            batch_size_env = os.getenv('LABEL_BATCH_SIZE')
            if batch_size_env:
                try:
                    batch_size = int(batch_size_env)
                except ValueError:
                    batch_size = 1
            elif isinstance(ai_instance, AIIntegration) and ai_instance.model_name == 'gemini':
                try:
                    from .ai_integration import AIIntegration as _AI

                    rpd = _AI.get_gemini_rpd(ai_instance.model_version)
                    if rpd <= 0:
                        rpd = 200
                    target_str = os.getenv('LABEL_TARGET_ROWS_PER_DAY', '50000')
                    try:
                        target_rows = int(target_str)
                    except ValueError:
                        target_rows = 50000

                    raw_batch = max(1, target_rows // max(rpd, 1))
                    max_batch_env = os.getenv('LABEL_MAX_BATCH_SIZE')
                    try:
                        max_batch = int(max_batch_env) if max_batch_env else 250
                    except ValueError:
                        max_batch = 250
                    batch_size = max(1, min(raw_batch, max_batch))
                except Exception:
                    batch_size = 1
            if batch_size > 1 and not has_media and not force_no_batch:
                print(f"[INFO][Label] Running text-only batch mode with LABEL_BATCH_SIZE={batch_size}", flush=True)
                self._process_label_text_batch(
                    label_id=label_id,
                    data_rows=data_rows,
                    ai_instance=ai_instance,
                    prompt=prompt,
                    guideline_rules=guideline_rules,
                    output_config=output_config,
                    columns_to_keep=columns_to_keep,
                )
                return

            if existing_results is not None:
                results: List[Dict[str, Any]] = existing_results
            else:
                results = []

            media_files = label_data.get('media_files') if has_media else None
            media_index = self._build_media_index(media_files) if media_files else None

            # Debug: log kích thước index media để kiểm tra backend thực sự nhận đủ files
            try:
                if media_index is not None:
                    print(
                        f"[DEBUG][Label] media_index size: {len(media_index)}, sample keys: {list(media_index.keys())[:10]}",
                        flush=True,
                    )
                else:
                    print("[DEBUG][Label] media_index is None (no media files)", flush=True)
            except Exception:
                pass

            # Xác định trước các cột media để có thể cảnh báo khi không map được file
            media_columns: List[str] = []
            if column_mapping:
                for col_name, cfg in column_mapping.items():
                    cfg = cfg or {}
                    ctype = cfg.get('type')
                    is_media = cfg.get('isMediaColumn') or ctype in ['media_path', 'media_name']
                    if is_media:
                        media_columns.append(col_name)

            for idx, row in enumerate(data_rows):
                if idx < max(start_index, 0):
                    continue
                try:
                    if columns_to_keep:
                        filtered_row = {k: v for k, v in row.items() if k in columns_to_keep}
                    else:
                        filtered_row = row

                    media_info = None
                    media_values: List[str] = []
                    if has_media:
                        media_info = self._get_media_for_row(
                            row=filtered_row,
                            column_mapping=column_mapping,
                            media_index=media_index,
                        )

                        # Thu thập giá trị ở các cột media để nếu không map được sẽ log cảnh báo rõ ràng
                        if media_columns:
                            for col in media_columns:
                                raw_value = filtered_row.get(col)
                                if raw_value is None:
                                    continue

                                if not isinstance(raw_value, str):
                                    try:
                                        if isinstance(raw_value, (int, float)) and float(raw_value).is_integer():
                                            raw_value = str(int(raw_value))
                                        else:
                                            raw_value = str(raw_value)
                                    except Exception:
                                        raw_value = str(raw_value)

                                value_str = raw_value.strip()
                                if not value_str:
                                    continue

                                media_values.append(f"{col}={value_str}")

                    # Chuẩn bị prompt cho dòng hiện tại (có hoặc không có media)
                    if media_info:
                        row_prompt = self.prompt_generator.create_media_label_prompt(
                            filtered_row,
                            media_info.get('type'),
                            prompt,
                            guideline_rules,
                            output_config,
                        )
                        use_media = True
                    else:
                        row_prompt = self.prompt_generator.create_label_prompt(
                            filtered_row,
                            prompt,
                            guideline_rules,
                            output_config,
                        )
                        use_media = False

                    # Gọi AI với cơ chế retry cho các lỗi kết nối tạm thời (timeout, quota, 5xx...)
                    max_retries = 2
                    response = None
                    for attempt in range(max_retries + 1):
                        try:
                            if use_media:
                                response = ai_instance.generate_with_media(
                                    row_prompt,
                                    media_info['path'],
                                    media_info['type'],
                                )
                            else:
                                response = ai_instance.generate_response(row_prompt)
                            break
                        except Exception as e:
                            error_message = str(e)
                            error_message_lower = error_message.lower()
                            connection_keywords = [
                                'timeout',
                                'timed out',
                                '504',
                                '503',
                                '429',
                                'quota',
                                'rate limit',
                                'connection reset',
                                'temporarily unavailable',
                                'unavailable',
                            ]
                            is_connection_error = any(
                                kw in error_message_lower for kw in connection_keywords
                            )

                            # Chỉ retry nếu là lỗi kết nối và chưa hết số lần thử
                            if is_connection_error and attempt < max_retries:
                                try:
                                    print(
                                        f"[WARNING][Label] AI call failed (attempt {attempt + 1}/{max_retries + 1}) with connection error: {error_message}. Retrying...",
                                        flush=True,
                                    )
                                except Exception:
                                    pass
                                time.sleep(2)
                                continue

                            # Không phải lỗi kết nối hoặc đã hết retry -> ném cho handler bên ngoài xử lý
                            raise

                    try:
                        parsed = self._parse_ai_response(response)
                    except Exception:
                        parsed = {
                            'labels': {},
                            'explanation': 'Không parse được JSON từ phản hồi của AI. Không thể gán label cho dòng này.',
                            'errors': [
                                f"Lỗi khi xử lý phản hồi từ AI (labeling): {str(response)}",
                            ],
                        }

                    labels = parsed.get('labels') or {}
                    explanation = parsed.get('explanation') or ''
                    errors = parsed.get('errors') or []
                    if not isinstance(errors, list):
                        errors = [str(errors)]

                    # Nếu có giá trị ở cột media nhưng không map được file, thêm cảnh báo cụ thể
                    if has_media and media_columns and media_values and not media_info:
                        mapping_warning = (
                            "Không tìm thấy file media tương ứng với giá trị ở cột media "
                            f"({', '.join(media_values)}). Hệ thống chỉ gán label dựa trên text cho dòng này."
                        )
                        errors.append(mapping_warning)
                        # Debug thêm để xem index hiện có những key nào
                        try:
                            print(
                                f"[DEBUG][Label] No media matched for {media_values}. Index keys (sample): {list(media_index.keys())[:20] if media_index else 'NO_INDEX'}",
                                flush=True,
                            )
                        except Exception:
                            pass

                    result: Dict[str, Any] = {
                        'row_index': idx,
                        'row_data': filtered_row,
                        'labels': labels,
                        'explanation': explanation,
                        'errors': errors,
                        'timestamp': datetime.now().isoformat(),
                    }

                    if media_info and media_info.get('path'):
                        media_path = media_info.get('path')
                        media_type = media_info.get('type')
                        batch_id = None
                        filename = None
                        try:
                            norm_path = os.path.normpath(media_path)
                            parts = norm_path.split(os.sep)
                            if len(parts) >= 2:
                                filename = parts[-1]
                                batch_id = parts[-2]
                            else:
                                filename = os.path.basename(media_path)
                        except Exception:
                            filename = os.path.basename(media_path)
                            batch_id = None

                        result['media'] = {
                            'batch_id': batch_id,
                            'filename': filename,
                            'type': media_type,
                        }

                    results.append(result)

                    with self.job_lock:
                        self.active_jobs[label_id]['processed_rows'] = idx + 1
                        self.active_jobs[label_id]['results'] = results

                    # Ghi checkpoint để có thể resume/khôi phục sau restart
                    self._save_label_result(label_id)

                except Exception as e:
                    safe_row_data = filtered_row if 'filtered_row' in locals() else row
                    error_message = str(e)
                    error_message_lower = error_message.lower()
                    connection_keywords = [
                        'timeout',
                        'timed out',
                        '504',
                        '503',
                        '429',
                        'quota',
                        'rate limit',
                        'connection reset',
                        'temporarily unavailable',
                        'unavailable',
                    ]
                    is_connection_error = any(
                        kw in error_message_lower for kw in connection_keywords
                    )

                    if is_connection_error:
                        user_friendly_error = (
                            f"Lỗi kết nối với AI khi xử lý dòng labeling: {error_message}"
                        )
                        explanation = (
                            'Không thể gọi model AI (timeout/kết nối lỗi/quota...). '
                            'Hệ thống không gán được label cho dòng dữ liệu này nhưng vẫn tiếp tục xử lý các dòng khác.'
                        )
                    else:
                        user_friendly_error = (
                            f"Lỗi hệ thống khi xử lý dòng labeling: {error_message}"
                        )
                        explanation = (
                            'Có lỗi hệ thống (exception) trong quá trình xử lý dòng labeling. '
                            'Không thể gán label.'
                        )

                    results.append(
                        {
                            'row_index': idx,
                            'row_data': safe_row_data,
                            'labels': {},
                            'explanation': explanation,
                            'errors': [user_friendly_error],
                            'error': error_message,
                            'timestamp': datetime.now().isoformat(),
                        }
                    )

                    with self.job_lock:
                        self.active_jobs[label_id]['processed_rows'] = idx + 1
                        self.active_jobs[label_id]['results'] = results

                    # Ghi checkpoint sau lỗi để không mất trạng thái
                    self._save_label_result(label_id)

            with self.job_lock:
                self.active_jobs[label_id]['status'] = 'completed'
                self.active_jobs[label_id]['end_time'] = datetime.now().isoformat()
                self.active_jobs[label_id]['results'] = results

            self._save_label_result(label_id)

        except Exception as e:
            with self.job_lock:
                self.active_jobs[label_id]['status'] = 'failed'
                self.active_jobs[label_id]['error'] = str(e)
                self.active_jobs[label_id]['end_time'] = datetime.now().isoformat()

    def _process_label_text_batch(
        self,
        label_id: str,
        data_rows: List[Dict[str, Any]],
        ai_instance: AIIntegration,
        prompt: str,
        guideline_rules,
        output_config,
        columns_to_keep,
    ) -> None:
        """Xử lý labeling theo batch cho dataset text-only (không media).

        Gộp nhiều dòng thành 1 request để tiết kiệm RPD, tận dụng TPM.
        """

        results: List[Dict[str, Any]] = []

        batch_size = 1
        batch_size_env = os.getenv('LABEL_BATCH_SIZE')
        if batch_size_env:
            try:
                batch_size = int(batch_size_env)
            except ValueError:
                batch_size = 1
        if batch_size < 1:
            batch_size = 1

        total_rows = len(data_rows)

        for start in range(0, total_rows, batch_size):
            end = min(start + batch_size, total_rows)
            batch_indices = list(range(start, end))

            # Chuẩn bị batch filtered_rows
            batch_rows: List[Dict[str, Any]] = []
            for idx in batch_indices:
                row = data_rows[idx]
                if columns_to_keep:
                    filtered_row = {k: v for k, v in row.items() if k in columns_to_keep}
                else:
                    filtered_row = row
                batch_rows.append(filtered_row)

            # Tạo prompt batch
            batch_prompt = self.prompt_generator.create_label_batch_prompt(
                batch_rows,
                prompt,
                guideline_rules,
                output_config,
            )

            # Gọi AI với retry cho cả batch
            max_retries = 2
            response_text: Optional[str] = None
            last_error: Optional[Exception] = None

            for attempt in range(max_retries + 1):
                try:
                    response_text = ai_instance.generate_response(batch_prompt)
                    break
                except Exception as e:
                    last_error = e
                    error_message = str(e)
                    error_message_lower = error_message.lower()
                    connection_keywords = [
                        'timeout',
                        'timed out',
                        '504',
                        '503',
                        '429',
                        'quota',
                        'rate limit',
                        'connection reset',
                        'temporarily unavailable',
                        'unavailable',
                    ]
                    is_connection_error = any(
                        kw in error_message_lower for kw in connection_keywords
                    )

                    if is_connection_error and attempt < max_retries:
                        try:
                            print(
                                f"[WARNING][Label][Batch] AI call failed (attempt {attempt + 1}/{max_retries + 1}) with connection error: {error_message}. Retrying...",
                                flush=True,
                            )
                        except Exception:
                            pass
                        time.sleep(2)
                        continue

                    # Không phải lỗi kết nối hoặc hết retry
                    break

            if response_text is None:
                # Coi như cả batch lỗi -> tạo error result cho từng dòng
                for local_idx, global_idx in enumerate(batch_indices):
                    row = batch_rows[local_idx]
                    error_message = str(last_error) if last_error else 'Unknown error in batch labeling'
                    error_message_lower = error_message.lower()
                    connection_keywords = [
                        'timeout',
                        'timed out',
                        '504',
                        '503',
                        '429',
                        'quota',
                        'rate limit',
                        'connection reset',
                        'temporarily unavailable',
                        'unavailable',
                    ]
                    is_connection_error = any(
                        kw in error_message_lower for kw in connection_keywords
                    )

                    if is_connection_error:
                        user_friendly_error = (
                            f"Lỗi kết nối với AI khi xử lý batch labeling: {error_message}"
                        )
                        explanation = (
                            'Không thể gọi model AI (timeout/kết nối lỗi/quota...) cho batch này. '
                            'Hệ thống không gán được label cho các dòng trong batch nhưng vẫn tiếp tục các batch khác.'
                        )
                    else:
                        user_friendly_error = (
                            f"Lỗi hệ thống khi xử lý batch labeling: {error_message}"
                        )
                        explanation = (
                            'Có lỗi hệ thống (exception) trong quá trình xử lý batch labeling. '
                            'Không thể gán label.'
                        )

                    results.append(
                        {
                            'row_index': global_idx,
                            'row_data': row,
                            'labels': {},
                            'explanation': explanation,
                            'errors': [user_friendly_error],
                            'error': error_message,
                            'timestamp': datetime.now().isoformat(),
                        }
                    )

                with self.job_lock:
                    self.active_jobs[label_id]['processed_rows'] = end
                    self.active_jobs[label_id]['results'] = results

                # Checkpoint sau batch lỗi
                self._save_label_result(label_id)
                continue

            # Parse JSON batch
            try:
                parsed = self._parse_ai_response(response_text)
            except Exception:
                # Nếu parse fail cho cả batch, tạo error cho từng dòng
                for local_idx, global_idx in enumerate(batch_indices):
                    row = batch_rows[local_idx]
                    msg = (
                        'Không parse được JSON batch từ phản hồi của AI. '
                        'Không thể gán label cho dòng này (batch).'
                    )
                    results.append(
                        {
                            'row_index': global_idx,
                            'row_data': row,
                            'labels': {},
                            'explanation': msg,
                            'errors': [
                                f"Lỗi khi xử lý phản hồi batch từ AI (labeling): {str(response_text)}",
                            ],
                            'timestamp': datetime.now().isoformat(),
                        }
                    )

                with self.job_lock:
                    self.active_jobs[label_id]['processed_rows'] = end
                    self.active_jobs[label_id]['results'] = results
                continue

            items = parsed.get('items') if isinstance(parsed, dict) else None
            if not isinstance(items, list):
                # Nếu model trả về list trực tiếp
                if isinstance(parsed, list):
                    items = parsed
                else:
                    items = []

            # Map kết quả theo index trong batch
            item_by_index = {}
            for it in items:
                if not isinstance(it, dict):
                    continue
                idx_val = it.get('index')
                if isinstance(idx_val, int) and 0 <= idx_val < len(batch_indices):
                    item_by_index[idx_val] = it

            for local_idx, global_idx in enumerate(batch_indices):
                filtered_row = batch_rows[local_idx]
                item = item_by_index.get(local_idx)
                if not item:
                    # Không có kết quả cho dòng này trong batch
                    msg = 'Không tìm thấy kết quả batch cho dòng này trong phản hồi AI.'
                    results.append(
                        {
                            'row_index': global_idx,
                            'row_data': filtered_row,
                            'labels': {},
                            'explanation': msg,
                            'errors': [msg],
                            'timestamp': datetime.now().isoformat(),
                        }
                    )
                    continue

                labels = item.get('labels') or {}
                explanation = item.get('explanation') or ''
                errors = item.get('errors') or []
                if not isinstance(errors, list):
                    errors = [str(errors)]

                result: Dict[str, Any] = {
                    'row_index': global_idx,
                    'row_data': filtered_row,
                    'labels': labels,
                    'explanation': explanation,
                    'errors': errors,
                    'timestamp': datetime.now().isoformat(),
                }

                results.append(result)

            with self.job_lock:
                self.active_jobs[label_id]['processed_rows'] = end
                self.active_jobs[label_id]['results'] = results

            # Checkpoint sau batch thành công
            self._save_label_result(label_id)

        # Hoàn thành toàn bộ batch
        with self.job_lock:
            self.active_jobs[label_id]['status'] = 'completed'
            self.active_jobs[label_id]['end_time'] = datetime.now().isoformat()
            self.active_jobs[label_id]['results'] = results

        self._save_label_result(label_id)

    # ============================
    # Persistence & APIs
    # ============================

    def _save_label_result(self, label_id: str) -> None:
        with self.job_lock:
            job_info = self.active_jobs[label_id].copy()

        result_path = os.path.join(self.results_folder, f"label_{label_id}.json")
        with open(result_path, 'w', encoding='utf-8') as f:
            json.dump(job_info, f, ensure_ascii=False, indent=2)

    def get_label_status(self, label_id: str) -> Dict[str, Any]:
        """Lấy trạng thái label job (wrapper cho endpoint)."""
        with self.job_lock:
            if label_id in self.active_jobs:
                job_info = self.active_jobs[label_id].copy()
                return {
                    'status': job_info['status'],
                    'progress': {
                        'total': job_info.get('total_rows', 0),
                        'processed': job_info.get('processed_rows', 0),
                    },
                }

        result_path = os.path.join(self.results_folder, f"label_{label_id}.json")
        if os.path.exists(result_path):
            with open(result_path, 'r', encoding='utf-8') as f:
                job_info = json.load(f)
            return {
                'status': job_info['status'],
                'progress': {
                    'total': job_info.get('total_rows', 0),
                    'processed': job_info.get('processed_rows', 0),
                },
            }

        raise FileNotFoundError(f"Không tìm thấy job labeling {label_id}")

    def get_label_result(self, label_id: str) -> Dict[str, Any]:
        """Lấy kết quả labeling đầy đủ."""
        with self.job_lock:
            if label_id in self.active_jobs:
                return self.active_jobs[label_id].copy()

        result_path = os.path.join(self.results_folder, f"label_{label_id}.json")
        if not os.path.exists(result_path):
            raise FileNotFoundError(f"Không tìm thấy kết quả labeling {label_id}")

        with open(result_path, 'r', encoding='utf-8') as f:
            return json.load(f)

    def export_result(self, label_id: str, output_folder: str) -> str:
        """Export kết quả labeling ra Excel.

        - Giữ nguyên các cột gốc.
        - Thêm các cột Label_* từ trường labels.
        - Thêm cột Label_Explanation.
        """
        result = self.get_label_result(label_id)

        rows: List[Dict[str, Any]] = []
        for r in result.get('results', []):
            row = r.get('row_data', {}).copy()

            try:
                row['data_raw'] = json.dumps(r.get('row_data', {}), ensure_ascii=False)
            except Exception:
                row['data_raw'] = str(r.get('row_data', {}))

            labels = r.get('labels') or {}
            if isinstance(labels, dict):
                for k, v in labels.items():
                    col_name = f"Label_{k}"
                    row[col_name] = v

            row['Label_Explanation'] = r.get('explanation')

            media = r.get('media') or {}
            if media:
                row['Media_Filename'] = media.get('filename')
                row['Media_Type'] = media.get('type')

            row['Label_Errors'] = ', '.join(r.get('errors', []))

            rows.append(row)

        df = pd.DataFrame(rows)
        output_path = os.path.join(output_folder, f"label_result_{label_id}.xlsx")
        df.to_excel(output_path, index=False)
        return output_path
