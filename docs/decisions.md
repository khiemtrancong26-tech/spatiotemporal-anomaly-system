
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
| D010 | MongoDB Official Node.js Driver (`mongodb`), không dùng Mongoose | B0 đã xác nhận; truy vấn/batch qua Repository, không thêm ODM |
| D011 | User/JWT/scrypt B2 và login rate limiting | Người dùng chốt trong lượt triển khai B2; chi tiết bên dưới |

## Quyết định chưa hoàn tất

- **Driver đã chốt tại D010**, không còn là quyết định mở.
- Isolation Forest đã được chọn trong D009; **model artifact, method/config API, features, version và ngưỡng đánh giá** còn mở.
- Redis + BullMQ là **phương án đề xuất** cho hàng đợi Analysis B5, **chưa chọn làm kiến trúc chính thức**; queue topology, recovery, concurrency, retention/admission còn mở.
- Giới hạn Import (file/batch/timeout/bộ nhớ) và quy trình recovery vẫn phải chốt tại B3; không thêm Kafka/Spark khi chưa có nhu cầu streaming/distributed rõ ràng.

## Mẫu ghi quyết định mới

### DXXX — Tên quyết định

- Ngày:
- Vấn đề:
- Phương án chọn:
- Lý do:
- Ảnh hưởng:
- Người thống nhất:

## D011 — Quy tắc User và xác thực B2

- Ngày: 14/11/2026. Chủ dự án xác nhận trong chat triển khai B2; chưa suy ra đồng thuận riêng của các owner khác.
- Username: trim đầu/cuối, giữ cách viết để hiển thị; `usernameNormalized = username.trim().toLowerCase()` để login và enforce unique không phân biệt hoa/thường. Username chỉ whitespace bị từ chối; không tự thêm regex ký tự hoặc giới hạn độ dài ngoài contract.
- Password: `crypto.scrypt()` bất đồng bộ, N=2^17, r=8, p=1, `maxmem=256*1024*1024`; salt ngẫu nhiên tối thiểu 16 byte/mật khẩu. Không dùng scryptSync trong request. Tối đa 2 tác vụ scrypt đồng thời mỗi process ở cấu hình ban đầu; benchmark trước khi tăng.
- JWT: HS256, secret ngẫu nhiên tối thiểu 32 byte từ env, hết hạn sau 1 giờ. Mỗi protected request kiểm tra JWT rồi đọc lại User trong DB; role/isActive lấy từ DB. Inactive hoặc không tồn tại trả 401. Không bổ sung refresh/logout endpoint.
- Login có rate limiting trước bước scrypt. Ngưỡng là cấu hình vận hành có env, cần đo khi triển khai; không thêm Redis/đổi topology chỉ để làm B2.
- Tài khoản demo analyst/admin tạo bằng CLI với password từ env, không có password mặc định. Dataset seed ghi rõ chưa qua import thật; không thêm API bootstrap.
- Những quyết định này đóng gate Auth/User của B2; không đóng các lựa chọn import/analysis/idempotency hoặc rule Admin B7 còn mở.

## D008 — Analysis online bất đồng bộ

