# M0 — Đầu vào triển khai Frontend P0 online

Ngày kiểm tra: 13/11/2026. Phạm vi theo [kế hoạch](../frontend-online-plan.md).

**Kết quả:** đã chuẩn bị audit contract, ma trận API/fixture, interface TypeScript bản đầu, bố cục và quy ước UI để bắt đầu M1. Chưa có xác nhận của Duy/Khiêm/Khải; không đánh dấu các quyết định liên nhóm là đã được duyệt. Không có runtime frontend hoặc adapter HTTP được triển khai trong M0.

## 1. Hiện trạng có bằng chứng

- `client/README.md`: ứng dụng chưa khởi tạo; chưa có `client/package.json` hay source frontend.
- `server/README.md`: Backend chưa khởi tạo; `server/` chưa có implementation. Tất cả endpoint bên dưới **chưa triển khai trong checkout này**; không có bằng chứng về một môi trường Backend bên ngoài.
- `shared-core/src/contracts/schemas.ts`: đã có draft Zod/TypeScript; package chưa khởi tạo, chưa có dependency Zod để chạy schema trực tiếp.
- `docs/api/openapi.yaml`: 23 operations tổng cộng. P0 online dùng 17 operations nghiệp vụ, thêm health tùy chọn; 5 operations còn lại ngoài phạm vi (aggregates, reading-batches nội bộ, exports, push và pull sync).
- Chưa có endpoint lấy dataset/run/reading theo ID; chỉ anomaly có GET detail.

## 2. Đối chiếu OpenAPI, shared schema và fixtures

| ID | Phát hiện | Quyết định / việc cần làm |
|---|---|---|
| C01 | `http-contract-examples.json → patchAnomaly.response.data` trước M0 chỉ có id/version/status/note, trong khi `SingleAnomaly` yêu cầu đầy đủ Anomaly | M0 bổ sung đầy đủ DTO từ fixture gốc, giữ review mới và cập nhật updatedAt. Không nới schema để chấp nhận response thiếu |
| C02 | Trường và required/optional của UserPublic, Dataset, Sensor, Reading, AnalysisRun, Anomaly, ImportIssue, ImportSummary trong Zod khớp OpenAPI khi đọc đối chiếu; validation không hoàn toàn tương đương | Zod chặt hơn ở chuỗi không rỗng, miền tọa độ và UTC. Không coi type tương thích là validator tương đương |
| C03 | OpenAPI không có minLength cho username public, dataset name/sourceFilename, sensor externalId/name, run/anomaly method; Zod có min(1) | Khiêm/Khải cần thống nhất. M1 không áp Zod nguyên xi lên mọi response rồi coi payload hợp lệ theo OpenAPI là lỗi tùy tiện |
| C04 | OpenAPI location chỉ quy định hai số và mô tả WGS84; Zod ràng buộc lon ±180, lat ±90. `date-time` trong OpenAPI có mô tả UTC Z, còn Zod kiểm tra Z và độ chính xác tối đa 3 chữ số thập phân | Renderer phải từ chối tọa độ không hợp lệ; API/Khải thống nhất runtime validation thời gian trước tích hợp. Format checker JSON Schema không chứng minh yêu cầu Z/precision của shared schema |
| C05 | Shared schema chưa chứa HTTP envelopes, Login/Mapping/Validation/Detection/Admin request và list query | HTTP types lấy từ OpenAPI; shared DTO không thay thế HTTP contract. Bản snapshot M0 nằm ở `online-wire.d.ts` |
| C06 | `ValidationReport` trả trực tiếp, login và health cũng không có `{data}`; analysis trả `{data: run, anomalies}` | Adapter unwrap theo từng operation. Không viết một hàm unwrap data áp dụng mọi response |
| C07 | GET anomalies không nhận sensorId/bbox; DetectionRequest chỉ có sensorIds/from/to, không có bbox | Hiển thị phạm vi riêng ở tab Anomalies; không gửi query không tồn tại, không lọc một trang rồi gọi là toàn bộ kết quả trong vùng. Analysis bbox cần quyết định riêng trước M5 |
| C08 | Anomaly không có giá trị PM2.5 của reading; không có GET reading theo ID | Nếu reading có trong dữ liệu đã tải thì join bằng readingId; nếu thiếu thì panel ghi “Chưa tải phép đo”, vẫn hiển thị metadata anomaly. Không dùng score thay PM2.5 |
| C09 | Conflict example chỉ có currentVersion trong details; contract Error không bảo đảm có current anomaly | PATCH 409 phải GET detail để lấy bản Server; bảo toàn bản nhập trong RAM, không tự gửi lại PATCH |
| C10 | ImportSummary có số readings theo dòng, không có số trạm imported; ValidationReport không có mapping đã lưu hay metadata file | UI chỉ hiển thị các số liệu có thật; không hứa phục hồi đầy đủ wizard qua validation API |
| C11 | `method: string`, `config` mở trong HTTP; shared statistical input gợi ý zscore/iqr/moving_avg nhưng không phải catalog method đã chạy trên Server | Fixture chỉ minh họa. Không mặc định detector hoặc model ML đã sẵn sàng; cần Khải/Khiêm xác nhận config/default |
| C12 | `.env.example` còn base URL `/api`; mục lục docs có nhãn version cũ | M1 dùng `/api/v1`. Khi cần contract mở file nguồn, không suy ra phiên bản từ mục lục. M0 không sửa contract/SDD hoặc env runtime |
| C13 | Không có total count trong PageInfo; analysis create có anomalies array không có cursor riêng; chưa có quy tắc cắt array này | Không dựng “trang X/Y” hoặc tổng toàn dataset; dùng tải thêm. Khi cần duyệt đầy đủ theo run, dùng GET anomalies; xác nhận giới hạn analysis response trước dữ liệu lớn |
| C14 | GET readings nhận một sensorId; list sensors không nhận truy vấn text; admin list cũng không có search query | P0 chọn một trạm cho tra cứu. Tìm kiếm client, nếu có, phải ghi rõ chỉ trên danh sách đã tải; không thêm query search tự phát |

