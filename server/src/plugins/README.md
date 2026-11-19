# Plugin Fastify dùng chung

> Đây là nơi gắn các chức năng hạ tầng để nhiều module dùng cùng kết nối DB và quy tắc HTTP.

## Mở file nào

- Tạo MongoClient dùng chung, quản lý pool và đóng kết nối. [`mongo.ts`](mongo.ts)
- Gắn authenticate và authorize cho route. [`auth.ts`](auth.ts)
- Chuẩn hóa lỗi HTTP và phản hồi cho đường dẫn hoặc phương thức sai. [`http.ts`](http.ts)
