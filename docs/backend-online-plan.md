# Kế hoạch triển khai Backend P0 online — PM2.5

Ngày lập: 13/11/2026. Cập nhật 14/11/2026: **B1–B3 đã triển khai: 9/20 operations online có API thật, gồm health, auth/me, datasets list và wizard import. 11 operations B4–B7 chưa triển khai.** Xem [B1 verification](backend/b1-verification.md), [B2 verification](backend/b2-verification.md), [B3 verification](backend/b3-verification.md).

## 1. Mục tiêu và cơ sở lập kế hoạch

Xây dựng Backend phục vụ trọn luồng online của [kế hoạch Frontend](frontend-online-plan.md): Register → Login → chọn hoặc nhập dataset → tra cứu cho Mapbox 3D/Space–Time Cube → phân tích thống kê/ML → xem và review anomaly; admin quản lý tài khoản. Giữ Fastify + TypeScript, Feature-based Modular Monolith và các tầng **Route → Validation → Service → Repository → MongoDB** theo SDD.

Nguồn đã đọc và đối chiếu:

- [SRS v0.5](SRS.md): chức năng, BR-01–15, BR-19 và các mục tiêu kiểm thử liên quan online; phần offline của SRS không thuộc đợt triển khai này.
- [SDD v0.4](SDD.md): kiến trúc, phân tầng, luật phụ thuộc và ranh giới engine/ML/hạ tầng.
- [OpenAPI v0.3.0-draft](api/openapi.yaml) và [API README](api/README.md): nguồn chuẩn HTTP; có thiết kế không đồng nghĩa đã có implementation.
- [MongoDB Physical Design](mongodb-physical-design.md), [script index đề xuất](../infra/mongo/indexes.js), [Shared Data Contract](shared-data-contract.md), [Zod schema dự thảo](../shared-core/src/contracts/schemas.ts).
- [Ownership](ownership.md), [Technical Decisions](decisions.md), README của server/shared-core/infra/tests và cấu hình workspace hiện tại.
- [Frontend M0 audit](frontend/m0-readiness.md), [M2 verification](frontend/m2-verification.md), adapter online và fixtures hiện có để xác định đúng thời điểm bàn giao.


**Xác nhận của người dùng khi lập kế hoạch:** giữ các quyết định kỹ thuật chưa rõ ở trạng thái mở, ghi owner và mốc bắt buộc phải chốt trước triển khai/nghiệm thu phần liên quan; không chọn thay nhóm. Hoãn HTTP handler nội bộ `POST /api/v1/reading-batches`, nhưng vẫn triển khai đầy đủ batch import trong Service/Repository. Không sửa OpenAPI, không triển khai code trong công việc lập kế hoạch này.

### 1.1. Hiện trạng có bằng chứng

| Thành phần | Hiện trạng kiểm tra | Hệ quả cho kế hoạch |
|---|---|---|
| `server/` | B1–B3 có health/auth/list/import thật, streaming, receipt bền vững, transactions và recovery | FE M2/M3 đã E2E thật; B4–B7 và engine/ML còn chờ |
| Root workspace | Scripts check/build/typecheck/lint/test đã bao phủ client + server; dev client giữ nguyên, thêm dev:server | Integration MongoDB thật chạy riêng bằng `npm run test:server:integration` hoặc server coverage |
| `client/` | FE đến M7; M2/M3 đã chạy với API thật, các phần còn lại vẫn mock/intercept hoặc API chưa có | Dùng B3 verification cho bàn giao wizard; không coi Query/Analysis/Admin đã tích hợp |
| `shared-core/` | Đã có package Zod và DTO/contract đã migrate D008; **chưa có bằng chứng engine statistical/ML chạy thật phía Server** | Chữ ký/fixture không chứng minh engine chạy; B5 phụ thuộc sản phẩm thật của Khải |
| `infra/`, `tests/` | Harness DB thật, B3 kiểm tra replica-set transaction/recovery; 13 indexes online trên DB tạm | Cường tiếp tục Docker/Nginx/TLS/CI, persistent volume, timeout và stress; Sync vẫn hoãn |
| Tài liệu | Một số mục lục, đoạn SDD/DB và báo cáo FE M0/M1 giữ version/URL/số operations cũ | Dùng file nguồn hiện tại: 25 operations tổng cộng, 20 thuộc online/health; không tạo alias URL cũ |

Phần “client mới có README” trong mở đầu kế hoạch FE và các dòng M2 ở thời điểm lập plan là mô tả lịch sử; hiện dùng [M7 verification](frontend/m7-verification.md) cùng source FE để xác định tiến độ. Test E2E dùng intercept/mock không phải bằng chứng Backend thật. B0 chỉ cập nhật tài liệu; B1–B3 hiện có bằng chứng runtime riêng cho health/auth/list/import; các phần B4–B7 vẫn chờ API/engine thật.

## 2. Phạm vi và ranh giới

### 2.1. Phần phải hoàn thành

| Khu vực | Kết quả Backend cần có | Truy vết |
|---|---|---|
| Nền tảng | Fastify, cấu hình, MongoDB, readiness, validation/serialization, lỗi, logging, auth/RBAC, pagination, idempotency cho POST được quy định | SDD; NFR-01/02/03/06/08 |
| Tài khoản | Register analyst, Login, current user; list/create/update user cho admin | P01/P01a/P08; FR-01/01a; BR-14 |
| Datasets/import | Upload CSV/JSON, validation, xác nhận mapping, normalization, batch import, báo cáo BR-08 và visibility gate | P02/P03; FR-02–05; BR-01–08 |
| Query | Datasets imported, sensors/readings đúng dataset, trạm, bbox, thời gian, sort/cursor được hỗ trợ | P04; FR-06; dữ liệu phục vụ FR-09 |
| Analysis online | Tạo/lưu run, tích hợp thống kê shared-core và ML inference phía Server, lịch sử và kết quả truy vết được | P05; phần online FR-07/08; BR-09–12/19 |
| Anomaly/review | List/detail, PATCH status/note bằng CAS version; không thay đổi kết quả detector | P06; FR-10; BR-13/15 |
| Chất lượng | Unit, contract, MongoDB integration, E2E online, load/performance, coverage và tài liệu vận hành | NFR-06–09 |

### 2.2. Ngoài phạm vi lần này

- Hoãn `GET /api/v1/exports`, `POST /api/v1/review-mutation-batches`, `GET /api/v1/review-changes`: chưa triển khai prefetch, push/pull, receipt offline hay checkpoint. FR-11/12, NFR-04/05 và AT-06A–F chưa được nghiệm thu bởi kế hoạch này.
- Hoãn `GET /api/v1/reading-aggregates` (P1), LOD và thuật toán mở rộng/so sánh nâng cao P2.
- Hoãn HTTP handler `POST /api/v1/reading-batches` theo xác nhận người dùng. Import gọi nghiệp vụ batch trong monolith; không tự gọi HTTP nội bộ, không công bố route này qua Nginx hoặc cho JWT analyst/admin. Giữ nguyên mô tả `x-internal` trong contract để tích hợp sau.
- Không xây PWA, IndexedDB, outbox, Browser Worker, session restoration, renderer hay proxy tiles Mapbox trong Backend.
- Không bổ sung GET dataset/reading theo ID, catalog detector, refresh token, logout Server, reset password, email verification hoặc dashboard KPI. **GET `/api/v1/analysis-runs/{id}` và polling theo D008/D009 vẫn thuộc phạm vi online**; không thêm endpoint job ngoài contract hiện hành.
- **MongoDB Official Node.js Driver (`mongodb`) đã chốt cho B1 tại D010**, không dùng Mongoose. Redis/BullMQ, queue/process topology, model artifact/features và các tham số chưa được duyệt vẫn để mở.

**Giữ khả năng tích hợp sau:** bảo toàn public DTO/ID, UTC, version/updatedAt và CAS review; service review có public interface để luồng sync sau này tái sử dụng nghiệp vụ. Không gộp `Idempotency-Key` của POST online với `clientMutationId` của offline. `processedMutations` vẫn thuộc thiết kế tổng thể nhưng chưa có workflow sync trong P0 online; không tự dùng collection này làm kho idempotency online. Khi bổ sung sync phải thiết kế transaction cập nhật review + receipt nguyên tử với Duy/Cường; PATCH online hiện tại không chứng minh sync đã an toàn.

## 3. Kiến trúc triển khai

