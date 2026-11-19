# Đồng bộ review khi có mạng lại

> Frontend gửi nhóm review đã lưu offline. Backend xử lý theo mã thao tác và phiên bản mỗi anomaly rồi trả kết quả cho từng mục.

## Mở file nào

- Định nghĩa `POST /api/v1/review-mutation-batches` và các kết quả applied, duplicate, conflict hoặc rejected. [`index.ts`](index.ts)
- Tái sử dụng logic review và kiểm tra quyền của Anomalies. [`../anomalies/`](../anomalies/README.md)
- Xem phía frontend lưu hàng chờ và gửi lại. [`../../../../client/src/offline/`](../../../../client/src/offline/README.md)
