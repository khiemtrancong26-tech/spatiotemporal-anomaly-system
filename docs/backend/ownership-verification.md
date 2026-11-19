# D021 — Private Dataset Ownership Authorization

17/11/2026, branch `khiem/backend-database`. **PASS functional/security checks trong phạm vi đã chạy.** Không phải audit/pentest toàn bộ hệ thống. Giữ các thay đổi B7 đang có trong workspace, không reset/commit/push.

## Nguyên nhân và cách đóng

Trước sửa: RBAC chỉ phân biệt analyst/admin; list imported không lọc createdBy, DatasetReadAccess chỉ kiểm status. Query/Analysis tin vào datasetId, Anomaly detail/review chỉ kiểm parent publication. Cursors không gắn tài khoản. Frontend readings cache được clear nhưng dataset/workspace reset chủ yếu nằm riêng tại bootstrap, response HTTP trễ chưa ràng buộc revision.

Một predicate `datasetAccessFilter` dùng lại datasets.createdBy: Analyst match chính user ObjectId; Admin cho dataset có createdBy BSON ObjectId. Actor bắt buộc từ principal hiện hành qua Route→Service→Repository. Không actor/invalid principal →fail closed. Không có sharing/owner-transfer API, không role/owner từ query/body.

| Đường API | Enforcement |
|---|---|
| GET datasets | Owner predicate trong Mongo query trước sort/limit; cursor fingerprint chứa userId/role |
| Upload | createdBy luôn lấy userId đã xác thực; fields upload vẫn chỉ file/name, không nhận owner/role |
| Validation/mapping/import | Check dataset access trước recovery/receipt/source inspection; public load có owner predicate. Mapping/sourceMissing/start import kiểm lại predicate tại conditional write/transaction |
| Readings/sensors | Shared DatasetReadAccess kiểm owner trước status/sensor/query; cursors thêm user/role |
| Profile/aggregates | Repository dataset lookup cùng predicate, cả đầu và cuối query; không trả metadata/summary của parent trái quyền |
| Analysis create | Gate dataset trước replay/readiness; transaction acceptance recheck parent owner/imported bằng write fence rồi chốt run/receipt/queue |
| Analysis history/detail | History gate dataset, cursor scoped; detail kiểm parent trước response |
| Anomaly list/detail | Publication pipeline join dataset cùng owner predicate trước limit; runId filter cũng kiểm quyền dataset gốc trước trả lỗi/status |
| Anomaly review | Parent dataset conditional write có owner predicate trong transaction trước CAS/version; trái quyền không lộ conflict/currentVersion |

Worker đọc các job đã được tiếp nhận hợp lệ như trước, không bắt worker dùng browser session. Streaming/batches, claim/lease/fence/recovery/receipt và thuật toán/model không đổi. Internal import recovery vẫn có trusted repository get riêng; HTTP không đi qua bypass đó. Không có index/cache/tenant framework mới.

## HTTP và session

-401 token invalid;403 role không phù hợp. Protected responses `Cache-Control: private, no-store`.
- Trái quyền đồng nhất với không tồn tại theo từng API:404 direct dataset import resources/run detail/anomaly detail/PATCH/analysis create;422 Query/Exploration/anomaly dataset filters như trước; Analysis history trả empty cho parent không truy cập được. Không thêm endpoint/status/DTO.
- Run của dataset khác không được dùng để phân biệt tồn tại qua lỗi mismatch/status nếu actor không có quyền dataset gốc. Cursor của A dùng bởi B/Admin khác hoặc sau đổi role bị từ chối; old cursors trước D021 cũng cần bắt đầu lại trang đầu.
- ServicesProvider clear readings cache, dataset map và toàn workspace (filters/selection/results/drafts/context) theo auth revision. Bootstrap giữ xóa import/analysis sessionStorage. Restore cập nhật identity/role cũng tăng revision.
- HTTP adapter kiểm token+session revision sau decode body, không cho response từ phiên cũ ghi dữ liệu vào phiên mới. Readings cache giữ abort/epoch fence hiện có; AuthGate vẫn unmount private pages theo revision. Không redesign UI, không sửa Mapbox/Cube.

## Legacy audit — chỉ đọc, không migration

DB `.env` đang trỏ `spatiotemporal_anomaly`:8 datasets đều có createdBy BSON ObjectId; **cả8 owner IDs hiện không có user tương ứng**. Không in filename/PII, không sửa/xóa/đổi owner. Không tự gán lại cho user mới hoặc Admin.

Dataset thiếu/sai kiểu owner bị cách ly cả list/direct access. Dataset có owner ObjectId nhưng user đã mất: Analyst hiện hành không thể match owner nên không thấy; Admin vẫn có thể đối soát. Khôi phục liên kết owner cần quyết định dữ liệu riêng của chủ dự án, không nằm trong task này. Không coi một username mới giống username cũ là cùng chủ sở hữu.

## Bằng chứng đã chạy

