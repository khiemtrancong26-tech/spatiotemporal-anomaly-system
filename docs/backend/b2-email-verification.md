# B2-Email Extension — kiểm chứng và demo

Ngày 17/11/2026, branch `khiem/backend-database`. Mở rộng Auth hiện có; không là milestone mới. Giữ nguyên tài liệu nghiệm thu B2 gốc, không đổi số liệu lịch sử.

## Kết quả

| Acceptance | Kết quả thực tế |
|---|---|
| Flow A: Register → pending → resend → explicit verify → Login | PASS tự động, MongoDB thật + email sender giả; UI xác nhận tường minh, không tự đăng nhập |
| Flow B: Forgot → reset token → new password → Login | PASS tự động, MongoDB thật + sender giả; UI kiểm confirm password và quay về Login |
| Legacy/admin/seed, RBAC/current active state | PASS trong regression Auth/B2; không tự migrate/khóa user cũ |
| JWT trước reset, kể cả JWT thiếu authVersion | PASS: 401 sau reset; Login mới hoạt động |
| Standalone / Replica Set | PASS: các cập nhật user đơn document; không transaction |
| Gửi email thật qua Resend / xác minh domain | CHƯA CHẠY, BLOCKED cấu hình; không coi fake sender là giao thư thật |

Audit `.env` chỉ kiểm sự có mặt, không in secret: **thiếu RESEND_API_KEY, RESEND_FROM_EMAIL, PUBLIC_APP_URL**. Chưa có recipient được cho phép cho smoke test; không gửi thư thật, không dùng quota email. Phải cấu hình sender/domain hợp lệ trên Resend trước demo thực tế.

## Thiết kế tối thiểu đã dùng

