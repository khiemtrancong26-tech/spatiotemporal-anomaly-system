# Tiện ích dùng chung của backend

> Các module tái sử dụng tiện ích ở đây cho thời gian, phân trang, idempotency và giới hạn số thao tác đồng thời.

## Mở file nào

- Xử lý tham số trang và mã hóa cursor gắn với truy vấn. [`pagination.ts`](pagination.ts)
- Kiểm tra và chuẩn hóa thời gian. [`utc-time.ts`](utc-time.ts)
- Cấp slot, giữ hàng chờ có giới hạn và giải phóng slot. [`import-capacity.ts`](import-capacity.ts)
- Lỗi và validation HTTP dùng chung. [`http/`](http/README.md)
- Ánh xạ dữ liệu và các tiện ích MongoDB. [`persistence/`](persistence/README.md)
