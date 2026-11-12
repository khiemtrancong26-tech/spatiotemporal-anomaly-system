# SRS TINH GỌN — ĐẶC TẢ YÊU CẦU PHẦN MỀM

**Đề tài:** Xây dựng hệ thống phân tích và phát hiện bất thường trong dữ liệu không gian – thời gian bằng trực quan 3D  
**Phiên bản:** 0.4 — 11/11/2026  
**Nhóm:** 5 thành viên — Môn JavaScript/TypeScript — Thời gian dự kiến 4 tuần  
**Người chủ trì yêu cầu:** Người 1 (Nhóm trưởng, Backend/Database)  
**Trạng thái:** Bản đầu vào cho SDD, API Contract và Shared Schema; cần review các mục **[CHƯA CHỐT]** trước khi khóa thiết kế liên quan.

> **Mục đích:** Tài liệu này trả lời **“Hệ thống phải làm gì, đối với dữ liệu nào và theo quy tắc nào?”**. Không quy định chi tiết cấu trúc class, folder, collection/index vật lý, endpoint, thư viện hay cách triển khai nội bộ; các nội dung đó nằm trong SDD/API Contract.


---

## 1. Tổng quan hệ thống (System Overview)

### 1.1. Mục tiêu

Hệ thống là ứng dụng web hỗ trợ người phân tích:

1. Tải lên các tệp CSV/JSON chứa **số đo PM2.5 của những trạm cảm biến cố định**, có vị trí và thời điểm đo.
2. Kiểm tra, ánh xạ tên trường và chuẩn hóa dữ liệu trước khi lưu.
3. Tra cứu readings theo bộ dữ liệu, trạm, vùng địa lý và khoảng thời gian.
4. Phát hiện các điểm nghi vấn bất thường bằng **phương pháp thống kê** và **một mô hình ML đã huấn luyện trước**; phân biệt kết quả của hai hướng.
5. Quan sát cùng một dữ liệu trong **bản đồ địa lý Mapbox 3D** và **Three.js Space–Time Cube**, với trục thời gian tách biệt.
6. Xem, xác nhận, đánh dấu phát hiện sai hoặc ghi chú bất thường.
7. Tiếp tục xem dữ liệu **đã được hệ thống tự lưu khi truy cập online**, chạy thống kê khi mất kết nối Backend và tự đồng bộ chỉnh sửa hợp lệ khi kết nối phục hồi; hỗ trợ chủ động tải thêm dữ liệu để dùng offline.

Phát hiện bất thường là **kết quả nghi vấn từ thuật toán**, không phải xác nhận nguyên nhân ô nhiễm hay một sự kiện môi trường có thật.

### 1.2. Phạm vi MVP

**Trong phạm vi (P0):** Đăng nhập/phân quyền cơ bản; upload/validation/mapping/normalization/import; tra cứu dữ liệu; thống kê; ML inference online; hai chế độ trực quan 3D; quản lý anomaly; **tự động lưu dữ liệu đã tải và ứng dụng để sử dụng khi mất mạng đột ngột**; tùy chọn tải trước dữ liệu; tự sync thay đổi.

**Ưu tiên sau P0 (P1):** Tổng hợp dữ liệu theo bucket/vùng và mức độ chi tiết (LOD) nhằm cải thiện khả năng tương tác với dữ liệu lớn.

**Chỉ mở rộng nếu còn thời gian (P2):** DBSCAN/LOF và so sánh thuật toán nâng cao, sau khi luồng cốt lõi ổn định.

**Ngoài phạm vi MVP:** GPS trajectory; LLM/chatbot; crawler hoặc streaming dữ liệu Internet; dự báo chất lượng không khí; kết luận nguyên nhân ô nhiễm; microservices và hệ thống phân quyền tổ chức phức tạp.

### 1.3. Actor và quyền

| Actor | Đọc dữ liệu/3D | Chạy phân tích | Upload/import | Review anomaly | Quản trị tài khoản |
|---|---|---|---|---|---|
| `analyst` | Có | Có | Có | Có | Không |
| `admin` | Có | Có | Có | Có | Có |

