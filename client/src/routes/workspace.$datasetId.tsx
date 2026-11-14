import { createFileRoute } from '@tanstack/react-router';
import { WorkspacePage } from '../features/workspace/page';
export const Route = createFileRoute('/workspace/$datasetId')({ validateSearch: (search: Record<string, unknown>): { runId?: string } => ({ runId: typeof search.runId === 'string' && search.runId.length <= 200 ? search.runId : undefined }), component: Workspace });
function Workspace() { const { datasetId } = Route.useParams(); const { runId } = Route.useSearch(); const navigate = Route.useNavigate(); return <WorkspacePage key={datasetId} datasetId={datasetId} runId={runId} selectRun={id => { void navigate({ search: { runId: id }, replace: true }); }} />; }
