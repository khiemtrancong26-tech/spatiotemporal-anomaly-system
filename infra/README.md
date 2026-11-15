
# Infrastructure

- Người phụ trách: Cường.
- Docker Compose.
- Nginx và HTTPS cổng 443.
- OpenSSL và GitHub Actions.

Trạng thái: Chưa triển khai hạ tầng.


## Điều kiện bàn giao B3

B3 local tests đã dùng MongoDB replica set thật và kiểm tra transaction/recovery; chưa triển khai Docker/Nginx/TLS chung. Xem [B3 verification/runbook](../docs/backend/b3-verification.md).

Cường cần cấu hình replica set đã initiate (URI khớp tên/hosts), persistent DB và `IMPORT_STORAGE_DIR` cùng vòng đời/backup, quyền ghi nguồn, dung lượng đĩa, proxy multipart body size có overhead và timeout lớn hơn 120 giây. Không tự xóa nguồn/receipt, không expose HTTP reading-batches. Kiểm tra readiness 200 chưa chứng minh transaction/volume/proxy đã sẵn sàng; chạy smoke upload → mapping → import sau restart ở môi trường đích. Performance/HA/TLS/CI và full stress thuộc bàn giao Cường/B8, chưa nghiệm thu bởi local harness 1 node.
