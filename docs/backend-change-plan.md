# Backend Change Plan — Visual Analytics cho Data Analyst

Ngày lập: **16/11/2026**. Quyết định: **D016**, chủ dự án trả lời “ok duyệt” cho phần đánh giá/điều chỉnh đề xuất AI trong chat. **Đã duyệt định hướng và thứ tự ưu tiên; chưa khóa các API/DTO, công thức feature hoặc giá trị vận hành mới.** Đây là kế hoạch thay đổi, chưa phải bằng chứng đã triển khai các hạng mục bên dưới.

## 1. Mục tiêu và quan hệ với kế hoạch hiện tại

Ưu tiên luồng **Data Exploration → Visualization → Anomaly Detection → Investigation/Review**. ML phục vụ công cụ phân tích: giữ Isolation Forest, bổ sung ngữ cảnh không gian/thời gian có định nghĩa rõ, train offline một baseline có thể tái lập; không mở dự án nghiên cứu/tuning nhiều thuật toán.

Kế hoạch này bổ sung [Backend P0 online](backend-online-plan.md), không đổi mã milestone B0–B8. **C1 bên dưới chính là B6**, không phải một phiên bản B6 khác. B7/Admin và B8/chất lượng–triển khai vẫn được giữ trong kế hoạch cũ; không tuyên bố hoàn tất P0 online khi chúng còn thiếu. PWA/Offline/Sync của SRS vẫn ngoài đợt online này.

| Nội dung | Định hướng đã được duyệt | Giới hạn của sự phê duyệt |
|---|---|---|
| Kiến trúc | Giữ Fastify + TypeScript, Feature-based Modular Monolith, Route → Validation → Service → Repository → MongoDB | Không thêm Redis/BullMQ, Kafka, microservices hoặc viết lại B5 |
| Thứ tự | Chốt Change Plan → B6 → Exploration tối thiểu → ML v2 → nghiệm thu tổng thể | FE và kiểm thử tích hợp đi cùng từng chặng, không dồn đến cuối |
| Exploration | Nâng ưu tiên Dataset Profile, chất lượng/thiếu dữ liệu, tổng hợp thời gian và so sánh trạm; timezone hiển thị có chính sách | Đây là mở rộng phạm vi; một phần aggregation từ P1 được đưa vào đợt nâng cấp online, không tự nâng toàn bộ P1/LOD |
| ML | Isolation Forest v2 hướng tới ba feature PM2.5/temporal delta/spatial delta | Tên ba feature chưa phải công thức; Feature Contract và policy missing/context phải khóa trước train/inference |
| Nghiệm thu | Hướng tới CSV Beijing12 trạm/tháng03–2015 và các thao tác Analyst cụ thể | Phải xác minh file, nguồn, checksum và expected results; không coi ảnh concept là bằng chứng |
| B1–B5 | Giữ API và dữ liệu hiện có, cơ chế worker, receipt/fencing/recovery và kết quả đã lưu | Mọi thay đổi compatibility hoặc resource limit phải có review/test riêng |

## 2. Baseline đã đối chiếu

Rà soát tài liệu/source, không chạy lại runtime hoặc sửa DB trong lượt lập kế hoạch này:

- [SRS v0.5](SRS.md): Analyst, PM2.5, FR-06/07/08/09/10 và BR-01–15 đã phù hợp hướng sản phẩm. FR-13/aggregation đang P1; nguồn dữ liệu/cadence còn phần phải chốt. Extension mới cần yêu cầu/tiêu chí riêng, không chỉ đổi câu mô tả ưu tiên.
- [SDD v0.4](SDD.md), [ownership](ownership.md), [Shared Data Contract](shared-data-contract.md), [OpenAPI](api/openapi.yaml) và [MongoDB Physical Design](mongodb-physical-design.md): tiếp tục là nguồn thiết kế theo từng lớp. D010–D015 ghi các quyết định/runtime mới hơn những đoạn draft lịch sử.
- B1–B5 đã có14/20 operations online/health. B6 còn3 anomaly operations; B7 còn3 admin operations. Chưa cộng API Exploration đề xuất vào tổng operation chính thức.
- [B5 verification](backend/b5-verification.md): worker MongoDB-backed thật, statistical và ML value-only thật; baseline ML `pm25-iforest-uci381-v1` dùng UCI381, không phải model đa trạm UCI501. Severity low tạm, chưa có quality metric của domain. Giữ các kết quả này là baseline, không gắn nhãn “v2” cho model cũ.
- `server/src/config.ts`: Analysis mặc định1 job/process, scope tối đa50.000 readings, timeout120s, queue100; FE có ngân sách hiển thị riêng. Profile/aggregation toàn dataset không được âm thầm bỏ giới hạn Analysis hoặc lấy trang FE làm toàn scope.
- [Cube spec](frontend/cube/CUBE_ANALYST_3_MODES_SPEC.md) mô tả Overview/Station Focus/Anomaly Focus và CSV12 trạm; đây là spec đề xuất. [Heatmap timeline](frontend/heatmap-timeline.md) ghi Mapbox đang dùng latest≤T có maxAge. Không lấy policy thị giác/carry-forward của Mapbox làm Feature Contract ML.
- Repo có [fixture nhiều trạm mô phỏng](../server/tests/fixtures/README.md) cho hồi quy B4/B5. File Beijing mục tiêu được nhắc trong Cube spec nhưng chưa tìm thấy trong các CSV do `rg --files` liệt kê ở checkout này; chưa xác minh lại bytes/checksum của file đó trong lượt lập kế hoạch.