`admin` là **Application Admin**, quản trị tài khoản và chức năng quản trị ứng dụng. Quản trị máy chủ, hệ điều hành, Nginx và Docker do DevOps đảm trách bên ngoài hệ thống role JWT.

Người dùng chưa đăng nhập chỉ được truy cập những tài nguyên công khai được công bố (ví dụ chức năng đăng nhập/kiểm tra sức khỏe hệ thống). Quyền thao tác phải được kiểm tra tại Backend; việc ẩn nút trên UI không được xem là bảo vệ đủ.

### 1.4. Giả định và giới hạn

- MVP tập trung **một đại lượng PM2.5** với đơn vị chuẩn `µg/m³`; chưa cam kết hỗ trợ mọi loại cảm biến.
- Trạm có vị trí cố định; mỗi lần đo gắn với một `sensor`, một `dataset` và một `timestamp`.
- Quy mô **200–500 trạm và 100.000–500.000 readings** là mục tiêu thiết kế/kiểm thử, **chưa phải kết quả đạt được**.
- Khi online, ứng dụng **tự động lưu cục bộ** các dữ liệu đã tải thành công theo phạm vi truy cập; không yêu cầu người dùng dự báo mất mạng hay bấm nút tải offline trước mỗi lần sử dụng. Chỉ dữ liệu **đã thực sự lưu thành công** mới bảo đảm có thể truy cập offline, không mặc nhiên là toàn bộ dataset.
- Ứng dụng phải được truy cập/khởi tạo thành công khi còn mạng để chuẩn bị các tài nguyên khởi chạy cần thiết; không bảo đảm đăng nhập lần đầu khi offline. Bản đồ nền Mapbox có thể thiếu tiles/tòa nhà khi không có mạng; dữ liệu cảm biến đã lưu vẫn có thể được xem qua giao diện offline phù hợp.

---

## 2. Yêu cầu chức năng (Functional Requirements)

### 2.1. Danh mục yêu cầu có mã truy vết

| ID | Yêu cầu hệ thống | Actor | Ưu tiên | Kết quả cần quan sát |
|---|---|---|---|---|
| **FR-01** | Đăng nhập và áp dụng quyền theo role | Analyst, Admin | P0 | Đăng nhập hợp lệ; thao tác trái quyền bị từ chối |
| **FR-02** | Tiếp nhận file CSV/JSON và tạo phiên nhập dataset | Analyst, Admin | P0 | Có dataset/phiên nhập và thông tin file |
| **FR-03** | Kiểm tra dữ liệu thô, cung cấp báo cáo lỗi/mapping gợi ý | Analyst, Admin | P0 | Biết dòng, trường, loại lỗi; thấy gợi ý tên cột |
| **FR-04** | Yêu cầu người dùng xác nhận mapping, đơn vị và thông tin thời gian | Analyst, Admin | P0 | Mapping được xác nhận trước khi nhập |
| **FR-05** | Chuẩn hóa, kiểm tra lần cuối, nhập dữ liệu hợp lệ | Analyst, Admin | P0 | Dataset hợp lệ có thể tra cứu; dataset lỗi không được công bố |
| **FR-06** | Duyệt, lọc, phân trang dữ liệu cảm biến/reading | Analyst, Admin | P0 | Kết quả đúng theo dataset, vùng, trạm và thời gian |
| **FR-07** | Phân tích bất thường bằng thống kê | Analyst, Admin | P0 | Có điểm số/nhãn/phương pháp; chạy online và offline |
| **FR-08** | Phân tích bất thường bằng ML đã train trước | Analyst, Admin | P0 | Có kết quả inference khi online; không train theo upload |
| **FR-09** | Hiển thị và chuyển đổi Mapbox 3D / Space–Time Cube | Analyst, Admin | P0 | Hai chế độ dùng chung dữ liệu/bộ lọc; thời gian thể hiện rõ |
| **FR-10** | Xem chi tiết và đánh giá anomaly | Analyst, Admin | P0 | Xem score/method; đổi status/note được khi có quyền |
| **FR-11** | **Tự động lưu** dữ liệu đã tải khi online, cho phép chủ động tải thêm dữ liệu và tiếp tục sử dụng offline | Analyst, Admin | P0 | Không cần thao tác chuẩn bị trước cho phần đã tự lưu; khi mất mạng đột ngột vẫn xem/chạy thống kê trên dữ liệu có sẵn |
| **FR-12** | Tự đồng bộ các thay đổi ngoại tuyến với Server | Analyst, Admin | P0 | Không mất mutation; không áp dụng trùng; có phản hồi xung đột |
| **FR-13** | Tổng hợp readings theo thời gian/vùng để giảm dữ liệu hiển thị | Analyst, Admin | P1 | Đọc dữ liệu tổng hợp phù hợp khi cần |
| **FR-14** | Mở rộng phát hiện theo không gian/cụm hoặc thuật toán nâng cao | Analyst, Admin | P2 | Được đánh giá và hiển thị tách biệt nếu triển khai |

