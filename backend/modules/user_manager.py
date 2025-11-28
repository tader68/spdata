import os
import json
import uuid
import threading
from datetime import datetime
from typing import Dict, Any, List, Optional

from werkzeug.security import generate_password_hash, check_password_hash


class UserManager:
    """Quản lý tài khoản người dùng và phân quyền đơn giản.

    Lưu user vào 1 file JSON trong thư mục results để nhất quán với các project.
    Cấu trúc mỗi user:
    {
        "id": str,
        "username": str,
        "password_hash": str,
        "role": "owner" | "admin" | "executive",
        "is_active": bool,
        "created_at": str (ISO),
        "updated_at": str (ISO | None)
    }
    """

    VALID_ROLES = {"owner", "admin", "executive"}
    DEFAULT_PERMISSIONS_BY_ROLE = {
        "owner": [
            "access_workflow",
            "access_labeling",
            "access_compare",
            "access_projects",
            "create_project",
            "delete_project",
            "access_ai_card",
            "edit_ai_card",
            "manage_users",
        ],
        "admin": [
            "access_workflow",
            "access_labeling",
            "access_compare",
            "access_projects",
            "create_project",
            "delete_project",
            "access_ai_card",
            "edit_ai_card",
        ],
        "executive": [
            "access_workflow",
            "access_labeling",
            "access_compare",
            "access_projects",
            "access_ai_card",
        ],
    }
    ALL_PERMISSIONS = sorted(
        {p for perms in DEFAULT_PERMISSIONS_BY_ROLE.values() for p in perms}
    )

    def __init__(self, results_folder: str = "results") -> None:
        self.results_folder = results_folder
        os.makedirs(self.results_folder, exist_ok=True)
        self.users_file = os.path.join(self.results_folder, "users.json")
        self._lock = threading.Lock()
        self._ensure_store()
        # Seed tài khoản owner ban đầu nếu chưa có
        self.ensure_initial_owner(username="tandat", password="123456dat")

    # ------------------------ internal helpers ------------------------
    def _ensure_store(self) -> None:
        if not os.path.exists(self.users_file):
            data = {"users": []}
            with open(self.users_file, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)

    def _load(self) -> Dict[str, Any]:
        with self._lock:
            if not os.path.exists(self.users_file):
                self._ensure_store()
            try:
                with open(self.users_file, "r", encoding="utf-8") as f:
                    data = json.load(f)
                if not isinstance(data, dict):
                    data = {"users": []}
                if "users" not in data or not isinstance(data["users"], list):
                    data["users"] = []
                return data
            except Exception:
                return {"users": []}

    def _save(self, data: Dict[str, Any]) -> None:
        with self._lock:
            tmp_path = self.users_file + ".tmp"
            with open(tmp_path, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
            os.replace(tmp_path, self.users_file)

    def _sanitize_user(self, user: Dict[str, Any]) -> Dict[str, Any]:
        """Ẩn password_hash khi trả ra ngoài API."""
        result = dict(user)
        result.pop("password_hash", None)

        role = (result.get("role") or "").lower()
        perms = result.get("permissions")
        if perms is None:
            perms = list(self.DEFAULT_PERMISSIONS_BY_ROLE.get(role, []))
        else:
            if isinstance(perms, list):
                perms = [p for p in perms if isinstance(p, str) and p in self.ALL_PERMISSIONS]
            else:
                perms = list(self.DEFAULT_PERMISSIONS_BY_ROLE.get(role, []))

        # Owner luôn full quyền, không bị giới hạn bởi permissions lưu trong file
        if role == "owner":
            perms = list(self.ALL_PERMISSIONS)

        result["role"] = role
        result["permissions"] = perms
        return result

    # ------------------------ public APIs ------------------------
    def ensure_initial_owner(self, username: str, password: str) -> None:
        """Đảm bảo luôn có ít nhất 1 tài khoản owner ban đầu.

        Chỉ tạo mới nếu hiện không tồn tại user với username này.
        """
        data = self._load()
        for u in data["users"]:
            if u.get("username") == username:
                return

        now = datetime.utcnow().isoformat()
        user = {
            "id": str(uuid.uuid4()),
            "username": username,
            "password_hash": generate_password_hash(password),
            "role": "owner",
            "permissions": list(self.DEFAULT_PERMISSIONS_BY_ROLE.get("owner", [])),
            "is_active": True,
            "created_at": now,
            "updated_at": None,
        }
        data["users"].append(user)
        self._save(data)

    def list_users(self) -> List[Dict[str, Any]]:
        data = self._load()
        return [self._sanitize_user(u) for u in data["users"]]

    def create_user(self, username: str, password: str, role: str) -> Dict[str, Any]:
        if not username:
            raise ValueError("Username không được để trống")
        if not password:
            raise ValueError("Password không được để trống")
        role = (role or "").lower()
        if role not in self.VALID_ROLES:
            raise ValueError(f"Role không hợp lệ: {role}")

        data = self._load()
        if any(u.get("username") == username for u in data["users"]):
            raise ValueError("Username đã tồn tại")

        now = datetime.utcnow().isoformat()
        user = {
            "id": str(uuid.uuid4()),
            "username": username,
            "password_hash": generate_password_hash(password),
            "role": role,
            "permissions": list(self.DEFAULT_PERMISSIONS_BY_ROLE.get(role, [])),
            "is_active": True,
            "created_at": now,
            "updated_at": None,
        }
        data["users"].append(user)
        self._save(data)
        return self._sanitize_user(user)

    def update_user(
        self,
        user_id: str,
        password: Optional[str] = None,
        role: Optional[str] = None,
        permissions: Optional[List[str]] = None,
        is_active: Optional[bool] = None,
    ) -> Dict[str, Any]:
        data = self._load()
        users = data["users"]
        for u in users:
            if u.get("id") == user_id:
                changed = False
                if password is not None and password != "":
                    u["password_hash"] = generate_password_hash(password)
                    changed = True
                if role is not None:
                    r = role.lower()
                    if r not in self.VALID_ROLES:
                        raise ValueError(f"Role không hợp lệ: {role}")
                    u["role"] = r
                    changed = True
                if permissions is not None:
                    perms_list: List[str] = []
                    if isinstance(permissions, list):
                        for p in permissions:
                            if isinstance(p, str) and p in self.ALL_PERMISSIONS:
                                perms_list.append(p)
                    u["permissions"] = perms_list
                    changed = True
                if is_active is not None:
                    u["is_active"] = bool(is_active)
                    changed = True
                if changed:
                    u["updated_at"] = datetime.utcnow().isoformat()
                    self._save(data)
                return self._sanitize_user(u)

        raise ValueError("Không tìm thấy user")

    def delete_user(self, user_id: str) -> None:
        data = self._load()
        users = data["users"]
        new_users = [u for u in users if u.get("id") != user_id]
        if len(new_users) == len(users):
            raise ValueError("Không tìm thấy user")
        data["users"] = new_users
        self._save(data)

    def authenticate(self, username: str, password: str) -> Optional[Dict[str, Any]]:
        if not username or not password:
            return None
        data = self._load()
        for u in data["users"]:
            if u.get("username") == username and u.get("is_active", True):
                if check_password_hash(u.get("password_hash", ""), password):
                    return self._sanitize_user(u)
        return None
