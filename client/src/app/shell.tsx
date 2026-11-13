import { useStore } from 'zustand';
import { AuthGate } from '../features/auth/pages';
import { Link, Outlet } from '@tanstack/react-router';
import { Badge } from '../shared/ui/primitives';
import { useServices } from './services';

export function AppShell() {
  const { config, mock, session } = useServices();
  const auth = useStore(session.store);
  const role = auth.user?.role;
  return <div className="app-shell">
    <a className="skip-link" href="#main-content">Đến nội dung chính</a>
    <aside className="sidebar">
      <Link to="/datasets" className="brand"><span className="brand-mark">P<span>25</span></span><span>PM2.5<span className="brand-sub">EXPLORER</span></span></Link>
      <p className="nav-label">KHÔNG GIAN LÀM VIỆC</p>
      <nav aria-label="Điều hướng chính">
        <Link to="/datasets" activeOptions={{ exact: true }} activeProps={{ className: 'active' }}><span aria-hidden="true">▦</span> Datasets</Link>
        <Link to="/datasets/import" activeProps={{ className: 'active' }}><span aria-hidden="true">↥</span> Nhập dữ liệu</Link>
        {role === 'admin' && <Link to="/admin/users" activeProps={{ className: 'active' }}><span aria-hidden="true">♙</span> Quản lý tài khoản</Link>}
      </nav>
      <div className="sidebar-note"><span className="small-label">DỮ LIỆU KHÔNG GIAN–THỜI GIAN</span><p>Từ phép đo đến góc nhìn.</p><span>PM2.5 tại các trạm cố định</span></div>
      <div className="sidebar-footer"><span className="dot" /> Frontend P0 · Online</div>
    </aside>
    <div className="main-shell">
      <header className="topbar"><span className="breadcrumb">Không gian làm việc <span>/</span> <strong>PM2.5 Explorer</strong></span><div className="topbar-actions"><Badge>M2 · Workspace</Badge>{auth.user ? <><span>{auth.user.username} · {auth.user.role}</span><button className="button button--secondary logout-button" onClick={session.logout}>Đăng xuất</button></> : <Link to="/login" search={{ redirect: undefined }} className="text-link">Đăng nhập</Link>}</div></header>
      {mock && <div className="mock-banner"><div><strong>DỮ LIỆU MÔ PHỎNG</strong><span>Chỉ để phát triển giao diện. Không phải kết quả phân tích thực.</span></div></div>}
      <main id="main-content" tabIndex={-1}><AuthGate><Outlet /></AuthGate></main>
      <footer className="page-footer"><span>PM2.5 Explorer · {config.mode === 'mock' ? 'Bản phát triển với dữ liệu mô phỏng' : 'Kết nối API online'}</span><span>Thời gian hiển thị: UTC+07:00</span></footer>
    </div>
  </div>;
}