Fixture mới: [frontend-online-examples.json](../fixtures/frontend-online-examples.json). Có success cho đủ 18 operations online/health, empty page, next cursor, các lỗi chính và mô tả negative cases. Đây là dữ liệu giả để phát triển/test sau này, không có mock server ở M0.

## 3. Ma trận API và mock thay thế

Tất cả paths dưới đây bắt đầu `/api/v1`. **B** = đã có contract, chưa có implementation trong repo. Owner Backend cho mọi dòng là **Khiêm**; UI/adapter là **Tài**. Analysis cần Khải; interface cần Duy review. Mỗi fixture được định danh bằng `cases[].id` trong file mới.

| Mốc | Method/path | Input đáng chú ý | Wire success → kết quả interface | Fixture | Trạng thái |
|---|---|---|---|---|---|
| M1 | GET /health | public, tùy chọn | 200 HealthResponse → giữ nguyên | health | B |
| M2 | POST /auth/tokens | username/password | 200 LoginResponse → giữ nguyên | login | B |
| M2 | GET /users/me | Bearer | 200 UserResponse → UserPublic | me | B |
| M2 | GET /datasets | sort, limit, cursor | 200 DatasetPage → giữ nguyên | datasets | B |
| M3 | POST /datasets | multipart file/name, key | 201 SingleDataset → Dataset | upload | B |
| M3 | GET /datasets/{id}/validation | dataset ID | 200 ValidationReport → giữ nguyên | validation | B |
| M3 | PUT /datasets/{id}/mapping | MappingRequest, không thêm timezone | 200 SingleDataset → Dataset | mapping | B |
| M3 | POST /datasets/{id}/imports | key; không request body | 200 SingleDataset → Dataset | import | B |
| M4 | GET /sensors | datasetId, bbox, sort/limit/cursor | 200 SensorPage → giữ nguyên | sensors | B |
| M4 | GET /readings | datasetId, sensorId, bbox, from/to, sort/limit/cursor | 200 ReadingPage → giữ nguyên | readings | B |
| M5 | GET /analysis-runs/{id} | ID + bearer | 200 AnalysisCreateResponse `{data}` | analysis-detail | B |
| M5 | POST /analysis-runs | DetectionRequest + key | 202 AnalysisCreateResponse `{data}` → giữ nguyên | analysis-create | B |
| M5 | GET /analysis-runs | datasetId, sort/limit/cursor | 200 AnalysisRunPage → giữ nguyên | analysis-list | B |
| M6 | GET /anomalies | datasetId, run/family/method/severity/status/from/to, sort/limit/cursor | 200 AnomalyPage → giữ nguyên | anomalies | B |
| M6 | GET /anomalies/{id} | anomaly ID | 200 SingleAnomaly → Anomaly | anomaly-detail | B |
| M6 | PATCH /anomalies/{id} | baseVersion + changes | 200 SingleAnomaly → Anomaly | anomaly-review | B |
| M7 | GET /admin/users | admin; sort/limit/cursor | 200 UserPage → giữ nguyên | admin-list | B |
| M7 | POST /admin/users | admin; username/password/role + key | 201 UserResponse → UserPublic | admin-create | B |
| M7 | PATCH /admin/users/{id} | admin; role/isActive, ít nhất một field | 200 UserResponse → UserPublic | admin-update | B |

