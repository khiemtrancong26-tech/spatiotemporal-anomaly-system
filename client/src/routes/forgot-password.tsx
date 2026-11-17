import { createFileRoute } from '@tanstack/react-router';
import { EmailPage } from '../features/auth/email-pages';
export const Route = createFileRoute('/forgot-password')({ component: () => <EmailPage kind="forgot" /> });
