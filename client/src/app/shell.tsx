import { useStore } from 'zustand';
import { useSyncExternalStore } from 'react';
import { AuthGate } from '../features/auth/pages';
import { Link, Outlet, useLocation } from '@tanstack/react-router';
import { Icon } from '../shared/ui/icons';
import { Badge } from '../shared/ui/primitives';
import { useServices } from './services';


const emptySubscribe = () => () => undefined;
const unknownConnectivity = { status: 'degraded' as const, consecutiveFailures: 0 };
const getUnknownConnectivity = () => unknownConnectivity;

function ConnectivityIndicator() {
  const { connectivity } = useServices();
  const snapshot = useSyncExternalStore(
    connectivity?.subscribe ?? emptySubscribe,
    connectivity?.getSnapshot ?? getUnknownConnectivity,
    connectivity?.getSnapshot ?? getUnknownConnectivity,
  );
  if (!connectivity) return null;
  const tone = snapshot.status === 'online' ? 'success' : snapshot.status === 'offline' ? 'warning' : 'blue';
  const label = snapshot.status === 'online' ? 'Backend kết nối' : snapshot.status === 'offline' ? 'Offline' : snapshot.backendStatus === 'degraded' ? 'Backend suy giảm' : 'Đang kiểm tra';
  return <Badge tone={tone}>{label}</Badge>;
}

export function AppShell() {
  const { config, mock, session, connectivity } = useServices();
  const connection = useSyncExternalStore(
    connectivity?.subscribe ?? emptySubscribe,
    connectivity?.getSnapshot ?? getUnknownConnectivity,
    connectivity?.getSnapshot ?? getUnknownConnectivity,
  );
  const auth = useStore(session.store);
  const role = auth.user?.role;
  const location = useLocation();
  const isAuth = location.pathname === '/login' || location.pathname === '/register';
  return <div className={`app-shell${isAuth ? ' app-shell--auth' : location.pathname.startsWith('/workspace/') ? ' app-shell--workspace' : ''}`}>
    <a className="skip-link" href="#main-content">Đến nội dung chính</a>
    <aside className="sidebar">
      <Link to="/datasets" className="brand"><span className="brand-mark"><Icon name="layers" size={25} /></span><span>PM2.5<span className="brand-sub">EXPLORER</span></span></Link>
      <p className="nav-label">KHÔNG GIAN LÀM VIỆC</p>
      <nav aria-label="Điều hướng chính">
        <Link to="/datasets" title="Datasets" activeOptions={{ exact: true }} activeProps={{ className: 'active' }}><Icon name="dataset" /> Datasets</Link>
        <Link to="/datasets/import" title="Nhập dữ liệu" activeProps={{ className: 'active' }}><Icon name="upload" /> Nhập dữ liệu</Link>
        {role === 'admin' && <Link to="/admin/users" title="Quản lý tài khoản" activeProps={{ className: 'active' }}><Icon name="users" /> Quản lý tài khoản</Link>}
      </nav>
      <div className="sidebar-note"><span className="small-label">DỮ LIỆU KHÔNG GIAN–THỜI GIAN</span><p>Từ phép đo đến góc nhìn.</p><span>PM2.5 tại các trạm cố định</span></div>
      <div className="sidebar-footer"><span className="dot" /> Geospatial analytics</div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><span className="breadcrumb">Không gian làm việc <span>/</span> <strong>PM2.5 Explorer</strong></span><div className="topbar-actions"><Badge tone={config.mode === 'mock' ? 'warning' : 'blue'}>{config.mode === 'mock' ? 'Demo' : 'API'}</Badge><ConnectivityIndicator />{auth.user ? <><span className="account-label"><span className="avatar" aria-hidden="true">{auth.user.username.slice(0, 2).toUpperCase()}</span><span>{auth.user.username}<small>{auth.user.role}</small></span></span><button className="button button--secondary logout-button" onClick={session.logout}>Đăng xuất</button></> : <Link to="/login" search={{ redirect: undefined }} className="text-link">Đăng nhập</Link>}</div></header>
      {connectivity && connection.status !== 'online' && <div className="offline-status-banner" role="status">{connection.status === 'offline' ? 'Backend không truy cập được. Ứng dụng sẽ dùng dữ liệu đã lưu trên thiết bị khi có sẵn; phạm vi chưa tải không được bảo đảm offline.' : connection.backendStatus === 'degraded' ? 'Backend phản hồi trạng thái suy giảm. Kiểm tra và thao tác ghi chưa được xem là đã xác nhận.' : 'Đang xác minh kết nối Backend. Các thao tác ghi chỉ được xác nhận khi Server phản hồi.'}</div>}
      {mock && <div className="mock-banner"><div><strong>DỮ LIỆU MÔ PHỎNG</strong><span>Chỉ để phát triển giao diện. Không phải kết quả phân tích thực.</span></div></div>}
      <main id="main-content" tabIndex={-1}><AuthGate><Outlet /></AuthGate></main>
      <footer className="page-footer"><span>PM2.5 Explorer · {config.mode === 'mock' ? 'Bản phát triển với dữ liệu mô phỏng' : 'Kết nối API online'}</span><span>Thời gian hiển thị: UTC+07:00</span></footer>
    </div>
  </div>;
}
