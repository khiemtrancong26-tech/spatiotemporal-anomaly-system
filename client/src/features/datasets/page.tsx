import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Link } from '@tanstack/react-router';
import { useServices } from '../../app/services';
import { createCursorPager } from '../../shared/lib/cursor-pager';
import { PageTitle, LoadingState, EmptyState, ErrorState, CursorLoadMore } from '../../shared/ui/primitives';
import { errorMessage } from '../../shared/api/errors';
import { ConnectionCheck } from '../foundation/connection-check';
export function DatasetsPage() {
  const { data, datasets } = useServices();
  const [sort, setSort] = useState<'createdAt:asc' | 'createdAt:desc'>('createdAt:desc');
  const pager = useMemo(() => createCursorPager(data.datasets.list), [data]);
  const state = useSyncExternalStore(pager.subscribe, pager.getSnapshot);
  useEffect(() => { void pager.setQuery({ sort }); return () => pager.dispose(); }, [pager, sort]);
  const imported = state.data.filter((dataset) => dataset.status === 'imported');
  return <><PageTitle eyebrow="DATASETS" title="Dữ liệu của bạn" description="Chọn dataset đã nhập thành công để khám phá." action={<Link to="/datasets/import" className="button button--primary">+ Nhập dataset</Link>} /><section className="card dataset-list"><label className="field">Sắp xếp<select value={sort} onChange={(e) => setSort(e.target.value as typeof sort)}><option value="createdAt:desc">Mới nhất</option><option value="createdAt:asc">Cũ nhất</option></select></label>{state.status === 'loading' && <LoadingState />}{state.status === 'error' && <ErrorState message={errorMessage(state.error)} retry={() => { void pager.retry(); }} />}{state.status === 'ready' && !imported.length && <EmptyState title="Chưa có dataset imported" description="Nhập một dataset mới để bắt đầu hoặc tải thêm nếu còn trang." />}<div className="table-scroll"><table><thead><tr><th>Dataset</th><th>File nguồn</th><th>Ngày tạo · UTC+07</th><th>Kết quả nhập</th><th>Thao tác</th></tr></thead><tbody>{imported.map((dataset) => <tr key={dataset.id}><td>{dataset.name}</td><td>{dataset.sourceFilename}</td><td>{new Intl.DateTimeFormat('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', dateStyle: 'short', timeStyle: 'medium' }).format(new Date(dataset.createdAt))}</td><td>{dataset.importSummary ? `${dataset.importSummary.importedRows} dòng nhập · ${dataset.importSummary.invalidRows} dòng lỗi` : 'Chưa có báo cáo'}</td><td><Link to="/workspace/$datasetId" params={{ datasetId: dataset.id }} className="text-link" onClick={() => datasets.set(dataset.id, dataset)}>Mở dữ liệu</Link></td></tr>)}</tbody></table></div><CursorLoadMore count={imported.length} hasMore={state.nextCursor !== null} pending={state.status === 'loading'} onLoad={() => { void pager.loadMore(); }} /></section><div className="connection-section"><ConnectionCheck /></div></>;
}
