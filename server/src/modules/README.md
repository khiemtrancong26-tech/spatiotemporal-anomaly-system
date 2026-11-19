# Các module nghiệp vụ của backend

> Mỗi module quản lý một nhóm API và quy tắc nghiệp vụ. Route nhận HTTP, service xử lý quy tắc và repository đọc ghi MongoDB.

## Mở file nào

- Đăng ký, xác thực và email. [`auth/`](auth/README.md)
- Tài khoản và người dùng hiện tại. [`users/`](users/README.md)
- Quản trị người dùng. [`admin/`](admin/README.md)
- Dataset và luồng nhập file. [`datasets/`](datasets/README.md)
- Đọc trạm và số đo theo trang. [`query/`](query/README.md)
- Profile và tổng hợp theo thời gian. [`exploration/`](exploration/README.md)
- Nhận và xử lý job Analysis. [`analysis/`](analysis/README.md)
- Đọc và review bất thường. [`anomalies/`](anomalies/README.md)
- Nhận review từ hàng chờ offline. [`sync/`](sync/README.md)
- Trạng thái sẵn sàng của backend. [`health/`](health/README.md)
