import { expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ServicesProvider, createPreviewStore } from '../../app/services';
import { createOnlineDataSource } from '../../shared/data-source/online';
import { createMockTransport, type MockControls } from '../../mocks/transport';
import { ConnectionCheck } from './connection-check';

it('renders success, network error and explicit retry through the actual adapter', async () => {
  const mock: MockControls = { role: 'analyst', scenario: 'success', delayMs: 0 };
  const config = { mode: 'mock' as const, apiBaseUrl: 'http://mock.local/api/v1' };
  const data = createOnlineDataSource({ baseUrl: config.apiBaseUrl, fetch: createMockTransport(mock), getAccessToken: () => 'mock' });
  render(<ServicesProvider services={{ config, mock, data, preview: createPreviewStore() }}><ConnectionCheck /></ServicesProvider>);
  const user = userEvent.setup();
  await user.click(screen.getByRole('button', { name: 'Kiểm tra kết nối' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Đã nhận phản hồi hợp lệ');
  await user.selectOptions(screen.getByLabelText('Tình huống kiểm tra'), 'network-error');
  await user.click(screen.getByRole('button', { name: 'Kiểm tra kết nối' }));
  expect(await screen.findByRole('alert')).toHaveTextContent('Không kết nối được Backend');
  mock.scenario = 'success';
  await user.click(screen.getByRole('button', { name: 'Thử lại' }));
  expect(await screen.findByRole('status')).toHaveTextContent('Đã nhận phản hồi hợp lệ');
});
