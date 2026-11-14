# D008 — Bàn giao cập nhật tài liệu Analysis async

Ngày 13/11/2026; branch khiem/backend-database. Chỉ tài liệu/contract và mẫu fixture thiết kế, chưa triển khai M5/worker hoặc migrate code. Không commit/push. Các thay đổi M3/M4 có sẵn trong working tree được giữ nguyên.

## Thay đổi

- FE Plan: M5 thay synchronous bằng tiếp nhận/theo dõi/phục hồi; bổ sung audit M0, migration M1, test M8; M6 chỉ bổ sung điều kiện kết quả đã công bố. Không đổi workflow M2/M3/M4/M7 trong đợt này.
- BE Plan: B5 async statistical/ml, GET run detail, durable acceptance/replay/concurrency/recovery, B6 visibility và B8 nghiệm thu; bảng 20 online operations.
- SRS UC-04/OPEN-06, SDD tuyến thực thi/mục ML/API, Shared Contract, ghi chú MongoDB physical, decisions D008 và docs index nhất quán. Không thiết kế collection/index/queue mới.
- OpenAPI v0.3.0-draft: POST analysis 201 → 202, bỏ anomalies trong AnalysisCreateResponse, thêm đúng GET analysis-runs/{id}; status queued, scope snapshot bắt buộc, error terminal an toàn và completedAt khi terminal. Schema từ chối failed thiếu error hoặc queued có completedAt. Anomalies chỉ công bố completed, query theo run chưa sẵn sàng 409. Import vẫn synchronous 200.
- API README, UI spec, M0 matrix/interface/type snapshots và fixtures cập nhật mục tiêu mới. README client/server/shared-core ghi rõ migration còn chờ.
- Hai tài liệu ngoài Git cũng đã cập nhật phần Analysis: `C:/ổ D/User/PC/Documents/Downloads/User_Flow_PM25.md`, `Page_Outline_PM25.md`. Các đoạn offline/import giữ nguyên.

## Kiểm chứng tài liệu

- YAML parse không duplicate key; 21 paths / 25 operation IDs duy nhất, 20 online/health; mọi local $ref resolve được.
- 38 online fixture cases, 7 core DTO objects và 7 legacy payloads hợp lệ với schema mới; case partial-review vẫn bị từ chối.
- Negative checks: failed thiếu error, queued có completedAt và run thiếu scope đều bị từ chối.
- Kiểm tra POST Analysis có 202, không còn 201; Import có 200 và không có 202. git diff --check đạt.
- Để kiểm tra fixtures, chạy nội dung công cụ `verify_m0.py` với duy nhất guard 19 → 20 thay trong bộ nhớ, không ghi lại script. Lệnh trực tiếp của script lịch sử vẫn dừng ở guard 19; cập nhật guard/tests là follow-up M1, không được coi lượt này là test runtime.

## Bước code kế tiếp, chưa thực hiện

1. Cập nhật shared-core Zod/types/tests theo DTO mục tiêu.
2. Cập nhật whitelist/generator/runtime adapter `analysis.create/get/list`, generated TS/schema, mock và tests theo 20 operations. Fixtures tài liệu đã đổi nhưng mock runtime/validator cũ còn lệch; không coi các báo cáo test M1–M4 cũ là kiểm chứng contract mới. Không regenerate riêng lẻ rồi coi migration đã xong.
3. Chốt các operating policies D008 (retention/recovery/claim/concurrency/admission/poll interval), detector contract và scope trước code B5/M5 phụ thuộc.
4. Triển khai/kiểm thử runtime theo M5/B5, nghiệm thu thật theo M8/B8. Không dùng schema fixtures để chứng minh Server durable hoặc chống trùng đã hoạt động.

**Cập nhật 14/11/2026:** migration client/shared-core D008 và FE M5 đã triển khai theo D009; ghi chú “chưa migrate” ở phần lịch sử mô tả đợt docs trước. Backend/ML thật vẫn chờ; xem `docs/frontend/m5-verification.md`.
