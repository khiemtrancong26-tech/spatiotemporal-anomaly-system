export function createCapacity(maximum: number, maxWaiting = 0) {
  let active = 0;
  type Release = () => void;
  const waiting: ((release: Release) => void)[] = [];
  function reserve(): Release {
    active++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      active--;
      const next = waiting.shift();
      if (next) next(reserve());
    };
  }
  return {
    acquire(): Release | null {
      return active < maximum ? reserve() : null;
    },
    async acquireOrWait(signal: AbortSignal): Promise<Release | null> {
      if (signal.aborted) return null;
      if (active < maximum) return reserve();
      if (waiting.length >= maxWaiting) return null;
      return new Promise(resolve => {
        const cancel = () => {
          const index = waiting.indexOf(admit);
          if (index !== -1) waiting.splice(index, 1);
          resolve(null);
        };
        const admit = (release: Release) => {
          signal.removeEventListener('abort', cancel);
          resolve(release);
        };
        waiting.push(admit);
        signal.addEventListener('abort', cancel, { once: true });
      });
    },
  };
}
