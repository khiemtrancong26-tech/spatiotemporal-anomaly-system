# API Contract v0.1 (draft) — SDD v0.3

**Máy đọc:** [`openapi.yaml`](openapi.yaml) (OpenAPI 3.0.3, có thể mở bằng Swagger Editor/Redoc).  
**Nguồn:** SRS v0.4 + Shared Data Contract v0.1 + kế hoạch nhóm 11/11.  
**Chủ sở hữu:** Khiêm (Backend), review Tài (UI), Duy (Offline), Khải (Schema/Engine).  
**Trạng thái:** **Hợp đồng khởi đầu để triển khai và mock**, KHÔNG tuyên bố endpoint đã được cài đặt, và KHÔNG xem các quyết định mở đã được duyệt.

## Nguyên tắc trao đổi

- Nginx tiếp nhận HTTPS cổng 443; các route là `/api/...`, cùng origin trong môi trường demo.
- JSON UTF-8; upload file là `multipart/form-data`. JWT bearer cho mọi API nghiệp vụ; `/api/health` và `/api/auth/login` public.
- `analyst` là người dùng sản phẩm; `admin` là Application Admin có thêm APIs quản lý tài khoản. **Không có `viewer`**.
- Request/response **camelCase**, ID public `string` opaque; thời gian UTC ISO 8601 `Z`; `location` là GeoJSON Point `[lon,lat]`; `value` PM2.5 có đơn vị `ug/m3`.
- JSON response list `{data:[...],page:{limit,nextCursor}}` với `nextCursor: null` nếu hết. ID trong fixture `sensor-001` là giả; backend dự kiến trả ID opaque (có thể là hex ObjectId, nhưng client không parse).
- Lỗi dùng `{ "error": {"code":"...", "message":"...", "details": { ... }}}`; không để lộ stacktrace hoặc document DB.

## API group và nhánh SRS

| Nhóm | Route chính | SRS | Mức |
|---|---|---|---|
| Auth | `POST /api/auth/login`, `GET /api/auth/me` | FR-01 | P0 |
| Admin | `GET/POST /api/admin/users`, `PATCH /api/admin/users/{id}` | FR-01, BR-14 | P0 tối thiểu |
| Import | `POST /api/datasets/upload`, `GET /api/datasets/{id}/validation`, `PUT /api/datasets/{id}/mapping`, `POST /api/datasets/{id}/import` | FR-02..05; BR-08 | P0 |
| Query | `GET /api/datasets`, `/api/sensors`, `/api/readings` | FR-06 | P0 |
| Analysis | `POST /api/analysis/detect`, `GET /api/analysis/runs` | FR-07, FR-08 | P0 |
| Review | `GET /api/anomalies`, `GET/PATCH /api/anomalies/{id}` | FR-10 | P0 |
| Offline | `GET /api/export`, `GET /api/sync/pull`, `POST /api/sync/push` | FR-11..12, BR-15..22 | P0 |
| Aggregate | `GET /api/readings/aggregate` | FR-13 | P1 |
| Internal only | `POST /api/readings/bulk` | BR-08, import | Draft internal, không gọi từ UI |

## Chính sách chính cần đồng bộ

### Pagination
- GET readings trả `limit<=200` và `nextCursor`. Sắp xếp cố định `(ts ASC,id ASC)` trong cùng bộ lọc. Cursor là token opaque, cấm FE tự decode để suy luận dữ liệu. Giữ nguyên bộ lọc qua các trang.
- MongoDB index gợi ý `{datasetId:1,ts:1,_id:1}`. Khi có `sensorId`, index unique `{datasetId:1,sensorId:1,ts:1}` hỗ trợ truy xuất. Đánh giá `explain` trước tối ưu tiếp.
- Không mặc định trả toàn bộ 100k–500k readings về Client một request.

