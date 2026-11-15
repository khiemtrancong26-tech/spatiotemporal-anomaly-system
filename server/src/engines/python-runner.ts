import { spawn } from 'node:child_process';
import { isAbsolute } from 'node:path';
import { createCapacity } from '../shared/import-capacity.js';

export class EngineError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'EngineError'; }
}
export interface PythonRunnerOptions {
  pythonExecutable: string; scriptPath: string; args: string[];
  timeoutMs: number; maxInputBytes: number; maxOutputBytes: number; maxConcurrent: number;
}
export function createPythonRunner(options: PythonRunnerOptions) {
  if (!isAbsolute(options.pythonExecutable) || !isAbsolute(options.scriptPath) ||
    [options.pythonExecutable, options.scriptPath, ...options.args].some(value => typeof value !== 'string' || value.includes('\0')) ||
    ![options.timeoutMs, options.maxInputBytes, options.maxOutputBytes, options.maxConcurrent].every(value => Number.isSafeInteger(value) && value > 0)) throw new TypeError('Explicit Python runner paths/limits are required');
  const capacity = createCapacity(options.maxConcurrent);
  return async (payload: unknown, signal?: AbortSignal): Promise<unknown> => {
    const encoded = JSON.stringify(payload);
    if (encoded === undefined || Buffer.byteLength(encoded) > options.maxInputBytes) throw new EngineError('ENGINE_INPUT_LIMIT', 'Engine input exceeds the configured byte limit.');
    if (signal?.aborted) throw new EngineError('ENGINE_ABORTED', 'Engine wait was aborted.');
    const release = capacity.acquire();
    if (!release) throw new EngineError('ENGINE_BUSY', 'Engine process capacity is busy.');
    return new Promise((resolve, reject) => {
      let failure: EngineError | undefined, bytes = 0;
      const chunks: Buffer[] = [];
      const environment = Object.fromEntries(['PATH', 'Path', 'SystemRoot', 'WINDIR', 'TEMP', 'TMP', 'HOME', 'USERPROFILE'].flatMap(key => process.env[key] ? [[key, process.env[key]!]] : []));
      const child = spawn(options.pythonExecutable, [options.scriptPath, ...options.args], { shell: false, windowsHide: true,
        stdio: ['pipe', 'pipe', 'pipe'], env: { ...environment, PYTHONNOUSERSITE: '1', PYTHONDONTWRITEBYTECODE: '1',
          OMP_NUM_THREADS: '1', OPENBLAS_NUM_THREADS: '1', MKL_NUM_THREADS: '1', PYTHONIOENCODING: 'utf-8' } });
      const stop = (error: EngineError) => { failure ??= error; child.kill(); };
      const timer = setTimeout(() => stop(new EngineError('ENGINE_TIMEOUT', 'Engine exceeded the configured deadline.')), options.timeoutMs); timer.unref();
      const abort = () => stop(new EngineError('ENGINE_ABORTED', 'Engine wait was aborted.'));
      signal?.addEventListener('abort', abort, { once: true });
      child.on('error', () => { failure ??= new EngineError('ENGINE_UNAVAILABLE', 'Python process could not start.'); });
      child.stdin.on('error', () => { /* Process close/error determines the sanitized result. */ });
      child.stderr.on('data', () => { /* Drain without returning/logging paths, payloads or native tracebacks. */ });
      child.stdout.on('data', (chunk: Buffer) => {
        bytes += chunk.length;
        if (bytes > options.maxOutputBytes) stop(new EngineError('ENGINE_OUTPUT_LIMIT', 'Engine output exceeds the configured byte limit.'));
        else if (!failure) chunks.push(chunk);
      });
      child.on('close', code => {
        clearTimeout(timer); signal?.removeEventListener('abort', abort); release();
        if (failure) { reject(failure); return; }
        let result: unknown;
        try { result = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(Buffer.concat(chunks))); }
        catch { reject(new EngineError('ENGINE_PROTOCOL_ERROR', 'Python output is not valid JSON.')); return; }
        if (code !== 0) {
          const error = result && typeof result === 'object' && 'error' in result ? result.error : undefined;
          const known = ['MODEL_RUNTIME_MISMATCH', 'MODEL_INTEGRITY_ERROR', 'FEATURE_SCHEMA_MISMATCH', 'INVALID_FEATURES', 'MODEL_TYPE_MISMATCH', 'INVALID_MODEL_OUTPUT', 'MODEL_UNAVAILABLE'];
          const errorCode = error && typeof error === 'object' && 'code' in error && typeof error.code === 'string' && known.includes(error.code) ? error.code : 'ENGINE_UNAVAILABLE';
          reject(new EngineError(errorCode, 'Model inference did not complete.')); return;
        }
        resolve(result);
      });
      child.stdin.end(encoded);
    });
  };
}