Trong MVP chỉ có hai role đăng nhập là `analyst` và `admin`. Bảng xác định **hành vi mong đợi**, chưa định nghĩa HTTP method hay endpoint.

### 2.2. Các luồng nghiệp vụ cốt lõi

#### UC-01 — Đăng nhập

**Điều kiện trước:** Có tài khoản hợp lệ.  
**Luồng chính:** Người dùng cung cấp thông tin đăng nhập → hệ thống xác thực → xác định role → cho phép truy cập chức năng tương ứng.  
**Kết quả:** Phiên đăng nhập hợp lệ và quyền được áp dụng ở Server.  
**Ngoại lệ:** Sai thông tin đăng nhập hoặc thiếu quyền → từ chối thao tác với phản hồi phù hợp.

#### UC-02 — Upload, kiểm tra, mapping và nhập dataset

**Điều kiện trước:** Người dùng có quyền `analyst` hoặc `admin`, Backend hoạt động.

1. Người dùng chọn file CSV hoặc JSON.
2. Hệ thống tiếp nhận file, tạo một phiên nhập và kiểm tra khả năng đọc/cấu trúc.
3. Hệ thống hiển thị báo cáo lỗi (nếu có) và gợi ý tên cột nguồn tương ứng với trường chuẩn.
4. Người dùng xác nhận/chỉnh mapping, đơn vị và thông tin thời gian cần thiết.
5. Hệ thống chuẩn hóa dữ liệu, kiểm tra lại ràng buộc, xử lý bản ghi trùng theo BR-08 và nhập các bản ghi được chấp nhận theo lô.
6. Khi thành công, dataset được đánh dấu có thể sử dụng để tra cứu/phân tích.

**Kết quả:** Có dataset chuẩn hóa, số trạm và số readings được tiếp nhận; báo cáo riêng số dòng trùng hoàn toàn, dòng trùng khóa nhưng khác giá trị và các lỗi cần sửa.

**Ngoại lệ:** Tệp sai định dạng/cú pháp; thiếu cột; timestamp/tọa độ/đơn vị không hợp lệ; không xác nhận mapping; lỗi nhập giữa chừng; file vượt giới hạn. Bản ghi trùng được bỏ qua và báo cáo theo BR-08, không mặc nhiên khiến cả dataset thất bại. Hệ thống không được công bố một dataset nhập dở.

#### UC-03 — Tra cứu và trực quan dữ liệu

**Điều kiện trước:** Có dataset đã nhập thành công, người dùng có quyền đọc.

1. Người dùng chọn dataset, trạm/vùng, khoảng thời gian.
2. Hệ thống trả đúng tập readings/sensors theo phạm vi được chọn, có phân trang/giới hạn.
3. Người dùng chọn **Mapbox 3D** để xem vị trí trạm trên bản đồ hoặc **Space–Time Cube** để xem X–Y là không gian và Z là thời gian.
4. Người dùng chọn điểm/trạm/bất thường để xem chi tiết.

**Kết quả:** Cùng dữ liệu và bộ lọc được duy trì khi chuyển chế độ.

**Ngoại lệ:** Không có dữ liệu phù hợp → hiển thị trạng thái rỗng; dữ liệu lớn → không mặc định chuyển toàn bộ readings không giới hạn về Client.

#### UC-04 — Chạy và so sánh phát hiện bất thường

**Điều kiện trước:** Dataset hợp lệ; người dùng `analyst/admin`; có dữ liệu đáp ứng điều kiện thuật toán.

