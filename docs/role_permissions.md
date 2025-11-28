# Phân quyền vai trò trong hệ thống

Tài liệu này ghi lại **ma trận phân quyền** cho ba vai trò chính trong hệ thống:

- `owner`
- `admin`
- `executive`

Các quyền được thiết kế để phù hợp với kiến trúc hiện tại (QA / Label / Compare / Projects / Manage Users) và có thể được mở rộng trong tương lai.

---

## 1. Mô tả vai trò

### 1.1. Owner

- Chủ hệ thống, có toàn quyền cấu hình và quản lý người dùng.
- Quản lý được toàn bộ projects và kết quả.
- Có thể thao tác các hành động nguy hiểm (xóa user, xóa project, thay đổi role người dùng).

### 1.2. Admin

- Quản trị nghiệp vụ / dữ liệu.
- Tập trung vào quản lý project (tạo, cấu hình, chạy QA/Label/Compare), nhưng **không can thiệp vào người dùng và phân quyền**.
- Thông thường là lead QA/Data, PM kỹ thuật.

### 1.3. Executive

- Người xem kết quả / ra quyết định.
- Chủ yếu có quyền **read-only**: xem projects, xem kết quả, export báo cáo.
- Không thay đổi cấu hình, không chỉnh sửa project, không quản lý user.

---

## 2. Ma trận phân quyền (tổng quan)

| Chức năng / Quyền                                       | Owner | Admin | Executive |
|---------------------------------------------------------|:-----:|:-----:|:---------:|
| Đăng nhập, sử dụng hệ thống                             |  ✔️   |  ✔️   |    ✔️     |
| Xem danh sách projects (QA/Label/Compare)              |  ✔️   |  ✔️   |    ✔️     |
| Tạo project mới (QA/Label/Compare)                     |  ✔️   |  ✔️   |    ✖️     |
| Sửa thông tin project (tên, mô tả, cấu hình)           |  ✔️   |  ✔️   |    ✖️     |
| Xóa project                                            |  ✔️   |  ✔️   |    ✖️     |
| Upload dataset                                         |  ✔️   |  ✔️   |    ✖️     |
| Cấu hình QA (rule, ngưỡng, mapping cột…)              |  ✔️   |  ✔️   |    ✖️     |
| Chạy QA, xem log và kết quả chi tiết                   |  ✔️   |  ✔️   |    ✔️*    |
| Cấu hình Label (label set, guideline, mapping)         |  ✔️   |  ✔️   |    ✖️     |
| Thực hiện labeling (nếu account đó là labeler)         |  ✔️   |  ✔️   |    ✖️     |
| Cấu hình Compare (dataset A/B, cột so sánh…)           |  ✔️   |  ✔️   |    ✖️     |
| Chạy Compare và xem kết quả chi tiết                   |  ✔️   |  ✔️   |    ✔️*    |
| Export báo cáo, kết quả                                |  ✔️   |  ✔️   |    ✔️     |
| Xem trang **Manage users**                             |  ✔️   |  ✖️   |    ✖️     |
| Tạo user mới                                            |  ✔️   |  ✖️   |    ✖️     |
| Đổi role user                                           |  ✔️   |  ✖️   |    ✖️     |
| Bật/tắt trạng thái user (active/inactive)              |  ✔️   |  ✖️   |    ✖️     |
| Reset mật khẩu user                                     |  ✔️   |  ✖️   |    ✖️     |
| Xóa user                                                |  ✔️¹  |  ✖️   |    ✖️     |
| Xóa Owner khác / tự xóa chính mình                     |  ✖️²  |  ✖️   |    ✖️     |

Ghi chú:

- `✔️*`: Executive có thể xem kết quả QA/Compare nhưng **không được chỉnh cấu hình hoặc rerun**.
- `✔️¹`: Owner được phép xóa user **không phải Owner**, và không được xóa chính mình. Rule này đã được enforced trong backend.
- `✖️²`: Backend đã chặn xóa mọi user role `owner` (kể cả Owner khác) và chặn Owner tự xóa account của mình.

