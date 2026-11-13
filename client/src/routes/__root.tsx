import { createRootRoute, Link } from '@tanstack/react-router';
import { AppShell } from '../app/shell';
import { EmptyState, ErrorState } from '../shared/ui/primitives';

export const Route = createRootRoute({
  component: AppShell,
  errorComponent: ({ reset }) => <div className="boundary"><ErrorState message="Giao diện gặp sự cố. Bạn có thể thử tải lại màn hình." retry={reset} /><a href="/datasets">Về Datasets</a></div>,
  notFoundComponent: () => <EmptyState title="Không tìm thấy trang" description="Đường dẫn này không thuộc ứng dụng." action={<Link to="/datasets" className="button button--primary">Về Datasets</Link>} />,
});
