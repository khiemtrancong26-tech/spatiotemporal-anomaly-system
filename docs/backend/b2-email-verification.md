# B2-Email Extension — Gmail SMTP local demo

17/11/2026. Gmail SMTP là cơ chế gửi thư duy nhất; Nodemailer `service: "gmail"`, Google App Password. Không provider selector/fallback. `EmailSender.verification/reset` và email.service không đổi. Endpoint `/auth/resend-verification` vẫn là hành động gửi lại thư.

## Cấu hình và demo

Chỉ3 email env vars ở Backend, trong `.env` (không commit):

```dotenv
GMAIL_USER=your-demo-account@gmail.com
GMAIL_APP_PASSWORD=abcdefghijklmnop
PUBLIC_APP_URL=http://127.0.0.1:5173
```

App Password ở trên chỉ minh họa, cần thay bằng mật khẩu ứng dụng thật. From luôn là GMAIL_USER, không có biến From riêng. App Password16 ký tự; code bỏ khoảng trắng khi chép dạng4 nhóm. PUBLIC_APP_URL phải là origin HTTP(S) tin cậy, không lấy từ Host request.

1. Bật 2-Step Verification cho tài khoản Gmail demo, tạo App Password tại Google Account. Một số tài khoản tổ chức/Advanced Protection không có tùy chọn này; xem [Google hướng dẫn](https://support.google.com/accounts/answer/185833). Không dùng mật khẩu đăng nhập Google thông thường.
2. Thêm3 biến trên vào `.env`; dùng JWT/MongoDB config hiện có. Chạy `npm run dev:server` và `npm run dev`; restart Backend sau khi đổi env. Không cần domain riêng/ngrok/OAuth.
3. Register username/email/password với recipient được phép →pending →mở thư →nhấn Xác nhận email →Login. Các Gmail recipient khác nhau có thể tự đăng ký và nhận thư riêng, không cần đưa vào allowlist trong app.
4. Quên mật khẩu →nhập email verified →mở thư →nhập/confirm password mới →Login lại. Token verify24h/reset15 phút; cooldown gửi lại60s.
5. Nếu gửi Register lỗi: account vẫn pending, dùng Gửi lại, không đăng ký lại. Forgot/Resend trả thông báo generic, không xác nhận thư đã tới inbox.

Thiếu cấu hình vẫn cho legacy Login; gửi thư thất bại an toàn, không bypass verification. SMTP failure/rejected recipient không được báo là đã gửi. SMTP acceptance không bảo đảm inbox delivery; kiểm Spam và trạng thái tài khoản Gmail nếu không nhận thư.

Gmail phù hợp demo ít người, có quota/chặn chống spam và có thể chặn đăng nhập SMTP. Không hứa miễn phí không giới hạn hoặc SLA. Không queue/background retry; cần kết nối mạng SMTP được phép. Thay mật khẩu Google có thể thu hồi App Password. Tham khảo [Nodemailer Gmail](https://nodemailer.com/usage/using-gmail/).

## Giữ nguyên Auth

Không thay token/hash/expiry, repositories/atomic updates, scrypt, authVersion/JWT revocation, RBAC, legacy-user compatibility, API hoặc FE workflow. Không thêm token collection, transaction, TTL users hoặc hạ tầng mới. Credential/token/URL không được log; Nodemailer logger/debug tắt, SMTP diagnostics được chuyển thành lỗi cố định và đi qua email.service error handling hiện có.

Backend config chỉ gmailUser/gmailAppPassword/appUrl; App Password được redact trong logger. Bản ghi Git lịch sử được giữ; hướng dẫn hoạt động trong repo hiện dùng Gmail duy nhất. B2 nghiệm thu gốc vẫn ở [b2-verification.md](b2-verification.md).

## Kiểm chứng trong lượt chuyển Gmail

**PASS24 tests/5 files**: Gmail config/transport/errors và Auth/B2/email integration/contract. Typecheck, lint, build **Server PASS** (shared-core build theo pre-hook). Không chạy lại Client checks vì không thay code Client/API/FE; không benchmark, stress, coverage hoặc full regression. Tests dùng fake sender/mock Nodemailer, không SMTP thật.

```powershell
$env:MONGOMS_SYSTEM_BINARY='C:/Program Files/MongoDB/Server/9.0/bin/mongod.exe'
$env:MONGOMS_SYSTEM_BINARY_VERSION_CHECK='false'
npm exec --workspace @pm25/server -- vitest run tests/unit/email.test.ts tests/integration/email-auth.integration.test.ts tests/unit/auth.test.ts tests/integration/auth-and-datasets.integration.test.ts tests/unit/api-and-index-contract.test.ts
npm run typecheck --workspace @pm25/server
npm run lint --workspace @pm25/server
npm run build --workspace @pm25/server
```

Config runtime trong `.env` đã qua validation, đủ3 biến Gmail; không in credentials và không gửi thư. Search repo không còn brand/env/API provider cũ hoặc cấu hình chọn provider; giữ các từ resend thuộc nghiệp vụ. `git diff --check` PASS. MongoDB tests chạy instance tạm (installed mongod9.0.4 override harness8.2.6).

Chưa có kết quả gửi email thật tới Gmail trong task này; không coi transport giả là bằng chứng giao thư. Đã dọn1 dòng cấu hình email lỗi thời trong `.env`, giữ nguyên3 giá trị Gmail hiện có. Không sửa dữ liệu MongoDB người dùng, không commit/push.

## Files thay đổi

- `server/src/modules/auth/email.ts`: sender Nodemailer Gmail duy nhất; giữ interface và links.
- `server/src/config.ts`, `server/src/modules/auth/index.ts`, `server/src/app.ts`: Gmail env validation, startup warning và redaction.
- `server/package.json`, `package-lock.json`: thêm Nodemailer10.6.0 và types8.0.2; không có dependency email provider khác.
- `server/tests/unit/email.test.ts`: mock transport, config/multiple recipients/SMTP failure. Auth integration dùng fake sender cũ, không đổi token tests.
- `.env.example`, root/server/client README, `docs/SDD.md`, báo cáo này: hướng dẫn Gmail hiện hành; không thay API/FE hoặc SRS requirements.
