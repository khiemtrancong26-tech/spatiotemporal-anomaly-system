import { fileURLToPath } from 'node:url';
import manifest from '../ml/artifact-manifest.json' with { type: 'json' };
import type { IsolationOptions } from '../src/engines/isolation-forest.js';
export { manifest };
export function isolationOptions(overrides: Partial<IsolationOptions> = {}): IsolationOptions {
  const executable = process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python';
  return { pythonExecutable: process.env.DETECTOR_PYTHON ?? fileURLToPath(new URL(`../../.local/iforest-artifact-venv/${executable}`, import.meta.url)),
    artifactPath: process.env.DETECTOR_ARTIFACT ?? fileURLToPath(new URL(`../../.local/models/${manifest.id}/${manifest.filename}`, import.meta.url)),
    manifestPath: fileURLToPath(new URL('../ml/artifact-manifest.json', import.meta.url)),
    scriptPath: fileURLToPath(new URL('../ml/isolation_forest.py', import.meta.url)),
    modelId: manifest.id, sklearnVersion: manifest.sklearnVersion, features: manifest.features,
    timeoutMs: 30000, maxInputBytes: 1024 * 1024, maxOutputBytes: 1024 * 1024, maxConcurrent: 1, ...overrides };
}
