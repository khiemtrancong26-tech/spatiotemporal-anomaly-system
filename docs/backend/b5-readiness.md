# B5 — Readiness trước triển khai

Ngày rà soát: 15/11/2026. **Chủ dự án đã đồng ý cả ba nhóm bên dưới trong chat B5.** Implementation/bằng chứng và giới hạn hiện tại xem [B5 verification](b5-verification.md); D015 ghi quyết định được duyệt. Tài liệu này giữ quá trình readiness, không thay cho báo cáo test.

## 1. Phần đã được chủ dự án chọn

- Thực hiện B5 theo `docs/backend-online-plan.md`, giữ Fastify + TypeScript và Route → Validation → Service → Repository → MongoDB.
- MongoDB-backed worker trên Replica Set hiện có; chưa thêm Redis/BullMQ (D015).
- Cả statistical và ML async; chỉ ba operations Analysis hiện có trong OpenAPI. Không mở API B6, Offline/Sync, train, retry/cancel hoặc progress.
- D014 là tiền đề thư viện thật, chưa phải production detector policy. Model demo x0/x1 không được tự chuyển thành model PM2.5 bằng cách điền/pad features.

## 2. Ba nhóm đã được chủ dự án xác nhận

Các giá trị dưới đây đã được chọn làm baseline B5 sau câu trả lời đồng ý của chủ dự án; không suy ra sign-off riêng của Khải/Tài/Cường.

### 2.1. Statistical policy và severity

| Nội dung | Baseline đã duyệt |
|---|---|
| Grouping/order | Theo sensor, ts rồi reading ID |
| Z-score | Toàn scope mỗi sensor; population std; tối thiểu 2 mẫu; threshold=3; score=abs(z) |
| IQR | Toàn scope mỗi sensor; tối thiểu 4 mẫu; multiplier=1.5; score=khoảng vượt fence, đơn vị ug/m3 |
| Moving Average | Bắt buộc windowSize>=2; đúng số mẫu trước hiện tại, không gồm hiện tại; threshold=3; population std; warmup omit |
| Điều kiện dữ liệu | Bất kỳ nhóm thiếu mẫu thì failed/INSUFFICIENT_DATA; dữ liệu hằng không tạo anomaly; cửa sổ std=0 nhưng giá trị hiện tại khác mean thì failed/INSUFFICIENT_DATA |
| Severity | Tạm gán low cho mọi anomaly, công khai giới hạn; chưa diễn giải thành mức nguy hại sức khỏe hoặc ngưỡng chất lượng đã kiểm chứng |

Presets FE zscore threshold=3 và iqr multiplier=1.5 đã được chọn ở D009; D015 chốt phần còn lại của bảng. Policy mới có version riêng, không lấy nhãn EXPERIMENT-ONLY làm production mặc định. Severity low tạm thời đã được duyệt để persist Anomaly baseline.

### 2.2. Model PM2.5 baseline

Đã được phép tạo artifact riêng bằng CLI offline với thư viện scikit-learn, feature duy nhất `value` theo ug/m3, seed cố định; manifest gồm nguồn, checksum dữ liệu/artifact, feature order, tham số và phiên bản runtime. Backend/worker chỉ load và inference, không tự train khi thiếu model.

