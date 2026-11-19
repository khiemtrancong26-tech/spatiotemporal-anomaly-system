# Xác thực, JWT và email

> Module này nhận đăng ký, đăng nhập, xác minh email và đặt lại mật khẩu. Đăng nhập hợp lệ cấp JWT cho frontend.

## Mở file nào

- Khai báo API auth cùng giới hạn tần suất. [`auth.routes.ts`](auth.routes.ts)
- Kiểm tra thông tin đăng nhập qua dịch vụ Users. [`auth.service.ts`](auth.service.ts)
- Ký và xác minh JWT. [`tokens.ts`](tokens.ts)
- Xử lý token xác minh và đặt lại mật khẩu. [`email.service.ts`](email.service.ts)
- Gửi thư qua SMTP khi đã cấu hình. [`email.ts`](email.ts)
