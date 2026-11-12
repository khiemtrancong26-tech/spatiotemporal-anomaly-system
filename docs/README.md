# Project Documentation — Spatiotemporal Anomaly System

Tài liệu phân tích yêu cầu, thiết kế và phối hợp phát triển cho đồ án **Hệ thống phân tích và phát hiện bất thường trong dữ liệu không gian – thời gian bằng trực quan 3D**.

**Phạm vi MVP:** dữ liệu PM2.5 tại trạm cảm biến cố định; nhập CSV/JSON, phát hiện bất thường bằng thống kê và ML inference, trực quan Mapbox 3D và Three.js Space–Time Cube, hỗ trợ offline-first và đồng bộ khi trực tuyến.

> **Lưu ý trạng thái:** Tài liệu thiết kế đã được soạn không có nghĩa các module tương ứng đã được lập trình và kiểm thử. Các bản SDD, API, Shared Data Contract và MongoDB bên dưới vẫn ở trạng thái **draft / cần các owner review trước khi khóa hợp đồng**.

## 1. Danh mục tài liệu

| Tài liệu | Đường dẫn | Dùng để làm gì? | Trạng thái |
|---|---|---|---|
| **SRS — Software Requirements Specification** | [SRS.md](SRS.md) | Mục tiêu, actor, chức năng, business rules, dữ liệu và yêu cầu phi chức năng | **v0.4** đã thống nhất các thay đổi chính |
| **SDD — Software Design Description** | [SDD.md](SDD.md) | Kiến trúc tổng thể, ranh giới module, quan hệ logic, tích hợp dữ liệu, API và DB | **v0.3 draft** (Bước 1–3) |
| **Shared Data Contract** | [shared-data-contract.md](shared-data-contract.md) | DTO, kiểu dữ liệu, enum, ràng buộc và đầu vào/đầu ra giữa các module | **v0.1 draft**, thuộc SDD Bước 2 |
| **API Contract** | [api/README.md](api/README.md) · [openapi.yaml](api/openapi.yaml) | Endpoint, request/response, lỗi, JWT, phân trang, import và offline-sync | **v0.1 draft**, OpenAPI 3.0.3; chưa xác nhận API chạy thật |
| **MongoDB Physical Design** | [mongodb-physical-design.md](mongodb-physical-design.md) | Collections, cấu trúc document, indexes, import và transaction đồng bộ | **v0.3 draft**; index chưa được benchmark |
| **Module Ownership** | [ownership.md](ownership.md) | Phân công trách nhiệm và quy tắc phối hợp của 5 thành viên | Đã có |
| **Technical Decisions** | [decisions.md](decisions.md) | Các quyết định đã chốt, lựa chọn đang mở và lý do thay đổi | Đã có; cần cập nhật khi quyết định mới được duyệt |


## 2. Sơ đồ thiết kế

| Sơ đồ | Xem nhanh | Chỉnh sửa |
|---|---|---|
| **System Architecture** — Client, Server, Shared Core, MongoDB, ML, Nginx, Offline | [PNG](diagrams/system-architecture.png) | [draw.io](diagrams/system-architecture.drawio) |
| **Logical Data Model** — thực thể, định danh và quan hệ | [PNG](diagrams/logical-data-model.png) | [draw.io](diagrams/logical-data-model.drawio) |

File `.drawio` là **bản gốc có thể chỉnh sửa**; file `.png` dùng để xem nhanh trên GitHub và nhúng vào SDD. Khi sửa sơ đồ, phải cập nhật cả hai bản.

## 3. Hợp đồng, mẫu dữ liệu và cấu hình liên quan

| File | Mục đích |
|---|---|
| [api/openapi.yaml](api/openapi.yaml) | Nguồn chuẩn mô tả hợp đồng **HTTP**; có thể xem bằng Swagger Editor/Redoc |
| [api/README.md](api/README.md) | Quy ước API, danh sách nhóm endpoint, vấn đề chưa chốt |
| [fixtures/contract-example.json](fixtures/contract-example.json) | Dữ liệu mẫu **DTO** cho Frontend / Offline / Engine |
| [fixtures/http-contract-examples.json](fixtures/http-contract-examples.json) | Ví dụ request/response để mock API và viết contract test |
| [`../shared-core/src/contracts/schemas.ts`](../shared-core/src/contracts/schemas.ts) | Bản khởi tạo TypeScript/Zod schema dùng chung (**cần review và chạy test**) |
| [`../infra/mongo/indexes.js`](../infra/mongo/indexes.js) | Script tạo MongoDB indexes đề xuất (**chưa có nghĩa đã chạy trong DB**) |

**Phân biệt:** Shared Data Contract định nghĩa **hình dạng dữ liệu giữa các module**; OpenAPI định nghĩa **cách giao tiếp HTTP**; MongoDB Physical Design mô tả **cách lưu trữ trên Server**. Không mặc định một DTO phải giống hệt MongoDB document.

## 4. Nên đọc tài liệu nào theo vai trò?

