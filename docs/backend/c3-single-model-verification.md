# C3/D020 — Một Isolation Forest 3 features duy nhất

Ngày 17/11/2026, branch `khiem/backend-database`. **PASS functional correctness/integration/regression.** Theo yêu cầu đơn giản hóa sau C3 PASS; không mở C4/B7/B8. Báo cáo này thay thế hướng dẫn setup/rollout hai model của D019. Bằng chứng D014/B5/C3 cũ giữ nguyên các kết quả lịch sử, đã gắn nhãn superseded.

## Những gì xóa và giữ

**Đã xóa:** inference một feature, hai entries model/adapters, dispatch/selection v1/v2, readiness vector một chiều, `ANALYSIS_V2_ENABLED`, `ANALYSIS_V2_ARTIFACT` và các config fields tương ứng. Frontend không còn selector; ML chỉ nhận `method: "isolation_forest", config: {}`. Config có `modelVersion` hoặc tham số khác bị từ chối 422, không tự chọn/fallback sang model cũ.

Xóa `server/ml/pm25-manifest.json`, `train_pm25_baseline.py`. Adapter harness D014 cũ được chuyển sang cùng artifact 3 features; xóa thêm `artifact-manifest.json`, `fetch_artifact.py`, `requirements-artifact.txt` của demo x0/x1. Dọn local artifact/source cache `.local/models/pm25-iforest-v1` và artifact demo `.local/models/sklearn-docs-anomaly-detection-8689ffa`. Không dọn các thư mục/tệp ngoài dự án. Python runtime hiện hành `.local/detector-venv` được giữ; không cài package mới.

**Giữ nguyên:** Feature Builder/context reader và policy missing; native adapter, Python runner/protocol và statistical engines; Worker lifecycle, claim/lease/heartbeat/attempt, timeout/concurrency guards, transaction/fencing, crash cleanup/recovery và receipt replay. Summary vẫn atomic cùng terminal transition, không thêm vào receipt hoặc partial run. Không cache/index/framework/architecture mới; không benchmark/load/stress/tối ưu.

Model ID `pm25-iforest-uci501-v2` và các tên file có `v2` là provenance của artifact đã nghiệm thu, không phải một cơ chế chọn phiên bản. Server vẫn pin model ID/hash/policy tại acceptance và kiểm khớp khi chạy; không có runtime dispatch giữa các model. Readiness chỉ dùng vector `[50,0,0]`, probe coalesced, integrity/runtime checks và resource guards cũ.

| Thành phần giữ nguyên | SHA256 |
|---|---|
| `.local/models/pm25-iforest-v2/isolation_forest.joblib` (241932 bytes) | `0b891da07da2ffcd83f647d296b9642bfb4f2331c3ee0512947bf6eb2af7209c` |
| `server/ml/pm25-v2-manifest.json` | `3d36d06e7ba1b00a8fe0c7eafef45727bf6a7e54b12aae3fe57adac07eaf2f92` |
| `shared-core/src/features/pm25-v2.ts` | `158a2360777fd8736cfaf3c29ad8d15cfb2056936e7f4c49e096e8b9159f2687` |

Không train lại; offline CLI v2, train splits, golden exclusion và manifest bytes giữ nguyên. Không có accuracy/precision/recall khi không có nhãn. Tọa độ vẫn owner-provided, không tuyên bố geodetic audit độc lập.

## Contract và nghiệp vụ

- Đúng thứ tự `[value, temporal_delta, spatial_delta]`. Temporal signed previous cùng trạm, `<t`, gap≤2h. Fixed3 nearest neighbors≤50km; thiếu3 stations hợp lệ hoặc ít hơn2 readings đúng t →unscorable, không thay neighbor thứ4. Không future/cross-dataset/imputation. Targets và context vẫn riêng, budgets C3 không mượn từ C2.
- `scoringSummary` bắt buộc với completed ML; statistical, queued/running/failed không có field. `targetCount=scoredCount+unscorableCount`; ba reasons temporalOnly/spatialOnly/both loại trừ nhau và cộng bằng unscorableCount. Zero scorable →failed `INSUFFICIENT_CONTEXT`, không công bố partial.
- OpenAPI/HTTP/shared/generated/client parsers đã bỏ điều kiện compatibility theo model cũ, giữ arithmetic/lifecycle validation. `modelVersion` response chỉ là metadata do Server cấp. Không thêm endpoint, không đổi method/statistical policy hoặc DTO Anomaly/Reading.
- Frontend Desktop chọn Isolation Forest là gửi config{}. Completed hiển thị scored/target/unscorable và lý do; không coi phần chưa chấm là normal. Mock ML chưa triển khai, trả503 `MOCK_ML_NOT_IMPLEMENTED`; không giả summary/inference.
- Golden 03/2015 vẫn có `8782 = 8722 + 60`; reasons48 temporalOnly/12 spatialOnly/0 both. Integration kiểm toàn bộ feature vectors với offline matrix, anomalies chỉ thuộc scored targets, B6 detail/PATCH/review CAS và đọc lại kết quả.

