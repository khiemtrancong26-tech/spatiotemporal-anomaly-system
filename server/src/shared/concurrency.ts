/** FIFO limiter. All hashing/verifying in a process share one instance. */
export function createTaskLimiter(maximum: number) {
  if (!Number.isInteger(maximum) || maximum < 1) throw new TypeError('Invalid concurrency');
  let active = 0;
  const waiting: (() => void)[] = [];
  return async function run<T>(work: () => Promise<T>): Promise<T> {
    await new Promise<void>((resolve) => {
      const acquire = () => { active++; resolve(); };
      if (active < maximum) acquire(); else waiting.push(acquire);
    });
    try { return await work(); }
    finally { active--; waiting.shift()?.(); }
  };
}
