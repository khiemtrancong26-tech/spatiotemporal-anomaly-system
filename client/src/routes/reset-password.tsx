import { createFileRoute } from '@tanstack/react-router';
import { EmailPage } from '../features/auth/email-pages';
export const Route = createFileRoute('/reset-password')({ component: () => <EmailPage kind="reset" /> });
