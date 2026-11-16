# C2 — Data Exploration: bàn giao và kiểm chứng

Ngày16/11/2026. Chủ dự án duyệt cả ba nhóm A/B/C của [contract C2](c2-contract-proposal.md); [D018](../decisions.md#d018--c2-data-exploration-api-coverage-và-ngân-sách) đóng G02/G03 và cấu hình khởi đầu C2 thuộc G06. G04/G05/C3 còn mở. C2 không thêm Redis/BullMQ, không đổi worker/model/run/receipt/review v1, chưa triển khai B7/B8 hay Offline/Sync/LOD.

## Phạm vi thật và compatibility

| Hạng mục | Bàn giao |
|---|---|
| GET `/api/v1/datasets/{id}/profile` | API thật, analyst/admin, imported visibility; toàn dataset + scope; thống kê/count/bounds từ MongoDB |
| GET `/api/v1/reading-aggregates` | API thật, per-station hour/day, count/min/max/mean/coverage, bucket rỗng, không truncate |
| Metadata | CLI thật, validate và atomic version increment trên đúng imported dataset; không suy từ filename, không thêm HTTP ghi |
| Frontend | Tab Data Exploration, Profile/quality, chọn trạm, biểu đồ và bảng bucket phân trang hiển thị100 buckets/trang trên response đã tải đầy đủ |
| Timezone | Một lựa chọn workspace UTC/+07:00/+08:00; filter, Map popup/chi tiết, Cube, heatmap, readings table, analysis/review dùng cùng zone; wire UTC giữ nguyên |
| Mock | Hai operations Exploration trả503 `C2_MOCK_NOT_IMPLEMENTED`, UI ghi chưa mô phỏng; không fallback khi online lỗi |
| Chưa làm | IANA/DST tổng quát, station lifecycle, raw missing-value reclassification, ML v2, spatial LOD/cache, Offline/Sync, production load/SLA |

Giữ Fastify/TypeScript/native Driver và Route → Validation → Service → Repository → MongoDB trong module `exploration/`. Shared DTO strict riêng tại `shared-core/src/contracts/exploration.ts`; response JSON Schema được tạo từ Zod, HTTP query schemas riêng, có drift test OpenAPI. Generator thêm2 operations, query-array serializer dùng repeated params để giữ opaque IDs; adapter kiểm strict success/error envelopes. Dependency Zod4.6.7 đã pin trực tiếp ở Server cho schema conversion, không đổi version thư viện.

[Compatibility audit](c2-compatibility-audit.json): so baseline commit được ghi trong artifact,20 operations và33 reachable schemas online cũ không đổi. Tổng OpenAPI26 operations,22 online/health,19 Backend thật;3 Admin B7 vẫn chờ. `reading-aggregates` là migration có chủ đích của draft P1 chưa triển khai; không gọi response cũ `ts/location/average/count` là tương thích với response per-station mới. Các schema draft cũ vẫn được giữ, không sửa Reading DTO.

## Semantics cần giữ khi tích hợp

- Profile/source-quality: totalRows/importedRows/invalid/duplicate/conflicting lấy từ importSummary khi có; missingValueRows vẫn null vì report hiện tại không phân loại đầy đủ NA nguồn. Thiếu importSummary thì count nguồn unknown, không gán0.
- Coverage chỉ known khi có cadence/anchor/expected interval tường minh. Denominator giao expected interval, scope đóng và bucket nửa mở; observedSlots dựa unique(datasetId,sensorId,ts); off-grid/outside-expected đếm riêng, không bù thiếu. Không có expected slots thì not_applicable/ratio null; không có metadata thì unknown/null/reason.
- Bbox C2 chọn tập trạm bằng tọa độ Sensor, rồi intersect snapshot tọa độ Reading; có test drift trực tiếp trong DB. B4 giữ semantics cũ. Không có public API sửa tọa độ trạm imported.
- Khoảng query `[from,to]`, UTC Z≤3 số lẻ, from=to được nhận. Bucket giờ/ngày theo offset cố định, trả ranh giới UTC `[start,end)`. Mẫu đúng `to` thuộc bucket chứa nó; các bucket đầu/cuối chỉ dùng readings/slots thực nằm trong scope. Mean là trung bình readings có thật, không bù giờ thiếu hoặc trung bình lại các mean.
- Dataset metadata chưa cấu hình: source=fallback/+07:00/version=null/sampling=null. Người dùng chọn zone chỉ đổi hiển thị, giữ instant filter/selection/review draft. Đổi dataset/logout xóa lựa chọn trong session; reload nạp default metadata từ Server. Không hứa giữ filter/zone tùy chọn qua reload.
- Profile không lấy2.000 readings FE làm dataset. Map/Cube vẫn báo raw loaded riêng; chart aggregate là derived data toàn scope trong ngân sách. Bảng giờ preview Cube nói “không có reading tại mốc”; kết luận thiếu theo cadence xem Profile.

## Cấu hình và sử dụng

MongoDB Replica Set và cấu hình JWT/DB hiện có tiếp tục áp dụng. C2 không dùng model Python khi truy vấn. Sáu biến `EXPLORATION_*` trong `.env.example` mặc định500.000 readings,20 series,20.000 cells,5 MiB,5.000ms,2 operations/process; chỉ cho giảm trong trần đã duyệt. Hour range≤31×24h, day≤366×24h. Full Profile vượt500.000 readings bị422, kể cả scoped nhỏ; không giả full summary từ trang dữ liệu. Aggregates giới hạn matching readings.

Lỗi400 schema;401/403 auth;422 missing/not-imported dataset, foreign sensor, semantic filter hoặc vượt budget;503 busy/deadline/DB unavailable;500 lỗi bất ngờ. Không báo empty/complete khi lỗi. Slot admission bao trùm toàn operation, không queue vô hạn; timer/AbortSignal hủy DB work và trả lại slot. Mongo maxTimeMS và socketTimeoutMS dùng thời gian còn lại **riêng C2**; cấu hình2s của các API cũ giữ nguyên. Điều này tránh socket cũ ngắt C2 trước ngân sách5s. Byte budget đo envelope JSON trước trả; deadline kiểm lại sau tạo/validate/đo payload.

Sau khi import **đúng file Beijing đã kiểm chứng**, lấy datasetId thực từ response/UI, cấu hình tường minh bằng lệnh ở root repo:

```powershell
npm run db:exploration --workspace @pm25/server -- DATASET_ID tests/fixtures/beijing-exploration-metadata.json
```

CLI dùng `.env` hiện tại: xác nhận đúng URI/database và datasetId trước chạy. File mẫu này chỉ cho fixture Beijing03–2015: +08:00, cadence3600s, anchor/from=`2015-02-28T16:00:00.000Z`, to=`2015-03-31T15:00:00.000Z`. Không áp vào dataset khác chỉ vì cùng tên. Không có script tự sửa DB người dùng trong test/benchmark. Với dataset khác, tạo JSON riêng có timezone/provenance và sampling đủ bộ hoặc null.

Mở Workspace → Data Exploration. Chọn cùng scope; hour/day và trạm so sánh. Nếu API báo quá nhiều trạm/khoảng/cells/bytes, thu hẹp bằng bộ lọc/chọn trạm, không cố tải tiếp một “trang” aggregation chưa có trong contract. Profile lỗi có nút thử lại; không dùng kết quả cũ cho filter mới. Timezone workspace cũng áp dụng khi quay lại Visualization/Analysis/Anomalies.

## Kiểm thử và số đo

- `npm run check`: typecheck/generate/lint/unit/build toàn repo đạt; client100 tests, server66 unit/contract tests, shared-core7 tests.
- `npm run test:coverage --workspace @pm25/server`: **147/147 tests,22 files**, gồm81 integration tests dùng MongoDB Replica Set thật. Tổng lines97,75%, branches90,71%; module Exploration lines100%, branches93,40%. Không coi coverage là chứng minh mọi fault hoặc SLA.
- C2 có6 integration tests: B3 upload/mapping/import CSV thật, golden/profile/hour/day, query repeated IDs và bbox drift, unknown/empty/off-grid/closed-boundary, auth/schema/visibility, reading/series/cell/byte limits; failCommand chặn aggregate trên MongoDB thật buộc503 rồi request sau200. Test failpoint chỉ bật trên mongod dùng một lần của suite.
- Unit test riêng kiểm admission hai slots/503 thứ ba, cancellation/release, resource timeout và recheck publication; đây là repository fault injection, phân biệt với test Mongo thật phía trên. Drift test đối chiếu query và strict response với OpenAPI; adapter examples là contract-only, không phải dữ liệu nghiệm thu.
- C2 browser test dùng login/import/UI/API/DB thật, CLI metadata function, Profile/aggregation, UTC day boundary, giữ scope instant khi đổi zone, event mean315,5 và reload. Không intercept success để dựng kết quả C2.
- Lượt E2E Backend cuối: **7/7 passed**, gồm B2, hai luồng B3, B4, B5, B6 và C2; DB/API thật. Hai kỳ vọng cũ “aggregation404”/“chưa có metadata” và labels UTC+07 trong tests đã được migrate theo D018, giữ kiểm auth/filter/visibility/CAS. Frontend-only HTTP/mock suites được ghi riêng, không lấy làm bằng chứng Backend thật.
- Frontend-only Chromium QA: **27/27 passed** (6 mock,21 HTTP-intercept online), gồm Map/Cube/camera, partial raw2000, retry/empty, review, admin mock và responsive1440/1024/390. Đây không phải27 Backend E2E. Lượt này cần `VITE_MAPBOX_TOKEN=''` khi build và chạy để đúng các case kiểm fallback token; lượt đầu dùng token từ máy đã đổi default view và làm sai giả định test. Không đổi token/.env của người dùng. Toolbar C2 được gom gọn để giữ ca canvas cao≥520px và bắt đầu trước560px trên viewport1440×1000, không nới assertion layout. Formatter tái sử dụng instance Intl, tránh tạo hàng nghìn formatter mỗi lần render toàn tháng.

Lệnh MongoDB trên máy hiện tại:

```powershell
$env:MONGOMS_SYSTEM_BINARY='C:/Program Files/MongoDB/Server/9.0/bin/mongod.exe'
$env:MONGOMS_SYSTEM_BINARY_VERSION_CHECK='false'
npm run test:coverage --workspace @pm25/server
npm run test:e2e:c2
npm run benchmark:exploration --workspace @pm25/server
```

Tái chạy frontend-only QA (PowerShell7.6 đã dùng, biến chỉ áp cho process hiện tại; build trước preview):

```powershell
$env:VITE_MAPBOX_TOKEN=''
npm run build --workspace @pm25/client
$env:PM25_E2E_MOCK_PORT='15173'
$env:PM25_E2E_ONLINE_PORT='14173'
npm exec --workspace @pm25/client -- playwright test --workers=1
```

Harness yêu cầu binary8.2.6 trong cấu hình cũ, nhưng lượt này override bằng **mongod9.0.4** đã cài; không nhận đã kiểm8.2.6. Mỗi test/benchmark có DB/Replica Set dùng một lần, không dùng DB/service Mongo của người dùng. B5 regression vẫn chạy statistical thread và Python/model v1 thật theo suite hiện có.

Golden oracle độc lập: **8.782 readings,12 trạm,739 timestamps,146 thiếu trên8.928 station–hours**, min3/max369, không trùng station/time. 12×744 bucket giờ,146 bucket count0/mean null. Event16/03/2015 19h+08 mean315,5; Nongzhanguan26/03 21h+08=369,22h/23h không có mẫu. Nguồn tọa độ/extraction upstream chưa được kiểm định độc lập; fixture không phải nhãn anomaly hoặc duyệt train ML v2.

[Số đo và explain](c2-query-measurements.json), Windows/Ryzen5 5500U/Node24.14.1/Mongo9.0.4, HTTP localhost thật,3 lần tuần tự/case gồm lần đầu:

| Input | Profile (ms) | Hour (ms) | Day (ms) |
|---|---|---|---|
| Golden CSV seed8.782/12 trạm |55,78–152,83|269,43–431,76|75,37–83,09|
| Synthetic500.000/20 trạm, cadence1 phút |2.335,23–2.500,97|2.986,14–3.458,32|3.060,34–3.100,77|

Golden hour response2.133.843 bytes; synthetic hour2.023.767 bytes, đều dưới5 MiB. Explain dùng cùng pipeline production, không hint/tạo index mới, có các index hiện hữu trong query plans. Profile/aggregate counts khớp input, không cắt50.000/2.000 theo B5/FE. Golden timing seed trực tiếp từ CSV, **không phải B3 import benchmark**; import correctness được kiểm riêng qua integration/E2E.

Node RSS growth lấy mẫu từng5ms, cao nhất khoảng180MB trong synthetic hour; gồm cả Server, validation và HTTP-client harness cùng process, không gồm mongod và không phải isolated peak. Chưa đo concurrent500k load,100VU/10 phút, RSS toàn Mongo/Python, GPU/FPS/Mapbox tiles thật hoặc SLA production. Không tăng ngân sách từ số đo này.

## Phân công và phần tiếp theo

Khiêm: API/contract/CLI/query. Tài: UI/adapter/timezone/loaded-vs-total. Cường: môi trường/runtime/load/kiểm thử phối hợp. Khải: nguồn/cadence/domain review; thuật toán/ML v2 thuộc C3 sau G04/G05. Bằng chứng chạy trong checkout không thay chữ ký nghiệm thu của từng owner. C3, B7/B8 và audit upstream tiếp tục backlog; không tự train/đổi model vì đã hoàn tất Exploration.
