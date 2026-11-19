# Tiện ích lưu trữ MongoDB

> Thư mục này chứa phần dùng chung để chuyển dữ liệu MongoDB, tạo index và duy trì thông tin chống gửi trùng.

## Mở file nào

- Chuyển ObjectId, Date và GeoJSON thành dữ liệu API. [`mapping.ts`](mapping.ts)
- Tạo điều kiện truy vấn cho trang tiếp theo. [`keyset.ts`](keyset.ts)
- Khai báo và tạo các index online. [`indexes.ts`](indexes.ts)
- Quản lý receipt, lease và transaction của upload/import. [`idempotency.ts`](idempotency.ts)