- Ngày: 13/11/2026. Người yêu cầu đã duyệt phương án rà soát trong phiên làm việc; chưa có bằng chứng owner đã triển khai/nghiệm thu.
- Chọn: statistical và ml online cùng workflow async. POST `/api/v1/analysis-runs` trả `202 {data: AnalysisRun}` sau tiếp nhận bền vững; thêm đúng một GET `/api/v1/analysis-runs/{id}`; history/anomalies giữ pagination. `id` chính là run ID, không thêm trường trùng nghĩa. Upload/Import giữ đồng bộ.
- Lifecycle: queued → running → completed/failed, queued có thể failed trước thực thi. Terminal không tự quay lại running. Scope là snapshot tiếp nhận; không có request scope thì lưu `{}`. `completedAt` chỉ khi terminal, gồm failed; failed có `error:{code,message}` an toàn. Không progress/ETA giả, không thêm cancel/retry-job endpoint.
- Idempotency: user + operation/key + payload bất biến. POST tiếp nhận replay đúng 202/body/run ID, không enqueue lần hai; 409 chỉ khi bước tiếp nhận cùng key chưa xong. GET trả trạng thái hiện tại. Receipt tiếp nhận không đồng nghĩa job completed. Hết key/retention hoặc mất snapshot phải đối soát, không tự tạo ý định thay thế. Chạy lại failed là thao tác mới được người dùng chủ động xác nhận.
- Results: completed chỉ sau persist đầy đủ; mọi đường đọc anomaly không công bố partial của queued/running/failed. GET anomalies có run ID chưa completed trả 409; list tổng bỏ qua run chưa completed, detail chưa công bố coi không khả dụng (404). Không có anomaly chỉ sau completed và truy vấn thành công rỗng. Không yêu cầu một transaction khổng lồ hoặc hứa exactly-once execution.
- FE: polling GET detail, một request đang bay, backoff/jitter và chống response trễ; dừng terminal/logout/rời màn, quay lại đọc mới. Run ID trong URL/ngữ cảnh; history phục hồi khi mất ngữ cảnh tab. SessionStorage chỉ giữ key/snapshot chờ tiếp nhận theo phiên; không outbox offline hoặc tự resend khi online lại. Workspace vẫn lọc/render; filter mới không thay scope job cũ.
- Server: thực thi nền có giới hạn concurrency, tiếp nhận durable và restart recovery. Không chọn Redis/BullMQ/Kafka/Spark, process/thread topology hay con số concurrency khi chưa có benchmark. Async không tự giảm CPU/RAM và không chứng minh server hiện tại quá tải.
- Còn mở trước implementation phần phụ thuộc của B5: queue/execution mechanism, atomicity receipt/run/enqueue, claim/lease/restart và cleanup, retention/replay window, admission/overload semantics, quyền đọc theo policy hiện có, detector error codes, model artifact/features/version, method/config API cho ML, severity, scope sensorIds rỗng/giới hạn và from/to. **Polling interval/tab nền, presets thống kê và lựa chọn thuật toán Isolation Forest đã được chốt bổ sung tại D009**; FE M5 đã migrate, chưa chứng minh Backend/worker thật. Không tự thêm status HTTP cho overload trước review.
- Migration (ghi nhận lịch sử 13/11): OpenAPI v0.3.0-draft là contract mục tiêu (25 operations, 20 online/health). **Cập nhật 14/11:** Frontend M5, generated adapter, shared-core Zod/mock/tests đã migrate D008 theo [M5 verification](frontend/m5-verification.md); Backend/worker/engine thật vẫn chưa triển khai. Các báo cáo M0–M4 chỉ là bằng chứng lịch sử.

## D009 — Cấu hình M5 được người dùng chốt ngày 14/11/2026

- UI gửi hai cấu hình cố định: statistical/zscore `{threshold:3}` và statistical/iqr `{multiplier:1.5}`; không cho chỉnh tham số.
- Thuật toán ML chọn Isolation Forest, nhưng chưa có chuỗi method/config API hoặc model artifact/version/features. Khóa gửi riêng ML ở M5; không đoán tên method, contamination/seed/version. Hiển thị version từ Server khi có.
- Điều kiện số mẫu, phương sai 0/thiếu dữ liệu và mã lỗi chưa chốt: Server chịu trách nhiệm kiểm tra, FE hiển thị HTTP/run.error, không tự dựng ngưỡng.
- Poll 3 giây khi tab hiện; lỗi exponential backoff tối đa 30 giây kèm jitter, tab ẩn dừng phát request, tab hiện đọc ngay. Request theo dõi/tiếp nhận timeout 20 giây chỉ dừng chờ, không hủy job. HTTP 401/403/404 dừng poll tự động; có đọc lại chủ động.
- Retention idempotency thật còn mở: không cho retry POST chưa nhận ID trên API thật. Mock cho retry trong 15 phút; không tự resend. Bbox chưa có scope policy thì chặn gửi, yêu cầu bỏ bbox và chọn trạm/thời gian rõ ràng.
- D008 migration code hoàn tất; chi tiết bằng chứng và phần Backend/ML còn chờ trong [M5 verification](frontend/m5-verification.md).