- Tái sử dụng username trim/lowercase, scrypt bất đồng bộ/limiter2, JWT HS2561h, User Service/Repository, Fastify rate-limit, error envelope, React AuthFrame/router/session và generated HTTP adapter.
- Public Register chỉ username/email/password. Lưu trimmed email và lowercase emailNormalized; partial unique index chỉ string, tạo trước insert và bắt duplicate key race. Analyst/active nhưng emailVerificationRequired=true/emailVerifiedAt=null. Role/isActive/verification fields từ HTTP bị từ chối422.
- Token random32 bytes, raw chỉ nằm trong email link và request consume; DB chỉ SHA256. Hai mục đích riêng, verification24h/reset15 phút, thay token cũ khi cấp mới. Cooldown60s được giữ trong users; mỗi endpoint có rate limit IP/process dùng LOGIN_RATE_LIMIT_MAX/WINDOW_MS hiện có. Không phải distributed limiting.
- Register201 không JWT, UI pending. Nếu user đã tạo nhưng provider thất bại:503 REGISTRATION_EMAIL_FAILED, giữ pending và hướng dẫn resend, không đăng ký lại. Forgot/Resend luôn200 generic cho email có/không có, inactive/unverified/cooldown/provider failure; không xác nhận đã giao thư. Lỗi vận hành được log thông điệp cố định, không log token/password/API key. Provider failure bỏ cooldown của đúng hash đang giữ để cho retry sau; không kích hoạt user.
- Consume bằng conditional update kiểm hash/expiry. Verify chỉ đặt emailVerifiedAt/unset verification; không đổi isActive/JWT. Reset kiểm eligible verified active, đổi hash+unset reset+inc authVersion trong cùng update. Hai reset đồng thời chỉ một thành công.
- JWT mới mang authVersion; claim thiếu/user field thiếu mặc định0. Protected lookup so version và role/isActive hiện tại; internal auth fields không vào UserPublic. Không refresh token/session table/blacklist.
- Có đúng4 POST mới: /auth/verify-email, /auth/resend-verification, /auth/forgot-password, /auth/reset-password. Login request vẫn username/password; credentials sai vẫn401 chung, đúng nhưng chưa verify trả403 EMAIL_NOT_VERIFIED.
- Resend REST POST /emails, text mail, timeout10s, chỉ dùng origin PUBLIC_APP_URL được kiểm; không tin Host header. [API provider chính thức](https://resend.com/docs/api-reference/emails/send-email). Không SDK/framework/queue/retry worker/webhook/template engine mới.
- Public pages /verify-email, /forgot-password, /reset-password qua AuthGate; protected pages vẫn cần session. Verify phải nhấn xác nhận, không consume do GET/scanner. Token chỉ ở memory, xóa khỏi URL khi mount; referrer policy no-referrer. Reset xóa password state và quay Login; không auto-auth. Không thiết kế Mobile/Tablet.
- Mock email workflows trả503 MOCK_EMAIL_NOT_IMPLEMENTED, không tạo user/verification giả; mock legacy/demo Login vẫn giữ.

## Kiểm thử đã chạy

```powershell
$env:MONGOMS_SYSTEM_BINARY='C:/Program Files/MongoDB/Server/9.0/bin/mongod.exe'
$env:MONGOMS_SYSTEM_BINARY_VERSION_CHECK='false'
npm exec --workspace @pm25/server -- vitest run tests/email.integration.test.ts tests/auth.test.ts tests/b2.integration.test.ts tests/contract.test.ts
# PASS21 tests /4 files
npm exec --workspace @pm25/server -- vitest run tests/email.test.ts
# PASS1 test, Resend HTTP fetch bị giả lập, không network
npm exec --workspace @pm25/client -- vitest run src/features/auth/email-pages.test.tsx src/features/auth/session.test.ts src/shared/data-source/online.test.ts src/shared/api/http-client.test.ts
# PASS58 tests /4 files
npm run typecheck --workspace @pm25/server
npm run lint --workspace @pm25/server
npm run build --workspace @pm25/server
npm run typecheck --workspace @pm25/client
npm run lint --workspace @pm25/client
npm run build --workspace @pm25/client
# PASS; generation26 online operations/48 schemas, shared build đi theo Server pre-hook
```

Cases chính: valid/invalid/missing email, concurrent duplicate normalized email, injection, pending Login, verify invalid/expired/reused/wrong-purpose, resend cooldown/replacement/failure, generic Forgot, reset invalid/expired/reused/concurrent, password thay đổi, JWT revocation, legacy/seed/RBAC, public Auth routing và protected redirect, pending delivery-error recovery, password confirmation. Provider unit test dùng fake fetch kiểm request trusted origin và lỗi provider/missing config.

Các lỗi kiểm thử/type ban đầu đã sửa: test double password verify, thứ tự required/schema và index count sau thêm email index, type payload inject, non-null mock calls và Testing Library options. Kết quả trên là các lượt đã PASS, không bỏ qua test lỗi. Build có warning chunk size có sẵn; không tối ưu vì ngoài scope. jsdom báo scrollTo chưa hỗ trợ, tests vẫn PASS.

Không chạy benchmark/load/stress/coverage campaign, full regression, ML hoặc E2E trình duyệt. Hai E2E Auth hiện có đã chỉnh fixture/expectation cho email pending/mock unavailable nhưng **chưa chạy lại**, không ghi PASS. Mongod thực tế9.0.4 override version harness8.2.6; không giả nhận đã chạy8.2.6.

## Demo local

1. Giữ `.env` hiện có, thêm các giá trị thật (Backend only):

```dotenv
RESEND_API_KEY=re_actual_key_from_resend
RESEND_FROM_EMAIL=auth@your-verified-domain.example
PUBLIC_APP_URL=http://127.0.0.1:5173
```

2. Xác minh domain/sender trên Resend; dùng recipient được phép. Không đặt key dưới VITE_ hoặc commit secret. Khởi động `npm run dev:server` và `npm run dev`. Thiếu cấu hình: Backend cảnh báo, legacy Login vẫn dùng được; Register tạo pending và trả lỗi giao thư rõ ràng, không bypass verification.
3. Register username/email/password →pending; mở email →nhấn Xác nhận email →Login. Nếu giao thư lỗi, dùng Gửi lại xác minh; sau successful send chờ60s trước resend.
4. Tại Login chọn Quên mật khẩu →nhập email đã verified →mở mail →nhập và xác nhận password mới →Login lại. Token reset hết hạn sau15 phút. JWT cũ bị từ chối; reload/login lại khi session cũ lỗi401.
5. Không chạy lại registration bằng key/flow khác để xử lý lỗi giao thư; không auto-login sau verify/reset. Email link chỉ hoạt động tại origin PUBLIC_APP_URL đã cấu hình. Hạ tầng hosting phải phục vụ SPA routes và tránh log query chứa token; TLS/Nginx nằm ngoài task.

## Phạm vi dữ liệu và giới hạn

Không kết nối để sửa dữ liệu MongoDB người dùng; toàn bộ writes kiểm thử nằm ở MongoDB tạm. Không reset/drop/migrate user hiện có, không sửa `.env`, không commit/push. Không chạm B7/B8/Offline/Sync/ML/rendering. Index mới chỉ được tạo khi operator chạy db:indexes hoặc workflow tạo user/email cần index; conflict/duplicate legacy làm thao tác thất bại để operator xử lý, không tự sửa/xóa records.

SMTP/domain/recipient thực tế chưa kiểm chứng. Không queue/background retry; sender timeout/failure cần người dùng resend. Resend acknowledgement không bảo đảm thư đã đến inbox. In-memory IP limiting chỉ theo process. Browser session cũ không tự biến mất ở tab khác; Backend từ chối ngay theo authVersion và người dùng phải Login lại. Không bổ sung email-change, CAPTCHA, OAuth, refresh tokens hoặc 2FA.

## Files thay đổi thực tế

- `.env.example`
- `README.md`
- `client/README.md`
- `client/e2e/foundation.spec.ts`
- `client/index.html`
- `client/src/app/shell.tsx`
- `client/src/features/auth/email-pages.test.tsx`
- `client/src/features/auth/email-pages.tsx`
- `client/src/features/auth/pages.tsx`
- `client/src/features/auth/register.tsx`
- `client/src/mocks/transport.ts`
- `client/src/routeTree.gen.ts`
- `client/src/routes/forgot-password.tsx`
- `client/src/routes/login.tsx`
- `client/src/routes/reset-password.tsx`
- `client/src/routes/verify-email.tsx`
- `client/src/shared/api/generated/contract.json`
- `client/src/shared/api/generated/openapi.d.ts`
- `client/src/shared/api/generated/wire.ts`
- `client/src/shared/data-source/online.test.ts`
- `client/src/shared/data-source/online.ts`
- `client/src/shared/data-source/types.ts`
- `docs/SDD.md`
- `docs/SRS.md`
- `docs/api/openapi.yaml`
- `docs/backend/b2-email-verification.md`
- `docs/fixtures/frontend-online-examples.json`
- `infra/mongo/indexes.js`
- `server/README.md`
- `server/e2e/b2.spec.ts`
- `server/src/app.ts`
- `server/src/config.ts`
- `server/src/modules/auth/auth.routes.ts`
- `server/src/modules/auth/auth.schema.ts`
- `server/src/modules/auth/auth.service.ts`
- `server/src/modules/auth/email.service.ts`
- `server/src/modules/auth/email.ts`
- `server/src/modules/auth/index.ts`
- `server/src/modules/auth/tokens.ts`
- `server/src/modules/users/users.repository.ts`
- `server/src/modules/users/users.service.ts`
- `server/src/modules/users/users.types.ts`
- `server/src/shared/persistence/indexes.ts`
- `server/tests/auth.test.ts`
- `server/tests/b2.integration.test.ts`
- `server/tests/contract.test.ts`
- `server/tests/email.integration.test.ts`
- `server/tests/email.test.ts`
- `shared-core/src/contracts/schemas.ts`