1. Người dùng chọn dataset/phạm vi dữ liệu, phương pháp và tham số.
2. Hệ thống chạy nhánh **thống kê** hoặc **ML inference** được chọn.
3. Khi phân tích trên Server thành công, hệ thống quản lý một lượt phân tích và kết quả liên quan.
4. Người dùng xem các điểm được gắn cờ trên 3D, score, severity, method và thông tin lần chạy.
5. Nếu có nhiều phương pháp, kết quả được trình bày riêng để đối chiếu.

**Kết quả:** Có kết quả có thể truy vết theo phương pháp/cấu hình/phiên bản, không đánh đồng ML với thống kê.

**Ngoại lệ:** Không đủ dữ liệu; tham số không hợp lệ; model không khả dụng; Backend gián đoạn → thông báo rõ, không tạo kết quả giả.

#### UC-05 — Xem và đánh giá bất thường

**Điều kiện trước:** Có anomaly đã tồn tại; người dùng có quyền phù hợp.

1. Người dùng mở chi tiết anomaly.
2. Hệ thống hiển thị phép đo liên quan, vị trí, thời gian, phương pháp, điểm số, mức độ và trạng thái.
3. `analyst/admin` có thể đổi `status` hoặc `note`.
4. Hệ thống lưu đánh giá và cập nhật phiên bản chỉnh sửa.

**Kết quả:** Ghi nhận ý kiến người dùng mà **không ghi đè kết quả tính toán gốc**.

**Ngoại lệ:** Không đủ quyền; anomaly không tồn tại; phiên bản cũ bị sửa trên thiết bị khác → không ghi đè âm thầm.

#### UC-06 — Tự động lưu dữ liệu, sử dụng offline và đồng bộ

**Điều kiện trước:** Người dùng đã truy cập và xác thực ứng dụng thành công ít nhất một lần khi online; tài nguyên cần thiết để **khởi chạy giao diện offline** đã được lưu trên thiết bị. **Không yêu cầu** người dùng chủ động chọn/tải dữ liệu offline trước khi mất mạng. Để *xem hoặc phân tích một tập dữ liệu cụ thể* khi offline, tập dữ liệu đó phải **đã được tải và lưu cục bộ thành công** (tự động hoặc theo yêu cầu).

**Luồng chính — Khi online:**

1. Người dùng truy cập ứng dụng và mở dataset, trạm, khoảng thời gian hoặc kết quả phân tích cần xem.
2. Khi tải dữ liệu từ Backend **thành công**, hệ thống **tự động lưu cục bộ** chính phần dữ liệu đã nhận được để có thể sử dụng lại nếu mất mạng. Hệ thống chuẩn bị/lưu các tài nguyên ứng dụng cần thiết cho việc mở lại giao diện offline.
3. *Tùy chọn:* Người dùng có thể chủ động chọn **Tải về dùng offline** cho dataset/phạm vi lớn hơn hoặc chưa từng mở; hệ thống hiển thị kết quả tải và trạng thái sẵn sàng offline. Đây **không phải bước bắt buộc** để sử dụng phần dữ liệu đã auto-cache.

**Luồng chính — Khi mất mạng đột ngột hoặc Backend không truy cập được:**

4. Ứng dụng chuyển sang sử dụng dữ liệu đã lưu trên thiết bị, thông báo rõ trạng thái offline và phạm vi dữ liệu sẵn có; không bắt người dùng phải tải trước ngay trước sự cố.
5. Người dùng tiếp tục xem dữ liệu/kết quả đã lưu, lọc trong phạm vi sẵn có và chạy **thống kê** trên readings cục bộ. Nếu chỉ 100 readings đã được tải thì chỉ cam kết 100 readings ấy, **không suy diễn toàn bộ dataset đã lưu**.
6. `analyst/admin` có thể sửa `status/note` của anomaly **đã tồn tại trên Server và được tải về trước đó**; hệ thống lưu thao tác vào hàng đợi cục bộ trước khi chờ đồng bộ.

**Luồng chính — Khi Backend phục hồi:**

7. Hệ thống tự thử đồng bộ những thao tác còn chờ, xác thực và kiểm tra phiên bản khi gửi lên Server; cập nhật kết quả hoặc thông báo xung đột rồi làm mới dữ liệu cục bộ phù hợp.

