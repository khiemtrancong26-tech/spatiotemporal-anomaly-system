import { createFileRoute } from '@tanstack/react-router';
import { LoginPage } from '../features/auth/pages';
export const Route = createFileRoute('/login')({
  validateSearch: (search: Record<string, unknown>): { redirect?: string; registered?: boolean; reset?: boolean } => ({ reset: search.reset === true ? true : undefined, redirect: typeof search.redirect === 'string' ? search.redirect : undefined, registered: search.registered === true ? true : undefined }),
  component: Login,
});
function Login() { const { redirect, registered, reset } = Route.useSearch(); return <LoginPage destination={redirect} registered={registered} reset={reset} />; }
