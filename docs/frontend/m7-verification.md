# M7 — Quản lý tài khoản Admin

Ngày 14/11/2026. Hoàn tất phần FE; chưa nghiệm thu với Backend thật.

- `/admin/users` dùng guard admin hiện có; danh sách public username/role/isActive, sort username asc/desc, cursor 100/trang, giới hạn hiển thị 2.000. Đổi sort/refresh reset cursor; có loading/empty/error/retry.
- Create gửi username/password/role và UUID idempotency key, khóa submit đồng thời. 422 cho sửa; 409 `USERNAME_CONFLICT` (fixture hiện có) báo trùng và cho sửa. 409 không rõ nguyên nhân hoặc mất phản hồi không được coi là thất bại chắc chắn; API thật khóa retry vì retention chưa chốt.
- Mock giữ snapshot/key trong RAM cho retry cùng thao tác, tối đa 15 phút; hết hạn xóa snapshot và khóa retry. Không tự retry. Password input xóa khi gửi; snapshot xóa khi thành công, từ chối chắc chắn, lỗi online hoặc unmount; không lưu password vào storage/log.
- PATCH chỉ gửi field role/isActive đã đổi. Danh sách thay đổi sau response thành công; lỗi giữ draft. Không delete/reset password. Rời route/reload/form có cảnh báo bỏ dữ liệu chưa lưu.
- Theo quyết định người dùng: Backend quyết định quy tắc admin cuối cùng/tự hạ quyền. PATCH chính mình có xác nhận; response inactive thoát phiên, còn active đọc lại `/users/me` để cập nhật guard. Có thao tác kiểm tra lại quyền khi request lỗi, báo rõ sẽ bỏ draft. 401 dùng cơ chế hủy phiên hiện có.
- Mock Admin có trạng thái RAM, kiểm tra quyền/trạng thái tài khoản, unique username và receipt create theo token/key, fingerprint payload (không plaintext password), hạn replay 15 phút. Reload mất thay đổi mock; không chứng minh tính đúng của persistence/concurrency Backend.

## Kiểm chứng

- `npm run check`: typecheck, lint, 76 tests và production build đạt.
- E2E Chromium: 18/18 đạt (M2–M7). tạo/sửa mock và tự hạ quyền; HTTP interception kiểm tra sort/cursor, key/payload create, 422/trùng username, unknown khóa retry, không lưu password vào storage, PATCH chỉ isActive, 403 giữ draft và tự vô hiệu hóa thoát phiên. Regression M2–M6 và analyst route guard chạy cùng suite.
- Đã xem screenshot desktop/mobile; viewport 390px không tràn ngang toàn trang, bảng có cuộn ngang riêng.
- Build còn cảnh báo chunk Three.js lớn và circular dependency của TanStack CLI như các mốc trước.

## Còn chờ tích hợp

Backend thật: chính sách admin cuối cùng/tự hạ quyền, token cũ sau đổi quyền, idempotency retention/replay và cạnh tranh username Register/Admin. Không sửa SRS/SDD/OpenAPI hoặc tự thêm business rule trong đợt M7. Mock/HTTP interception không thay thế nghiệm thu Backend; mục này tiếp tục ở M8.