**Kết quả:** Mất mạng bất ngờ không làm mất khả năng sử dụng **phần dữ liệu đã lưu thành công**; thao tác offline đã ghi vào hàng đợi không bị mất khi tải lại ứng dụng và gửi lại không tạo tác động trùng.

**Ngoại lệ:** Chưa từng khởi tạo ứng dụng khi online; dữ liệu chưa được tải hoặc chưa lưu xong; dung lượng lưu trữ không đủ; mất mạng giữa lúc tải/gửi; nhiều thiết bị sửa cùng anomaly; nhiều tab; Backend chết dù thiết bị còn Internet → hiển thị trạng thái thích hợp, không hứa có dữ liệu chưa lưu. Nếu việc lưu tự động thất bại, hệ thống không được báo nhầm rằng dữ liệu đã sẵn sàng offline.

**Giới hạn:** Không upload/import hoàn chỉnh khi offline; **không chạy ML inference mới**; không bảo đảm đầy đủ bản đồ nền Mapbox khi không có mạng. Anomaly do thống kê mới phát hiện khi offline là **kết quả cục bộ**, không tự mang ID Server, không tự coi là đã lưu vào MongoDB.

**Kịch bản nghiệm thu:**

- **AT-06A (Mất mạng bất ngờ):** Analyst mở và tải thành công 100 readings khi online → ngắt mạng đột ngột **không bấm tải offline** → vẫn xem được 100 readings này và chạy thống kê offline trên tập đã lưu.
- **AT-06B (Giới hạn dữ liệu):** Dataset có 10.000 readings nhưng trình duyệt chỉ tải/lưu 100 readings → ngắt mạng → không tuyên bố có đủ cả 10.000 readings; yêu cầu chưa được lưu phải nhận thông báo dữ liệu chưa sẵn có.
- **AT-06C (Tải trước tùy chọn):** Analyst chọn lưu thêm khoảng thời gian chưa từng xem → khi thao tác tải hoàn tất, phần này cũng truy cập được offline.
- **AT-06D (Đồng bộ):** Analyst sửa `note/status` của anomaly đã tải khi offline → khôi phục Backend → thay đổi được đồng bộ một lần; nếu phiên bản xung đột thì hệ thống báo xung đột thay vì âm thầm ghi đè.

---

## 3. Quy tắc nghiệp vụ (Business Rules)

