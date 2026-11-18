const errorKinds = new Set([
  'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError',
  'AbortError', 'SecurityError', 'QuotaExceededError', 'DataSourceError',
]);

export function reportClientError(source: string, error: unknown) {
  const kind = error instanceof Error && errorKinds.has(error.name) ? error.name : 'UnknownError';
  // Error messages and stacks can include data, API URLs, or account credentials.
  console.error('[PM2.5] Unexpected client error', { source, kind });
}

export function runClientTask(task: Promise<unknown> | undefined) {
  task?.catch((error: unknown) => reportClientError('async-task', error));
}

export function installClientErrorHandlers(target: Window) {
  const runtimeError = (event: ErrorEvent) => reportClientError('window-error', event.error);
  const unhandledRejection = (event: PromiseRejectionEvent) => reportClientError('unhandled-rejection', event.reason);
  target.addEventListener('error', runtimeError);
  target.addEventListener('unhandledrejection', unhandledRejection);
  return () => {
    target.removeEventListener('error', runtimeError);
    target.removeEventListener('unhandledrejection', unhandledRejection);
  };
}
