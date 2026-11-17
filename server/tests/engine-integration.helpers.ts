import { fileURLToPath } from 'node:url';
import manifest from '../ml/pm25-v2-manifest.json' with { type: 'json' };
import type { IsolationOptions } from '../src/engines/isolation-forest.js';
export { manifest };
export function isolationOptions(overrides: Partial<IsolationOptions> = {}): IsolationOptions {
  const executable = process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python';
  return { pythonExecutable: process.env.DETECTOR_PYTHON ?? fileURLToPath(new URL(`../../.local/detector-venv/${executable}`, import.meta.url)),
    artifactPath: process.env.DETECTOR_ARTIFACT ?? fileURLToPath(new URL(`../../.local/models/pm25-iforest-v2/${manifest.filename}`, import.meta.url)),
    manifestPath: fileURLToPath(new URL('../ml/pm25-v2-manifest.json', import.meta.url)),
    scriptPath: fileURLToPath(new URL('../ml/isolation_forest.py', import.meta.url)),
    modelId: manifest.id, artifactSha256: manifest.sha256, sklearnVersion: manifest.sklearnVersion, features: manifest.features,
    timeoutMs: 30000, maxInputBytes: 1024 * 1024, maxOutputBytes: 1024 * 1024, maxConcurrent: 1, ...overrides };
}
