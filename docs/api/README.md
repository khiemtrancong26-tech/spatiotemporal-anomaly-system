# API Contract v0.2.0-draft — PM2.5 Spatial–Temporal Anomaly

**Nguồn máy đọc:** [`openapi.yaml`](openapi.yaml), OpenAPI 3.0.3. **Yêu cầu:** [`../SRS.md`](../SRS.md) v0.5; thiết kế [`../SDD.md`](../SDD.md) v0.4 (phiên bản trong ZIP).  
**Owner:** Khiêm (Backend/API), cần Tài, Duy, Khải review trước khi khóa hợp đồng. **OpenAPI là nguồn chuẩn về endpoint, method, request và response; chưa phải API đã triển khai.**

## Quy tắc chung

1. Nginx HTTPS `:443`, REST paths bắt đầu `/api/v1`. `analyst`/`admin` dùng JWT Bearer; public `/api/v1/health`, `/api/v1/auth/tokens`; `admin` là quản trị ứng dụng, không phải quyền hạ tầng.
2. JSON `camelCase`; ID public `string` opaque; GeoJSON Point `[longitude,latitude]`; UTC ISO `Z`; PM2.5 chuẩn `ug/m3` (hiển thị `µg/m³`). DTO không lộ MongoDB `_id`/passwordHash.
3. List `{data:[...],page:{limit,nextCursor}}`, một đối tượng `{data:{...}}`; health, login, analysis và sync batch giữ đúng envelopes riêng trong OpenAPI.
4. HTTP lỗi `{error:{code:string,message:string,details?:{...}}}`; không gửi stack trace hoặc thông tin nhạy cảm. 401 Bearer API kèm `WWW-Authenticate`; 405 kèm `Allow`.
5. `PATCH` hợp lệ cho cập nhật một phần. `PUT /datasets/{id}/mapping` là thay toàn bộ mapping, lặp cùng nội dung không tạo nghiệp vụ mới.

## Danh sách 23 operations (19 resource paths)

| HTTP | Resource path (sau `/api/v1`) | Ý nghĩa |
|---|---|---|
| GET | `/health` | Readiness |
| POST | `/auth/tokens` | Login |
| GET | `/users/me` | Current user |
| GET / POST | `/datasets` | List imported / upload-create |
| GET | `/datasets/{id}/validation` | Import validation report |
| PUT | `/datasets/{id}/mapping` | Confirm/replace field mapping |
| POST | `/datasets/{id}/imports` | Run import on existing dataset (sync draft) |
| GET | `/sensors` | Filtered station list |
| GET | `/readings` | Filtered PM2.5 series |
| GET | `/reading-aggregates` | Aggregations (P1) |
| POST | `/reading-batches` | Internal-only import bulk API |
| GET / POST | `/analysis-runs` | List / create server-side analysis run |
| GET | `/anomalies` | Filtered anomaly list |
| GET / PATCH | `/anomalies/{id}` | Detail / update review |
| GET | `/review-changes` | Incremental offline pull (draft checkpoint) |
| POST | `/review-mutation-batches` | Offline outbox push |
| GET | `/exports` | Paged prefetch for offline (draft multi-collection cursor) |
| GET / POST | `/admin/users` | List / create app users |
| PATCH | `/admin/users/{id}` | Update role/active status |

**Lưu ý:** Các tài liệu cũ có thể còn dùng đường dẫn `/api/...` không phiên bản. Khi triển khai HTTP, ưu tiên URL `/api/v1/...` định nghĩa trong `openapi.yaml`; không tự tạo alias cho các URL cũ.

`POST /reading-batches` chỉ là hợp đồng **nội bộ**: không công khai qua Nginx và không cho JWT analyst/admin thông thường gọi trực tiếp. Metadata `x-internal` không tự thực thi phân quyền.

## Filtering, Sorting, Pagination

**Hợp đồng sort:** 6 API hỗ trợ đúng hai giá trị tương ứng; các API khác không nhận `sort` từ Client.