### 3.1. Cấu trúc và trách nhiệm các tầng

```text
server/
  src/
    app.ts                   # tạo ứng dụng để chạy hoặc inject khi test
    main.ts                  # start/stop runtime
    plugins/                 # cấu hình, MongoDB, auth, lỗi, logging
    modules/
      health/
      auth/
      users/                 # user nghiệp vụ và admin routes
      datasets/              # upload, validation, mapping, import, list
      sensors/
      readings/
      analysis/              # điều phối run và adapter engine/ML
      anomalies/             # query, detail, review CAS
    shared/                  # HTTP/pagination/idempotency/DTO mapping hỗ trợ
  tests/                     # unit/contract/integration theo feature
```

Đây là cấu trúc dự kiến theo SDD, chưa phải scaffold đã tạo. Mỗi feature dùng `*.routes.ts`, `*.schema.ts`, `*.service.ts`, `*.repository.ts`, `index.ts` khi cần persistence. Dùng Fastify plugin/encapsulation và DI tối giản bằng factory/constructor; không thêm DI container, CQRS hoặc event bus.

| Tầng | Trách nhiệm | Ràng buộc |
|---|---|---|
| Route | Bind method/path, auth hook, gọi service và ánh xạ HTTP response | Không parse/import toàn file hoặc viết query MongoDB trong handler |
| Validation | Kiểm tra params/query/body/header/media type theo từng operation; dữ liệu miền theo SRS/shared contract | Không dùng Zod DTO thay thế toàn bộ HTTP schema; không âm thầm strip trường trái schema như role ở Register |
| Service | RBAC nghiệp vụ, trạng thái import/run, toàn vẹn tham chiếu, dedup, điều phối engine và review | Không phụ thuộc route; không truy cập repository nội bộ feature khác |
| Repository | Truy vấn, conditional update, batch persistence, mapping BSON ↔ dữ liệu miền/DTO | Che MongoDB Official Driver và BSON mapping; không quyết định HTTP status hoặc thuật toán detector |
| MongoDB | Lưu dữ liệu, unique/time/geo indexes, atomic update | Không tự bảo đảm foreign key, first-valid-row-wins hay toàn bộ workflow |

Cross-feature chỉ qua public interface: Auth/Admin tái sử dụng nghiệp vụ User; Query/Analysis kiểm tra trạng thái dataset qua interface Dataset; Analysis lấy readings theo phạm vi và ghi kết quả qua interface được expose. Đầu vào detector là shared DTO, không phải MongoDB document hoặc Fastify request. ML adapter chỉ ở Server; thuật toán thống kê của Khải không phụ thuộc Fastify/MongoDB/DOM/Node-only API.

### 3.2. Các bất biến cần giữ khi triển khai

- URL chuẩn `/api/v1`; giữ đúng envelope riêng: login/health/validation trả trực tiếp, analysis tiếp nhận/detail `{data: run}`, list `{data, page}`, object `{data}`. Health `503` vẫn là `HealthResponse`, không đổi thành Error thông thường.
- Chỉ public health/register/login; API nghiệp vụ yêu cầu JWT và quyền analyst/admin; admin routes chỉ admin. Không lộ password/hash/token trong log hoặc trường nội bộ DB trong response. Register/Admin dùng cùng logic tạo User và unique username.
- Lỗi theo operation trong OpenAPI: phân biệt cú pháp/query `400`, semantic `422`, auth `401`, quyền `403`, conflict `409`; `401` có `WWW-Authenticate`, `405` có `Allow`. Không tự biến mọi lỗi Fastify thành cùng một mã. Không phát sinh status/body mới cho tình huống chưa rõ; đưa vào bảng quyết định trước khi triển khai nhánh đó.
- List `limit` mặc định 100, tối đa 200; keyset có tie-break `_id` nội bộ, cursor opaque gắn fingerprint filter/sort; cursor không tương thích trả `400`. Không thêm offset/total count, không cam kết snapshot khi dữ liệu thay đổi giữa các trang.
- ObjectId/Date ở persistence → ID string/UTC ISO Z ở API. `externalId` là mã trạm nguồn; `sensorId` của Reading là ID nội bộ. Location WGS84 `[lon,lat]`, value hữu hạn và không âm; `0` hợp lệ, số rất cao không tự bị loại.
- Dataset chỉ công bố sau `imported`; gate áp dụng ở mọi đường đọc/phân tích, không chỉ danh sách dataset. Không để truy vấn bằng ID biết trước đọc được dữ liệu nhập dở.
- BR-08: chuẩn hóa rồi kiểm tra theo thứ tự dòng; giữ bản ghi hợp lệ đầu tiên, tách duplicate/conflict và dòng được giữ. Unique index là hàng rào cuối, không thay cho thuật toán dedup.
- Bốn POST bắt buộc key UUID: upload, import, analysis, admin-create. Trong phạm vi user: cùng key/payload đã hoàn tất trả lại cùng status/body; đang xử lý trả `409`; key cũ khác payload trả `422`; thiếu/sai key trả `400`. Upload fingerprint gồm nội dung file và metadata. Riêng Analysis, hoàn tất ở đây là tiếp nhận bền vững, không đợi inference; replay 202 cùng run sau tiếp nhận, 409 chỉ trong cửa sổ tiếp nhận chưa hoàn tất. B3 đã hiện thực receipt/recovery/24h replay theo D012; B5/B7 phải tích hợp effect riêng và chốt các gate còn lại trước triển khai.
- Review chỉ status/note, `baseVersion` dương, CAS tăng version và cập nhật updatedAt cùng thao tác. Không sửa score/severity/method. POST idempotency, PUT mapping idempotence và PATCH CAS là ba cơ chế khác nhau.

### 3.3. Persistence và chỉ mục

P0 online sử dụng `users`, `datasets`, `sensors`, `readings`, `analysisRuns`, `anomalies` và private `idempotencyReceipts` được duyệt thêm tại D012/B3. Áp dụng/review các unique keys đã thiết kế: `usernameNormalized`, `(datasetId,externalId)`, `(datasetId,sensorId,ts)`, `(analysisRunId,readingId)`. Index thời gian/geo/cursor lấy từ physical design và kiểm tra bằng explain; script hiện tại chưa phải bằng chứng DB có index.

File nguồn lưu an toàn ngoài MongoDB, tham chiếu/checksum nội bộ; nơi lưu persistent, retention và phục hồi B3 đã chốt tại D012. Import tuần tự theo batch hoặc phương án staging giữ thứ tự được review; không dùng một transaction khổng lồ cho file 500k readings, không dùng unordered upsert cạnh tranh để chọn dòng thắng. Dataset failed phải được cô lập; retry có chủ đích dọn dữ liệu attempt cũ và xử lý lại toàn bộ nguồn theo BR-08.

Thiết kế tổng thể đã yêu cầu replica set cho sync transaction về sau. Cường chuẩn bị môi trường phù hợp; không giả định MongoDB standalone chạy được multi-document transaction nếu lựa chọn nhất quán online cần dùng nó. D012 đã chốt collection receipt và transactions online B3; cơ chế bảo vệ last admin B7 và execution/queue B5 vẫn cần quyết định riêng.

## 4. Các milestone và tiêu chí hoàn thành

Mã **B0–B8** là mốc Backend; **FE M0–M8** trỏ tới kế hoạch Frontend hiện tại. Checkbox là việc tương lai, không được đánh dấu đạt chỉ vì đã có tài liệu, fixture hoặc test double. Blocker ở mục 6 chặn đúng phần phụ thuộc; không buộc dừng các feature độc lập.

### B0 — Rà soát hợp đồng và đầu vào bàn giao

**Mục tiêu:** Có backlog triển khai và ma trận kiểm chứng thống nhất trước khi viết API; phân biệt điều đã có trong contract với điều cần quyết định.

**Endpoint:** rà soát 20 operations ở mục 5; không tạo runtime hoặc endpoint mới.

