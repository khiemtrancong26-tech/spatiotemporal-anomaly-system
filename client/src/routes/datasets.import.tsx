import { createFileRoute } from '@tanstack/react-router';
import { ImportPage } from '../features/dataset-import/page';
export const Route = createFileRoute('/datasets/import')({ component: ImportPage });
