# Tra cứu và cập nhật review

> Module này công bố bất thường của các run đã hoàn tất và xử lý thao tác thay đổi ghi chú hoặc trạng thái review.

## Mở file nào

- Khai báo list, detail và PATCH review. [`anomalies.routes.ts`](anomalies.routes.ts)
- Kiểm tra bộ lọc, cursor và dữ liệu review. [`anomalies.service.ts`](anomalies.service.ts)
- Đọc anomalies theo quyền dataset và thực hiện transaction kiểm tra `baseVersion`. [`anomalies.repository.ts`](anomalies.repository.ts)

Nếu hai người cùng sửa từ một phiên bản, người gửi sau có thể nhận `409 VERSION_CONFLICT` để đọc lại dữ liệu.
