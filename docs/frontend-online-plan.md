# Kế hoạch hoàn thiện Frontend P0 online — PM2.5

Ngày lập: 13/11/2026. Trạng thái: **M1 đã triển khai và kiểm tra; M0 còn xác nhận interface với Duy; chưa triển khai nghiệp vụ M2–M8**.

## 1. Mục tiêu và cơ sở lập kế hoạch

Hoàn thiện frontend để analyst/admin thực hiện trọn luồng online: đăng nhập → chọn hoặc nhập dataset → tra cứu → xem Mapbox 3D/Space–Time Cube → chạy analysis → xem và review anomaly. Admin có thêm quản lý tài khoản.

Hiện trạng kiểm tra: `client/` mới có README, chưa có ứng dụng React, package riêng, màn hình hay kiểm thử frontend. Root đã khai báo npm workspaces. Vì vậy đây là kế hoạch xây dựng từ scaffold đến tích hợp, không phải kế hoạch sửa một giao diện đã có.

Nguồn tham chiếu:

- [SRS](SRS.md), [SDD](SDD.md), [ownership](ownership.md), [shared-data-contract](shared-data-contract.md).
- [OpenAPI](api/openapi.yaml) và [API README](api/README.md): nguồn chuẩn cho HTTP, hiện là draft, chưa chứng minh Backend đã chạy.
- [DTO fixtures](fixtures/contract-example.json), [HTTP fixtures](fixtures/http-contract-examples.json): dữ liệu mẫu để phát triển, không phải kết quả thật.
- `Page_Outline_PM25.md` và `User_Flow_PM25.md` do người dùng cung cấp: tham chiếu màn hình/hành trình. Các đề xuất và chỉ dẫn trong tài liệu không tự trở thành yêu cầu bổ sung ngoài phạm vi người dùng đã chốt.

Phạm vi đã được người dùng xác nhận: **P0 online + lớp gọi API online qua interface có thể nối module của Duy về sau**. Không mở rộng P1/P2.

## 2. Phạm vi và ranh giới

### 2.1. Phần phải hoàn thành

| Khu vực | Kết quả cần có |
|---|---|
| P01 — Login | Đăng nhập, kiểm tra phiên online, route guard, phân quyền giao diện, xử lý 401/403, đăng xuất phía client |
| P02 — Datasets | Danh sách imported, sort/cursor, chọn dataset, điều hướng vào workspace/import |
| P03 — Import Wizard | Upload CSV/JSON → validation report → xác nhận mapping → import → kết quả |
| P04 — Workspace | Bộ lọc chung, tra cứu readings/sensors, Mapbox 3D, Space–Time Cube, chọn điểm và panel chi tiết |
| P05 — Analysis | Chạy thống kê/ML qua Backend, xem lịch sử, xem kết quả và lớp anomaly |
| P06 — Anomalies | Danh sách/lọc/phân trang, chi tiết, sửa status/note, xử lý version conflict khi lưu online |
| P08 — Admin users | List/create/update role hoặc isActive; chỉ admin truy cập |
| Chất lượng chung | Trạng thái UI, accessibility cơ bản, responsive, kiểm thử, hiệu năng 3D, hướng dẫn chạy và tích hợp |

### 2.2. Ngoài phạm vi lần này

- PWA, manifest cài đặt, service worker, app-shell cache.
- IndexedDB/Dexie, auto-cache bền vững, prefetch/export để dùng offline.
- Outbox, push/pull sync, checkpoint, review offline, UI trạng thái sync và P07.
- Khôi phục phiên làm việc offline, lưu bền vững camera/dataset/filter, thống kê cục bộ qua Browser Web Worker.
- P1 aggregates/LOD; P2 thuật toán nâng cao và so sánh thuật toán.
- Backend, database, thuật toán detector, training/inference engine và hạ tầng triển khai.
- Dashboard KPI mới, đăng ký công khai, quên mật khẩu, endpoint mới chưa có contract.

Xử lý request thất bại do mất mạng và conflict `409` khi PATCH online **vẫn thuộc phạm vi**. Đây là hành vi cần thiết của frontend online. Không báo lưu thành công khi Server chưa xác nhận, không tự tạo hàng đợi gửi lại khi có mạng.

