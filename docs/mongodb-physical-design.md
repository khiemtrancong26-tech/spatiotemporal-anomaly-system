# MongoDB Physical Database Design — SDD v0.3

**Nguồn yêu cầu:** SRS v0.4 (PM2.5, BR-08 phương án B, analyst/admin, BR-15..22) và Shared Data Contract v0.1.  
**Trạng thái:** Thiết kế vật lý **đề xuất cho MVP**, cần Khiêm review trước khi triển khai database chính thức. `indexes.js` là script tạo index gợi ý, **không phải migration đã chạy**.  
**DB:** `spatiotemporal_anomaly` (tên đề xuất), MongoDB. **7 collections lõi:** `users`, `datasets`, `sensors`, `readings`, `analysisRuns`, `anomalies`, `processedMutations`.

## Bổ sung B3 đã triển khai — D012, 14/11/2026

Phần này cập nhật các đề xuất import/receipt cũ bên dưới theo [D012](decisions.md#d012--import-b3-và-durable-idempotency); không thay HTTP/DTO. Có thêm collection nội bộ `idempotencyReceipts`: tổng thiết kế 8 collections, trong đó 7 thuộc online và `processedMutations` vẫn hoãn. Script online hiện có 13 indexes ngoài `_id`.

- Dataset lưu private `source:{fileId,format,checksum,bytes}`, `validationReport`, `fieldMapping`, `sourceUnit`, `mappingVersion`, `mappingConfirmed`, tùy lỗi `mappingError`. File ID do Backend sinh, không nhận path từ HTTP. Nguồn đã tiếp nhận lưu persistent ngoài MongoDB, P0 không tự xóa; không có API tải/xóa báo cáo nguồn.
- Lifecycle thực tế: upload thành công tạo `awaiting_mapping`; PUT mapping hợp lệ giữ trạng thái đó, invalid toàn bộ/tọa độ bất nhất/report vượt hạn mức chuyển `failed`; CAS mapping/version chuyển `importing`; publish sau đủ persistence → `imported`. Failure sau ghi batch chỉ chuyển `failed` sau cleanup có fencing. Mất DB trong cleanup giữ `importing` và receipt processing cho recovery. Imported không sửa mapping/nhập lại.
- Trong importing có private `importAttemptId` (owner UUID), `importReceiptId`, `batchRevision`. Sensor/Reading có private attempt marker; Reading có `sourceRowNumber` để lưu winner BR-08 qua nhiều batch. PM2.5 ghi BSON Double, thời gian BSON Date/UTC mili-giây, reading location snapshot `[longitude,latitude]` từ tọa độ đã kiểm tra. Dòng invalid không tham gia chọn winner hoặc kiểm tra bất nhất trạm.
- Report tối đa 1.000 issues theo D012. Nhiều trường sai có thể tạo nhiều issues cho một dòng, nhưng `invalidRows` chỉ tăng một lần. Vượt hạn mức → 422/failed, không truncate rồi báo imported; failed preview có giới hạn. Không triển khai file báo cáo đầy đủ hoặc API phân trang/download mới.
- `idempotencyReceipts`: `_id`, `userId:ObjectId`, `key:UUID string`, `operation`, `requestHash`, `resourceId`, `kind`, `owner`, `status:processing|completed|failed`, `createdAt`, `expiresAt`, `leaseUntil`, tùy kết quả `response:{statusCode,body}`. Unique `{userId:1,key:1}` và recovery `{status:1,leaseUntil:1}`; **không TTL**, không Redis/processedMutations.
- Replica set là điều kiện B3. Upload metadata + receipt 201, hoặc Dataset imported + receipt 200, chốt cùng transaction snapshot/majority. Mỗi batch và cleanup batch có transaction riêng, khóa receipt + Dataset; không dùng transaction toàn file. Recovery chỉ tiếp quản receipt hết lease và chỉ dọn attempt có cùng receipt ID; receipt bỏ dở trước start CAS không được dọn attempt khác.
- Replay 24 giờ, key quá hạn vẫn giữ và trả 409; snapshot cũ không đổi theo Dataset mới. Chi tiết restart, file thất lạc, admission và retry trong [B3 verification](backend/b3-verification.md).


## 1. Nguyên tắc vật lý

1. `_id` và các foreign keys dùng **BSON ObjectId** trong DB. API chuyển thành ID chuỗi opaque (hex ObjectId trong implementation dự kiến), không trả BSON hoặc `_id` ra Client.
2. Thời điểm trong DB là **BSON Date UTC**, API trả ISO 8601 `Z`; `timestamp` là tên cột nguồn, sau normalize thành `ts`.
3. Điểm địa lý là GeoJSON `{type:'Point',coordinates:[lon,lat]}` theo WGS84. `Reading.location` và `Anomaly.location` là **denormalized snapshot** của vị trí Sensor tại lúc nhập/phân tích. Vì Sensor cố định, Backend phải đảm bảo cùng tọa độ, không cho sửa vị trí tùy tiện.
4. `Sensor.externalId` là mã trạm từ file; `Reading.sensorId` là ObjectId của Sensor. Trong cùng dataset, một externalId chỉ trỏ tới một Sensor; không map theo tên ngoài mà thiếu datasetId.
5. **Không nhúng toàn bộ readings vào Sensor hoặc Dataset**; lưu `readings` collection riêng để không phình document và dễ đánh index time/geo.
6. Quan hệ liên collection được enforce ở **Backend**, MongoDB unique indexes chỉ đảm bảo duy nhất trong từng collection, không tự enforce FK như PostgreSQL.
7. Các field `createdAt`/`updatedAt` cần quy tắc rõ; review Anomaly bắt đầu `version:1`, cập nhật review tăng version. `passwordHash` chỉ nằm trong DB.
8. Không dùng bảng/collection Mongo để lưu PWA/IndexedDB. Local cache/outbox hoàn toàn do Client quản lý.

## 2. Collections và document mẫu (minh họa bằng Extended JSON mang tính gần đúng)

### `users`
```js
{ _id: ObjectId('...'), username: 'analyst01', usernameNormalized: 'analyst01',
  passwordHash: '<hash>', role: 'analyst', isActive: true,
  createdAt: ISODate('2026-11-11T01:00:00Z') }
```
- Unique `usernameNormalized`; theo D011/B2: `username.trim().toLowerCase()` cho lookup/unique, username public giữ cách viết sau trim. Register/CLI/future Admin dùng chung User service. `admin` là Application Admin, không có quyền SSH/Docker.
- Không trả passwordHash trong bất kỳ response.

### `datasets`
```js
{ _id: ObjectId('...'), name: 'PM2.5 Example', sourceFilename: 'demo.csv',
  status: 'imported', createdBy: ObjectId('...'), createdAt: ISODate('2026-11-11T01:00:00Z'),
  fieldMapping: {sensorId:'station_id',latitude:'lat',longitude:'lon',timestamp:'observed_at',value:'pm25'},
  importSummary: {totalRows:2,importedRows:2,duplicateRows:0,conflictingRows:0,invalidRows:0,issues:[]},
  importAttemptId: 'opaque-attempt-id' }
```
- Trạng thái đề xuất `uploaded → awaiting_mapping → importing → imported`, hoặc `failed`; đóng băng theo dataset import. API list chỉ trả `imported`.
- Upload lưu file nguồn vào nơi an toàn ngoài MongoDB, **không giả định file là field Blob trong collection**. Có thể dùng storage path + checksum nội bộ. Nếu server restart, yêu cầu file tạm phải còn hoặc đánh dấu failed. Xóa file tạm theo chính sách retention được chốt sau.
- `importSummary.issues` có thể rất lớn; tránh lưu mảng hàng trăm nghìn lỗi vào một document. **Giữ số đếm + preview giới hạn**, lưu báo cáo đầy đủ ở file/object storage (nếu cần), trả trang qua API sau. OPEN-05 chưa chốt hạn mức.

### `sensors`
```js
{ _id: ObjectId('...'), datasetId: ObjectId('...'), externalId:'S01',
  name:'Station S01', location:{type:'Point',coordinates:[106.7009,10.7769]},
  type:'pm25',unit:'ug/m3',region:'Demo' }
```
- Unique `(datasetId,externalId)`. Trạm cố định: nếu cùng externalId mà tọa độ nguồn thay đổi thì **báo lỗi/đánh dấu cần review**, không di chuyển tọa độ ngầm; chi tiết NEW-01 chưa chốt.

### `readings`
```js
{ _id: ObjectId('...'), datasetId: ObjectId('...'), sensorId: ObjectId('...'),
  ts: ISODate('2026-11-11T01:00:00Z'),
  location: {type:'Point',coordinates:[106.7009,10.7769]},
  value:25.5, unit:'ug/m3' }
```
- Unique `(datasetId,sensorId,ts)` để enforce BR-08 sau normalize timezone. `value` BSON Double hữu hạn, ≥0; quyết định số học ở tầng schema.
- Dư `location` để GET readings lọc theo bbox và trả DTO trực tiếp; chỉ insert từ Sensor.location chuẩn. Tránh rải tọa độ trạm theo các rows khác nhau.

### `analysisRuns`
```js
{ _id:ObjectId('...'), datasetId:ObjectId('...'),family:'statistical',method:'zscore',
  config:{threshold:3},scope:{},status:'completed',createdAt:ISODate('2026-11-11T02:00:00Z'),
  completedAt:ISODate('2026-11-11T02:00:03Z'),engineVersion:'0.1.0' }
```
- Lưu config, scope tiếp nhận, method/version; ML model/feature còn OPEN-03. Analysis dùng `queued/running/completed/failed` theo D008. Metadata lỗi terminal theo Shared Contract. Chưa chốt cơ chế queue/receipt/recovery vật lý, không tự thêm collection/index/Redis.
- Chỉ công bố anomalies của run completed sau persist đầy đủ; failed không lộ partial. Cách staging/cleanup, claim/lease/recovery và atomicity tiếp nhận + receipt cần thiết kế trước B5; không suy ra transaction khổng lồ hoặc exactly-once execution.

### `anomalies`
```js
{ _id:ObjectId('...'), datasetId:ObjectId('...'),sensorId:ObjectId('...'),
  readingId:ObjectId('...'),analysisRunId:ObjectId('...'),
  ts:ISODate('2026-11-11T01:00:00Z'),
  location:{type:'Point',coordinates:[106.7009,10.7769]},
  family:'statistical',method:'zscore',score:3.8,severity:'high',
  status:'open',note:'',version:1,updatedAt:ISODate('2026-11-11T02:00:03Z') }
```
- Unique `(analysisRunId,readingId)` ngăn tạo 2 anomaly cho cùng reading trong **một lần chạy**; vẫn cho một reading xuất hiện ở các lần chạy khác nhau.
- `score` và `severity` không đổi khi analyst sửa review; `status/note/version/updatedAt` có thể đổi.
- `severity` vẫn chờ OPEN-04 (score → severity). Đừng dùng ví dụ `score 3.8/high` làm ngưỡng chuẩn.

### `processedMutations`
```js
{ _id:ObjectId('...'), clientMutationId:'uuid-from-client',
  userId:ObjectId('...'), anomalyId:ObjectId('...'),requestHash:'sha256:...',
  result:{outcome:'applied',anomalyVersion:2},processedAt:ISODate('2026-11-11T02:10:00Z') }
```
- Unique `clientMutationId`; một mutation ID không được đổi nội dung request giữa các lần retry.
- Không TTL theo mặc định: cần giữ bản ghi ít nhất bằng khoảng retry hỗ trợ, nếu xóa sớm sẽ có nguy cơ áp dụng lại thao tác cũ. Retention policy cần chốt trước khi xóa.

## 3. Danh sách index ưu tiên

Script tương ứng: [`../infra/mongo/indexes.js`](../infra/mongo/indexes.js) (tính từ thư mục gốc Monorepo: `infra/mongo/indexes.js`).

| Collection | Index | Lý do |
|---|---|---|
| `users` | `{usernameNormalized:1}` **UNIQUE** | Đăng nhập / tránh trùng username |
| `datasets` | `{status:1,createdAt:-1,_id:-1}` | List dataset imported |
| `sensors` | `{datasetId:1,externalId:1}` **UNIQUE** | Xác định Sensor theo mã trạm trong dataset |
| `sensors` | `{datasetId:1,location:'2dsphere'}` | Lọc trạm theo bbox |
| `readings` | `{datasetId:1,sensorId:1,ts:1}` **UNIQUE** | BR-08; theo trạm và thời gian |
| `readings` | `{datasetId:1,ts:1,_id:1}` | Cursor paging theo thời gian toàn dataset |
| `readings` | `{datasetId:1,location:'2dsphere'}` | Lọc readings theo vùng khi đã denormalize location |
| `analysisRuns` | `{datasetId:1,createdAt:-1,_id:-1}` | Lịch sử phân tích |
| `anomalies` | `{analysisRunId:1,readingId:1}` **UNIQUE** | Chống trùng trong cùng run |
| `anomalies` | `{datasetId:1,ts:1,_id:1}` | Query anomalies theo dataset/time |
| `anomalies` | `{updatedAt:1,_id:1}` | Sync pull review (thiết kế tạm) |
| `anomalies` | `{datasetId:1,status:1,ts:1}` | Lọc theo status |
| `processedMutations` | `{clientMutationId:1}` **UNIQUE** | Chống retry trùng |

Index 2dsphere cho GeoJSON được MongoDB hỗ trợ. Các index time/geo là điểm bắt đầu; kiểm tra `explain('executionStats')` và cân nhắc tài nguyên ghi/đọc trước khi thêm index mới. Không cần tạo sharding cho 100k–500k readings.  
**Nguồn MongoDB:** https://www.mongodb.com/docs/manual/core/indexes/index-types/geospatial/2dsphere/ ; https://www.mongodb.com/docs/manual/core/indexes/index-types/index-compound/create-compound-index/

## 4. Bảo đảm BR-08 khi Import 100k–500k readings

**Không dùng một transaction duy nhất cho toàn bộ file lớn.** MongoDB hỗ trợ bulkWrite và có transaction nhiều document nhưng transaction khổng lồ sẽ tăng chi phí, rủi ro timeout. Dùng workflow trạng thái + visibility gate:

1. Upload file, tạo Dataset `uploaded` hoặc `awaiting_mapping`.
2. Parse/validate mapping; chuyển `importing` bằng compare-and-set, gắn `importAttemptId` để tránh 2 import chạy cùng lúc.
3. Chuẩn hóa theo **thứ tự dòng của file**, kiểm tra invalid trước rồi dedup. Giữ **first valid row**, ghi lý do bỏ `DUPLICATE_SAME_VALUE` hay `DUPLICATE_VALUE_CONFLICT`, số dòng gốc. Chuẩn hóa timestamp/đơn vị trước khi so trùng.
4. Tạo sensors theo unique key; chuyển `externalId` sang ObjectId nội bộ; insert readings theo các batch **tuần tự theo thứ tự dòng**, hoặc pre-dedup bằng staging có ghi lại thứ tự. **Không dùng unordered bulk upsert cạnh tranh để chọn winner**, vì có thể vi phạm “dòng hợp lệ đầu tiên thắng”. Unique index ở DB là hàng rào cuối chống race.
5. Khi mọi batch import và báo cáo hoàn tất, đặt Dataset `imported` **sau cùng**. Mọi API query chỉ công bố readings của Dataset `imported` (Backend phải kiểm tra parent Dataset, không chỉ lọc readings đơn lẻ).
6. Nếu lỗi giữa chừng: đặt Dataset `failed` (không public), cleanup readings/sensors theo dataset trước khi retry; khi retry, phải tái lập lại quy tắc first valid row dựa trên **toàn bộ file gốc**, không tự giữ dữ liệu partial của attempt cũ.
7. Nếu Client gọi import lại Dataset đã `imported`, không tạo đọc trùng; API có thể trả trạng thái thành công hiện tại hoặc báo `409` theo contract được chốt.

**Cảnh báo:** Unique index chỉ đảm bảo không trùng; tự nó không bảo đảm “first valid row wins” hay báo được `keptRowNumber`. Dedupe + report vẫn là nghiệp vụ ở Backend.  
**Nguồn MongoDB:** https://www.mongodb.com/docs/manual/reference/method/db.collection.bulkWrite/ ; https://www.mongodb.com/docs/manual/core/transactions/

## 5. BR-15/16/17: optimistic concurrency và idempotent sync

- PATCH online: `updateOne({ _id, version:baseVersion }, {$set:{status?,note?,updatedAt:new Date()},$inc:{version:1}})`; nếu `matchedCount=0`, kiểm tra object có còn tồn tại không rồi trả `404` hoặc `409` kèm currentVersion.
- Offline: **mỗi mutation chạy trong một MongoDB transaction** gồm (a) kiểm tra/ghi receipt unique `clientMutationId`, (b) conditional update anomaly với `baseVersion` và (c) lưu kết quả receipt. Commit cùng nhau, rồi ack. Retry cùng ID + cùng requestHash → trả receipt cũ; retry cùng ID + nội dung khác → `409`. Stale version → kết quả `conflict` không sửa anomaly, vẫn ghi receipt conflict để retry trả ổn định.
- **Điều kiện hạ tầng:** MongoDB phải chạy trong **replica set**, tối thiểu single-node replica set cho môi trường Docker demo/test, nếu dùng multi-document transactions. **Không được giả định MongoDB standalone hỗ trợ được kiểu transaction này.** Cường phải chuẩn bị Compose và smoke test transaction.
- Khi ghi data từ Client, validate role `analyst/admin`, JWT, anomaly ID đã tồn tại, baseVersion, payload chỉ status/note.
- Sync pull v0.1 theo `updatedAt` + ID và cursor. Đây là mẫu đơn giản để khởi động; nếu có biến động đồng thời trong lúc phân trang cần kiểm thử chồng lấn timestamp/checkpoint, tránh bỏ sót. Chưa cam kết khả năng sync như hệ thống production nếu chưa kiểm chứng.

Nguồn MongoDB về transaction và atomicity: https://www.mongodb.com/docs/manual/core/transactions/ ; https://www.mongodb.com/docs/manual/core/write-operations-atomicity/

## 6. Các truy vấn chủ lực & ánh xạ API

| API | Điều kiện Backend | Index sử dụng dự kiến |
|---|---|---|
| GET `/api/datasets` | `status:'imported'` | datasets status/createdAt |
| GET `/api/sensors` | `datasetId`, optional `$geoWithin` bbox | sensors datasetId/2dsphere |
| GET `/api/readings` | `datasetId`, optional sensorId, ts range, bbox; parent dataset imported | readings unique/time/geo; explain lọc hỗn hợp |
| GET `/api/anomalies` | dataset, family/method/status/severity/time | anomalies dataset/time, dataset/status/time |
| GET `/api/analysis/runs` | dataset, sort by createdAt | analysisRuns dataset/createdAt |
| GET `/api/sync/pull` | updatedAt keyset; later revision if needed | anomalies updatedAt/id |
| POST `/api/sync/push` | receipt unique + CAS review | processedMutations unique + anomaly `_id` |

**Truy vấn tổng hợp P1:** Aggregation Pipeline để bucket theo thời gian/khu vực và LOD; đo kết quả thực tế trước khi cache/Redis. No Redis requirement in MVP.

## 7. Kiểm thử tối thiểu cho bước DB

1. Duplicate trong cùng file, khác file/cùng dataset, và import retry: đúng BR-08; **first valid row wins**; `value=0` là hợp lệ.
2. Hai timestamp offset khác nhau nhưng cùng UTC bị coi là trùng; GeoJSON `[lon,lat]` không đảo.
3. Hai Dataset khác nhau vẫn được phép cùng externalId/ts.
4. Import lỗi giữa chừng: không để Data API đọc được partial Dataset; retry sạch rồi thành imported.
5. Trong 2 client review cùng anomaly version=1: chỉ một update thành công; client còn lại nhận conflict, không mất update.
6. Retry cùng mutation ID nhiều lần kể cả server commit rồi mạng mất: chỉ một lần tăng version, receipt trả thống nhất.
7. Client gửi cùng ID nhưng khác payload bị từ chối; một mutation bị conflict không ảnh hưởng các mutation khác trong cùng batch.
8. explain('executionStats') cho truy vấn dataset/time + bbox trên 100k/500k readings; ghi rõ thời gian và số docs examined.
9. Không có passwordHash trong API output; analyst bị cấm API quản trị tài khoản.
10. Dữ liệu fake cho performance không được giới thiệu là dữ liệu quan sát thật.

## 8. Quyết định chưa chốt / cần phân quyền chủ sở hữu

| Decision | Người cần tham gia | Trước khi triển khai |
|---|---|---|
| OPEN-02 timezone input thiếu offset | Khiêm + Tài | Mapping validator |
| OPEN-03 model ML, input features | Khải + Khiêm | ML integration |
| OPEN-04 mapping severity, config | Khải + Khiêm + Tài | Kết quả detection |
| OPEN-05 file size/batch/report limits | Khiêm + Cường | Upload/bulk and perf |
| OPEN-06 / D008 execution & recovery | Khiêm + Tài + Cường | Async đã chốt; cơ chế lưu/claim/restart/retention còn mở trước B5 |
| NEW-01 trạm đổi tọa độ cùng externalId | Khiêm | Import dữ liệu nguồn |
| NEW-02 Dataset/Run status enums | Khiêm + Khải + Tài | Khóa shared schemas |
| NEW-04 incremental sync consistency | Duy + Khiêm | Khóa sync protocol |

**Điểm tối thiểu cần thống nhất ngay:** Sử dụng MongoDB replica-set cho sync transactions, giao diện DTO không trả Mongo `_id`, và API không công bố Dataset nhập dở. Các thông số performance còn chờ phép đo.
