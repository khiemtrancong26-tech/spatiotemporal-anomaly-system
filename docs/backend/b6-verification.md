# B6 / C1 — Anomaly API và review online

Ngày: **16/11/2026**. Triển khai theo yêu cầu chủ dự án, B6 của [Backend online plan](../backend-online-plan.md) và C1 của [Change Plan](../backend-change-plan.md). **Ba operations hiện có đã được triển khai, không sửa OpenAPI/shared schemas, không triển khai C2/C3 hoặc ML v2.**

## 1. Kết quả bàn giao

| Operation | Hành vi đã triển khai |
|---|---|
| GET `/api/v1/anomalies` | Chỉ dataset imported + run completed, filters/sort/cursor theo OpenAPI; page bounded, whitelist DTO |
| GET `/api/v1/anomalies/{id}` | Anomaly đã công bố; unavailable/partial/orphan/parent mismatch→404, không trả value của Reading hoặc field persistence |
| PATCH `/api/v1/anomalies/{id}` | Chỉ baseVersion + changes status/note; CAS và visibility trong transaction nhỏ;409/currentVersion khi stale |

Tổng **17/20 operations online/health** có Backend thật. Còn3 operations B7/Admin; B8/deployment/SLA vẫn chưa nghiệm thu. API Profile/reading-aggregates, Offline/Sync và model v2 chưa được tạo. Model/score/severity của B5 v1 giữ nguyên; review không train/rescore.

Các module mới tại `server/src/modules/anomalies` giữ Route → schema/validation → Service → Repository → MongoDB. Service dùng public `DatasetReadAccess` và `AnalysisReadAccess`, không import repository nội bộ của feature khác. Repository mới che BSON/transactions/mapping; composition ở `index.ts`.

Frontend đã có generated adapter và màn list/detail/review từ M6; B6 nối các lời gọi này với API thật. Không cần viết lại source FE hoặc đổi contract để thực hiện luồng này. E2E thật được bổ sung riêng với CSV12 trạm, auth/CORS/API/worker/MongoDB; các báo cáo FE mock cũ vẫn là bằng chứng lịch sử riêng.

## 2. Visibility và phân trang

- List yêu cầu datasetId theo schema (thiếu query field→400); dataset không tồn tại→422 DATASET_NOT_FOUND, chưa imported→422 DATASET_NOT_READY như Query B4. Không truyền analysisRunId thì list tổng; nếu có filter này nhưng run không tồn tại→422 ANALYSIS_RUN_NOT_FOUND, khác dataset→422 ANALYSIS_RUN_NOT_IN_DATASET. Opaque IDs không bị ép regex tại HTTP; ID không tương ứng persistence được xử lý như không tồn tại.
- Với run ID cụ thể queued/running/failed→409 ANALYSIS_NOT_READY. Completed không có anomaly trả200/page rỗng. List tổng loại mọi partial, orphan hoặc liên kết không khớp; không gọi đó là kết quả rỗng của run chưa sẵn sàng.
- Query Repository dùng `$lookup` kiểm run completed/cùng dataset/family/method và dataset imported trong chính pipeline. Check này áp dụng **trước limit**; không lấy trang candidate rồi lọc khiến cursor/empty sai. Detail dùng cùng visibility pipeline; không dựa riêng vào preflight Service.
- Filters chỉ datasetId/analysisRunId/family/method/severity/status/from/to; không nhận sensorId/bbox/modelVersion. Time dùng quy tắc B4 của dependency B6: UTC Z tối đa3 số phần lẻ, normalize ms, khoảng đóng [from,to], from=to là một instant; semantic sai422, cú pháp/schema/cursor sai400. Không đoán timezone hoặc cắt phần lẻ.
- Sort `ts:asc|desc`, tie-break `_id`; default100/max200; Repository lấy limit+1 sau visibility. Signed cursor gắn tất cả filter/sort và operation; limit có thể đổi. `ts` bất biến khi review. Không hứa snapshot danh sách khi status/note hoặc dữ liệu thay đổi giữa các trang.
- Projection và DTO whitelist bỏ BSON `_id`, lookup arrays, source/private fields và value. `score` hữu hạn được kiểm bằng shared Anomaly schema, không phải PM2.5/AQI. Không thêm lookup Reading endpoint hoặc suy diễn value từ score.

