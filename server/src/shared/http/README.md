# Lỗi và kiểm tra hợp đồng HTTP

> Các route dùng cùng kiểu lỗi HTTP và cơ chế kiểm tra schema để phản hồi nhất quán.

## Mở file nào

- Khai báo HttpError và schema của dữ liệu lỗi. [`errors.ts`](errors.ts)
- Tạo bộ kiểm tra dữ liệu request cho Fastify. [`validation.ts`](validation.ts)
- Ánh xạ lỗi thành phản hồi HTTP. [`../../plugins/http.ts`](../../plugins/http.ts)
