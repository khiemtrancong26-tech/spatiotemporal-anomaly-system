
# Technical Decisions

## Các quyết định đã thống nhất

| ID | Quyết định | Lý do |
|---|---|---|
| D001 | Sensor Data, MVP PM2.5 | Giới hạn phạm vi dữ liệu |
| D002 | Full-stack TypeScript | Thống nhất ngôn ngữ |
| D003 | MongoDB là Database chính | Đáp ứng yêu cầu môn học |
| D004 | Mapbox 3D + Three.js Cube | Hai góc nhìn không gian – thời gian |
| D005 | Thống kê online/offline, ML chỉ online | Phù hợp khả năng Client–Server |
| D006 | Không triển khai LLM trong MVP | Kiểm soát phạm vi |
| D007 | npm workspaces | Quản lý Monorepo chung |

## Quyết định chưa hoàn tất

- Mongoose hay MongoDB official driver.
- Thuật toán ML cuối cùng.
- Redis: chỉ bổ sung nếu cần thiết.

## Mẫu ghi quyết định mới

### DXXX — Tên quyết định

- Ngày:
- Vấn đề:
- Phương án chọn:
- Lý do:
- Ảnh hưởng:
- Người thống nhất:

## D008 — Analysis online bất đồng bộ

- Ngày: 13/11/2026. Người yêu cầu đã duyệt phương án rà soát trong phiên làm việc; chưa có bằng chứng owner đã triển khai/nghiệm thu.
- Chọn: statistical và ml online cùng workflow async. POST `/api/v1/analysis-runs` trả `202 {data: AnalysisRun}` sau tiếp nhận bền vững; thêm đúng một GET `/api/v1/analysis-runs/{id}`; history/anomalies giữ pagination. `id` chính là run ID, không thêm trường trùng nghĩa. Upload/Import giữ đồng bộ.
- Lifecycle: queued → running → completed/failed, queued có thể failed trước thực thi. Terminal không tự quay lại running. Scope là snapshot tiếp nhận; không có request scope thì lưu `{}`. `completedAt` chỉ khi terminal, gồm failed; failed có `error:{code,message}` an toàn. Không progress/ETA giả, không thêm cancel/retry-job endpoint.
- Idempotency: user + operation/key + payload bất biến. POST tiếp nhận replay đúng 202/body/run ID, không enqueue lần hai; 409 chỉ khi bước tiếp nhận cùng key chưa xong. GET trả trạng thái hiện tại. Receipt tiếp nhận không đồng nghĩa job completed. Hết key/retention hoặc mất snapshot phải đối soát, không tự tạo ý định thay thế. Chạy lại failed là thao tác mới được người dùng chủ động xác nhận.
- Results: completed chỉ sau persist đầy đủ; mọi đường đọc anomaly không công bố partial của queued/running/failed. GET anomalies có run ID chưa completed trả 409; list tổng bỏ qua run chưa completed, detail chưa công bố coi không khả dụng (404). Không có anomaly chỉ sau completed và truy vấn thành công rỗng. Không yêu cầu một transaction khổng lồ hoặc hứa exactly-once execution.
- FE: polling GET detail, một request đang bay, backoff/jitter và chống response trễ; dừng terminal/logout/rời màn, quay lại đọc mới. Run ID trong URL/ngữ cảnh; history phục hồi khi mất ngữ cảnh tab. SessionStorage chỉ giữ key/snapshot chờ tiếp nhận theo phiên; không outbox offline hoặc tự resend khi online lại. Workspace vẫn lọc/render; filter mới không thay scope job cũ.
- Server: thực thi nền có giới hạn concurrency, tiếp nhận durable và restart recovery. Không chọn Redis/BullMQ/Kafka/Spark, process/thread topology hay con số concurrency khi chưa có benchmark. Async không tự giảm CPU/RAM và không chứng minh server hiện tại quá tải.
- Còn mở trước B5/M5: queue/execution mechanism, atomicity receipt/run/enqueue, claim/lease/restart và cleanup, retention/replay window, admission/overload semantics, polling interval/tab nền, quyền đọc theo policy hiện có, detector error codes/config/model/severity, scope sensorIds rỗng/giới hạn và from/to. Không tự thêm status HTTP cho overload trước review.
- Migration: OpenAPI v0.3.0-draft là contract tài liệu mục tiêu (25 operations, 20 online/health). Runtime client/generated types, shared-core Zod và mock/tests còn theo v0.2; phải cập nhật có phối hợp trong M1 follow-up/B0 trước M5. Không chạy generator để sửa runtime trong lượt chỉ sửa tài liệu. Các báo cáo M0–M4 là bằng chứng lịch sử, không chứng minh async đã chạy.