Nguồn đã chọn: [Chen, S. (2015), Beijing PM2.5, UCI](https://archive.ics.uci.edu/dataset/381/beijing%2Bpm2%2B5%2Bdata), DOI [10.24432/C5JS49](https://doi.org/10.24432/C5JS49). UCI mô tả dữ liệu theo giờ 2010–2014, cột PM2.5 có đơn vị ug/m3, có missing values; giấy phép CC BY 4.0. Đã train offline trên 24.418 mẫu không thiếu của 2010–2012, giữ riêng 17.339 mẫu 2013–2014, không impute NA. Tham số/runtime/hash trong [manifest](../../server/ml/pm25-manifest.json); không dùng inference trên tập train làm bằng chứng chất lượng.

API đã chốt `family=ml`, `method=isolation_forest`, `config={}`; flag theo predict=-1, score=-decision_function, severity tạm low. Baseline một feature chỉ phát hiện bất thường về giá trị theo phân bố tham chiếu; không phải model đã chứng minh khả năng phát hiện quan hệ không gian/thời gian của dự án. Khải cần review chất lượng và khả năng chuyển miền trước khi tuyên bố phù hợp dữ liệu thực tế.

### 2.3. Scope và vận hành

| Nội dung | Baseline đã duyệt |
|---|---|
| Time | Khoảng đóng [from,to], UTC Z tối đa 3 số lẻ, chuẩn hóa ms như B4 |
| sensorIds | Thiếu nghĩa là toàn bộ; [] trả 422; tối đa 10.000 IDs; xác minh tất cả thuộc dataset |
| Bbox | Không nhận ngoài schema; FE tiếp tục chặn bbox khi chưa có policy chuyển sang tập sensor đầy đủ |
| Receipt | Replay 24h; sau đó giữ key và trả 409, không tạo run thay thế |
| Concurrency | 1 job/process ban đầu; statistical ở worker thread, ML ở subprocess |
| Recovery | Lease 30s, heartbeat 10s, poll 1s; tối đa 3 attempts sau crash; timeout 120s/attempt |
| Scope bound | Tối đa 50.000 readings; lấy đủ phạm vi hoặc failed rõ nguyên nhân, không cắt rồi completed |
| Admission | Tối đa 100 run queued/running trong queue dùng chung; đầy trả 503 trước tiếp nhận |
| ML unavailable | Thiếu ngay khi tiếp nhận trả 503; mất/hỏng sau khi đã nhận thì run failed |

Các con số là cấu hình khởi đầu để đo, không phải kết quả benchmark. Cường review CPU/RAM/event-loop và tổng concurrency nếu chạy nhiều process. FE không được coi trang readings limit 100/200 là input toàn scope. GET history giữ đúng query/status của OpenAPI, không tự áp dụng mã 422 của Query B4 cho operation không khai báo mã này.

## 3. Thiết kế đã dùng cho implementation

1. **Tiếp nhận:** validate HTTP/schema → business policy và quyền dataset → kiểm tra replay → transaction nhỏ lưu receipt completed với snapshot 202 và run queued. Chính run là job bền vững, không có khoảng hở dispatch sang Redis. Admission cần hàng rào cạnh tranh trong DB, không chỉ count rồi insert. Nếu dùng counter/collection nội bộ để serialize admission, phải ghi vào physical design và kiểm thử rollback/concurrency.
2. **Claim:** conditional update trên queued hoặc running có lease hết hạn; cấp owner/attempt mới. Terminal không tự quay lại running. Poll lại DB sau restart, không phụ thuộc danh sách job trong RAM.
3. **Đọc scope:** Repository đọc primary, projection giới hạn, batch có giới hạn và kiểm tra tổng số mẫu; Service/engine không xử lý BSON. Input nằm trong snapshot dataset/sensor/time đã tiếp nhận, không lấy filter FE mới.
4. **Thực thi:** CPU thống kê không chặn HTTP event loop; Python inference giữ timeout/output/input bounds và không nhận bí mật JWT/Mongo. Version/policy/model phải gắn với run, không âm thầm đổi model giữa retry.
5. **Fencing/persist:** mọi batch ghi anomaly phải cùng transaction nhỏ với kiểm tra/ghi run owner+attempt+lease. Chỉ check owner rồi bulkWrite riêng là chưa đủ: worker cũ có thể ghi sau claim mới. Anomaly unique run+reading là hàng rào cuối, không thay thế fencing.
6. **Recovery partial:** attempt mới dọn/reconcile partial của attempt cũ dưới guard trước khi ghi lại; nếu crash khi cleanup, lần sau tiếp tục an toàn. Chỉ completed sau khi mọi batch đã persist đầy đủ. Failed giữ partial không public; B6 phải gate mọi đường đọc theo run completed.
7. **Idempotency:** receipt tiếp nhận tách lifecycle worker. Replay luôn đúng snapshot 202 queued/run ID dù run đã terminal. Receipt recovery B3 chỉ xử lý upload/import; không được để sweeper B3 nhận nhầm receipt Analysis. Mất response sau commit phải replay được.

Transaction/claim/fencing/recovery được kiểm chứng bằng test ghi trong báo cáo B5; không khẳng định exactly-once execution. Collection counter đã được ghi vào physical design và test admission hai app instances.

## 4. Bằng chứng bắt buộc khi triển khai

- Contract drift cho request/response và ba operations, scope snapshot, lifecycle/error/completedAt; auth và DTO không lộ fields worker.
- DB Replica Set thật: transaction receipt+run, cạnh tranh cùng key, payload mismatch, replay terminal, expiration; admission không vượt mức khi nhiều request/process.
- Fault injection: crash sau queued commit trước claim; crash sau một batch; expired owner không được ghi/publish; write failure giữa chừng; duplicate claim/delivery; mất response sau commit; restart khôi phục queued/running hết lease.
- Detector thật: từng statistical method; ML artifact PM2.5 baseline đã duyệt; insufficient/constant/empty scope; output foreign/duplicate/non-finite; model unavailable. Test double chỉ dùng cho lỗi điều phối và phải ghi nhãn.
- Scope vượt một trang, sensor chéo dataset, thời gian/biên, vượt giới hạn không bị truncate thành công; hai run có thể chứa cùng reading nhưng một run không trùng.
- Đo CPU/RAM/event-loop và latency HTTP khi job chạy, concurrency/timeout/admission ban đầu; không suy ra SRS SLA từ một test nhỏ.
- B5a/B5b chỉ đóng theo bằng chứng thật. B6 chưa triển khai nên không tuyên bố flow run → anomaly review hoàn tất.

## 5. Trạng thái hiện tại

B5a/B5b có API/worker/engine thật theo baseline D015. Xem [verification](b5-verification.md) cho kiểm thử và cách chạy. B6/B7/B8 chưa thực hiện; FE vẫn khóa ML và cần Tài cập nhật theo method/config vừa bàn giao. Khải tiếp tục đánh giá model/severity; Cường đo triển khai/tải trước tăng concurrency.
