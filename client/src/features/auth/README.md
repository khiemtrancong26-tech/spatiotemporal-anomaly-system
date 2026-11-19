# Đăng nhập, xác minh email và phiên

> Phần này xử lý các màn hình tài khoản và theo dõi phiên đăng nhập hiện tại trong trình duyệt.

## Mở file nào

- Chứa màn hình đăng nhập và xử lý đường dẫn quay lại sau đăng nhập. [`pages.tsx`](pages.tsx)
- Nhận thông tin đăng ký và hiển thị bước xác minh. [`register.tsx`](register.tsx)
- Chứa xác minh email, gửi lại xác minh, quên và đặt lại mật khẩu. [`email-pages.tsx`](email-pages.tsx)
- Lưu thông tin phiên, xác nhận lại người dùng và vô hiệu phiên cũ. [`session.ts`](session.ts)