---

## 3. Mapping với code hiện tại

### 3.1. Backend

- Module `modules/user_manager.py`:
  - Lưu user với các trường: `id`, `username`, `password_hash`, `role` (`"owner" | "admin" | "executive"`), `is_active`, `created_at`, `updated_at`.
  - `VALID_ROLES = {"owner", "admin", "executive"}`.
  - Hàm `ensure_initial_owner` tạo một tài khoản Owner mặc định nếu chưa tồn tại.

- API `/api/users` trong `app.py`:
  - `GET /api/users` → liệt kê user (ẩn password_hash).
  - `POST /api/users` → tạo user mới (role bắt buộc thuộc VALID_ROLES).
  - `PATCH /api/users/<user_id>` → đổi mật khẩu, role, trạng thái hoạt động.
  - `DELETE /api/users/<user_id>` → xóa user với rule:
    - Header `X-Current-User` chứa username hiện tại.
    - Chỉ cho phép nếu user hiện tại có `role == "owner"`.
    - Không cho xóa chính mình.
    - Không cho xóa bất kỳ tài khoản có `role == "owner"`.

- API `/api/projects` trong `app.py` (hiện tại):
  - `POST /api/projects/create` → tạo project mới.
  - `GET /api/projects` → liệt kê tất cả project.
  - `GET /api/projects/<project_id>` → lấy chi tiết project.
  - `DELETE /api/projects/<project_id>` → xóa project (chưa phân quyền chi tiết, có thể sẽ mở rộng để check role + created_by).

### 3.2. Frontend

- `App.jsx`:
  - Sau khi login, `currentUser.role` được lưu trong state.
  - Biến `canManageUsers = currentUser && currentUser.role === 'owner'`.
  - Chỉ Owner mới hiển thị tab **Manage** và vào được view Manage Users.

- `components/ManageUsers.jsx`:
  - Owner có thể:
    - Tạo user mới với bất kỳ role hợp lệ.
    - Đổi role user.
    - Bật/tắt `is_active`.
    - Reset mật khẩu.
    - Xóa user (gọi `DELETE /api/users/:id` với header `X-Current-User`).
  - UI ẩn cột “Thao tác” (xóa) với non-Owner.
  - Owner không thấy nút xóa ở dòng user chính mình (hiện text *"Không thể tự xóa"*).

- `components/ProjectsList.jsx` / `components/ProjectCreation.jsx`:
  - Tất cả role đang được phép tạo và xóa project (phần phân quyền chi tiết cho Admin/Executive có thể sẽ được bổ sung sau bằng cách truyền role xuống và ẩn/disable các nút tạo/xóa).

---

## 4. Hướng mở rộng

1. **Thêm kiểm tra role cho API projects**:
   - Đọc header `X-Current-User`, tra user trong `UserManager`.
   - Cho phép `create/delete project` chỉ khi `role` là `owner` hoặc `admin`.
   - Executive chỉ được `GET /api/projects` và `GET /api/projects/<id>`.

2. **Ẩn/disable action trên UI theo role**:
   - Trong `ProjectsList.jsx`:
     - Chỉ Owner/Admin mới thấy nút Xóa project.
     - Executive chỉ thấy nút Xem/Mở (read-only).
   - Trong các workflow QA/Label/Compare:
     - Executive không chạy được job mới, chỉ xem kết quả đã có.

3. **Lưu ý bảo mật**:
   - Hiện tại hệ thống dùng header `X-Current-User` thay vì token → phù hợp nội bộ/dev, nhưng chưa an toàn cho môi trường public.
   - Khi nâng cấp bảo mật, nên chuyển sang cơ chế token/JWT và trích xuất role từ token ở backend.

---

Tài liệu này nên được cập nhật song song với bất kỳ thay đổi nào về role hoặc quyền trong code (backend và frontend) để tránh lệch giữa thiết kế và implementation.
