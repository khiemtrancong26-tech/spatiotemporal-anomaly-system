# C2 — Đề xuất khóa contract Data Exploration

Ngày: 16/11/2026. **Chủ dự án đã duyệt cả ba nhóm A/B/C trong chat triển khai C2. Đây là contract đã khóa theo D018; trạng thái implementation/kiểm thử được báo riêng trong C2 verification.**

Căn cứ: [Change Plan](../backend-change-plan.md), D016 và C2/CR-02–05. Hướng triển khai C2 đã được giao; các lựa chọn dưới đây cần chốt vì làm thay đổi API hoặc chính sách còn mở. Không mở C3, B7, Offline/Sync hay spatial LOD.

## 1. Phạm vi API và compatibility — nhóm quyết định A

- Thêm đúng một API đọc: `GET /api/v1/datasets/{id}/profile`.
- Nâng draft `GET /api/v1/reading-aggregates` thành API online cho tổng hợp thời gian theo trạm. Không thêm endpoint aggregation thứ hai.
- Cả hai dùng quyền analyst/admin, chỉ đọc dataset imported, không cache/materialize ở C2. Giữ nguyên DTO Dataset/Reading/Sensor/AnalysisRun/Anomaly, API import và cơ chế worker B5.
- Profile nhận `sensorIds`, `bbox`, `from`, `to` tùy chọn. Aggregates nhận cùng filter, bắt buộc `datasetId`, `from`, `to`, `bucket=hour|day`; `timeZone` tùy chọn theo nhóm B. Không có cursor/sort/limit cho hai API mới này: trả toàn bộ kết quả trong ngân sách hoặc lỗi rõ ràng.
- `sensorIds` là array query theo OpenAPI `style: form, explode: true`: `sensorIds=a&sensorIds=b`. Không tách opaque ID bằng dấu phẩy. Tập ID rỗng, trùng hoặc không thuộc dataset bị từ chối; giới hạn ID đầu vào 10.000. Bbox giữ semantics D013, kết hợp AND với sensorIds/time.
- Thời gian request giữ D013: UTC Z, tối đa 3 số lẻ, khoảng đóng `[from,to]`, không làm tròn. Profile cho phép thiếu một/hai đầu; aggregation phải có đủ hai đầu.
- Chuẩn lỗi: 400 sai schema; 401/403 xác thực/quyền; 422 dataset không tồn tại/chưa imported, trạm không thuộc dataset, filter/budget không hợp lệ; 503 bận hoặc hết deadline; 500 lỗi bất ngờ. Dùng Error envelope hiện tại. Không thêm 404/409 vào hai API này. Chưa cấu hình cadence không phải lỗi request.

### Payload Profile đề xuất

Envelope `{data: DatasetProfile}` với các trường bắt buộc:

| Trường | Ý nghĩa |
|---|---|
| `datasetId` | ID opaque hiện tại |
| `scope` | Filter đã chuẩn hóa, `sensorIds`/bbox/from/to vắng được biểu diễn `null`; không nhầm scope với trang đã tải |
| `metadata` | Chính sách timezone/sampling và nguồn cấu hình theo nhóm B |
| `dataset` | Summary toàn dataset imported |
| `scoped` | Summary sau filter |
| `sourceQuality` | Các count từ importSummary, hoặc unknown; không suy ra từ trang readings |
| `complete` | Luôn `true` khi 200; không trả profile partial |

Summary gồm `readingCount`, `sensorCount` (số trạm thuộc tập được xét, kể cả trạm không có reading trong khoảng), `sensorsWithReadings`, `observedFrom`, `observedTo`, `min`, `max`, `mean`, `coverage`. Bounds/min/max/mean là `null` khi không có reading. Thông tin từng trạm tiếp tục lấy qua GET sensors phân trang; không nhét một danh sách không giới hạn vào Profile.

`sourceQuality` gồm `status: known|unknown`, `totalRows`, `importedRows`, `invalidRows`, `duplicateRows`, `conflictingRows`, `missingValueRows`, `reason`. Các số có thể `null` khi không có bằng chứng. Với import B3, năm count đầu lấy từ importSummary; `missingValueRows=null`, reason giải thích report hiện có không phân loại đầy đủ thiếu giá trị nguồn. Không đồng nhất invalidRows, missingValueRows và missing station–time.

### Payload Aggregates đề xuất

Envelope `{data: ReadingAggregation}` với `datasetId`, scope chuẩn hóa, `bucket`, `timeZone`, `metadataVersion` (null nếu chưa cấu hình), `series`, `complete: true`.

