# OFFLINE/SYNC MVP — PHẠM VI TRIỂN KHAI CHỐT CHO BUỔI BẢO VỆ

> **Dự án:** Xây dựng hệ thống phân tích và phát hiện bất thường trong dữ liệu không gian – thời gian bằng trực quan 3D  
> **Ngày chốt:** 18/11/2026 — **Mốc bảo vệ:** Thứ Năm, 19/11/2026  
> **Repository / nhánh duy nhất để đối chiếu:** `khiemtrancong26-tech/spatiotemporal-anomaly-system` / `khiem/backend-database`  
> **Mã nguồn tham chiếu tại thời điểm chốt:** `9fe0d1859040ea0f57c7359b379dae317c2ee682`  
> **Trạng thái tài liệu:** Phạm vi **dự kiến thực hiện**, **không phải xác nhận đã code/test xong**. Bản cập nhật: **loại bỏ chạy thuật toán thống kê khi offline**; vẫn sync cả `note` và `status` (18/11/2026).  
> **Nguyên tắc:** Chỉ bổ sung Offline/Sync ở mức cần thiết, giữ nguyên nghiệp vụ online đang hoạt động, không mở rộng ngoài phạm vi này.

## 1. Mục tiêu và một câu chốt phạm vi

Người dùng **đã từng đăng nhập thành công khi online** có thể mở lại phần ứng dụng đã được lưu, xem/lọc và trực quan **readings thực sự đã tải từ Server xuống trình duyệt và đã ghi thành công vào IndexedDB**; chỉnh sửa **`note` và/hoặc `status`** của **anomaly đã tồn tại trên Server và đã được tải về** trong lúc offline. Cả `note` và `status` (`open`, `confirmed`, `false_positive`) được lưu **bền vững vào Outbox trong IndexedDB**, sau đó **tự gửi lên Fastify/MongoDB** khi Server phục hồi và người dùng có xác thực hợp lệ. Không ghi đè khi xung đột và không áp dụng trùng khi gửi lại.

**Định nghĩa Offline trong phạm vi này:** Trình duyệt không truy cập được Backend API, bao gồm Backend ngừng hoạt động **hoặc mất Internet hoàn toàn**. Khi mất Internet hoàn toàn, sau khi đã cache app shell từ lần online trước, người dùng vẫn phải có thể **nhấn F5/đóng-mở tab** và khôi phục phần giao diện/dữ liệu đã lưu. Không cam kết tài nguyên Mapbox từ bên thứ ba.

**Phân biệt bắt buộc:**

- **Readings được cache** = readings đã **tải từ API về Client** và lưu cục bộ thành công; **không phải** toàn bộ readings trong dataset, cũng không phải file CSV vừa được upload lên Server.
- **Anomaly có thể ghi chú/sync** = anomaly đã có `id` và `version` do Backend cấp, đang thuộc dataset người dùng được phép truy cập, và đã cache cục bộ.
- **MongoDB** vẫn là nguồn dữ liệu nghiệp vụ chính; **IndexedDB** chỉ là bản sao/Outbox trên thiết bị Client.
- **Chỉ đồng bộ thay đổi `note` và/hoặc `status` của anomaly đã có trên Server**. Các readings, dataset, sensors và dữ liệu dựng hình 3D **không được push ngược về MongoDB**. Không chạy thuật toán thống kê hay ML mới khi offline.

## 2. Ma trận phạm vi — LÀM / KHÔNG LÀM

