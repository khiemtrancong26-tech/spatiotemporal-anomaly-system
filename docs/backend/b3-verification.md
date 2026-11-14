# B3 — Upload, validation, mapping và batch import

Ngày kiểm tra: 14/11/2026. Phạm vi: [Backend B3](../backend-online-plan.md#b3--upload-validation-mapping-và-batch-import), quyết định của chủ dự án [D012](../decisions.md#d012--import-b3-và-durable-idempotency). **Bốn API B3 đã triển khai bằng file/MongoDB thật; FE M3 đã chạy E2E online không HTTP intercept.** Giữ Fastify + TypeScript, Feature-based Modular Monolith và Route → Validation → Service → Repository → MongoDB. Không đổi OpenAPI hoặc Shared Data Contract.

## API bàn giao

Tiền tố `/api/v1`; JWT analyst/admin và current-user lookup của B2 áp dụng cho cả bốn operations.

| Operation | Hành vi thật |
|---|---|
| POST `/datasets` | Multipart đúng một `file`, tùy chọn `name`, UUID Idempotency-Key; nguồn persistent + checksum, structural scan, transaction tạo Dataset/receipt; `201 SingleDataset`, status `awaiting_mapping` |
| GET `/datasets/{id}/validation` | `200 ValidationReport` trực tiếp, không bọc data; counts/issues/sourceColumns/suggestions từ nguồn đã đọc; status hiện tại và recovery khi cần |
| PUT `/datasets/{id}/mapping` | Replace toàn bộ mapping, kiểm tra cột, unit, ngữ nghĩa; CAS mappingVersion; `200 SingleDataset`; cùng nội dung đã xác nhận không tạo version/attempt mới |
| POST `/datasets/{id}/imports` | Không body, UUID key; đồng bộ `200 SingleDataset` sau hoàn tất persistence/report/publication; cùng key replay snapshot, key mới cho imported trả hiện trạng và không nhập lại |

Sau B3 có **9/20 operations online/health**. GET datasets B2 đã đối chiếu nguồn import thật; failed/importing không xuất hiện trong list. B4 Query chưa có handler: tests xác nhận sensors/readings vẫn 404, **chưa nghiệm thu visibility qua Query/Analysis**. HTTP reading-batches, Offline/Sync/P1/P2 và API tải/xóa báo cáo vẫn hoãn.

## Nguồn, validation và BR-08

- CSV UTF-8 có header duy nhất, không rỗng; JSON top-level array các object phẳng. CSV parser giữ số dòng vật lý bắt đầu record, tính cả header/xuống dòng trong ô; JSON dùng thứ tự phần tử bắt đầu 1. JSON được frame từng phần tử bounded rồi native JSON.parse, không parse cả mảng vào heap. CSV/JSON/UTF-8 sai cú pháp bị từ chối 422.
- Trước mapping, validRows/invalidRows phản ánh cấu trúc. PUT mapping kiểm tra ngữ nghĩa, lưu report cập nhật; import đọc/kiểm tra lại checksum và dữ liệu. Nhiều trường sai có thể tạo nhiều issues, nhưng invalidRows chỉ tăng một lần/dòng. FE đã thêm nhãn giải thích và tải lại report sau PUT, kể cả report khi PUT bị từ chối.
- Chỉ `ug/m3`; unit nguồn được map hoặc cột unit được nhận diện không được trái xác nhận. Timestamp cần Z/offset, tối đa 3 chữ số phần lẻ, ngày/tháng/giờ hợp lệ. Không suy đoán timezone, quy đổi unit hoặc cắt/làm tròn phần lẻ. WGS84 kiểm tra latitude/longitude, snapshot lưu `[longitude,latitude]`; value hữu hạn ≥0, zero và giá trị cao vẫn hợp lệ.
- Dòng invalid không chọn winner. Cùng mã trạm có tọa độ khác giữa các dòng còn lại làm cả dataset failed. Không còn dòng hợp lệ → 422/failed. External ID nguồn ánh xạ Sensor ObjectId theo dataset; Reading lưu ID nội bộ, BSON Date UTC, value BSON Double và sourceRowNumber private.
- Import đọc theo thứ tự, batch bounded, ordered bulkWrite. Map winner trong batch cộng lookup persisted winner qua ranh giới batch bảo toàn first valid row sau chuẩn hóa UTC. Unique `(datasetId,sensorId,ts)` là hàng rào cuối. Hai dataset cùng mã trạm/thời gian độc lập.
- ImportSummary tách tổng imported/duplicate/conflicting/invalid; tổng bốn loại bằng totalRows. Duplicate/conflict có keptRowNumber; issues chỉ dùng trường/enum trong contract. Report vượt cap trả 422 và dọn partial, không xuất bản bản thành công với lỗi bị cắt.

## Giới hạn và nơi lưu

| Cấu hình ban đầu | Giá trị / env |
|---|---|
| File | 100 MiB — IMPORT_MAX_FILE_BYTES=104857600 |
| Một record / ngân sách metadata cột | 1 MiB — IMPORT_MAX_RECORD_BYTES=1048576 |
| Batch | Tối đa 1.000 rows, thêm byte budget nội bộ 8 MiB — IMPORT_BATCH_SIZE=1000 |
| Issues | 1.000 — IMPORT_MAX_ISSUES=1000 |
| Trạm | 10.000/dataset — IMPORT_MAX_SENSORS=10000 |
| Work concurrency | 2 uploads / 1 import mỗi process; IMPORT_UPLOAD_CONCURRENCY=2, IMPORT_CONCURRENCY=1 |
| Deadline | 120.000 ms — IMPORT_TIMEOUT_MS; stream/queue nhận AbortSignal, kiểm tra trước batch/publish, multipart chưa hoàn tất cũng bị đóng |
| Lease | 30.000 ms — IMPORT_LEASE_MS; heartbeat khoảng lease/3, fencing theo owner/receipt |
| Replay | 24 giờ cố định, không TTL xóa receipt |

Mặc định lưu `<repo>/.local/imports`, gitignored. Triển khai đặt IMPORT_STORAGE_DIR trên thư mục/volume persistent ngoài MongoDB. Tên file lưu do Backend sinh, không dùng path do client cung cấp; ghi stream có SHA-256, fsync trước rename; metadata chỉ chứa reference/checksum private. Nguồn đã tiếp nhận không tự xóa P0. Chỉ loại temp/uncommitted file mà request/receipt sở hữu; không tự quét xóa nguồn người dùng.

Deadline là giới hạn công việc có kiểm tra/cancel; lệnh DB đang bay vẫn có giới hạn timeout driver/transaction riêng, không cam kết cắt mọi syscall đúng một mili-giây. Khi chưa xác định commit, không trả thành công giả hoặc tự chạy lại. Thông số này chưa phải benchmark/SLA. Limiter scan gỡ tác vụ đã hết deadline khỏi hàng đợi; scrypt của B2 tiếp tục dùng limiter chung tối đa 2 như trước.

## Idempotency và transactions

Collection nội bộ `idempotencyReceipts`, unique user+key; fingerprint gắn operation/path/content, upload gồm SHA-256 bytes và filename/media/name. Hai indexes mới nâng tổng online lên **13 indexes trên 7 collections**, không có TTL/processedMutations/sync index. Xem [physical addendum](../mongodb-physical-design.md#bổ-sung-b3-đã-triển-khai--d012-14112026).

- Cùng key/payload hoàn tất replay nguyên status/body cũ, kể cả failure. Không lấy Dataset hiện tại để thay snapshot upload cũ. In-flight 409; key đã dùng cho payload/path/operation khác 422; thiếu/sai UUID 400. Quá 24 giờ trả 409, giữ receipt và không chạy lại bằng key cũ.
- Upload phải nhận đủ envelope/file để tính fingerprint; lỗi transport/header/envelope trước claim không tạo nghiệp vụ/receipt. Chưa có ID sau mất response thì phải giữ file/metadata/key gốc khi replay; reload không khôi phục được các thứ đã mất.
- Import kiểm tra replay/in-flight trước admission. Dataset đang importing với key khác trả 409. Hết công suất cho một import mới trả 503 **trước claim**, nên thử lại cùng key sau đó được; không cố định một overload tạm thời thành receipt failure. Lỗi sau claim được giữ ổn định hoặc đối soát nếu chưa thể chốt.
- Cần MongoDB replica set. Upload Dataset + response 201 và publication imported + response 200 chốt trong transaction snapshot/majority. Batch/cleanup dùng nhiều transaction nhỏ riêng; không transaction toàn file. Mỗi transaction ghi fence receipt và Dataset trước effects; heartbeat/owner và receipt ID ngăn worker cũ ghi hoặc xóa sau recovery.
- Receipt primitive nằm ở shared persistence để B5/B7 dùng cùng quy tắc key. Effect/atomicity của Analysis/Admin và queue chưa triển khai; recovery B3 chỉ xử lý kind upload/import, không tự nhận xử lý job tương lai.

## Lifecycle, lỗi và restart

| Tình huống | Xử lý / thao tác tiếp theo |
|---|---|
| Upload thành công, chưa xác nhận mapping | awaiting_mapping; report sơ bộ; PUT mapping trước import |
| PUT mapping có lỗi nguồn toàn bộ/conflict/cap | 422, report lưu và failed; không readings public; có thể sửa mapping khi nguồn phù hợp, hoặc bắt đầu upload nguồn đã sửa |
| Import đang chạy | importing + attempt owner; mapping bị khóa; list không public |
| Batch lỗi nhưng DB/nguồn còn đối soát được | Cleanup readings rồi sensors theo batch có fencing; chốt failed + receipt failure cùng transaction |
| Cleanup/commit chưa xác định hoặc deadline | Giữ importing/processing private, trả lỗi an toàn; chờ recovery, không tự đổi key hoặc chạy lại |
| Response mất sau publication commit | Cùng key replay 200 và cùng dataset/summary, không thêm readings |
| Restart sau partial batch | Sweep tối đa 10 expired receipts/lượt, chu kỳ lease; validation/mapping/import cũng yêu cầu đối soát liên quan. Claim owner mới nguyên tử rồi cleanup; failed chỉ sau dọn xong |
| Receipt chết trước start CAS | Hoàn tất failure receipt; chỉ dọn Dataset importing có cùng receipt ID, không đụng attempt khác hoặc Dataset đã imported |
| Retained source mất/đổi checksum | Không nhập với dữ liệu giả hoặc nguồn mới âm thầm; mutable dataset bị khóa/failed khi đối soát được. Mapping không đọc được nguồn → 500 theo tập status có sẵn; import → 503 và không public |
| Failed đã cleanup, muốn retry | Đọc validation → người dùng chuẩn bị lần nhập mới → xác nhận lại PUT mapping → POST với key mới. Key cũ vẫn replay failure cũ |
| Imported, key mới | 200 hiện trạng, không reimport; mapping 409 |

FE giữ sessionStorage ngữ cảnh tối thiểu như trước; không tự POST khi reload. Nút chuẩn bị retry chỉ mở sau GET xác nhận failed; nút bắt đầu upload mới cũng đọc lại trạng thái, tránh bỏ một thao tác còn chưa biết kết quả. Không hứa khôi phục full mapping/file/key đã mất.

File `.tmp` bị bỏ lại nếu process chết trong intake **trước claim** chưa có receipt để nhận diện kết quả; chúng không có Dataset/public data. P0 không tự xóa file không rõ owner trong volume dùng chung. Cường cần kiểm kê và dọn temp khi đã chắc không còn process ghi; không xóa `.source` đã tiếp nhận hoặc receipt. Recovery có receipt xử lý orphan `.source` chưa commit theo đúng owner/resource. Đây không phải chính sách backup/power-loss/garbage collection hoàn chỉnh.

## Kiểm chứng và cách tái lập

Windows, Node 24.14.1/npm 11.11.0, Fastify 5.12.8, Official Driver 7.9.0, multipart 10.1.8, csv-parse 7.0.3, Vitest 5.1.0, Playwright 1.65.0/Chromium. Lượt kiểm tra này dùng binary **MongoDB 9.0.4/WiredTiger** có sẵn trên máy; B3 khởi tạo replica set 1 node trên port/database/storage tạm. Không dùng MongoDB service/DB của người dùng, không giả repository/transactions.

Harness vẫn mặc định tải 8.2.6 nếu không cấu hình system binary; máy này chưa có cache 8.2.6 và bước tải bị treo, nên đã dùng binary cài sẵn. Không báo rằng 8.2.6 đã được chạy trong lượt B3 này hoặc chốt phiên bản triển khai của Cường. Tái lập môi trường vừa kiểm tra:

```powershell
# Chỉ dùng path này nếu binary tồn tại; kiểm tra --version trước.
& 'C:/Program Files/MongoDB/Server/9.0/bin/mongod.exe' --version
$env:MONGOMS_SYSTEM_BINARY='C:/Program Files/MongoDB/Server/9.0/bin/mongod.exe'
# Harness đang pin default download 8.2.6; actual system binary ở trên là 9.0.4.
$env:MONGOMS_SYSTEM_BINARY_VERSION_CHECK='false'
npm run check
npm run test:coverage --workspace @pm25/server
npm run test:e2e:b2
npm run test:e2e:b3
npm run test:e2e
```

| Kiểm tra | Kết quả |
|---|---|
| Root check | PASS client/server typecheck, lint, unit/HTTP/contract, build; client 76 tests, server unit 46 tests; generator giữ 20 operations/33 schemas |
| Server coverage với DB thật | PASS 73 tests/9 files; 27 DB integration tests, trong đó B3 có 16; statements 91,80%, branches 87,34%, functions 92,65%, lines 96,80% |
| B3 parser/nguồn | UTF-8 chia từng byte, JSON escaped punctuation/malformed whitespace/syntax, CSV multiline CRLF/ragged/header, record/file cap, checksum/path, calendar/offset/fraction, zero/nonfinite/unit/WGS84 và nhiều lỗi trên một dòng |
| B3 BR-08/DB | First-invalid rồi valid; cùng UTC khác offset; same-value/conflict qua batch; internal IDs/BSON Double/location; hai dataset; report/station cap; 5.000 readings qua đúng 5 batch × tối đa 1.000 |
| B3 fault/recovery thật | Batch đã commit rồi lỗi → cleanup; app restart; kill Backend child process giữa batch; stale-owner fencing; expired pre-start receipt không dọn attempt khác; upload orphan có receipt; giữ nguồn thất lạc/đổi checksum không public |
| B3 keys/network/admission | Replay/in-flight/payload mismatch/thiếu-sai key, cross-operation/user scope, expiry không TTL, post-commit fault và mất TCP response thật; hết công suất trước claim; multipart treo hết deadline trả lại slot |
| Full file cap | Stream ghi đúng 100 MiB thành công, 100 MiB + 1 byte bị từ chối; đây là kiểm tra file storage, không phải import 100 MiB hoặc benchmark RAM/throughput |
| Browser B2 thật | PASS 1 case, regression Register/Login/me/Datasets/401 như trước |
| Browser B3 thật | PASS 2 cases: wizard → Datasets/reload; fault sau batch commit → đọc failed → chủ động remap/new key retry. File/API/DB thật, không HTTP intercept; fault hook chỉ bật trong test |
| Client regression E2E | PASS 18 cases; đây là mock/HTTP-interception tests riêng, không cộng vào bằng chứng Backend/ML thật |
| Runtime dependencies | npm audit --omit=dev: 0 vulnerabilities tại thời điểm kiểm tra; không tuyên bố toàn bộ dev toolchain không có cảnh báo |

File kiểm thử chính: [import unit](../../server/tests/import.test.ts), [B3 integration](../../server/tests/b3.integration.test.ts), [child crash fixture](../../server/tests/fixtures/b3-worker.ts), [B3 browser](../../server/e2e/b3.spec.ts), [schema/index contract](../../server/tests/contract.test.ts). Temp cleanup có kiểm tra root trước recursive remove; không xóa DB/nguồn bên ngoài fixture. Fault hooks chỉ là DI cho test, main không bật và không có HTTP fault endpoint.

Lượt full coverage ban đầu bị timeout test 5.000 rows khi chạy cùng nhiều browser; điều chỉnh timeout harness lên 60 giây và chạy riêng đã đạt, Backend deadline vẫn 120 giây. Test UI cũ được cập nhật theo thông báo D012, test transport làm nóng indexes trước đo deadline ngắn. Không thay production limit hoặc chuyển sang mock để pass.

Coverage tính src/** trừ main.ts; scripts/child-process không được coi là coverage production. Xem `server/coverage/` gitignored. Chưa nghiệm thu NFR/performance dataset lớn, 500.000 readings, RAM/CPU peak, multi-node failover, proxy/TLS hoặc Sync.

## Bàn giao và phần còn lại

- **Khiêm/Backend:** bốn handlers, schema/service/repository/source streams, D012 receipts/indexes/recovery, tests và tài liệu đã có. B3 hoàn thành implementation/local verification; không tính B4 gate là đã đạt.
- **Tài/Frontend:** chọn online mode để dùng API thật. Nhãn validation, report sau PUT, giữ key và retry có chủ đích đã nối. Cần review/chạy thủ công trên môi trường nhóm; không suy ra review cá nhân của Tài đã xảy ra từ test tự động.
- **Khải:** không cần detector để hoàn tất import; B3 chỉ chuẩn hóa/lưu dữ liệu hợp đồng. Statistical/ML, features/model/config/severity thuộc B5, vẫn chờ các quyết định riêng.
- **Cường:** dựng replica set/volume persistent, cùng vòng đời DB + source, backup/quyền ghi/dung lượng, proxy body size có multipart overhead, timeout lớn hơn Backend, smoke restart và CI. Hạn mức mỗi process không phải global cluster admission. Chưa triển khai Docker/Nginx/TLS/HA ở B3.
- **B4/B8:** query gate cho non-imported trên mọi đường đọc và kiểm thử xuyên import → query; full online flow/engine và stress/performance còn chờ. Không thêm API hoặc đóng quyết định kỹ thuật của các mốc đó trong B3.

Tham khảo triển khai: [Fastify multipart streams/limits](https://github.com/fastify/fastify-multipart), [CSV parser options](https://csv.js.org/parse/options/), [Node stream pipeline](https://nodejs.org/api/stream.html#streampipelinesource-transforms-destination-callback), [MongoDB driver transactions](https://www.mongodb.com/docs/drivers/node/current/crud/transactions/). Tài liệu tham khảo không thay quyết định D012 hoặc bằng chứng kiểm thử thực tế.
