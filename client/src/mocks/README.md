# Nguồn API mô phỏng

> Mock transport tạo phản hồi có kiểm soát để phát triển và kiểm thử giao diện, ví dụ thành công, lỗi, độ trễ hoặc hết phiên.

## Mở file nào

- Định tuyến các request mô phỏng và lưu trạng thái thử nghiệm trong RAM. [`transport.ts`](transport.ts)
- Khởi tạo transport mô phỏng khi cấu hình chọn chế độ mock. [`../main.tsx`](../main.tsx)

Chế độ online dùng transport HTTP thật.