| Hạng mục | Quyết định | Giới hạn rõ ràng |
|---|---|---|
| Cache app shell (HTML/JS/CSS, tài nguyên cùng origin cần để khởi chạy) | **LÀM** | Service Worker + Cache Storage; app đã được khởi chạy/cài cache khi online ít nhất một lần |
| Tự động cache dữ liệu đã xem online | **LÀM** | IndexedDB lưu các phản hồi hợp lệ đã tải thành công, có phân vùng theo tài khoản |
| Mở lại/reload tab khi mất Backend | **LÀM** | Khôi phục giao diện offline, dataset/filter/tab và dữ liệu còn lưu; không giả vờ xác thực online thành công |
| Trực quan Three.js Space–Time Cube 3D | **LÀM** | Các chế độ có đủ dữ liệu cục bộ; chỉ những readings/anomalies đã cache; không đòi Server để render |
| Mapbox 3D | **GIỚI HẠN** | Hiển thị phần có sẵn nếu nền/tile/style đã tải; **không bảo đảm** nền đường, tòa nhà 3D, glyph hay tiles khi mất mạng; có đường chuyển sang Cube/bảng |
| Lọc trạm, thời gian, vùng dữ liệu đã cache | **LÀM** | Chỉ trong phạm vi đã lưu; không suy luận rằng toàn bộ dataset được cache |
| Chạy Z-score/IQR/Moving Average mới khi offline | **KHÔNG LÀM** | Các thuật toán thống kê **giữ nguyên online trên Backend**; không triển khai Browser Web Worker cho offline statistics |
| Xem anomaly Server đã tải về | **LÀM** | Giữ metadata/`id`/`version`/`status`/`note`, có phân vùng dataset và tài khoản |
| Sửa `note` và/hoặc `status` anomaly khi offline | **LÀM** | Chỉ anomaly có ID Server và version; status hợp lệ `open`/`confirmed`/`false_positive`; lưu Outbox bền vững trước khi báo thành công cục bộ |
| Tự động đồng bộ thay đổi review lên MongoDB khi có Backend | **LÀM** | Đồng bộ `note` và/hoặc `status` trong cùng mutation; kiểm tra xác thực, quyền, `baseVersion`, `clientMutationId`; không xử lý trùng |
| Xử lý xung đột review | **LÀM** | Hiển thị bản Client và bản Server (`note`, `status`), giữ bản nháp; không tự ghi đè hoặc âm thầm bỏ mutation |
| Cập nhật `status` khi offline | **LÀM** | Cùng luồng Outbox với `note`; không tạo cơ chế sync riêng; chỉ ba trạng thái đã có trong schema |
| Đồng bộ 2 chiều mọi thay đổi của các thiết bị | **KHÔNG LÀM** | Chỉ push các thay đổi review (`note`/`status`) đang chờ và GET lại anomaly liên quan khi cần; không xây change-feed tổng quát |
| Chủ động tải trước toàn bộ dataset / export offline | **KHÔNG LÀM** | Không triển khai `GET /exports` chỉ để demo; dữ liệu được auto-cache khi người dùng thực sự xem |
| Upload/validation/mapping/import khi offline | **KHÔNG LÀM** | Chỉ online |
| ML Isolation Forest khi offline | **KHÔNG LÀM** | Vẫn chỉ inference trên Server; không đem Python model xuống Browser |
| Chạy `POST /analysis-runs` khi offline | **KHÔNG LÀM** | Tab Analysis chỉ hỗ trợ tạo/chạy job khi Backend sẵn sàng; offline thông báo rõ chưa hỗ trợ chạy phân tích mới |
| Tạo anomaly mới từ phân tích offline | **KHÔNG LÀM** | Không chạy detector offline, không tạo local anomaly hoặc Server anomaly ID |
| Ghi chú anomaly chưa có trên Server | **KHÔNG LÀM** | Chỉ review anomaly Server đã tồn tại và có `id`/`version` được cache; không tạo anomaly mới từ tính toán offline |
| Offline cho trang Admin, đăng ký/đăng nhập/reset password | **KHÔNG LÀM** | Auth/admin vẫn cần Backend; offline chỉ sử dụng dữ liệu đã lưu của phiên đã xác thực trước đó |
| Lưu toàn bộ Mapbox tiles/3D buildings offline | **KHÔNG LÀM** | Không hứa Mapbox 3D nền đầy đủ |
| Redis/Kafka/BullMQ, microservice, thêm database server | **KHÔNG LÀM** | Giữ Modular Monolith và MongoDB Replica Set hiện có |
| Đồng bộ readings/sensors/datasets/analysisRuns lên Server | **KHÔNG LÀM** | Đây là dữ liệu đọc/cache, không phải mutation offline |