| GET resource | `sort` values | Default | Keyset + tie-break |
|---|---|---|---|
| `/datasets` | `createdAt:asc`, `createdAt:desc` | `createdAt:desc` | `createdAt`, `_id` |
| `/sensors` | `externalId:asc`, `externalId:desc` | `externalId:asc` | `externalId`, `_id` |
| `/readings` | `ts:asc`, `ts:desc` | `ts:asc` | `ts`, `_id` |
| `/analysis-runs` | `createdAt:asc`, `createdAt:desc` | `createdAt:desc` | `createdAt`, `_id` |
| `/anomalies` | `ts:asc`, `ts:desc` | `ts:asc` | `ts`, `_id` |
| `/admin/users` | `username:asc`, `username:desc` | `username:asc` | `usernameNormalized`, `_id` |

`limit` mặc định 100, tối đa 200. Cursor opaque ràng buộc bộ lọc và sort; có thứ tự duy nhất nhờ tie-break. Client đổi filter/sort phải bỏ cursor cũ. Backend kiểm tra hash/fingerprint query và từ chối cursor không tương thích với HTTP `400`. `GET /review-changes` và `GET /exports` có order do Server kiểm soát. Paging **không cam kết snapshot** khi dữ liệu cập nhật giữa các request; cần test race conditions.

Ví dụ: `GET /api/v1/readings?datasetId=abc&sort=ts:desc&limit=100`.

## Idempotence / Retries

- **Bắt buộc header** `Idempotency-Key: <UUID>` cho 4 POST: `/datasets`, `/datasets/{id}/imports`, `/analysis-runs`, `/admin/users`. Retry cùng thao tác giữ nguyên key; thao tác mới sinh key mới.
- Key được xét trong phạm vi người dùng. Cùng key và cùng nội dung request đã hoàn tất -> trả lại **cùng HTTP status/body**, không xử lý lại; request cùng key đang chạy -> `409`; cùng key nhưng payload khác -> `422`; thiếu/không hợp lệ -> `400`. Thời hạn lưu kết quả retry chưa được khóa, không tự động retry vô hạn.
- POST `/auth/tokens` không bắt buộc header này. Batch offline **không dùng header trên**, mà dùng `clientMutationId` theo từng mutation.
- Đây là **ngữ nghĩa hợp đồng HTTP**, không yêu cầu thêm collection, index, Redis hay tài liệu triển khai nào trong lần sửa API. Backend phải hiện thực và kiểm thử cơ chế chống trùng trước khi triển khai thực tế.

## HTTP Status Codes

| Status | Khi nào |
|---|---|
| `200` | Query, import đã hoàn tất, review, sync batch có outcomes, login |
| `201` | Mới tạo Dataset, AnalysisRun (sync draft), User |
| `202` | Dành cho job async khi OPEN-06 được chốt, chưa áp dụng |
| `400` | Cú pháp, query/cursor, thiếu/invalid Idempotency-Key |
| `401` | Auth sai/thiếu/hết hạn |
| `403` | Đủ auth nhưng không đủ quyền |
| `404` | ID được chỉ định không tồn tại |
| `405` | Method không hỗ trợ (header Allow) |
| `409` | Version/stale state/in-flight same-key request; username duplicate |
| `413` | Upload quá lớn |
| `415` | Sai media type |
| `422` | Payload hợp cú pháp nhưng không thỏa semantic validation; same idempotency key khác payload |
| `429` | Rate limiting (thường auth login, khi cấu hình) |
| `500` | Lỗi bất ngờ |
| `503` | Dependency/model tạm không khả dụng |

**Batch sync:** `200` thể hiện batch xử lý, không khẳng định tất cả mutation thành công. `results[]` chứa `applied | duplicate | conflict | rejected`; item conflict / key reused khác payload được phản hồi từng item, không biến cả batch thành HTTP 409. `clientMutationId` là nguồn chống replay; `baseVersion` là CAS chống ghi đè.

## Các mục vẫn mở

- OPEN-02: timestamp nguồn không có timezone; OPEN-03 model/ML features; OPEN-04 mapping severity; OPEN-05 file/batch limits; OPEN-06 synchronous vs async analysis/import; OPEN-07 dataset sampling source.
- NEW-01/02: sensor coordinate consistency, Dataset/Run lifecycle enums.
- **NEW-03/04:** `GET /exports` trả nhiều loại tài nguyên trong một trang và một cursor; sync pull checkpoint khi có concurrent updates. Cần review với Duy trước khi đảm bảo không bỏ sót dữ liệu.
- Tài liệu này chốt quy ước REST ở mức draft; chưa thay thế integration tests/benchmark và chưa chứng minh endpoint chạy thật.
