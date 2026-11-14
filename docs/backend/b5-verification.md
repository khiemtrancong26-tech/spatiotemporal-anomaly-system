# B5 — Analysis online: implementation và kiểm chứng

Ngày: 15/11/2026. Chủ dự án đã đồng ý cả ba nhóm ở [readiness](b5-readiness.md); [D015](../decisions.md#d015--hướng-worker-b5-15112026) chốt baseline. **B5a/statistical và B5b/ML có API, worker và detector thật.** Không thêm Redis/BullMQ, endpoint ngoài OpenAPI, PWA/Offline/Sync, B6 hoặc B7.

## 1. Phạm vi bàn giao và trạng thái thật/mock

| Thành phần | Trạng thái |
|---|---|
| POST `/api/v1/analysis-runs` | Thật; auth analyst/admin, UUID key, validate policy/scope/dataset, transaction receipt+run queued+slot trước202 |
| GET `/api/v1/analysis-runs/{id}` | Thật; trạng thái hiện tại, DTO whitelist, terminal error/completedAt |
| GET `/api/v1/analysis-runs` | Thật; datasetId, createdAt asc/desc + ID tie-break, signed keyset cursor, limit100/max200 |
| Z-score/IQR/Moving Average | simple-statistics8.0.0 thật qua shared-core, chạy worker thread; không tự viết lại thống kê |
| Isolation Forest | Python/scikit-learn1.9.1 load/infer PM2.5 artifact thật, feature `value` ug/m3; không dùng x0/x1 demo |
| Run/anomaly persistence | MongoDB Replica Set thật, transaction nhỏ và unique(run,reading), lifecycle và attempt fencing |
| Fault injection | Test double gắn nhãn cho output lỗi, deadline và nhiều batch; MongoDB/API/process crash thật |
| Browser M5 | FE online thật: import150 rows → gửi Z-score → poll completed → history/reload, không intercept HTTP |
| FE ML/replay UI | Chưa cập nhật FE: vẫn khóa ML, real-mode retry chưa dùng cửa sổ24h; cần Tài tích hợp theo handoff |
| API anomalies/review | B6 chưa triển khai, vẫn404. Không trả fake result rỗng để qua E2E; completion khác với đã đọc/review kết quả |
| Chất lượng model/SLA deployment | Chưa nghiệm thu; Khải/Cường tiếp tục công việc riêng |

Tổng API online/health có implementation: **14/20**, còn6 operations B6/B7. OpenAPI và shared DTO schemas không bị sửa; method/config ML sử dụng string/object mở của contract hiện hành.

## 2. Kiến trúc và semantics

Module `server/src/modules/analysis` theo Route → HTTP schema/validation → Service → Repository → MongoDB. Service dùng public `DatasetReadAccess`, không import repository nội bộ Dataset; BSON/driver/transaction nằm trong Repository. Repository trả domain errors, Service ánh xạ HTTP. Worker là tầng điều phối Service nền qua cùng Repository và adapter engine.

- Route POST chỉ trả envelope `{data: AnalysisRun}`, snapshot **queued**, kể cả worker đã chạy rất nhanh. Không thêm jobId/progress/anomalies. GET trả hiện tại.
- Không scope → lưu `{}`; thiếu sensorIds → tất cả; []422, tối đa10.000 IDs và mọi sensor phải thuộc dataset. Giữ snapshot sensorIds, chuẩn hóa from/to UTC Z ms, khoảng đóng [from,to], tối đa3 số phần lẻ; không cắt/làm tròn. From>to/semantics sai422; schema/syntax400. Không nhận bbox.
- Dataset thiếu khi POST404; chưa imported hoặc sensor sai422. Detail không khả dụng404 nếu dataset không imported; history dataset không khả dụng trả200/page rỗng, không thêm422 ngoài OpenAPI. Quyền đọc analyst/admin dữ liệu imported như B4, không tự giới hạn chỉ creator.
- Config phải tường minh và đúng policy: zscore `{threshold:3}`, iqr `{multiplier:1.5}`, moving_avg `{threshold:3,windowSize:N}` với N nguyên>=2, ml/isolation_forest `{}`. Không tự điền config hoặc chấp nhận tham số train trong request.
- Statistical grouping từng sensor, sort ts/id. Z-score toàn scope population std/min2; IQR toàn scope/min4. MA chỉ N mẫu trước hiện tại, warmup omit; phải còn ít nhất1 mẫu để score. Thiếu mẫu một sensor làm failed toàn run, không publish phần đã tính. Std0/giá trị bằng mean →score0/không flag; cửa sổ std0 khác giá trị hiện tại →INSUFFICIENT_DATA.
- Score Z/MA=abs(z), IQR=khoảng vượt fence ug/m3; ML=-decision_function, flag theo predict=-1. Mọi anomaly tạm severity=low theo chủ dự án; không phải AQI/mức nguy hại sức khỏe/probability.
- Worker kiểm tra versions, finite score/unique/foreign reading IDs; metadata candidate được dựng lại từ Reading trong scope, không tin location/dataset/sensor do engine khác gửi. Chỉ flagged thành Anomaly; review open/note rỗng/version1/updatedAt, unique(run,reading). Một reading có thể xuất hiện ở nhiều run.

## 3. Durable acceptance, admission và idempotency

MongoDB là nguồn job bền vững; **không dispatch qua queue bên ngoài**. Collections online8, thêm `analysisQueueState` singleton `{_id:'online',active:0}` và index claim `ix_runs_claim`; không thêm index TTL hoặc processedMutations. Xem [physical design](../mongodb-physical-design.md).

1. Tìm replay trước kiểm tra dataset/model hiện tại; fingerprint gồm operation/path và payload canonical (key order không ảnh hưởng; payload khác nghĩa là ý định khác). Dùng namespace user+key chung với B3.
2. Transaction nhỏ snapshot/majority: insert receipt completed/kind analysis với snapshot202 → conditional tăng counter nếu active<maxPending → insert run queued. Rollback toàn bộ nếu đầy hoặc lỗi; key của request bị từ chối không bị tiêu.
3. Duplicate same-key race nhận đúng response đã lưu, không tăng counter/run/job lần hai. Test hai app instances cùng DB; admission không dùng count-then-insert thiếu bảo vệ.
4. Replay24h đúng202/body/run ID ban đầu dù run đã completed/failed. Key quá hạn giữ receipt và409; key khác payload422; thiếu/sai UUID400. B3 sweeper vẫn chỉ xử lý upload/import.
5. Không có cửa sổ receipt Analysis processing riêng đã commit mà run chưa commit. REQUEST_IN_PROGRESS409 vẫn ánh xạ nếu gặp receipt processing chưa hoàn tất; không trả409 chỉ vì run đang running.

Mất response sau commit không làm mất job. Không tự tạo key/run thay thế; đối soát history và gửi lại cùng payload/key trong cửa sổ24h. Lỗi MongoDB không xác định sau commit có thể thành HTTP500; client phải đối soát, không suy ra nghiệp vụ chưa được nhận. Worker lifecycle độc lập retention receipt.

## 4. Worker, fencing và recovery

- Worker khởi động khi app ready, poll MongoDB, tối đa1 job/process mặc định. Claim atomic trên queued hoặc running hết lease, owner UUID mới, attempt tăng; lease dùng clock DB `$$NOW`. Queued ban đầu lease=epoch. Không reset counter lúc restart.
- Heartbeat10s, lease30s, poll1s; active job có AbortController/deadline120s. Statistical CPU chạy thread riêng; ML shell=false subprocess, native threads1, giới hạn16MiB input/output, không chuyển JWT/Mongo secrets. Main thread vẫn phải deserialize/validate/clone input/output, nên không hứa event-loop delay bằng0.
- Tối đa3 attempts thực thi sau crash. Khi claim tiếp theo phát hiện đã vượt, chốt failed/WORKER_RETRIES_EXHAUSTED; terminal không tự chạy lại. Engine failure/persist failure thông thường là terminal failed, không auto-retry thành ý định mới.
- Trước recompute, attempt mới cleanup partial theo batch500. Mỗi batch cleanup/insert **cùng transaction** với conditional write trên run theo owner/attempt/running/lease còn hạn. Claim/heartbeat/publication cùng tranh chấp run document; stale worker không thể check rồi ghi riêng ngoài fence.
- Completed chỉ khi mọi batch persist xong. Terminal transition + giảm admission counter cùng transaction/fence, chỉ một lần. Partial của failed giữ trong DB để đối soát, không HTTP public; chưa có cleanup tự động trên terminal. B6 phải gate tất cả đường list/detail/review theo completed như D008.
- Khi shutdown, dừng claim, abort engine và chờ process/thread kết thúc; job chưa terminal để lease hết hạn cho process khác. MongoDB lỗi/heartbeat mất quyền → dừng attempt, không publish; poll/recovery tiếp tục khi DB có lại. Không hứa exactly-once execution.
- Transaction có maxCommitTime10s và `withTransaction` retry budget15s theo Driver đang dùng; socket/server-selection dùng config MongoDB. Abort deadline không đồng nghĩa hủy tức thời một transaction DB đang bay; fence/commit outcome quyết định trạng thái bền vững.

Hai ca bắt buộc đã có kill Backend process thật: (a) sau receipt/run/counter commit, trước HTTP response và trước claim; (b) sau batch500 anomalies của test double. Restart dùng engine thật: kết thúc một run, đúng một anomaly thật, không giữ500 fixture candidates. Test thúc lease của **run test riêng** về epoch để tránh đợi30s; đây là fault injection, không thao tác DB người dùng.

## 5. Model và setup tái lập

Chủ dự án đồng ý baseline offline do agent tự chọn dữ liệu. [Manifest](../../server/ml/pm25-manifest.json), [CLI](../../server/ml/train_pm25_baseline.py), [ML runbook](../../server/ml/README.md) ghi provenance, train/holdout, seed, dependencies và hash. Python đã kiểm chứng3.11.9. Source license/attribution trong manifest; không gộp data license với cam kết chất lượng model.

- Model `pm25-iforest-uci381-v1`, SHA256 `554e03b3c2ba9f37c58ba9bae98ff020898738283883b430c40cd19c4f31329b`,343.467 bytes. Feature duy nhất value ug/m3. Runtime sklearn1.9.1/numpy2.4.6/scipy1.17.1/joblib1.6.0/threadpoolctl3.8.0.
- Chỉ train offline; CLI kiểm tra hash nguồn/runtime, từ chối ghi đè artifact/manifest khác. Chạy lại trong môi trường đang dùng đã tái lập cùng hash. Không train/fetch khi backend start, nhận request hoặc worker chạy.
- Inference kiểm tra manifest/hash/model ID pin theo build và hash/bytes/runtime trước load **chính verified bytes**, không load pickle tùy ý từ HTTP. Hash là integrity của artifact tin cậy đã tạo, không phải sandbox cho arbitrary pickle.
- Admission ML kiểm tra file/runtime bằng probe native được coalesce; file integrity kiểm tra mỗi lần tiếp nhận. Thiếu/hỏng model trước tiếp nhận→503, không receipt/run. Mất model sau tiếp nhận→failed an toàn. Version model/policy được giữ trong run; worker không âm thầm dùng model khác khi recover.
- Golden native: value50 →predict1, decision_function0.03491471581774891; value10000 →predict-1, decision_function−0.3069626761725055. Integration kiểm tra deterministic score anomaly0.3069626761725055 qua API/DB.
- Baseline một feature chỉ học phân bố giá trị; chưa chứng minh tính không gian/thời gian, độ chính xác hoặc chuyển miền. Dữ liệu holdout chưa có anomaly labels nên số flag không phải precision/recall. Khải còn đánh giá; severity nâng cao chưa được đặt.

Từ root repo, **giữ nguyên `.env`/venv đã có**, chỉ tạo venv nếu cần:

```powershell
npm ci
py -3.11 -m venv .local/detector-venv
.local/detector-venv/Scripts/python.exe -m pip install -r server/ml/requirements-pm25.txt
.local/detector-venv/Scripts/python.exe server/ml/train_pm25_baseline.py --output-dir .local/models/pm25-iforest-v1 --manifest server/ml/pm25-manifest.json
# Sau khi cấu hình JWT_SECRET/MONGODB_URI (Replica Set) trong .env:
npm run dev:server
```

Artifact/venv đã tồn tại và hoạt động trong workspace này; binary/source cache nằm `.local` gitignored. Khi deploy copy artifact đúng hash ra persistent volume, trỏ ANALYSIS_ARTIFACT/ANALYSIS_PYTHON absolute paths, đóng gói cả server/ml cùng dist. Không tự train trên host deployment để bù file bị mất. Quyền DB cần đọc/ghi các collections, createIndex và transaction. Model thiếu không chặn startup/statistical.

API POST mẫu, thay datasetId bằng dataset imported thật và key UUID riêng cho ý định mới:

```json
{"datasetId":"<imported-id>","family":"ml","method":"isolation_forest","config":{},"scope":{}}
```

## 6. Cấu hình và runbook vận hành

| Env | Mặc định | Ghi chú |
|---|---:|---|
| ANALYSIS_CONCURRENCY | 1 | Mỗi process; phải đo tổng tài nguyên trước tăng |
| ANALYSIS_LEASE_MS | 30000 | DB clock; heartbeat phải nhỏ hơn nửa lease |
| ANALYSIS_HEARTBEAT_MS | 10000 | Tránh renewal chồng nhau |
| ANALYSIS_POLL_MS | 1000 | Restart tự claim queued/expired |
| ANALYSIS_MAX_ATTEMPTS | 3 | Không auto-rerun terminal |
| ANALYSIS_TIMEOUT_MS | 120000 | Deadline attempt, abort engine; DB in-flight có timeout riêng |
| ANALYSIS_MAX_READINGS | 50000 | Có thể hạ, không vượt hard cap50k của baseline; không truncate |
| ANALYSIS_MAX_PENDING | 100 | Chung DB counter queued+running, đầy503 |
| ANALYSIS_MAX_SENSOR_IDS | 10000 | Bound payload; mọi ID phải thuộc dataset |
| ANALYSIS_PYTHON | .local/detector-venv/{Scripts/python.exe hoặc bin/python} | Resolve absolute, không lấy từ request |
| ANALYSIS_ARTIFACT | .local/models/pm25-iforest-v1/isolation_forest.joblib | Persistent/trusted đúng hash |

Replay cố định24h/no TTL, batch500, manifest/script pin theo server/ml. Xem `.env.example`. Khi đổi version, drain/đối soát run queued/running trước rollout nếu worker mới không còn engine/model version cũ; không tự rescore run cũ. Không sửa owner/attempt/receipt/counter thủ công khi worker đang hoạt động. Restore/migration cần dừng intake/worker và đối soát active counter với run active trước mở lại.

Nếu MongoDB mất kết nối, giữ run/receipt; không xóa dữ liệu hoặc reset counter. Khi có lại, worker reconcile qua claim và fence. Khi nhận failed, người dùng xem error/history rồi chủ động tạo ý định/key mới nếu muốn; B5 không có endpoint retry-job/cancel. Partial failed không có API đọc, B6 phải giữ visibility gate.

## 7. Kiểm thử và phép đo

- Root `npm run check`: typecheck/lint/unit/build cả client/server/shared-core. Unit client76, server57, shared-core7. Integration không bị thay bằng mock khi runtime/model thiếu.
- Server coverage: **118 tests/16 files đạt**, gồm61 integration; lines97%, statements92,10%, branches89,92%, functions93,86%. Module Analysis lines99,47%. Test real engine/HTTP/DB cho config/scope/constant/empty/insufficient/two sensors, exact bound/overflow, membership/time, model unavailable và deterministic golden. V8 coverage trừ main; Python/CLI không nằm trong mẫu số. File statistical.worker.ts hiển thị0% ở coverage parent dù thread thực sự chạy trong integration/compiled benchmark; không sửa số liệu thành coverage giả.
- Fault tests: cùng key/two app instances; admission không vượt mức và rollback receipt; replay/expiry; heartbeat qua lease ban đầu; stale write/terminal bị fence; max attempts; timeout/output foreign/duplicate/non-finite; MongoDB validator từ chối batch sau khiến failed, không completed; hai ca kill process thật nêu trên.
- Browser:5 tests B2–B5 (test mới B5 dùng B3 import/API thật). ML API thật kiểm chứng bằng integration, chưa bật ML UI; B6 vẫn404 và FE không báo fake empty success.
- [Phép đo Analysis](b5-analysis-measurements.json): disposable Replica Set, seeded500k readings/1000 sensors, scope60 sensors/30k rows; **bản biên dịch dist và statistical thread JavaScript**, HTTP thật. Bốn methods completed; thống kê mỗi method60 anomalies đúng scope, ML phản ánh phân bố khác miền của seed. Report ghi CPU/Node RSS/event-loop/HTTP latency và giới hạn; không dùng flag count làm quality metric.
- Node RSS/CPU gồm statistical threads, **không gồm MongoDB/Python subprocess**. Cường còn đo tổng memory/native CPU, nhiều user/process, timeout proxy/volume/TLS/CI và SRS SLA. Không tăng mặc định concurrency từ phép đo một lần.

Số đo cuối trên cùng workload, concurrency1, backend/thread bản biên dịch; elapsed gồm tiếp nhận/poll/compute/persist:

| Method | Elapsed giây | Anomalies | Node peak RSS MiB | Event-loop max ms | HTTP readings p95 ms |
|---|---:|---:|---:|---:|---:|
| zscore | 3,61 | 60 | 380,69 | 198,57 | 13,11 |
| iqr | 3,90 | 60 | 393,82 | 162,53 | 8,08 |
| moving_avg | 2,90 | 60 | 393,64 | 178,13 | 8,19 |
| isolation_forest | 9,78 | 30000 | 384,96 | 366,48 | 7,50 |

HTTP readings/health đồng thời không lỗi; RSS là tuần tự trong cùng Node process, không phải các process độc lập. ML flag30k/30k trên seed giá trị1/2/3 và10000; đây không phải quality benchmark hoặc cơ sở tự đổi threshold. Test golden value50 bình thường/value10000 bất thường là bằng chứng nối thư viện, không thay đánh giá domain của Khải.

Lệnh Windows đã dùng MongoDB9.0.4 cài sẵn để tạo **mongod tạm**, không dừng/sửa service MongoDB người dùng. Harness ghi binary8.2.6 nhưng lần kiểm chứng này override bằng9.0.4; không tuyên bố đã test8.2.6.

```powershell
$env:MONGOMS_SYSTEM_BINARY='C:/Program Files/MongoDB/Server/9.0/bin/mongod.exe'
$env:MONGOMS_SYSTEM_BINARY_VERSION_CHECK='false'
npm run check
npm run test:coverage --workspace @pm25/server
npm exec --workspace @pm25/server -- playwright test --config playwright.config.ts
npm run benchmark:analysis --workspace @pm25/server
```

Regression engines D014 cần **venv/artifact demo riêng** theo server/ml/README; không nâng venv sklearn1.2.2 đó lên1.9.1 hoặc dùng nó cho B5. Root unit check không cần Python; integration ML thiếu runtime/artifact phải fail rõ.

## 8. Handoff và việc còn lại

- **Khiêm/Backend:** B5 baseline API/worker/persistence/failure semantics đã triển khai; B6 tiếp theo phải gate anomalies theo completed và thực hiện review CAS riêng. Không thay OpenAPI/shared schemas hoặc triển khai B6 trong đợt này.
- **Khải:** review model value-only/reference dataset, domain shift/labels/quality, severity policy và feature/model version tiếp theo. Không diễn giải baseline thành model đã đạt mục tiêu phát hiện không gian/thời gian.
- **Tài/Frontend:** statistical/history/poll/reload đã E2E thật; nhận ML method/config/version ở mục2 và replay24h ở mục3 để mở UI có chủ đích. Bbox vẫn chặn; B6 chưa có nên kết quả/review chưa thể nghiệm thu end-to-end.
- **Cường:** Replica Set/index permissions, model/Python packaging và persistent volume; đo tổng CPU/RAM/native process, tải nhiều người dùng/process, proxy deadline/CI/TLS trước triển khai/tăng cấu hình. Không cần Redis/BullMQ cho baseline này.

Ghi chú workspace: phiên bản dev worker ban đầu không truyền biến OS cho TSX đã tạo cache tại `server/undefined/temp/tsx-PC`; đã sửa env whitelist và tắt cache TSX của thread để tránh tạo mới. Lệnh dọn cache cũ bị automatic approval review từ chối (`blocked by policy`, không có lý do chi tiết), nên giữ nguyên thư mục generated/untracked này; không thử xóa bằng công cụ khác. Cache không thuộc sản phẩm và không ảnh hưởng các kiểm thử đã đạt.
