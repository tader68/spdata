import os
import json
import uuid
from datetime import datetime
from typing import Any, Dict, List, Optional


class AICardManager:
    """Quản lý các dataset AI Card (xem/duyệt ảnh từ Excel).

    Lưu trữ theo dạng file JSON trong thư mục results, tương tự QA/Projects:
    - results/aicard_projects.json: index các dataset AI Card
    - results/aicard_project_<project_id>_cards.json: danh sách card (theo dòng)
    """

    def __init__(self, results_folder: str = "results") -> None:
        self.results_folder = results_folder
        os.makedirs(self.results_folder, exist_ok=True)
        self.index_file = os.path.join(self.results_folder, "aicard_projects.json")
        # Khởi tạo file index nếu chưa có
        if not os.path.exists(self.index_file):
            with open(self.index_file, "w", encoding="utf-8") as f:
                json.dump({"projects": []}, f, ensure_ascii=False, indent=2)

    # -------------------- helpers --------------------
    def _load_index(self) -> Dict[str, Any]:
        try:
            with open(self.index_file, "r", encoding="utf-8") as f:
                data = json.load(f)
            if not isinstance(data, dict):
                data = {"projects": []}
            if "projects" not in data or not isinstance(data["projects"], list):
                data["projects"] = []
            return data
        except Exception:
            return {"projects": []}

    def _save_index(self, data: Dict[str, Any]) -> None:
        tmp_path = self.index_file + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump(data, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, self.index_file)

    def _generate_project_id(self) -> str:
        return f"aicard_{uuid.uuid4().hex[:8]}"

    def _cards_file_path(self, project_id: str) -> str:
        return os.path.join(self.results_folder, f"aicard_project_{project_id}_cards.json")

    # -------------------- public APIs --------------------
    def create_project(self, project_data: Dict[str, Any], rows: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Tạo dataset AI Card mới từ list dòng dữ liệu.

        Args:
            project_data: thông tin meta (name, description, source_data_id, image_column, ...)
            rows: list các dòng đọc từ Excel (list[dict])
        """
        project_id = self._generate_project_id()

        name = project_data.get("name") or f"AI Card {project_id}"
        description = project_data.get("description") or ""
        created_by = project_data.get("created_by") or "Anonymous"
        created_at = project_data.get("created_at") or datetime.utcnow().isoformat()
        source_data_id = project_data.get("source_data_id")
        image_column = project_data.get("image_column") or "Files"
        id_column = project_data.get("id_column")  # optional
        attributes_columns: List[str] = project_data.get("attributes_columns") or []
        all_columns: List[str] = project_data.get("columns") or []

        total_rows = len(rows or [])

        # Cập nhật index
        index_data = self._load_index()
        projects = index_data.get("projects", [])

        project_info: Dict[str, Any] = {
            "id": project_id,
            "name": name,
            "description": description,
            "created_by": created_by,
            "created_at": created_at,
            "source_data_id": source_data_id,
            "image_column": image_column,
            "id_column": id_column,
            "attributes_columns": attributes_columns,
            "columns": all_columns,
            "total_rows": total_rows,
        }

        projects.append(project_info)
        index_data["projects"] = projects
        self._save_index(index_data)

        # Build cards file
        cards: List[Dict[str, Any]] = []
        for idx, row in enumerate(rows or []):
            if not isinstance(row, dict):
                continue
            id_value = row.get(id_column) if id_column else idx

            raw_image = row.get(image_column)
            if isinstance(raw_image, str):
                image_url = raw_image.strip()
            else:
                image_url = raw_image

            attrs: Dict[str, Any] = {}
            for col in attributes_columns:
                attrs[col] = row.get(col)

            cards.append(
                {
                    "row_id": idx,
                    "id_value": id_value,
                    "image_url": image_url,
                    "attributes": attrs,
                    "tags": {
                        # V1: chỉ một tag chính để chọn mẫu training
                        "selected_for_training": False,
                    },
                }
            )

        cards_path = self._cards_file_path(project_id)
        with open(cards_path, "w", encoding="utf-8") as f:
            json.dump({"project_id": project_id, "cards": cards}, f, ensure_ascii=False, indent=2)

        try:
            print(
                f"[AICard] Created project {project_id} with {len(cards)} cards; "
                f"image_column={image_column}; attributes_columns={attributes_columns}",
                flush=True,
            )
        except Exception:
            pass

        return project_info

    def list_projects(self) -> List[Dict[str, Any]]:
        data = self._load_index()
        return data.get("projects", [])

    def get_project(self, project_id: str) -> Dict[str, Any]:
        data = self._load_index()
        for p in data.get("projects", []):
            if p.get("id") == project_id:
                return p
        raise ValueError(f"AI Card project {project_id} không tồn tại")

    def delete_project(self, project_id: str) -> Dict[str, Any]:
        """Xóa một AI Card project khỏi index và xóa luôn file cards."""
        data = self._load_index()
        projects = data.get("projects", [])

        new_projects = [p for p in projects if p.get("id") != project_id]
        if len(new_projects) == len(projects):
            raise ValueError(f"AI Card project {project_id} không tồn tại")

        data["projects"] = new_projects
        self._save_index(data)

        cards_path = self._cards_file_path(project_id)
        removed_cards = False
        if os.path.exists(cards_path):
            try:
                os.remove(cards_path)
                removed_cards = True
            except Exception:
                # Không để lỗi xóa file làm hỏng request xóa project
                pass

        try:
            print(
                f"[AICard] Deleted project {project_id}; removed_cards={removed_cards}",
                flush=True,
            )
        except Exception:
            pass

        return {"project_id": project_id, "removed_cards": removed_cards}

    def _load_cards(self, project_id: str) -> List[Dict[str, Any]]:
        path = self._cards_file_path(project_id)
        if not os.path.exists(path):
            raise FileNotFoundError(f"Không tìm thấy cards cho AI Card project {project_id}")
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        cards = data.get("cards")
        if not isinstance(cards, list):
            return []
        return cards

    def _save_cards(self, project_id: str, cards: List[Dict[str, Any]]) -> None:
        path = self._cards_file_path(project_id)
        tmp_path = path + ".tmp"
        with open(tmp_path, "w", encoding="utf-8") as f:
            json.dump({"project_id": project_id, "cards": cards}, f, ensure_ascii=False, indent=2)
        os.replace(tmp_path, path)

    def _apply_filters(
        self,
        cards: List[Dict[str, Any]],
        search: Optional[str] = None,
        selected_filter: str = "all",
        attr_key: Optional[str] = None,
        attr_value: Optional[str] = None,
        primary_attr_key: Optional[str] = None,
        primary_attr_value: Optional[str] = None,
    ) -> List[Dict[str, Any]]:
        """Áp dụng các bộ lọc search/selected/thuộc tính (bao gồm cả primary) lên danh sách cards."""

        search_norm = (search or "").strip().lower()
        if search_norm:
            def _match(card: Dict[str, Any]) -> bool:
                id_val = card.get("id_value")
                if id_val is not None and search_norm in str(id_val).lower():
                    return True
                attrs = card.get("attributes") or {}
                for v in attrs.values():
                    if v is not None and search_norm in str(v).lower():
                        return True
                return False

            cards = [c for c in cards if _match(c)]

        if selected_filter in ("selected", "not_selected"):
            want = selected_filter == "selected"

            def _sel(card: Dict[str, Any]) -> bool:
                tags = card.get("tags") or {}
                return bool(tags.get("selected_for_training")) == want

            cards = [c for c in cards if _sel(c)]

        def _apply_attr_filter(
            items: List[Dict[str, Any]],
            key: Optional[str],
            value: Optional[str],
        ) -> List[Dict[str, Any]]:
            attr_key_norm = (key or "").strip()
            attr_value_norm = (value or "").strip().lower()
            if not attr_key_norm or not attr_value_norm:
                return items

            key_lower = attr_key_norm.lower()

            def _attr_match(card: Dict[str, Any]) -> bool:
                attrs = card.get("attributes") or {}
                if not isinstance(attrs, dict):
                    return False

                value_inner = None
                if attr_key_norm in attrs:
                    value_inner = attrs.get(attr_key_norm)
                else:
                    for k, v in attrs.items():
                        if str(k).lower() == key_lower:
                            value_inner = v
                            break

                if value_inner is None:
                    return False
                try:
                    return attr_value_norm in str(value_inner).lower()
                except Exception:
                    return False

            return [c for c in items if _attr_match(c)]

        # Áp dụng primary filter trước, sau đó tới attr filter thông thường
        cards = _apply_attr_filter(cards, primary_attr_key, primary_attr_value)
        cards = _apply_attr_filter(cards, attr_key, attr_value)

        return cards

    def get_cards(
        self,
        project_id: str,
        page: int = 1,
        page_size: int = 50,
        search: Optional[str] = None,
        selected_filter: str = "all",  # 'all' | 'selected' | 'not_selected'
        attr_key: Optional[str] = None,
        attr_value: Optional[str] = None,
        primary_attr_key: Optional[str] = None,
        primary_attr_value: Optional[str] = None,
    ) -> Dict[str, Any]:
        cards = self._load_cards(project_id)
        cards = self._apply_filters(
            cards,
            search=search,
            selected_filter=selected_filter,
            attr_key=attr_key,
            attr_value=attr_value,
            primary_attr_key=primary_attr_key,
            primary_attr_value=primary_attr_value,
        )

        total = len(cards)
        if page < 1:
            page = 1
        if page_size < 1:
            page_size = 50

        start = (page - 1) * page_size
        end = start + page_size
        page_items = cards[start:end]

        return {
            "project_id": project_id,
            "total": total,
            "page": page,
            "page_size": page_size,
            "cards": page_items,
        }

    def update_cards_tags(self, project_id: str, updates: List[Dict[str, Any]]) -> Dict[str, Any]:
        """Cập nhật tags cho nhiều card theo row_id.

        updates: List[{ "row_id": int, "tags": { ... } }]
        """
        if not updates:
            return {"project_id": project_id, "updated": 0}

        cards = self._load_cards(project_id)
        updated = 0

        # Map row_id -> card index (hiện tại trùng, nhưng vẫn defensively build map)
        index_by_row_id: Dict[int, int] = {}
        for idx, card in enumerate(cards):
            row_id = card.get("row_id")
            if isinstance(row_id, int) and row_id not in index_by_row_id:
                index_by_row_id[row_id] = idx

        for upd in updates:
            if not isinstance(upd, dict):
                continue
            row_id = upd.get("row_id")
            tags = upd.get("tags") if "tags" in upd else None
            attrs_update = upd.get("attributes") if "attributes" in upd else None

            if not isinstance(row_id, int):
                continue
            if tags is None and attrs_update is None:
                continue
            if tags is not None and not isinstance(tags, dict):
                continue
            if attrs_update is not None and not isinstance(attrs_update, dict):
                continue

            card_idx = index_by_row_id.get(row_id)
            if card_idx is None or card_idx < 0 or card_idx >= len(cards):
                continue

            card = cards[card_idx]

            if isinstance(tags, dict) and tags:
                existing_tags = card.get("tags") or {}
                if not isinstance(existing_tags, dict):
                    existing_tags = {}
                existing_tags.update(tags)
                card["tags"] = existing_tags

            if isinstance(attrs_update, dict) and attrs_update:
                existing_attrs = card.get("attributes") or {}
                if not isinstance(existing_attrs, dict):
                    existing_attrs = {}

                lower_to_key: Dict[str, str] = {}
                for k in existing_attrs.keys():
                    try:
                        lower_to_key[str(k).lower()] = k
                    except Exception:
                        continue

                for k, v in attrs_update.items():
                    try:
                        key_str = str(k)
                    except Exception:
                        key_str = k
                    target_key = lower_to_key.get(str(key_str).lower(), key_str)
                    existing_attrs[target_key] = v

                card["attributes"] = existing_attrs

            cards[card_idx] = card
            updated += 1

        if updated > 0:
            self._save_cards(project_id, cards)

        return {"project_id": project_id, "updated": updated}

    def get_event_stats(
        self,
        project_id: str,
        event_column: str = "Event",
        search: Optional[str] = None,
        selected_filter: str = "all",
        attr_key: Optional[str] = None,
        attr_value: Optional[str] = None,
        primary_attr_key: Optional[str] = None,
        primary_attr_value: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Thống kê số lượng card theo giá trị cột Event trên TOÀN BỘ dataset,
        sau khi áp dụng cùng bộ lọc như get_cards (search/selected/attr)."""
        cards = self._load_cards(project_id)
        cards = self._apply_filters(
            cards,
            search=search,
            selected_filter=selected_filter,
            attr_key=attr_key,
            attr_value=attr_value,
            primary_attr_key=primary_attr_key,
            primary_attr_value=primary_attr_value,
        )
        key_lower = (event_column or "").strip().lower()

        counts: Dict[str, int] = {}
        total_with_event = 0

        for card in cards:
            if not isinstance(card, dict):
                continue
            attrs = card.get("attributes") or {}
            if not isinstance(attrs, dict):
                continue

            value = None
            if key_lower:
                for k, v in attrs.items():
                    try:
                        if str(k).lower() == key_lower:
                            value = v
                            break
                    except Exception:
                        continue
            if value is None:
                continue

            try:
                raw = "" if value is None else str(value)
            except Exception:
                raw = ""

            parts = [p.strip() for p in str(raw).split(",")] if "," in str(raw) else [str(raw).strip()]
            labels_set = set(p for p in parts if p)
            if not labels_set:
                labels_set = {"(trống)"}

            # Mỗi card chỉ tính tối đa 1 lần cho mỗi Event (dùng set ở trên)
            for label in labels_set:
                counts[label] = counts.get(label, 0) + 1

            total_with_event += 1

        events = [
            {"label": label, "count": count}
            for label, count in sorted(counts.items(), key=lambda x: (-x[1], str(x[0])))
        ]

        return {
            "project_id": project_id,
            "event_column": event_column,
            "total_with_event": total_with_event,
            "events": events,
        }
