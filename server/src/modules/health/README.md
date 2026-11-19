# API kiểm tra sẵn sàng

> Endpoint health cho biết backend có phục vụ được và kết nối MongoDB có sẵn sàng hay không.

## Mở file nào

- Khai báo `GET /api/v1/health`. [`health.routes.ts`](health.routes.ts)
- Quyết định trạng thái trả về từ kết quả kiểm tra. [`health.service.ts`](health.service.ts)
- Kiểm tra MongoDB với timeout cấu hình. [`health.repository.ts`](health.repository.ts)
