# Server — Backend P0 online

**B1–B4 đã triển khai ngày 14/11/2026:** health, Register/Login, current user, imported-only datasets list và upload/validation/mapping/import + Query sensors/readings thật. Xem [B4 verification](../docs/backend/b4-verification.md). Xem [B3 verification và runbook](../docs/backend/b3-verification.md), [D012](../docs/decisions.md#d012--import-b3-và-durable-idempotency). Giữ feature modules với Route → Validation → Service → Repository → MongoDB. Owner: Khiêm; Cường phối hợp môi trường/kiểm thử. Xem [B2 verification](../docs/backend/b2-verification.md), [B1 verification](../docs/backend/b1-verification.md) và [D011](../docs/decisions.md#d011--quy-tắc-user-và-xác-thực-b2).

## Tích hợp thư viện trước B5 — 15/11/2026

Có internal adapters tại `src/engines`: gọi statistical engine của shared-core và Python/scikit-learn load/predict artifact đã có; xác minh references/score rồi tạo candidates trong bộ nhớ. [Báo cáo và lệnh setup](../docs/backend/detector-integration-verification.md), [artifact/runtime](ml/README.md). CLI `npm run verify:detectors` chạy profile có nhãn thử nghiệm và ghi kết quả kiểm chứng; không ghi run/anomaly hoặc tạo API.

**B5 vẫn chưa triển khai**. API count vẫn 11/20; chưa có Analysis routes/job/queue hoặc production policy/features/severity. Model được chọn chỉ là demo hai features x0/x1, không tự coi PM2.5 feature extraction đã xong. B1–B4 không tự khởi động Python hoặc tải model; Python/artifact chỉ cần cho bộ kiểm thử engines integration và CLI trước B5.

## Chạy từ thư mục gốc

Yêu cầu Node.js ≥22.12, npm và MongoDB đang hoạt động cho health `200`. B3 cần replica set đã khởi tạo; standalone chỉ phục vụ B1/B2, upload/import trả 503. Các phiên bản khóa trong package/lockfile: Fastify 5.12.8, Official Driver 7.9.0, TypeScript 5.9.3.

```powershell
npm ci
# Tạo cấu hình nếu chưa có; giữ nguyên .env đang dùng.
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
# Tạo secret một lần, chép kết quả vào JWT_SECRET trong .env và giữ ổn định qua restart.
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
# Sau khi đã điền JWT_SECRET và cấu hình MongoDB:
npm run dev:server
```

Server mặc định tại `http://127.0.0.1:3001`. `npm run dev`/`dev:mock` của root tiếp tục chạy client. Chạy bản biên dịch:

```powershell
npm run build --workspace @pm25/server
npm start --workspace @pm25/server
Invoke-RestMethod http://127.0.0.1:3001/api/v1/health
```

Dev/start/indexes đọc `.env` ở root nếu tồn tại; biến môi trường đã set giữ ưu tiên của Node. `buildApp()` không đọc file env hoặc tự listen, không tự tạo/xóa index. `main.ts` quản lý listen và đóng HTTP/MongoDB khi nhận SIGINT/SIGTERM.

| Biến | Mặc định / ý nghĩa |
|---|---|
| `HOST` | `127.0.0.1`; chỉ mở interface khác khi cấu hình môi trường triển khai |
| `PORT` | `3001` |
| `MONGODB_URI` | `mongodb://127.0.0.1:27017/spatiotemporal_anomaly` |
| `MONGODB_DATABASE` | Tùy chọn; ghi đè database trong URI |
| `MONGODB_TIMEOUT_MS` | `2000`; ngân sách từng giai đoạn selection/connect/socket/wait queue, không phải timeout toàn HTTP request hoặc giới hạn import |
| `LOG_LEVEL` | `info`; hỗ trợ mức log Pino hoặc `silent` |
| `CORS_ORIGINS` | Rỗng: cùng origin. `.env.example` cho phép chính xác FE `http://127.0.0.1:5173` và preview `http://127.0.0.1:4173`; danh sách cách nhau dấu phẩy, không wildcard/cookie credentials |
| `JWT_SECRET` | Bắt buộc, ngẫu nhiên ít nhất 32 byte; Server từ chối startup nếu thiếu/quá ngắn. HS256, JWT hết hạn sau 1 giờ |
| `LOGIN_RATE_LIMIT_MAX` | `10` lần gọi login / IP / cửa sổ; tính cả request thành công/thất bại |
| `LOGIN_RATE_LIMIT_WINDOW_MS` | `60000`; rate limit trước bước hash, vượt ngưỡng trả `429` + `Retry-After` |

Không có JWT secret/password demo mặc định. Cursor dùng key dẫn xuất riêng từ JWT secret nên ổn định sau restart; đổi secret làm token/cursor cũ không còn hợp lệ. Rate-limit counter nằm trong RAM mỗi Backend process, reset khi restart; chưa phải bộ đếm dùng chung cho nhiều replica. `trustProxy` vẫn tắt, không tin `X-Forwarded-For` do client gửi.

Nếu FE dùng `localhost` thay vì `127.0.0.1`, thêm origin đó vào `CORS_ORIGINS`. Nginx HTTPS/same-origin thuộc hạ tầng Cường; B1 chưa nghiệm thu TLS/reverse proxy. Không bật `trustProxy` khi chưa biết topology proxy.

## API đã có và API chưa có

Đã có 11 operations theo OpenAPI hiện tại:

| API | Thành công / quyền |
|---|---|
| GET `/api/v1/health` | Public, readiness như dưới |
| POST `/api/v1/auth/register` | Public, username/password; `201 {data: UserPublic}` analyst/active, không token/auto-login; trùng username `409`, dữ liệu sai/trường ngoài schema `422` |
| POST `/api/v1/auth/tokens` | Public, `200 {accessToken,tokenType,user}`; sai thông tin/inactive `401` chung, rate limit `429` |
| GET `/api/v1/users/me` | JWT, `200 {data: UserPublic}`; role/isActive đọc từ DB |
| GET `/api/v1/datasets` | JWT analyst/admin, chỉ imported; `200 {data,page}`, mặc định createdAt:desc/100, tối đa 200, sort hai chiều và cursor |
| POST `/api/v1/datasets` | JWT analyst/admin, multipart file/name và UUID key; `201 SingleDataset` |
| GET `/api/v1/datasets/:id/validation` | JWT analyst/admin; `200 ValidationReport` trực tiếp |
| PUT `/api/v1/datasets/:id/mapping` | JWT analyst/admin; replace và `200 SingleDataset` |
| POST `/api/v1/datasets/:id/imports` | JWT analyst/admin, UUID key, không body; `200 SingleDataset` sau persistence/report |
| GET `/api/v1/sensors` | JWT analyst/admin; datasetId/bbox, sort externalId asc/desc; `200 SensorPage` |
| GET `/api/v1/readings` | JWT analyst/admin; datasetId/sensorId/bbox/from/to, sort ts asc/desc; `200 ReadingPage` |

Health giữ các trạng thái:

- `200 {"status":"ok","timestamp":"...Z"}` nếu MongoDB ping thành công.
- `503 {"status":"degraded","timestamp":"...Z"}` nếu MongoDB chưa sẵn sàng; Server tiếp tục phục vụ readiness và kết nối lại khi DB phục hồi.
- Method không hỗ trợ trả `405` với `Allow`. HEAD không tự bật. Khi cấu hình CORS, OPTIONS preflight là xử lý transport, không phải API nghiệp vụ mới.
- Path chưa triển khai trả `404` theo error envelope; không có fallback fixture.

9 operations P0 online còn lại chưa có handler. Analysis theo D008/D009 async sẽ làm ở B5; chưa có worker/queue/model thật. Offline/Sync/P1 và HTTP `reading-batches` vẫn hoãn. Admin có thể đăng nhập và xem dữ liệu, còn CRUD tài khoản là B7.

## Query B4

Hai GET giữ đúng [OpenAPI](../docs/api/openapi.yaml), không region/search/aggregates hoặc dataset detail. Chỉ đọc parent imported qua public DatasetReadAccess; parent không tồn tại/chưa imported hoặc sensorId không thuộc dataset → 422 theo [D013](../docs/decisions.md#d013--semantics-query-b4). SensorId là ID nội bộ, không phải externalId nguồn. B3 → B4 đã kiểm tra cả importing/failed với partial thật và retry sau cleanup.

Khoảng thời gian đóng [from,to], from=to hợp lệ; UTC Z tối đa 3 chữ số phần lẻ, không làm tròn/cắt. Bbox WGS84 nhận biên và min=max, không wrap minLon>maxLon. Scalar lon/lat quyết định kết quả; circle bao ngoài bảo toàn mọi điểm của rectangle giúp dùng 2dsphere index sẵn có, không dùng polygon để thay semantics. World/bbox quá rộng bỏ circle, vẫn dùng scalar chính xác. Không thêm index/hint production.

Mỗi request limit 100/max200, lấy tối đa limit+1 bản ghi/projection; cursor gắn toàn bộ bộ lọc/sort. Sensors dùng digest của externalId + ID trong cursor đã ký, repository đọc một anchor để lấy khóa gốc (hỗ trợ mã trạm dài, không thêm maxLength); anchor đổi/xóa → 400 và bắt đầu lại. Readings cursor giữ ts + ID. Không hứa snapshot giữa các trang; ngân sách FE 2.000 điểm không giới hạn dataset hoặc Analysis.

[B4 verification](../docs/backend/b4-verification.md) có fixture biên, E2E thật và số đo/explain 100k/500k. Chạy benchmark riêng bằng `npm run benchmark:query --workspace @pm25/server`: chỉ tạo DB mô phỏng tạm, không dùng DB người dùng; ghi báo cáo JSON vào docs/backend. Benchmark dùng timeout DB 10 giây để ghi nhận cả truy vấn chậm (runtime mặc định 2 giây), không chứng minh SLA 100 VU/10 phút, TLS hoặc peak memory riêng của Backend.

## B3 và cấu hình nguồn persistent

Bốn operations thật: `POST /api/v1/datasets` (multipart, key UUID, 201), `GET /api/v1/datasets/:id/validation` (report trực tiếp), `PUT /api/v1/datasets/:id/mapping` (replace, 200), `POST /api/v1/datasets/:id/imports` (key UUID, đồng bộ 200 sau publish). Cùng key replay snapshot gốc, key mới cho dataset imported trả hiện trạng mà không nhập lại. Không có HTTP reading-batches hoặc endpoint report mới.

Mặc định nguồn lưu ở `<repo>/.local/imports` (gitignored); triển khai phải đặt `IMPORT_STORAGE_DIR` trên volume persistent, giữ cùng MongoDB qua restart. `.env.example` có các limits D012: 100 MiB/file, 1 MiB/record, batch 1.000, report 1.000 issues, 10.000 trạm, 2 uploads/1 import mỗi process, 120 giây. Cường đồng bộ proxy body size gồm multipart overhead và timeout lớn hơn Backend; không coi defaults là benchmark.

CSV UTF-8/header hoặc JSON array object phẳng. Trước mapping chỉ đếm cấu trúc; sau mapping kiểm tra ngữ nghĩa, import kiểm tra lại checksum/nguồn. Chỉ ug/m3 và timestamp có Z/offset, tối đa 3 chữ số phần lẻ; tọa độ bất nhất giữa dòng hợp lệ làm dataset failed. Invalid rows bị bỏ có báo cáo, zero/high finite vẫn hợp lệ. Report vượt cap làm 422, không thành công bị cắt lỗi.

Import failure giữ partial không public; chỉ `failed` sau cleanup, còn `importing` phải chờ đối soát. Retry chủ động: đọc validation → xác nhận lại mapping → key mới; key cũ replay failure cũ. Nguồn đã tiếp nhận không tự xóa. Đọc [runbook](../docs/backend/b3-verification.md) cho mất response/restart/file và điều kiện bàn giao B4.

## Cấu trúc và điểm tích hợp

```text
src/app.ts                 app factory, wiring plugin
src/main.ts                listen, signals, shutdown
src/config.ts              runtime configuration
src/plugins/               MongoDB lifecycle, lỗi HTTP, auth hooks
src/modules/health/        composition + routes/schema/service/repository
src/modules/users/         User service/repository, hashing và current user
src/modules/auth/          Register/Login, JWT và composition auth hooks
src/modules/datasets/      list/import và public DatasetReadAccess cho parent visibility
src/modules/query/         sensors/readings theo routes/validation/service/repository, bounded keyset
src/shared/http/           lỗi và response schema
src/shared/persistence/    BSON/keyset/indexes + durable receipt transaction/lease primitives
src/shared/pagination.ts   bounded query, fingerprint, signed opaque cursor
src/shared/idempotency.ts  header validation, replay semantics, store interface
```

Tạo feature mới theo mẫu health. Route không query DB; `index.ts` ghép repository/service/routes. Feature khác gọi public interface, không import repository nội bộ. Mapper whitelist DTO, không spread raw MongoDB document. Helper kiểm tra cùng dataset chưa thay thế nghiệp vụ toàn vẹn/visibility phải làm ở các feature sau.

HTTP dùng JSON Schema/Ajv, từ chối trường ngoài schema và không coerce body. Query/params qua URL được chuyển kiểu theo schema (ví dụ `?limit=100` thành integer); shared `$ref` giữ đúng encapsulation. Route tương lai khai báo `config.bodyValidationStatus: 422` khi OpenAPI cho phép; mặc định validation `400`. Cú pháp JSON/query lỗi vẫn `400`, media type lỗi `415`. Lỗi nội bộ/stack/raw payload không đưa ra response/log. Health/error schema được đối chiếu OpenAPI; C02–C04 của DTO nghiệp vụ vẫn chờ review trước feature liên quan.

JWT được xác minh bằng jose (HS256, issuer/audience, sub/iat/exp, hạn 1 giờ); payload không giữ role làm nguồn quyền. `authenticate`/`authorize(roles)` dùng verifier thật mặc định, đọc User từ DB mỗi protected request; inactive/không còn user trả 401, thiếu quyền trả 403. `/users/me` trả UserPublic được đọc qua User service. Verifier override chỉ là điểm DI cho tests B1; `main.ts` không cấu hình override.

Username trim đầu/cuối; giữ cách viết để hiển thị, so trùng/login bằng lowercase. Password được giữ nguyên cả khoảng trắng, create tối thiểu 8 ký tự. `crypto.scrypt()` bất đồng bộ với N=2^17/r=8/p=1, maxmem 256 MiB, salt ngẫu nhiên 16 byte, derived key 64 byte; hash lưu kèm profile/salt, so sánh bằng timingSafeEqual. Một limiter dùng chung giới hạn **2 tác vụ hash/verify đồng thời mỗi process**, không dùng scryptSync. Unknown username vẫn chạy so sánh cùng chi phí; không trả passwordHash qua API. Cần đo hiệu năng trước tăng concurrency hoặc ngưỡng login.

Datasets list dùng cursor đã ký gắn với operation/filter/sort; lỗi cursor không tương thích trả 400. Limit mặc định 100/tối đa 200; sort whitelist; keyset có `_id` tie-break, lấy thêm đúng một dòng để xác định nextCursor. Chỉ query status imported, không thêm dataset detail hoặc cam kết snapshot. DTO whitelist cả nested importSummary, không lộ storagePath/mapping nội bộ.

B3 có durable `idempotencyReceipts`: unique user+key, fingerprint operation/path/content, replay 24 giờ, in-flight 409, payload mismatch 422, key expired 409 và giữ receipt không TTL. Transaction nhỏ chốt effect/receipt cùng nhau, lease + fencing chống worker cũ ghi/dọn sau recovery. Đây là primitive dùng chung; B5/B7 phải ghép effect/atomicity riêng, không tự coi queue/run/admin đã được triển khai hoặc recover bởi B3.

## MongoDB indexes

Sau khi cấu hình đúng database đích và MongoDB chạy:

```powershell
npm run db:indexes --workspace @pm25/server
```

Lệnh tạo/kiểm tra lặp lại được **13 indexes online** trên 7 collections theo physical design và `infra/mongo/indexes.js`. Không tạo `processedMutations` hoặc sync indexes, không xóa dữ liệu. Unique-index setup thất bại nếu dữ liệu có sẵn bị trùng; phải kiểm tra và xử lý riêng. Health/khởi động Server không tự tạo index. B3 chuẩn bị indexes trước request đầu tiên và trong recovery sweep; standalone không được sử dụng để import. **B2 User Repository bảo đảm unique usernameNormalized index tồn tại trước insert đầu tiên**, kể cả trên DB mới, để Register/CLI/future Admin không thể tạo trùng do race; không tự cleanup dữ liệu cũ bị trùng.

Harness mặc định tải `mongod` 8.2.6/WiredTiger trên database/port tạm. Lượt B3 hiện tại dùng binary MongoDB **9.0.4** có sẵn với `MONGOMS_SYSTEM_BINARY`; B1/B2 chạy standalone, B3 chạy replica set 1 node thực để kiểm chứng transactions/recovery. Không khóa phiên bản triển khai chung hoặc nghiệm thu Sync/HA. Cường tiếp tục Docker/replica-set triển khai, volume và Nginx/TLS; xem lệnh tái lập trong B3 verification.

## Demo/bootstrap có chủ đích

Điền 4 biến `SEED_ADMIN_USERNAME`, `SEED_ADMIN_PASSWORD`, `SEED_ANALYST_USERNAME`, `SEED_ANALYST_PASSWORD` vào env hoặc `.env` gitignored; username phải khác nhau sau normalize, password ít nhất 8 ký tự. Không có password mặc định. Thêm `SEED_DEMO_DATA=true` nếu muốn một dataset metadata `[SEED B2]` cho màn Datasets.

```powershell
npm run db:indexes --workspace @pm25/server
npm run db:seed --workspace @pm25/server
```

Seed dùng cùng User service/hash/unique rule với Register. Chạy lại không reset password, role hoặc isActive của tài khoản đã có; tài khoản trùng tên nhưng sai role/inactive làm seed thất bại. Dataset cố định ghi rõ **metadata demo, chưa qua import thật**, counts 0; không có readings hoặc kết quả detector giả. Không có HTTP bootstrap endpoint. CLI chạy trên DB đích trong env; chỉ chạy khi chủ động muốn thêm tài khoản/dữ liệu thử.

## Kiểm thử

```powershell
# Unit/HTTP/contract, không cần DB bên ngoài.
npm test --workspace @pm25/server
# Khởi tạo mongod thật trên port tạm, gồm mất DB và phục hồi.
npm run test:server:integration
# Bao gồm unit và MongoDB integration.
npm run test:coverage --workspace @pm25/server
# Browser E2E FE online + Backend + mongod thật, không HTTP intercept.
npm run test:e2e:b2
npm run test:e2e:b3
npm run test:e2e:b4
# Kiểm tra cả client/server; integration thật là lệnh riêng phía trên.
npm run check
```

`mongodb-memory-server` quản lý binary/process và thư mục test; driver gửi lệnh tới MongoDB thật. Lần đầu cài/chạy cần tải binary từ MongoDB. Lỗi tải/khởi động làm integration thất bại, không bỏ qua/chuyển mock. Test không dùng `MONGODB_URI` của người dùng hoặc sửa DB có sẵn; mongod tạm đóng sau suite.

Coverage tính `src/**` trừ entrypoint `main.ts`; scripts CLI không nằm trong coverage. Báo cáo tại `server/coverage/` (gitignored). Unit service dùng test doubles có nhãn; integration B2 dùng scrypt/JWT/DB thật. Browser suite tự khởi tạo DB tạm, Backend và Vite online trên port tạm rồi dọn process, không đụng DB người dùng. Nếu Chromium chưa có, chạy `npx playwright install chromium` trong thư mục server. E2E thật bao phủ M2–M4; B5 Analysis trở đi còn chờ. Mapbox token/tiles thật vẫn chưa nghiệm thu. Test doubles/fault hooks chỉ dùng trong tests, main không bật; B3 E2E dùng file/API/DB thật, không intercept. Đã đo Query seed 100k/500k ở B4; chưa nghiệm thu load/stress, TLS hoặc SLA/peak memory trên triển khai thật.

Tham chiếu triển khai: [Fastify validation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/), [Fastify routing lookup](https://fastify.dev/docs/latest/Reference/Server/#findroute), [Official Driver timeout](https://www.mongodb.com/docs/drivers/node/current/connect/connection-options/csot/). Driver 7.9 dùng timeout theo giai đoạn; `timeoutMS` deprecated không được dùng làm bảo đảm timeout.
