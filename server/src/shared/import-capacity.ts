export function createCapacity(maximum: number) {
  let active = 0;
  return {
    acquire(): (() => void) | null {
      if (active >= maximum) return null;
      active++;
      let released = false;
      return () => { if (!released) { released = true; active--; } };
    },
  };
}
