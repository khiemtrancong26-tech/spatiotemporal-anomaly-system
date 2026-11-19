# Hợp đồng API sinh từ OpenAPI

> Thư mục này chứa các file được sinh để kiểu dữ liệu và cách gọi API của frontend khớp với đặc tả backend.

## Mở file nào

- Khai báo TypeScript sinh từ đặc tả API. [`openapi.d.ts`](openapi.d.ts)
- Danh mục operation, đường dẫn và schema dùng khi kiểm tra lúc chạy. [`contract.json`](contract.json)
- Tập kiểu dữ liệu frontend dùng để đọc và gửi API. [`wire.ts`](wire.ts)
- Sinh lại các file từ OpenAPI. [`../../../../scripts/generate-contracts.mjs`](../../../../scripts/generate-contracts.mjs)
