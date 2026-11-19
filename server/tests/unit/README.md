# Unit và contract tests của backend

> Nhóm này kiểm tra các khối logic nhỏ, hợp đồng API và cách xử lý request bằng Fastify inject.

## Mở file nào

- Đối chiếu schema API và khai báo index. [`api-and-index-contract.test.ts`](api-and-index-contract.test.ts)
- Kiểm tra parser, chuẩn hóa và giới hạn nguồn. [`import.test.ts`](import.test.ts)
- Kiểm tra cấu hình và quy tắc của thống kê. [`analysis.test.ts`](analysis.test.ts)
- Kiểm tra bộ lọc và cursor. [`query.test.ts`](query.test.ts)
- Kiểm tra mật khẩu, JWT và dịch vụ xác thực. [`auth.test.ts`](auth.test.ts)

Chạy từ thư mục gốc bằng `npm test --workspace @pm25/server`.
