import { useStore } from 'zustand';
import { Link } from '@tanstack/react-router';
import { useServices } from '../../app/services';
import { Badge, EmptyState, PageTitle } from '../../shared/ui/primitives';
import { ConnectionCheck } from './connection-check';

export function DatasetsFoundation() {
  return <>
    <PageTitle eyebrow="BẮT ĐẦU KHÁM PHÁ" title="Dữ liệu của bạn" description="Chọn bộ dữ liệu PM2.5 để tìm hiểu những thay đổi theo không gian và thời gian." action={<Link to="/datasets/import" className="button button--primary">+ Nhập dataset</Link>} />
    <div className="foundation-grid"><section className="card dataset-card"><div className="card-heading"><h2>Danh sách dataset</h2><Badge>Chuẩn bị ở M2</Badge></div><EmptyState title="Không gian dữ liệu đã sẵn sàng" description="Danh sách dataset và phiên đăng nhập sẽ được kết nối trong mốc tiếp theo. Chưa truy vấn dữ liệu của bạn." action={<Link to="/datasets/import" className="text-link">Xem luồng nhập dữ liệu <span aria-hidden="true">→</span></Link>} /><div className="card-footnote"><span aria-hidden="true">ⓘ</span> Dataset nhập thành công sẽ xuất hiện tại đây.</div></section><ConnectionCheck /></div>
    <section className="journey" aria-labelledby="journey-title"><div className="section-heading"><h2 id="journey-title">Một luồng làm việc, nhiều góc nhìn</h2><span className="muted">Các chức năng sẽ được triển khai theo từng mốc</span></div><div className="journey-grid">{[
      ['01', 'Chuẩn bị dữ liệu', 'CSV hoặc JSON → kiểm tra dữ liệu → xác nhận mapping.', 'M3'],
      ['02', 'Khám phá không gian', 'Cùng bộ lọc, hai góc nhìn: Mapbox 3D và Space–Time Cube.', 'M4'],
      ['03', 'Phân tích và đánh giá', 'Chạy detector online, xem điểm nghi vấn và lưu review.', 'M5–M6'],
    ].map(([number, title, description, milestone]) => <article className="journey-card" key={number}><span className="step-number">{number}</span><Badge>{milestone}</Badge><h3>{title}</h3><p className="muted">{description}</p></article>)}</div></section>
  </>;
}
export function FeaturePlaceholder({ title, milestone, description, steps }: { title: string; milestone: string; description: string; steps: string[] }) {
  return <><PageTitle eyebrow={`LỘ TRÌNH · ${milestone}`} title={title} description={description} /><section className="card"><div className="card-heading"><h2>Luồng dự kiến</h2><Badge>Chưa triển khai nghiệp vụ</Badge></div><ol className="steps">{steps.map((step) => <li key={step}>{step}</li>)}</ol><EmptyState title={`Sẽ được hoàn thiện ở ${milestone}`} description="M1 chuẩn bị giao diện nền và lớp dữ liệu. Màn hình này chưa gửi thao tác nghiệp vụ lên Server." action={<Link className="button button--secondary" to="/datasets">Về Datasets</Link>} /></section></>;
}
export function AdminFoundation() {
  const { session } = useServices();
  const role = useStore(session.store, (state) => state.user?.role);
  if (role !== 'admin') return <EmptyState title="Khu vực dành cho Admin" description="Quản lý tài khoản yêu cầu phiên Admin hợp lệ. Ở bản mock, có thể đổi vai trò xem thử trong thanh thông báo." action={<Link to="/datasets" className="text-link">Về Datasets</Link>} />;
  return <FeaturePlaceholder title="Quản lý tài khoản" milestone="M7" description="Tạo tài khoản và cập nhật quyền sử dụng ứng dụng." steps={['Danh sách tài khoản', 'Tạo tài khoản', 'Cập nhật role / trạng thái hoạt động']} />;
}
