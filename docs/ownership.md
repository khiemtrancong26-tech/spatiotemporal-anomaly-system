
# Module Ownership

| Thành viên | Phạm vi chính |
|---|---|
| Khiêm (Người 1) | `server/`, MongoDB, API Contract |
| Tài (Người 2) | React, UI, Mapbox, Three.js trong `client/` |
| Duy (Người 3) | PWA, IndexedDB, Web Worker, offline/sync trong `client/` |
| Khải (Người 4) | `shared-core/`, thuật toán thống kê, ML |
| Cường (Người 5) | `infra/`, CI, `tests/`, hiệu năng |

## Quy tắc phối hợp

1. Tài khởi tạo React/Vite. Duy phát triển chức năng offline trong cùng ứng dụng.
2. Khải phối hợp với Khiêm khi tích hợp thuật toán và ML vào Backend.
3. Mỗi thành viên chịu trách nhiệm viết test và cập nhật README cho phần mình phụ trách.
4. Thay đổi API hoặc shared schema phải thông báo các thành viên liên quan trước khi merge.
5. Các thay đổi được tích hợp thông qua Pull Request vào `develop`.
6. Ownership xác định trách nhiệm chính, không tạo quyền độc quyền sửa thư mục.
