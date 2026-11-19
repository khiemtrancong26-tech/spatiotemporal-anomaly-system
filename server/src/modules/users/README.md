# Tài khoản và dịch vụ người dùng

> Module này quản lý bản ghi tài khoản và thông tin người dùng hiện tại. Auth và Admin dùng chung các quy tắc ở đây.

## Mở file nào

- Chuẩn hóa username và điều phối tạo tài khoản. [`users.service.ts`](users.service.ts)
- Đọc ghi tài khoản và chuyển thành DTO công khai. [`users.repository.ts`](users.repository.ts)
- Hash và đối chiếu mật khẩu bằng scrypt. [`passwords.ts`](passwords.ts)
- Khai báo `GET /api/v1/users/me`. [`users.routes.ts`](users.routes.ts)