| ID | Quy tắc phải tuân thủ |
|---|---|
| **BR-01** | MVP chỉ cam kết phân tích số đo **PM2.5**, chuẩn hóa về `µg/m³`. |
| **BR-02** | Mỗi reading thuộc một dataset, một trạm và một thời điểm; dữ liệu các dataset không được trộn lẫn ngoài ý muốn. |
| **BR-03** | Kinh độ hợp lệ từ `-180` đến `180`, vĩ độ từ `-90` đến `90`; tọa độ trao đổi theo quy ước WGS84. |
| **BR-04** | Thời gian chuẩn hóa lưu theo UTC; timestamp không phân tích được bị từ chối. |
| **BR-05** | Giá trị PM2.5 phải là số hữu hạn, không âm; giá trị rất cao **không tự động bị loại** chỉ vì nó có thể là bất thường. |
| **BR-06** | Mapping trường quan trọng, đơn vị và thông tin thời gian cần xác nhận; không âm thầm suy đoán khi còn mơ hồ. |
| **BR-07** | Bộ dữ liệu có lỗi/chưa hoàn tất nhập không được xuất hiện như dataset đã nhập thành công trong tra cứu thông thường. |
| **BR-08** | **Đã chốt phương án B.** Trong cùng một dataset, mỗi bộ ba `(datasetId, sensorId, timestamp)` chỉ được có một reading. Khi gặp các bản ghi trùng khóa, hệ thống giữ bản ghi **hợp lệ đầu tiên** theo thứ tự tiếp nhận và bỏ qua các bản ghi đến sau. Nếu trùng cả giá trị thì báo cáo là **trùng hoàn toàn**; nếu khác giá trị thì báo cáo là **xung đột dữ liệu**, không tự ghi đè. Báo cáo nhập phải cho biết số lượng, dòng/vị trí và lý do bỏ qua. Các dataset khác nhau được phép chứa cùng `sensorId` và `timestamp`. |
| **BR-09** | Thống kê và ML là **hai nguồn kết quả độc lập**, luôn nhận diện được phương pháp, tham số và phiên bản tương ứng. |
| **BR-10** | Một reading có thể được gắn cờ trong nhiều lần phân tích; không ép thành một kết quả duy nhất. |
| **BR-11** | ML sử dụng model đã train trước, chỉ chạy inference khi online; không train lại trong luồng upload thông thường. |
| **BR-12** | Phân tích thống kê phải xử lý trường hợp ít dữ liệu, phương sai bằng 0 hoặc đầu vào không hợp lệ; không coi `NaN` là một anomaly hợp lệ. |
| **BR-13** | Trạng thái đánh giá anomaly chỉ gồm `open`, `confirmed`, `false_positive`; trạng thái review tách biệt với score và method của detector. |
| **BR-14** | Cả `analyst` và `admin` được xem, phân tích, upload và đánh giá anomaly; chỉ `admin` được thực hiện các thao tác quản trị tài khoản. Backend kiểm tra quyền. |
| **BR-15** | Chỉnh sửa anomaly có phiên bản; khi Client gửi trên phiên bản cũ, Server phải phát hiện và phản hồi xung đột, không ghi đè im lặng. |
| **BR-16** | Mỗi mutation offline có mã định danh duy nhất; gửi lại cùng mutation không được áp dụng tác động nhiều lần. |
| **BR-17** | Khi đồng bộ, Server là nguồn dữ liệu có thẩm quyền; kết quả xung đột phải được thông báo cho Client. |
| **BR-18** | Chỉ sync chỉnh sửa trên anomaly đã tồn tại trên Server; kết quả phát hiện thống kê mới tạo offline được giữ là kết quả cục bộ cho tới khi có quy trình lưu chính thức. |
| **BR-19** | Dữ liệu seed tự tạo nhãn phải được phân biệt với dữ liệu thực; không tuyên bố precision/recall/F1 trên dữ liệu thực không có nhãn chuẩn. |
| **BR-20** | Khi online, dữ liệu đã tải thành công để người dùng xem phải được **tự động lưu cục bộ** trong phạm vi hệ thống hỗ trợ; người dùng không cần chủ động tải để phòng mất mạng. Phải phân biệt dữ liệu đã lưu và dữ liệu chưa lưu. |
| **BR-21** | Chức năng tải trước dữ liệu offline chỉ là **tùy chọn** mở rộng phạm vi có sẵn. Tải chưa hoàn tất hoặc lưu thất bại không được hiển thị là sẵn sàng offline. |
| **BR-22** | Khi offline, chỉ thao tác trên **phần dữ liệu thực sự có sẵn trên thiết bị**; không được ngầm suy diễn rằng toàn bộ dataset hoặc tài nguyên bản đồ nền đã được lưu chỉ vì người dùng từng mở một trang. |

---

## 4. Yêu cầu dữ liệu (Data Requirements)

### 4.1. Các thực thể logic

| Thực thể | Dữ liệu tối thiểu cần quản lý | Quan hệ/ý nghĩa |
|---|---|---|
| **User** | ID, tên đăng nhập, thông tin xác thực an toàn, role | Người truy cập và đánh giá anomaly |
| **Dataset** | ID, tên, nguồn file, trạng thái nhập, mapping, báo cáo kiểm tra, người tạo | Một lần/bộ dữ liệu được tiếp nhận |
| **Sensor** | ID nội bộ, mã trạm từ nguồn, tên, vị trí, loại, đơn vị, dataset | Một dataset có nhiều trạm |
| **Reading** | ID, dataset, sensor, timestamp, vị trí, giá trị PM2.5 | Một trạm có nhiều phép đo theo thời gian |
| **Analysis Run** | ID, dataset, phương pháp, cấu hình, trạng thái, thời điểm, phiên bản engine/model | Một lần chạy có thể tạo nhiều anomalies |
| **Anomaly** | ID, reading, sensor, dataset, analysis run, vị trí/thời gian, method, score, severity, status, note, version | Một reading có thể có nhiều phát hiện |
| **Processed Mutation** | Mã mutation, người gửi, thời điểm, kết quả xử lý | Ngăn tác động lặp khi đồng bộ |
| **Offline Local Data** | Phạm vi dataset/sensor/reading/anomaly **đã tự lưu hoặc đã tải trước thành công**, kết quả thống kê local, trạng thái sẵn sàng offline, hàng đợi thao tác, mốc sync | Hỗ trợ sử dụng ngay khi mất mạng đột ngột và đồng bộ khi phục hồi |

