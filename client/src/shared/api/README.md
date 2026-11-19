# HTTP client và hợp đồng API

> Đây là lớp chuẩn bị URL, token và payload, gửi request HTTP rồi kiểm tra phản hồi trước khi giao cho màn hình.

## Mở file nào

- Thực hiện fetch, gửi JWT và idempotency key khi cần. [`http-client.ts`](http-client.ts)
- Đối chiếu request/response với schema theo operation. [`validation.ts`](validation.ts)
- Chuẩn hóa lỗi HTTP, mạng, hủy request và dữ liệu sai. [`errors.ts`](errors.ts)
- Giữ key và payload nhất quán khi thử lại. [`idempotency.ts`](idempotency.ts)
- Cung cấp types và hợp đồng được sinh từ OpenAPI. [`generated/`](generated/README.md)
