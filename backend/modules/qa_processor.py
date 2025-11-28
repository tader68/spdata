"""
Module xử lý quá trình QA
Điều phối việc kiểm tra data với AI và đối chiếu kết quả
"""

import os
import json
import uuid
import time
from datetime import datetime
from typing import Dict, List, Any, Optional
import pandas as pd
from concurrent.futures import ThreadPoolExecutor, as_completed
import threading

from .ai_integration import AIIntegration
from .prompt_generator import PromptGenerator

class QAProcessor:
    """
    Class xử lý toàn bộ quy trình QA
    """
    
    def __init__(self):
        """
        Khởi tạo QAProcessor
        """
        self.results_folder = 'results'
        os.makedirs(self.results_folder, exist_ok=True)
        
        self.prompt_generator = PromptGenerator()
        
        # Dictionary lưu trạng thái các job đang chạy
        self.active_jobs = {}
        self.job_lock = threading.Lock()
    
    def _generate_qa_id(self) -> str:
        """
        Sinh ID cho QA job
        
        Returns:
            UUID string
        """
        return str(uuid.uuid4())
    
    def process_qa(self, 
                   qa_data: Dict[str, Any],
                   ai_instance: AIIntegration,
                   prompt: str,
                   guideline_id: str,
                   column_mapping: Dict[str, Any] = None) -> Dict[str, Any]:
        """
        Xử lý QA cho toàn bộ dataset
        
        Args:
            qa_data: Data cần QA
            ai_instance: Instance của AI
            prompt: Prompt template
            guideline_id: ID của guideline
            column_mapping: Mapping ý nghĩa các cột
            
        Returns:
            Dictionary chứa thông tin QA job
        """
        qa_id = self._generate_qa_id()

        # Gắn column_mapping vào qa_data để thread có thể sử dụng (ví dụ mapping media)
        if column_mapping is None:
            column_mapping = {}
        qa_data['column_mapping'] = column_mapping
        has_media = 'media_files' in qa_data
        
        # Khởi tạo job info (lưu thêm column_mapping / media / cấu hình model để checkpoint dùng lại)
        job_info = {
            'qa_id': qa_id,
            'status': 'processing',
            'start_time': datetime.now().isoformat(),
            'total_rows': len(qa_data['data']),
            'processed_rows': 0,
            'results': [],
            'guideline_id': guideline_id,
            'paused': False,
            'pause_requested': False,
            'data_id': qa_data['data_id'],
            'column_mapping': column_mapping,
            'has_media': has_media,
            'provider': getattr(ai_instance, 'model_name', None),
            'model_version': getattr(ai_instance, 'model_version', None),
            'prompt': prompt,
        }

        if has_media:
            job_info['media_files'] = qa_data.get('media_files')
        
        # Lưu vào active jobs
        with self.job_lock:
            self.active_jobs[qa_id] = job_info
        
        # Xử lý trong thread riêng
        thread = threading.Thread(
            target=self._process_qa_thread,
            args=(qa_id, qa_data, ai_instance, prompt)
        )
        thread.start()
        
        return {
            'qa_id': qa_id,
            'status': 'processing'
        }
    
    def start_qa_from_checkpoint(self,
                                 qa_id: str,
                                 checkpoint: Dict[str, Any],
                                 qa_data: Dict[str, Any],
                                 ai_instance: AIIntegration,
                                 prompt: str) -> Dict[str, Any]:
        """Khởi động lại QA từ checkpoint đã lưu trên đĩa.

        Chỉ dùng khi server đã restart (không còn active_jobs cũ). Luồng này luôn
        chạy theo chế độ từng dòng (non-batch) để đơn giản hóa resume.
        """

        processed_rows = int(checkpoint.get('processed_rows', 0) or 0)
        existing_results = checkpoint.get('results') or []
        column_mapping = checkpoint.get('column_mapping') or qa_data.get('column_mapping') or {}
        has_media = checkpoint.get('has_media') or ('media_files' in qa_data)

        qa_data['column_mapping'] = column_mapping

        with self.job_lock:
            if qa_id in self.active_jobs:
                raise ValueError(f"QA job {qa_id} đã tồn tại trong active_jobs, không thể resume từ checkpoint")

            job_info = {
                'qa_id': qa_id,
                'status': 'processing',
                'start_time': checkpoint.get('start_time', datetime.now().isoformat()),
                'total_rows': len(qa_data['data']),
                'processed_rows': processed_rows,
                'results': existing_results,
                'guideline_id': checkpoint.get('guideline_id'),
                'paused': False,
                'pause_requested': False,
                'data_id': checkpoint.get('data_id') or qa_data.get('data_id'),
                'column_mapping': column_mapping,
                'has_media': has_media,
                'provider': getattr(ai_instance, 'model_name', checkpoint.get('provider')),
                'model_version': getattr(ai_instance, 'model_version', checkpoint.get('model_version')),
                'prompt': prompt or checkpoint.get('prompt'),
            }

            if has_media:
                job_info['media_files'] = checkpoint.get('media_files') or qa_data.get('media_files')

            self.active_jobs[qa_id] = job_info

        thread = threading.Thread(
            target=self._process_qa_thread,
            args=(qa_id, qa_data, ai_instance, prompt, processed_rows, existing_results, True)
        )
        thread.start()

        return {
            'qa_id': qa_id,
            'status': 'processing'
        }
    
    def _process_qa_thread(self,
                          qa_id: str,
                          qa_data: Dict[str, Any],
                          ai_instance: AIIntegration,
                          prompt: str,
                          start_index: int = 0,
                          existing_results: Optional[List[Dict[str, Any]]] = None,
                          force_no_batch: bool = False):
        """
        Thread xử lý QA
        
        Args:
            qa_id: ID của QA job
            qa_data: Data cần QA
            ai_instance: AI instance
            prompt: Prompt template
        """
        try:
            data_rows = qa_data['data']
            has_media = 'media_files' in qa_data
            column_mapping = qa_data.get('column_mapping', {})
            # Nếu có column_mapping thì chỉ giữ lại các cột vẫn còn trong mapping
            columns_to_keep = set(column_mapping.keys()) if column_mapping else None
            # Bộ quy tắc đã phân tích từ guideline (nếu có)
            guideline_rules = qa_data.get('guideline_rules')

            # Nếu không có media và batch_size>1 thì dùng chế độ batch text-only.
            # batch_size được lấy từ env QA_BATCH_SIZE, nếu không có thì auto tính theo
            # RPD của model Gemini và target rows/day.
            batch_size = 1
            batch_env = os.getenv('QA_BATCH_SIZE')
            if batch_env:
                try:
                    batch_size = int(batch_env)
                except ValueError:
                    batch_size = 1
            elif isinstance(ai_instance, AIIntegration) and ai_instance.model_name == 'gemini':
                try:
                    from .ai_integration import AIIntegration as _AI

                    rpd = _AI.get_gemini_rpd(ai_instance.model_version)
                    if rpd <= 0:
                        rpd = 200
                    target_str = os.getenv('QA_TARGET_ROWS_PER_DAY', '50000')
                    try:
                        target_rows = int(target_str)
                    except ValueError:
                        target_rows = 50000

                    # rows_per_request ~ target_rows / RPD, clamp về [1, QA_MAX_BATCH_SIZE]
                    raw_batch = max(1, target_rows // max(rpd, 1))
                    max_batch_env = os.getenv('QA_MAX_BATCH_SIZE')
                    try:
                        max_batch = int(max_batch_env) if max_batch_env else 250
                    except ValueError:
                        max_batch = 250
                    batch_size = max(1, min(raw_batch, max_batch))
                except Exception:
                    batch_size = 1
            if batch_size > 1 and not has_media and not force_no_batch:
                print(f"[INFO][QA] Running text-only batch mode with QA_BATCH_SIZE={batch_size}", flush=True)
                self._process_qa_text_batch(
                    qa_id=qa_id,
                    data_rows=data_rows,
                    ai_instance=ai_instance,
                    prompt=prompt,
                    guideline_rules=guideline_rules,
                    columns_to_keep=columns_to_keep,
                )
                return

            # Khởi tạo kết quả ban đầu (dùng lại kết quả đã có nếu resume từ checkpoint)
            if existing_results is not None:
                results = existing_results
            else:
                results = []
            
            # Xây index media theo filename để mapping nhanh và chính xác
            media_files = qa_data.get('media_files') if has_media else None
            media_index = self._build_media_index(media_files) if media_files else None

            # Xác định trước các cột media để có thể cảnh báo khi không map được file
            media_columns = []
            if column_mapping:
                for col_name, cfg in column_mapping.items():
                    cfg = cfg or {}
                    ctype = cfg.get('type')
                    is_media = cfg.get('isMediaColumn') or ctype in ['media_path', 'media_name']
                    if is_media:
                        media_columns.append(col_name)

            # Xử lý từng dòng data
            for idx, row in enumerate(data_rows):
                if idx < max(start_index, 0):
                    continue
                # Kiểm tra pause request (không giữ lock trong khi chờ resume)
                should_wait = False
                with self.job_lock:
                    job = self.active_jobs.get(qa_id)
                    if job and job.get('pause_requested'):
                        job['status'] = 'paused'
                        job['paused'] = True
                        job['pause_requested'] = False
                        should_wait = True
                        print(f"[INFO] QA {qa_id} paused at row {idx}", flush=True)

                if should_wait:
                    # Đợi tới khi resume_qa() đặt lại paused = False
                    while True:
                        with self.job_lock:
                            job = self.active_jobs.get(qa_id)
                            paused = bool(job and job.get('paused'))
                        if not paused:
                            break
                        time.sleep(1)

                    with self.job_lock:
                        job = self.active_jobs.get(qa_id)
                        if job:
                            job['status'] = 'processing'
                    print(f"[INFO] QA {qa_id} resumed at row {idx}", flush=True)

                try:
                    # Áp dụng column_mapping: chỉ giữ lại các cột còn trong mapping (đã cấu hình)
                    if columns_to_keep:
                        filtered_row = {k: v for k, v in row.items() if k in columns_to_keep}
                    else:
                        filtered_row = row

                    # Mapping media theo rule (không dùng AI): chỉ khi có cột media trong column_mapping
                    media_info = None
                    if has_media:
                        media_info = self._get_media_for_row(
                            row=filtered_row,
                            media_files=qa_data['media_files'],
                            column_mapping=column_mapping,
                            media_index=media_index
                        )

                    # Tạo prompt cụ thể cho dòng này dựa trên data đã lọc, bộ rules (nếu có) và media (nếu có)
                    if media_info:
                        row_prompt = self.prompt_generator.create_media_qa_prompt(
                            filtered_row,
                            media_info.get('type'),
                            prompt,
                            guideline_rules
                        )
                        # Chỉ gọi AI cho đúng media đã mapping
                        response = ai_instance.generate_with_media(
                            row_prompt,
                            media_info['path'],
                            media_info['type']
                        )
                    else:
                        row_prompt = self.prompt_generator.create_qa_prompt(
                            filtered_row,
                            prompt,
                            guideline_rules
                        )
                        response = ai_instance.generate_response(row_prompt)
                    
                    # Parse response (giả sử là JSON)
                    try:
                        result = self._parse_ai_response(response)
                    except Exception:
                        # Trường hợp AI trả về text lỗi hoặc JSON không hợp lệ
                        result = {
                            'is_correct': None,
                            'errors': [
                                f"Lỗi khi xử lý phản hồi từ AI: {str(response)}"
                            ],
                            'suggestions': [],
                            'confidence_score': 0,
                            'explanation': 'Không parse được JSON từ phản hồi của AI. Không thể kết luận đúng/sai cho dòng này.',
                            'violated_rules': []
                        }

                    # Đảm bảo trường errors và violated_rules tồn tại để có thể append/cấu trúc thống nhất
                    if 'errors' not in result or not isinstance(result.get('errors'), list):
                        result['errors'] = []  # type: ignore
                    if 'violated_rules' not in result or not isinstance(result.get('violated_rules'), list):
                        result['violated_rules'] = []  # type: ignore

                    # Nếu có giá trị ở cột media nhưng không map được file, thêm cảnh báo
                    media_values = []
                    if has_media and media_columns:
                        for col in media_columns:
                            raw_value = filtered_row.get(col)
                            if raw_value is None:
                                continue

                            # Đồng nhất cách chuẩn hóa với _get_media_for_row
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

                    if media_values and not media_info:
                        warning_msg = (
                            "Không tìm thấy file media tương ứng với giá trị ở cột media "
                            f"({', '.join(media_values)}). Hệ thống chỉ đánh giá dựa trên text cho dòng này."
                        )
                        result['errors'].append(warning_msg)

                    # Thêm thông tin bổ sung
                    result['row_index'] = idx
                    result['row_data'] = filtered_row
                    result['timestamp'] = datetime.now().isoformat()

                    # Nếu có media được mapping cho dòng này, lưu metadata để frontend hiển thị
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
                            'type': media_type
                        }

                    results.append(result)
                    
                    # Cập nhật progress
                    with self.job_lock:
                        self.active_jobs[qa_id]['processed_rows'] = idx + 1
                        self.active_jobs[qa_id]['results'] = results

                    # Ghi checkpoint để có thể resume/khôi phục sau restart
                    self._save_qa_result(qa_id)
                
                except Exception as e:
                    # Lỗi khi xử lý dòng này (exception bất ngờ, ví dụ lỗi gọi API, lỗi I/O...)
                    # Vẫn ưu tiên dùng filtered_row (đã áp dụng column_mapping) nếu có,
                    # fallback về row gốc trong trường hợp hiếm hoi filtered_row chưa được gán
                    safe_row_data = filtered_row if 'filtered_row' in locals() else row

                    error_message = str(e)
                    error_message_lower = error_message.lower()

                    # Nhận diện các lỗi kết nối/timeout/quota với AI để báo rõ ràng hơn
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
                        'unavailable'
                    ]
                    is_connection_error = any(kw in error_message_lower for kw in connection_keywords)

                    if is_connection_error:
                        user_friendly_error = (
                            f"Lỗi kết nối với AI khi xử lý dòng QA: {error_message}"
                        )
                        explanation = (
                            'Không thể gọi model AI (timeout/kết nối lỗi/quota...). '
                            'Hệ thống không đánh giá được dòng dữ liệu này nhưng vẫn tiếp tục xử lý các dòng khác.'
                        )
                    else:
                        user_friendly_error = (
                            f"Lỗi hệ thống khi xử lý dòng QA: {error_message}"
                        )
                        explanation = (
                            'Có lỗi hệ thống (exception) trong quá trình xử lý dòng QA. '
                            'Không thể kết luận đúng/sai.'
                        )

                    results.append({
                        'row_index': idx,
                        'row_data': safe_row_data,
                        'is_correct': None,
                        'errors': [user_friendly_error],
                        'suggestions': [],
                        'confidence_score': 0,
                        'explanation': explanation,
                        'violated_rules': [],
                        'error': error_message,
                        'timestamp': datetime.now().isoformat()
                    })
            
            # Hoàn thành
            with self.job_lock:
                self.active_jobs[qa_id]['status'] = 'completed'
                self.active_jobs[qa_id]['end_time'] = datetime.now().isoformat()
                self.active_jobs[qa_id]['results'] = results
            
            # Lưu kết quả ra file (checkpoint cuối cùng)
            self._save_qa_result(qa_id)
        
        except Exception as e:
            # Lỗi nghiêm trọng
            with self.job_lock:
                self.active_jobs[qa_id]['status'] = 'failed'
                self.active_jobs[qa_id]['error'] = str(e)
                self.active_jobs[qa_id]['end_time'] = datetime.now().isoformat()
    
    def _has_media_for_row(self, row: Dict[str, Any], media_files: Dict[str, Any]) -> bool:
        """Giữ lại để tương thích, hiện không còn dùng trong luồng chính"""
        return False

    def _build_media_index(self, media_files: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
        """Tạo index media theo tên file (không extension, lowercase) để mapping nhanh

        Args:
            media_files: Dict chứa 'files' với danh sách media

        Returns:
            Dict: key là tên file chuẩn hóa, value là media_file tương ứng
        """
        index = {}
        if not media_files or 'files' not in media_files:
            return index

        for mf in media_files['files']:
            filename = mf.get('filename') or ''
            base = os.path.splitext(os.path.basename(filename))[0].lower()
            if not base:
                continue

            # Nếu trùng tên, giữ file đầu tiên
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
    
    def _get_media_for_row(self,
                           row: Dict[str, Any],
                           media_files: Dict[str, Any],
                           column_mapping: Dict[str, Any],
                           media_index: Dict[str, Dict[str, Any]]) -> Dict[str, str]:
        """Lấy thông tin media cho dòng data dựa trên column_mapping và media_index
        
        Rule:
        - Chỉ nhìn vào các cột được đánh dấu là media (media_path, media_name hoặc isMediaColumn).
        - Chuẩn hóa giá trị cell về tên file (bỏ path, bỏ extension, lowercase).
        - Mapping đúng 1 file từ media_index; các file media khác không được dùng.
        
        Args:
            row: Dòng data
            media_files: Thông tin media files (giữ để compat nếu cần)
            column_mapping: Mapping cấu hình cột
            media_index: Index media theo tên file chuẩn hóa
        """
        if not media_index:
            return None

        # Xác định các cột media từ column_mapping
        media_columns = []
        for col_name, cfg in (column_mapping or {}).items():
            ctype = (cfg or {}).get('type')
            is_media = (cfg or {}).get('isMediaColumn') or ctype in ['media_path', 'media_name']
            if is_media:
                media_columns.append(col_name)

        if not media_columns:
            return None

        # Thử mapping theo từng cột media
        for col in media_columns:
            value = row.get(col)
            if value is None:
                continue

            # Nếu là số (int/float) thì chuyển sang string để map tên file
            if not isinstance(value, str):
                try:
                    if isinstance(value, (int, float)) and float(value).is_integer():
                        value = str(int(value))
                    else:
                        value = str(value)
                except Exception:
                    value = str(value)

            if not value.strip():
                continue

            # Chuẩn hóa: lấy basename, bỏ extension, lowercase
            val = value.strip()
            base = os.path.splitext(os.path.basename(val))[0].lower()
            if not base:
                continue

            mf = media_index.get(base)
            if mf:
                return {
                    'path': mf.get('path'),
                    'type': mf.get('type')
                }

        return None

    def _process_qa_text_batch(
        self,
        qa_id: str,
        data_rows: List[Dict[str, Any]],
        ai_instance: AIIntegration,
        prompt: str,
        guideline_rules,
        columns_to_keep,
    ) -> None:
        """Xử lý QA theo batch cho dataset text-only (không media).

        Gộp nhiều dòng thành 1 request để tiết kiệm RPD, tận dụng TPM.
        """

        results: List[Dict[str, Any]] = []

        batch_size = 1
        batch_env = os.getenv('QA_BATCH_SIZE')
        if batch_env:
            try:
                batch_size = int(batch_env)
            except ValueError:
                batch_size = 1
        if batch_size < 1:
            batch_size = 1

        total_rows = len(data_rows)

        for start in range(0, total_rows, batch_size):
            end = min(start + batch_size, total_rows)

            # Kiểm tra pause request ở mức batch
            with self.job_lock:
                job = self.active_jobs.get(qa_id)
                if job and job.get('pause_requested'):
                    job['status'] = 'paused'
                    job['paused'] = True
                    job['pause_requested'] = False
                    print(f"[INFO] QA {qa_id} paused at row {start}", flush=True)

            # Đợi resume nếu đang paused
            while True:
                with self.job_lock:
                    job = self.active_jobs.get(qa_id)
                    paused = bool(job and job.get('paused'))
                if not paused:
                    break
                time.sleep(1)

            with self.job_lock:
                job = self.active_jobs.get(qa_id)
                if job:
                    job['status'] = 'processing'
                    # Không in log nếu chưa từng pause

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
            batch_prompt = self.prompt_generator.create_qa_batch_prompt(
                batch_rows,
                prompt,
                guideline_rules,
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
                                f"[WARNING][QA][Batch] AI call failed (attempt {attempt + 1}/{max_retries + 1}) with connection error: {error_message}. Retrying...",
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
                    error_message = str(last_error) if last_error else 'Unknown error in batch QA'
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
                            f"Lỗi kết nối với AI khi xử lý batch QA: {error_message}"
                        )
                        explanation = (
                            'Không thể gọi model AI (timeout/kết nối lỗi/quota...) cho batch này. '
                            'Hệ thống không đánh giá được các dòng trong batch nhưng vẫn tiếp tục các batch khác.'
                        )
                    else:
                        user_friendly_error = (
                            f"Lỗi hệ thống khi xử lý batch QA: {error_message}"
                        )
                        explanation = (
                            'Có lỗi hệ thống (exception) trong quá trình xử lý batch QA. '
                            'Không thể kết luận đúng/sai.'
                        )

                    results.append({
                        'row_index': global_idx,
                        'row_data': row,
                        'is_correct': None,
                        'errors': [user_friendly_error],
                        'suggestions': [],
                        'confidence_score': 0,
                        'explanation': explanation,
                        'violated_rules': [],
                        'error': error_message,
                        'timestamp': datetime.now().isoformat(),
                    })

                with self.job_lock:
                    self.active_jobs[qa_id]['processed_rows'] = end
                    self.active_jobs[qa_id]['results'] = results

                # Checkpoint sau batch lỗi
                self._save_qa_result(qa_id)
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
                        'Không thể kết luận đúng/sai cho dòng này (batch).'
                    )
                    results.append({
                        'row_index': global_idx,
                        'row_data': row,
                        'is_correct': None,
                        'errors': [
                            f"Lỗi khi xử lý phản hồi batch từ AI (QA): {str(response_text)}",
                        ],
                        'suggestions': [],
                        'confidence_score': 0,
                        'explanation': msg,
                        'violated_rules': [],
                        'timestamp': datetime.now().isoformat(),
                    })

                with self.job_lock:
                    self.active_jobs[qa_id]['processed_rows'] = end
                    self.active_jobs[qa_id]['results'] = results
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
                    results.append({
                        'row_index': global_idx,
                        'row_data': filtered_row,
                        'is_correct': None,
                        'errors': [msg],
                        'suggestions': [],
                        'confidence_score': 0,
                        'explanation': msg,
                        'violated_rules': [],
                        'timestamp': datetime.now().isoformat(),
                    })
                    continue

                errors = item.get('errors') or []
                if not isinstance(errors, list):
                    errors = [str(errors)]
                suggestions = item.get('suggestions') or []
                if not isinstance(suggestions, list):
                    suggestions = [str(suggestions)]
                violated = item.get('violated_rules') or []
                if not isinstance(violated, list):
                    violated = [str(violated)]

                result = {
                    'row_index': global_idx,
                    'row_data': filtered_row,
                    'is_correct': item.get('is_correct'),
                    'errors': errors,
                    'suggestions': suggestions,
                    'confidence_score': item.get('confidence_score', 0),
                    'explanation': item.get('explanation') or '',
                    'violated_rules': violated,
                    'timestamp': datetime.now().isoformat(),
                }

                results.append(result)

            with self.job_lock:
                self.active_jobs[qa_id]['processed_rows'] = end
                self.active_jobs[qa_id]['results'] = results

            # Checkpoint sau mỗi batch thành công
            self._save_qa_result(qa_id)

        # Hoàn thành toàn bộ batch
        with self.job_lock:
            self.active_jobs[qa_id]['status'] = 'completed'
            self.active_jobs[qa_id]['end_time'] = datetime.now().isoformat()
            self.active_jobs[qa_id]['results'] = results

        self._save_qa_result(qa_id)
    
    def _parse_ai_response(self, response: str) -> Dict[str, Any]:
        """
        Parse response từ AI (JSON format)
        
        Args:
            response: Response text từ AI
            
        Returns:
            Dictionary đã parse
        """
        # Loại bỏ markdown code block nếu có
        response = response.strip()
        if response.startswith('```json'):
            response = response[7:]
        if response.startswith('```'):
            response = response[3:]
        if response.endswith('```'):
            response = response[:-3]

        response = response.strip()

        # Thử parse JSON trực tiếp trước
        try:
            return json.loads(response)
        except Exception:
            # Trường hợp model trả thêm text ngoài JSON hoặc bao ngoài nhiều lớp,
            # thử tìm khối JSON đầu tiên trong chuỗi và parse lại.
            start = response.find('{')
            end = response.rfind('}')
            if start != -1 and end != -1 and end > start:
                candidate = response[start:end + 1]
                try:
                    return json.loads(candidate)
                except Exception:
                    pass

            # Nếu vẫn không parse được thì ném exception để caller xử lý fallback
            raise
    
    def verify_qa(self,
                  qa_result: Dict[str, Any],
                  ai_instances: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Đối chiếu kết quả QA với 3 AI khác
        
        Args:
            qa_result: Kết quả QA ban đầu
            ai_instances: List 3 AI instances với prompt
            
        Returns:
            Dictionary chứa thông tin verification job
        """
        verification_id = self._generate_qa_id()
        
        # Khởi tạo job info
        job_info = {
            'verification_id': verification_id,
            'qa_id': qa_result['qa_id'],
            'status': 'processing',
            'start_time': datetime.now().isoformat(),
            'total_rows': len(qa_result['results']),
            'processed_rows': 0,
            'verification_results': []
        }
        
        # Lưu vào active jobs
        with self.job_lock:
            self.active_jobs[verification_id] = job_info
        
        # Xử lý trong thread riêng
        thread = threading.Thread(
            target=self._verify_qa_thread,
            args=(verification_id, qa_result, ai_instances)
        )
        thread.start()
        
        return {
            'verification_id': verification_id,
            'status': 'processing'
        }
    
    def _verify_qa_thread(self,
                         verification_id: str,
                         qa_result: Dict[str, Any],
                         ai_instances: List[Dict[str, Any]]):
        """
        Thread xử lý verification
        
        Args:
            verification_id: ID của verification job
            qa_result: Kết quả QA gốc
            ai_instances: List 3 AI instances
        """
        try:
            verification_results = []
            
            # Xử lý từng dòng kết quả
            for idx, original_result in enumerate(qa_result['results']):
                row_data = original_result['row_data']
                
                # Đối chiếu với 3 AI
                verifier_results = []
                
                for verifier_info in ai_instances:
                    ai = verifier_info['ai']
                    prompt_template = verifier_info['prompt']
                    
                    try:
                        # Tạo verification prompt
                        verify_prompt = self.prompt_generator.create_verification_prompt(
                            row_data,
                            original_result,
                            prompt_template
                        )
                        
                        # Gọi AI
                        response = ai.generate_response(verify_prompt)
                        
                        # Parse response
                        try:
                            result = self._parse_ai_response(response)
                        except Exception:
                            # Trường hợp verifier trả về text lỗi hoặc JSON không hợp lệ
                            result = {
                                'is_correct': None,
                                'errors': [
                                    f"Lỗi khi xử lý phản hồi từ verifier: {str(response)}"
                                ],
                                'suggestions': [],
                                'confidence_score': 0,
                                'explanation': 'Không parse được JSON từ phản hồi của verifier. Không thể kết luận đúng/sai cho dòng này.',
                                'violated_rules': []
                            }

                        # Đảm bảo cấu trúc errors / violated_rules tồn tại để downstream dùng thống nhất
                        if 'errors' not in result or not isinstance(result.get('errors'), list):
                            result['errors'] = []  # type: ignore
                        if 'violated_rules' not in result or not isinstance(result.get('violated_rules'), list):
                            result['violated_rules'] = []  # type: ignore

                        verifier_results.append(result)
                    
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
                            'unavailable'
                        ]
                        is_connection_error = any(kw in error_message_lower for kw in connection_keywords)

                        if is_connection_error:
                            user_friendly_error = (
                                f"Lỗi kết nối với AI trong verifier khi xử lý dòng QA: {error_message}"
                            )
                            explanation = (
                                'Không thể gọi model AI cho bước verifier (timeout/kết nối lỗi/quota...). '
                                'Verifier không đánh giá được dòng dữ liệu này nhưng toàn bộ job vẫn tiếp tục.'
                            )
                        else:
                            user_friendly_error = (
                                f"Lỗi hệ thống khi verifier xử lý dòng QA: {error_message}"
                            )
                            explanation = (
                                'Có lỗi hệ thống (exception) trong quá trình verifier xử lý dòng QA. '
                                'Không thể kết luận đúng/sai.'
                            )

                        verifier_results.append({
                            'is_correct': None,
                            'errors': [user_friendly_error],
                            'suggestions': [],
                            'confidence_score': 0,
                            'explanation': explanation,
                            'violated_rules': [],
                            'error': error_message
                        })
                
                # Tổng hợp kết quả
                verification_results.append({
                    'row_index': idx,
                    'original_result': original_result,
                    'verifier_results': verifier_results,
                    'consensus': self._calculate_consensus(original_result, verifier_results),
                    'timestamp': datetime.now().isoformat()
                })
                
                # Cập nhật progress
                with self.job_lock:
                    self.active_jobs[verification_id]['processed_rows'] = idx + 1
                    self.active_jobs[verification_id]['verification_results'] = verification_results
            
            # Hoàn thành
            with self.job_lock:
                self.active_jobs[verification_id]['status'] = 'completed'
                self.active_jobs[verification_id]['end_time'] = datetime.now().isoformat()
            
            # Lưu kết quả
            self._save_verification_result(verification_id)
        
        except Exception as e:
            with self.job_lock:
                self.active_jobs[verification_id]['status'] = 'failed'
                self.active_jobs[verification_id]['error'] = str(e)
                self.active_jobs[verification_id]['end_time'] = datetime.now().isoformat()
    
    def _calculate_consensus(self, 
                            original_result: Dict[str, Any],
                            verifier_results: List[Dict[str, Any]]) -> Dict[str, Any]:
        """
        Tính toán sự đồng thuận giữa các kết quả
        
        Args:
            original_result: Kết quả gốc
            verifier_results: Kết quả từ 3 verifiers
            
        Returns:
            Dictionary chứa thông tin consensus
        """
        # Đếm số lượng đồng ý/không đồng ý
        all_results = [original_result] + verifier_results
        
        correct_count = 0
        incorrect_count = 0
        
        for result in all_results:
            if 'is_correct' in result:
                if result['is_correct'] == True:
                    correct_count += 1
                elif result['is_correct'] == False:
                    incorrect_count += 1
        
        total = correct_count + incorrect_count
        
        return {
            'total_evaluations': total,
            'correct_count': correct_count,
            'incorrect_count': incorrect_count,
            'agreement_rate': correct_count / total if total > 0 else 0,
            'has_consensus': (correct_count >= 3 or incorrect_count >= 3)
        }
    
    def _save_qa_result(self, qa_id: str):
        """
        Lưu kết quả QA ra file
        
        Args:
            qa_id: ID của QA job
        """
        with self.job_lock:
            job_info = self.active_jobs[qa_id].copy()
        
        result_path = os.path.join(self.results_folder, f"qa_{qa_id}.json")
        with open(result_path, 'w', encoding='utf-8') as f:
            json.dump(job_info, f, ensure_ascii=False, indent=2)
    
    def _save_verification_result(self, verification_id: str):
        """
        Lưu kết quả verification ra file
        
        Args:
            verification_id: ID của verification job
        """
        with self.job_lock:
            job_info = self.active_jobs[verification_id].copy()
        
        result_path = os.path.join(self.results_folder, f"verification_{verification_id}.json")
        with open(result_path, 'w', encoding='utf-8') as f:
            json.dump(job_info, f, ensure_ascii=False, indent=2)
    
    def get_status(self, job_id: str) -> Dict[str, Any]:
        """
        Lấy trạng thái của job
        
        Args:
            job_id: ID của job (QA hoặc verification)
            
        Returns:
            Dictionary chứa trạng thái
        """
        with self.job_lock:
            if job_id in self.active_jobs:
                job_info = self.active_jobs[job_id].copy()
                return {
                    'status': job_info['status'],
                    'progress': {
                        'total': job_info.get('total_rows', 0),
                        'processed': job_info.get('processed_rows', 0)
                    }
                }
        
        # Tìm trong file đã lưu
        for prefix in ['qa_', 'verification_']:
            result_path = os.path.join(self.results_folder, f"{prefix}{job_id}.json")
            if os.path.exists(result_path):
                with open(result_path, 'r', encoding='utf-8') as f:
                    job_info = json.load(f)
                return {
                    'status': job_info['status'],
                    'progress': {
                        'total': job_info.get('total_rows', 0),
                        'processed': job_info.get('processed_rows', 0)
                    }
                }
        
        raise FileNotFoundError(f"Không tìm thấy job {job_id}")
    
    def get_qa_status(self, qa_id: str) -> Dict[str, Any]:
        """Wrapper cho endpoint QA status
        
        Args:
            qa_id: ID của QA job
        
        Returns:
            Trạng thái QA job
        """
        return self.get_status(qa_id)
    
    def get_qa_result(self, qa_id: str) -> Dict[str, Any]:
        """
        Lấy kết quả QA
        
        Args:
            qa_id: ID của QA job
            
        Returns:
            Dictionary chứa kết quả QA
        """
        # Kiểm tra trong active jobs
        with self.job_lock:
            if qa_id in self.active_jobs:
                return self.active_jobs[qa_id].copy()
        
        # Đọc từ file
        result_path = os.path.join(self.results_folder, f"qa_{qa_id}.json")
        if not os.path.exists(result_path):
            raise FileNotFoundError(f"Không tìm thấy kết quả QA {qa_id}")
        
        with open(result_path, 'r', encoding='utf-8') as f:
            return json.load(f)
    
    def get_complete_result(self, job_id: str) -> Dict[str, Any]:
        """
        Lấy kết quả hoàn chỉnh (QA + verification nếu có)
        
        Args:
            job_id: ID của job
            
        Returns:
            Dictionary chứa kết quả hoàn chỉnh
        """
        # Case 1: job_id là QA ID
        try:
            qa_result = self.get_qa_result(job_id)
            
            # Tìm verification result tương ứng (nếu có)
            verification_files = [f for f in os.listdir(self.results_folder) 
                                if f.startswith('verification_') and f.endswith('.json')]
            
            for vf in verification_files:
                vf_path = os.path.join(self.results_folder, vf)
                with open(vf_path, 'r', encoding='utf-8') as f:
                    v_result = json.load(f)
                    if v_result.get('qa_id') == job_id:
                        qa_result['verification'] = v_result
                        break
            
            return qa_result
        except Exception:
            pass

        # Case 2: job_id là verification ID
        verification_path = os.path.join(self.results_folder, f"verification_{job_id}.json")
        if os.path.exists(verification_path):
            with open(verification_path, 'r', encoding='utf-8') as f:
                v_result = json.load(f)

            qa_id = v_result.get('qa_id')
            if not qa_id:
                # Không có qa_id thì trả nguyên verification result
                return v_result

            try:
                qa_result = self.get_qa_result(qa_id)
                qa_result['verification'] = v_result
                return qa_result
            except Exception:
                # Fallback: nếu không đọc được QA gốc thì trả lại verification
                return v_result

        raise FileNotFoundError(f"Không tìm thấy kết quả {job_id}")
    
    def export_result(self, job_id: str, output_folder: str) -> str:
        """
        Export kết quả ra file Excel
        
        Args:
            job_id: ID của job
            output_folder: Thư mục output
            
        Returns:
            Đường dẫn đến file Excel
        """
        result = self.get_complete_result(job_id)
        
        # Chuẩn bị data cho Excel
        rows = []
        
        if 'results' in result:
            # QA result
            for r in result['results']:
                row = r.get('row_data', {}).copy()

                # Cột tổng hợp data_raw (JSON của toàn bộ row_data)
                try:
                    row['data_raw'] = json.dumps(r.get('row_data', {}), ensure_ascii=False)
                except Exception:
                    row['data_raw'] = str(r.get('row_data', {}))

                # Thông tin media cơ bản (nếu có)
                media = r.get('media') or {}
                if media:
                    row['Media_Filename'] = media.get('filename')
                    row['Media_Type'] = media.get('type')

                row['QA_IsCorrect'] = r.get('is_correct')
                row['QA_Errors'] = ', '.join(r.get('errors', []))
                row['QA_Suggestions'] = ', '.join(r.get('suggestions', []))
                row['QA_ConfidenceScore'] = r.get('confidence_score')
                row['QA_Explanation'] = r.get('explanation')
                rows.append(row)
        
        if 'verification' in result and 'verification_results' in result['verification']:
            # Thêm verification results
            for idx, vr in enumerate(result['verification']['verification_results']):
                if idx < len(rows):
                    consensus = vr.get('consensus', {})
                    rows[idx]['Verification_Consensus'] = consensus.get('has_consensus')
                    rows[idx]['Verification_AgreementRate'] = consensus.get('agreement_rate')
        
        # Tạo DataFrame và export
        df = pd.DataFrame(rows)
        output_path = os.path.join(output_folder, f"result_{job_id}.xlsx")
        df.to_excel(output_path, index=False)
        
        return output_path
    
    def list_all_projects(self) -> List[Dict[str, Any]]:
        """
        Liệt kê tất cả các project QA
        
        Returns:
            List các project
        """
        projects = []
        
        # Đọc tất cả file project
        project_files = [f for f in os.listdir(self.results_folder) 
                        if f.startswith('project_') and f.endswith('.json')]
        
        print(f"[DEBUG] Found {len(project_files)} project files: {project_files}", flush=True)
        
        for pf in project_files:
            pf_path = os.path.join(self.results_folder, pf)
            try:
                with open(pf_path, 'r', encoding='utf-8') as f:
                    project = json.load(f)

                # Suy ra status thực tế dựa trên kết quả job gần nhất (QA hoặc Labeling)
                project_type = project.get('project_type', 'qa')
                status = project.get('status', 'created')

                if project_type == 'qa':
                    last_qa_id = project.get('last_qa_id')
                    if last_qa_id:
                        qa_result_path = os.path.join(self.results_folder, f"qa_{last_qa_id}.json")
                        if os.path.exists(qa_result_path):
                            try:
                                with open(qa_result_path, 'r', encoding='utf-8') as rf:
                                    qa_job = json.load(rf)
                                status = qa_job.get('status', status)
                            except Exception:
                                pass
                elif project_type == 'labeling':
                    last_label_id = project.get('last_label_id')
                    if last_label_id:
                        label_result_path = os.path.join(self.results_folder, f"label_{last_label_id}.json")
                        if os.path.exists(label_result_path):
                            try:
                                with open(label_result_path, 'r', encoding='utf-8') as rf:
                                    label_job = json.load(rf)
                                status = label_job.get('status', status)
                            except Exception:
                                pass
                elif project_type == 'compare':
                    last_compare_id = project.get('last_compare_id')
                    if last_compare_id:
                        compare_result_path = os.path.join(self.results_folder, f"compare_{last_compare_id}.json")
                        if os.path.exists(compare_result_path):
                            try:
                                with open(compare_result_path, 'r', encoding='utf-8') as rf:
                                    compare_job = json.load(rf)
                                status = compare_job.get('status', status)
                            except Exception:
                                pass

                projects.append({
                    'project_id': project.get('project_id'),
                    'name': project.get('name'),
                    'description': project.get('description'),
                    'created_by': project.get('created_by'),
                    'created_at': project.get('created_at'),
                    'status': status,
                    'project_type': project_type,
                    'data_info': project.get('data_info'),
                    'guideline_info': project.get('guideline_info'),
                    'media_info': project.get('media_info'),
                    # Expose column_mapping / cấu hình để frontend có thể dùng lại làm preset
                    'column_mapping': project.get('column_mapping'),
                    'qa_config': project.get('qa_config'),
                    'label_config': project.get('label_config'),
                    'last_qa_id': project.get('last_qa_id'),
                    'last_label_id': project.get('last_label_id'),
                    'compare_config': project.get('compare_config'),
                    'last_compare_id': project.get('last_compare_id'),
                })
            except Exception as e:
                print(f"[ERROR] Failed to read project file {pf}: {str(e)}", flush=True)
        
        # Sắp xếp theo thời gian tạo (mới nhất trước)
        projects.sort(key=lambda x: x.get('created_at', ''), reverse=True)
        
        return projects
    
    def pause_qa(self, qa_id: str) -> Dict[str, Any]:
        """
        Tạm dừng QA process
        
        Args:
            qa_id: ID của QA job
            
        Returns:
            Status của pause operation
        """
        with self.job_lock:
            if qa_id not in self.active_jobs:
                raise ValueError(f"QA job {qa_id} không tồn tại")
            
            job = self.active_jobs[qa_id]
            if job['status'] != 'processing':
                raise ValueError(f"QA job {qa_id} không đang chạy (status: {job['status']})")
            
            # Set pause request flag
            job['pause_requested'] = True
            
        return {
            'success': True,
            'message': f'Đã gửi yêu cầu tạm dừng QA {qa_id}',
            'qa_id': qa_id
        }
    
    def resume_qa(self, qa_id: str) -> Dict[str, Any]:
        """
        Tiếp tục QA process đã tạm dừng
        
        Args:
            qa_id: ID của QA job
            
        Returns:
            Status của resume operation
        """
        with self.job_lock:
            if qa_id not in self.active_jobs:
                raise ValueError(f"QA job {qa_id} không tồn tại")
            
            job = self.active_jobs[qa_id]
            if job['status'] != 'paused':
                raise ValueError(f"QA job {qa_id} không đang tạm dừng (status: {job['status']})")
            
            # Clear pause flag
            job['paused'] = False
            
        return {
            'success': True,
            'message': f'Đã tiếp tục QA {qa_id}',
            'qa_id': qa_id
        }
    
    def get_partial_results(self, qa_id: str) -> Dict[str, Any]:
        """
        Lấy kết quả tạm thời của QA process
        
        Args:
            qa_id: ID của QA job
            
        Returns:
            Partial results với stats và recent results
        """
        with self.job_lock:
            if qa_id not in self.active_jobs:
                raise ValueError(f"QA job {qa_id} không tồn tại")
            
            job = self.active_jobs[qa_id]
            results = job['results']
            
            # Tính toán stats
            correct_count = sum(1 for r in results if r.get('is_correct') == True)
            incorrect_count = sum(1 for r in results if r.get('is_correct') == False)
            
            # Lấy 10 kết quả gần nhất
            recent_results = results[-10:] if len(results) > 10 else results
            
            return {
                'qa_id': qa_id,
                'status': job['status'],
                'processed': job['processed_rows'],
                'total': job['total_rows'],
                'summary': {
                    'correct': correct_count,
                    'incorrect': incorrect_count,
                    'total_processed': len(results)
                },
                'recent_results': [
                    {
                        'row_index': r.get('row_index', i),
                        'is_correct': r.get('is_correct'),
                        'explanation': r.get('explanation', ''),
                        'confidence_score': r.get('confidence_score', 0)
                    }
                    for i, r in enumerate(recent_results)
                ]
            }
    
    def create_project(self, project_data: Dict[str, Any]) -> Dict[str, Any]:
        """
        Tạo project mới với metadata
        
        Args:
            project_data: Thông tin project
            
        Returns:
            Project info với project_id
        """
        project_id = self._generate_project_id()
        
        # Tạo project info
        project_info = {
            'project_id': project_id,
            'name': project_data['name'],
            'description': project_data.get('description', ''),
            'created_by': project_data.get('created_by', 'Anonymous'),
            'created_at': project_data.get('created_at', datetime.now().isoformat()),
            'project_type': project_data.get('project_type', 'qa'),
            'data_info': project_data['data_info'],
            'guideline_info': project_data.get('guideline_info'),
            'media_info': project_data.get('media_info'),
            # Trạng thái tổng quan của project (create/processing/completed...)
            'status': 'created',
            # Lưu lịch sử QA/Label/Compare (tùy theo project_type sẽ dùng trường tương ứng)
            'qa_sessions': [],
            # LABELING sessions sẽ được attach sau nếu là project_type = 'labeling'
            'label_sessions': project_data.get('label_sessions') or [],
            # Cấu hình Compare (nếu là project_type = 'compare') để có thể reuse cấu hình cột, dataset...
            'compare_config': project_data.get('compare_config'),
        }
        
        # Tạo thư mục results nếu chưa có
        os.makedirs(self.results_folder, exist_ok=True)
        
        # Lưu vào file
        project_file = os.path.join(self.results_folder, f"project_{project_id}.json")
        print(f"[DEBUG] Saving project to: {project_file}", flush=True)
        
        with open(project_file, 'w', encoding='utf-8') as f:
            json.dump(project_info, f, ensure_ascii=False, indent=2)
        
        print(f"[DEBUG] Project saved successfully: {project_id}", flush=True)
        
        return {
            'project_id': project_id,
            'status': 'created'
        }
    
    def attach_qa_to_project(self,
                             project_id: str,
                             qa_id: str,
                             column_mapping: Dict[str, Any],
                             qa_config: Dict[str, Any]) -> Dict[str, Any]:
        """Gắn thông tin QA session vào project hiện có
        
        Args:
            project_id: ID của project
            qa_id: ID của QA job
            column_mapping: Cấu hình mapping các cột
            qa_config: Cấu hình QA (không nên chứa API key)
        
        Returns:
            Project info sau khi cập nhật
        """
        project_file = os.path.join(self.results_folder, f"project_{project_id}.json")
        if not os.path.exists(project_file):
            raise ValueError(f"Project {project_id} không tồn tại")
        
        # Đọc project hiện tại
        with open(project_file, 'r', encoding='utf-8') as f:
            project = json.load(f)
        
        # Loại bỏ API key nếu lỡ được truyền vào
        safe_qa_config = {}
        if qa_config:
            for k, v in qa_config.items():
                if k.lower() not in ['apikey', 'api_key', 'api-key', 'key']:
                    safe_qa_config[k] = v
        
        # Cập nhật thông tin QA
        project['column_mapping'] = column_mapping or {}
        project['qa_config'] = safe_qa_config
        
        # Cập nhật danh sách QA sessions
        qa_sessions = project.get('qa_sessions') or []
        qa_sessions.append({
            'qa_id': qa_id,
            'started_at': datetime.now().isoformat(),
            'status': 'processing'
        })
        project['qa_sessions'] = qa_sessions
        project['last_qa_id'] = qa_id
        project['status'] = 'processing'
        
        # Ghi lại file
        with open(project_file, 'w', encoding='utf-8') as f:
            json.dump(project, f, ensure_ascii=False, indent=2)
        
        print(f"[DEBUG] Attached QA {qa_id} to project {project_id}", flush=True)
        return project

    def attach_label_to_project(self,
                                project_id: str,
                                label_id: str,
                                column_mapping: Dict[str, Any],
                                label_config: Dict[str, Any]) -> Dict[str, Any]:
        """Gắn thông tin LABELING session vào project Xử lý data.

        Args:
            project_id: ID của project
            label_id: ID của label job
            column_mapping: Cấu hình mapping các cột dùng cho labeling
            label_config: Cấu hình labeling (không chứa API key)
        """
        project_file = os.path.join(self.results_folder, f"project_{project_id}.json")
        if not os.path.exists(project_file):
            raise ValueError(f"Project {project_id} không tồn tại")

        with open(project_file, 'r', encoding='utf-8') as f:
            project = json.load(f)

        # Loại bỏ API key nếu lỡ được truyền vào
        safe_label_config: Dict[str, Any] = {}
        if label_config:
            for k, v in label_config.items():
                if k.lower() not in ['apikey', 'api_key', 'api-key', 'key']:
                    safe_label_config[k] = v

        # Cập nhật thông tin labeling
        project['column_mapping'] = column_mapping or project.get('column_mapping') or {}
        project['label_config'] = safe_label_config

        label_sessions = project.get('label_sessions') or []
        label_sessions.append({
            'label_id': label_id,
            'started_at': datetime.now().isoformat(),
            'status': 'processing'
        })
        project['label_sessions'] = label_sessions
        project['last_label_id'] = label_id

        # Với project_type = 'labeling', status phản ánh trạng thái labeling
        project['status'] = 'processing'

        with open(project_file, 'w', encoding='utf-8') as f:
            json.dump(project, f, ensure_ascii=False, indent=2)

        print(f"[DEBUG] Attached LABEL {label_id} to project {project_id}", flush=True)
        return project

    def attach_compare_to_project(self,
                                  project_id: str,
                                  compare_id: str,
                                  compare_config: Dict[str, Any]) -> Dict[str, Any]:
        """Gắn thông tin Compare session vào project (project_type = 'compare').

        Args:
            project_id: ID của project
            compare_id: ID của compare job
            compare_config: Cấu hình compare (datasets, id_column, compare_columns, ...)

        Returns:
            Project info sau khi cập nhật
        """
        project_file = os.path.join(self.results_folder, f"project_{project_id}.json")
        if not os.path.exists(project_file):
            raise ValueError(f"Project {project_id} không tồn tại")

        with open(project_file, 'r', encoding='utf-8') as f:
            project = json.load(f)

        # Cập nhật cấu hình compare (không có API key nên không cần lọc thêm)
        project['compare_config'] = compare_config or project.get('compare_config') or {}

        # Cập nhật danh sách compare sessions
        compare_sessions = project.get('compare_sessions') or []
        compare_sessions.append({
            'compare_id': compare_id,
            'started_at': datetime.now().isoformat(),
            'status': 'processing'
        })
        project['compare_sessions'] = compare_sessions
        project['last_compare_id'] = compare_id

        # Với project_type = 'compare', status phản ánh trạng thái compare
        project['status'] = 'processing'

        with open(project_file, 'w', encoding='utf-8') as f:
            json.dump(project, f, ensure_ascii=False, indent=2)

        print(f"[DEBUG] Attached COMPARE {compare_id} to project {project_id}", flush=True)
        return project
    
    def get_project(self, project_id: str) -> Dict[str, Any]:
        """
        Lấy thông tin chi tiết project
        
        Args:
            project_id: ID của project
            
        Returns:
            Project info
        """
        project_file = os.path.join(self.results_folder, f"project_{project_id}.json")
        if not os.path.exists(project_file):
            raise ValueError(f"Project {project_id} không tồn tại")
        
        with open(project_file, 'r', encoding='utf-8') as f:
            return json.load(f)
    
    def delete_project(self, project_id: str) -> Dict[str, Any]:
        """
        Xóa project
        
        Args:
            project_id: ID của project
            
        Returns:
            Result của delete operation
        """
        project_file = os.path.join(self.results_folder, f"project_{project_id}.json")
        if not os.path.exists(project_file):
            raise ValueError(f"Project {project_id} không tồn tại")
        
        # Xóa file project
        os.remove(project_file)
        print(f"[DEBUG] Deleted project file: {project_file}", flush=True)
        
        return {
            'project_id': project_id,
            'status': 'deleted'
        }
    
    def _generate_project_id(self) -> str:
        """
        Tạo project ID unique
        """
        return f"proj_{int(time.time())}_{uuid.uuid4().hex[:8]}"