## 3. Phạm vi Frontend — điều kiện nghiệm thu

### 3.1. Tự động cache khi online

1. Khi HTTP trả dữ liệu đọc hợp lệ, tầng `dataSource`/cache tự ghi những dữ liệu cần cho luồng demo vào IndexedDB: thông tin dataset, sensors, **readings theo trang/phạm vi**, anomalies và metadata cần để hiển thị; **không ghi password, JWT hay thông tin bí mật vào cache dữ liệu**.
2. Lưu dữ liệu theo **`userId + datasetId`** (thêm `anomalyId/readingId` hoặc khóa tương ứng). Tuân thủ **D021 — Private Dataset Ownership**: analyst chỉ được xem cache của tài khoản mình; admin không được tự ý đưa cache riêng của tài khoản khác sang phiên khác.
3. Ghi lại phạm vi/metadata cache (**coverage**): dataset, sensor, khoảng thời gian, filter, các page thực sự đã lưu, trạng thái **đủ/trang một phần/thiếu**. Không suy ra độ đầy đủ chỉ từ số records hiện có.
4. Nếu HTTP tải xong nhưng IndexedDB ghi thất bại (quota, storage blocked, exception), **không đánh dấu offline-ready**. Khi mất mạng vẫn có thể dùng RAM hiện tại trong tab, nhưng không bảo đảm sau reload.
5. Không prefetch toàn bộ 100.000–500.000 readings. Chỉ auto-cache các trang đã tải thật; giới hạn dung lượng theo khả năng thiết bị và báo dữ liệu thiếu. Không dùng cache một trang rồi tuyên bố toàn dataset offline.

### 3.2. Mất mạng / Backend không phản hồi

1. Khi API không truy cập được, có thể dùng cache cục bộ cho luồng đọc đã được hỗ trợ. **Không chỉ dựa vào `navigator.onLine`**: máy có Internet nhưng Backend chết vẫn cần chế độ offline.
2. Hiển thị trạng thái rõ ràng: **Online / Offline (dữ liệu cục bộ) / Đang đồng bộ / Chờ đồng bộ / Xung đột / Lỗi**.
3. Nếu dataset hoặc phạm vi chưa từng cache, thông báo **“Chưa có dữ liệu được lưu để sử dụng offline”**; không hiện dữ liệu giả/mẫu thay thế.
4. Offline vẫn cho phép lọc/duyệt trong phạm vi đã lưu; nếu vùng/thời gian/trạm chưa đủ dữ liệu, báo thiếu, không kết luận kết quả đại diện toàn bộ tập.
5. **Three.js Space–Time Cube** tiếp tục render readings cục bộ bằng GPU Client. Các chế độ của Cube chỉ hoạt động khi dữ liệu tương ứng đã cache. Chức năng phụ thuộc Server phải bị vô hiệu hoặc có thông báo phù hợp.
6. Với Mapbox GL JS, dữ liệu PM2.5 đã cache vẫn tồn tại, nhưng style/tiles/buildings có thể thiếu; phải có **lối xem cục bộ không lệ thuộc Mapbox** (Cube hoặc bảng/biểu đồ). Không giả rằng Mapbox 3D hoạt động đầy đủ offline.

### 3.3. Phân tích trong chế độ offline — chỉ xem dữ liệu/kết quả đã lưu

- **Không triển khai tính toán thống kê offline.** Không xây Browser Web Worker để chạy Z-score, IQR, Moving Average; không thêm logic gọi `shared-core` để tạo kết quả phân tích mới trên Client.
- **Không chạy ML offline** và không gọi `POST /analysis-runs` nếu Backend không truy cập được. Khi người dùng thao tác “Chạy phân tích”, UI thông báo rõ **“Cần kết nối Backend để chạy phân tích mới”**; không âm thầm tạo run/anomaly giả.
- **Được xem kết quả/anomaly đã tạo online và thực sự được cache** nếu dữ liệu cần thiết đã có; đây là **xem lại**, không phải chạy thuật toán mới.
- **Giữ nguyên toàn bộ phân tích thống kê và ML online** đang chạy tại Backend; không sửa các detector hoặc luồng worker Server.

