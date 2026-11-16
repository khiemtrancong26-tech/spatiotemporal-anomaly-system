# B2 — Auth/Register, User nền và Datasets list

Ngày kiểm tra: 14/11/2026. Phạm vi: [Backend B2](../backend-online-plan.md#b2--authregister-user-nền-và-datasets-list). **Đã triển khai 4 operations B2 trên B1, dùng MongoDB/scrypt/JWT thật; FE M2 đã chạy E2E không HTTP intercept.** Các quyết định bắt buộc được người dùng chốt tại [D011](../decisions.md#d011--quy-tắc-user-và-xác-thực-b2).

## API đã bàn giao

Tiền tố `/api/v1`; contract giữ OpenAPI v0.3.0-draft, không thêm endpoint hoặc đổi wire schema.

| Operation | Implementation / bằng chứng |
|---|---|
| POST `/auth/register` | Public, chỉ username/password; 201 UserResponse analyst/active, không token/hash/password; 409 username trùng; 422 semantic/trường ngoài schema; JSON sai cú pháp 400 |
| POST `/auth/tokens` | Public, 200 LoginResponse với JWT thật; unknown/wrong password/inactive cùng 401 an toàn; login rate limit 429 + Retry-After |
| GET `/users/me` | JWT + User DB hiện tại; trả đúng UserPublic; token thiếu/sai/hết hạn, user inactive/đã xóa → 401 |
| GET `/datasets` | JWT analyst/admin, chỉ imported; createdAt asc/desc, mặc định desc; limit 100/max200; keyset/cursor và empty page đúng envelope |

Health của B1 vẫn hoạt động; sau B2 có **5/20 operations online/health** đã triển khai. 15 operations còn lại chưa có handler. Admin CRUD thuộc B7; test không giả lập chúng thành đã hoàn tất.

## Quy tắc đã hiện thực

- User service/repository dùng chung cho Register, CLI và Admin tương lai. Username trim đầu/cuối, public giữ cách viết, lookup/unique dùng `toLowerCase()`. Không thêm regex ký tự hoặc maxLength chưa có trong contract; password không bị trim.
- Password hash bằng `crypto.scrypt()` bất đồng bộ, N=131072/r8/p1, maxmem 256 MiB, salt ngẫu nhiên 16 byte/credential và key 64 byte. Hash lưu profile/salt, verify bằng timingSafeEqual. Không dùng scryptSync; mọi instance trong process dùng chung limiter FIFO **tối đa 2 tác vụ scrypt đồng thời**, trả slot khi công việc lỗi. Hash dummy cùng chi phí cho unknown username.
- JWT HS256 hết hạn sau 3600 giây, secret ngẫu nhiên tối thiểu 32 byte từ env, không có default. Verify signature/algorithm/issuer/audience/sub/iat/exp; quyền lấy từ DB, không tin claim role/client header. JWT và cursor key được tách miền dẫn xuất, ổn định khi secret không đổi qua restart.
- Login rate limit chạy onRequest trước bước hash, theo IP thật của Fastify, mặc định **10 request/60 giây/IP**, cấu hình bằng env. Đây là thông số vận hành ban đầu có thể đo/chỉnh, không phải benchmark đã đạt. Bộ đếm RAM từng process, reset khi restart; không thêm Redis hoặc claim hạn mức chung cho cluster. Không bật trustProxy hoặc tin forwarding header tùy ý.
- User Repository xác lập unique usernameNormalized index đã được thiết kế trước insert đầu tiên. Race Register/Register hoặc Register/common User service tạo admin chỉ có một tài khoản thắng; lỗi DB/index không được biến thành đăng ký thành công.
- Dataset list chỉ query imported ở Repository; chỉ trả DTO whitelist, kể cả nested importSummary. Một hàng dư xác định nextCursor; tie-break theo `_id`, không đọc toàn bộ dataset để trả một trang. Cursor ký gắn với operation/filter/sort, không hứa snapshot khi nguồn thay đổi.
- CLI `db:seed` yêu cầu username/password analyst/admin từ env, không có default password. Chạy lại không reset password/quyền/isActive; role/state không phù hợp bị từ chối. Dataset optional `[SEED B2]` chỉ là metadata thử chưa qua import thật, không có readings hoặc output detector giả.

Route chỉ lắp schema/auth/service; MongoDB/BSON ở repository/composition, không truy cập cross-feature internal repository. HTTP validation dùng OpenAPI; schema tĩnh B2 được đối chiếu với contract. C02–C04 của các DTO/import/detector khác vẫn mở. Với auth JSON-only, lỗi parser/media/body-limit được phản hồi trong tập status operation hiện có (400), không tự sửa OpenAPI để thêm 413/415 của upload.

## Kiểm chứng đã chạy

Môi trường: Windows, Node 24.14.1, npm 11.11.0; Fastify 5.12.8, Official Driver 7.9.0, jose 6.2.17, rate-limit 11.2.2, Vitest 5.1.0, Playwright 1.65.0/Chromium. Integration dùng `mongod` **8.2.6 thực/WiredTiger** trên port/database tạm, không dùng MongoDB mock hoặc DB trong env của người dùng.

| Kiểm tra | Kết quả |
|---|---|
| `npm run check` từ root | PASS: client + server typecheck/lint/unit/contract/build; generated FE contract vẫn 20 operations/33 schemas |
| Client regression trong root check | PASS: 76 tests/10 files; không đổi code FE hoặc tính chúng vào bằng chứng MongoDB thật |
| Server unit/HTTP/contract trong root check | PASS: 24 tests/5 files, gồm test scrypt thật, JWT thật, limiter FIFO, User service doubles có nhãn, dataset/cursor và schema drift |
| `npm run test:coverage --workspace @pm25/server` | PASS: 35 tests/7 files, gồm 11 integration tests MongoDB thật (4 nền B1 + 7 B2) |
| Integration chạy bổ sung sau test race Register/common Admin service | PASS: 11 tests; không giả là đã có HTTP Admin endpoint |
| `npm run test:e2e:b2` / server workspace tương ứng | PASS: 1 browser E2E trên FE online + Backend + mongod thật, không `page.route`, không mock transport/intercept |
| CLI + compiled-runtime smoke | PASS: seed CLI trong Node process, chạy `dist/main.js`, admin Login/me/datasets trả 200 trên MongoDB thật; không in credentials, các process tạm đã đóng |
| Runtime dependency audit | `npm audit --omit=dev`: 0 vulnerabilities tại thời điểm kiểm tra |

Coverage V8 trên `src/**` trừ `main.ts` (scripts CLI/browser suite không tính vào coverage): statements **96,73%**, branches **92,01%**, functions **99,04%**, lines **98,48%**. Đạt mục tiêu server ≥80% trên source hiện có, không đại diện cho API/engine chưa triển khai. Artifacts tái tạo tại `server/coverage/`, gitignored.

Root check vẫn có cảnh báo router CLI circular dependency/bundle Three.js lớn từ FE. Full npm audit còn 9 moderate thuộc chuỗi công cụ lint đã ghi nhận ở B1; không chạy force upgrade FE để thay phạm vi B2. Không có lỗi test/build hoặc runtime advisory trong lượt kiểm tra này.

## Kịch bản nghiệm thu thật

1. Register trim/case, trả analyst/active/201 không token; DB lưu hash/profile/salt. Login bằng casing khác thành công, me trả đúng user public.
2. Payload role/isActive/unknown fields, username trắng hoặc sai kiểu, password ngắn bị từ chối. JSON sai cú pháp, query sai và NoSQL-object trong username không lọt qua validation.
3. Bốn Register cùng normalized username gửi đồng thời: một 201, ba 409, DB có một user. Race Register với common User service tạo admin cũng có đúng một user thắng, cùng unique key. HTTP create admin sẽ bổ sung tại B7.
4. Unknown username/wrong password/inactive trả cùng lỗi 401; missing/tampered/expired JWT bị chặn. User bị xóa hoặc inactive khiến token đang dùng nhận 401; đổi role trong DB có hiệu lực với token cũ, test-only admin guard trả 403/200 tương ứng.
5. Dừng app và mongod, khởi động lại với cùng dữ liệu/secret: tài khoản/hash giữ nguyên, token vẫn dùng được trong hạn. Cursor datasets cũng dùng được sau app restart.
6. Datasets có mọi trạng thái import và nhiều bản ghi cùng createdAt: chỉ imported, paging cả hai chiều không mất/trùng, empty đúng `{data:[],page}`, default sort/limit đúng; limit vượt 200/cursor hỏng/sort thay đổi/unknown query → 400. Không lộ storagePath/fieldMapping/private data.
7. Login vượt cấu hình rate limit nhận 429/Retry-After; IP khác có hạn mức riêng, forwarding header giả không vượt hạn mức. Health không bị áp dụng login limiter. Test limiter có job thất bại vẫn nhả slot và không quá hai job hoạt động.
8. CLI seed hai role dùng hash thật, chạy lại giữ hash/quyền cũ; user state không phù hợp làm seed thất bại. Dataset `[SEED B2]` được FE hiển thị rõ nguồn thử.
9. Browser: Register về Login không có session token → sai password báo lỗi → Login thành công → reload gọi me thật → datasets/sort → workspace shell và metadata fallback khi reload → logout → username trùng → admin menu → inactive/401 xóa phiên. Query/renderer APIs B4 vẫn trả lỗi chưa triển khai thực, không được thay bằng response giả trong test.

## Bàn giao và giới hạn

Xem [server README](../../server/README.md) để đặt JWT secret, chạy Server, indexes, seed và tests. B2 đóng gate User/Auth theo D011; không đóng gate import/analysis/idempotency. Secret cần được cấu hình trước cả startup/CLI dùng config chung; không có secret được commit hoặc tạo sẵn cho môi trường người dùng.

E2E sử dụng Vite online với API thật trên port tạm; đây là kiểm thử tích hợp trình duyệt ở local, chưa phải kiểm chứng deployment production/TLS. Docker/replica set/Nginx/CI của Cường, load/stress 100 users và dataset lớn vẫn thuộc các mốc sau. Số đo thời gian test không phải benchmark hiệu năng scrypt/HTTP; trước khi tăng concurrency hoặc ngưỡng login phải đo riêng.

Dataset hiện dùng seed metadata. Upload/validation/mapping/import thật, query sensors/readings, analysis/engine/ML, anomaly/review, Admin HTTP, durable POST idempotency và Offline/Sync chưa được triển khai hoặc nghiệm thu bởi B2. Không thêm refresh/logout/reset-password hoặc GET dataset detail.

Nguồn kỹ thuật đối chiếu: [Node crypto.scrypt](https://nodejs.org/api/crypto.html#cryptoscryptpassword-salt-keylen-options-callback), [OWASP Password Storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html), [jose JWT verification](https://github.com/panva/jose/blob/main/src/jwt/verify.ts), [Fastify rate-limit](https://github.com/fastify/fastify-rate-limit). Các tham số D011 do người dùng xác nhận; tài liệu tham khảo không thay thế quyết định nhóm hoặc kết quả test thực tế.
