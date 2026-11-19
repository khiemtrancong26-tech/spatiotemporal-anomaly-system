# Cấu hình và khung ứng dụng

> Thư mục này chuẩn bị các dịch vụ chung và phần giao diện bao quanh các trang.

## Mở file nào

- Đọc chế độ online/mock, API base URL và cấu hình Mapbox. [`config.ts`](config.ts)
- Cấp session, data source và các store cho component React. [`services.tsx`](services.tsx)
- Bố trí khung ứng dụng, điều hướng và trạng thái kết nối. [`shell.tsx`](shell.tsx)
- Ghi nhận lỗi frontend theo nguồn phát sinh. [`error-handling.ts`](error-handling.ts)
- Chứa kiểu hiển thị dùng chung. [`styles.css`](styles.css)
