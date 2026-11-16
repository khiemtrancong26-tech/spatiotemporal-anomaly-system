import type { AnalysisRun } from '../../shared/api/generated/wire';
/** One in-flight read; disposal and generation prevent late responses crossing scopes. */
export function followRun(options: {
  load: (signal: AbortSignal) => Promise<AnalysisRun>;
  update: (run: AnalysisRun) => void; error: (error: unknown) => void;
  interval: number; maxBackoff: number; visible?: () => boolean; random?: () => number;
}) {
  let disposed = false, busy = false, terminal = false, failures = 0, halted = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let controller: AbortController | undefined;
  const visible = options.visible ?? (() => true);
  async function refresh() {
    if (disposed || busy || terminal || !visible()) return;
    clearTimeout(timer); halted = false; busy = true; controller = new AbortController();
    try {
      const run = await options.load(controller.signal);
      if (disposed) return;
      failures = 0; terminal = run.status === 'completed' || run.status === 'failed'; options.update(run);
    } catch (error) { if (!disposed) { failures++; halted = !!error && typeof error === 'object' && 'status' in error && [401, 403, 404].includes(Number(error.status)); options.error(error); } }
    finally {
      busy = false;
      if (!disposed && !terminal && !halted) {
        const delay = Math.min(options.maxBackoff, options.interval * 2 ** Math.min(failures, 6));
        timer = setTimeout(() => { void refresh(); }, Math.min(options.maxBackoff, delay * (failures ? 0.8 + (options.random ?? Math.random)() * 0.2 : 1)));
      }
    }
  }
  void refresh();
  return { refresh, dispose() { disposed = true; clearTimeout(timer); controller?.abort(); } };
}