## D010 — MongoDB Official Driver và ranh giới triển khai B0

- **Ngày chốt:** 14/11/2026; chủ dự án xác nhận trong trao đổi B0; **chưa ghi nhận đồng thuận riêng của Cường/Tài/Khải hoặc nghiệm thu runtime**.
- **Quyết định:** Backend Fastify + TypeScript dùng **MongoDB Official Node.js Driver** (package `mongodb`); **không dùng Mongoose**. Giữ kiến trúc Feature-based Modular Monolith và `Route → Validation → Service → Repository → MongoDB` đã có trong SDD.
- **Lý do:** Kiểm soát trực tiếp query, index, BSON mapping, `bulkWrite()` và conditional updates; tránh bổ sung ODM không cần thiết cho MVP. Đổi lại, Backend phải tự đảm bảo HTTP validation, domain rules và DTO mapping, không trông chờ ODM tự xử lý.
- **Ảnh hưởng B1:** Repository và MongoDB plugin dùng native driver; Route/Service không xử lý BSON trực tiếp hoặc xuất Mongo `_id` ra API. Chốt package version/lockfile, test readiness bằng MongoDB thật và phối hợp Cường về môi trường test khi scaffold.
- **Phạm vi chưa chốt:** JSON Schema + Ajv là phương án validation phù hợp Fastify để triển khai B1, cần kiểm chứng mapping status `400/422/405` theo từng operation; Zod trong `shared-core` tiếp tục làm shared DTO/domain contract, không thay thế OpenAPI HTTP. Quy tắc validator C02–C04 vẫn cần Khiêm/Khải/Tài review; không tự đổi OpenAPI.

## B0 — Định hướng xử lý dữ liệu và Analysis (không đồng nghĩa triển khai xong)

- **Import B3:** Giữ `POST /api/v1/datasets/{id}/imports` đồng bộ, trả `200 SingleDataset` khi thành công (không chuyển 202). Thiết kế dùng async I/O, Node.js Streams/backpressure, batch `bulkWrite()` và giới hạn concurrency/bộ nhớ; bảo toàn BR-08 **first valid row wins** theo thứ tự nguồn. Kích thước batch/file, timeout và cleanup/retry còn OPEN-05/NEW-02; không coi streaming là bảo đảm request không timeout.
- **Analysis B5:** D008 vẫn quyết định `202 Accepted` sau tiếp nhận bền vững. Redis + BullMQ là **ứng viên cần đánh giá**, không phải điều kiện B1 hoặc công nghệ đã chốt. Nếu chọn queue ngoài tiến trình, phải có cách đối soát run đã lưu nhưng chưa dispatch, khôi phục sau crash và idempotent processing khi job bị chạy lại.
- **Tính nhất quán:** Không công bố anomalies của run queued/running/failed; chỉ đánh dấu completed sau khi lưu đầy đủ, dùng unique `(analysisRunId, readingId)` và trạng thái/attempt guard chống duplicate. Không hứa exactly-once execution hay một transaction khổng lồ.
- **Tách workload:** Phân trang `GET /readings` cho FE (mặc định 100/trang, FE M4 tự giới hạn 2.000 readings/phiên) không giới hạn phạm vi Analysis Server. Kịch bản dataset 500.000 readings và run xét 30.000 chỉ là **ví dụ**, không phải limit hay benchmark đã đạt. FE M5 chỉ tải anomalies sau completed, theo trang.
- **Không đưa Kafka/Spark** vào MVP tại B0 vì chưa xác định nhu cầu streaming/distributed computing; benchmark CPU/RAM/throughput và quyết định worker topology thuộc B5/B8.
