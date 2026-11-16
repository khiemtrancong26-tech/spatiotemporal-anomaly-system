import { afterEach, describe, expect, it, vi } from 'vitest';
import { createConnectivityService } from './connectivity';

afterEach(() => {
  vi.restoreAllMocks();
});

describe('ConnectivityService', () => {
  it('moves online after a valid health response', async () => {
    const health = vi.fn().mockResolvedValue({ status: 'ok', timestamp: new Date().toISOString() });
    const service = createConnectivityService(health);

    await service.check();

    expect(health).toHaveBeenCalledTimes(1);
    expect(service.getSnapshot().status).toBe('online');
    expect(service.getSnapshot().consecutiveFailures).toBe(0);
    service.stop();
  });

  it('uses degraded for the first failed probe and offline after the threshold', async () => {
    const health = vi.fn().mockRejectedValue(new Error('backend unavailable'));
    const service = createConnectivityService(health, { failureThreshold: 2 });

    await service.check();
    expect(service.getSnapshot().status).toBe('degraded');
    await service.check();
    expect(service.getSnapshot().status).toBe('offline');
    expect(service.getSnapshot().consecutiveFailures).toBe(2);
    service.stop();
  });

  it('notifies subscribers when the connection snapshot changes', async () => {
    const health = vi.fn().mockResolvedValue({ status: 'ok', timestamp: new Date().toISOString() });
    const service = createConnectivityService(health);
    const listener = vi.fn();
    const unsubscribe = service.subscribe(listener);

    await service.check();

    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    service.stop();
  });
});