List defaults: datasets/runs `createdAt:desc`, sensors `externalId:asc`, readings/anomalies `ts:asc`, users `username:asc`; chỉ hai chiều asc/desc của đúng field. Limit 100, max 200. nextCursor null nghĩa hết trang; cursor là opaque string, không giải mã hoặc tự tạo từ ID.

## 4. Interface dữ liệu bản đầu

Xem [online-data-source.d.ts](online-data-source.d.ts), [online-wire.d.ts](online-wire.d.ts). Các file trong `docs/frontend/` là **bản thiết kế type-check được**, chưa là source runtime hoặc package API. `online-wire.d.ts` là snapshot cấu trúc HTTP P0 được trích từ OpenAPI tại M0; constraints như minLength/minProperties vẫn phải kiểm tra ở runtime. Khi M1 chọn cách sinh type, ưu tiên nguồn OpenAPI, không duy trì snapshot này như nguồn chuẩn thứ hai.

- Composition root M1 tạo OnlineDataSource hoặc mock tương thích và truyền xuống hooks. Duy có thể bọc adapter online hoặc cung cấp implementation tương thích; renderer không biết transport.
- Mỗi method nhận AbortSignal. Hủy GET khi đổi query; response muộn bị bỏ bằng request generation/query key, kể cả transport không kịp hủy.
- Hủy mutation **không có nghĩa Server hủy nghiệp vụ**. UI giữ key/payload cho retry trong phiên đang mở, đánh dấu kết quả chưa xác định nếu đã gửi mà mất response. Không tự tạo key mới hoặc báo thất bại chắc chắn.
- Bốn POST idempotent bắt buộc options.idempotencyKey do tầng thao tác tạo, không tạo lại mỗi lần transport gửi. PATCH review không dùng key này; dùng baseVersion.
- `DataSourceError` phân biệt http/network/aborted/invalid-response. HTTP error có status và error envelope đã kiểm tra nếu có; response HTML hoặc JSON sai shape phải thành invalid-response, không giả Error chuẩn.
- Không tự hiển thị details/raw body chứa thông tin nhạy cảm; đưa message an toàn và lỗi field đã biết lên UI. Không log password/token.
- `logout` là trách nhiệm session store, không phải method API. Token lấy qua `getAccessToken` của composition root, không truyền password/token qua renderer.
- Interface chỉ mô tả online. Duy không được biểu diễn “đã ghi outbox” như Promise<Anomaly> đã xác nhận Server; khi thêm offline phải mở rộng result/capability rõ ràng và review consumer, không lén đổi ngữ nghĩa success.
- Bbox trong interface là tuple; adapter serialize `minLon,minLat,maxLon,maxLat`. Timestamp input đã là UTC Z; không parse theo timezone máy ở transport.

**Trạng thái review:** bản đầu sẵn sàng cho M1 online; Duy chưa xác nhận chữ ký/điểm ghép. Chưa gửi tin nhắn cho thành viên nào.

