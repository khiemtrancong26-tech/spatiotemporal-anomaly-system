# B7 — Minimal Admin Backend

17/11/2026, branch `khiem/backend-database`. **PASS**, tick riêng B7. Không mở B8/Offline/Sync/TLS hoặc thay ML/Exploration. Không đổi OpenAPI, DTO hoặc generated contract.

## API/nghiệp vụ hoàn thành

- GET `/api/v1/admin/users`: Admin only, default username:asc; sort usernameNormalized + _id hai chiều, cursor signed/fingerprint bằng helper hiện có, default100/max200. Projection/serializer chỉ trả UserPublic, không passwordHash/authVersion/email/private fence. Không search.
- POST cùng path: analyst/admin, dùng chung prepareUser của B2 để validate/normalize/hash scrypt; User Repository/index username duy nhất chung với Register. Mật khẩu không lưu trong receipt. Transaction chốt user + response receipt trên collection idempotencyReceipts hiện có; UUID key/user/operation/payload fingerprint, replay201 snapshot, khác payload422, đang xử lý409, hết24h409. Duplicate username409 USERNAME_EXISTS; không duplicate effect khi hai POST cùng key.
- PATCH `/api/v1/admin/users/{id}`: chỉ role/isActive, ít nhất1 field; payload sai422, opaque/missing user404, last active admin409 LAST_ACTIVE_ADMIN. Không thêm baseVersion/If-Match vào contract. Không search/delete/reset password/session management.
- Mỗi mutation ghi private adminWriteFence lên các admin đang active trong cùng transaction, rồi kiểm lại actor còn admin/active và tính last-admin trước update. Những transaction cạnh tranh có tập write giao nhau; driver retry snapshot mới thay vì count-then-update chịu write-skew. Lỗi rollback cả fences/effect/receipt. Không collection khóa, process mutex, cache hoặc index mới.
- B7 writes cần Replica Set như hạ tầng online hiện có; nếu thiếu, trả500 REPLICA_SET_REQUIRED theo tập HTTP status hiện hữu, không tự thêm503/OpenAPI delta. API GET không cần transaction.
- Role/isActive mới có hiệu lực trên token cũ qua lookup B2: analyst→admin gọi được Admin, hạ quyền→403, inactive→401. Không authVersion/session revocation system mới. Admin-created user giữ đường legacy không bắt verify email; không thay Public Register.
- FE Admin chỉ bổ sung nhận USERNAME_EXISTS và thông báo last-admin409; giữ cách đối soát request kết quả không rõ, không tự retry bằng key mới.

## Files sửa/thêm

- Mới `server/src/modules/admin/admin.schema.ts`, `admin.repository.ts`, `admin.service.ts`, `index.ts`: cùng layering feature modules hiện có, đúng3 routes.
- `server/src/app.ts`: mount Admin module.
- `server/src/modules/users/users.service.ts`: tách prepareUser từ createUser hiện có để Admin hash/validate trước transaction, không giữ transaction trong lúc scrypt. createUser B2 vẫn dùng cùng logic.
- `server/src/modules/users/users.repository.ts`: expose ensureIndexes/toPublicUser và optional session cho insert; dùng lại unique checks/mapping, không đổi dữ liệu cũ.
- `client/src/features/admin-users/page.tsx`: thông báo409 và cho sửa duplicate username xác định.
- Mới `server/tests/integration/admin-users.integration.test.ts`; cập nhật `server/tests/unit/api-and-index-contract.test.ts`: test chức năng và drift3 schemas/query/response.
- Mới `server/e2e/admin-users.spec.ts`; `server/playwright.config.ts`, root/server `package.json`: một luồng Desktop thật và lệnh test. Không dependency/lockfile mới.
- `docs/backend-online-plan.md`, báo cáo này: tick B7 khi có đủ proof.

## Kết quả kiểm thử đã chạy

| Check | Kết quả |
|---|---|
| Targeted B7 + contract | PASS7 tests/2 files |
| Regression cuối B7/Auth/B2/email/contract | PASS25 tests/5 files, không skip |
| Client adapter regression liên quan | PASS6 tests/1 file |
| Typecheck/lint/build Server và Client | PASS; generated contract không drift |
| Desktop E2E1440×900 | PASS1: Login admin →list thật →create →role change →reload →deactivate →reload; xác nhận MongoDB, không page.route/intercept |
| git diff --check | PASS |

Targeted test ban đầu phát hiện limit=1e2 bị query coercion; đã dùng preValidation parsePageQuery như Query/Analysis để giữ validation trước ép kiểu. Các lượt cuối PASS, không bỏ test lỗi. Case chính:401/403 cả3 APIs; duplicate/key replay/same-key race/Register race; pagination hai chiều/cursor mismatch/private fields;422/404/409; hai admin đồng thời tự demote/deactivate chỉ1 success, vẫn1 active admin; token cũ phản ánh state mới.

```powershell
$env:MONGOMS_SYSTEM_BINARY='C:/Program Files/MongoDB/Server/9.0/bin/mongod.exe'
$env:MONGOMS_SYSTEM_BINARY_VERSION_CHECK='false'
npm exec --workspace @pm25/server -- vitest run tests/integration/admin-users.integration.test.ts tests/unit/api-and-index-contract.test.ts
npm run typecheck --workspace @pm25/server
npm run lint --workspace @pm25/server
npm run build --workspace @pm25/server
npm run typecheck --workspace @pm25/client
npm run lint --workspace @pm25/client
npm run build --workspace @pm25/client
npm run test:e2e:b7
npm exec --workspace @pm25/server -- vitest run tests/integration/admin-users.integration.test.ts tests/unit/auth.test.ts tests/integration/auth-and-datasets.integration.test.ts tests/integration/email-auth.integration.test.ts tests/unit/api-and-index-contract.test.ts
npm exec --workspace @pm25/client -- vitest run tests/integration/api/online-data-source.integration.test.ts
```

Mongo tests dùng DB tạm riêng, actual mongod9.0.4 override harness8.2.6, không gửi email thật. Không sửa/xóa dữ liệu MongoDB development. Không benchmark/load/stress/k6/coverage/fault injection hoặc full-suite campaign. Build warning chunk size có sẵn được giữ, không tuning. Không commit/push.

## Blocker

Không còn blocker B7 trong môi trường Replica Set đã kiểm thử. PATCH không có client CAS version vì OpenAPI chỉ cho role/isActive; concurrent updates được serialize, last-admin violation409. HTTP500 khi deployment thiếu transaction support cần operator cấu hình Replica Set, không tự mở milestone hạ tầng.
