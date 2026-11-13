import { useId, type ButtonHTMLAttributes, type InputHTMLAttributes, type PropsWithChildren, type ReactNode } from 'react';

export function Button({ className = '', variant = 'primary', ...props }: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'primary' | 'secondary' }) {
  return <button type="button" className={`button button--${variant} ${className}`} {...props} />;
}
export function Badge({ children, tone = 'neutral' }: PropsWithChildren<{ tone?: 'neutral' | 'blue' | 'warning' | 'success' }>) {
  return <span className={`badge badge--${tone}`}>{children}</span>;
}
export function Field({ label, hint, error, ...props }: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string; error?: string }) {
  const autoId = useId();
  const id = props.id ?? autoId;
  return <div className="field"><label htmlFor={id}>{label}</label><input {...props} id={id} aria-invalid={Boolean(error)} aria-describedby={error || hint ? `${id}-help` : undefined} />{(error || hint) && <small id={`${id}-help`} className={error ? 'text-error' : ''}>{error ?? hint}</small>}</div>;
}
export function PageTitle({ eyebrow, title, description, action }: { eyebrow: string; title: string; description: string; action?: ReactNode }) {
  return <div className="page-title"><div><p className="eyebrow">{eyebrow}</p><h1>{title}</h1><p className="muted">{description}</p></div>{action}</div>;
}
export function LoadingState({ label = 'Đang tải dữ liệu…' }: { label?: string }) {
  return <div className="state" role="status"><span className="spinner" aria-hidden="true" />{label}</div>;
}
export function EmptyState({ title, description, action }: { title: string; description: string; action?: ReactNode }) {
  return <div className="state state--empty"><span className="state-symbol" aria-hidden="true">◇</span><h2>{title}</h2><p className="muted">{description}</p>{action}</div>;
}
export function ErrorState({ message, retry }: { message: string; retry?: () => void }) {
  return <div className="state state--error" role="alert"><strong>Không thể hoàn tất yêu cầu</strong><p>{message}</p>{retry && <Button variant="secondary" onClick={retry}>Thử lại</Button>}</div>;
}
export function CursorLoadMore({ count, hasMore, pending, onLoad }: { count: number; hasMore: boolean; pending: boolean; onLoad: () => void }) {
  return <div className="table-footer"><span className="muted">Đã tải {count} bản ghi{hasMore ? ' · Còn dữ liệu' : ''}</span>{hasMore && <Button variant="secondary" disabled={pending} onClick={onLoad}>{pending ? 'Đang tải…' : 'Tải thêm'}</Button>}</div>;
}