## 5. Quyết định FE và phụ thuộc chưa chốt

### Quyết định có thể dùng ngay trong phạm vi FE

| ID | Quyết định |
|---|---|
| FE01 | Datasets là landing sau login; workspace có 3 tab Visualization/Analysis/Anomalies; không dashboard KPI |
| FE02 | Giao diện tiếng Việt; timestamp hiển thị `dd/MM/yyyy HH:mm:ss`, nhãn `UTC+07:00 (Asia/Ho_Chi_Minh)`; không tự theo timezone máy |
| FE03 | Form from/to dùng cùng timezone UTC+07:00, có giây; chuyển sang UTC ISO Z trước khi đưa vào dataSource. Ví dụ 13/11/2026 08:00:00 → 2026-11-13T01:00:00.000Z; từ 00:30 đổi sang ngày UTC trước đó. Validate lịch và from ≤ to, không tự sửa ngày sai |
| FE04 | Tooltip/detail cho xem timestamp UTC gốc và phần mili giây nếu có. Đây là timezone hiển thị, không phải chính sách gán timezone cho file import |
| FE05 | State filter/view/selection giữ trong RAM khi đổi tab. Không làm persistence/offline restoration ở M0/M1 |
| FE06 | Mock được bật tường minh và gắn nhãn; API lỗi không tự chuyển sang mock. M1 có thể làm việc bằng mock khi Backend chưa tồn tại |
| FE07 | Nút Lọc áp dụng form và reset cursor; pan/zoom bản đồ không tự đổi bbox và gọi API. Chỉ thao tác chọn vùng/xác nhận mới cập nhật bbox |
| FE08 | Tab Anomalies ghi rõ scope dataset/time/run và không nhận trạm/bbox theo contract hiện tại; lớp anomaly trên renderer có thể cắt hình học cục bộ nhưng phải nói “trong phần đã tải” |

### Các điểm cần người phụ trách xác nhận trước mốc liên quan

| ID | Câu hỏi cụ thể | Người phối hợp | Hạn / cách tiếp tục |
|---|---|---|---|
| R01 | Duy có đồng ý chữ ký, lỗi/cancellation và quy tắc success online ở interface này không? | Tài + Duy | Trước ghép module; M1 có thể làm adapter độc lập |
| R02 | Token chỉ giữ trong RAM hay có phiên online sống qua reload? Có chính sách bảo mật/session của Backend chưa? | Tài + Khiêm, người dùng nếu cần chọn UX | Trước M2; M1 chỉ dùng injected token getter, chưa chọn storage |
| R03 | Workspace thiếu metadata khi deep-link: chấp nhận header datasetId và tải dữ liệu trước, hay cần contract hỗ trợ lấy metadata? | Tài + Khiêm | M2; không scan mọi trang hoặc kết luận 404 từ trang đầu |
| R04 | Reload wizard phục hồi thế nào khi validation không trả mapping đã lưu, và mất key upload/import khi đóng tab? | Tài + Khiêm | Đã chốt M3: sessionStorage giữ ID/key trong tab, đọc validation, mapping xác nhận lại trước import; thao tác import đã gửi giữ nguyên mapping/key. Không tự upload/import; mất response upload trước ID báo chưa xác định |
| R05 | Timestamp nguồn thiếu offset, unit khác ug/m3, file limits và lỗi invalid row được giải thích thế nào? | Khiêm + Khải | Đã chốt M3: chỉ timestamp có Z/offset và ug/m3, chuẩn hóa nguồn khác trước import; không thêm field timezone/ngưỡng upload; lỗi file theo Backend |
| R06 | Có method/config/default nào thật sự chạy, ML model nào, insufficient-data trả status/error code nào? | Khiêm + Khải | M5; dùng fixtures giả có nhãn |
| R07 | Analysis theo bbox có resolve tất cả sensors không, giới hạn payload bao nhiêu; sensorIds rỗng nghĩa gì? | Khiêm | M5; không gửi [] khi ý định là vùng rỗng, không bỏ bbox ngầm |
| R08 | Semantics from/to inclusive hay exclusive và danh sách sensors thay đổi giữa các trang? | Khiêm | M4/M5; UI chưa gắn nhãn biên đóng/mở hoặc hứa snapshot |
| R09 | Review cần giá trị reading chưa tải và bộ lọc anomalies theo trạm/vùng phía Server không? | Tài + Khiêm | M6; hiện hiển thị thiếu reading rõ và giữ đúng query hiện có |
| R10 | Chặn tự hạ quyền/vô hiệu admin cuối cùng hay xử lý theo rule nào? | Khiêm | M7; FE không tự phát minh business rule |
| R11 | Analysis async D008: tiếp nhận durable, replay/recovery/retention và polling; Import giữ đồng bộ | Khiêm + Tài + Cường | M5/B5; hướng async đã chốt, thông số vận hành còn mở |

