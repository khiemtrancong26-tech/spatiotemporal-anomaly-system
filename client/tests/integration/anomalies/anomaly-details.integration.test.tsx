import { StrictMode } from 'react';
import { cleanup, render, screen, waitFor } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { createPreviewStore, ServicesProvider } from '../../../src/app/services';
import type { Anomaly, Reading } from '../../../src/shared/api/generated/wire';
import type { OnlineDataSource } from '../../../src/shared/data-source/types';
import { createWorkspaceStore } from '../../../src/features/workspace/state';
import { AnomaliesPage } from '../../../src/features/anomalies/page';

const reading: Reading = {
  id: 'reading-1', datasetId: 'dataset-1', sensorId: 'sensor-1', ts: '2015-03-01T00:00:00.000Z',
  location: { type: 'Point', coordinates: [116.3, 39.9] }, value: 48, unit: 'ug/m3',
};
const anomaly: Anomaly = {
  id: 'anomaly-1', datasetId: reading.datasetId, sensorId: reading.sensorId, readingId: reading.id,
  ts: reading.ts, location: reading.location, analysisRunId: 'run-1', family: 'statistical',
  method: 'zscore', score: 4, severity: 'high', status: 'open', note: '', updatedAt: reading.ts, version: 1,
};
const page = <T,>(data: T[]) => ({ data, page: { limit: 100, nextCursor: null } });

function setup(get: OnlineDataSource['anomalies']['get']) {
  const workspace = createWorkspaceStore();
  workspace.getState().openDataset(reading.datasetId);
  workspace.getState().openAnomalies(anomaly.analysisRunId, anomaly.id);
  const data = {
    anomalies: { get, list: async () => page([anomaly]) },
    readings: { list: async () => page([reading]) },
    sensors: { list: async () => page([]) },
  } as unknown as OnlineDataSource;
  const services = { workspace, data, preview: createPreviewStore(), config: { mode: 'online' as const, apiBaseUrl: 'http://localhost:3001/api/v1' } };
  return (active = true) => <ServicesProvider services={services}>
    <AnomaliesPage datasetId={reading.datasetId} filters={{}} active={active} />
  </ServicesProvider>;
}

afterEach(cleanup);

it('opens anomaly details when StrictMode cancels the first effect', async () => {
  const renderPage = setup(vi.fn().mockResolvedValue(anomaly));
  render(<StrictMode>{renderPage()}</StrictMode>);
  expect(await screen.findByText(/Đã xác minh đúng dataset/)).toBeVisible();
  expect(screen.queryByText('Đang đọc chi tiết anomaly…')).toBeNull();
});

it('resumes an interrupted detail request when returning to Anomalies', async () => {
  const get = vi.fn<OnlineDataSource['anomalies']['get']>()
    .mockImplementationOnce(() => new Promise(() => {}))
    .mockResolvedValue(anomaly);
  const renderPage = setup(get);
  const view = render(renderPage());
  await waitFor(() => expect(get).toHaveBeenCalledOnce());
  const firstSignal = get.mock.calls[0][1]?.signal;

  view.rerender(renderPage(false));
  expect(firstSignal?.aborted).toBe(true);
  view.rerender(renderPage());

  expect(await screen.findByText(/Đã xác minh đúng dataset/)).toBeVisible();
  expect(screen.queryByText('Đang đọc chi tiết anomaly…')).toBeNull();
  expect(get).toHaveBeenCalledTimes(2);

  view.rerender(renderPage(false));
  view.rerender(renderPage());
  expect(get).toHaveBeenCalledTimes(2);
});