## Dọn dữ liệu test đã được xác nhận

Đã đọc `.env` và query read-only trước khi xóa: endpoint `localhost:27017`, DB `spatiotemporal_anomaly`, Replica Set `rs0`. Chủ dự án xác nhận rõ đây là DB phát triển được phép dọn.

Transaction kiểm lại đúng 8 terminal runs, 8393 anomalies đều liên kết runs này, 8 receipts `kind=analysis` liên kết đúng resource IDs và queue.active=0; sau đó xóa đúng các records đó. Không drop DB/collection; giữ datasets, sensors, readings, users và receipts upload/import. Queue counter đang0 được giữ nguyên. Audit read-only cuối xác nhận runs/anomalies/analysis receipts đều0; vẫn có8 datasets,463323 readings,3 users và14 receipts ngoài Analysis. Không có auto-delete/migration trong code startup.

Đây là reset dữ liệu test được chủ dự án duyệt, không có compatibility/replay promise cho records đã xóa. Các run/receipt tạo mới vẫn dùng transaction/idempotency cũ. Browser đang giữ run ID/intent cũ có thể cần bỏ intent test cũ hoặc mở lại workspace để tạo run mới; không tự đổi key/payload đã lưu.

## Files thay đổi và lý do

| Nhóm | Files chính | Lý do |
|---|---|---|
| Runtime | `server/src/config.ts`, `engines/online.ts`, `.env.example` | Một adapter/manifest/artifact, bỏ selection và flag |
| Analysis | `analysis.service.ts`, `analysis.types.ts`, `analysis.worker.ts`, `analysis.repository.ts`, `analysis.schema.ts` | config{}, context/summary theo family ML, giữ lifecycle/fencing |
| Contract | `docs/api/openapi.yaml`, `shared-core/src/contracts/schemas.ts`, generated `contract.json`/`openapi.d.ts` | Completed ML summary không phụ thuộc compatibility; regenerate adapters |
| Desktop | `client/src/features/analysis/page.tsx`, `workspace/analyst.ts`, `mocks/transport.ts` | Bỏ selector, giải thích model3 features, mock unavailable rõ ràng |
| Tests | `server/tests/c3.integration.test.ts`, `b5.integration.test.ts`, `engines.integration.test.ts`, `engines-db.integration.test.ts`, `engine-integration.helpers.ts`, `fixtures/c3-worker.ts` | Thay dual-version tests bằng single-model/recovery/receipt và giữ native/protocol coverage |
| Frontend tests | `ml-contract.test.ts` (thay `v2-contract.test.ts`), `client/e2e/online.spec.ts`, `server/e2e/c3.spec.ts` | Summary strict, mock error, config{} và không selector; Desktop native E2E |
| Harness | `server/scripts/verify-detector-integration.ts` | Dùng cùng artifact3 features với explicit test vectors; report mới vào `.local`, không ghi đè bằng chứng D014 |
| Docs | Root/client/server/ML README, SRS, SDD, API README, shared-data-contract, MongoDB physical design, decisions(D020), backend plans, docs index | Kiến trúc/setup/demo một model |
| Historical proof | `b5-readiness.md`, `b5-verification.md`, `c3-verification.md`, `detector-integration-verification.md` | Chỉ đánh dấu superseded và thay link source đã xóa bằng ghi chú Git history; không sửa số liệu cũ |

## Functional verification — PASS/FAIL