- Mỗi series: `sensorId`, `buckets` theo thời gian tăng dần. ID dùng để nối Sensor hiện có; không dùng centroid/location làm danh tính trạm.
- Mỗi bucket: `start`, `end` UTC (ranh giới bucket đầy đủ, khoảng nửa mở `[start,end)`), `count`, `min`, `max`, `mean`, `coverage`.
- Query vẫn là khoảng đóng; reading đúng `to` thuộc bucket chứa nó. Các bucket giao khoảng query đều được trả, kể cả bucket rỗng/đầu-cuối bị cắt bởi scope. Count/mean chỉ dùng readings trong scope, coverage chỉ dùng slots trong scope.
- Bucket rỗng: count=0, min/max/mean=null; không nội suy/carry-forward. Series các trạm dùng cùng bộ bucket để so sánh.
- Mean là trung bình số học các reading thực có trong bucket, đơn vị ug/m3; không phải trung bình của các trung bình và không bù giờ thiếu. Đây là derived aggregate, không phải Reading.
- Thay response draft `AggregatePage/AggregatedReading` trên operation này bằng DTO mới. Đây là migration của API P1 chưa triển khai, **không coi là thay đổi tương thích với parser strict cũ**. Giữ schema cũ nếu còn consumer; cập nhật OpenAPI/shared-core, generator allowlist, generated wire, query-array serializer, online/mock adapters và tests đồng bộ. Kiểm tra không đổi 20 operations online cũ.

## 2. Timezone, cadence và coverage — nhóm quyết định B

Đề xuất phạm vi timezone ban đầu: **`UTC`, `+07:00`, `+08:00`** (offset cố định, không DST). IANA/DST tổng quát hoãn, không tự thêm thư viện timezone.

- DB/wire luôn UTC. Timezone chỉ xác định hiển thị và ranh giới bucket; không gán lại offset cho instant đã import.
- Metadata dataset lưu riêng dưới field nội bộ `explorationMetadata`, không thêm vào DTO Dataset/MappingRequest strict hiện tại. Profile công bố metadata bằng DTO mới.
- Cấu hình qua CLI có xác thực cấu hình, chỉ sửa metadata của dataset imported được chỉ định; không thêm HTTP ghi metadata. CLI không sửa readings, run, model, receipt hay review. Cấu hình gồm timezone, provenance ghi chú; sampling nếu có gồm cadenceSeconds nguyên dương, anchor UTC, expectedFrom/expectedTo UTC đóng. Sampling được cấu hình đủ bộ hoặc unknown.
- Không tự suy timezone/cadence từ tên file, timestamps đã tải hoặc khoảng cách trung vị. Dataset chưa cấu hình: giữ fallback hiển thị `+07:00` để không đổi hành vi FE cũ, có nhãn fallback; coverage unknown.
- Cho chọn timezone hiển thị trong workspace giữa ba lựa chọn; filter datetime-local, Map/Cube/timeline/tooltip/bảng dùng chung lựa chọn. Aggregation gửi lựa chọn đó. Mặc định theo metadata, nếu chưa có thì fallback trên. Đổi timezone giữ nguyên instant của filter, không diễn giải lại thời gian cũ.
- Giờ/ngày theo offset được chọn: hour bắt đầu HH:00; day bắt đầu 00:00. Ranh giới trả về UTC. Không thay ngày thành cửa sổ trượt 24h từ `from`.
- Golden Beijing được cấu hình **tường minh**: timezone `+08:00`, cadence=3600s, anchor/expectedFrom=`2015-02-28T16:00:00.000Z`, expectedTo=`2015-03-31T15:00:00.000Z`, provenance tham chiếu manifest/hash. Không tự cấu hình dataset khác trùng tên. Không sửa DB người dùng trong kiểm thử.

### Coverage chung cho summary/bucket

`{status, expectedSlots, observedSlots, missingSlots, unexpectedReadings, ratio, reason}`; status=`known|unknown|not_applicable`.