Pipeline dùng primary + majority read concern; các kết quả B5 chỉ xuất hiện sau full persist/terminal publication. Các index hiện có14 online không thay đổi, không thêm collection. Phép thử có225 partial candidates đứng trước public rows để kiểm chứng vị trí visibility/limit.

## 3. PATCH: CAS và chống race trạng thái cha

**Điểm quan trọng:** không dùng GET trước rồi UPDATE không có guard. Repository thực hiện transaction snapshot/majority với thứ tự dataset → run → anomaly:

1. Đọc anomaly, không tồn tại→404.
2. Conditional write khóa dataset còn imported và run còn completed/cùng dataset/family/method. Dùng `$inc: {reviewFence:1}` thực sự trên parent documents; no-op `$set` hoặc read đơn thuần không thay thế khóa. Fields này private, không đổi DTO/dataset import state/run lifecycle/config/versions.
3. So sánh baseVersion với version hiện tại; stale→409 với `error.details.currentVersion`, không yêu cầu full anomaly trong error.
4. Conditional findOneAndUpdate theo anomaly ID + version + parent IDs, chỉ `$set` các field review được phép, `$inc version:1`, `$currentDate updatedAt`. Trả snapshot vừa cập nhật, server time chuẩn UTC.
5. Conflict/unavailable/numeric exhaustion abort transaction, bao gồm rollback parent fences. Lỗi DB giữa chừng cũng rollback; không báo lưu thành công. Các write conflicts được driver retry trong budget transaction15s/maxCommit10s như B5.

Mọi review khóa parents cùng thứ tự; việc đổi visibility tranh chấp cùng documents, nên không ghi review vào anomaly không còn public khi commit. Transactions nhỏ có thể serialize review cùng dataset; Cường cần đo dưới tải trước mở rộng, không tuyên bố throughput/SLA từ hai-client test.

- Status chỉ open/confirmed/false_positive; note giữ nguyên text/whitespace/newline, chuỗi rỗng được chấp nhận. Empty changes hoặc sửa score/severity/method/value/version/parent IDs bị schema từ chối400.
- Positive integer phải biểu diễn an toàn trong JavaScript; unsafe baseVersion→422. Nếu version hiện tại đạt giới hạn không thể tăng an toàn→422 VERSION_LIMIT_REACHED. Không tự wrap/làm tròn.
- Valid PATCH kể cả cùng status/note vẫn là một revision CAS. Không có POST Idempotency-Key/replay cho PATCH; gửi lại baseVersion cũ→409.
- Auth analyst/admin dùng current user/role/isActive qua DB mỗi request như B2. Detail/PATCH hidden parent→404; list dùng các status đã khai báo, không thêm503/404 ngoài contract list.

`createAnomalyReviewAccess(client,db)` là public boundary cho validation + visibility + CAS, không có HTTP dependency. Đây **chưa phải Sync an toàn**: future Sync vẫn cần auth, receipt/clientMutationId và transaction review+mutation ledger nguyên tử; không gọi service rồi ghi ledger riêng và coi là atomic.

## 4. Mất response và Frontend conflict

- Test TCP thật: onSend đóng socket sau PATCH đã commit. GET lại thấy note/version mới; blind retry cùng baseVersion nhận409, không tạo revision thứ hai. Response mất không chứng minh Server chưa lưu.
- FE giữ draft khi409, GET bản Server mới, khóa nút lưu tới khi Analyst chọn cách xử lý. Không tự merge/ghi đè/retry.
- Browser E2E: import Beijing8782 rows → Z-score B5 thật → completed → B6 list/detail. Client B/admin lưu trước thànhv2; client A nhận409, giữ draft, đọcv2, chọn giữ draft trên version mới, chủ động Lưu thànhv3. Reload rồi mở detail đọc được status/note/v3. Detector score/severity/method/readingId được kiểm tra không đổi.
- Existing FE list/analysis results dùng B6 thật; old tests “B6 chưa triển khai→404” đã đổi sang publication semantics, không bỏ hồi quy hoặc dựng empty success. B5 native Isolation Forest test cũng đọc kết quả ML thật qua B6.
- E2E không intercept HTTP và không fake anomaly từ PM2.5 cao. Mapbox token rỗng trong harness; không suy ra đã nghiệm thu tiles/FPS/GPU/Cube renderer mới từ test review.