### 3.4. Review (`note` và `status`) offline và Outbox

- Cho sửa `note` và/hoặc `status` của anomaly Server đã cache; phải có `anomalyId`, `datasetId`, `baseVersion`, `userId`. `status` chỉ nhận `open`, `confirmed`, `false_positive`; validate như API online.
- Giao diện review offline tiếp tục cho chọn cả ba `status` và nhập `note` như online. Khi bấm **Lưu**, tạo **một mutation** chứa các trường thay đổi (ít nhất một trường), không tạo hai yêu cầu sync riêng cho cùng lần lưu. Giữ nguyên quyền review, không sửa `score`, `severity`, `method`.
- Khi người dùng bấm lưu offline, **ghi Outbox vào IndexedDB trước**, sau đó mới hiện **“Đã lưu trên thiết bị — chờ đồng bộ”**. Không hiện **“Server đã lưu”**.
- Mutation có mã UUID bền vững, payload cố định khi retry, ví dụ:

```json
{
  "clientMutationId": "a6f7147e-5d5b-4432-a034-cf4016f8c931",
  "userId": "<authenticated-user-id>",
  "datasetId": "<dataset-id>",
  "anomalyId": "<existing-server-anomaly-id>",
  "baseVersion": 2,
  "changes": { "status": "confirmed", "note": "PM2.5 tăng bất thường, cần kiểm tra." },
  "state": "pending"
}
```

- **Đây là mô hình bản ghi Outbox cục bộ**, không phải khẳng định JSON body API chính thức chứa `userId` hay `state`. **Backend suy ra user từ JWT**, không tin `userId` do Client gửi lên.
- Khi reload/đóng tab, mutation đang chờ vẫn tồn tại. Có thể hiển thị `note`/`status` local ngay, nhưng phải có nhãn chưa đồng bộ. Mutation chỉ thay đổi `note` hoặc chỉ `status` cũng hợp lệ.
- Không tự ý xóa mutation `pending`, `conflict` hoặc `error` vì timeout/reload/đổi mạng.

### 3.5. Khôi phục ứng dụng / trạng thái làm việc

- Service Worker lưu **app shell** và các asset cùng origin cần thiết; Cache Storage **không dùng thay IndexedDB cho dữ liệu người dùng**.
- Persist tối thiểu: danh tính phiên offline đã được xác thực trước đó (không xem đây là JWT mới), `datasetId`, bộ lọc trạm/vùng/thời gian, tab/chế độ xem, time zone, camera nếu renderer hỗ trợ khôi phục ổn định, và trạng thái Outbox.
- Khôi phục được giao diện cùng **dữ liệu thực sự có** sau reload/đóng mở tab offline. Không bảo đảm login mới, renew JWT hoặc xác thực quyền trực tuyến khi mất Backend.
- Sau khi có mạng, **chỉ sync sau khi xác thực Server thành công**. Nếu JWT hết hạn, yêu cầu đăng nhập lại rồi xử lý Outbox của **đúng tài khoản**, không xóa nháp.
- Trên logout/đổi tài khoản: **không lộ private cache qua tài khoản khác**. Nếu Outbox chưa sync, cảnh báo và giữ cách ly theo user hoặc chặn thao tác logout cho đến khi người dùng xử lý; tuyệt đối không âm thầm gửi mutation bằng tài khoản khác. Sau khi không còn pending, xóa/thu hồi cache riêng theo chính sách D021.

## 4. Phạm vi Backend — chỉ bổ sung phần phải có để đồng bộ review (`note`/`status`)

### 4.1. Giữ nguyên các API online