## 3. Kiến trúc triển khai

Giữ định hướng trong SDD: React + Vite + TypeScript, TanStack Router file-based routing, feature modules, Zustand cho trạng thái workspace dùng chung, Mapbox GL JS và Three.js. Phiên bản dependency được kiểm tra và khóa khi khởi tạo; kế hoạch không tự ấn định phiên bản.

```text
client/src/
  app/                       # bootstrap, providers, cấu hình, styles
  routes/                    # route, guard, ghép page
  features/
    auth/
    datasets/
    dataset-import/
    workspace/               # filter, selection, chuyển renderer
    visualization/           # Mapbox và Cube
    analysis/
    anomalies/
    admin-users/
  shared/
    api/                     # HTTP transport, lỗi, auth, idempotency
    data-source/             # interface + online adapter
    ui/                      # form, table, dialog, trạng thái dùng chung
    lib/                     # thời gian, tọa độ, pagination
  mocks/                     # fixture/transport cho development và test
```

Luồng dữ liệu: **page/hook → interface dữ liệu → online adapter → HTTP client → `/api/v1`**. Renderer nhận DTO/view model và callback chọn điểm; không gọi API nghiệp vụ trực tiếp. Browser gọi Mapbox trực tiếp bằng public token theo SDD.

- Interface bao phủ các thao tác cần cho auth, datasets/import, sensors/readings, analysis, anomalies/review và admin; có kiểu input/output, cancellation và lỗi rõ ràng.
- Online adapter không tham chiếu IndexedDB/outbox/worker. Mock dùng cùng contract với adapter thật; chế độ mock phải được nhận biết rõ và không tự bật khi API thật lỗi.
- State dữ liệu request nằm ở hooks/lớp dữ liệu; Zustand giữ bộ lọc, chế độ xem và selection. Không nhân bản toàn bộ readings vào nhiều store.
- Tách state theo dataset; reset cursor, selection không còn hợp lệ và dữ liệu cũ khi đổi phạm vi. Hủy hoặc bỏ qua response cũ để tránh trộn kết quả khi thao tác nhanh.
- Cache RAM phục vụ phiên đang mở được phép; không coi đó là khả năng offline hay bảo đảm lưu bền vững.
- Khi nối module của Duy, thay adapter tại điểm khởi tạo hoặc ghép adapter online vào `dataSource` chung; không sửa lại từng renderer. Chữ ký interface cần được Tài/Duy thống nhất, không coi bản đề xuất là hợp đồng đã được cả nhóm duyệt.

Route đề xuất cho triển khai: `/login`, `/datasets`, `/datasets/import`, `/workspace/$datasetId`, `/admin/users`. Visualization/Analysis/Anomalies nằm trong cùng workspace, giữ chung ngữ cảnh. Chưa cần thêm trang anomalies toàn hệ thống.

## 4. Các mốc triển khai và tiêu chí hoàn thành

Các checkbox là việc cần thực hiện, chưa đánh dấu hoàn thành chỉ vì đã có thiết kế hoặc mock.

### M0 — Khóa các đầu vào cần thiết