| Thành viên | Đọc trước | Đọc khi triển khai / tích hợp |
|---|---|---|
| **Khiêm — Backend & Database** | [SRS.md](SRS.md), [SDD.md](SDD.md) | [OpenAPI](api/openapi.yaml), [MongoDB Physical Design](mongodb-physical-design.md), [Shared Data Contract](shared-data-contract.md) |
| **Tài — React, Mapbox, Three.js** | [SDD.md](SDD.md) mục ranh giới module | [Shared Data Contract](shared-data-contract.md), [OpenAPI](api/openapi.yaml), [DTO fixture](fixtures/contract-example.json) |
| **Duy — PWA & Offline/Sync** | [SDD.md](SDD.md) phần tuyến offline và phụ thuộc | [Shared Data Contract](shared-data-contract.md), [API Contract](api/README.md), [HTTP fixtures](fixtures/http-contract-examples.json) |
| **Khải — Schema, Statistics & ML** | [Shared Data Contract](shared-data-contract.md) | [SDD.md](SDD.md) phần thuật toán/ML, [Zod schemas](../shared-core/src/contracts/schemas.ts), [OpenAPI](api/openapi.yaml) |
| **Cường — DevOps, CI & Testing** | [SDD.md](SDD.md), [ownership.md](ownership.md) | [API Contract](api/README.md), [MongoDB Physical Design](mongodb-physical-design.md), [indexes.js](../infra/mongo/indexes.js) và fixtures |

## 5. Những quy ước đã thống nhất cần giữ nhất quán

- **Miền dữ liệu:** MVP sử dụng phép đo **PM2.5** tại trạm cố định; không làm GPS trajectory hoặc LLM trong MVP.
- **Role ứng dụng:** `analyst` (người dùng chính) và `admin` (**Application Admin**). Không có role `viewer`. DevOps quản lý hạ tầng riêng, không phải role JWT.
- **Dữ liệu:** timestamp chuẩn UTC; tọa độ WGS84, GeoJSON Point theo thứ tự `[longitude, latitude]`; PM2.5 chuẩn `µg/m³`.
- **Import BR-08:** trong cùng dataset, trùng `(datasetId, sensorId, timestamp)` thì giữ **bản ghi hợp lệ đầu tiên**, bỏ các bản ghi đến sau và báo cáo trùng/xung đột; không âm thầm ghi đè.
- **Detector:** thống kê dùng chung ở `shared-core` để chạy online/offline; ML inference chỉ chạy trên Server.
- **Trực quan:** Mapbox 3D và Three.js Space–Time Cube là hai chế độ riêng, sử dụng cùng dữ liệu và bộ lọc.
- **Offline-first:** tự động cache những dữ liệu đã tải thành công; cho phép tải trước thêm dữ liệu; trạng thái chỉnh sửa anomaly được đưa vào outbox để đồng bộ lại. Không mặc định toàn bộ dataset đã có offline.
- **Sync:** sử dụng `clientMutationId` để tránh xử lý lặp và `baseVersion` để phát hiện xung đột.

Đây là **tóm tắt định hướng** để tìm tài liệu nhanh. Khi có tranh chấp về một trường hoặc một quy tắc, hãy mở tài liệu chuyên trách tương ứng thay vì dùng riêng bảng tóm tắt này.

## 6. Các quyết định đang mở — chưa tự ý triển khai như đã chốt

- `OPEN-02`: xử lý timestamp nguồn thiếu timezone.
- `OPEN-03`: model ML cuối cùng, đặc trưng đầu vào và cách lưu model.
- `OPEN-04`: ngưỡng phân loại `severity` và cấu hình detector mặc định.
- `OPEN-05`: giới hạn file upload, batch và báo cáo lỗi.
- `OPEN-06`: cách xử lý phân tích kéo dài (đồng bộ hay job bất đồng bộ).
- Các câu hỏi thiết kế phát sinh trong SDD/API: tọa độ trạm không nhất quán, enum vòng đời, phạm vi cache và checkpoint đồng bộ.

Chi tiết nằm trong [SRS](#1-danh-mục-tài-liệu), [API Contract](api/README.md), [Shared Data Contract](shared-data-contract.md) và [MongoDB Physical Design](mongodb-physical-design.md). Khi nhóm chốt, cập nhật tài liệu liên quan và ghi lại tại [decisions.md](decisions.md).

## 7. Cách cập nhật tài liệu trên Git

1. Làm việc trên nhánh công việc tạo từ `develop`; **tạo Pull Request vào `develop`**, không đẩy thẳng vào `main`.
2. Khi thay đổi yêu cầu nghiệp vụ: cập nhật **SRS**, sau đó kiểm tra các mục SDD/contract/test bị ảnh hưởng.
3. Khi thay đổi ranh giới module hoặc sơ đồ: cập nhật **SDD.md** và cả `.drawio` + `.png`.
4. Khi thay đổi DTO, payload, endpoint, enum hoặc ràng buộc đồng bộ: cập nhật **Shared Data Contract**, **OpenAPI**, schema TypeScript và fixtures tương ứng; thông báo các owner bị ảnh hưởng trước khi merge.
5. Khi thay đổi collections, indexes hoặc chiến lược transaction: cập nhật **MongoDB Physical Design** và script liên quan.
6. Ghi quyết định đã chốt vào **decisions.md**; lịch sử thay đổi chi tiết được lưu bằng Git commit/PR, không cần nhân bản tài liệu theo mỗi phiên bản.

**Nguyên tắc:** `docs/README.md` là **trang mục lục và hướng dẫn đọc**, không thay thế SRS, SDD, OpenAPI hoặc các đặc tả kỹ thuật chi tiết.
