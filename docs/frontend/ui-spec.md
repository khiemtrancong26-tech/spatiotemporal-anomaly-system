# M0 — Bố cục và quy ước giao diện

Đầu vào triển khai M1–M7, không phải giao diện đã chạy. Ngôn ngữ tiếng Việt, desktop là bố cục chính cho 3D; màn hình hẹp vẫn đọc bảng/form được. Phạm vi online, không có chỉ báo cache/sync/PWA.

## 1. Quy ước thiết kế bản đầu

| Hạng mục | Quy ước |
|---|---|
| Font | System UI: Segoe UI, system-ui, sans-serif; không cần tải font ngoài |
| Typography | Body 14px/1.5; form 16px; caption 12px; title 24px/1.3; section 18px/1.4 |
| Spacing | 4, 8, 12, 16, 24, 32px; padding trang 24 desktop, 16 màn hẹp |
| Màu | Nền #F8FAFC; surface #FFFFFF; text #0F172A; muted #475569; border #CBD5E1; primary #1D4ED8; error #B91C1C; warning #92400E; success #166534 |
| Shape | Radius 8px cho card/input/dialog; shadow nhẹ cho panel nổi, không lạm dụng |
| Điều khiển | Height tối thiểu 40px; vùng bấm chính 44px; focus ring rõ; disabled vẫn có lý do bằng text |
| Layout | Header 64px, nội dung thường max-width 1440px; workspace tận dụng chiều ngang; context panel khoảng 320px |
| Responsive | ≥1024px canvas + panel cạnh nhau; 768–1023px panel dạng drawer; <768px filter xếp dọc, panel dưới canvas, bảng cuộn ngang có nhãn |
| Dữ liệu | PM2.5 có µg/m³; score ghi tên detector, không đổi thành phần trăm; thời gian có nhãn UTC+07:00 |

Màu severity là nhãn detector, không AQI hay mức nguy hiểm sức khỏe. Review status dùng badge riêng có chữ. Kiểm tra contrast/focus thực tế khi M1/M8 có UI; bảng màu là đầu vào thiết kế, chưa phải chứng nhận accessibility.

## 2. P01 — Login

```text
                  PM2.5 Explorer
           Phân tích dữ liệu không gian–thời gian
            +--------------------------------+
            | Đăng nhập                      |
            | Tên đăng nhập [              ] |
            | Mật khẩu      [          ][ẩn] |
            | [Thông báo lỗi nếu có]         |
            | [          Đăng nhập         ] |
            +--------------------------------+
```

Form max-width 400px; label luôn hiện, Enter submit, pending khóa submit, lỗi thông tin đăng nhập không chỉ tô màu. Thành công vào Datasets hoặc route nội bộ đã yêu cầu nếu hợp lệ; không nhận redirect URL ngoài ứng dụng. Có liên kết đến `/register`: một form username/password, không chọn role; lỗi trùng username/validation được hiển thị, thành công chuyển về Login, không auto-login. Không có quên mật khẩu.

## 3. P02 — Datasets

```text
PM2.5 Explorer | Datasets | [Tài khoản — chỉ admin]     user [Đăng xuất]
Datasets                                             [+ Nhập dataset]
Sắp xếp [Mới nhất v]
+----------------------+--------------------+-------------+------------+
| Tên dataset          | File nguồn         | Ngày tạo    | Hành động  |
| PM2.5 demo           | demo.csv           | ... UTC+07  | Mở dữ liệu |
| Import summary nếu có, trình bày ở dòng phụ                          |
+--------------------------------------------------------------------+
Đã tải N dataset                                  [Tải thêm]
```

Imported là điều kiện danh sách, không cho người dùng tự đổi lifecycle ở đây. Không có total pages khi API không trả total. Empty state có CTA nhập dữ liệu; lỗi tải thêm giữ nguyên các hàng đã tải và đặt retry ở cuối.

## 4. P03 — Import Wizard

```text
< Datasets         Nhập bộ dữ liệu PM2.5
1 Upload  →  2 Validation  →  3 Mapping  →  4 Kết quả
+-------------------------------------------------------------------+
| Nội dung bước hiện tại                                            |
| Upload: file CSV/JSON + tên dataset                               |
| Validation: tổng/hợp lệ/lỗi + bảng dòng/trường/mã lỗi              |
| Mapping: trường chuẩn | cột nguồn; đơn vị hỗ trợ; lưu ý thời gian  |
| Kết quả: trạng thái Server + import summary + cảnh báo             |
+-------------------------------------------------------------------+
[Quay lại nếu trạng thái cho phép]                  [Hành động bước]
```

Không giả lập phần trăm import. Tên bước không thay cho lifecycle Server. Không thêm preview hàng nguồn vì ValidationReport hiện không trả dữ liệu mẫu. Lỗi dòng rất dài cần vùng cuộn/giới hạn render và thông báo số issues nhận được, không tự khẳng định đã liệt kê hết lỗi.

Chưa xác nhận được mapping/timezone thì không báo sẵn sàng nhập. Trong mock có thể diễn giải các case; luồng dữ liệu nguồn chưa chốt phải theo R05 trước M3 tích hợp.

## 5. P04 — Workspace / Visualization

