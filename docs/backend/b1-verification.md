# B1 — Nền Fastify, MongoDB và cơ chế dùng chung

Ngày kiểm tra: 14/11/2026. Phạm vi: [Backend B1](../backend-online-plan.md#b1--nền-fastify-mongodb-và-cơ-chế-dùng-chung). **Đã triển khai phần nền Backend và kiểm chứng với MongoDB thật; chỉ GET `/api/v1/health` có handler nghiệp vụ/system trong OpenAPI.**

## Kết quả triển khai

| Hạng mục | Kết quả / bằng chứng |
|---|---|
| Workspace | Package `@pm25/server`, TypeScript strict/NodeNext, dev/build/start/typecheck/lint/test; root scripts bao phủ client + server |
| Kiến trúc | App factory riêng main; Fastify plugins; feature health có composition, route/schema/service/repository; native driver theo D010 |
| Health | Ping DB thật: `200 HealthResponse`; DB không sẵn sàng: `503 HealthResponse`; UTC Z; không lỗi envelope hoặc thông tin connection |
| Recovery/shutdown | Khi mất DB hoặc DB chưa sẵn lúc startup: degraded, sau phục hồi trả 200 bằng cùng app. App.close đóng MongoDB topology và HTTP socket |
| HTTP | JSON Schema/Ajv không strip extra fields/coerce body; URL query/params được chuyển kiểu theo schema (limit integer), shared `$ref` giữ đúng encapsulation; config `422` theo operation, syntax/query `400`, media type `415`, method `405/Allow`, unknown path `404` |
| Log | Không log body/query/header secrets mặc định; redaction password/hash/token; unexpected error không xuất driver message/stack |
| CORS | Allowlist origin qua env cho FE local, không wildcard/cookie credentials; preflight là transport. Unknown path vẫn 404 khi có wildcard OPTIONS |
| Auth hooks | Bearer parsing, injected verifier, role/active check và 401/403; chưa có verifier thì fail closed. Tests dùng verifier giả tường minh |
| Cursor | Limit 100/200, sort whitelist, fingerprint operation/filter/sort, HMAC signature/version và keyset tie-break; chưa có API list |
| Mapping | ObjectId/date/GeoJSON → whitelist DTO; zero hợp lệ, finite/nonnegative, lon/lat đúng; helper chống reference khác dataset |
| Index | 11 indexes online từ physical design; CLI chủ động, không chạy tự động lúc startup; test repeatability, unique keys và geo query |
| Idempotency | UUID header, interface claim/complete, replay status/body, in-flight 409/payload mismatch 422; chưa có store/retention/recovery |

Không sửa OpenAPI, shared-core, thuật toán/ML, queue hoặc các quyết định nghiệp vụ mở để hoàn thành B1. Không triển khai handler Auth/User/Dataset/Query/Analysis/Anomaly/Admin, Offline/Sync, aggregates hay internal reading-batches.

## Kiểm chứng đã chạy

Môi trường: Windows, Node 24.14.1, npm 11.11.0. Fastify 5.12.8, MongoDB Official Driver 7.9.0, Vitest 5.1.0. `mongodb-memory-server` 11.3.0 khởi tạo binary **mongod 8.2.6 thực/WiredTiger** trên port tạm. Không có MongoDB mock trong suite integration; không dùng DB do người dùng cấu hình.

| Lệnh/kiểm tra | Kết quả |
|---|---|
| `npm run check` từ root | PASS: typecheck, lint, tests và build cho client/server; generated client contract giữ 20 online operations/33 schemas |
| Client tests trong root check | PASS: 76 tests / 10 files; đây là regression suite FE, không tính vào kiểm thử DB thật |
| Server tests trong root check | PASS: 14 unit/HTTP/contract tests / 3 files |
| `npm run test:coverage --workspace @pm25/server` | PASS: 18 tests / 4 files, gồm 4 tests MongoDB integration |
| Index CLI smoke | PASS: chạy `scripts/ensure-indexes.ts` bằng tsx trên DB tạm, exit 0; không đụng DB người dùng |
| Compiled runtime smoke | PASS: chạy `dist/main.js` bằng Node process, HTTP GET health trả 200 với MongoDB thật và CORS cho FE origin được phép; process/DB tạm đã đóng |
| Runtime dependency audit | `npm audit --omit=dev`: 0 vulnerabilities ở thời điểm kiểm tra |

Coverage V8 cho source B1 (trừ entrypoint `src/main.ts`; scripts CLI không nằm trong coverage): statements **98,48%**, branches **92,07%**, functions **98%**, lines **99,38%** ở lần đo B1. Đây là độ phủ source hiện có, không phải coverage cho API/engine còn chưa triển khai. Artifacts tạo lại tại `server/coverage/`, không commit.

Root check có cảnh báo hiện có từ router CLI về circular dependency và bundle Three.js lớn; không gây lỗi build/test và không được xử lý bằng thay đổi FE ngoài B1. Full npm audit còn cảnh báo moderate của chuỗi công cụ lint/minimatch (lockfile trước B1 đã có minimatch 10.2.6); runtime audit sạch. Không chạy `npm audit fix --force` để đổi dependency/major version của FE.

## Kịch bản DB thật

1. Listen HTTP trên port tạm, gọi health bằng fetch và inject: nhận 200/ok.
2. Dừng mongod: cùng app trả 503/degraded; khởi động lại cùng port: health phục hồi 200.
3. Khởi tạo app khi DB đang tắt: health vẫn phục vụ 503, sau khi DB chạy lại phục hồi 200. Đường repository chủ động connect lại để xử lý closed topology sau lần connect đầu thất bại; healthy clients tái sử dụng pool.
4. App.close phát topologyClosed và socket ngừng nhận request. Main có signal handlers; suite không giả định `child.kill()` trên Windows tương đương POSIX graceful SIGTERM.
5. Tạo indexes hai lần; xác minh keys/name/unique của từng index. Thử trùng username, sensor dataset+externalId, reading dataset+sensor+ts và anomaly run+reading: MongoDB từ chối bằng E11000. Dataset/run khác vẫn được phép dùng lại logical references.
6. Lưu/đọc BSON Date/ObjectId/GeoJSON, map DTO whitelist; 5 readings có cùng ts phân trang cả hai chiều, không mất/trùng; geo bbox trả đúng 5 điểm. Explain trên seed nhỏ chỉ xác nhận query chạy qua index được chỉ định, chưa phải benchmark 100k–500k.

## Bàn giao và phần tiếp tục

- Hướng dẫn env/start/index/test tại [server README](../../server/README.md). Base URL local mặc định `http://127.0.0.1:3001/api/v1`; dùng MongoDB của môi trường để health trả 200, hoặc 503 nếu DB unavailable.
- Auth/RBAC unit tests dùng verifier giả; không chứng minh JWT thật, password hashing, unique User flow hoặc quyền hiệu lực đã được triển khai. Cần các quyết định B2 trước phần đó.
- Index tests không thay cho BR-08 parser/dedup, FK, dataset visibility hoặc transaction review/sync; các workflow này vẫn phải làm theo B3–B7.
- Interface idempotency không có receipt store. Persistence/replay window/atomicity/recovery vẫn là gate trước POST liên quan; không có Redis/BullMQ hoặc collection mới được chọn trong B1.
- C02–C04 còn mở với owner nghiệp vụ; HTTP/schema nền của B1 không tự khóa normalization/timezone/precision/schema detector.
- Docker daemon chưa chạy trong phiên kiểm tra; dùng test harness mongod thật thay thế môi trường integration local. Docker/replica set/Nginx HTTPS/CI của Cường chưa được triển khai hoặc nghiệm thu tại đây. Không có tuyên bố sync/transactions đã sẵn sàng.
- Chưa chạy FE nghiệp vụ E2E với Backend thật vì 19 APIs còn lại chưa có handler. Chưa đánh giá load/stress, dữ liệu lớn hoặc thống kê/ML.

B1 đủ nền và bằng chứng để bắt đầu B2. Không đánh dấu các milestone nghiệp vụ tiếp theo hoàn thành từ kết quả này.
