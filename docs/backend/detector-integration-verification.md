# Tích hợp thư viện thuật toán trước B5

Ngày kiểm tra: **15/11/2026, Asia/Saigon**. Theo yêu cầu và [D014](../decisions.md#d014--tích-hợp-thư-viện-trước-b5-15112026), đã nối implementation có sẵn vào shared-core và internal Backend adapters. **Chưa triển khai B5.** Đây là kiểm chứng library/input/output/references, không phải nghiệm thu production policy hoặc chất lượng phát hiện PM2.5.

## Kết quả bàn giao

| Phần | Trạng thái / bằng chứng |
|---|---|
| Z-score | Gọi mean/standardDeviation hoặc sampleStandardDeviation/zScore của simple-statistics 8.0.0; golden vector và anomaly thử nghiệm đã chạy |
| IQR | Gọi quantile/interquartileRange của thư viện, giữ cách nội suy type-7 của bản 8.0.0; policy thử nghiệm áp fences 1.5 IQR |
| Moving Average | Thư viện không có hàm moving average riêng; người dùng đã đồng ý ghép cửa sổ rồi gọi mean() của thư viện. Std/zScore cho phép thử cũng gọi library, không tự viết công thức |
| Isolation Forest | Load/predict/decision_function/score_samples **thật** bằng scikit-learn từ artifact upstream đã có, pin revision/hash/runtime; không train trong Backend hoặc tự train khi thiếu model |
| Backend business boundary | Validate normalized readings/output, identity/scope và score hữu hạn; chỉ flagged thành candidate trong bộ nhớ, gắn readingId/datasetId/sensorId/ts/location/value/unit chuẩn |
| B3/B4 → adapters | Test nhập CSV thật → mapping/import MongoDB thật → B4 Query → ba statistical adapters và Python model; references khớp Reading đã lưu |
| B5/Anomaly | Chưa có routes/job/queue/run/anomaly persistence, severity hoặc production feature extraction; test xác nhận analysisRuns/anomalies vẫn 0 và GET/POST analysis-runs vẫn 404 |

Giữ Fastify + TypeScript và feature boundaries. shared-core không import Node/Fastify/MongoDB/DOM. ML nằm riêng ở `server/ml` và `server/src/engines`; process Python là bridge private cho inference, không phải HTTP service/topology B5 đã chọn. OpenAPI, Shared Data Contract fields/validators và FE không thay đổi. `contracts/index.ts` chỉ sửa đuôi `.js` cho ESM/build.

## Policy tường minh, chưa phải production defaults

`evaluateStatistics(input, policy)` giữ StatisticalDetectorInput/Output đã có. Policy bắt buộc khai báo method, grouping/reference/order, số mẫu, population/sample std, handling thiếu dữ liệu/warmup, config validation và cách đổi library facts thành score/flag. Không có policy ngầm khi caller không cung cấp.

[Profile thử nghiệm](../../shared-core/tests/experimental-policies.ts) có nhãn EXPERIMENT-ONLY và không nằm trong package build/export. Chúng được dùng trong tests/CLI để chứng minh adapter, **không chốt production rules của B5**:

| Thử nghiệm | Rule khai báo tường minh |
|---|---|
| Chung | Một dataset, unique reading IDs và sensor/instant; group sensor, sort ts/id; một nhóm thiếu dữ liệu → reject-scope, results rỗng |
| Z-score | Reference toàn nhóm sensor được cung cấp; population std; minSamples=2; score=abs(library z); flag khi score>3 |
| IQR | Reference nhóm sensor, minSamples=4; multiplier=1.5; score là khoảng cách ngoài fence, đơn vị ug/m3; equality tại fence không flag |
| Moving Average | Cửa sổ đếm trước điểm hiện tại, không bao gồm target; fixture windowSize=3/threshold=3; gọi library mean/std/zScore; warmup omit có message, không gán thành normal giả |
| Zero dispersion | Policy thử nghiệm cho score 0/false chỉ khi target bằng reference mean; target khác với std=0 → insufficient_data, không NaN/Infinity/anomaly giả |

Các score ở bảng có ý nghĩa/đơn vị khác nhau, không tự so sánh thành severity hoặc probability. Grouping/reference/window/minSamples/zero-dispersion/score mapping dùng thật vẫn cần Khải/Khiêm/Tài chốt trước B5. Core chỉ triển khai các mode đủ để thử nghiệm; không khẳng định mọi lựa chọn policy tương lai đã có.

Input khác dataset/trùng ID hoặc instant, config sai, arithmetic/output không hữu hạn hoặc policy lỗi không được trả partial như completed. Adapter output giữ trạng thái invalid_input/insufficient_data của Shared Contract; chưa ánh xạ thành lifecycle/HTTP error của Analysis B5. Các hàm statistical chạy đồng bộ trên CPU; Promise không offload chúng. Scheduling/workers/budgets cho workload lớn chưa được chọn.

## Model đã tự tìm/chọn và giới hạn

Sau khi người dùng giao tự chọn artifact, đã khảo sát các nguồn public. Model air-quality cộng đồng có pipeline cần nhiều pollutants/weather/engineered features mà Reading PM2.5 hiện không có; không điền 0 hoặc giả các features đó để nhận một prediction rồi gọi là tích hợp đúng.

Đã chọn **artifact demo có metadata rõ** từ [sklearn-docs/anomaly-detection](https://huggingface.co/sklearn-docs/anomaly-detection/tree/8689ffabbcd62a83317502891610d4dee4f6201e), với [config upstream](https://huggingface.co/sklearn-docs/anomaly-detection/blob/8689ffabbcd62a83317502891610d4dee4f6201e/config.json):

| Thuộc tính | Giá trị |
|---|---|
| Revision | 8689ffabbcd62a83317502891610d4dee4f6201e |
| File | isolation_forest.pkl, 432.745 bytes |
| SHA-256 | 054900c4e2e933bd5768981f6ed6f871936bf2d218ea9a1a5581f7d508fb45f0 |
| Pipeline | StandardScaler + scikit-learn IsolationForest; không viết lại trees/scoring |
| Features đúng thứ tự | x0, x1 — **hai features mô phỏng, không có nghĩa PM2.5** |
| Metadata train | scikit-learn 1.2.2 |
| Runtime kiểm chứng | Python 3.11.9; sklearn 1.2.2; NumPy 1.24.4; SciPy 1.10.1; joblib 1.2.0; threadpoolctl 3.1.0 |
| License | MIT theo metadata model card upstream |
| Nơi lưu | `.local/models/sklearn-docs-anomaly-detection-8689ffa/isolation_forest.pkl`, gitignored; manifest/requirements được commit trong source |

**Model này chỉ chứng minh load/infer/projection, chưa phải model PM2.5.** Test đưa feature matrix mô phỏng tường minh từ hệ tọa độ upstream và gắn từng row với readingId để kiểm tra references; không tự trích x0/x1 từ value/ts/location, không tuyên bố production features đã tích hợp. Chưa đo precision/recall/F1 hoặc suy ra chất lượng từ việc thấy một outlier. Model card upstream cũng ghi chưa dùng production.

Ban đầu khảo sát dependency mới 1.9.1; artifact cũ không được tự load bằng runtime đó. Runtime riêng 1.2.2 được dùng theo metadata, không sửa estimator để vượt version checks và không quyết định Python/ML version production. [Scikit-learn persistence guidance](https://scikit-learn.org/stable/model_persistence.html) yêu cầu môi trường phù hợp khi load model và nêu rõ pickle-based loading chỉ dành cho nguồn tin cậy.

CLI tải đúng revision, kiểm tra hash/size trước lưu; inference kiểm tra lại runtime/hash rồi load **chính verified bytes** để tránh thay file giữa kiểm tra/load. Hash giữ integrity, không biến arbitrary pickle thành an toàn. Nguồn/model/path/manifest là operator configuration đã review, không nhận từ HTTP; subprocess không phải OS security sandbox. Không chạy source Python tải từ repo model, không có fit/train hoặc fallback khi model mất.

## Bridge Node → Python và output nghiệp vụ

Runner dùng absolute executable/script paths, argv/shell=false/windowsHide, JSON stdin/stdout protocol 1. Limits/deadline/slots bắt buộc; slot chỉ trả sau process close. Chặn input/output vượt budget, hỗ trợ abort/timeout, kiểm tra JSON và model metadata, drain stderr nhưng không đưa traceback/path/payload vào lỗi. Env child không chuyển JWT/Mongo credentials. Thread settings phục vụ phép thử, không phải production concurrency/admission policy.

Harness dùng timeout 30 giây, input/output 1 MiB, một slot **mỗi runner instance**. Chưa có batching/pool/cluster budget hoặc full-scope Analysis loader. B5 phải chốt và đo lại cho 30k/500k readings; không lấy 100/2.000 điểm FE hoặc limit trong phép thử này làm toàn bộ scope.

ML input bắt buộc feature order đúng manifest, số cột đúng, hữu hạn và đủ/mỗi readingId đúng một lần. Output phải đủ references, không foreign/duplicate IDs, native prediction chỉ +1/-1, scores hữu hạn. Giữ raw decision_function/score_samples; caller phải cung cấp score projection có tên. Fixture dùng `-decision_function`, không ngầm đổi đây thành probability/severity hoặc public ML method string.

Candidate nội bộ có **readingId**, không có Anomaly ID/run/review/severity. Chỉ chọn flagged sau khi validate **toàn bộ** output; không persist partial rồi báo thành công. Parent imported/full scope vẫn là trách nhiệm B5 trước khi gọi adapter; pure adapter không query DB để tự đoán quyền/status/scope.

## Kết quả chạy thật

[Kết quả CLI đầy đủ](detector-integration-results.json) được sinh bằng [verify-detector-integration.ts](../../server/scripts/verify-detector-integration.ts), dùng 22 readings mô phỏng (chu kỳ giá trị 1/2/3 và điểm 100 cuối). Tất cả profile/features đều có nhãn thử nghiệm:

| Adapter | Kết quả |
|---|---|
| Z-score | completed, 22 scores, candidate reading cuối; score khoảng 4,57908 |
| IQR | completed, 22 scores, candidate cuối; distance outside fence=94 ug/m3 |
| Moving Average | completed, 19 scores, 3 warmup được khai báo omit, candidate cuối |
| Isolation Forest | Native vectors [1.9,2] → label +1/decision 0,11303433389747941; [10,10] → label -1/decision -0,23539738528445997; source model được load/predict thật |

CLI latency chỉ là mẫu nhỏ: xem elapsedMs trong JSON (gồm startup/load Python cho ML), không phải benchmark/SLA. Feature matrix ML trong CLI là fixture synthetic upstream, không phải kết quả học/extract từ readings PM2.5.

DB integration khác CLI: CSV được upload/mapping/import bằng B3, lưu MongoDB replica set thật; Query B4 trả 22 readings và nextCursor=null; cả ba statistical adapters và Python model tạo candidate có references khớp Reading lưu. Dữ liệu vừa một trang là đặc tính fixture; **không chứng minh loading Analysis scope vượt một trang đã xong**. Sau phép thử, analysisRuns=0/anomalies=0, GET/POST `/api/v1/analysis-runs` vẫn 404. Không tạo/lưu run hoặc enqueue job để chứng minh integration.

## Cách tái lập

Node 24.14.1/npm 11.11.0; Windows/Python 3.11; artifact runtime như bảng. Node dependencies pin qua package-lock, Python qua requirements riêng; không đổi Python packages global.

```powershell
npm ci
python -m venv .local/iforest-artifact-venv
.local/iforest-artifact-venv/Scripts/python.exe -m pip install -r server/ml/requirements-artifact.txt
.local/iforest-artifact-venv/Scripts/python.exe server/ml/fetch_artifact.py
npm run verify:detectors
npm run check
npm run test:coverage --workspace @pm25/shared-core
# DB integration harness: dùng system binary nếu đã cài; lượt này thực chạy MongoDB 9.0.4.
$env:MONGOMS_SYSTEM_BINARY='C:/Program Files/MongoDB/Server/9.0/bin/mongod.exe'
$env:MONGOMS_SYSTEM_BINARY_VERSION_CHECK='false'
npm run test:coverage --workspace @pm25/server
```

Linux dùng venv/bin/python; đặt DETECTOR_PYTHON thành absolute path cho harness. DETECTOR_ARTIFACT chỉ override local file vẫn phải đúng hash. Xem [ML README](../../server/ml/README.md). Test không tự tải model, không skip khi thiếu dependency/artifact và không đổi sang mock predictions; setup thiếu làm suite fail rõ ràng. Test DB/nguồn dùng temp paths có guard trước cleanup, không đụng DB người dùng. Runtime B1–B4 không tự gọi Python/download model.

| Kiểm chứng | Kết quả / phạm vi |
|---|---|
| Shared-core | 7 golden/edge tests; typecheck cả source/tests; build ESM/declarations; pure source không Node/DOM dependency |
| Statistical coverage | src/statistics: statements 96,38%, branches 89,53%, functions/lines 100%; **không phải coverage toàn Shared Contract**, không cộng client tests để đạt mục tiêu Khải |
| Backend unit | Project đúng candidate; từ chối foreign/duplicate IDs, non-finite scores, scope/Reading invalid; không thêm severity/state |
| ML thật | Predict deterministic/native golden scores, runtime/feature-order/hash/missing-model failure, feature identity/completeness và invalid score projection |
| Transport doubles | Chỉ fixture transport kiểm tra overload, process-close/slot, abort/timeout, size/JSON/stderr; không dùng nó làm ML output hoặc fallback inference |
| DB thật | B3/B4 → adapters; đúng references và không có B5 effects/routes |
| Server coverage | 98 tests/14 files, lines 97,02%, statements 92,75%, branches 89,77%, functions 93,53%; engines TS lines 97,29%. **Vitest không đo Python line coverage** |
| Runtime JS dependencies | npm audit --omit=dev: 0 vulnerabilities lúc kiểm tra; không suy ra Python đã được audit hoặc toàn dev toolchain sạch |

Root `npm run check` **PASS**: typecheck/lint/unit/build cho client/server/shared-core (client 76 tests, server unit 54 tests, shared-core 7 tests). Generator vẫn 20 online operations/33 schemas. Server full coverage suite ở trên có 98 tests gồm 44 integration tests; không gộp 7 shared-core tests vào coverage Server. Không rerun browser E2E trong đợt này: không đổi app routes/FE, integration mới được kiểm tra qua adapters/DB/protocol thật; browser B2–B4 có bằng chứng lịch sử riêng.

Source/test chính: [shared statistical adapter](../../shared-core/src/statistics/index.ts), [golden/profile tests](../../shared-core/tests/statistics.test.ts), [Backend engines](../../server/src/engines/statistical.ts), [real inference/transport](../../server/tests/engines.integration.test.ts), [DB integration](../../server/tests/engines-db.integration.test.ts). Upstream implementations: [simple-statistics source](https://github.com/simple-statistics/simple-statistics/tree/v8.0.0), [scikit-learn IsolationForest](https://scikit-learn.org/1.2/modules/generated/sklearn.ensemble.IsolationForest.html).

## Phần giữ mở và bàn giao

- **Khải:** review statistical policy trên nguồn thật, production model/features/preprocessing/version, score semantics/severity và chất lượng detector. Artifact demo không thay model PM2.5; không suy ra Khải đã nghiệm thu từ các tests của agent.
- **Khiêm:** các adapters/references/projection đã có; khi được giao B5 mới làm full-scope repository, durable acceptance/queue/claim/recovery/persistence và HTTP mapping. Chưa thêm analysis routes hoặc đánh dấu milestone B5 hoàn tất.
- **Cường:** review môi trường legacy phù hợp artifact/demo, packaging model/Python, workload/process/thread/memory budgets, CI setup và đo tải. Subprocess bridge của phép thử không quyết định topology B5.
- **Tài/Duy:** FE M5 và offline Worker chưa được nối vào các adapter này; public contracts/online API không đổi. Shared-core thuần TS đủ ranh giới để tích hợp sau, không coi offline/ML UI đã xong.

Môi trường khảo sát ban đầu `.local/detector-venv` (sklearn 1.9.1) không được dùng cho artifact đã chọn. Bước dọn thư mục đó bị xét duyệt thực thi tự động chặn với thông báo `blocked by policy`; thư mục được giữ lại, không thử lách chặn và không ảnh hưởng runtime `.local/iforest-artifact-venv` đang kiểm chứng.