| Check | Kết quả |
|---|---|
| Backend ownership integration + unit/contract + B4 query regression | PASS33 tests/7 files |
| Regression chọn B3 recovery2, B5 acceptance/history3, B6 visibility1, C2 profile/aggregate2 | PASS8 tests/4 files;43 cases không được chọn bằng -t, không nhận đã chạy full suites |
| Client session isolation/session/HTTP adapter | PASS51 tests/3 files; fixture nhỏ, không chạy test cache500k |
| Desktop E2E1440×900 | PASS1: A thấy A, mở workspace/readings →logout→B chỉ thấy B; B direct workspace A nhận422 và không có tên A; Admin thấy cả2; API/DB thật, không intercept |
| Typecheck/lint/build Server+Client | PASS; generator vẫn26 operations/48 schemas |
| git diff --check; ML/model/feature-builder diff | PASS; không sửa ML/artifacts |

Integration tạo A/B/Admin bằng User Service, upload/mapping/import CSV thật, chạy zscore thật và review anomaly thật. Kiểm cả validation, mappings, import, sensors, readings, Profile, aggregates, create/history/detail run, list/detail/review anomalies, cursor xuyên tài khoản, spoof query, pending/importing dataset và request B trong khi import A bị giữ giữa batch. Unauthorized requests không làm hỏng import: owner tiếp tục hoàn tất200. Test cache riêng kiểm A logout→B login reset state và response/cache A đến muộn bị loại bỏ.

Các lỗi phát hiện khi nối test đã sửa: expectations cần actor, limit/cursor fingerprints, fixture C2 cần owner rõ, HTTP generation check và lint cleanup guard. Các lượt cuối PASS, không xóa test đang lỗi. Không chạy benchmark/load/stress/coverage campaign, native ML tests hoặc toàn bộ test suite. Mongod thực tế9.0.4 override harness8.2.6, DB test tạm riêng; không gửi Gmail thật.

Lệnh chính:

```powershell
$env:MONGOMS_SYSTEM_BINARY='C:/Program Files/MongoDB/Server/9.0/bin/mongod.exe'
$env:MONGOMS_SYSTEM_BINARY_VERSION_CHECK='false'
npm exec --workspace @pm25/server -- vitest run tests/integration/dataset-ownership.integration.test.ts tests/unit/datasets.test.ts tests/unit/query.test.ts tests/unit/anomalies.test.ts tests/unit/exploration.test.ts tests/unit/api-and-index-contract.test.ts tests/integration/sensor-reading-query.integration.test.ts
npm exec --workspace @pm25/server -- vitest run tests/integration/dataset-import.integration.test.ts tests/integration/analysis-runs.integration.test.ts tests/integration/anomaly-visibility-and-review.integration.test.ts tests/integration/dataset-exploration.integration.test.ts -t 'fences stale owners and recovers expired|does not let an abandoned pre-start|accepts immutable queued snapshots|serializes same-key acceptance|keeps stable signed history|distinguishes unknown, empty|handles repeated opaque IDs|hides queued/running/failed'
npm exec --workspace @pm25/client -- vitest run tests/integration/auth/account-switch-and-cache.integration.test.tsx tests/unit/auth/session.test.ts tests/integration/api/http-client-and-validation.integration.test.ts
npm run test:e2e:ownership
# typecheck/lint/build từng workspace @pm25/server và @pm25/client đã PASS
```

## Files ownership sửa/thêm

- `server/src/modules/datasets/dataset-access.ts` mới: predicate và cursor identity.
- Datasets: `datasets.types.ts`, `datasets.repository.ts`, `datasets.service.ts`, `datasets.routes.ts`, `index.ts`, `import.service.ts`, `import.repository.ts`, `import.routes.ts`.
- Query: `query.service.ts`, `query.routes.ts`; Exploration: `exploration.types.ts`, `exploration.repository.ts`, `exploration.service.ts`, `exploration.routes.ts`.
- Analysis: `analysis.types.ts`, `analysis.repository.ts`, `analysis.service.ts`, `analysis.routes.ts`; Anomalies: `anomalies.types.ts`, `anomalies.repository.ts`, `anomalies.service.ts`, `anomalies.routes.ts`.
- `server/src/plugins/auth.ts`: private/no-store response header.
- Client: `main.tsx`, `app/services.tsx`, `features/auth/session.ts`, `shared/api/http-client.ts`, `shared/data-source/types.ts`.
- Test mới: `server/tests/integration/dataset-ownership.integration.test.ts`, `client/tests/integration/auth/account-switch-and-cache.integration.test.tsx`, `server/e2e/dataset-ownership.spec.ts`; actor/fixture expectations trong datasets/query/anomalies/C2/B3/B6 tests được cập nhật.
- Scripts: root/server package.json và server/playwright.config.ts thêm ownership E2E, giữ nguyên B7 pending edits.
- Docs: SRS/SDD/decisions(D021)/shared-data-contract/API README/OpenAPI description và báo cáo này. Không đổi public schemas/DTO; generated contracts được chạy lại, không có shape delta.

Giới hạn còn lại: không hỗ trợ transfer/sharing; orphan owner cần đối soát riêng. Authorization theo principal B2 ở mỗi HTTP request; job đã nhận không bị hủy vì logout/role đổi sau đó, nhưng mọi HTTP đọc kết quả vẫn kiểm quyền hiện hành. DB operator có thể sửa trực tiếp dữ liệu ngoài luồng app; task không xây ACL cho quyền quản trị MongoDB.