- Lưới `anchor + k*cadenceSeconds`, k nguyên, giới hạn trong expectedFrom/expectedTo đóng, sau đó giao scope thời gian và bucket nếu có. Denominator là số slots × số trạm được chọn. Không dùng số reading FE đã tải làm denominator.
- Trạm được chọn theo metadata Sensor của dataset và sensorIds/bbox (bbox kiểm tọa độ Sensor). C2 xét readings thuộc tập trạm đã chọn, đồng thời vẫn kiểm tọa độ snapshot của Reading theo D013. Nếu snapshot lệch vị trí, không tự chuyển reading sang trạm khác hoặc sửa tọa độ. Khi có drift do sửa DB ngoài API, tập readings C2 có thể khác truy vấn B4 chỉ dùng bbox; test và tài liệu phải nêu rõ phép giao này.
- observedSlots chỉ đếm station–time có reading đúng lưới và đúng expected interval; mỗi slot tối đa một lần. missingSlots=expectedSlots−observedSlots; ratio=observedSlots/expectedSlots. Reading ngoài lưới/ngoài expected interval được đếm riêng unexpectedReadings, không bù slot thiếu.
- Thiếu cấu hình sampling: unknown, các số/ratio `null` với reason. ExpectedSlots=0: not_applicable, observedSlots=0, missingSlots=0, ratio=null; reading trong scope nhưng không thuộc lưới vẫn là unexpectedReadings. Không đổi unknown thành 0.
- Có cấu hình, có expectedSlots nhưng bucket không có mẫu: known, observedSlots=0, missingSlots=expectedSlots, ratio=0.
- Áp dụng tập trạm cố định của dataset; C2 chưa thêm lifecycle trạm hoạt động/ngừng hoạt động. Metadata version được đọc một lần cho mỗi operation và đưa vào metadata response để giải thích kết quả khi CLI thay cấu hình.

## 3. Ngân sách và bàn giao — nhóm quyết định C

Các số sau là cấu hình ban đầu có env, **chưa phải benchmark đã đạt**, không thay limit B3/B4/B5:

| Ngân sách | Đề xuất |
|---|---|
| Reading đầu vào | Tối đa 500.000/dataset cho Profile; tối đa 500.000 matching readings cho Aggregates; vượt trả 422 |
| Trạm Aggregates | Tối đa 20 trạm sau chọn sensorIds/bbox; nếu chọn tất cả vượt mức thì 422, yêu cầu thu hẹp |
| Khoảng Aggregates | `to-from` tối đa 31×24h cho hour, 366×24h cho day |
| Tổng cells | Tối đa 20.000 cặp series×bucket, kể cả bucket rỗng; kiểm trước tạo matrix |
| Response | Tối đa 5 MiB JSON mỗi response; vượt 422, không cắt |
| Deadline | 5 giây cho toàn operation, Mongo maxTimeMS theo thời gian còn lại; hết hạn 503 |
| Đồng thời | Tối đa 2 operations Profile/Aggregates đang chạy mỗi process; không xếp hàng vô hạn, đầy trả 503 |

Triển khai theo Route → Validation → Service → Repository → MongoDB. Aggregation phía MongoDB; không tải toàn dataset về FE, không dùng giới hạn raw-reading 2.000 của Cube để tính Profile/mean. Dừng/cancel DB work khi deadline hoặc client abort; không giữ slot concurrency đến vô hạn. Không thêm collection cache, Redis/BullMQ hoặc worker mới.

Handoff C2a rồi C2b kèm online adapter và UI thật. Mock mới phải có nhãn demo, không tự fallback mock khi API thật lỗi; phần chưa triển khai hiển thị unavailable. FE tách tổng dataset, scope Server và raw readings đã tải; chart aggregate không bị trình bày như readings raw đã tải hết.

Phân công giữ ownership hiện có: Khiêm chịu Backend/contract/metadata CLI, Tài chịu FE và parser/hiển thị timezone, Cường chịu môi trường Replica Set/kiểm thử vận hành/số đo; Khải review ý nghĩa dữ liệu/cadence khi cần, chưa có việc train hay sửa thuật toán/model trong C2. Việc Codex kiểm thử trong checkout không thay thế nghiệm thu riêng của các owner.

Kiểm thử bắt buộc: unit/contract drift; MongoDB Replica Set thật cho visibility/filter/empty/budget/deadline; golden độc lập 8.782/12/146 và event mean315,5; timezone/day-boundary/closed range/off-grid/unknown; scope vượt một trang; E2E API thật Profile → so sánh trạm → reload, hồi quy B1–B6; explain và số đo query/response/tài nguyên trước nghiệm thu. Báo cáo riêng số đo đã chạy, mock, phần chưa đạt; không nhận chất lượng ML/SLA ngoài C2.

## 4. Trạng thái phê duyệt

- A — API/payload/compatibility: đã duyệt.
- B — Timezone/metadata/coverage: đã duyệt.
- C — Ngân sách/vận hành/bàn giao: đã duyệt.

Phê duyệt này cho phép cập nhật OpenAPI/Shared Data Contract/SDD/physical design và triển khai phần phụ thuộc. Các lựa chọn ML v2 G04/G05 tiếp tục mở; G06 chỉ đóng phần cấu hình khởi đầu C2, chưa chứng minh tải/SLA hay cấu hình ML v2.