## 5. CSV chuẩn và trạng thái G01

Chủ dự án cung cấp `.local/demo-datasets/beijing-12-stations-demo-2015-03.csv`. Đã đọc trực tiếp, copy nguyên bytes sang [golden CSV](../../server/tests/fixtures/beijing-12-stations-demo-2015-03.csv), giữ [manifest](../../server/tests/fixtures/beijing-12-stations-demo-2015-03.manifest.json) và [test độc lập](../../server/tests/beijing-fixture.test.ts). `.gitattributes` giữ bytes fixture qua checkout Windows/Linux, không sửa bản nguồn `.local`.

| Kiểm chứng độc lập | Kết quả |
|---|---|
| Bytes/SHA256 | 949343 / `189c1f773f11294d66b06a0097bccfba653496cf08554a733caaf8afdbdd6ff0` |
| Readings/trạm/timestamps | 8782 /12 /739 |
| Trùng station–instant, invalid trong fixture | 0 /0 |
| UTC bounds | `2015-02-28T16:00:00.000Z` → `2015-03-31T15:00:00.000Z` |
| Offset/cadence của fixture | +08:00, mỗi trạm kỳ vọng1 giờ, 31 ngày |
| Expected grid/missing station–hours | 8928 /146 |
| Min/max PM2.5 | 3 /369 ug/m3 |
| 16/03/2015 19:00 +08 | 12 trạm, mean315,5 |
| Nongzhanguan 26/03 21:00 +08 | 369; median11 trạm khác80; trạm này thiếu22h/23h |

Các count/event trên được tính từ CSV bằng test độc lập, không dùng production normalization/detector để tự tạo expected. Source station IDs map sang internal IDs khi B3 import; tọa độ nhất quán theo trạm, timestamp/unit hữu hạn/hợp lệ. Test integration B6 kiểm importer giữ đủ8782 rows/12 sensors, rồi B5/B6 có linkage Reading thật.

**G01 đã có file/checksum/golden facts tái lập trong repo.** Provenance extraction/upstream và độ chính xác nguồn tọa độ chưa được kiểm định độc lập; manifest ghi rõ nguồn do chủ dự án cung cấp và các cột sourceFile/sourceRowNo. Không tuyên bố toàn bộ upstream audit hoặc G04/G05 đã đóng. Cadence/grid này chỉ cho file này, không thành default cho import khác. Median80 chỉ là đối chiếu mô tả, chưa là công thức spatial_delta. Không có anomaly ground truth, không train ML v2 hoặc dùng fixture này trong fit ở lượt B6.

## 6. Kiểm thử, môi trường và giới hạn

| Kiểm tra | Kết quả/phạm vi |
|---|---|
| `npm run check` | Typecheck/lint/unit/build client/server/shared-core đạt; client97, server62, shared-core7 unit tests |
| Server coverage |137 tests/19 files, gồm75 integration; kiểm DB/HTTP/native engines thật, không chuyển mock khi thiếu runtime |
| B6 targeted |4 service/mapping unit tests,10 MongoDB integration tests; contract drift của Anomaly/ReviewChanges/ReviewPatchRequest/page/query |
| CSV golden |1 test bytes/hash/rows/grid/coordinates/event facts độc lập với import/engine |
| Browser B2–B6 |6 E2E qua Backend/Vite/Replica Set thật; B6 thêm CSV→run→review/conflict/reload |
| Coverage V8 | Lines97,56%, statements92,90%, branches90,46%, functions95,26%; module Anomalies lines100%/branches94,87%. Python/scripts và thread coverage không được cộng giả |