Các câu hỏi trên đã có phương án phát triển độc lập, chưa cần người dùng quyết định thay Backend để bắt đầu M1. Không có thay đổi API được thực hiện trong M0.

## 6. Backlog có đầu vào cụ thể cho M1

1. M1-A: scaffold và script; lấy stack từ kế hoạch, kiểm tra dependency lúc cài.
2. M1-B: layout/tokens/components theo [ui-spec.md](ui-spec.md); routes placeholders, chưa triển khai toàn bộ feature M2–M7.
3. M1-C: HTTP client + online adapter theo interface này, unwrap theo ma trận; key/cancellation/error handling.
4. M1-D: mock transport lấy fixtures mới, thêm hành vi delay/error/pagination có kiểm soát; không service worker/PWA.
5. M1-E: kiểm tra pagination reset, response race, mutation retry và shape response; build/typecheck/lint.

**Điều kiện chuyển M1:** tài liệu và interface đã sẵn sàng; không cần API thật để scaffold. **Điều kiện đóng M0 hoàn toàn theo checklist gốc:** Duy xác nhận interface. Chưa có xác nhận nên mục này vẫn để mở, các sản phẩm chuẩn bị còn lại đã hoàn thành.

## 7. Kiểm chứng M0

Chạy `python docs/frontend/verify_m0.py` trong môi trường có PyYAML và jsonschema: kiểm tra fixtures online theo schemas/request/query/status của OpenAPI, đủ 18 operations, DTO fixture hiện có và fixture review đã sửa. Validator chuyển nullable của OpenAPI 3.0 sang JSON Schema trước khi kiểm tra. Không kiểm chứng auth, CAS, idempotency hay detector runtime.

Chạy `tsc --noEmit --strict --lib "ES2022,DOM" docs/frontend/online-wire.d.ts docs/frontend/online-data-source.d.ts`: kiểm tra bản interface không thiếu type/tham chiếu. Dấu nháy giữ tham số lib đúng khi chạy PowerShell. Không dùng `skipLibCheck` để bỏ qua lỗi declaration. Zod chưa được thực thi vì shared package chưa khởi tạo; so sánh Zod ở mục 2 là audit source, không phải tuyên bố test runtime đã pass.

Kết quả thực hiện ngày 13/11/2026:

- PASS: 30 fixture cases, đủ 18 operations, 7 core DTO objects và 7 legacy payloads; negative check từ chối response review thiếu trường.
- PASS: TypeScript kiểm tra hai declaration files ở strict mode, không sinh JavaScript.
- PASS: `git diff --check` cho thay đổi tracked. Chưa chạy build ứng dụng/E2E vì M1 chưa được triển khai.

**Cập nhật D008 (13/11/2026):** ma trận Analysis/fixtures mục tiêu đã đổi async; contract hiện 20 online operations. Số liệu M0 gốc là lịch sử. Runtime/shared-core/guard số operation của verify_m0.py chưa migrate; theo follow-up M1 trước M5.

**Cập nhật 14/11/2026:** migration client/shared-core D008 và FE M5 đã triển khai theo D009; ghi chú “chưa migrate” ở phần lịch sử mô tả đợt docs trước. Backend/ML thật vẫn chờ; xem `docs/frontend/m5-verification.md`.