### 2.1. Phân biệt bốn nhóm dữ liệu

| Nhóm | Vai trò | Điều kiện sử dụng |
|---|---|---|
| CSV mục tiêu `beijing-12-stations-demo-2015-03.csv` | Golden nghiệp vụ/Visualization/Exploration/Review | G01 khóa file, provenance/checksum và các số liệu kỳ vọng; không tự tạo bản thay thế rồi gọi là file người dùng |
| [UCI501 Beijing Multi-Site Air Quality](https://archive.ics.uci.edu/dataset/501/beijing%2Bmulti%2Bsite%2Bair%2Bquality%2Bdata) | Ứng viên nguồn train/context nhiều trạm cho v2 | Phải xác minh quan hệ với CSV đã chuẩn hóa, station IDs/coordinates/timezone và split; chưa coi provenance CSV đích là đã chứng minh chỉ vì cùng tên Beijing |
| [UCI381/model v1](../server/ml/pm25-manifest.json) | Baseline ML một feature hiện tại | Giữ regression/provenance riêng; không gọi là model12 trạm hoặc tái dùng để giả lập spatial delta |
| CSV5 trạm mô phỏng và fixtures biên | Unit/integration/fault injection, tính đúng của phần mềm | Gắn nhãn synthetic; không thay thế kiểm thử CSV thật hoặc quality evaluation |

CSV03–2015 được giữ ngoài tập fit nếu dùng làm test độc lập. Các giá trị cao/sự kiện mô tả trong CSV không tự trở thành nhãn anomaly chuẩn. Review của Analyst cũng không tự biến thành nhãn training đã được kiểm định.

## 3. Requirements và tiêu chí Analyst

Các mã **CR-01…CR-07** chỉ là mã truy vết của Change Plan. Chúng chưa thay thế FR/BR hoặc tự trở thành field/endpoint đã khóa.

| Mã | Thao tác/kết quả cần hỗ trợ | Tiêu chí nghiệm thu | Mốc |
|---|---|---|---|
| CR-01 | Từ AnalysisRun completed mở anomaly, xem và review | Kết quả do detector thật; PATCH CAS an toàn; lỗi/conflict không bị báo thành lưu thành công | C1/B6 |
| CR-02 | Biết dataset có những trạm, phạm vi thời gian và bao nhiêu dữ liệu hợp lệ | Số liệu Server trên phạm vi được công bố; tách tổng dataset, scope đang xem và phần FE đã tải; không hardcode số mẫu từ tên file | C2a |
| CR-03 | Nhận diện chất lượng/thiếu dữ liệu | Tách dòng nguồn thiếu/bị loại, thiếu phép đo theo cadence kỳ vọng và dữ liệu chưa tải; chưa có cadence/anchor thì báo chưa xác định coverage | C2a |
| CR-04 | Xem chuỗi/tổng hợp theo thời gian và so sánh các trạm trong cùng phạm vi | Mỗi series có danh tính trạm, bucket và count; không so sánh nhầm timestamp/window hoặc coi trung bình là reading quan sát | C2b |
| CR-05 | Đọc nhất quán thời gian trên timeline/tooltip/bảng/bucket | Cùng instant UTC có cách hiển thị theo timezone đã chọn; không gán lại offset nguồn; quy tắc bucket/day boundary được mô tả rõ | C2 |
| CR-06 | Chạy IF v2 có ngữ cảnh và truy vết được kết quả | Cùng Feature Contract khi train/inference, không nhìn tương lai, missing/context policy rõ; model/version tách v1; chỉ review anomaly Server đã tồn tại | C3 |
| CR-07 | Thực hiện toàn bộ hành trình Analyst trên CSV chuẩn | Import → profile/so sánh → visualization → analysis → detail/review → reload; ghi rõ API thật/mock/not implemented và phạm vi đã tải | Mỗi mốc và C4 |

### 3.1. Phân biệt dữ liệu thiếu

1. **Thiếu/invalid trong nguồn:** thuộc chất lượng đầu vào; dữ liệu đã bị bỏ khi import không còn là Reading. Có thể cần report/provenance nguồn, không suy ra đầy đủ từ collection readings hoặc gán `invalidRows` thành số giờ thiếu.
2. **Thiếu station–time trên lưới kỳ vọng:** cần tập trạm, cadence, phase/anchor, timezone và khoảng xét đã chốt. Không tự mặc định mọi dataset1 giờ/trạm hoặc dùng min/max của phần đã tải làm đủ lưới tháng.
3. **Chưa tải/chưa tính xong:** thuộc coverage của request/FE. Không cộng vào missing-data và không hiển thị0 thay cho unknown.

G02/G03 phải khóa cách biểu diễn empty/unknown/not-applicable, denominator và completeness. Không chọn mặc định `null`,0 hoặc bỏ field thay cho nhau khi schema chưa được duyệt. Không tự nội suy/lấp khoảng trống để làm biểu đồ đầy.

### 3.2. Nguồn kỳ vọng của CSV nghiệm thu

Cube spec ghi các **expected facts cần kiểm chứng lại từ file G01**:12 trạm,8.782 readings,146 station–hours thiếu trên lưới12×31×24,739 timestamps, giá trị3–369, không duplicate station/time. Đây chưa phải kết quả tính lại của Change Plan.

- Mốc `2015-03-16T19:00:00+08:00`:12 trạm, mean315,5; chỉ kết luận đầy đủ khi Server xác nhận đủ tập trạm tại mốc đó.
- Nongzhanguan `2015-03-26T21:00:00+08:00`:369; thiếu mẫu22h/23h; median11 trạm khác tại21h bằng80 theo spec. Dùng làm đối chiếu chuỗi/context; không bắt buộc IF phải flag để đạt test chất lượng phần mềm.
- Hiển thị UTC+07 hoặc timezone khác phải giữ đúng instant. Cadence1 giờ áp dụng cho file chuẩn sau xác minh, không tự thành rule chung của mọi import.

## 4. API changes và compatibility

**OpenAPI hiện tại chưa thay đổi trong lượt lập kế hoạch.** Phần “đề xuất” dưới đây là đầu vào cho contract review, không phải lệnh tạo route hoặc bỏ qua quy tắc không thêm endpoint tự phát. Không tự chốt status/error codes mới.

| Operation/nhóm | Giữ/thêm/sửa | Phạm vi và điều kiện |
|---|---|---|
| Auth/me/datasets/import/readings/sensors hiện có | Giữ | Không đổi ID, UTC, BR-08, imported visibility, pagination hoặc response DTO của B1–B4 |
| 3 operations `/analysis-runs` | Giữ lifecycle/envelope/idempotency | C3 review cách chọn model v2 và metadata/context; không tự đổi config`{}`/model mặc định của caller v1 |
| GET `/api/v1/anomalies` | Triển khai B6 theo contract đã có | datasetId, analysisRunId, family/method, severity/status, from/to, sort/cursor/limit; không tự thêm sensorId/bbox/modelVersion filter |
| GET/PATCH `/api/v1/anomalies/{id}` | Triển khai B6 theo contract đã có | DTO Anomaly; PATCH chỉ baseVersion+changes status/note, không sửa detector output; conflict409 theo contract |
| Dataset Profile | **API mới đề xuất**, chưa khóa | Một read API riêng; URL ứng viên `GET /api/v1/datasets/{id}/profile`, chưa phải route được duyệt. G02 khóa toàn-dataset hay scoped, payload/visibility/status/cache và budgets trước code |
| GET `/api/v1/reading-aggregates` | Draft P1 đã có, chưa triển khai | G03 xác định có thể phát triển draft này cho bucket thời gian/per-station comparison hay cần contract khác. Không tạo endpoint trùng chức năng trước review |
| Dataset timezone/cadence metadata | Thay đổi contract có thể cần | G02 quyết định nguồn metadata, nơi nhận/lưu/trả, unknown/fallback; không tự thêm field vào Dataset/MappingRequest |
| B7/Admin | Giữ backlog hiện tại | Không xóa hoặc đổi last-admin/auth rules; tách khỏi critical path phân tích |
| Offline/Sync/internal batches/LOD | Hoãn | Không nhân đợt nâng cấp để mở exports, sync, reading-batches HTTP hoặc spatial LOD |

### 4.1. Checklist contract cho C2

- Profile: định nghĩa chính xác tổng readings/sensors, time bounds, per-station information và missing statistics; phân biệt persisted/imported counts với số dòng nguồn. Hình dạng payload và các trường là **đề xuất**, không tự có metadata endpoint nếu chưa cần.
- Aggregation draft hiện chỉ có `ts/location/average/count`; chưa đủ tự diễn giải thành series từng trạm hoặc completeness/bucket boundaries. G03 phải review danh tính series, khoảng bucket/empty bucket, semantics hour/day, timezone, count/mean và bounds/cursor/completeness nếu cần.
- Giới hạn khoảng thời gian, số trạm/series, số bucket và timeout/query budget phải có số cụ thể trước implementation. Không mặc định trả tất cả rồi gọi là bounded; không truncate mà báo complete.
- Không mặc định thêm optional field là backward-compatible: DTO/Zod hiện có strict validation. Kiểm tra parser/adapter/generated contracts và fixtures của client cũ, không chỉ kiểm tra TypeScript build.
- Khóa phạm vi API mới → cập nhật OpenAPI, Shared Data Contract/Zod và fixtures cùng nhau → regenerate adapters → contract/drift tests → mới implement. B6 không phụ thuộc vào thay đổi contract này.

## 5. Feature Contract cho Isolation Forest v2

**Hướng đã duyệt:** ba feature PM2.5, temporal delta, spatial delta. Khải/Khiêm phải bàn giao một Feature Contract versioned trước train/inference; bảng dưới là câu hỏi thiết kế bắt buộc, không chốt công thức thay nhóm.

| Nội dung | Phải khóa tại G04/G05 |
|---|---|
| PM2.5 | Mapping từ Reading.value ug/m3, thứ tự cột và numeric bounds; không đổi unit hoặc tự coi score là value |
| Temporal delta | Difference hay rate/time; signed hay absolute; mẫu trước/cửa sổ; max gap; xử lý first sample, thiếu mẫu và timestamp lệch |
| Spatial delta | Tập hàng xóm/cách chọn khoảng cách hoặc adjacency, có loại self, số mẫu tối thiểu; same-time hay as-of; aggregation/reference và maxAge |
| Target vs context | Scope chọn những readings cần chấm điểm; context có thể cần trạm khác hoặc mẫu trước from. Cùng dataset, truy vấn có bounds, không đọc tương lai, không trộn dataset |
| Missing context | Reject run, omit warmup/unscorable có báo cáo, hay imputation được duyệt; không âm thầm điền0/copy giá trị gần nhất |
| Input/output coverage | Với policy omit cần thể hiện rõ số target/scored/unscorable và lý do theo contract được duyệt. Adapter hiện đòi đủ feature rows cho input readings; không bỏ target rồi giả complete/zero anomaly |
| Tính tái lập | Cùng reading/dataset/context/model/policy cho cùng features; quy tắc context có bị bộ lọc Analyst thay đổi hay không phải được công khai |
| Implementation | Một implementation/builder dùng chung cho train và inference; chọn vị trí/language ở G04. Golden fixture kiểm tra train–serve parity, không hai công thức độc lập chỉ tình cờ cho cùng tên cột |
| Training | Nguồn và checksum, station coordinates/IDs, split theo thời gian, seed/params/scaler nếu có. Fit preprocessing chỉ trên tập train; demo03–2015 ngoài fit khi dùng làm test độc lập |
| API/version rollout | Cách chọn v1/v2 qua method hoặc config phải được duyệt. Giữ model/feature/policy version và hash trong manifest/run; rules cho queued/running v1 khi rollout |
| Score/severity | Review score projection và threshold của model v2; severity low baseline hiện tại không tự đổi. Không so sánh trực tiếp score v1/v2 như cùng thang |

**Ràng buộc causality:** temporal context tại t chỉ từ thời điểm<t; spatial context không lấy mẫu>t. Same-time spatial observation có thể là context của phân tích hồi cứu sau khi dữ liệu đã được nhập; điều đó không tự chứng minh khả năng phát hiện online real-time. Không dùng carry-forward/maxAge của heatmap làm quyết định ngầm cho ML.

**Giữ B5:** tiếp tục202 receipt/run durable, worker claim/heartbeat/fence, bound input/output, unique(run,reading), publish sau completed. Feature targets/context có budget riêng cần đo; không nâng hard cap50k chỉ vì đổi model. Có thể cần reader/adapter/model registry nhỏ, không có yêu cầu viết lại worker/hạ tầng.

**Bảo toàn v1:** không sửa config/model/score/anomaly/review của run cũ; không làm mất replay receipt; không tự re-run hoặc rescore terminal. G05 chọn giữ runtime/artifact v1 cùng v2 hoặc drain/đối soát trước rollout. Không deploy worker mới không đọc được job v1 đang chờ mà không có kế hoạch được duyệt.

## 6. Module changes, ownership và dependencies

Tên file mới là **vị trí đề xuất**, chưa được tạo bởi Change Plan. Không tự dựng DI framework hoặc module ngoài monolith.

| Owner | File/module hiện có | Thay đổi dự kiến/phụ thuộc |
|---|---|---|
| Khiêm + Tài/Khải review | `docs/SRS.md`, `docs/SDD.md`, `docs/decisions.md`, kế hoạch online | Ghi scope/priority D016, map CR sang FR/BR/acceptance; chi tiết mới khóa theo từng gate |
| Khiêm + Khải + Tài; Duy nhận compatibility | `docs/api/openapi.yaml`, `docs/shared-data-contract.md`, `shared-core/src/contracts/schemas.ts`, `docs/fixtures/*` | G02/G03/G05 mới thay contract; giữ baseline khi gate chưa chốt |
| Khiêm | `server/src/modules/anomalies/` mới, `server/src/app.ts` | B6 routes/schema/service/repository/mapping/index; public review service cho Sync sau này, chưa làm Sync |
| Khiêm | `server/src/modules/analysis/index.ts`, `analysis.repository.ts` | Public completed-run/read access phù hợp B6 hoặc query visibility qua Repository; không import internal repo cross-feature trong Service |
| Khiêm | `server/src/modules/datasets/`, `import.*`, `source-scan.ts` | Profile/provenance/missing-input stats sau G02; file `profile.*` đề xuất. Không đổi normalization/BR-08 ngoài scope được duyệt |
| Khiêm | `server/src/modules/query/` | `aggregates.*` đề xuất sau G03, MongoDB aggregation/projections/limits theo spec; không join số liệu scope từ FE |
| Khải + Khiêm | `server/src/engines/online.ts`, `isolation-forest.ts`, feature builder mới, `server/ml/` | Versioned feature builder và train v2 offline; model/runtime registry/routing nhỏ sau G04/G05; query context qua Repository/service, không DB trong thuật toán |
| Khiêm + Cường | `server/src/modules/analysis/analysis.worker.ts`, `analysis.repository.ts`, `config.ts` | Bảo toàn orchestration; thêm bounded context acquisition/version dispatch nếu cần; fault/recovery regression trước thay budgets |
| Khiêm + Cường | `docs/mongodb-physical-design.md`, `infra/mongo/indexes.js`, persistence indexes | Chỉ thay khi metadata/index/staging được thiết kế và có explain/measurement; không thêm collection hàng loạt theo dự đoán |
| Tài | `client/scripts/generate-contracts.mjs`, `client/src/shared/api/generated/`, data-source interfaces/adapters, `features/analysis`, `features/anomalies`, `features/workspace` | B6 UI thật sớm; profile/series/timezone theo contract mới; giữ shared filters, camera/renderer và loaded-vs-total labels |
| Cường cùng mỗi owner | `server/tests/`, `server/e2e/`, `client/e2e/`, fixture manifests, benchmark scripts/CI | Golden data, real DB/API/native ML, concurrency/conflict/recovery, query/resource budgets; không lấy HTTP interception làm proof Backend |

Khiêm chịu orchestration/API/persistence; Khải chịu feature/model và tests tính đúng; Tài chịu interaction/render/FE integration; Cường chịu môi trường/tải/kiểm thử phối hợp. Duy nhận interface mới để giữ khả năng tích hợp, không bị kéo vào triển khai Offline/Sync ở đợt này. Ownership không tự tạo bằng chứng owner đã sign-off.

## 7. Milestones triển khai

### C0 — Chốt thay đổi và chuẩn bị bằng chứng

**Mục tiêu:** Có scope/traceability và các contract delta review được trước khi code phần mới.

- [x] Ghi D016 và Change Plan, phân biệt direction đã duyệt với chi tiết còn mở.
- [x] Liên kết cập nhật phạm vi SRS/SDD/kế hoạch hiện tại; giữ OpenAPI/runtime nguyên trạng trong lượt lập kế hoạch.
- [ ] G01: xác minh CSV/provenance/checksum/expected facts; lập fixture manifest có thể tái tính, giữ synthetic fixtures riêng.
- [ ] G02/G03: chốt Requirement/API Exploration, timezone/cadence/empty/coverage và resource budgets trước C2.
- [ ] G04/G05: Feature Contract, nguồn/split/model/version selection trước C3. Có thể review song song C1; không phải điều kiện chặn bắt đầu B6.

**Endpoint:** chưa tạo/sửa endpoint. **Dependency:** baseline docs/source, file nghiệm thu; chủ dự án quyết định các lựa chọn nghiệp vụ còn mở.

**Kiểm thử:** document links/traceability, schema/ref/diff review khi có contract delta; script đọc CSV độc lập sau G01. Không coi đọc spec/ảnh concept là đã chạy nghiệm thu dữ liệu.

**Nghiệm thu:** các quyết định thực sự đã chốt được ghi D016 hoặc decision bổ sung, phần chưa chốt có owner/mốc chặn rõ. B6 sẵn sàng dùng contract cũ; chưa tuyên bố toàn bộ C0 đã đóng khi G01–G05 còn mở.

### C1 — Hoàn thành B6 và nối investigation/review thật

**Mục tiêu:** Kết quả B5 đọc/review được, không cần model v2 hoặc API Exploration mới.

**Endpoint:** GET `/api/v1/anomalies`, GET/PATCH `/api/v1/anomalies/{id}` — giữ OpenAPI hiện có.

**Công việc:**

- [ ] Imported dataset gate và completed-run visibility ở mọi đường list/detail/PATCH; run chưa completed theo filter cụ thể409, list tổng loại partial, detail không công bố404; kiểm tra run/dataset nhất quán.
- [ ] Query/filter/sort/keyset đúng whitelist; không thêm sensorId/bbox hoặc join value vào DTO Anomaly.
- [ ] PATCH CAS atomic theo ID/baseVersion; chỉ status/note; version tăng/updatedAt cùng thao tác;409/currentVersion đúng contract. Sau mất response đọc lại, không retry mù.
- [ ] FE dùng run thật để tải list/detail/review/overlay và xử lý conflict; reading chưa tải phải được ghi rõ, không lấy score làm PM2.5 hoặc bịa value.

**Dependency:** B1–B5 đã có; source contract B6, auth và Dataset/Run visibility. Không chờ G01–G05 của phần nâng cấp.

**Kiểm thử:** unit validation/filter, contract drift, MongoDB integration; run completed0/nonzero và queued/running/failed có partial; hai client cùng baseVersion chỉ một update; review tồn tại sau restart; mất response rồi GET; reject sửa score/method/severity; analyst/admin auth. E2E B5 thật → B6 list/detail/PATCH → reload/conflict; synthetic seed có nhãn chỉ để chủ động tạo trạng thái lỗi.

**Nghiệm thu/bàn giao:** Tài dùng đủ3 APIs B6 thật; review CAS/visibility đã có proof DB, không chỉ mock UI. Run v1 dùng được để nghiệm thu. Đóng B6 trong kế hoạch cũ theo bằng chứng mới; chưa đóng B7/B8 hoặc ML quality.

### C2 — Exploration tối thiểu: Profile/quality rồi time-series comparison

**Mục tiêu:** Analyst biết dữ liệu có gì, thiếu gì và so sánh trạm trên cùng phạm vi có đủ thông tin để diễn giải.

**Endpoint:** Profile mới và/hoặc nâng draft reading-aggregates theo G02/G03 đã duyệt; chưa chốt URL/payload bổ sung ngoài candidate mục4.

**C2a — Profile/quality:**

- [ ] Chỉ dữ liệu imported; profile toàn dataset/scoped theo spec được khóa; count/time-range/station reference đúng nguồn authoritative.
- [ ] Tách ba loại missing ở mục3.1, expected cadence/anchor do nguồn đã xác nhận; unknown không thành0. Quy tắc nguồn metadata/timezone và persistence qua gate G02.
- [ ] FE thể hiện total/scoped/loaded riêng, timezone nhãn nhất quán, không suy ra raw-quality từ riêng readings đã giữ.

**C2b — Aggregation/comparison:**

- [ ] Cùng dataset/filter/time, series định danh trạm, bucket count/mean/empty/coverage đúng G03; derived aggregate không đóng giả Reading.
- [ ] Giới hạn query/bucket/series/bytes/time explicit; timeout/budget exhausted không trả complete giả. Không tự mở spatial LOD hoặc materialized-cache layer.
- [ ] Mỗi API bàn giao cùng generated adapter/fixture/test để Tài nối chart/timeline/station comparison ngay, không đợi ML v2.

**Dependency:** G01 cho golden thật; G02 trước C2a, G03 trước C2b; B4 và imported visibility. C2a và C2b có thể giao riêng theo gate; B6 không bị chặn bởi chúng.

**Kiểm thử:** tính counts/means/time bounds từ CSV độc lập;12 stations cùng mốc và station gaps theo G01; offset/timezone/day-boundary/closed-range; empty dataset/scope, missing unknown, deleted/unimported visibility; full-scope vượt một trang; query budgets và explain. E2E per-stage dùng API/DB thật; intercept chỉ kiểm lỗi UI/race và có nhãn.

**Nghiệm thu:** CR-02–05 đạt trên CSV đã khóa, responses/schema/FE parser đồng bộ, không còn nhầm missing với chưa tải. Số đo tài nguyên/query kèm handoff; giữ B1–B6 regressions.

### C3 — Isolation Forest v2: features/context và artifact offline

**Mục tiêu:** Tích hợp baseline có ngữ cảnh được xác định, không nghiên cứu/tuning thuật toán diện rộng.

**Endpoint:** tiếp tục3 operations Analysis; delta method/config/version selection chỉ sau G05. Không train/model-upload/catalog/retry-job endpoint mới.

- [ ] G04 Feature Contract đóng: formulas, units/order, context/boundaries, missing policy, targets/scored coverage, one shared builder.
- [ ] Bounded context reader cùng dataset, không future leakage; policy chọn sensor/reference không vô tình thay theo trang/filter UI; context không được thành anomaly ngoài target scope.
- [ ] Offline train/save/load/predict thật; manifest hash/source/split/features/policy/runtime/seed/parameters; dataset demo không nằm trong fit nếu gọi là independent test. Không train theo upload/request/worker.
- [ ] G05 version selection/rollout rõ, giữ run/receipt/anomaly/review v1. Không tráo model dưới cùng snapshot run cũ hoặc tự chạy lại failed/terminal.
- [ ] Validate finite/foreign/duplicate output, missing model/context và model/feature mismatch; severity giữ baseline cho đến decision mới. Đo CPU/RAM/native process/context bytes/deadline trước đổi config.
- [ ] Tài nối ML UI theo method/config/version đã duyệt; đọc kết quả qua B6 thật và cùng run identity, không mock flag từ value cao.

**Dependency:** G01/G04/G05, B5/B6; C2 giúp Analyst diễn giải/context nhưng không mặc định aggregate dùng cho biểu đồ là feature reference ML.

**Kiểm thử:** golden vector train–serve parity; first sample/gap/neighbor missing/self exclusion/time skew; reading ở biên from vẫn lấy đúng historical context khi policy yêu cầu; scope1 trạm vẫn xử lý đúng neighbor context; no future/cross-dataset; deterministic inference; zero/normal/flagged và unscorable theo policy. Fault injection B5 phải còn đạt với v2, kể cả restart queued v1 và partial v2. Không lấy flag rate hoặc vài demo spikes làm accuracy/precision/recall.

**Nghiệm thu:** model/artifact/feature pipeline thật và versioned; API/FE chạy theo contract mới; Cường có resource measurements; Khải báo rõ phần correctness và quality nào đã/ chưa đánh giá. Không đòi mọi giá trị369 phải thành anomaly và không tuyên bố biết nguyên nhân.

### C4 — Nghiệm thu toàn hành trình và handoff

**Mục tiêu:** Chứng minh hành trình CR-07 trên CSV chuẩn và ghi rõ giới hạn còn lại.

**Endpoint:** tập API thật đã nghiệm thu C1–C3, không thêm endpoint ở mốc đóng.

- [ ] Replay hành trình import → Profile/quality → so sánh trạm → Mapbox/Cube Overview/Station/Anomaly → Analysis → detail/review → reload/conflict.
- [ ] Nhãn timestamp/timezone, loaded-vs-total, raw-vs-derived và model/version/score/severity nhất quán; partial/lỗi không thành empty success.
- [ ] Test từng stage tích lũy, contract/generated/schema drift, auth/security/CAS, worker/idempotency/recovery và imported visibility còn đạt.
- [ ] Đo theo thao tác Analyst, dữ liệu nhỏ và scope lớn; CPU/RAM gồm Python/Mongo, HTTP latency/event-loop, UI FPS/GPU khi có môi trường thật. Chỉ tối ưu từ bottleneck đã đo; không hoãn mọi phép đo tới sau nghiệm thu.
- [ ] Báo cáo rõ frontend interception vs API/DB/native-engine thật, source fixture, cấu hình, số liệu, lỗi chưa đóng và quyền sign-off từng owner.

**Dependency:** các gate C2/C3 và handoff từng mốc đã đạt; không thay bằng demo ảnh concept.

**Nghiệm thu:** CR-01–07 trong phạm vi được chốt có proof tự động/tái lập; chủ dự án thấy các hạn chế còn lại. B7/Admin và B8/deployment tiếp tục được theo dõi riêng; C4 không tự đồng nghĩa toàn bộ MVP/PWA/Sync/SLA đã xong.

## 8. Gates còn mở và người chịu trách nhiệm

| Gate | Cần quyết định/đầu ra review được | Owner phối hợp | Chặn phần nào |
|---|---|---|---|
| G01 — CSV chuẩn | Vị trí/cách cung cấp file, SHA256/source/station-coordinate mapping/offset/cadence/anchor, script tái tính expected facts; quan hệ với UCI501 | Chủ dự án + Khiêm/Khải/Cường | Golden CSV thật C2–C4; không chặn B6 trên fixtures hiện có |
| G02 — Profile/timezone | Use cases ưu tiên/field semantics, full vs scoped, raw-quality source, cadence/unknown, metadata input/storage/output, timezone hiển thị và visibility/status/budgets | Khiêm + Tài + Khải; chủ dự án chốt nghiệp vụ | C2a và contract/DB delta tương ứng |
| G03 — Aggregation | Draft endpoint giữ/sửa, per-station grouping, bucket timezone/bounds/empty/count/coverage, response/limits/status/cursor nếu cần; kiểm tương thích strict clients | Khiêm + Tài + Cường | C2b |
| G04 — Features/context | Các mục5; công thức cụ thể, shared builder, neighbor/time policy, missing/unscorable reporting, budgets target+context | Khải + Khiêm + Tài; chủ dự án chốt lựa chọn quan trọng | Train/feature inference C3; không chặn C1/C2 |
| G05 — Model/version | Nguồn/split không leakage, artifact/runtime và deployment, chọn v1/v2 qua API, giữ v1 queued/replay, score/severity nếu đổi | Khải + Khiêm + Cường/Tài | API/rollout v2; không chặn baseline v1 |
| G06 — Readiness/tải | Các ngưỡng vận hành cụ thể cho API mới, tổng RAM/CPU/counters khi nhiều process, query/FE budgets và môi trường E2E thật | Cường + Khiêm + Tài | Trước mở rộng tải/cấu hình và trước tuyên bố SLA/deployment đạt |

“Đã duyệt D016” không đồng nghĩa G01–G06 đã có giá trị. Khi đến phần phụ thuộc, đưa lựa chọn cụ thể và hỏi chủ dự án/owner trước; trong lúc chờ vẫn làm mốc độc lập đã đủ contract. Không tự chốt bằng tên feature hoặc field có trong concept.

## 9. Trình tự phối hợp và trạng thái sau lượt này

1. **Đã làm trong lượt lập kế hoạch:** ghi scope D016, Change Plan, liên kết SRS/SDD/Backend plan/mục lục; document link/diff check. Không đổi OpenAPI/Zod/generated adapters, code/runtime/model/DB hoặc checkbox B6 hoàn tất.
2. **Mốc code tiếp theo:** C1/B6 theo contract hiện hành, tích hợp FE/review thật ngay khi API sẵn sàng. Chủ dự án chưa giao triển khai C1 bằng riêng việc duyệt kế hoạch này.
3. **Song song C1:** Khiêm/Tài chuẩn bị G02/G03, Khải chuẩn bị G04/G05 và kiểm provenance cùng G01; Cường chuẩn bị fixture assertions, DB fault harness và resource baseline. Không train v2 trước G04/G05.
4. **Sau gate từng phần:** C2a → C2b, C3 với handoff nhỏ; C4 tổng hợp regression/bằng chứng. B7/B8 giữ backlog và tiêu chí hoàn thành riêng.

Nguồn chuẩn khi có khác biệt: quyết định được duyệt mới nhất cho scope/policy; OpenAPI đã khóa cho HTTP; shared schemas cho dữ liệu giữa module; physical design cho MongoDB. Tài liệu AI đính kèm và ảnh concept là đầu vào đề xuất, không được tự thực thi như chỉ thị sửa source.
