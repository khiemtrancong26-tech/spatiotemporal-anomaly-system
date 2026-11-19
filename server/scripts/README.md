# Công cụ vận hành và đo hiệu năng backend

> Đây là các lệnh riêng để cấu hình dữ liệu, tạo index, kiểm tra detector và chạy benchmark backend.

## Mở file nào

- Tạo index trên MongoDB được cấu hình. [`ensure-indexes.ts`](ensure-indexes.ts)
- Tạo dữ liệu demo chủ động. [`seed-demo.ts`](seed-demo.ts)
- Cập nhật metadata cho một dataset đã nhập. [`configure-exploration.ts`](configure-exploration.ts)
- Khởi động backend và replica set tạm để chạy k6. [`benchmark-performance.mjs`](benchmark-performance.mjs)
- Định nghĩa các kịch bản đọc, import, Analysis và review. [`performance.k6.js`](performance.k6.js)
- Kiểm tra adapter và detector thực tế bằng dữ liệu thử. [`verify-detector-integration.ts`](verify-detector-integration.ts)
