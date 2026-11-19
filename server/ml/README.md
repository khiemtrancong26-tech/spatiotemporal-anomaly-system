# Isolation Forest — một model PM2.5

> Thư mục này chứa mã Python cho Isolation Forest. Khi backend chạy phân tích, tiến trình Python nạp model đã huấn luyện và chấm điểm bất thường từ các đặc trưng do Node.js gửi. Khâu huấn luyện chạy riêng.

D020 thay thế setup hai model trong D019. Hệ thống chỉ dùng artifact 3 features đã train tại C3: `[value, temporal_delta, spatial_delta]`, đúng thứ tự này. Request ML dùng `method: "isolation_forest", config: {}`. Không có flag bật model, selector hoặc training API.

- [Manifest](pm25-v2-manifest.json), model ID `pm25-iforest-uci501-v2` là provenance cố định, không phải lựa chọn phiên bản của client.
- Artifact `.local/models/pm25-iforest-v2/isolation_forest.joblib`, SHA256 `0b891da07da2ffcd83f647d296b9642bfb4f2331c3ee0512947bf6eb2af7209c`, 241932 bytes. Giữ nguyên manifest/artifact từ C3; không train lại trong lượt đơn giản hóa.
- Nguồn UCI501, Chen S. (2017), DOI 10.24432/C5RK5G, CC BY4.0. Tọa độ golden owner-provided và fixed +08:00 đã được duyệt cho baseline; không nhận đã kiểm định tọa độ độc lập. Split/provenance/matrix hashes trong manifest, golden 03/2015 không fit.
- [Pure TS Feature Builder](../../shared-core/src/features/pm25-v2.ts) dùng chung offline export/inference. Giữ temporal gap ≤2h, fixed3 nearest neighbors ≤50km, min2 same-time readings, không neighbor thứ4/no future/cross-dataset.
- [Export CLI](../scripts/export-pm25-v2-features.ts) và [offline train CLI](train_pm25_v2.py) giữ để truy vết recipe. Không gọi khi startup/request/Worker; từ chối ghi đè artifact/manifest. Model hiện có đã fit một lần, không cần chạy lại CLI.

## Chạy inference

Cung cấp artifact tin cậy đúng hash; binary không nằm trong Git. Dùng Python3.11.9 và các packages pin trong `requirements-pm25.txt`, không cài vào Python global.

```powershell
# Chỉ setup runtime khi chưa có venv:
python -m venv .local/detector-venv
.local/detector-venv/Scripts/python.exe -m pip install -r server/ml/requirements-pm25.txt
# .env, chỉ đặt nếu khác mặc định:
# ANALYSIS_PYTHON=C:/path/to/python.exe
# ANALYSIS_ARTIFACT=C:/pm25-data/models/pm25-iforest-v2/isolation_forest.joblib
npm run dev:server
```

Linux dùng `bin/python` và env absolute path. Package `server/ml` cùng `server/dist`, vì manifest/inference script là runtime assets. Chỉ dùng `ANALYSIS_ARTIFACT`; không còn `ANALYSIS_V2_ENABLED`/`ANALYSIS_V2_ARTIFACT`.

Adapter/Python runner giữ protocol JSON stdin/stdout version1, load verified bytes rồi predict; không đổi protocol thành “model v1”. Kiểm manifest/runtime/SHA256/feature order trước load. Chỉ load artifact do operator tin cậy, không nhận pickle/path từ HTTP. Hash bảo đảm integrity, không tự chứng minh pickle an toàn.

Thiếu/hỏng artifact trước acceptance →503; sau acceptance →run failed, không summary/partial public, không fallback/train lại. Completed ML luôn có `scoringSummary`; score `-decision_function`, predict=-1 là anomaly, severity low tạm. Thiếu context là unscorable, không phải normal. Không tuyên bố accuracy khi thiếu nhãn.

[Kiểm chứng và demo](../../docs/backend/c3-single-model-verification.md). Model một feature, manifest/train CLI và artifact demo x0/x1 đã xóa; kết quả D014/B5/C3 cũ vẫn được ghi là lịch sử. `npm run verify:detectors` hiện dùng đúng artifact duy nhất với vectors adapter có nhãn thử nghiệm, không thay pipeline context/Worker thật. Không benchmark/stress/tối ưu trong C3.