- Giữ Fastify + MongoDB Official Driver, kiến trúc `Route → Schema/Validation → Service → Repository → MongoDB`.
- Giữ `PATCH /api/v1/anomalies/:id` online hiện có; nó đã kiểm tra quyền, `baseVersion` và cập nhật `note/status/version/updatedAt` theo transaction.
- Không viết lại CRUD datasets/readings/analysis hoặc thuật toán ML.

### 4.2. Bổ sung đường Sync riêng có idempotency bền vững

**Lựa chọn theo API Contract hiện có:** triển khai luồng `POST /api/v1/review-mutation-batches` trong OpenAPI; **Client của MVP phát mutation thay đổi `note` và/hoặc `status`**, đúng các trường review đã hỗ trợ online. Payload có ít nhất một trường thay đổi. Đối chiếu hợp đồng request/response thực tế với OpenAPI trước khi implement; **không để code chạy khác OpenAPI**.

Backend cần bảo đảm:

1. Auth JWT/role tại Server; ràng buộc dataset ownership D021 và quyền review trên anomaly.
2. Kiểm tra anomaly vẫn tồn tại, dataset vẫn hợp lệ, run đã hoàn tất và `baseVersion` khớp.
3. `clientMutationId` + user + **payload fingerprint** có thể replay an toàn: cùng ID/cùng payload => trả lại kết quả đã xử lý, **không tăng `version` lần hai**; cùng ID nhưng payload khác => từ chối rõ ràng.
4. **Atomicity**: ghi kết quả mutation/receipt vào collection xử lý mutation và cập nhật anomaly **trong cùng MongoDB transaction** (Replica Set hiện có). Không dùng map trong RAM; restart Server không làm mất dấu đã áp dụng.
5. Outcome tối thiểu: `applied`, `duplicate`, `conflict`, `rejected` (hoặc mã tương đương được chốt đúng OpenAPI). Với conflict, trả đủ thông tin/mốc version để Client đọc bản mới từ Server; **không tự merge**.
6. Mutation không được xóa khỏi Outbox Client chỉ vì đã gửi request; chỉ cập nhật sau khi Server trả kết quả xác thực hoặc đối soát được.
7. Server tuyệt đối **không chấp nhận `userId`/quyền truy cập do Client tự khai**; dùng principal đã xác thực.

**Không triển khai trong đợt này:** hệ thống pull change-feed cho tất cả thiết bị (`GET /review-changes`), `GET /exports`, đồng bộ readings hoặc batch upload offline. Chỉ GET lại anomaly cần thiết sau khi sync/conflict. Điều này là **rút gọn so với Offline/Sync đầy đủ trong SRS/SDD**.

### 4.3. Xử lý các tình huống mất kết nối

- **Server đã commit nhưng Client mất response:** Client giữ nguyên UUID và payload, retry; Server trả `duplicate`/kết quả đã lưu, không sửa lần hai.
- **Hai thiết bị sửa cùng anomaly:** chỉ một mutation với `baseVersion` cũ có thể cập nhật trước; mutation còn lại nhận conflict và giữ nháp cho người dùng quyết định.
- **Token hết hạn / tài khoản bị vô hiệu / mất quyền dataset:** không tự sync; giữ Outbox đúng user và hiển thị lỗi/xác thực lại, không cố bypass quyền.
- **Server phục hồi nhưng Internet chập chờn:** thử lại có kiểm soát, không quay vòng vô hạn; vẫn lưu bền vững trạng thái.

## 5. Tổ chức code dự kiến (không ép tạo mọi file nếu không cần)

### Frontend

- `client/src/offline/`: một module tập trung cho IndexedDB schema/storage, cache coverage, Outbox, session restoration và sync coordinator; **không thêm statistical Web Worker**.
- `client/src/shared/data-source/`: thêm lớp **online + local cache fallback**, tái dùng `online.ts` thay vì để từng component tự thao tác IndexedDB.
- `client/src/features/workspace/`: tích hợp đọc cache vào Cube/biểu đồ/bảng; duy trì `readings-cache.ts` RAM hiện có như tầng tăng tốc, **không đánh đồng RAM cache với persistent IndexedDB**.
- `client/src/features/anomalies/review.tsx`: hỗ trợ lưu `note`/`status` khi offline qua **cùng một Outbox**; giữ logic PATCH online hiện có. Giao diện phân biệt review local/synced/conflict.
- `client/src/main.tsx`, `client/src/app/services.tsx` và cấu hình Vite: đăng ký service worker, khởi tạo offline services, cache gắn user, khôi phục offline đúng thứ tự.