```text
< Datasets | Dataset đang mở                         user [Đăng xuất]
+-------------------------------------------------------------------+
| Trạm [Tất cả / chọn 1]  Bbox [chọn vùng / tọa độ]                   |
| Từ [ngày giờ] Đến [ngày giờ] UTC+07:00   [Lọc] [Xóa bộ lọc]        |
+-------------------------------------------------------------------+
Visualization | Analysis | Anomalies
[Mapbox 3D | Space–Time Cube]  Đã tải N readings · Còn trang [Tải thêm]
+-------------------------------------------+-----------------------+
| Canvas                                    | Chi tiết đã chọn      |
|                                           | Trạm, timestamp       |
| Legend PM2.5 (µg/m³)                      | PM2.5, tọa độ         |
| [Reset camera] [Lớp anomaly bật/tắt]       | Anomaly liên quan     |
+-------------------------------------------+-----------------------+
[Xem bảng readings đã tải]    Nhãn giới hạn tập dữ liệu hiển thị
```

Bbox không đồng nghĩa camera viewport, chỉ áp dụng khi người dùng xác nhận vùng. Cube có trục không gian X/Y và thời gian Z; một reading ứng với một điểm. Mapbox có điểm trùng vị trí theo thời gian: M4 phải thiết kế chọn mốc/nhóm reading và hiển thị rõ thời điểm, không tự lấy “mới nhất toàn dataset” từ trang hiện có.

Chọn trạm hiển thị externalId/name nhưng gửi Sensor.id. Đổi renderer giữ filter/selection; chỉ renderer đang mở được chạy. Lỗi Mapbox vẫn cho chuyển Cube/bảng; nếu WebGL không có thì dùng bảng, không hứa Cube hoạt động. Những trạng thái này phục vụ dữ liệu online đã tải, không quảng cáo chế độ offline.

## 6. P05 — Tab Analysis

```text
Phạm vi analysis: Dataset ... | Trạm ... | Từ ... đến ... (UTC+07)
[Cảnh báo nếu bbox chưa thể chuyển thành scope hợp lệ]
Nhóm [Thống kê / ML]  Phương pháp [theo contract]
Cấu hình [các field được method hỗ trợ]              [Chạy phân tích]
Trạng thái request/run · Kết quả/không có anomaly/lỗi
Lịch sử: thời gian | family | method | status | [Xem anomaly]
[Tải thêm]
```

Phạm vi analysis phải được xác nhận rõ, không dùng số điểm đang render để mô tả toàn bộ đầu vào Server. Nút ML có lý do disabled khi model chưa được hỗ trợ. Không dựng biểu đồ so sánh method hoặc form JSON tự do như UI cuối cùng khi config chưa được chốt.

## 7. P06 — Tab Anomalies và panel review

```text
Phạm vi: dataset + thời gian; trạm/bbox của Visualization không áp dụng
Run [...] Family [...] Method [...] Severity [...] Status [...] [Lọc]
+-------------------------------------------+-----------------------+
| Timestamp | Method | Score | Severity     | Chi tiết anomaly      |
| Status | [Mở]                             | Reading (nếu đã tải)  |
| ...                                      | status [v] note [...] |
| [Tải thêm]                                | version ... [Lưu]     |
+-------------------------------------------+-----------------------+
```

Mỗi timestamp vẫn kèm timezone. Không có giá trị reading thì ghi “Chưa tải phép đo”, không để 0. Conflict: panel giữ bản nhập, hiển thị bản Server mới sau GET, cho bỏ bản nhập hoặc chỉnh lại trên bản mới; chỉ gửi lại khi người dùng chủ động xác nhận. Nếu GET bản mới lỗi, cho retry, không tự thay baseVersion.

## 8. P08 — Admin Users

```text
Quản lý tài khoản                                [+ Tạo tài khoản]
Sort [Username A–Z v]
Username | Role | Đang hoạt động | [Sửa]
[Tải thêm]

Dialog tạo: username, password, role           [Hủy] [Tạo]
Dialog sửa: role, isActive                     [Hủy] [Lưu]
```

Password create tối thiểu 8 ký tự theo OpenAPI; login không áp giới hạn 8 như create. Không có delete/reset password/search toàn hệ thống. Nếu thêm lọc nhanh client, nhãn bắt buộc “Trong danh sách đã tải”.

## 9. Component và trạng thái dùng chung

AppHeader, PageTitle, Button, Field/Input/Select, FormError, Table, CursorLoadMore, Dialog/Drawer, StatusBadge, LoadingState, EmptyState, ErrorState, DatasetFilters, TimeRangeField, ContextPanel và Legend.

- Initial loading khác loading thêm trang; lỗi không ghi đè thành empty state.
- Network/server error có retry phù hợp; không tự retry POST/PATCH bằng payload/key khác.
- 401 yêu cầu đăng nhập lại, 403 cấm quyền, 404 không tìm thấy resource đã được Server xác nhận; lỗi map khác lỗi API.
- Mutation success chỉ sau Server response hợp lệ. Hủy/mất response có thể là kết quả chưa xác định.
- Dùng label, aria-live cho thông báo quan trọng, focus vào lỗi đầu tiên, trả focus khi đóng dialog, cảnh báo bản review chưa lưu khi rời ngữ cảnh.
- Có dữ liệu mock thì hiện nhãn trong app shell; không dùng fixture score làm bằng chứng thuật toán hoặc chất lượng không khí.