Đây là **mô hình dữ liệu logic**, chưa cố định tên collection, khóa, index hay biểu diễn ObjectId. Việc chuyển các thực thể thành MongoDB documents, index và TypeScript DTO thuộc SDD/Shared Schema.

### 4.2. Trường dữ liệu đầu vào chuẩn ở mức nghiệp vụ

| Trường logic | Ý nghĩa | Bắt buộc/điều kiện |
|---|---|---|
| `sensorId` | Mã trạm trong file dữ liệu | Bắt buộc |
| `longitude`, `latitude` | Vị trí trạm | Bắt buộc, theo BR-03 |
| `timestamp` | Thời điểm đo | Bắt buộc, theo BR-04 |
| `value` | Giá trị PM2.5 | Bắt buộc, theo BR-05 |
| `unit` | Đơn vị giá trị nguồn | Phải được xác định/xác nhận để chuẩn hóa |
| `name` | Tên trạm | Có thể mặc định bằng mã trạm nếu thiếu |
| `region` | Khu vực | Không bắt buộc nếu nguồn không có |

Tên cột của file nguồn được phép khác tên trường chuẩn, ví dụ `station_id`, `lat`, `lon`, `observed_at`, `pm25`; hệ thống gợi ý ánh xạ nhưng phải có xác nhận của người dùng.

### 4.3. Tính nhất quán và truy vết

- Reading phải tham chiếu được tới sensor và dataset liên quan.
- Analysis Run phải thuộc dataset tương ứng; anomaly phải truy vết được về reading và lần phân tích.
- Thông tin review của người dùng được lưu riêng về mặt ý nghĩa so với kết quả detector.
- Dữ liệu đã nhập thành công và dữ liệu ở phiên nhập lỗi phải phân biệt được.
- Những thay đổi cần đồng bộ phải xác định được mutation và phiên bản đối tượng.

---

## 5. Yêu cầu phi chức năng và ràng buộc kỹ thuật

### 5.1. Yêu cầu cần đáp ứng

| ID | Yêu cầu |
|---|---|
| **NFR-01** | Frontend và Backend phải sử dụng JavaScript/TypeScript; có API Client–Server. |
| **NFR-02** | MongoDB là cơ sở dữ liệu chính; thiết kế lưu trữ và truy vấn dữ liệu không gian–thời gian phù hợp. |
| **NFR-03** | Hệ thống chạy qua Nginx với HTTPS/TLS cổng `443`; nghiên cứu/sử dụng OpenSSL trong môi trường thử nghiệm. |
| **NFR-04** | Ứng dụng có cơ chế lưu tài nguyên để mở lại giao diện và **tự động lưu dữ liệu người dùng đã tải thành công vào bộ nhớ cục bộ**; đáp ứng kịch bản mất mạng đột ngột mà không cần bấm tải offline trước. Cho phép tải thêm dữ liệu theo yêu cầu, có trạng thái xác nhận lưu thành công. |
| **NFR-05** | Có cơ chế tự đồng bộ và xử lý gửi trùng/xung đột; không chỉ dựa vào trạng thái kết nối Internet của thiết bị. |
| **NFR-06** | Có kiểm thử unit, integration, end-to-end, load/stress và báo cáo coverage. |
| **NFR-07** | Có bằng chứng đánh giá hiệu năng truy vấn MongoDB, xử lý dữ liệu, thuật toán và hai chế độ trực quan 3D. |
| **NFR-08** | Có xác thực, phân quyền phía Server; bảo vệ thông tin xác thực và giới hạn đầu vào upload phù hợp. |
| **NFR-09** | Kết quả thuật toán có phương pháp/cấu hình/phiên bản; báo cáo phân biệt dữ liệu mô phỏng có nhãn và dữ liệu thực. |