### Backend

- Thêm module `server/src/modules/sync/` **nếu cần**: `index.ts`, `*.routes.ts`, `*.schema.ts`, `*.service.ts`, `*.repository.ts`.
- Tái sử dụng review business boundary của `modules/anomalies`, **không copy lại logic sửa anomaly và quyền access**.
- MongoDB bổ sung collection/unique index cho xử lý mutation (tên vật lý do implement chốt; ví dụ `processedMutations`) để nhận biết replay.
- `server/src/app.ts`: chỉ đăng ký module sync khi đã có implementation thật.
- `docs/api/openapi.yaml`: bảo đảm hợp đồng Sync thực tế khớp code; **không tự coi route OpenAPI đã tồn tại là API chạy được**.

## 6. Công nghệ bổ sung ở mức tối thiểu

| Thành phần | Có phải hạ tầng mới? | Cách dùng |
|---|---|---|
| **IndexedDB** | Không, Web API có sẵn trong Browser | Dữ liệu offline, coverage, context và Outbox |
| **Service Worker + Cache Storage** | Không, Web APIs có sẵn | Cache app shell/assets để reload offline |
| **Browser Web Worker cho offline statistics** | **Không dùng trong scope** | Không triển khai vì đã bỏ chạy thống kê offline |
| **Dexie.js** | Thư viện **tùy chọn**, không phải DB Server | Giúp thao tác IndexedDB đơn giản hơn; dùng nếu tiết kiệm thời gian |
| **vite-plugin-pwa / Workbox** | Thư viện hỗ trợ **tùy chọn** | Giảm code thủ công cho SW/precache; không phải hạ tầng |

**Không cần:** Redis, Kafka, PostgreSQL mới, Docker hoặc một Backend thứ hai **chỉ để làm Offline**. Không có lý do đưa MongoDB vào Browser.

## 7. Kịch bản demo/kiểm thử bắt buộc trước khi báo “đã làm”

| ID | Tình huống | Kết quả phải quan sát được |
|---|---|---|
| OFF-01 | Online đăng nhập, mở một dataset, tải một phạm vi readings/anomalies | IndexedDB có đúng dữ liệu và đúng user/dataset; hiển thị phạm vi đã lưu |
| OFF-02 | Dừng Backend **đột ngột** mà không bấm nút chuẩn bị offline | Vẫn xem/lọc dữ liệu đã cache, Cube render bằng dữ liệu cục bộ; không còn gọi bắt buộc đến API để hiển thị |
| OFF-03 | Reload hoặc đóng rồi mở tab trong lúc offline | App shell tải được; workspace/cached data/Outbox được khôi phục trong giới hạn đã lưu |
| OFF-04 | Dataset có 10.000 readings nhưng Client chỉ cache 100 | UI chỉ khẳng định 100 readings đã lưu; không trình bày toàn dataset là đủ |
| OFF-05 | Khi offline, mở tab Analysis và thử chạy thống kê/ML mới | UI báo cần kết nối Backend, không gọi API tạo run, không tạo kết quả/anomaly giả; vẫn xem được kết quả **đã cache** nếu có |
| OFF-06 | Offline mở một anomaly đã cache, sửa `note` và `status` (hoặc chỉ một trường), bấm Lưu, reload | Note, status và Outbox còn nguyên; UI ghi **chờ đồng bộ**, không ghi **Server đã lưu** |
| OFF-07 | Bật Backend lại, còn phiên xác thực hợp lệ | Outbox tự sync `note`/`status`; kiểm tra MongoDB `anomalies.note`, `anomalies.status`, `version` đúng; UI báo đã sync |
| OFF-08 | Server đã commit nhưng response tới Client bị mất; Client retry | Không tạo tác động trùng; `version` không tăng thêm do replay |
| OFF-09 | Thiết bị/phiên khác đã sửa anomaly trước khi pending review sync | Nhận conflict, giữ note/status local, cho xem đối chiếu; không ghi đè Server |
| OFF-10 | Đổi tài khoản hoặc logout khi có cache/outbox | Không xem được cache của tài khoản cũ và không gửi Outbox bằng tài khoản mới; dữ liệu pending không bị xóa âm thầm |
| OFF-11 | Dữ liệu chưa cache hoặc IndexedDB bị chặn/quota đầy | Thông báo đúng thiếu dữ liệu/lưu thất bại; không giả offline-ready |
| OFF-12 | Offline mở Mapbox khi style/tiles không sẵn có | Không crash toàn bộ ứng dụng; có phương án xem Cube/bảng offline; không hứa bản đồ nền đầy đủ |

