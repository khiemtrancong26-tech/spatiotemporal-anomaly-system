# Fixtures kiểm thử Backend và nhu cầu phân tích

CSV trong thư mục này là **dữ liệu mô phỏng có chủ đích**, không phải số đo quan trắc thật, dự báo hoặc bằng chứng độ chính xác detector. Các trạm `SYN-*`, tọa độ và giá trị đều được tạo để tái lập các tình huống dưới đây. Không tự đưa chúng vào online mode hoặc DB người dùng. Bộ dữ liệu thật nhiều trạm dùng demo được giữ riêng trong `.local/demo-datasets`.

## Chọn đúng file

| File | Vai trò |
|---|---|
| **[multistation-timeseries.csv](multistation-timeseries.csv)** | Bộ chính để kiểm thử nhu cầu so sánh nhiều trạm qua thời gian: **5 trạm ở 5 vị trí, 239 readings, 48 giờ**. Import hợp lệ, không trùng trạm/thời điểm. |
| [b4-boundaries.csv](b4-boundaries.csv) | Bộ chuyên kiểm tra biên: **5 trạm, 8 readings**; bbox đóng, thời gian đóng, sai khác 1 ms, giá trị 0. Không dùng thay bộ chuỗi thời gian đầy đủ. |
| `b3-worker.ts`, `b5-worker.ts` | Chương trình phụ tạo tiến trình để kiểm tra crash/recovery; không phải dữ liệu upload. |
| `python-transport.py` | Chương trình phụ kiểm tra giao tiếp Python; không phải model hoặc dataset. |

## Cấu trúc bộ nhiều trạm

Mọi trạm có vị trí cố định; **giá trị PM2.5 thay đổi theo thời gian**, không mô phỏng trạm di chuyển. Thời gian nguồn là UTC có hậu tố `Z`, đơn vị `ug/m3`. Khoảng thời gian: **14/11/2026 00:00Z đến 15/11/2026 23:00Z**. Có 48 mốc giờ tròn và 2 mốc nửa giờ. Dữ liệu được sắp theo thời gian rồi mã trạm.

| Trạm | Readings | Tình huống |
|---|---:|---|
| SYN-A | 48 | Dao động 20, 21, 22 lặp lại, để so sánh biến động nhỏ với các trạm khác. |
| SYN-B | 48 | Dao động 39–41, riêng **15/11 12:00Z = 200**, để kiểm tra điểm tăng đột ngột và liên kết anomaly về đúng reading/trạm. |
| SYN-C | 48 | Tăng dần từ 36 đến 83, mỗi giờ tăng 1. Xu hướng tăng không mặc nhiên đồng nghĩa với anomaly của mọi thuật toán. |
| SYN-D | 47 | Giá trị 0 hợp lệ; **không có dòng 15/11 12:00Z**, để phân biệt thiếu dữ liệu với số đo bằng 0 và kiểm tra phương sai 0. |
| SYN-E | 48 | Dao động 55, 57, 59, 61. Hai mẫu **14/11 12:00** và **15/11 12:00** được ghi ở **12:30Z**, để kiểm tra trạm đo lệch giờ. |

Không thêm hàng `NA` cho giờ thiếu của D: khoảng trống là không có số đo, không phải lỗi CSV. Không điền 0 hoặc dùng mẫu gần nhất để lấp khoảng trống. Có **46 mốc giờ đủ cả 5 trạm**; không phải mọi thời điểm đều có đủ trạm.

## Nhu cầu người dùng và kết quả mong đợi

Các giờ trong bảng là **UTC**. Giao diện UTC+07 hiển thị cộng 7 giờ.

| Nhu cầu / tình huống | Thao tác | Kết quả cần đạt | Kiểm thử tự động |
|---|---|---|---|
| Nhập một mạng trạm thay vì chỉ một chuỗi đo | Upload CSV, mapping các cột cùng tên, import | 5 sensors, 239 readings; 5 vị trí phân biệt; không trùng station/time | B4 import thật, MongoDB tạm |
| Xem tất cả trạm cùng thời điểm | `from=to=2026-11-14T10:00:00Z`, không lọc trạm, `limit=2`, đọc hết cursor | **5 readings**, A=21, B=40, C=46, D=0, E=59; không mất trạm khi timestamp trải qua nhiều trang | B4 Query |
| Đổi thời điểm để so sánh biến động | Đổi sang `14/11 11:00Z` | Vẫn 5 trạm; A=22, B=41, C=47, D=0, E=61 | B4 Query |
| Thiếu mẫu và đo lệch giờ | `from=to=15/11 12:00Z` | **3 readings A/B/C**, B=200; D thiếu, E chưa đo. Không lấy D lúc 11:00 hoặc E lúc 12:30 để ghép vào | B4 Query |
| Đúng thời điểm có mẫu lệch giờ | `from=to=15/11 12:30Z` | Chỉ E=55; không kéo các trạm khác từ giờ tròn | B4 Query |
| Thời điểm hoàn toàn không có dữ liệu | `from=to=15/11 13:30Z` | 200 với danh sách rỗng; không tự đổi thời điểm | B4 Query |
| Xem lịch sử một trạm | Lọc ID nội bộ của B, `15/11 11:00–13:00Z` | **3 readings [41,200,40]**, gồm hai biên; không có trạm khác | B4 Query |
| Xem các trạm trong vùng và thời gian | bbox `106.64,10.74,106.72,10.80`, `15/11 11:00–13:00Z` | Chỉ A/B/C, **9 readings**; không bbox có 14 readings | B4 Query |
| Phân trang/lật thứ tự không làm sai lịch sử | `limit=100` toàn bộ hoặc `limit=2` trong vùng, đọc hết cursor; đổi `ts:desc` | Toàn bộ 239 readings; thứ tự ngược trả đúng cùng tập dữ liệu, không lặp/mất hàng | B4 Query |
| Phân tích toàn scope thay vì chỉ 100 điểm FE đã tải | Chạy Z-score threshold=3 và IQR multiplier=1.5 cho toàn dataset | Mỗi run hoàn tất, **1 anomaly của B tại 15/11 12:00Z**, liên kết đúng reading dù nằm sau trang đầu | B5 import → worker thống kê thật → persistence |
| Phân tích theo từng trạm, không gộp các nền nồng độ | Chọn chỉ C và D, chạy hai method trên | Hoàn tất, **0 anomalies** dưới policy thống kê hiện tại; chuỗi hằng 0 hợp lệ | B5 |
| Scope thời gian thay đổi kết quả | Chỉ B, `14/11 00:00–23:00Z`, chạy hai method trên | Hoàn tất, **0 anomalies**; điểm tăng ngày 15 không lọt vào scope | B5 |
| Không đủ mẫu để phân tích | IQR, scope đúng `15/11 12:00Z` | Run failed với `INSUFFICIENT_DATA`, không xuất anomaly một phần hoặc tự thêm mẫu | B5 |

