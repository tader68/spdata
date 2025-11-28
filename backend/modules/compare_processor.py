import os
import json
import uuid
from datetime import datetime
from typing import Dict, List, Any

import pandas as pd
import threading


class CompareProcessor:
    """Xử lý job so sánh/kiểm tra nhiều file data (1–5 file) theo cột ID và các cột cần so sánh."""

    def __init__(self) -> None:
        self.results_folder = "results"
        os.makedirs(self.results_folder, exist_ok=True)

        self.active_jobs: Dict[str, Dict[str, Any]] = {}
        self.job_lock = threading.Lock()

    def _generate_compare_id(self) -> str:
        return str(uuid.uuid4())

    def start_compare(self, compare_data: Dict[str, Any]) -> Dict[str, Any]:
        """Khởi tạo job so sánh và chạy trong thread nền.

        compare_data mong đợi các key:
        - datasets: List[{data_id, label, rows, metadata}]
        - column_mapping: Dict[str, Any]
        - id_column: str
        - compare_columns: List[str]
        - reference_index: int
        """
        compare_id = self._generate_compare_id()

        datasets = compare_data.get("datasets") or []
        id_column = compare_data.get("id_column")
        compare_columns = compare_data.get("compare_columns") or []
        reference_index = int(compare_data.get("reference_index", 0) or 0)
        guideline_id = compare_data.get("guideline_id")
        media_batch_id = compare_data.get("media_batch_id")
        media_column = compare_data.get("media_column")
        media_files = compare_data.get("media_files")

        job_info: Dict[str, Any] = {
            "compare_id": compare_id,
            "status": "processing",
            "start_time": datetime.now().isoformat(),
            "end_time": None,
            "total_rows": 0,
            "processed_rows": 0,
            "results": [],
            "datasets_info": [],
            "id_column": id_column,
            "compare_columns": compare_columns,
            "reference_index": reference_index,
            "summary": None,
            "guideline_id": guideline_id,
            "media_batch_id": media_batch_id,
            "media_column": media_column,
            "has_media": bool(media_files),
            "media_files": media_files,
        }

        for idx, ds in enumerate(datasets):
            rows = ds.get("rows") or []
            job_info["datasets_info"].append(
                {
                    "index": idx,
                    "data_id": ds.get("data_id"),
                    "label": ds.get("label") or f"File {idx + 1}",
                    "rows": len(rows),
                }
            )

        with self.job_lock:
            self.active_jobs[compare_id] = job_info

        thread = threading.Thread(
            target=self._process_compare_thread,
            args=(compare_id, compare_data),
            daemon=True,
        )
        thread.start()

        return {"compare_id": compare_id, "status": "processing"}

    def _process_compare_thread(self, compare_id: str, compare_data: Dict[str, Any]) -> None:
        try:
            datasets = compare_data.get("datasets") or []
            id_column = compare_data.get("id_column")
            compare_columns: List[str] = compare_data.get("compare_columns") or []
            reference_index = int(compare_data.get("reference_index", 0) or 0)
            media_column = compare_data.get("media_column")
            media_files = compare_data.get("media_files") or None
            media_batch_id = compare_data.get("media_batch_id")

            media_index = self._build_media_index(media_files) if media_files else None

            # Xây index ID -> row cho từng dataset
            id_indexes: List[Dict[Any, Dict[str, Any]]] = []
            for ds in datasets:
                rows = ds.get("rows") or []
                index: Dict[Any, Dict[str, Any]] = {}
                for row in rows:
                    if not isinstance(row, dict):
                        continue
                    key = row.get(id_column)
                    if key is None:
                        continue
                    if key not in index:
                        index[key] = row
                id_indexes.append(index)

            # Tập hợp tất cả ID
            all_ids = set()
            for idx_map in id_indexes:
                all_ids.update(idx_map.keys())
            all_ids = sorted(all_ids, key=lambda x: str(x))

            total_rows = len(all_ids)
            with self.job_lock:
                job = self.active_jobs.get(compare_id)
                if job:
                    job["total_rows"] = total_rows

            def _normalize(v: Any) -> Any:
                if v is None:
                    return None
                if isinstance(v, str):
                    return v.strip()
                try:
                    return str(v).strip()
                except Exception:
                    return str(v)

            summary_by_col: Dict[str, Dict[str, Any]] = {}
            for col in compare_columns:
                summary_by_col[col] = {
                    "total_rows": 0,
                    "same_count": 0,
                    "diff_count": 0,
                    # Số dòng không all_equal nhưng có ít nhất một nhóm >=2 giá trị giống nhau
                    "partial_equal_rows": 0,
                    # Số dòng mà tất cả giá trị đều khác nhau (không có nhóm >=2)
                    "all_diff_rows": 0,
                    "same_rate": 0.0,
                    "partial_rate": 0.0,
                    "all_diff_rate": 0.0,
                }

            rows_all_same = 0
            rows_any_diff = 0
            results: List[Dict[str, Any]] = []

            for idx, id_value in enumerate(all_ids):
                row_datas: List[Dict[str, Any]] = []
                per_file_rows: List[Dict[str, Any]] = []

                for ds_idx, ds in enumerate(datasets):
                    row_data = id_indexes[ds_idx].get(id_value)
                    row_datas.append(row_data)
                    per_file_rows.append(
                        {
                            "data_id": ds.get("data_id"),
                            "row_data": row_data,
                        }
                    )

                row_compare_columns: Dict[str, Any] = {}
                final_values: Dict[str, Any] = {}
                has_diff_any_col = False

                for col in compare_columns:
                    values: List[Any] = []
                    norm_values: List[Any] = []
                    for row_data in row_datas:
                        if row_data is None:
                            values.append(None)
                            norm_values.append(None)
                        else:
                            v = row_data.get(col)
                            values.append(v)
                            norm_values.append(_normalize(v))

                    distinct_norm = {nv for nv in norm_values}
                    all_equal = len(distinct_norm) <= 1

                    # Thống kê pattern theo nhóm giá trị để phân biệt "2 giống nhau" vs "tất cả khác"
                    value_counts: Dict[Any, int] = {}
                    for nv in norm_values:
                        value_counts[nv] = value_counts.get(nv, 0) + 1
                    max_group_size = max(value_counts.values()) if value_counts else 0
                    all_diff = max_group_size <= 1

                    if 0 <= reference_index < len(values):
                        ref_norm = norm_values[reference_index]
                    else:
                        ref_norm = None

                    different_from_ref: List[bool] = []
                    for nv in norm_values:
                        if ref_norm is None and nv is None:
                            different_from_ref.append(False)
                        else:
                            different_from_ref.append(nv != ref_norm)

                    col_info = {
                        "values": values,
                        "all_equal": all_equal,
                        "different_from_ref": different_from_ref,
                    }
                    row_compare_columns[col] = col_info

                    if 0 <= reference_index < len(values):
                        final_values[col] = values[reference_index]
                    else:
                        final_values[col] = None

                    col_summary = summary_by_col.get(col)
                    if col_summary is not None:
                        col_summary["total_rows"] += 1
                        if all_equal:
                            col_summary["same_count"] += 1
                        else:
                            col_summary["diff_count"] += 1
                            has_diff_any_col = True

                            # Phân loại chi tiết dòng khác nhau theo pattern
                            if all_diff:
                                col_summary["all_diff_rows"] += 1
                            elif max_group_size >= 2:
                                # Có ít nhất một nhóm >=2 giá trị giống nhau nhưng không phải tất cả
                                col_summary["partial_equal_rows"] += 1

                row_all_equal = not has_diff_any_col
                if row_all_equal:
                    rows_all_same += 1
                else:
                    rows_any_diff += 1

                media_info = None
                if media_index and media_column:
                    media_info = self._get_media_for_row(
                        row_datas=row_datas,
                        media_column=media_column,
                        media_index=media_index,
                        media_batch_id=media_batch_id,
                    )

                result_item = {
                    "row_index": idx,
                    "id_value": id_value,
                    "rows": per_file_rows,
                    "compare": {
                        "equal": row_all_equal,
                        "columns": row_compare_columns,
                    },
                    "final_values": final_values,
                    "media": media_info,
                }
                results.append(result_item)

                with self.job_lock:
                    job = self.active_jobs.get(compare_id)
                    if job:
                        job["processed_rows"] = idx + 1
                        job["results"] = results

            # Tính toán summary
            for col, info in summary_by_col.items():
                total = info.get("total_rows", 0) or 0
                same = info.get("same_count", 0) or 0
                partial = info.get("partial_equal_rows", 0) or 0
                all_diff_rows = info.get("all_diff_rows", 0) or 0
                if total > 0:
                    info["same_rate"] = same / total
                    info["partial_rate"] = partial / total
                    info["all_diff_rate"] = all_diff_rows / total
                else:
                    info["same_rate"] = 0.0
                    info["partial_rate"] = 0.0
                    info["all_diff_rate"] = 0.0

            summary = {
                "overall": {
                    "total_rows": total_rows,
                    "rows_all_same": rows_all_same,
                    "rows_any_diff": rows_any_diff,
                },
                "columns": summary_by_col,
            }

            with self.job_lock:
                job = self.active_jobs.get(compare_id)
                if job:
                    job["status"] = "completed"
                    job["end_time"] = datetime.now().isoformat()
                    job["total_rows"] = total_rows
                    job["processed_rows"] = total_rows
                    job["results"] = results
                    job["summary"] = summary

            self._save_compare_result(compare_id)

        except Exception as e:
            with self.job_lock:
                job = self.active_jobs.get(compare_id)
                if job:
                    job["status"] = "failed"
                    job["error"] = str(e)
                    job["end_time"] = datetime.now().isoformat()

    def _build_media_index(self, media_files: Dict[str, Any]) -> Dict[str, Dict[str, Any]]:
        """Tạo index media theo tên file (không extension, lowercase) để mapping nhanh.

        Args:
            media_files: Dict chứa 'files' với danh sách media

        Returns:
            Dict: key là tên file chuẩn hóa, value là media_file tương ứng
        """
        index: Dict[str, Dict[str, Any]] = {}
        if not media_files or "files" not in media_files:
            return index

        for mf in media_files["files"]:
            filename = mf.get("filename") or ""
            base = os.path.splitext(os.path.basename(filename))[0].lower()
            if not base:
                continue

            # Key gốc: full basename
            if base not in index:
                index[base] = mf

            # Một số prefix phổ biến cần bỏ đi để khớp với cột media trong data
            # Ví dụ: file lưu là "cropped_faces_pic_0005_face046.jpg" nhưng data chỉ có "pic_0005_face046.jpg"
            prefix_candidates = ("image_", "img_", "cropped_faces_", "crop_", "cropped_")
            for prefix in prefix_candidates:
                if base.startswith(prefix):
                    short = base[len(prefix) :]
                    if short and short not in index:
                        index[short] = mf

            # Thêm key theo suffix sau dấu '_' cuối cùng (ví dụ: '..._0005' hoặc '..._face046')
            if "_" in base:
                suffix = base.split("_")[-1]
                if suffix and suffix not in index:
                    index[suffix] = mf

        return index

    def _get_media_for_row(
        self,
        row_datas: List[Dict[str, Any]],
        media_column: str,
        media_index: Dict[str, Dict[str, Any]],
        media_batch_id: str,
    ) -> Dict[str, Any]:
        """Lấy thông tin media cho dòng compare dựa trên cột media_column.

        Rule đơn giản:
        - Duyệt từng dataset row, lấy giá trị tại media_column nếu có.
        - Chuẩn hóa về basename không extension, lowercase.
        - Map với media_index; trả về media đầu tiên tìm được.
        """
        if not media_index or not media_column or not media_batch_id:
            return None

        for ds_idx, row_data in enumerate(row_datas):
            if not isinstance(row_data, dict):
                continue

            value = row_data.get(media_column)
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

            if not value.strip():
                continue

            val = value.strip()
            base = os.path.splitext(os.path.basename(val))[0].lower()
            if not base:
                continue

            mf = media_index.get(base)
            if mf:
                filename = mf.get("filename") or os.path.basename(mf.get("path") or "")
                mtype = mf.get("type") or "unknown"
                if not filename:
                    continue
                return {
                    "batch_id": media_batch_id,
                    "filename": filename,
                    "type": mtype,
                    "dataset_index": ds_idx,
                }

        return None

    def _save_compare_result(self, compare_id: str) -> None:
        with self.job_lock:
            job_info = self.active_jobs.get(compare_id, {}).copy()

        if not job_info:
            return

        result_path = os.path.join(self.results_folder, f"compare_{compare_id}.json")
        with open(result_path, "w", encoding="utf-8") as f:
            json.dump(job_info, f, ensure_ascii=False, indent=2)

    def get_compare_status(self, compare_id: str) -> Dict[str, Any]:
        with self.job_lock:
            if compare_id in self.active_jobs:
                job_info = self.active_jobs[compare_id].copy()
                return {
                    "status": job_info.get("status"),
                    "progress": {
                        "total": job_info.get("total_rows", 0),
                        "processed": job_info.get("processed_rows", 0),
                    },
                    "summary": job_info.get("summary"),
                }

        result_path = os.path.join(self.results_folder, f"compare_{compare_id}.json")
        if os.path.exists(result_path):
            with open(result_path, "r", encoding="utf-8") as f:
                job_info = json.load(f)
            return {
                "status": job_info.get("status"),
                "progress": {
                    "total": job_info.get("total_rows", 0),
                    "processed": job_info.get("processed_rows", 0),
                },
                "summary": job_info.get("summary"),
            }

        raise FileNotFoundError(f"Không tìm thấy job so sánh {compare_id}")

    def get_compare_result(self, compare_id: str) -> Dict[str, Any]:
        with self.job_lock:
            if compare_id in self.active_jobs:
                return self.active_jobs[compare_id].copy()

        result_path = os.path.join(self.results_folder, f"compare_{compare_id}.json")
        if not os.path.exists(result_path):
            raise FileNotFoundError(f"Không tìm thấy kết quả so sánh {compare_id}")

        with open(result_path, "r", encoding="utf-8") as f:
            return json.load(f)

    def export_result(
        self,
        compare_id: str,
        output_folder: str,
        overrides_rows: List[Dict[str, Any]] = None,
    ) -> str:
        """Export kết quả so sánh ra Excel.

        - Mỗi dòng ứng với một ID.
        - Với mỗi cột được so sánh, thêm giá trị của từng file và giá trị final.
        - Cho phép FE override final_values cho từng (id_value, column).
        """
        result = self.get_compare_result(compare_id)

        # Chuẩn bị map overrides: id_value -> {col: final_value}
        override_map: Dict[Any, Dict[str, Any]] = {}
        if overrides_rows:
            for row in overrides_rows:
                if not isinstance(row, dict):
                    continue
                row_id = row.get("id_value")
                final_vals = row.get("final_values") or {}
                if row_id is None or not isinstance(final_vals, dict):
                    continue
                override_map[row_id] = final_vals

        id_column = result.get("id_column") or "ID"
        compare_columns: List[str] = result.get("compare_columns") or []
        datasets_info: List[Dict[str, Any]] = result.get("datasets_info") or []
        rows_data: List[Dict[str, Any]] = []

        for item in result.get("results", []):
            out_row: Dict[str, Any] = {}
            id_value = item.get("id_value")
            out_row[id_column] = id_value

            per_file = item.get("rows") or []
            base_final_values = item.get("final_values") or {}

            # Áp dụng overrides nếu có
            final_values = dict(base_final_values)
            if id_value in override_map:
                for col, val in override_map[id_value].items():
                    final_values[col] = val

            for ds in datasets_info:
                idx = ds.get("index")
                label = ds.get("label") or f"File {idx + 1}"
                prefix = f"{label}".replace(" ", "_")

                if idx is None or idx >= len(per_file):
                    continue

                row_data = per_file[idx].get("row_data") if per_file[idx] else None
                if not isinstance(row_data, dict):
                    continue

                for col in compare_columns:
                    key = f"{prefix}_{col}"
                    out_row[key] = row_data.get(col)

            for col in compare_columns:
                key = f"Final_{col}"
                out_row[key] = final_values.get(col)

            rows_data.append(out_row)

        df = pd.DataFrame(rows_data)
        os.makedirs(output_folder, exist_ok=True)
        output_path = os.path.join(output_folder, f"compare_result_{compare_id}.xlsx")
        df.to_excel(output_path, index=False)
        return output_path