**Kiểm tra bằng Chrome DevTools**: Network (Offline hoặc dừng Backend), Application → IndexedDB, Application → Service Workers/Cache Storage; đối chiếu `mongosh` trước/sau sync. Test bằng build/preview phù hợp và xác nhận SW chạy ở origin hỗ trợ (localhost/HTTPS), không chỉ test HMR dev server.

## 8. Trình tự triển khai, kiểm tra từng mốc

1. **Mốc A — Nền:** PWA app shell + IndexedDB schema/cache per-user + lưu/khôi phục workspace. Nghiệm thu OFF-01/02/03/04/10/11 (phần liên quan đọc).
2. **Mốc B — Offline Visualization (không chạy thuật toán):** Cube/bảng từ cached readings, lọc trong coverage, xem anomalies/kết quả online đã cache; thao tác chạy phân tích mới báo cần Backend. Nghiệm thu OFF-05/12.
3. **Mốc C — Durable Review Outbox:** sửa note/status khi offline, trạng thái UI đúng, reload vẫn còn pending. Nghiệm thu OFF-06.
4. **Mốc D — Backend Review Sync:** API + persistent idempotency receipts + quyền/version/transaction + auto retry/conflict FE. Nghiệm thu OFF-07/08/09/10.
5. **Mốc E — Smoke/regression:** chạy lại online auth, import, query, analysis, Mapbox, Cube, review online; typecheck/lint/build/test liên quan; kiểm tra Console Errors & Warnings và MongoDB thật.

**Quy tắc chốt:** Nếu một mốc chưa qua nghiệm thu, không mô tả mốc đó là đã hoàn thành. Không sửa lan sang UI/UX hay module không liên quan để “tiện thể”.

## 9. Khác biệt có chủ đích với SRS/SDD gốc

Phạm vi này **rút gọn** một số ý trong tài liệu hiện hành nhằm giảm rủi ro sát buổi bảo vệ:

1. **UC-06/FR-12** gốc hỗ trợ sync `status` **và** `note`; MVP **giữ cả hai**, nhưng giới hạn ở những anomaly đã tồn tại trên Server và đã được cache; không đồng bộ toàn bộ loại mutation khác.
2. UC-06 gốc có **chủ động tải thêm dữ liệu offline**; MVP **chỉ auto-cache dữ liệu đã thực sự xem**, không có màn hình prefetch/export mới.
3. OpenAPI đã phác thảo `GET /review-changes`, `POST /review-mutation-batches`, `GET /exports`; MVP chỉ triển khai **phần push review (`note`/`status`) và đọc chi tiết cần thiết**, không làm toàn bộ Offline API suite.
4. **Mapbox 3D đầy đủ khi offline không được bảo đảm** ngay cả trong SRS gốc; Three.js Cube sử dụng dữ liệu đã cache là đường demo chính.
5. **FR-07 và UC-06 trong SRS gốc yêu cầu chạy thống kê offline; bản MVP này cố ý KHÔNG đáp ứng phần đó.** Thuật toán thống kê/ML tiếp tục chạy online trên Backend; offline chỉ xem dữ liệu và kết quả đã cache, không tạo anomaly mới.