Các kết quả thống kê trên là kỳ vọng cho **fixture này và policy hiện tại**, không phải đánh giá chất lượng phát hiện trên dữ liệu thật. Chưa có kỳ vọng golden cho Isolation Forest trong bộ này; không suy diễn mọi giá trị 200 hoặc mọi xu hướng tăng sẽ được ML gắn cờ. API/statistical contract và ngưỡng không thay đổi.

## Upload để xem trực quan khi cần

Chọn file `multistation-timeseries.csv`, đặt tên rõ **[SYNTHETIC TEST] 5 stations / 48 hours**. Mapping: `sensorId→sensorId`, `latitude→latitude`, `longitude→longitude`, `timestamp→timestamp`, `value→value`. REST có thể map thêm `name`, `region`, `unit`; wizard chỉ cần năm cột bắt buộc và xác nhận đơn vị/thời gian.

Trong workspace, bỏ lọc trạm/bbox và chọn **17:00 ngày 14/11/2026 UTC+07** để có 5 trạm. Đổi sang **18:00** để xem cùng 5 trạm với giá trị khác. **19:00 ngày 15/11 UTC+07** chỉ có 3 trạm theo tình huống thiếu/lệch mẫu ở trên. Bảng dữ liệu và Cube dùng lịch sử nhiều thời điểm; Mapbox cùng thời điểm chỉ dùng mẫu đúng timestamp.

Các tests dưới đây xác minh Backend/import/detector; không tuyên bố đã kiểm chứng render WebGL, camera, thao tác UI hay heatmap từ riêng bộ Backend này. Không yêu cầu thao tác thủ công để thay cho các case đã tự động hóa.

## Chạy lại

```powershell
# Từ thư mục gốc repository; cần mongod cho MongoDB replica set tạm.
npm run build --workspace @pm25/shared-core
Set-Location server
npx vitest run tests/b4.integration.test.ts tests/b5.integration.test.ts -t multistation
```

Nguồn kiểm thử: [B4](../b4.integration.test.ts), [B5](../b5.integration.test.ts). Tests tạo JWT, upload và import qua HTTP thật trong app, dùng DB/storage tạm; không dùng DB `.env` hoặc tự seed online. Không thay test biên, crash/recovery hoặc single-sensor đang có: chúng vẫn là hồi quy cần thiết.

## Beijing12 trạm — golden nghiệp vụ do chủ dự án cung cấp

Ngày16/11/2026: copy nguyên bytes từ `.local/demo-datasets/beijing-12-stations-demo-2015-03.csv` sang [fixture](beijing-12-stations-demo-2015-03.csv), không sửa file nguồn. [Manifest](beijing-12-stations-demo-2015-03.manifest.json) pin bytes/SHA256/expected facts; `.gitattributes` tắt EOL normalization riêng fixture này để hash không đổi khi checkout.

Đã tính độc lập bằng [beijing-fixture.test.ts](../beijing-fixture.test.ts):8782 rows,12 trạm,739 timestamps, không duplicate/invalid, min3/max369, offset+08,146 station–hours thiếu trên lưới12×31×24. Mốc16/03 19h+08 có12 trạm/mean315,5; Nongzhanguan26/03 21h có369, median11 trạm khác80 và không có mẫu22h/23h. Đây là thống kê mô tả, không phải labels anomaly hoặc định nghĩa spatial_delta.

[B6 integration](../b6.integration.test.ts) import CSV qua B3 thật, chạy Z-score B5 rồi list/detail/review qua B6; [browser E2E](../../e2e/b6.spec.ts) kiểm conflict/rebase/reload với API/DB thật. Không phụ thuộc file `.local` để chạy lại test. Không train ML v2 hoặc dùng golden này làm fit.

Provenance hiện là file do chủ dự án cung cấp, với cột sourceFile/sourceRowNo tham chiếu PRSA_Data. Upstream extraction và độ chính xác nguồn tọa độ chưa được kiểm định độc lập; không tự tuyên bố toàn bộ G01/G04/G05 đã đóng hoặc dataset có anomaly ground truth. Fixture synthetic ở trên tiếp tục dùng cho lỗi/gaps/edge cases có chủ đích.
