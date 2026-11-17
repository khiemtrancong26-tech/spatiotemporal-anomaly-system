# C3 — Isolation Forest v2 minimal upgrade

Ngày 17/11/2026. **PASS functional correctness/integration** theo G01/G04/G05 được chủ dự án duyệt, kèm ba điều chỉnh bắt buộc; xem D019. Không mở C4/B7/B8. Không chạy benchmark, load/stress test hoặc tối ưu CPU/RAM/latency; các việc hiệu năng chuyển sang B8, không là gate C3.

## 1. Phạm vi và giới hạn

- Giữ Fastify/TypeScript modular monolith, MongoDB Worker, lease/heartbeat/fencing, idempotency và Python subprocess hiện có. Không sửa implementation `isolation-forest.ts`, `python-runner.ts`, `isolation_forest.py` hoặc statistical engines.
- V1 vẫn mặc định cho `config:{}`; explicit `config:{modelVersion:"v1"}` cũng hợp lệ. V2 dùng cùng method `isolation_forest`, `config:{modelVersion:"v2"}`. Không thêm endpoint, ML server, training API, Redis, registry service, cache hoặc database index.
- Chỉ mở rộng AnalysisRun bằng `scoringSummary`, chỉ có trên completed ML model `pm25-iforest-uci501-v2`. V1/queued/running/failed bỏ field hoàn toàn. Không đổi Dataset/Reading/Sensor/Anomaly DTO hay B6 review.
- New v2 admission mặc định **disabled** (`ANALYSIS_V2_ENABLED=false`). C3 tests bật riêng trong môi trường tạm sau khi parser đã migrate. Không thay `.env`, dữ liệu DB hoặc artifact v1 của người dùng.
- Không có accuracy/precision/recall vì không có anomaly labels. Điểm369 hay các events trong golden không là ground truth. Severity low và score `-decision_function` giữ baseline; score v1/v2 không cùng thang so sánh.

## 2. G01 — Nguồn và một lần train offline

