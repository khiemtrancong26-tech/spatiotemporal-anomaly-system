import { afterEach, expect, it, vi } from 'vitest';
import { installClientErrorHandlers, runClientTask } from './error-handling';

afterEach(() => vi.restoreAllMocks());

it('reports window errors and unhandled rejections without logging private payloads', () => {
  const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
  const remove = installClientErrorHandlers(window);
  try {
    window.dispatchEvent(new ErrorEvent('error', { error: new TypeError('private account token') }));
    const rejection = new Event('unhandledrejection');
    Object.defineProperty(rejection, 'reason', { value: new Error('private API address') });
    window.dispatchEvent(rejection);

    expect(logger.mock.calls.map(([, details]) => details)).toEqual([
      { source: 'window-error', kind: 'TypeError' },
      { source: 'unhandled-rejection', kind: 'Error' },
    ]);
  } finally { remove(); }
});

it('reports a rejected detached task through the same handler', async () => {
  const logger = vi.spyOn(console, 'error').mockImplementation(() => {});
  runClientTask(Promise.reject(new RangeError('private payload')));
  await vi.waitFor(() => expect(logger).toHaveBeenCalledExactlyOnceWith(
    '[PM2.5] Unexpected client error', { source: 'async-task', kind: 'RangeError' },
  ));
});
