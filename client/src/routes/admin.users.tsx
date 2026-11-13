import { createFileRoute } from '@tanstack/react-router';
import { AdminFoundation } from '../features/foundation/pages';
export const Route = createFileRoute('/admin/users')({ component: AdminFoundation });
