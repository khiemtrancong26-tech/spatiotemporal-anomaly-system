# Công cụ phát triển frontend

> Các script ở đây sinh hợp đồng API và chụp bằng chứng giao diện Desktop phục vụ kiểm tra.

## Mở file nào

- Sinh types và schema dùng chung từ OpenAPI. [`generate-contracts.mjs`](generate-contracts.mjs)
- Chạy Playwright để ghi lại các màn hình Desktop. [`capture-ui.mjs`](capture-ui.mjs)
- Ghi bằng chứng các chế độ của Space–Time Cube. [`capture-cube.mjs`](capture-cube.mjs)
- Ghi bằng chứng các luồng workspace và nhập dữ liệu. [`capture-workspace-v2.mjs`](capture-workspace-v2.mjs)
