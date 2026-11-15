/** FIFO limiter. Optional cancellation removes waiting work without consuming a slot. */
export function createTaskLimiter(maximum: number) {
  if (!Number.isInteger(maximum) || maximum < 1) throw new TypeError('Invalid concurrency');
  let active = 0;
  const waiting: (() => void)[] = [];
  return async function run<T>(work: () => Promise<T>, signal?: AbortSignal): Promise<T> {
    signal?.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const acquire = () => { signal?.removeEventListener('abort', cancel); active++; resolve(); };
      const cancel = () => {
        const index = waiting.indexOf(acquire);
        if (index >= 0) waiting.splice(index, 1);
        reject(signal?.reason);
      };
      if (active < maximum) acquire();
      else { waiting.push(acquire); signal?.addEventListener('abort', cancel, { once: true }); }
    });
    try { signal?.throwIfAborted(); return await work(); }
    finally { active--; waiting.shift()?.(); }
  };
}