| Check | Kết quả cuối |
|---|---|
| Root `npm run check`: type/lint/unit/build | PASS; client124/server66/shared10 tại lượt đầu, trước thêm mock regression |
| Client typecheck/lint + toàn bộ unit sau bổ sung regression | PASS125 tests/20 files |
| Server typecheck/lint sau sửa fixtures | PASS |
| Compiled JS native readiness, không cần flag/version | PASS; model duy nhất `pm25-iforest-uci501-v2`, không còn config fields dual-version |
| Server full `test:coverage`, B1–B6/C2/C3 | PASS157 tests/23 files;10 C3 integration; không skip trong lượt full |
| Single-model native inference config{}, deterministic scores và pinned model/hash/policy | PASS |
| Golden train–serve parity + partition8782/8722/60, không anomaly cho unscorable | PASS |
| B6 list/detail/PATCH status+note, optimistic conflict409 và đọc lại trên anomaly native ML | PASS |
| Missing context/no future/cross-dataset, fixed3 neighbors/no fourth fallback, context guard | PASS |
| Readiness, runtime/feature order/hash/policy mismatch, artifact missing trước/sau acceptance | PASS |
| Queued restart, receipt bất biến/replay, kill Backend thật sau partial native batch, fencing/atomic summary | PASS |
| Desktop E2E1440×900: không selector, config{} →native inference →summary →reload | PASS1 test; API/DB/model thật, không intercept success |
| Hash manifest/artifact/Feature Builder sau thay đổi; chỉ còn1 directory model | PASS, đúng các hashes trên; không train lại |
| `git diff --check` | PASS |

Coverage JS parent: lines97,83%/branches90,44%; không là metric chất lượng ML, Python coverage hoặc performance. Không giảm test nghiệp vụ: thay các case dual-version bằng single-model acceptance/recovery, giữ157 server tests; client tăng124→125.

Các lỗi test ban đầu: test B5 đọc `value` ngoài DTO Anomaly thay vì linkage `readingId`; fixture missing-artifact cần đủ3-feature context để đi đến nhánh artifact; mock error code nằm trong `DataSourceError.error.code`. Sửa đúng fixture/assertion, không nới policy, không xóa/bỏ qua test. Kiểm mẫu synthetic adapter chỉ là test bridge/native scores, không là bằng chứng feature extraction/accuracy; pipeline real golden được kiểm riêng.

Mongo tests dùng isolated single-node Replica Set và installed mongod9.0.4 (override version harness8.2.6). Chỉ chạy C3 E2E Desktop1440×900; không chạy các suite có viewport nhỏ hơn1024px.

```powershell
$env:MONGOMS_SYSTEM_BINARY='C:/Program Files/MongoDB/Server/9.0/bin/mongod.exe'
$env:MONGOMS_SYSTEM_BINARY_VERSION_CHECK='false'
npm run check
npm run test:coverage --workspace @pm25/server
npm run test:e2e:c3
```

## Demo một model

1. Bảo đảm MongoDB Replica Set, JWT secret, tài khoản analyst đã seed theo [server README](../../server/README.md). Cung cấp đúng artifact hiện có ở path mặc định hoặc `ANALYSIS_ARTIFACT`; Python/runtime theo [ML README](../../server/ml/README.md). Không bật flag/version, không chạy lại training.
2. Chạy `npm run dev:server` và `npm run dev` từ root; restart Backend đang chạy để dùng build mới. Đăng nhập, import CSV Beijing12 trạm golden hoặc mở dataset golden đã imported. Mapping sensorId/latitude/longitude/timestamp/value, unit ug/m3.
3. Vào workspace Desktop →Analysis →Isolation Forest →xác nhận phạm vi →Chạy phát hiện. Với full golden, chờ completed rồi đọc8722/8782 scored và60 unscorable; reload giữ summary.
4. Mở anomalies của run completed, xem detail, review status/note rồi reload. Nếu409 version conflict, giữ draft và GET đối soát như B6, không blind retry.

Request HTTP sau login (Authorization Bearer và UUID Idempotency-Key):

```json
{"datasetId":"<imported-dataset-id>","family":"ml","method":"isolation_forest","config":{},"scope":{}}
```

POST `/api/v1/analysis-runs` trả202 queued, chưa summary. Poll GET detail/history; chỉ tải anomalies/review khi completed. Artifact/runtime không sẵn sàng →503 trước acceptance, không tạo run; nếu mất sau acceptance →failed, không fallback/train lại.