### Upload/Import
- `sensorId` của file nguồn là mã trạm ngoài; normalized Reading `sensorId` là ID **nội bộ**. Chuẩn hóa UTC và đơn vị trước khi xác định trùng.
- BR-08: first valid row wins; duplicate same value / conflicting value bị bỏ qua kèm `ImportSummary` và `issues[rowNumber,reason,keptRowNumber?]`.
- Bảng `datasets` phải tồn tại ở trạng thái `imported` trước khi mọi API query công bố dữ liệu. Nếu lỗi giữa chừng, không công bố dataset nhập dở.
- Giới hạn upload/batch chưa chốt (OPEN-05). Dữ liệu nguồn thiếu offset timezone tạm **không được tự xử lý im lặng** (OPEN-02).

### Analysis
- Nhánh statistical hỗ trợ `zscore`, `iqr`, `moving_avg`; ML runtime/model cụ thể vẫn OPEN-03.
- **Bản OpenAPI đề xuất profile đồng bộ:** `POST /api/analysis/detect → 200` cùng AnalysisRun + anomalies cho phạm vi tính toán giới hạn. **Đây là phương án tạm để FE mock, chưa chốt OPEN-06.** Nếu cần job lâu, nhóm đổi thống nhất sang `202 + poll` trước khi làm thật. Không tự ý triển khai hai kiểu khác nhau.
- `severity` được trả về theo shared contract nhưng quy tắc map `score → severity` chưa chốt (OPEN-04), không đưa ngưỡng ví dụ thành chính sách sản phẩm.

### Review + sync
- `PATCH /api/anomalies/{id}` yêu cầu `{baseVersion, changes:{status?,note?}}`; thay đổi thành công tăng `version`. Phiên bản cũ → HTTP `409`, có `error.details.currentVersion`.
- `POST /api/sync/push` nhận danh sách `OfflineReviewMutation` và trả outcome theo từng mutation: `applied | duplicate | conflict | rejected`. Retry cùng `clientMutationId` + cùng payload không áp dụng thêm; ID cũ với payload khác trả `409`. Không gửi kết quả detector mới offline lên Server.
- `GET /api/sync/pull` trả thay đổi review; cần giữ checkpoint riêng, áp dụng theo `version` và kiểm thử trường hợp hai thiết bị. Cơ chế cursor `(updatedAt,id)` ở v0.1 là đề xuất; tính đúng của việc không bỏ sót trong đồng bộ nhiều trang cần kiểm thử đối kháng trước khi công bố production.
- Khi mất mạng, Tài đọc qua Duy `dataSource`/IndexedDB; `GET /api/export` hỗ trợ tải trước từng trang, **không** nói toàn dataset có sẵn nếu mới cache trang đầu. Frontend chỉ đánh dấu `CacheCoverage.complete=true` sau khi từng trang trong phạm vi đã được lưu thành công.
- Mapbox tiles và tòa nhà 3D không bảo đảm offline; UI cần trạng thái thay thế.

## Các điểm đang mở (SRS/SDD)

| ID | Quyết định chưa chốt | Tác động |
|---|---|---|
| OPEN-02 | Timestamp nguồn thiếu timezone | import validator/mapping |
| OPEN-03 | Model ML, feature schema, method | detect, score metadata |
| OPEN-04 | Ngưỡng severity và config mặc định | detector config/UI |
| OPEN-05 | Giới hạn file, batch, báo cáo lỗi | upload/import |
| OPEN-06 | Đồng bộ hay bất đồng bộ cho analysis/import | HTTP response, FE polling |
| NEW-01 | Một externalId có vị trí không nhất quán | import sensor validation |
| NEW-02 | Dataset/Run lifecycle enum | shared schemas/API |
| NEW-03 | Định nghĩa chính xác CacheCoverage per scope/page | Dexie/prefetch |
| NEW-04 | Checkpoint sync qua nhiều trang khi đồng thời có edits | đồng bộ không bỏ sót |

**Mốc khóa hợp đồng:** Sau khi Khiêm/Tài/Duy/Khải review các field liên module, chạy fixture và contract tests. Đổi endpoint/payload sau khóa phải qua PR review. Cường không cần chờ khóa hết toàn bộ API mới dựng Docker/CI.
