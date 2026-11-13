import { createFileRoute } from '@tanstack/react-router';
import { WorkspacePage } from '../features/workspace/page';
export const Route = createFileRoute('/workspace/$datasetId')({ component: Workspace });
function Workspace() { const { datasetId } = Route.useParams(); return <WorkspacePage key={datasetId} datasetId={datasetId} />; }