Negative/fault tests có nhãn seed/double: queued/running/failed/orphan/cross-dataset/method mismatch; pagination với partial đứng trước; stale preflight không vượt Repository gate; concurrent visibility transaction; two-client CAS; MongoDB validator từ chối commit và rollback fences; TCP response loss; safe version; schema/time/query/auth/405/deferred routes. Cùng Reading được công bố ở hai runs khác nhau, unique(run,reading) chặn trùng trong một run. Review tồn tại khi instance ban đầu đóng và instance khác đọc lại.

Hai E2E B4/B5 cũ đã được điều chỉnh thao tác/locators cho Cube hiện tại: đọc coverage, mở bảng thu gọn, scope đúng region bảng thay vì cộng cả mini-table, mở filter panel và giữ kiểm tra response/page100. Cube auto-pages150 readings trong cửa sổ của fixture B5; các assertion biên/bbox/sensor/paging/selection không bị bỏ và source FE không bị đổi để ép khớp test cũ.

Data/engine thật: source Beijing được import qua HTTP B3 trong DB tạm, Z-score worker chạy/lưu thật rồi B6 review; baseline ML được B5 integration infer thật và B6 đọc thật. Service unit test doubles chỉ để tách validation/error mapping; seed anomalies để chủ động tạo private/invalid states không được gọi là output engine.

Lần này harness dùng binary MongoDB9.0.4 cài sẵn để tạo **mongod tạm**, dù harness default ghi8.2.6. Không sửa/dừng service MongoDB hoặc DB/dataset `.env` của người dùng. Runtime Node24.14.1; production dependencies/architecture không thay. Replica Set là điều kiện PATCH transaction, đã có từ B3/B5; standalone không đủ cho atomic review.

```powershell
# Từ root repo, sau npm ci và setup Python/artifacts của B5 cho integration ML:
$env:MONGOMS_SYSTEM_BINARY='C:/Program Files/MongoDB/Server/9.0/bin/mongod.exe'
$env:MONGOMS_SYSTEM_BINARY_VERSION_CHECK='false'
npm run check
npm run test:coverage --workspace @pm25/server
npm run test:e2e:b6
npm exec --workspace @pm25/server -- playwright test --config playwright.config.ts
```

Không cần Python để riêng B6 read/review một run đã completed; whole-server integration vẫn cần cả environments/artifacts B5 như runbook B5. Test tự tạo DB/storage/ports, đóng processes sau suite; không seed hoặc chạy analysis trên dataset người dùng đang mở.

## 7. Trạng thái còn lại và handoff

- **C1/B6:** APIs, publication guards, CAS và FE review thật đã bàn giao;17/20 online, B7/Admin còn3 operations.
- **G01:** golden bytes/file/facts đã xác minh; upstream coordinate/lineage audit còn ghi nhận để dùng cho bước ML/context. Xem manifest, không lấy tên sourceFile làm bằng chứng chính xác ngoài dữ liệu được cung cấp.
- **G02–G05:** Profile/aggregation/timezone/Feature Contract/model version selection vẫn mở. Không tạo API mới, đổi default/config v1 hoặc nâng limit50k/concurrency.
- **Khải:** model/features/score–severity nâng cao và quality evaluation vẫn phần việc riêng; B6 chỉ lưu review, không biến xác nhận của Analyst thành training labels tự động.
- **Tài:** FE hiện có đã nối API thật; review state/data source giữ nguyên contract. Cube/Mapbox FPS/tiles, UI ML v2 và Exploration tiếp tục theo milestones của chúng.
- **Cường:** đo contention do parent fences, query scans/pagination nhiều private runs và tải/CPU/RAM/CI/TLS ở B8/G06. Không tuyên bố SLA hoặc exactly-once PATCH khi mất response.
- **Sync:** hoãn; future ledger cần transaction thiết kế riêng. Không có exports/review-changes/mutation-batches/internal batch HTTP mới.

Tham khảo thiết kế transaction: [MongoDB production considerations](https://www.mongodb.com/docs/manual/core/transactions-production-consideration/), [Node driver transactions](https://www.mongodb.com/docs/drivers/node/current/crud/transactions/). Trong một transaction các thao tác được await tuần tự, không Promise.all.
