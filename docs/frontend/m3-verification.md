# M3 — Import Wizard verification

Ngày: 2026-11-13. Phạm vi: frontend online, không triển khai Backend/PWA/Offline/Sync.

## Hành vi

- Route `/datasets/import` dùng adapter thật: upload multipart CSV/JSON, validation, PUT mapping, POST import. Khóa nút khi pending; không giả lập phần trăm tiến độ.
- Hiển thị số dòng, cột nguồn, gợi ý và issues từ Server. Mapping yêu cầu đủ năm trường; chỉ gửi unit `ug/m3`. Người dùng xác nhận nguồn có Z/offset, không suy đoán timezone hay chuyển đơn vị. Backend vẫn chịu trách nhiệm kiểm tra nội dung file.
- 413/415/422 upload cho sửa file và tạo ý định mới. Mất phản hồi giữ file/tên/key bất biến trong RAM để retry cùng thao tác. Reload chỉ giữ ID/key trong sessionStorage theo mode, không lưu file/dữ liệu nguồn; login/logout/401 xóa ngữ cảnh cùng phiên.
- Reload có ID đọc lại validation, không tự mutation. Nếu chưa gửi import phải xác nhận lại mapping; nếu đã gửi import thì giữ mapping trên Server và retry cùng key, không sửa ý định cũ. Upload mất phản hồi trước ID không tự gửi lại sau reload.
- Validation mới thay trạng thái cũ; failed yêu cầu Backend xác nhận cleanup, không tự tạo key mới. Imported chỉ mở workspace khi có Dataset từ response import; recovery chỉ có validation imported hướng về danh sách để chọn metadata.
- Chỉ import thành công mới thêm metadata vào RAM; danh sách imported vẫn đọc Server. Cảnh báo khi rời wizard còn dở; hủy chờ không coi là hủy xử lý Server.

## Kiểm chứng

- `npm run check`: typecheck, lint, 58 unit/component tests và production build.
- `npm run test:e2e`: 8 tests Chromium, gồm 3 tests M3 trên production online build với HTTP interception: mất response upload/import và giữ key qua retry/reload; xác nhận lại mapping; 413/415/422 và unknown upload; phục hồi importing/failed/imported không tự mutation. Các tests M2 tiếp tục chạy.
- Ảnh desktop/mobile: `client/test-results/m3-desktop.png`, `m3-mobile.png`; kiểm tra viewport 390px không tràn ngang.

## Giới hạn nghiệm thu

API trong E2E là response fixture qua HTTP interception, không phải Backend thật. Mock transport vẫn trả mutation fixture, không mô phỏng đầy đủ database/receipt/import lifecycle. Chưa chứng minh Server chống tạo bản ghi trùng, xử lý file thật hay cleanup failed; phải nghiệm thu khi Backend sẵn sàng. Không có GET dataset detail nên recovery không tự khôi phục metadata/mapping đã lưu. Đóng tab làm mất ngữ cảnh sessionStorage theo lựa chọn đã chốt.
