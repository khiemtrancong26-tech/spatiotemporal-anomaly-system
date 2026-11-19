# API quản trị người dùng

> Module này cung cấp các API cho admin xem, tạo và cập nhật tài khoản. Quyền admin được kiểm tra ở backend.

## Mở file nào

- Khai báo GET, POST và PATCH dưới `/api/v1/admin/users`. [`index.ts`](index.ts)
- Kiểm tra yêu cầu, điều phối tạo tài khoản và cập nhật trạng thái. [`admin.service.ts`](admin.service.ts)
- Phân trang và ghi thay đổi bằng MongoDB, bảo vệ việc duy trì admin hoạt động. [`admin.repository.ts`](admin.repository.ts)