- [x] **Rà soát tĩnh** OpenAPI ↔ 20 generated operations/online adapter; kiểm tra Register, envelope, review/Idempotency-Key ở mức contract. **Chưa coi là xác nhận của Tài hoặc integration API thật.**
- [x] **Đã ghi nhận và phân loại** C02–C04: minLength Zod chặt hơn OpenAPI; miền tọa độ, UTC Z/precision cần quyết định theo luồng. **Review/duyệt với Khải + Tài vẫn chưa hoàn tất**, không đổi schema.
- [x] Đã phân loại quyết định theo mục 6, owner/mốc phụ thuộc; **Official Driver chốt tại D010**, Redis/BullMQ chỉ là phương án B5; OPEN/NEW khác chưa được tự đóng.
- [x] Thống nhất quy ước báo cáo `chưa triển khai / mock / API thật + seed / tích hợp engine thật`, dữ liệu seed được ghi nhãn và acceptance theo feature.
- [x] Cường/Khiêm thống nhất cách dựng DB test, account analyst/admin, env, port/build/start, kiểm tra readiness; xác định luồng bàn giao endpoint trước FE M3–M8.

**Bằng chứng B0 (14/11/2026):** 25 HTTP operations trong OpenAPI (21 paths), 20 operations P0 online/health khớp method + URL với generated adapter; 38 fixture HTTP cases có operation/status tương ứng; 232 lượt tham chiếu schema không phát hiện tên thiếu. Kiểm tra độc lập trên **subset JSON Schema** của generated client contract: 38/38 fixture cases, 7/7 core DTO, 7/7 legacy payload, trường hợp partial-review bị từ chối. **Không coi đây là chạy đầy đủ `docs/frontend/verify_m0.py`, parser/ref validator chuẩn, kiểm thử Fastify/MongoDB hay E2E thật.** Báo cáo M5 trong repo ghi bộ Python đã đạt ở thời điểm FE triển khai nhưng không phải lượt test Backend này. Quyết định và định hướng B0: [D010](decisions.md#d010--mongodb-official-driver-và-ranh-giới-triển-khai-b0).

**Trạng thái cổng B0 → B1:** **Đủ điều kiện bắt đầu scaffold B1**. B0 hoàn thành phần rà soát và quyết định thuộc trách nhiệm Khiêm, đủ điều kiện triển khai B1.

**Dependency:** tài liệu/checkout hiện tại; review Khiêm–Tài–Khải–Cường, Duy khi chạm shared DTO/interface tương lai. Driver đã chốt cho repository B1; các blocker import/analysis không chặn scaffold.

**Kiểm thử/kiểm tra:** kiểm tra parse/ref của OpenAPI; validate fixtures theo request/response từng operation bằng công cụ hiện có; đối chiếu 20 operations với online adapter. Đây là kiểm tra contract tĩnh, không phải test API thật. Kết quả chạy trong mốc này phải ghi riêng, không sao chép số test lịch sử FE thành bằng chứng mới.

**Bàn giao/ nghiệm thu:** ma trận endpoints, backlog feature/test, danh sách lệch và decision gates được ghi rõ. FE tiếp tục mock đúng hợp đồng; các vấn đề chưa chốt có owner và hạn theo mốc, không có endpoint ngầm định.

### B1 — Nền Fastify, MongoDB và cơ chế dùng chung

**Mục tiêu:** Server khởi động/test được, tuân phân tầng với **MongoDB Official Driver** đã chốt và sẵn sàng thêm các feature độc lập.

**Endpoint:** `GET /api/v1/health` → `200` hoặc `503` đúng `HealthResponse`.

- [x] Khởi tạo package server/TypeScript, build/start/dev/typecheck/lint/test; root check bao phủ client + server, dev client giữ nguyên. Dependencies khóa trong package/lockfile.
- [x] Tách app factory khỏi listen; config/MongoDB lifecycle, log redaction, error envelope và HTTP serialization có kiểm thử.
- [x] Feature health/public interface theo các tầng; Official Driver ở plugin/repository, mapper whitelist ID/date/location, helper cùng dataset và keyset repository có test.
- [x] Chuẩn bị HTTP validation, JWT/RBAC hooks với verifier được inject, bounded sort/cursor và interface idempotency/replay. **JWT thật thuộc B2; durable idempotency/retention vẫn chưa triển khai.** C02–C04 nghiệp vụ còn mở.
- [x] Đã áp dụng/kiểm tra lặp lại 11 indexes online trên MongoDB thật tạm; test unique/geo và keyset. Chưa benchmark B4/B8 hoặc tự tạo index trên DB người dùng.
- [x] Health `200/503` được kiểm tra với mongod thật, mất DB/phục hồi và đóng topology khi app.close; có main SIGINT/SIGTERM handlers. Môi trường test local đã tái lập; Docker/replica-set/Nginx HTTPS do Cường tiếp tục ở hạ tầng, chưa được nghiệm thu bởi B1.

**Dependency:** B0; driver/ODM và công cụ validation được review; Cường cung cấp DB/environment. Không cần chờ model ML, PWA hoặc sync.

**Kiểm thử:** Vitest cho config/mapper/cursor/error; Fastify inject cho health, envelope và method `405/Allow`; integration với MongoDB thật cho readiness khi DB sống/mất kết nối, indexes và mapping BSON. Test logging không xuất secret. Mock DB chỉ dùng unit test, không thay readiness integration.

**Bàn giao/ nghiệm thu:** build/typecheck/lint/test nền đạt; health phản ánh DB thật; hướng dẫn env/start/test tái lập được. FE M1 có base URL/health thật, các API khác vẫn được ghi chưa triển khai.

**Bằng chứng B1 (14/11/2026):** [báo cáo kiểm chứng](backend/b1-verification.md), [hướng dẫn Server](../server/README.md). Root check đạt (client 76 tests, server unit/HTTP/contract 14 tests); server coverage gồm 4 integration tests với mongod thật, tổng 18 tests. HTTP socket, compiled main và index CLI đã smoke trên DB tạm. Không có handler nghiệp vụ/engine hoặc đồng thuận owner ngoài phạm vi này được suy ra từ kết quả B1.

### B2 — Auth/Register, User nền và Datasets list

**Mục tiêu:** Thay mock cho luồng FE M2 sớm nhất; có tài khoản và dataset seed để bắt đầu tích hợp.

**Endpoint:** `POST /auth/register` → `201 UserResponse`; `POST /auth/tokens` → `200 LoginResponse`; `GET /users/me` → `200 UserResponse`; `GET /datasets` → `200 DatasetPage`. Tất cả paths sau `/api/v1`.

- [x] Có User service/repository dùng chung, trim + lowercase cho usernameNormalized và unique index trước insert; scrypt async/salt/profile/concurrency theo **D011**. Dùng lại cho CLI/future Admin B7.
- [x] Register public chỉ username/password, password tối thiểu 8 ký tự; reject role/isActive/trường ngoài schema bằng 422; tạo analyst/active, trùng username 409 kể cả race. 201 không token/hash/password; không auto-login.
- [x] Login trả accessToken/tokenType/user; lỗi 401 chung cho sai thông tin/unknown/inactive; JWT HS256 hạn 1 giờ, secret env ≥32 byte, role/isActive đọc lại mỗi protected request. Login rate limit trước scrypt, 429/Retry-After; ngưỡng mặc định 10/60 giây/IP có env, không phải kết quả benchmark tải.
- [x] Datasets list chỉ imported; createdAt hai chiều/default desc, bounded keyset có ID tie-break; cursor ký và ràng buộc sort, empty envelope đúng. Secret ổn định qua restart giữ cursor hợp lệ.
- [x] Có CLI db:seed với username/password từ env, không password mặc định/HTTP bootstrap; chạy lại không reset user. Dataset `[SEED B2]` ghi rõ metadata thử, chưa qua import thật.
- [x] E2E browser FE online + API/DB thật: Register → Login → reload/me → datasets/workspace, admin menu và inactive/401 kết thúc phiên. Giữ deep-link metadata fallback hiện có; Tại thời điểm B2 chưa có API B3; hiện B3 có báo cáo kiểm thử riêng, B4+ vẫn chưa giả response để nghiệm thu.

**Dependency:** B1; quyết định username normalization, password/JWT config, hiệu lực role/isActive và account bootstrap ở mục 6. Không phụ thuộc B3 hoặc Khải.

**Kiểm thử:** service unit cho validation/mapping user; inject/DB integration cho Register → Login → me; password lưu hash; JWT thiếu/sai/hết hạn và hai role; register gửi role bị từ chối; concurrent username create chỉ tạo một user; không lộ hash trong mọi response. Dataset test mọi trạng thái, sort hai chiều, cùng createdAt nhiều bản ghi, cursor/filter sai và empty page. Tài/Cường chạy FE M2 với Server/MongoDB thật, bỏ HTTP intercept cho suite nghiệm thu.

**Bàn giao/ nghiệm thu:** FE Register/Login/reload/datasets dùng được API thật; dữ liệu vẫn tồn tại sau restart; account/dataset seed có nhãn. B2 chưa chứng minh import hoặc analysis hoạt động. Test cạnh tranh Register với HTTP admin-create được bổ sung ở B7.

**Bằng chứng B2 (14/11/2026):** [báo cáo kiểm chứng](backend/b2-verification.md), [D011](decisions.md#d011--quy-tắc-user-và-xác-thực-b2), [Server README](../server/README.md). Root check: client 76 tests, server 24 unit/HTTP/contract tests; coverage suite 35 tests gồm 11 integration tests MongoDB thật. Browser E2E 1 kịch bản thật, không intercept. Đã kiểm tra app + mongod restart giữ User/hash và token, username race giữa Register và common User service tạo admin; **HTTP Admin B7 chưa triển khai**.

### B3 — Upload, validation, mapping và batch import

**Trạng thái 14/11/2026:** implementation và kiểm thử B3 đã có; xem [bằng chứng/runbook](backend/b3-verification.md), quyết định [D012](decisions.md#d012--import-b3-và-durable-idempotency). Chưa thay nghiệm thu thủ công của Tài/Cường hoặc gate Query B4.

**Mục tiêu:** FE M3 hoàn tất wizard bằng API thật, công bố dataset đúng BR-08 và không lộ dữ liệu nhập dở.

**Endpoint:** `POST /datasets` → `201 SingleDataset`; `GET /datasets/{id}/validation` → `200 ValidationReport` trực tiếp; `PUT /datasets/{id}/mapping` → `200 SingleDataset`; `POST /datasets/{id}/imports` → `200 SingleDataset`. GET datasets của B2 xác minh kết quả.

- [x] Triển khai idempotency bền vững theo phương án đã review, dùng chung cho B5/B7: claim/replay/fingerprint, in-flight, lỗi và recovery sau restart/mất response; không chỉ cache RAM rồi coi đã đạt.
- [x] Upload multipart file/name, parse CSV/JSON, lưu nguồn an toàn ngoài MongoDB và metadata dataset. Dùng Node.js Streams/async I/O với backpressure, giới hạn RAM, số file/request xử lý đồng thời; không tải toàn bộ nguồn lớn vào heap. Giới hạn file/batch/report/timeout theo OPEN-05 đã chốt; xử lý `413/415/422/503` đúng operation.
- [x] Validation report gồm sourceColumns, counts, mappingSuggestions và issues theo schema. Không tự thêm số trạm imported, metadata file, mapping đã lưu hay download-report endpoint vào response.
- [x] PUT mapping thay toàn bộ fieldMap, đủ sensorId/latitude/longitude/timestamp/value và unit `ug/m3`; kiểm tra cột nguồn tồn tại, mapping được xác nhận và trạng thái cho phép. PUT lặp cùng nội dung không tạo nghiệp vụ mới.
- [x] Normalize UTC và WGS84, sensor externalId → ID nội bộ; giải quyết timestamp thiếu offset/đơn vị nguồn/tọa độ trạm bất nhất theo quyết định được duyệt, không dùng timezone hiển thị FE để đoán nguồn.
- [x] Import claim trạng thái bằng CAS/importAttemptId; xử lý theo stream, gom batch bounded và dùng MongoDB driver `bulkWrite()` với thứ tự/partition đã kiểm soát (hoặc pre-dedup chứng minh tương đương BR-08). **Không dùng unordered upsert cạnh tranh để chọn winner**; chuẩn hóa trước dedup, giữ first valid row, đếm duplicate/conflict/invalid và keptRowNumber. Giới hạn concurrency, không dùng một transaction khổng lồ. Không gọi HTTP reading-batches.
- [x] Đặt imported sau khi persistence và report hoàn tất; failure/restart giữ dataset không public, cleanup/retry theo lifecycle đã duyệt. Request khác khi importing trả `409`; dataset đã imported không nhập lại; cùng key phải replay đúng kết quả cũ.
- [x] Thống nhất recovery wizard trong khả năng validation API: có status và datasetId nhưng không đủ khôi phục metadata/mapping/key. Không hứa resume đầy đủ hoặc tự import lại khi chưa biết kết quả request cũ.

**Phân biệt sync/async:** HTTP Import **đồng bộ**: chỉ trả thành công 200 sau khi hoàn tất persistence/report. I/O dùng stream và promise **không** biến endpoint thành job 202; Client chờ response hoặc nhận lỗi/timeout theo contract. Khi mất phản hồi, trạng thái thực tế có thể chưa rõ: không tự đổi key hay tự chạy lại nếu chưa có cơ chế đối soát/replay; giới hạn request/proxy timeout phải đo/chốt trước B3.

**Dependency:** B1/B2; các gate import OPEN-02/05/06, NEW-01/02, receipt/source/report và wizard reload đã chốt riêng cho B3 tại D012. Gate Analysis B5 vẫn mở. B4 có thể làm song song bằng seed; gate xuyên import/query phải kiểm tra khi B4 có API.

**Kiểm thử:** unit parser/mapping/normalize/dedup; DB integration với CSV và JSON hợp lệ/sai cú pháp/thiếu cột; value 0, âm, không hữu hạn, tọa độ sai, timestamp offset tương đương; dòng đầu invalid rồi dòng hợp lệ; duplicate/conflict qua ranh giới batch; hai dataset cùng mã trạm/thời gian. Fault injection giữa các batch/restart, import cạnh tranh, retry sau commit mất response; test bốn tình huống key: replay/in-flight/khác payload/thiếu-sai key. Kích thước lớn dùng giới hạn đã duyệt, không tự chọn số MB.

**Bàn giao/ nghiệm thu:** Tài chạy upload → validation → mapping → import → datasets bằng API/DB thật; counts khớp dữ liệu lưu và BR-08. Dataset failed/importing không được đọc bằng list hoặc query trực tiếp; kiểm thử gate xuyên Query thực hiện cùng B4 trước khi đóng luồng tích hợp. Không nhận nghiệm thu nếu mới mock parser hoặc repository.

### B4 — Query sensors/readings cho Workspace và hai renderer

**Mục tiêu:** FE M4 có dữ liệu chuẩn, đúng phạm vi và phân trang hữu hạn; không chờ import hoàn tất mới bắt đầu phát triển query.

**Endpoint:** `GET /sensors` → `200 SensorPage`; `GET /readings` → `200 ReadingPage`; dùng lại `GET /datasets`.

- [ ] Sensors nhận datasetId bắt buộc, bbox, externalId sort asc/desc; readings nhận datasetId bắt buộc, một sensorId tùy chọn, bbox/from/to, ts sort asc/desc và cursor/limit.
- [ ] Kiểm tra parent dataset imported, sensor thuộc dataset, bbox WGS84, from/to hợp lệ theo semantics đã chốt; không thêm region/search query.
- [ ] Query và DTO dùng location snapshot từ Sensor đúng thứ tự lon/lat; UTC ts, value/unit; không trả BSON/raw documents.
- [ ] Cursor gắn đầy đủ bộ lọc/sort, tie-break khi ts bằng nhau, `nextCursor: null` ở cuối; không đọc hết 500k readings vào RAM chỉ để trả một trang. **FE M4 hiện tải 100/trang và giới hạn 2.000 readings/phiên**, nhưng đây là ngân sách hiển thị, không phải giới hạn dataset hay phạm vi Analysis.
- [ ] Kiểm tra index/time/geo bằng explain trên dữ liệu đại diện; chỉ tối ưu hoặc đề xuất index theo số đo, không thêm aggregates/Redis như điều kiện mặc định.
- [ ] Bàn giao fixture biên tọa độ/thời gian cho Tài kiểm tra Mapbox/Cube dùng cùng readings; Backend không phụ trách tiles, camera hay ngân sách render.

**Dependency:** B1/B2, decision biên thời gian và xử lý dataset không tồn tại/chưa imported; seed đúng physical design cho phát triển độc lập. Nghiệm thu xuyên luồng cần dataset nhập thật từ B3. Anomaly overlay nối sau B6.

**Kiểm thử:** unit query/cursor/DTO; integration MongoDB cho isolation giữa dataset, sensor khác dataset, bbox/time giao nhau, biên from/to đã duyệt, cùng ts nhiều reading, sort hai chiều, limit/cursor sai, không kết quả; mọi trạng thái dataset chưa imported. Test concurrent changes không được quảng cáo như snapshot. Explain/đo dung lượng response và memory; FE kiểm tra dữ liệu hiển thị từ API thật.

**Bàn giao/ nghiệm thu:** truy vấn có kết quả đúng và không rò partial dataset; mỗi response đúng giới hạn; FE M4 phát triển cả hai renderer từ cùng adapter. Nhãn “API thật + seed” được đổi thành tích hợp import/query thật chỉ sau khi kiểm tra B3 → B4.

### B5 — Analysis online: thống kê, ML và lịch sử

**Mục tiêu:** Backend điều phối và lưu analysis đúng phạm vi; Khải cung cấp engine/model thật, không dùng kết quả fixture để tuyên bố detector đã chạy.

**Endpoint:** `POST /analysis-runs` → `202 {data: AnalysisRun}` (snapshot queued), `GET /analysis-runs/{id}` → `200 {data: AnalysisRun}`, `GET /analysis-runs` → `200 AnalysisRunPage`. Cả statistical/ml dùng async; kết quả lấy qua anomalies của B6 sau completed.

- [ ] Khiêm/Khải/Tài xác nhận method/config/default, điều kiện dữ liệu, ordering/grouping theo trạm, input/output, model/features và mapping score → severity. Danh sách zscore/iqr/moving_avg trong draft chưa chứng minh các method đã implement; D009 chọn thuật toán Isolation Forest, chưa chốt model artifact/version/features hoặc method/config API. FE dùng presets cố định zscore threshold=3 và iqr multiplier=1.5 đã được người dùng xác nhận; Server vẫn phải validate điều kiện dữ liệu.
- [ ] Validation theo family/method và config được duyệt dù HTTP config là object mở; scope chỉ sensorIds/from/to. Xác minh dataset imported, sensor thuộc dataset; lấy đầy đủ phạm vi phân tích tại Server, không dùng trang readings đang render làm toàn bộ input.
- [ ] Tài/Khiêm chốt cách bbox → danh sách sensorIds đầy đủ và semantics tập rỗng/giới hạn. Không nhận bbox ngoài schema, không bỏ filter ngầm hoặc dùng trang sensors đầu tiên làm toàn bộ vùng.
- [ ] Service gọi statistical engine của shared-core qua adapter; Khải chịu công thức, edge cases và tests engine. Sau đó tích hợp ML adapter Server với model đã train, load/predict và version; không train trong upload/request.
- [ ] Ghi run/config/method/engineVersion/modelVersion phù hợp; kiểm tra output tham chiếu reading đúng dataset/scope, score hữu hạn; chỉ flagged=true thành Anomaly. Khởi tạo review open/note rỗng/version 1/updatedAt, location từ dữ liệu chuẩn; unique run+reading.
- [ ] Chốt nhất quán run/anomalies và failure/recovery trước ghi dữ liệu thật: không để completed khi persist chưa xong, không coi kết quả partial là thành công. Retry cùng **HTTP Idempotency-Key** không tạo run/job tiếp nhận mới; **worker retry** sau crash có thể thực thi lại nhưng phải bảo đảm idempotent effects bằng run state/claim/attempt guard và unique `(analysisRunId,readingId)`. Không suy ra exactly-once execution.
- [ ] D008: tiếp nhận run + công việc bền vững trước 202; thực thi nền có giới hạn concurrency. **Redis + BullMQ là ứng viên B5, chưa chốt** (so sánh với worker/DB-backed dispatch đơn giản và chi phí vận hành); chọn topology/admission bằng phép đo. Có recovery khi crash/restart, tránh mất job đã nhận và ghi kết quả trùng; không hứa exactly-once engine execution. Không train model trong request/job inference.
- [ ] AnalysisCreateResponse chỉ có data; GET detail/history trả cùng DTO hiện tại gồm scope snapshot và lỗi terminal. Replay cùng key trả cùng 202/body/run ID dù job đang chạy hoặc terminal; receipt tiếp nhận khác lifecycle job. Chốt retention/atomicity/claim/restart trước implementation. List history giữ createdAt sort/cursor; anomalies chỉ công bố sau completed, GET theo run chưa completed trả 409.

**Hai failure cases bắt buộc B5 kiểm chứng:**

1. **Run queued đã commit nhưng Server crash trước khi dispatch:** Sau restart phải reconcile/claim lại run đủ điều kiện và dispatch một cách an toàn; không để job chờ vĩnh viễn. Nếu chọn Redis/BullMQ, đây là khoảng hở MongoDB → Redis; cơ chế atomicity/outbox/reconciliation phải được thiết kế và thử fault injection, **không mặc định hai hệ lưu trữ có transaction chung**.
2. **Worker crash rồi job được chạy lại:** Re-run không tạo anomaly trùng hoặc công bố completed trên kết quả partial. Test duplicate delivery/worker restart/DB write failure; unique key chỉ là hàng rào cuối, cần idempotent orchestration và visibility gate theo D008.

**Workload độc lập:** Ví dụ 500.000 readings của dataset, scope Analysis chỉ chọn 30.000: Backend phải truy xuất **toàn bộ** 30.000 reading hợp lệ theo dataset/sensorIds/from/to ở Server, không lấy 100 readings của trang FE làm input. Đây là kịch bản minh họa (không phải limit đã chốt); phải đọc/xử lý bounded theo năng lực detector và đo CPU/RAM/event-loop khi B5/B8.

**Dependency:** B1/B2/B4, idempotency đã nghiệm thu từ B3 hoặc cùng cơ chế được hoàn tất độc lập; OPEN-03/04/06, NEW-02 và scope/response/failure policy ở mục 6. Khải bàn giao package statistical/ML thực; B6 có thể phát triển song song bằng seed.

**Kiểm thử:** Khiêm unit orchestration với test double có nhãn; integration engine thật/DB thật cho không anomaly, có anomaly, invalid config, insufficient_data, phương sai 0, input rỗng, model không sẵn sàng (`503`), output lỗi. Hai run khác nhau có thể có anomaly cùng reading, một run không trùng reading; retry không tăng số run/anomaly. Test scope vượt một trang, sensor khác dataset, persist fail giữa chừng và mất response. Khải chạy deterministic/golden tests và đánh giá model riêng; Cường đo thời gian/memory/event-loop dưới tải để chốt mức concurrency/admission và thông số vận hành D008.

**Bàn giao/ nghiệm thu:** chia hai lần bàn giao B5a thống kê thật và B5b ML thật trên cùng endpoints; ghi method nào đã chạy và method nào còn chờ. FE M5 dùng được history/kết quả và liên kết B6; B5 chỉ đóng khi cả thống kê và ML P0 được hỗ trợ đã tích hợp thật. Chưa có model thì ghi chưa hoàn tất ML, không thu hẹp P0 hoặc trả anomaly giả để đạt mốc.

### B6 — Anomaly list/detail và review online

**Mục tiêu:** FE M6 và anomaly overlay M4 có API thật; lưu review không ghi đè cạnh tranh và không phụ thuộc offline sync.

**Endpoint:** `GET /anomalies` → `200 AnomalyPage`; `GET /anomalies/{id}` và `PATCH /anomalies/{id}` → `200 SingleAnomaly`.

- [ ] Chỉ công bố anomalies của run completed; GET theo run chưa completed trả 409, list tổng loại partial, detail chưa công bố 404. List đúng query: datasetId, analysisRunId, family/method, severity/status, from/to, ts sort và cursor/limit. Không tự nhận sensorId/bbox; xác minh run/dataset nhất quán.
- [ ] Detail trả đầy đủ Anomaly theo schema, không join thêm value của reading vào wire DTO. FE dùng readingId để ghép dữ liệu đã tải hoặc báo chưa tải phép đo; score không thay cho PM2.5.
- [ ] PATCH chỉ baseVersion + changes có ít nhất status/note; validate strict, chỉ ba review statuses. Repository conditional update theo ID/version, tăng version và updatedAt nguyên tử.
- [ ] Stale trả `409` kèm currentVersion theo contract; không bắt buộc response conflict chứa full current anomaly. ID không tồn tại trả `404`; Tài GET detail để xử lý conflict. Mất response PATCH không có nghĩa chưa commit, không tự retry mù.
- [ ] Áp dụng dataset visibility và auth cho list/detail/review; giữ public service review để sync sau này dùng, chưa tạo outbox/receipt/checkpoint.

**Dependency:** B1/B2, policy query/time của B4; seed liên kết đúng dataset/sensor/reading/run để phát triển trước B5. Nghiệm thu analysis → review phải có B5 tạo kết quả thật.

**Kiểm thử:** unit filter/validation và DB integration; hai client cùng baseVersion chỉ một update thành công, bên còn lại conflict; restart vẫn giữ review; lỗi giữa request/response rồi GET lại. Reject score/method/severity trong PATCH, empty changes/version sai; one-reading-many-runs; detail không lộ fields persistence, không lộ dữ liệu dataset partial. Playwright FE conflict với API/DB thật, giữ bản sửa ở FE và xử lý theo version mới có chủ đích.

**Bàn giao/ nghiệm thu:** list/detail/review thật có thể bàn giao sớm từ seed, ghi rõ seed không phải output detector. Khi B5 sẵn sàng, kiểm tra run → list → detail → PATCH → overlay và đóng tích hợp. Không tính success HTTP intercept là CAS đã được kiểm chứng.

### B7 — Quản lý tài khoản Admin

**Mục tiêu:** FE M7 quản lý user qua Server, bảo vệ quyền và last active admin.

**Endpoint:** `GET /admin/users` → `200 UserPage`; `POST /admin/users` → `201 UserResponse`; `PATCH /admin/users/{id}` → `200 UserResponse`.

- [ ] List username sort asc/desc (mặc định asc), keyset trên usernameNormalized + ID, cursor/limit; không thêm server search/delete/reset-password.
- [ ] Create dùng nghiệp vụ User của B2 và idempotency; nhận username/password/role, enforce unique chung với Register, không lộ hash.
- [ ] PATCH chỉ role/isActive và ít nhất một field; enforce admin tại Server. OpenAPI hiện **đã cấm hạ quyền/vô hiệu last active admin**: đây là rule phải làm, không phải câu hỏi nghiệp vụ còn mở của FE R10.
- [ ] Review cách bảo đảm rule last admin khi có request đồng thời trước implementation; không dùng count rồi update không có bảo vệ cạnh tranh và coi là an toàn.
- [ ] Áp dụng chính sách hiệu lực thay đổi role/isActive lên token/session đã thống nhất với B2; Tài kiểm tra UI current user và `401/403` nhất quán.

**Dependency:** B1/B2, idempotency chung và quyết định auth/atomic last-admin guard. Có thể thực hiện ngay sau B2 trong khi B3/B5 chờ quyết định; không phụ thuộc engine hoặc import.

**Kiểm thử:** analyst bị `403` trên cả ba operations, JWT thiếu/sai `401`; validate payload/username trùng; replay create không nhân đôi user; Register và Admin create cạnh tranh cùng username; pagination chuẩn. Concurrent hạ quyền/vô hiệu nhiều admin vẫn còn ít nhất một active admin; update không tồn tại `404`, stale state theo `409`; test token cũ sau đổi role/isActive theo chính sách đã duyệt.

**Bàn giao/ nghiệm thu:** admin list/create/update bằng API thật, analyst không thể vượt quyền dù gọi trực tiếp; rule last admin chịu được race, các response không chứa secret. FE M7 có thể nghiệm thu độc lập với B5.

### B8 — Tích hợp online, hiệu năng và bàn giao

- [ ] D008: integration thật cho tiếp nhận durable, queued/running/terminal, worker restart, mất response/replay cùng run, cạnh tranh cùng key, failed persist không lộ partial; nhiều client không vượt concurrency đã chốt. Đo acceptance, queue wait và execution riêng với CPU/RAM/event-loop, không dùng mock làm bằng chứng.


**Mục tiêu:** Nghiệm thu toàn bộ Backend P0 online với FE thật, có bằng chứng DB/engine/hạ tầng và giới hạn thực tế.

**Endpoint:** toàn bộ 20 operations mục 5; không bổ sung operations ở mốc nghiệm thu.

- [ ] Cường/Tài/Khiêm chạy E2E Register → Login → upload/validation/mapping/import → datasets → query/workspace → analysis thống kê/ML → review; thêm admin và conflict hai phiên. Suite nghiệm thu không dùng route intercept/mock transport.
- [ ] Kiểm thử lỗi theo feature: auth, sai payload/media type, giới hạn upload, dữ liệu rỗng, cursor sai, DB/model unavailable, import thất bại, request trùng và mất response sau commit.
- [ ] Chạy typecheck/lint/build/unit/contract/integration; báo cáo coverage server mục tiêu ≥80%. Khải báo coverage shared-core mục tiêu ≥90%, chất lượng detector riêng; không cộng test FE mock vào coverage Backend.
- [ ] Cường dựng Docker/Nginx HTTPS `443`, smoke `/api/v1/health` và auth/routing; kiểm tra proxy timeout/body size đồng bộ với quyết định B3/B5, không lộ internal reading-batches. Không đưa JWT secret/DB URI nhạy cảm vào bundle FE.
- [ ] Benchmark 200–500 trạm, 100k và 500k readings; explain time/geo/cursor, docs/keys examined, thời gian/memory import, analysis và số anomalies. Dataset giả được ghi nhãn, dataset thực phải có nguồn và tọa độ xác minh.
- [ ] k6 theo SRS: 100 virtual users/10 phút, mục tiêu p95 <500 ms và lỗi <1% cho **danh sách API đọc đã chọn trước khi chạy**. Đo upload/ML riêng; không áp ngưỡng đọc cho mọi endpoint. Ghi máy, cấu hình, dữ liệu, kịch bản, kết quả và vấn đề còn tồn tại.
- [ ] Hoàn thiện server README/env/scripts, cách tạo account test, seed/index, nguồn model, contract/method hỗ trợ, trạng thái từng endpoint và các giới hạn. Cập nhật tài liệu liên quan chỉ theo review được duyệt khi triển khai, không sửa OpenAPI tự động để hợp thức hóa test lỗi.

**Dependency:** B1–B7 đạt tiêu chí riêng; detector/model thật từ Khải, môi trường từ Cường, FE M3–M7 đủ để chạy tích hợp. FE chưa sẵn sàng thì API integration vẫn có thể hoàn thành, nhưng không đánh dấu E2E FE M8 đã đạt.

**Kiểm thử/ nghiệm thu:** có báo cáo tái lập được cho API/DB/engine thật và E2E online; mọi failure được sửa hoặc ghi blocker rõ, không đổi sang mock để pass. Mục tiêu performance/coverage chưa đạt phải báo số đo và việc cần làm, không tuyên bố mặc định đã đạt. Đóng B8 khi tiêu chí mục 7 được đáp ứng; hoàn tất online không đồng nghĩa hoàn tất MVP offline-first trong SRS.

## 5. Đồng bộ bàn giao với Frontend và phân công

### 5.1. Ma trận 20 operations online/health

Paths dưới đây đều có tiền tố `/api/v1`. **Hiện trạng sau B2: health và 4 operations Auth/User/Datasets list đã triển khai với DB thật; 15 operations còn lại chưa có handler.** Owner API/persistence là Khiêm; cột cuối ghi điều kiện/bằng chứng bàn giao.

| # | Method/path | Mốc BE | FE nhận bàn giao | Điều kiện nhận API thật |
|---|---|---|---|---|
| 1 | GET `/health` | B1 — đã có | M1/M8 | Đã kiểm tra DB thật, degraded/recovery; xem B1 verification |
| 2 | POST `/auth/register` | B2 — đã có | M2 | Đã test unique/race, scrypt, analyst/active, 201 không token |
| 3 | POST `/auth/tokens` | B2 — đã có | M2 | JWT thật, hai role, rate limit, 401 chung; E2E thật |
| 4 | GET `/users/me` | B2 — đã có | M2 | Reload và quyền/isActive hiện tại qua DB đã test |
| 5 | GET `/datasets` | B2/B3 — đã có | M2/M3 | Imported-only/cursor thật; đối chiếu import thật |
| 6 | POST `/datasets` | B3 — đã có | M3 | Multipart, key, file lưu và validation thật |
| 7 | GET `/datasets/{id}/validation` | B3 — đã có | M3 | Report không bọc data, lỗi/counts thực |
| 8 | PUT `/datasets/{id}/mapping` | B3 — đã có | M3 | Replace/idempotent, lifecycle đã chốt |
| 9 | POST `/datasets/{id}/imports` | B3 — đã có | M3 | BR-08, visibility, replay/recovery đã test |
| 10 | GET `/sensors` | B4 | M4; scope M5 | Bbox/cursor, dataset isolation |
| 11 | GET `/readings` | B4 | M4 | Filters/UTC/location đúng; đối chiếu B3 |
| 12 | POST `/analysis-runs` | B5a/B5b | M5 | Thống kê thật trước, ML thật sau; cùng contract |
| 13 | GET `/analysis-runs` | B5 | M5 | History/query có thể test sớm bằng seed |
| 14 | GET `/anomalies` | B6 | M4 overlay/M5/M6 | Scope đúng query; kết quả thật xác nhận cùng B5 |
| 15 | GET `/anomalies/{id}` | B6 | M6 | Full DTO, thiếu reading value được FE xử lý rõ |
| 16 | PATCH `/anomalies/{id}` | B6 | M6 | CAS thật, 409 + GET lại detail |
| 17 | GET `/admin/users` | B7 | M7 | Admin only, cursor/sort |
| 18 | POST `/admin/users` | B7 | M7 | Key/replay, unique chung với Register |
| 19 | PATCH `/admin/users/{id}` | B7 | M7 | Role/active, last-admin guard chịu được race |
| 20 | GET `/analysis-runs/{id}` | B5 | M5 | Trạng thái hiện tại, scope/error và phục hồi run |

Mỗi lần bàn giao gửi kèm base URL/environment, revision contract đang dùng, account/seed có nhãn, request mẫu, kết quả contract/integration test và danh sách quyết định/giới hạn còn mở. Ghi trạng thái **theo endpoint và theo dependency**, không dùng một nhãn “Backend ready” cho toàn bộ hệ thống.

| Nhãn bằng chứng | Ý nghĩa | Không được suy ra |
|---|---|---|
| Chưa triển khai | Mới có kế hoạch/OpenAPI/fixtures | API đã gọi được |
| Mock/test double | FE mock/HTTP intercept hoặc unit test repository/engine giả | JWT, persistence, CAS, idempotency hoặc detector thật đã đạt |
| API thật + seed | Fastify và MongoDB thật, dữ liệu tạo trước có nhãn | Upload hoặc thuật toán đã tạo dữ liệu đó |
| API thật + engine giả | Orchestration/persistence được kiểm tra bằng output giả trong test | Analysis P0 đã hoàn tất; không bật fallback giả trong môi trường nghiệm thu |
| Tích hợp thật | HTTP/DB thật và dependency nghiệp vụ thật; import/engine tương ứng đã chạy | Hiệu năng/chất lượng model đạt khi chưa có báo cáo đo |

### 5.2. Thứ tự và công việc song song

Thứ tự nền: **B0 → B1 → B2**. Sau B2, triển khai theo các nhánh có dependency rõ:

- **B3 Import** và **B4 Query** có thể phát triển song song; B4 dùng seed imported trước, nghiệm thu B3 → B4 sau. Tài tiếp tục FE M3/M4 bằng mock đến lúc API tương ứng được bàn giao, không chờ mọi Backend xong.
- **B5 Analysis** bắt đầu sau interface query và quyết định detector; Khải làm core/POC ML song song ngay từ B0/B1. B5a/B5b bàn giao riêng, không dùng ML chưa sẵn sàng để chặn auth/query/admin.
- **B6 Anomaly/review** có thể làm trước B5 bằng seed có quan hệ đầy đủ; ưu tiên list/detail sớm cho overlay. Nghiệm thu kết quả sinh thật chỉ sau B5.
- **B7 Admin** bắt đầu sau B2 và idempotency chung, không phải chờ B3–B6; phù hợp FE M7 làm xen lúc chờ import/analysis.
- **Cường** chuẩn bị DB/CI/test harness từ B1, hỗ trợ fault/load test từng mốc; B8 dành cho tích hợp xuyên suốt, không phải thời điểm đầu tiên viết tests.

Đơn vị PR đề xuất: nền runtime/DB; auth-register/list; idempotency chung; upload-validation-mapping; import/recovery; query/index; analysis thống kê; ML integration; anomaly/review; admin; E2E/performance/tài liệu. Mỗi PR có test đúng mức, nêu dependency còn giả và status API thật; review/merge vào `develop` theo ownership. Kế hoạch này không thực hiện commit, push hoặc PR.

Chưa ấn định ngày/số ngày cho milestone: chưa có năng lực triển khai/ngày, kết quả POC và thời điểm chốt quyết định. Sau B0/B1, nhóm ước lượng từng PR, tách thời gian làm Backend khỏi thời gian chờ Khải/Cường/FE. Không lấy “4 tuần dự kiến” của SRS thành lịch bàn giao chắc chắn hoặc dùng thời gian làm mock để cam kết tích hợp thật.

### 5.3. Ranh giới ownership

| Người | Chịu trách nhiệm chính trong kế hoạch | Sản phẩm bàn giao/phối hợp |
|---|---|---|
| **Khiêm — Backend** | Fastify/phân tầng, API, JWT/RBAC, User, parser/import, BR-08, query, DB mapping/index, idempotency online, run orchestration/persistence, review CAS, test module và README | API thật theo ma trận; contract/DB review với các owner; không tự viết lại detector của Khải |
| **Khải — thuật toán/ML** | shared-core package/schema/statistical algorithms, method/config/edge-case contract, severity proposal, model/features/train-save-load-predict, phiên bản và tests/đánh giá thuật toán | Engine/adapter inference và dữ liệu kiểm chứng cho B5; Khiêm tích hợp HTTP/persistence; không giao toàn bộ API analysis cho Khải |
| **Cường — hạ tầng/kiểm thử** | DB test/replica-set khi cần, Docker/Nginx/TLS, CI, test harness/fixture phối hợp, k6, tổng hợp coverage/performance | Môi trường và báo cáo tái lập; owner module vẫn tự viết unit/integration, không đẩy toàn bộ test cho Cường |
| **Tài — Frontend** | Online adapter/UI/Mapbox/Cube, session/guard/UX và FE tests | Ghép API từng mốc, xác minh envelope/lỗi/phạm vi; Server vẫn kiểm tra quyền/validation |
| **Duy — nối sau** | dataSource/offline/PWA/sync thuộc đợt sau | Review DTO/version/interface khi có ảnh hưởng; không bắt xây offline để đóng online |

## 6. Quyết định mở, sai lệch tài liệu và điều kiện chặn

**D010 chốt driver, D011 chốt auth B2, D012 chốt import B3. Các dòng dưới là gate ban đầu; phần B3 đã được D012 thay thế, phần Analysis/B5 và các mốc khác vẫn mở nếu chưa được xác nhận riêng.** “Trước Bx” nghĩa là trước triển khai phần phụ thuộc trong mốc đó; có thể tiếp tục scaffold/contract tests hoặc phần độc lập. Chỉ nghiệm thu sau khi có quyết định, implementation và test tương ứng. Nếu cần thay HTTP/DTO/phạm vi, Khiêm phải đưa đề xuất cụ thể để người dùng/nhóm review, cập nhật nguồn qua quy trình; kế hoạch này không cấp phép tự sửa OpenAPI.

| Mục | Cần làm rõ / quy tắc giữ nguyên | Người phối hợp | Hạn / phần bị chặn |
|---|---|---|---|
| Driver/ODM (D010) | **ĐÃ CHỐT** MongoDB Official Node.js Driver (`mongodb`), không dùng Mongoose; Repository che BSON/query khỏi Route/Service | Khiêm (chốt); Cường phối hợp DB test | Không còn blocker lựa chọn driver cho B1; DB integration phải test thật |
| HTTP/shared validators | B1 dùng JSON Schema/Ajv cho HTTP, strict extra fields, test `400/422` theo config từng route; health/error schema khớp OpenAPI. C02–C04 DTO nghiệp vụ vẫn chờ review, không đổi shared schema hoặc contract ngầm | Khiêm + Khải + Tài | Trước validator nghiệp vụ B2 trở đi |
| Auth/User (D011) | **ĐÃ CHỐT và triển khai B2:** trim/lowercase key, scrypt async N=2^17/r8/p1/maxmem256MiB/salt16B/tối đa2 tác vụ; HS256/1h/secret env, current user qua DB, inactive/không tồn tại 401; seed CLI không password mặc định. Login rate limit có env, cần benchmark trước tăng cấu hình | Khiêm; Tài/Cường nhận API và runbook | B2 đã kiểm chứng; Admin HTTP/last-admin concurrency vẫn B7 |
| Idempotency online | HTTP semantics đã có; nơi lưu receipt, atomicity giữa effect/receipt, scope operation/path, failure/in-flight recovery, thời hạn replay chưa có physical design. Không mặc định Redis/collection mới/TTL hoặc tái dùng offline receipt | Khiêm + Cường; Tài nhận retry window | Trước các POST key ở B3/B5/B7 |
| OPEN-02 / đơn vị | Timestamp thiếu offset và unit nguồn ngoài ug/m3; MappingRequest chưa có timezone hay hợp đồng quy đổi tổng quát. Không gán UTC/UTC+07 hoặc thêm field tự phát | Khiêm + Tài + Khải | Trước normalization/validator B3 |
| OPEN-05 / nguồn file | File/batch/report limits, timeout, lưu/retention file và hành vi thiếu file sau restart; báo cáo preview không có cờ truncation trong schema. Không thêm report-download endpoint hoặc ngưỡng MB tùy tiện | Khiêm + Cường + Tài | Trước upload/import B3; đo lại B8 |
| NEW-01 / invalid rows | Cùng externalId khác tọa độ: phải báo/review, chi tiết reject row/dataset còn mở. Chốt điều kiện import có invalid rows, file toàn invalid, counts/report; không tự di chuyển trạm hoặc công bố dataset lỗi | Khiêm + Khải + Tài | Trước nghiệp vụ validation/import B3 |
| NEW-02 / recovery | Run lifecycle đã chốt tại D008; cơ chế claim/attempt/recovery còn mở. Dataset lifecycle cần chốt bảng chuyển trạng thái, thời điểm sửa mapping, retry failed/đã imported và dọn attempt lỗi. Imported không nhập lại; in-flight request khác `409` đã có trong OpenAPI | Khiêm + Khải + Tài | Trước state machine B3/B5 |
| Query biên / parent state | from/to đóng hay mở chưa chốt; xử lý dataset ID không tồn tại/chưa imported và tham chiếu khác dataset phải thống nhất trong statuses hiện có (list query không khai báo `404`). Không trả partial data hoặc tự mở rộng mã lỗi | Khiêm + Tài | Trước B4 và query B5/B6 |
| OPEN-03/04 / detector | D009 đã chọn Isolation Forest và presets FE zscore `{threshold:3}`, iqr `{multiplier:1.5}`. Còn mở model artifact/version/features/runtime, method/config API cho ML, dữ liệu tối thiểu, grouping/window, severity và ánh xạ insufficient_data/invalid_input sang HTTP + run status | Khải + Khiêm + Tài | Trước engine integration B5a/B5b |
| OPEN-06 / D008 | Async statistical/ml đã chốt; **Redis + BullMQ chỉ là ứng viên**. Chưa chốt queue/execution topology, concurrency, admission, claim/restart và retention. Polling phía FE đã chốt theo D009. Import giữ đồng bộ | Khiêm + Khải + Cường + Tài | Trước triển khai B5; FE M5 đã làm mock/adapter, chưa tích hợp worker thật |
| Nhất quán run/results | Quy trình persist, cleanup/recovery và visibility khi engine hoặc ghi anomalies thất bại; không completed giả, không lộ kết quả partial như run thành công | Khiêm + Khải + Cường | Trước persistence B5 |
| Bbox analysis | DetectionRequest chỉ sensorIds/from/to; FE đề xuất resolve đủ sensors qua paging, nhưng tập rỗng/giới hạn payload chưa chốt. Anomalies không có sensorId/bbox | Tài + Khiêm | Trước FE M5/B5; B4 cung cấp paging đúng |
| Wizard reload | ValidationReport không có mapping đã lưu/metadata file; phải thống nhất mức phục hồi, xử lý mất key và kết quả request chưa xác định, không thêm GET dataset detail | Tài + Khiêm | Trước nghiệm thu B3/FE M3 |
| Last active admin | Rule đã có ở OpenAPI, FE R10 còn ghi mở là thông tin cũ; chỉ còn cách thi hành nguyên tử khi cạnh tranh và hành vi tự đổi quyền cần đối chiếu auth policy | Khiêm + Tài + Cường | Trước PATCH B7 |
| OPEN-07 / dữ liệu đánh giá | Nguồn thực, tọa độ, chu kỳ đo/thời lượng/nhịp batch; không khóa 5 phút/72 giờ. Seed có nhãn và dữ liệu thực không nhãn phải báo cáo riêng | Khải + Khiêm + Cường | Trước đánh giá thực B5/B8; seed cho phép test sớm |
| NEW-03/04 / sync | Export coverage/checkpoint/receipt transaction vẫn mở và bị hoãn; giữ DTO/version, chưa bảo đảm sync đầy đủ | Duy + Khiêm + Cường | Đợt offline/sync sau, không chặn online |

**Các khác biệt đã có nguồn phân xử, không cần sáng tạo quyết định mới:**

- URL cũ trong SDD/DB không sinh alias; OpenAPI hiện hành dùng `/api/v1/...`.
- Số operations FE M0/M1 là lịch sử trước Register: sau D008 có 25 tổng, 20 online/health và 5 hoãn. Register đã thuộc SRS/OpenAPI/FE M2, phải có trong B2. FE đã tiến đến M7 ở mock/HTTP interception; **chưa chứng minh Server thật**.
- Các đoạn Page Outline/User Flow nói số trạm import hoặc phép đo trong anomaly detail là nhu cầu UI; schema hiện không trả số trạm import hay reading value trong Anomaly. Không thêm fields; nếu cần đáp ứng thêm phải review contract riêng.
- Metadata deep-link FE đã chọn hiển thị datasetId khi thiếu; không yêu cầu Backend tự thêm dataset detail. D008 bổ sung GET analysis run detail; không bổ sung GET dataset detail.
- Thiết kế DTO cho phép lựa chọn lưu/resolve location; physical design cụ thể đang đề xuất snapshot ở Reading/Anomaly. Dùng thiết kế vật lý làm cơ sở review, không diễn giải tùy chọn DTO thành thay đổi DB đã duyệt.

## 7. Tiêu chí “đã hoàn tất Backend P0 online”

- [ ] 20 operations online/health có implementation đúng OpenAPI, test thành công/lỗi tương ứng và trạng thái bàn giao rõ; không dùng endpoint mới/alias để bù thiếu contract.
- [ ] Register/Login/me và Admin thật: password hashing, username uniqueness cạnh tranh, Server RBAC, chính sách quyền hiện tại và bảo vệ last active admin được kiểm chứng.
- [ ] CSV/JSON qua validation/mapping/import thật; BR-08 giữ first valid row, counts đúng, retry/restart không tạo bản trùng; mọi đường query/analysis không công bố partial dataset.
- [ ] Sensors/readings/history/anomalies đúng dataset/scope, UTC/location/ID và cursor/limit/sort; có tests biên và explain trên dữ liệu đại diện.
- [ ] Cả thống kê và ML online được hỗ trợ chạy engine/model thật của Khải, lưu run/anomalies truy vết được; không dùng seed/test double làm bằng chứng inference thành công.
- [ ] Review CAS thật: hai phiên cùng version chỉ một cập nhật; 409/GET lại detail đúng, không thay detector output; mất response được xử lý mà không ghi đè mù.
- [ ] Bốn POST có key đúng semantics/recovery/replay trong thời hạn đã thống nhất; kiểm chứng commit rồi mất response/restart, không chỉ replay trong RAM.
- [ ] Build/typecheck/lint/unit/contract/DB integration và E2E với FE thật đạt; có coverage/load/performance report với mục tiêu, số đo và giới hạn rõ. Không tính HTTP intercept là Backend integration.
- [ ] Môi trường HTTPS/Nginx/DB, README/env/scripts, dữ liệu thử/model và hướng dẫn bàn giao đủ tái lập; endpoint hoãn không được quảng cáo đã hỗ trợ.
- [ ] Mọi quyết định ảnh hưởng tính năng đã nghiệm thu có xác nhận; việc chưa hoàn tất phải ghi blocker, không đánh dấu đạt để khớp lịch. DTO/phân tầng/review version vẫn cho phép nối offline/sync sau.

Đây là tiêu chí hoàn thành **Backend P0 online theo phạm vi đã xác nhận**. Không bao gồm nghiệm thu PWA/Offline/Sync, P1/P2 hay toàn bộ MVP của SRS.
