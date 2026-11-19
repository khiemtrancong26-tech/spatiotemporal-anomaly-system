# Điểm khởi động frontend

> Đây là mã chạy trong trình duyệt. Frontend mở màn hình, quản lý phiên và gọi backend qua HTTP để lấy dữ liệu PM2.5.

## Mở file nào

- Khởi tạo router, phiên đăng nhập, bộ nhớ đệm và lớp gọi API. [`main.tsx`](main.tsx)
- Tra URL đến màn hình tương ứng. [`routes/`](routes/README.md)
- Tìm logic theo nghiệp vụ. [`features/`](features/README.md)
- Xem cách ứng dụng dùng dữ liệu đã lưu khi mất mạng. [`offline/`](offline/README.md)
