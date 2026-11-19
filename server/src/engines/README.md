# Bộ kết nối thuật toán

> Thư mục này kết nối Analysis với detector thống kê và Isolation Forest, rồi đưa kết quả về dạng ứng viên bất thường.

## Mở file nào

- Điều phối nhánh thống kê hoặc ML. Với ML, Node.js xây đặc trưng và gọi Python. [`online.ts`](online.ts)
- Chạy phép tính thống kê trong Node.js Worker Thread. [`statistical.worker.ts`](statistical.worker.ts)
- Chuẩn bị dữ liệu cho model và kiểm tra kết quả trả về. [`isolation-forest.ts`](isolation-forest.ts)
- Mở tiến trình Python riêng, trao đổi JSON và kiểm soát timeout cùng kích thước dữ liệu. [`python-runner.ts`](python-runner.ts)
- Kiểm tra ID và điểm số trước khi tạo ứng viên bất thường. [`results.ts`](results.ts)

Worker Analysis quyết định vòng đời job và ghi kết quả. Engine thực hiện phần tính toán.