**Hệ quả khi báo cáo:** Chỉ đánh dấu những tiêu chí nghiệm thu đã kiểm chứng được. Không khẳng định toàn bộ FR-11/FR-12 hoặc toàn bộ UC-06 đã hoàn thành nếu các phần rút gọn còn thiếu. Có thể mô tả chính xác: “Offline đọc/lọc/trực quan dữ liệu đã cache và đồng bộ `note`/`status` của anomaly đã có trên Server; chưa hỗ trợ chạy thống kê/ML offline, prefetch và full two-way sync.”

## 10. Definition of Done — tiêu chí hoàn thành cuối cùng

- [ ] App shell mở lại offline sau khi từng được tải online.
- [ ] IndexedDB có dữ liệu thực được phân vùng theo user/dataset, lưu thành công và ghi rõ cache coverage.
- [ ] Three.js Cube/bảng hoạt động với readings đã cache, không phụ thuộc Backend khi đang offline.
- [ ] Khi offline, chức năng chạy thống kê/ML mới bị chặn có thông báo rõ, nhưng kết quả online đã cache vẫn xem lại được nếu đủ dữ liệu; không tạo job/anomaly giả.
- [ ] Thay đổi `note`/`status` offline lưu bền vững ở Outbox và tồn tại sau reload.
- [ ] `note`/`status` tự đồng bộ khi Backend phục hồi và người dùng có xác thực phù hợp.
- [ ] Sync kiểm tra owner/quyền, `baseVersion`, replay cùng UUID không cập nhật trùng.
- [ ] Conflict giữ bản nháp, không auto ghi đè.
- [ ] Không lộ dữ liệu riêng tư khi logout/đổi account; không mất pending mutation âm thầm.
- [ ] Regression online không hỏng; test E2E + MongoDB thật chứng minh từ Client đến Server.
- [ ] Báo cáo bảo vệ phân biệt rõ **đã thực hiện** và **chưa làm**.

## 11. Tài liệu/code tham chiếu (đúng nhánh)

- [SRS — UC-06, FR-11/FR-12, D021](https://github.com/khiemtrancong26-tech/spatiotemporal-anomaly-system/blob/khiem/backend-database/docs/SRS.md)
- [SDD — Offline-first, Mapbox, Worker và module boundary](https://github.com/khiemtrancong26-tech/spatiotemporal-anomaly-system/blob/khiem/backend-database/docs/SDD.md)
- [OpenAPI — draft Offline endpoints](https://github.com/khiemtrancong26-tech/spatiotemporal-anomaly-system/blob/khiem/backend-database/docs/api/openapi.yaml)
- [Client online data source](https://github.com/khiemtrancong26-tech/spatiotemporal-anomaly-system/blob/khiem/backend-database/client/src/shared/data-source/types.ts)
- [Readings RAM cache (chưa phải IndexedDB)](https://github.com/khiemtrancong26-tech/spatiotemporal-anomaly-system/blob/khiem/backend-database/client/src/features/workspace/readings-cache.ts)
- [Backend anomaly review repository](https://github.com/khiemtrancong26-tech/spatiotemporal-anomaly-system/blob/khiem/backend-database/server/src/modules/anomalies/anomalies.repository.ts)

---

> **Scope guard để giao AI/Codex:** Chỉ triển khai các mục **LÀM** ở tài liệu này; giữ nguyên chức năng online. Nếu phát hiện mâu thuẫn với SRS/SDD/OpenAPI hoặc có yêu cầu buộc mở rộng ra ngoài scope, ghi rõ điểm mâu thuẫn và tác động trước khi thay đổi; **không tự ý triển khai Z-score/IQR/Moving Average/ML offline hoặc Browser Web Worker cho phân tích offline**; không bổ sung sync toàn diện, upload offline, prefetch cả dataset hoặc cache Mapbox tiles.
