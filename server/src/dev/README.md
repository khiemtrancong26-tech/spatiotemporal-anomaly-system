# Dữ liệu khởi tạo cho demo

> Phần này tạo tài khoản demo và, khi được chọn, dataset mẫu dạng metadata để kiểm tra các màn hình.

## Mở file nào

- Dùng logic tạo người dùng chung để seed tài khoản và metadata. [`seed-demo.ts`](seed-demo.ts)
- Đọc cấu hình và thực thi seed trên database được chọn. [`../../scripts/seed-demo.ts`](../../scripts/seed-demo.ts)

Tài khoản demo sử dụng thông tin từ môi trường chạy. Bản ghi metadata mẫu tự nó không chứa các readings đã import.