- [x] Đối chiếu OpenAPI với shared types/fixtures; ghi lại điểm lệch trước khi sinh kiểu hoặc dùng schema. Audit C01–C14 trong [M0 readiness](frontend/m0-readiness.md); đã sửa fixture review thiếu trường.
- [ ] Chốt interface online với Duy, lỗi trả về và cơ chế hủy request; thống nhất điểm thay adapter. **Đã soạn [interface bản đầu](frontend/online-data-source.d.ts), chưa có xác nhận của Duy (R01).**
- [x] Lập ma trận endpoint cần dùng, trạng thái Backend đã có/chưa có, người phụ trách và fixture thay thế. 18 operations online/health, chưa có implementation Backend trong checkout.
- [x] Phác bố cục login, datasets, wizard, workspace và admin; thống nhất spacing, typography, màu và component cơ bản. Bản đầu FE tại [UI spec](frontend/ui-spec.md), chưa phải UI đã chạy.
- [x] Chốt quy ước timezone hiển thị và form thời gian; UTC gửi qua API, nhãn timezone rõ trên UI. Chọn UTC+07:00 (Asia/Ho_Chi_Minh); timestamp nguồn thiếu offset vẫn là vấn đề import riêng.
- [x] Ghi các quyết định còn thiếu vào bảng mục 6 và [sổ quyết định M0, R01–R11](frontend/m0-readiness.md#5-quyết-định-fe-và-phụ-thuộc-chưa-chốt); fixtures có ghi rõ là dữ liệu giả, chưa tích hợp API thật.

**Bàn giao M0:** [audit, ma trận API, quyết định và backlog M1](frontend/m0-readiness.md), [bố cục UI](frontend/ui-spec.md), [fixtures online](fixtures/frontend-online-examples.json). Đủ đầu vào để bắt đầu M1 độc lập; không tính xác nhận liên nhóm đã hoàn thành.

**Đầu ra:** backlog theo feature, interface bản đầu, ma trận contract và bố cục đủ để bắt đầu. Những blocker riêng của import/analysis không chặn scaffold hoặc các màn hình độc lập.

### M1 — Khởi tạo ứng dụng và lớp dữ liệu online

- [x] Khởi tạo package `client` trong npm workspaces; cấu hình TypeScript, Vite, router, lint và các script chạy/build/check/test.
- [x] Dựng layout, navigation theo role xem thử trong mock, not-found/error boundary và component loading/empty/error/retry. Auth/guard thật vẫn thuộc M2.
- [x] Xây HTTP client: Bearer từ token getter, JSON/multipart đúng chuẩn, error envelope, cancellation, phân biệt HTTP lỗi với network lỗi.
- [x] Dùng base URL đúng `/api/v1`; sửa `.env.example` và thêm env mẫu tại client. Kiểm tra public Mapbox token; không dùng secret token.
- [x] Implement interface + adapter online + mock fixtures đúng từng envelope; kiểm tra đủ 18 operations, sinh type/schema từ OpenAPI.
- [x] Chuẩn hóa cursor: limit mặc định 100, tối đa 200 theo draft; reset khi filter/sort đổi; chỉ dùng sort được endpoint hỗ trợ. Có kiểm thử response race và load-more retry.
- [x] Quản lý `Idempotency-Key` cho upload, import, analysis và create user: helper giữ key/payload cho retry, thao tác mới có key mới; các operation bắt buộc header được kiểm tra trước khi gửi. Không tự retry mutation.
- [x] Chuẩn bị kiểm thử logic trọng yếu và integration UI: Vitest, React Testing Library và Playwright chạy đạt; có coverage và kiểm tra desktop/mobile.

**Bằng chứng M1:** [kết quả kiểm tra](frontend/m1-verification.md), [hướng dẫn chạy client](../client/README.md). 46 tests logic/UI + 3 tests Chromium đã đạt. API thật chưa tồn tại trong checkout; mock/HTTP-intercept tests không thay cho nghiệm thu Backend.

**Nghiệm thu:** ứng dụng chạy/build được; mock và online đi qua cùng interface; lỗi và pagination không phải viết lại ở từng feature.

### M2 — Auth, Datasets và bộ khung Workspace

**Đang thực hiện:** đã có `client/src/features/workspace/state.ts` và `filters.ts`: state theo phiên/dataset, giữ filter khi đổi tab, xóa selection khi đổi filter, chuyển thời gian UTC+07 sang UTC và kiểm tra bbox. Bốn kiểm thử riêng đã đạt; chưa nối vào UI. Đang chờ người dùng chọn chính sách giữ phiên sau reload (R02) và hành vi deep-link thiếu metadata (R03); chưa đánh dấu các đầu việc M2 hoàn tất.

- [ ] Login với `POST /auth/tokens`, current user qua `GET /users/me` khi cần; khóa submit trong lúc gửi, thông báo sai thông tin rõ ràng.
- [ ] Route guard, menu theo role, xử lý token hết hạn/401 và cấm quyền/403. Chốt cơ chế giữ token của phiên online trước khi triển khai; không tự thêm refresh-token flow.
- [ ] Đăng xuất xóa token và dữ liệu nhạy cảm của phiên client; không gọi endpoint logout chưa tồn tại.
- [ ] Datasets chỉ hiển thị dữ liệu imported, metadata API có trả, sort và tải trang tiếp theo; đủ loading/empty/error.
- [ ] Dựng workspace với dataset hiện tại, bộ lọc trạm/bbox/from-to, tabs và panel selection.
- [ ] Thống nhất cách xử lý URL mở thẳng/reload khi chưa có metadata. Không mặc định dataset không tồn tại chỉ vì không thấy ở trang danh sách đầu tiên.

**Nghiệm thu:** đăng nhập hai role, chọn dataset, mở workspace, chuyển tab không mất filter; không lộ dữ liệu phiên trước sau logout. Deep-link có hành vi rõ, không crash hay giả định metadata.

### M3 — Import Wizard hoàn chỉnh

- [ ] Bước upload: file CSV/JSON, tên dataset, trạng thái đang gửi, xử lý 413/415/422 và network error.
- [ ] Bước validation: số dòng valid/invalid, cột nguồn, lỗi theo dòng/trường, mapping gợi ý; phân biệt dữ liệu Server trả với dữ liệu UI tự hiển thị.
- [ ] Bước mapping: sửa `fieldMap`, kiểm tra đủ sensorId/latitude/longitude/timestamp/value, gửi PUT thay toàn bộ mapping; đơn vị theo contract `ug/m3`.
- [ ] Chặn hành vi tự đoán timezone nguồn thiếu offset hoặc hứa quy đổi đơn vị chưa được hỗ trợ; xử lý theo quyết định của nhóm ở mục 6.
- [ ] Bước import: POST với key; hiển thị đúng lifecycle Server và importSummary, kể cả trùng hoàn toàn/xung đột nếu response có trả.
- [ ] Chỉ mở workspace và cập nhật danh sách imported sau khi Server xác nhận hoàn tất.
- [ ] Cảnh báo khi rời wizard chưa xong; thực hiện phương án reload/recovery đã thống nhất. Không tự gửi lại import như thao tác mới khi chưa rõ request trước đã hoàn tất hay chưa.

**Nghiệm thu:** hoàn thành luồng với file hợp lệ; file lỗi hiển thị đúng nguyên nhân; thao tác gửi lại không tạo import trùng; dataset thất bại không xuất hiện như dữ liệu dùng được.

### M4 — Tra cứu và hai chế độ trực quan

- [ ] Nối sensors/readings theo dataset và filter; có validation from/to, bbox hợp lệ, sort và tải thêm trang có kiểm soát.
- [ ] Hiển thị số điểm đã tải và trạng thái còn trang; không trình bày tập con như toàn bộ dataset.
- [ ] Mapbox 3D: nền bản đồ, vị trí trạm/điểm đọc, biểu diễn PM2.5 có legend/đơn vị, chọn điểm và điều khiển camera. Quy tắc xử lý nhiều thời điểm tại cùng trạm phải rõ; không tùy tiện chồng điểm khiến người dùng hiểu sai giá trị đang xem.
- [ ] Cube: chuyển tọa độ địa lý sang hệ tọa độ render nhất quán, X–Y là không gian, Z là thời gian; nhãn trục, legend, điều khiển camera/reset và chọn điểm.
- [ ] Hai renderer dùng chung dữ liệu/phạm vi/selection; panel chi tiết có trạm, thời gian, PM2.5 và anomaly liên quan khi được tải.
- [ ] Chỉ một renderer nặng hoạt động; cleanup canvas, event listeners, render loop và GPU resources khi chuyển hoặc rời workspace.
- [ ] Có thông báo khi Mapbox lỗi token/tiles hoặc WebGL không khả dụng, cùng bảng dữ liệu/panel để người dùng tiếp tục xem dữ liệu online đã tải.
- [ ] Đặt ngân sách số điểm/memory theo phép đo; việc giảm số điểm hiển thị phải có nhãn. Không tự biến thành dự án aggregates/LOD P1.

**Nghiệm thu:** cùng bộ lọc cho cùng tập dữ liệu giữa Mapbox và Cube; tọa độ/thời gian đúng, chọn đúng reading; đổi dataset nhanh không trộn kết quả; không mặc định tải hết 100k–500k readings.

### M5 — Analysis online và lịch sử

- [ ] Form family/method/config dựa trên detector contract đã được Khiêm/Khải xác nhận; không hardcode thuật toán ứng viên thành tính năng đã hỗ trợ.
- [ ] Hiển thị rõ phạm vi chuẩn bị phân tích. API hiện nhận `scope.sensorIds/from/to`, chưa nhận bbox; thực hiện quyết định mục 6, không âm thầm bỏ bbox.
- [ ] POST `/analysis-runs` với idempotency key; thể hiện đang chờ phản hồi theo mô hình đồng bộ hiện tại, không giả lập phần trăm hay tự tạo polling endpoint.
- [ ] GET lịch sử theo dataset có sort/cursor; giữ family, method, config, status và phiên bản engine/model nếu có.
- [ ] Lấy anomaly theo analysisRunId và nối sang tab danh sách/lớp 3D; xử lý số lượng lớn bằng phân trang theo contract.
- [ ] Phân biệt không phát hiện anomaly, đầu vào không đủ, config lỗi, model chưa sẵn sàng, request thất bại và run failed.

**Nghiệm thu:** chạy thành công phương pháp thống kê và ML đã được hỗ trợ qua API thật; truy vết đúng run; phạm vi gửi đi khớp phần UI đã xác nhận. Analysis chạy theo phạm vi Server, không lấy tập readings hiện đang render làm toàn bộ đầu vào một cách ngầm định.

### M6 — Anomaly list, chi tiết và review online

- [ ] Danh sách theo dataset/run, family/method/severity/status/thời gian đúng các query hỗ trợ; cursor và trạng thái rỗng/lỗi rõ ràng.
- [ ] GET chi tiết, panel reading/location/detector/score/severity/review/version; một reading có thể có nhiều anomalies, không ép quan hệ một-một.
- [ ] PATCH chỉ `{baseVersion, changes: {status, note}}`; không sửa score/severity/method.
- [ ] Chỉ báo đã lưu sau response thành công; dùng version mới và cập nhật danh sách/detail/lớp 3D liên quan.
- [ ] Với 409: giữ bản sửa đang nhập trong phiên, tải trạng thái Server, hiển thị khác biệt và cho chọn bỏ bản sửa hoặc sửa lại dựa trên version mới. Không tự ghi đè hoặc tự retry với baseVersion mới.
- [ ] Chọn anomaly từ danh sách làm nổi bật đúng điểm nếu điểm có trong tập đang tải; nếu chưa có, nói rõ giới hạn và dùng chi tiết sẵn có. Không tự bịa endpoint lấy reading theo ID.

**Nghiệm thu:** review cập nhật đồng nhất; hai phiên sửa cùng anomaly tạo conflict có thể xử lý; lỗi mạng không làm xuất hiện thông báo lưu thành công.

### M7 — Quản lý tài khoản Admin

- [ ] List user với cursor/sort theo contract, thông tin public username/role/isActive.
- [ ] Tạo user có username/password/role và idempotency key; xử lý trùng username 409, lỗi 422.
- [ ] Sửa role/isActive bằng PATCH, cập nhật danh sách sau response thành công; không thêm delete/reset password.
- [ ] Kiểm tra route guard và phản hồi 403 từ Server; thay đổi quyền/trạng thái tài khoản hiện tại phải được xử lý nhất quán với Backend.

**Nghiệm thu:** admin tạo/sửa được tài khoản, analyst không truy cập được chức năng; không giữ password đã nhập trong state lâu hơn cần thiết và không hiển thị trường nhạy cảm từ response.

### M8 — Tích hợp, kiểm thử và bàn giao

- [ ] Chạy toàn bộ luồng online với Backend thật và dữ liệu thử đã thống nhất; ghi rõ endpoint nào chưa sẵn sàng thay vì tính mock là hoàn thành.
- [ ] Kiểm tra loading/empty/error/retry/401/403/404/409/422 và lỗi phụ thuộc ở các màn hình tương ứng; kiểm tra thao tác lặp và response về sai thứ tự.
- [ ] Kiểm tra bố cục desktop và màn hình hẹp, focus bàn phím, label/error của form, modal focus, bảng dài, nội dung dài và legend không chỉ dựa vào màu.
- [ ] Chạy typecheck, lint, build, test logic và integration/E2E trọng yếu; lập coverage client, mục tiêu logic client ≥70% theo SRS, ghi rõ kết quả thực tế.
- [ ] Benchmark Mapbox và Cube riêng với 10k/50k/100k điểm; đo FPS, thời gian render, memory và chuyển renderer. Ghi máy/trình duyệt/kích thước dữ liệu. Mốc ≥50 FPS ở 100k là mục tiêu khảo sát, không phải kết quả mặc định hoặc ngưỡng đã bảo đảm.
- [ ] Phân biệt benchmark renderer bằng fixture nạp trực tiếp với benchmark tải dữ liệu qua API phân trang.
- [ ] Cập nhật `client/README.md`: cài/chạy/build/test, env, mock/real mode, account thử do Backend cấp, giới hạn đã biết, interface bàn giao cho Duy.
- [ ] Chuẩn bị kịch bản demo và danh sách vấn đề còn tồn tại; nghiệm thu theo mục 7.

**Nghiệm thu:** FE P0 online sử dụng được với API thật; có bằng chứng kiểm thử và báo cáo hiệu năng; không phụ thuộc vào module offline để hoàn thành luồng online.

## 5. Thứ tự và cách chia công việc

Thứ tự chính: **M0 → M1 → M2 → M3 → M4 → M5 → M6 → M7 → M8**. M7 có thể làm sau M2 khi chờ contract của import/analysis. Kiểm thử từng feature diễn ra ngay trong mốc của feature; M8 dành cho tích hợp xuyên suốt và nghiệm thu.

Đơn vị PR đề xuất:

1. Scaffold, routing, UI nền và data interface/online adapter.
2. Auth + Datasets + workspace shell.
3. Import Wizard.
4. Query/filter + Mapbox.
5. Space–Time Cube + đồng bộ selection/chuyển renderer.
6. Analysis/history + lớp anomaly.
7. Anomaly list/detail/review/conflict.
8. Admin users.
9. E2E, tối ưu theo số đo và tài liệu bàn giao.

Mỗi PR phải có hành vi kiểm chứng được, test tương ứng với logic thay đổi và ghi rõ mock hay API thật. Review/merge theo quy trình nhóm vào `develop`. Kế hoạch không tự thực hiện commit, push hoặc PR.

Chưa ấn định ngày hoàn thành vì chưa có năng lực triển khai/ngày, lịch Backend và detector contract. Sau M0–M1, ước lượng từng PR theo khối lượng thực, tách thời gian FE làm việc khỏi thời gian chờ phụ thuộc. Không dùng thời gian làm UI mock làm cam kết hoàn thành tích hợp.

## 6. Điểm cần phối hợp trước khi hoàn tất tính năng liên quan

| Vấn đề | Cách xử lý trong kế hoạch | Phối hợp | Hạn cần chốt |
|---|---|---|---|
| Interface `dataSource` chưa khóa | FE có online adapter riêng sau interface; thống nhất chữ ký và điểm ghép, không xây offline | Tài + Duy | M0/M1 |
| Chưa có GET dataset theo ID | Workspace có thể đọc dữ liệu bằng datasetId hiện có; metadata cần phương án tra cứu qua list có phân trang hoặc thay đổi contract được nhóm duyệt. Không scan toàn bộ danh sách ngầm, không suy ra 404 từ trang đầu | Tài + Khiêm | M2 |
| Reload wizard giữa chừng | Chốt thông tin có thể phục hồi bằng validation API và ID, phần nào yêu cầu bắt đầu lại; tránh upload/import lặp do không biết trạng thái | Tài + Khiêm | M3 |
| Timezone nguồn/đơn vị/giới hạn file | Giữ khả năng contract hiện có; chốt OPEN-02/05 và cách báo lỗi. Không thêm trường timezone vào request khi schema chưa nhận | Tài + Khiêm | M3 |
| Method/config/model/severity | Khải/Khiêm cung cấp danh sách method và schema config/default hợp lệ. FE chỉ hiển thị severity Server trả, không tự đặt ngưỡng nghiệp vụ | Tài + Khải + Khiêm | M5 |
| Bbox không thuộc DetectionRequest.scope | Đề xuất resolve đầy đủ sensor IDs trong bbox qua phân trang trước khi gửi, có xác nhận phạm vi; nếu quá lớn hoặc chưa có quy tắc giới hạn, yêu cầu chọn trạm rõ hoặc báo chưa hỗ trợ. Nhóm phải thống nhất cách xử lý tập trạm rỗng và giới hạn payload; không dùng trang sensors đầu tiên làm toàn bộ vùng | Tài + Khiêm | M5 |
| Import/analysis đồng bộ hay async | Theo draft đồng bộ để phát triển. Nếu Backend chuyển async, cập nhật contract và kế hoạch trước khi làm progress/polling | Tài + Khiêm | M3/M5 |
| Token, 401 và quyền tài khoản hiện tại | Chốt cách giữ token online, kiểm tra current user và đăng nhập lại; không bổ sung refresh API hoặc offline auth | Tài + Khiêm | M2/M7 |
| Mapbox token và môi trường demo | Cấp public token/origin hợp lệ và kiểm tra tải nền; môi trường không có token vẫn chạy được các màn khác và Cube | Tài + Cường | M4 |
| API thật và dữ liệu đánh giá | Chốt endpoint ready, tài khoản analyst/admin, dataset lỗi/hợp lệ, run thống kê/ML và môi trường tích hợp | Tài + Khiêm + Khải + Cường | Theo feature, xong trước M8 |
| Anomalies không nhận sensorId/bbox, DTO không có giá trị reading | Tab Anomalies ghi scope riêng; không giả lọc toàn bộ vùng từ một trang; reading chưa tải thì báo rõ. Chi tiết C07/C08 và R09 trong M0 | Tài + Khiêm | M4/M6 |
| Biên thời gian from/to chưa rõ đóng/mở | UTC+07 cho UI đã chọn; semantics biên và snapshot phân trang vẫn cần Backend xác nhận (R08) | Tài + Khiêm | M4/M5 |
| Runtime validator chặt hơn HTTP schema | Đồng bộ chuỗi không rỗng, tọa độ và độ chính xác timestamp trước khi áp shared Zod lên HTTP response (C02–C04) | Tài + Khiêm + Khải | M1/tích hợp |
| Tự đổi quyền/vô hiệu admin cuối cùng | Chờ quy tắc Backend; không tự đặt business rule ở frontend (R10) | Tài + Khiêm | M7 |

Các mục này là phụ thuộc khi triển khai, không phải yêu cầu người dùng tự quyết định lại phạm vi đã xác nhận. Nếu có quyết định làm đổi phạm vi P0 online, cần trao đổi riêng trước khi mở rộng.

## 7. Tiêu chí “đã làm xong frontend”

- [ ] Analyst đi hết luồng login → upload/validation/mapping/import → workspace → hai renderer → analysis → review bằng API thật.
- [ ] Dataset đã imported được chọn lại và tra cứu đúng; tab/view switching giữ bộ lọc trong phiên đang mở.
- [ ] Chạy được thống kê và ML online được Backend hỗ trợ; lịch sử/kết quả hiển thị đúng nguồn detector, không giả lập thành công.
- [ ] Admin list/create/update user; analyst bị chặn đúng ở UI và integration với Server.
- [ ] Retry mutation giữ idempotency đúng; conflict review có xử lý rõ; không mất bản nhập một cách âm thầm khi request lỗi.
- [ ] Cursor/filter/dataset isolation và response race được kiểm tra; không trình bày dữ liệu phân trang như toàn bộ dataset.
- [ ] Build/typecheck/lint và kiểm thử liên quan đạt; E2E chính chạy được với Backend thật. Có báo cáo coverage/hiệu năng và các giới hạn đã biết.
- [ ] Không còn lỗi chặn luồng P0 online; mỗi điểm chưa hoàn tất phải được ghi rõ, không tính mock là kết nối Backend thành công.
- [ ] Có README, cấu hình mẫu, script chạy/test và interface để Duy nối module sau.

Đạt các tiêu chí trên nghĩa là **hoàn tất frontend P0 online trong phạm vi này**, không đồng nghĩa hoàn tất toàn bộ MVP có PWA/Offline/Sync của SRS.