### 5.2. Mục tiêu đo thử của nhóm — không phải kết quả đã đạt

- **Quy mô dữ liệu thử:** 200–500 trạm, 100k–500k readings.
- **Backend load test:** Kịch bản 100 virtual users/10 phút, mục tiêu `p95 < 500 ms` và tỷ lệ lỗi `< 1%` đối với **các API đọc được chỉ định**, không tự áp dụng cho upload/ML.
- **Frontend:** Đo FPS riêng Mapbox và Cube với 10k/50k/100k điểm; mức `≥ 50 FPS` tại 100k điểm là **mục tiêu khảo sát**, phụ thuộc máy và cách hiển thị.
- **Coverage mục tiêu:** `shared-core ≥ 90%`, `server ≥ 80%`, logic client `≥ 70%`.
- **Thuật toán:** Đánh giá precision/recall/F1 trên dữ liệu seed có nhãn; mốc recall `≥ 85%` và F1 `≥ 0,8` là **mục tiêu đánh giá**, không bảo đảm đạt trước thực nghiệm.
- **Báo cáo:** Ghi rõ môi trường, cấu hình máy, số bản ghi, kịch bản và kết quả thực; so sánh trước/sau tối ưu.

Redis là **tùy chọn**, không phải yêu cầu bắt buộc trong MVP. Công cụ, cấu trúc triển khai, index, cách kiểm thử cụ thể được mô tả trong SDD và test plan.

---

## 6. Những quyết định chưa chốt và tác động đến SDD

| ID | Nội dung cần quyết định | Mức ảnh hưởng | Nguyên tắc tạm thời |
|---|---|---|---|
| **OPEN-02** | Timestamp nguồn thiếu timezone được chấp nhận sau xác nhận hay từ chối? | Mapping, validation, normalize | Không tự gán timezone không có căn cứ |
| **OPEN-03** | Thuật toán/model ML cuối cùng, feature và định dạng lưu model | ML, integration, analysis output | Isolation Forest chỉ là ứng viên; phải kiểm chứng train → load → predict |
| **OPEN-04** | Các ngưỡng cụ thể để ánh xạ score sang severity, cấu hình mặc định của detector | Engine, Shared Schema, UI | Không tự coi ngưỡng minh họa là ngưỡng đã được duyệt |
| **OPEN-05** | Giới hạn file upload, kích thước batch và chính sách báo cáo lỗi quá nhiều dòng | Import, performance | Phải có giới hạn an toàn; thông số trong SDD |
| **OPEN-06** | Cơ chế xử lý phân tích lâu: phản hồi đồng bộ hay có trạng thái job | Analysis API, FE | Không thêm job queue phức tạp khi chưa đo thử |

**OPEN-01 đã được giải quyết** bằng BR-08 (phương án B: giữ bản ghi hợp lệ đầu tiên, bỏ trùng có báo cáo); không còn là quyết định mở.

Các mục còn lại **không được AI tự xem là đã chốt**. Nhóm trưởng có thể hoàn thiện SDD những phần độc lập trước; phần giao tiếp giữa các thành viên chỉ khóa khi quyết định liên quan được thống nhất.

---


**Lịch sử phiên bản**

| Phiên bản | Ngày | Nội dung |
|---|---|---|
| `0.1` | 11/11/2026 | SRS tinh gọn phục vụ thiết kế SDD và phát triển song song, kế thừa kế hoạch thống nhất ngày 11/11 |
| `0.2` | 11/11/2026 | Bỏ role `viewer`; giữ `analyst` và `admin` (Application Admin), tách quyền hạ tầng DevOps khỏi JWT role |
| `0.3` | 11/11/2026 | Làm rõ auto-cache khi online, sử dụng khi mất mạng đột ngột, tải trước tùy chọn, phạm vi dữ liệu offline, nghiệm thu UC-06; cập nhật FR-11, BR-20–22, NFR-04 |
| `0.4` | 11/11/2026 | Chốt BR-08 phương án B: giữ bản ghi hợp lệ đầu tiên; báo cáo trùng hoàn toàn/xung đột, loại OPEN-01 khỏi danh sách chưa chốt; cập nhật UC-02 |
