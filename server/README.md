# Server

Backend Fastify + TypeScript.

- Người phụ trách: Khiêm.
- MongoDB, API, Auth, Dataset Import và Synchronization.
- Tích hợp Statistical Engine và ML Inference.

Trạng thái: Chưa khởi tạo Backend.


## Contract Analysis mục tiêu — D008

Tài liệu OpenAPI v0.3.0-draft chuyển cả statistical/ml sang POST 202 và GET `/analysis-runs/{id}`, không anomalies trong response POST. Xem [D008](../docs/decisions.md#d008--analysis-online-bất-đồng-bộ). Đợt này chỉ cập nhật tài liệu: runtime/generated types/shared-core Zod/mock/tests chưa migrate; các số liệu kiểm thử trước D008 không chứng minh async hoạt động. Cập nhật đồng bộ tại follow-up M1/B0 trước M5/B5; Import giữ nguyên.
