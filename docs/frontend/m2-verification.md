# M2 — Frontend Auth, Register, Datasets và Workspace

Ngày: 13/11/2026. Phạm vi: M2 trong [kế hoạch](../frontend-online-plan.md), gồm Register được người dùng bổ sung và sau đó cho phép implement frontend. Backend chưa có implementation trong checkout.

## Chức năng và quyết định

- Login gọi `/auth/tokens`, khóa submit, báo lỗi sai thông tin; lưu riêng token vào sessionStorage theo mode. Không lưu password hoặc tin tưởng role lưu trên trình duyệt.
- Khi reload có token, chờ `/users/me` kiểm tra trước khi mở nội dung bảo vệ. Phiên lỗi kết nối có retry; inactive/401 kết thúc phiên. Request cũ dùng token khác không được xóa phiên mới.
- Menu/guard dùng role từ phiên. Analyst không mở khu vực Admin; 403 từ API hiển thị lỗi mà không tự đăng xuất. Logout xóa token, user, metadata dataset và state workspace; response trễ không khôi phục phiên đã thoát.
- Register `/register` là route công khai, chỉ gửi username/password đến `/auth/register`. Client validation password tối thiểu 8; không có field role. 409 thông báo tên trùng, 422 thông báo validation, 201 xóa password khỏi state và về Login. Không tự gọi login hoặc lưu token. Validator từ OpenAPI từ chối request có role và response Register có role admin.
- Datasets gọi API thật qua adapter hoặc mock đã chọn tường minh; chỉ hiển thị imported, có sort hai chiều, cursor/load-more, empty/loading/error/retry. Load-more lỗi giữ các hàng trước; đổi sort bỏ cursor và kết quả cũ.
- Workspace giữ filter/tab/selection trong RAM theo dataset. Kiểm tra bbox và thời gian UTC+07 rồi chuyển UTC; giữ filter khi đổi tab và đồng bộ lại form khi quay về cùng workspace. Đổi dataset xóa scope/selection cũ.
- Người dùng đã chốt R02: sessionStorage và `/users/me` sau reload; R03: mở deep-link bằng datasetId và thông báo thiếu metadata, không tự scan mọi trang hay giả định 404. Metadata chọn từ Datasets giữ trong RAM, mất khi reload. Query/render readings nối ở M4.

## Những điểm sửa khi rà soát

1. Nối Register vào public route guard, interface, adapter và generated contract; hiện có 19 operations online/health và 31 schemas.
2. Bổ sung 3 fixtures Register; script kiểm tra fixture cập nhật số operations hiện tại, không sửa các báo cáo kiểm thử lịch sử của M0/M1 thành kết quả mới.
3. Sửa import JSON trong Playwright để chạy trên Node hiện tại.
4. Bỏ dropdown xem thử quyền khỏi shell; mock nhận role từ tài khoản/token demo. Mock có username trùng và tài khoản mới trong RAM để thử Register → Login; không phải implementation auth của Backend.
5. Ngăn response login sau khi rời form tạo phiên ngoài ý muốn; AbortSignal được truyền qua adapter, session không áp dụng kết quả đã bị hủy.
6. Giữ đúng các listener của cursor controller khi effect cleanup/setup lại; không để đổi sort làm UI mất cập nhật. Form workspace khôi phục filter trong RAM khi điều hướng trở lại.
7. Chỉnh nút logout và header màn hình hẹp; giữ nhãn mock rõ ràng.

## Kiểm chứng thực tế

| Lệnh/kiểm tra | Kết quả |
|---|---|
| `npm run check` | PASS: sinh contract/routes, TypeScript strict, ESLint, 58 Vitest tests/7 files, build online |
| `npm run test:e2e` | PASS: 5 Chromium tests, gồm desktop/mobile và production build online với HTTP intercept |
| `python docs/frontend/verify_m0.py` | PASS: 33 fixture cases, 19 operations, 7 DTO objects, 7 legacy payloads; partial-review bị từ chối |
| Kiểm tra hình ảnh | Đã xem screenshot desktop/mobile; không thấy tràn ngang hoặc chồng nội dung |

E2E bao phủ: sai mật khẩu; analyst/admin login; reload kiểm tra current user; logout xóa token; guard Admin; 401 xóa phiên; 403 giữ phiên; chuyển tab và quay lại workspace giữ filter; deep-link thiếu metadata; pagination lỗi/retry và empty; username trùng; Register về Login không có token, sau đó đăng nhập thủ công.

Môi trường: Windows, Node 24.14.1, Playwright Chromium. Screenshot ở `client/test-results/m2-desktop.png` và `m2-mobile.png`, được tạo lại bởi E2E và không commit.

## Giới hạn và bước tiếp theo

Đây là hoàn thành implementation/kiểm thử **phía frontend M2**. Guard UI không thay cho RBAC Server. Register thật, username uniqueness khi request đồng thời, password hashing, JWT thật và database vẫn cần Backend hiện thực/kiểm tra. Mock tài khoản mới chỉ ở RAM, mất khi reload; digest demo không phải thuật toán hashing production.

M3 tiếp theo: Import Wizard. Renderer/tra cứu readings thuộc M4; analysis/review/admin CRUD thuộc M5–M7. Không triển khai PWA, offline/sync, email verification, forgot password hay auto-login. Xác nhận interface với Duy (R01) vẫn còn mở.
