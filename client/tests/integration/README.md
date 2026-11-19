# Kiểm thử tích hợp frontend

> Các test này chạy nhiều phần frontend cùng nhau để kiểm tra luồng nghiệp vụ.

## Mở file nào

- Hợp đồng chạy Isolation Forest. [`analysis/`](analysis/README.md)
- Xem chi tiết bất thường. [`anomalies/`](anomalies/README.md)
- HTTP client và nguồn dữ liệu online. [`api/`](api/README.md)
- Trạng thái kết nối API. [`app/`](app/README.md)
- Xác thực và chuyển tài khoản. [`auth/`](auth/README.md)
- Khám phá và truy xuất dữ liệu. [`workspace/`](workspace/README.md)

Chạy bằng `npm run test:integration --workspace @pm25/client`.
