# Server — Backend P0 online

**B1 đã triển khai ngày 14/11/2026:** Fastify + TypeScript, MongoDB Official Driver theo D010, feature modules với Route → Validation → Service → Repository → MongoDB. Owner: Khiêm; Cường phối hợp môi trường/kiểm thử. Xem [B1 verification](../docs/backend/b1-verification.md).

## Chạy từ thư mục gốc

Yêu cầu Node.js ≥22.12, npm và MongoDB đang hoạt động cho health `200`. Các phiên bản khóa trong package/lockfile: Fastify 5.12.8, Official Driver 7.9.0, TypeScript 5.9.3.

```powershell
npm ci
# Tạo cấu hình nếu chưa có; giữ nguyên .env đang dùng.
if (-not (Test-Path .env)) { Copy-Item .env.example .env }
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
| `JWT_SECRET` | Dành cho B2; B1 chưa dùng để cấp/xác minh token |

Nếu FE dùng `localhost` thay vì `127.0.0.1`, thêm origin đó vào `CORS_ORIGINS`. Nginx HTTPS/same-origin thuộc hạ tầng Cường; B1 chưa nghiệm thu TLS/reverse proxy. Không bật `trustProxy` khi chưa biết topology proxy.

## API đã có và API chưa có

Chỉ có **GET `/api/v1/health`**, public theo OpenAPI:

- `200 {"status":"ok","timestamp":"...Z"}` nếu MongoDB ping thành công.
- `503 {"status":"degraded","timestamp":"...Z"}` nếu MongoDB chưa sẵn sàng; Server tiếp tục phục vụ readiness và kết nối lại khi DB phục hồi.
- Method không hỗ trợ trả `405` với `Allow`. HEAD không tự bật. Khi cấu hình CORS, OPTIONS preflight là xử lý transport, không phải API nghiệp vụ mới.
- Path chưa triển khai trả `404` theo error envelope; không có fallback fixture.

19 operations P0 online còn lại chưa có handler. Analysis theo D008/D009 async sẽ làm ở B5; B1 chưa có worker/queue/model thật. Offline/Sync/P1 và HTTP `reading-batches` vẫn hoãn.

## Cấu trúc và điểm tích hợp

```text
src/app.ts                 app factory, wiring plugin
src/main.ts                listen, signals, shutdown
src/config.ts              runtime configuration
src/plugins/               MongoDB lifecycle, lỗi HTTP, auth hooks
src/modules/health/        composition + routes/schema/service/repository
src/shared/http/           lỗi và response schema
src/shared/persistence/    BSON mapping, keyset predicate, online indexes
src/shared/pagination.ts   bounded query, fingerprint, signed opaque cursor
src/shared/idempotency.ts  header validation, replay semantics, store interface
```

Tạo feature mới theo mẫu health. Route không query DB; `index.ts` ghép repository/service/routes. Feature khác gọi public interface, không import repository nội bộ. Mapper whitelist DTO, không spread raw MongoDB document. Helper kiểm tra cùng dataset chưa thay thế nghiệp vụ toàn vẹn/visibility phải làm ở các feature sau.

HTTP dùng JSON Schema/Ajv, từ chối trường ngoài schema và không coerce body. Query/params qua URL được chuyển kiểu theo schema (ví dụ `?limit=100` thành integer); shared `$ref` giữ đúng encapsulation. Route tương lai khai báo `config.bodyValidationStatus: 422` khi OpenAPI cho phép; mặc định validation `400`. Cú pháp JSON/query lỗi vẫn `400`, media type lỗi `415`. Lỗi nội bộ/stack/raw payload không đưa ra response/log. Health/error schema được đối chiếu OpenAPI; C02–C04 của DTO nghiệp vụ vẫn chờ review trước feature liên quan.

`authenticate`/`authorize(roles)` là hooks chuẩn bị cho B2. Phải inject `verifyAccessToken` thực hiện kiểm tra chữ ký/hạn JWT và đọc tài khoản hiện tại theo chính sách được duyệt. Chưa có verifier thì từ chối thao tác; không tin JWT payload chưa xác minh, role header hoặc client state. B1 dùng verifier giả trong tests có nhãn, không chứng minh JWT thật đã có.

Cursor codec yêu cầu signing secret truyền từ composition khi feature list được triển khai; kiểm tra version/signature/fingerprint operation+filters+sort, lỗi `400`. Limit mặc định 100/tối đa 200; sort whitelist; keyset có `_id` tie-break. Chưa có list handler hoặc cam kết snapshot.

Idempotency mới có kiểm tra UUID, interface claim/complete và ánh xạ replay/in-flight/payload mismatch. **Chưa có store bền vững, retention hoặc effect/receipt recovery.** Không bật RAM-store giả hoặc tự retry mutation; phải chốt các quyết định còn mở trước POST ở B3/B5/B7.

## MongoDB indexes

Sau khi cấu hình đúng database đích và MongoDB chạy:

```powershell
npm run db:indexes --workspace @pm25/server
```

Lệnh tạo/kiểm tra lặp lại được **11 indexes online** trên 6 collections theo physical design và `infra/mongo/indexes.js`. Không tạo `processedMutations` hoặc sync indexes, không xóa dữ liệu. Unique-index setup thất bại nếu dữ liệu có sẵn bị trùng; phải kiểm tra và xử lý riêng. Không tạo index khi gọi health/khởi động Server.

Integration test dùng `mongod` 8.2.6 thực/WiredTiger/database tạm. Đây là phiên bản kiểm thử, chưa khóa bản MongoDB triển khai chung. Suite chạy standalone, không kiểm chứng transaction replica-set/sync. Cường tiếp tục phụ trách môi trường MongoDB replica set/Docker và Nginx/TLS.

## Kiểm thử

```powershell
# Unit/HTTP/contract, không cần DB bên ngoài.
npm test --workspace @pm25/server
# Khởi tạo mongod thật trên port tạm, gồm mất DB và phục hồi.
npm run test:server:integration
# Bao gồm unit và MongoDB integration.
npm run test:coverage --workspace @pm25/server
# Kiểm tra cả client/server; integration thật là lệnh riêng phía trên.
npm run check
```

`mongodb-memory-server` quản lý binary/process và thư mục test; driver gửi lệnh tới MongoDB thật. Lần đầu cài/chạy cần tải binary từ MongoDB. Lỗi tải/khởi động làm integration thất bại, không bỏ qua/chuyển mock. Test không dùng `MONGODB_URI` của người dùng hoặc sửa DB có sẵn; mongod tạm đóng sau suite.

Coverage tính `src/**` trừ entrypoint `main.ts`; scripts CLI không nằm trong coverage. Báo cáo tại `server/coverage/` (gitignored). Unit service có test double; auth HTTP tests dùng verifier giả; integration readiness/index/BSON/keyset/geo/HTTP socket dùng DB thật. Chưa nghiệm thu FE nghiệp vụ E2E, load/stress, TLS hoặc performance dataset lớn.

Tham chiếu triển khai: [Fastify validation](https://fastify.dev/docs/latest/Reference/Validation-and-Serialization/), [Fastify routing lookup](https://fastify.dev/docs/latest/Reference/Server/#findroute), [Official Driver timeout](https://www.mongodb.com/docs/drivers/node/current/connect/connection-options/csot/). Driver 7.9 dùng timeout theo giai đoạn; `timeoutMS` deprecated không được dùng làm bảo đảm timeout.
