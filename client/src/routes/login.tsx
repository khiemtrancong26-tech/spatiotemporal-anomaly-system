import { createFileRoute } from '@tanstack/react-router';
import { LoginPage } from '../features/auth/pages';
export const Route = createFileRoute('/login')({ validateSearch: (search: Record<string, unknown>) => ({ redirect: typeof search.redirect === 'string' ? search.redirect : undefined }), component: Login });
function Login() { return <LoginPage destination={Route.useSearch().redirect} />; }
