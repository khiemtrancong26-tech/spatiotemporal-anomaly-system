# Điểm khởi động backend

> Đây là mã backend Fastify. Server tiếp nhận API, kiểm tra quyền, điều phối nghiệp vụ và giao tiếp với MongoDB.

## Mở file nào

- Khởi động HTTP server và đóng ứng dụng khi tiến trình kết thúc. [`main.ts`](main.ts)
- Ghép Fastify, plugin, các module API và worker nền. [`app.ts`](app.ts)
- Đọc biến môi trường, kiểm tra giới hạn và cấp giá trị mặc định. [`config.ts`](config.ts)
- Tìm API theo nhóm nghiệp vụ. [`modules/`](modules/README.md)
- Xem cách backend gọi detector thống kê và ML. [`engines/`](engines/README.md)