Nguồn: [UCI501 Beijing Multi-Site Air Quality](https://archive.ics.uci.edu/dataset/501/beijing%2Bmulti%2Bsite%2Bair%2Bquality%2Bdata), Chen, S. (2017), DOI10.24432/C5RK5G, raw data CC BY4.0. Archive SHA256 `b04da438b2f331ac0ffd45aebdfec0d20d2367feb5f6948c4b1f7ce1191e33c4`,8.192.212 bytes. Kiểm thực tế12 station files/420.768 rows,35.064 mốc/trạm từ2013-03-01 tới2017-02-28, không duplicate station–time.

Đối chiếu độc lập source station/No/local timestamp/value: **8.782/8.782 golden rows khớp**,146 PM2.5 NA của tháng03/2015 đúng các ô bị loại trong golden. Source CSV không chứa lat/lon hoặc offset; chủ dự án duyệt fixed +08:00 và tọa độ golden **owner-provided** cho baseline tích hợp. Không nhận đã xác minh geodetic accuracy độc lập. [Station manifest](../../server/ml/beijing-stations.json) giữ provenance rõ; model manifest ghi hash archive, từng CSV, tọa độ, feature builder, policy và matrices.

Một pure TS builder dùng cho cả offline export và inference; Python chỉ nhận matrix để fit/save/load/predict. Không scaler, imputation, tuning, hoặc thêm features. Chính xác một lệnh fit đã chạy trong lượt triển khai; CLI từ chối nếu artifact/manifest đã có. Parameters giữ recipe v1:100 estimators,max_samples256,contamination auto,max_features1.0,bootstrap false,n_jobs1,random_state42,warm_start false.

| Split | Targets hợp lệ PM2.5 | Có đủ3 features | Unscorable |
|---|---:|---:|---:|
| Train03/2013–12/2014 |189157|188422|735|
| Holdout01–02/2015, không fit |16832|16777|55|
| Golden03/2015 độc lập, không fit/tuning |8782|8722|60|

Golden matrix dùng **riêng dataset tháng03/2015**, không nhập context tháng02 để làm giả train–serve parity với dataset thực tế. Holdout được dùng historical context từ phần train khi cần; không dùng tương lai để tính features. Feature rows được xuất theo UTC timestamp/station; matrix hash pin cả thứ tự và giá trị.

Artifact v2 `.local/models/pm25-iforest-v2/isolation_forest.joblib`:241.932 bytes, SHA256 `0b891da07da2ffcd83f647d296b9642bfb4f2331c3ee0512947bf6eb2af7209c`. [Manifest v2](../../server/ml/pm25-v2-manifest.json) và [offline CLI](../../server/ml/train_pm25_v2.py). Runtime dùng lại Python3.11.9/sklearn1.9.1/numpy2.4.6/scipy1.17.1/joblib1.6.0/threadpoolctl3.8.0, không tạo runtime mới. V1 hash vẫn `554e03b3c2ba9f37c58ba9bae98ff020898738283883b430c40cd19c4f31329b`.

## 3. G04 — Feature Contract đã triển khai

[Pure builder](../../shared-core/src/features/pm25-v2.ts), policy `pm25-st-features-v2-2026-11-17`:

1. `value`: PM2.5 ug/m3.
2. `temporal_delta = value(t) - value(previous)`: cùng trạm, previous gần nhất có timestamp<t, khoảng cách≤2 giờ, không chia theo thời gian.
3. `spatial_delta = value(t) - median(values of fixed neighbors at t)`: Haversine radius6371,0088km, cố định3 trạm gần nhất trong≤50km, loại self; distance tie theo externalId codepoint. Phải có đủ3 neighbors hợp lệ về station/radius, ít nhất2 trong3 có reading **đúng timestamp t**. Thiếu thì target unscorable; không thay bằng neighbor thứ tư, không carry-forward/bucket/round/điền0.

Giá trị/delta phải hữu hạn và biểu diễn được trong numeric bound float32 của runner hiện có. Metadata station phải cùng dataset, WGS84 hợp lệ; dữ liệu bị hỏng/cross-dataset/conflicting IDs/duplicate station-time bị từ chối, không tự sửa metadata để tạo đủ neighbors. C2 timezone/cadence/maxAge của Map không tham gia công thức ML.

Targets do scope B5 chọn. Context có thể ngoài sensorIds hoặc trước from, nhưng chỉ cùng dataset; Repository đọc `[min(target.ts)-2h,max(target.ts)]` của target stations + fixed neighbors. Builder tiếp tục kiểm causality theo **từng target**, không coi bound chung là đủ chống leakage. Context không trở thành anomaly ngoài targets.

Giữ target cap50.000/deadline120s/concurrency/lease/protocol16MiB của B5. Context có guard riêng200.000 supplemental readings,128 stations liên quan,16MiB serialized metadata+context; metadata không vượt10.000 trạm theo import. Cap+1 phát hiện overflow rồi failed `CONTEXT_LIMIT_EXCEEDED`, không truncate hay đổi limit C2/B5. Dùng AbortSignal trong reader; không thêm timeout/queue/parallelism/index để tăng hiệu năng.

Builder trả scorable subset và complete feature rows cho đúng subset; adapter cũ vẫn kiểm đủ rows, ID/order/finite values. Worker kiểm summary + scored IDs với targets/candidates trước ghi, không cho anomaly tham chiếu target unscorable.

`scoringSummary = {targetCount,scoredCount,unscorableCount,reasons:{temporalOnly,spatialOnly,both}}`:

- `targetCount = scoredCount + unscorableCount`.
- Tổng3 reason counts = unscorableCount, ba nhóm loại trừ nhau.
- ScoredCount là số predictions hợp lệ, **không phải số anomalies**. Completed v2 bắt buộc scoredCount>0; zero flags vẫn completed có summary.
- Không có target đủ context → failed `INSUFFICIENT_CONTEXT`, không summary. Các lỗi model/input/timeout khác cũng không công bố partial summary.
- Summary ghi cùng terminal transition và queue-counter release trong transaction fenced hiện có. Không ghi vào config/receipt hay thêm vào v1. Partial anomalies vẫn bị B6 ẩn đến completed.

Golden summary đúng `8782 = 8722 + 60`, reasons temporalOnly48/spatialOnly12/both0. Missing source146 station-hours của C2 và unscorable60 target readings là hai khái niệm khác nhau.

## 4. G05 — Pin/version dispatch và rollout

`online.ts` có hai entries tĩnh, adapter và readiness probe riêng. File bytes/hash/manifest được kiểm theo version trước admission; native runner tiếp tục kiểm runtime/type/feature order/hash trước load verified bytes. V2 probe là vector3 chiều; v1 probe giữ một chiều. Không thêm inference cache; chỉ giữ cơ chế coalesce readiness đã có, tách theo version.

Dùng lại capacity guard chung cho hai entries để **không nhân đôi** giới hạn native subprocess hiện có. Chờ slot có AbortSignal và timeout120s hiện có; không spawn thêm để tránh bận, không thêm queue service/framework hay tăng concurrency.

Acceptance pin model ID/hash và private policy ID trong **cùng run/receipt transaction hiện có**. Worker dispatch theo identity đã lưu, không theo model mặc định mới hoặc flag admission. Flag tắt vẫn cho recovery v2 đã tiếp nhận nếu artifact còn đúng. Replay tiếp tục chạy trước validation/readiness; receipt trả202 snapshot queued nguyên bản, không bị cập nhật thành terminal hay thêm summary. Missing v2 không chặn v1/statistical; mất artifact sau acceptance làm run failed, không tự retrain/fallback/rescore.

Strict OpenAPI/generated/shared parsers được migrate để nhận summary chỉ completed v2. Client adapter kiểm thêm arithmetic/lifecycle bằng shared Zod cho GET detail/history và POST acceptance. UI Desktop mặc định v1, có selector v2, hiển thị scored/targets/unscorable và reasons; zero anomalies chỉ nói về phần đã chấm. Mock v2 **chưa triển khai**, transport trả503 `MOCK_V2_NOT_IMPLEMENTED`, không dựng inference/summary giả.

Thứ tự rollout:

1. Copy cả artifact v1 và v2 đúng hashes vào storage tin cậy; không thay artifact dưới ID cũ. `.local`/model binaries không commit vào Git như baseline v1.
2. Deploy Frontend/parser mới và toàn bộ Backend/Workers dual-version, còn giữ `ANALYSIS_V2_ENABLED=false`. Các phiên client cũ cần reload/migrate: parser strict cũ không đọc được history trộn v2 có field mới.
3. Khi không còn Worker build cũ có thể claim v2, operator đặt `ANALYSIS_V2_ENABLED=true`; optional `ANALYSIS_V2_ARTIFACT` trỏ absolute path của v2. Không tự sửa `.env` trong task này.
4. Rollback admission: tắt flag, giữ dual-version workers/artifacts để hoàn tất queued/running đã nhận; không rollback sang worker chỉ biết v1 khi còn v2 jobs.

Request mẫu: `{"datasetId":"<imported-id>","family":"ml","method":"isolation_forest","config":{"modelVersion":"v2"},"scope":{}}`. Không thay method/statistical config hay normalization/replay fingerprint của request v1.

## 5. Bằng chứng functional — PASS/FAIL

| Kiểm tra đã chạy | Kết quả |
|---|---|
| Root `npm run check`: type/generate/lint/unit/build |PASS: client 124, server 66 unit, shared 10 tests; Server check chạy lại sau chỉnh capacity guard cũng PASS|
| Server full tests qua `test:coverage` |PASS 157 tests/23 files; 10 C3 integration + B1–B6/C2 regression, chạy lại sau chỉnh capacity guard|
| Pure feature vectors, gap boundary, no future/self/foreign dataset, fixed neighbors/no fourth fallback, radius/tie |PASS3 shared tests|
| Golden raw CSV offline matrix so với BSON-normalized inference acquisition |PASS toàn bộ8722 feature vectors/IDs và partition|
| Real sklearn3-feature Worker inference, persisted anomalies đều thuộc scored targets |PASS|
| Context trước from/ngoài target sensorIds, foreign/future excluded |PASS|
| Thiếu3 neighbors dù có2 peer readings → failed/no summary |PASS|
| Version-local readiness, disabled v2, hash/policy/feature-order mismatch; v1/v2 probes dùng chung capacity |PASS|
| Compiled JS build: native readiness v1/v2 gọi cùng lúc, giữ chung capacity guard |PASS|
| Mixed queued v1/v2 recovery khi admission v2 tắt; receipts nguyên vẹn |PASS|
| Stale owner không ghi summary; atomic terminal+summary; double terminal bị fence |PASS|
| Kill Backend process thật sau native partial batch, restart cleanup/recompute/publish |PASS,attempt2,không duplicate effect|
| Mất v2 artifact sau acceptance, malformed coverage test double, context station cap |PASS failed/no summary/no published partial|
| Desktop E2E1440×900: API import → chọn v2 → completed/summary → reload |PASS1 test, API/DB/native model thật, không intercept success|

Initial test-fixture session/client mismatch và unused test imports đã sửa; các lượt cuối trên bảng đều PASS, không bỏ qua tests lỗi. Server coverage lines 97,79%/branches 90,41% chỉ là coverage JS parent, không metric chất lượng ML hoặc bằng chứng hiệu năng/Python coverage.

Mongo tests dùng isolated single-node Replica Set, actual installed mongod9.0.4 override cấu hình harness8.2.6; không nhận đã chạy8.2.6. Các temporary directories có cleanup guards. Test fault injection/corrupted result được gắn nhãn; không coi đó là detector thật. Không chạy các E2E nhỏ hơn1024px hoặc tạo ảnh/fixture UI Mobile/Tablet.

Tái chạy từ root (sau khi artifacts/runtime/feature-export cache đã có):

```powershell
$env:MONGOMS_SYSTEM_BINARY='C:/Program Files/MongoDB/Server/9.0/bin/mongod.exe'
$env:MONGOMS_SYSTEM_BINARY_VERSION_CHECK='false'
npm run check
npm run test:coverage --workspace @pm25/server
npm run test:e2e:c3
```

## 6. Offline recipe và handoff

Lượt này dùng archive đã kiểm hash, giải nén12 CSV vào `.local/pm25-v2-source` và xuất matrices vào `.local/pm25-v2-features`. [Export CLI](../../server/scripts/export-pm25-v2-features.ts) kiểm từng CSV theo manifest pinned, không công thức Python thứ hai. Lệnh export đã chạy, không chạy lại trên output hiện có:

```powershell
npm run ml:export-v2 --workspace @pm25/server -- ../.local/pm25-v2-source ../.local/pm25-v2-source/source.zip ../.local/pm25-v2-features
```

Lệnh fit lịch sử đã chạy **một lần** khi artifact/manifest chưa tồn tại (không cần chạy lại để dùng model hiện có):

```powershell
.local/detector-venv/Scripts/python.exe server/ml/train_pm25_v2.py --features-dir .local/pm25-v2-features --output-dir .local/models/pm25-iforest-v2 --manifest server/ml/pm25-v2-manifest.json
```

Cả export/training từ chối overwrite output. Fresh checkout muốn dùng v2 phải được operator cung cấp artifact tin cậy đúng hash; không train/fetch khi HTTP/Worker start. Recipe/source hashes/runtime/params đã có trong repo để tái lập có chủ đích sang directory/manifest mới nếu cần, không dùng để thay model hiện có hoặc tuning trong C3.

Khiêm: Backend/context/dispatch/persistence; Khải: feature/model correctness và review hạn chế nguồn/quality; Tài: strict Desktop parser/selector/summary; Cường: functional integration/recovery phối hợp. B8 nhận mọi đánh giá/tối ưu CPU/RAM/latency/throughput hoặc stress/load, không chặn C3. C4/B7/B8, independent geodetic audit và ML quality evaluation chưa triển khai trong task này.
