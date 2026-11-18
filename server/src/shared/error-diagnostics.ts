const errorKinds = new Set([
  'Error', 'TypeError', 'RangeError', 'ReferenceError', 'SyntaxError', 'AggregateError',
  'AbortError', 'HttpError', 'EngineError', 'MongoServerError', 'MongoNetworkError',
  'MongoServerSelectionError', 'MongoOperationTimeoutError',
]);

export function errorDiagnostics(error: unknown): { errorKind: string; errorCode?: string | number } {
  if (!(error instanceof Error)) return { errorKind: 'NonErrorThrow' };
  const errorKind = errorKinds.has(error.name) ? error.name : 'Error';
  const code = 'code' in error ? error.code : undefined;
  if (typeof code === 'number' && Number.isSafeInteger(code)) return { errorKind, errorCode: code };
  if (typeof code === 'string' && /^[A-Z][A-Z0-9_]{1,47}$/.test(code)) return { errorKind, errorCode: code };
  return { errorKind };
}
