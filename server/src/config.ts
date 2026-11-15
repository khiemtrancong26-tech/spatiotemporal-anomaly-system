import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';

export interface ImportConfig {
  storageDir: string; maxFileBytes: number; maxRecordBytes: number; batchSize: number;
  maxIssues: number; maxSensors: number; uploadConcurrency: number; importConcurrency: number;
  timeoutMs: number; leaseMs: number; replayMs: number;
}
export interface AnalysisConfig {
  concurrency: number; leaseMs: number; heartbeatMs: number; pollMs: number;
  maxAttempts: number; timeoutMs: number; maxReadings: number; maxPending: number;
  maxSensorIds: number; replayMs: number; batchSize: number;
  pythonExecutable: string; artifactPath: string; manifestPath: string; scriptPath: string;
}

export interface ServerConfig {
  host: string;
  port: number;
  mongodbUri: string;
  mongodbDatabase: string | undefined;
  mongodbTimeoutMs: number;
  corsOrigins: string[];
  jwtSecret: string;
  cursorSecret: string;
  loginRateMax: number;
  loginRateWindowMs: number;
  imports: ImportConfig;
  analysis: AnalysisConfig;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
}

function integer(value: string | undefined, fallback: number, name: string, maximum: number): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`Invalid ${name}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1 || parsed > maximum) throw new Error(`Invalid ${name}`);
  return parsed;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const mongodbUri = env.MONGODB_URI ?? 'mongodb://127.0.0.1:27017/spatiotemporal_anomaly';
  if (!/^mongodb(?:\+srv)?:\/\/\S+$/.test(mongodbUri)) throw new Error('Invalid MONGODB_URI');
  const logLevel = env.LOG_LEVEL ?? 'info';
  if (!['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent'].includes(logLevel)) {
    throw new Error('Invalid LOG_LEVEL');
  }
  const host = env.HOST ?? '127.0.0.1';
  if (!host.trim()) throw new Error('Invalid HOST');
  if (env.MONGODB_DATABASE !== undefined && !/^[a-zA-Z0-9_-]+$/.test(env.MONGODB_DATABASE)) {
    throw new Error('Invalid MONGODB_DATABASE');
  }
  const corsOrigins = (env.CORS_ORIGINS ?? '').split(',').map((origin) => origin.trim()).filter(Boolean);
  for (const origin of corsOrigins) {
    let parsed: URL;
    try { parsed = new URL(origin); } catch { throw new Error('Invalid CORS_ORIGINS'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.origin !== origin) throw new Error('Invalid CORS_ORIGINS');
  }
  const jwtSecret = env.JWT_SECRET ?? '';
  if (Buffer.byteLength(jwtSecret) < 32 || /^replace_with_/i.test(jwtSecret)) throw new Error('JWT_SECRET must be a random secret of at least 32 bytes');
  const leaseMs = integer(env.ANALYSIS_LEASE_MS, 30_000, 'ANALYSIS_LEASE_MS', 300_000);
  const heartbeatMs = integer(env.ANALYSIS_HEARTBEAT_MS, 10_000, 'ANALYSIS_HEARTBEAT_MS', 100_000);
  if (heartbeatMs * 2 >= leaseMs) throw new Error('ANALYSIS_HEARTBEAT_MS must be less than half the lease');
  return {
    host,
    port: integer(env.PORT, 3001, 'PORT', 65_535),
    mongodbUri,
    mongodbDatabase: env.MONGODB_DATABASE,
    mongodbTimeoutMs: integer(env.MONGODB_TIMEOUT_MS, 2_000, 'MONGODB_TIMEOUT_MS', 60_000),
    corsOrigins,
    jwtSecret,
    // Stable across restarts with domain separation from JWT signing.
    cursorSecret: createHmac('sha256', jwtSecret).update('pm25:cursor:v1').digest('hex'),
    loginRateMax: integer(env.LOGIN_RATE_LIMIT_MAX, 10, 'LOGIN_RATE_LIMIT_MAX', 100_000),
    loginRateWindowMs: integer(env.LOGIN_RATE_LIMIT_WINDOW_MS, 60_000, 'LOGIN_RATE_LIMIT_WINDOW_MS', 86_400_000),
    analysis: {
      concurrency: integer(env.ANALYSIS_CONCURRENCY, 1, 'ANALYSIS_CONCURRENCY', 32),
      leaseMs, heartbeatMs,
      pollMs: integer(env.ANALYSIS_POLL_MS, 1000, 'ANALYSIS_POLL_MS', 60_000),
      maxAttempts: integer(env.ANALYSIS_MAX_ATTEMPTS, 3, 'ANALYSIS_MAX_ATTEMPTS', 10),
      timeoutMs: integer(env.ANALYSIS_TIMEOUT_MS, 120_000, 'ANALYSIS_TIMEOUT_MS', 600_000),
      maxReadings: integer(env.ANALYSIS_MAX_READINGS, 50_000, 'ANALYSIS_MAX_READINGS', 50_000),
      maxPending: integer(env.ANALYSIS_MAX_PENDING, 100, 'ANALYSIS_MAX_PENDING', 1000),
      maxSensorIds: integer(env.ANALYSIS_MAX_SENSOR_IDS, 10_000, 'ANALYSIS_MAX_SENSOR_IDS', 10_000),
      replayMs: 24 * 60 * 60 * 1000, batchSize: 500,
      pythonExecutable: resolve(env.ANALYSIS_PYTHON ?? fileURLToPath(new URL(`../../.local/detector-venv/${process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'}`, import.meta.url))),
      artifactPath: resolve(env.ANALYSIS_ARTIFACT ?? fileURLToPath(new URL('../../.local/models/pm25-iforest-v1/isolation_forest.joblib', import.meta.url))),
      manifestPath: fileURLToPath(new URL('../ml/pm25-manifest.json', import.meta.url)),
      scriptPath: fileURLToPath(new URL('../ml/isolation_forest.py', import.meta.url)),
    },
    imports: {
      storageDir: env.IMPORT_STORAGE_DIR ? resolve(env.IMPORT_STORAGE_DIR) : fileURLToPath(new URL('../../.local/imports/', import.meta.url)),
      maxFileBytes: integer(env.IMPORT_MAX_FILE_BYTES, 100 * 1024 * 1024, 'IMPORT_MAX_FILE_BYTES', 1024 * 1024 * 1024),
      maxRecordBytes: integer(env.IMPORT_MAX_RECORD_BYTES, 1024 * 1024, 'IMPORT_MAX_RECORD_BYTES', 8 * 1024 * 1024),
      batchSize: integer(env.IMPORT_BATCH_SIZE, 1000, 'IMPORT_BATCH_SIZE', 1000),
      maxIssues: integer(env.IMPORT_MAX_ISSUES, 1000, 'IMPORT_MAX_ISSUES', 1000),
      maxSensors: integer(env.IMPORT_MAX_SENSORS, 10000, 'IMPORT_MAX_SENSORS', 10000),
      uploadConcurrency: integer(env.IMPORT_UPLOAD_CONCURRENCY, 2, 'IMPORT_UPLOAD_CONCURRENCY', 2),
      importConcurrency: integer(env.IMPORT_CONCURRENCY, 1, 'IMPORT_CONCURRENCY', 1),
      timeoutMs: integer(env.IMPORT_TIMEOUT_MS, 120_000, 'IMPORT_TIMEOUT_MS', 120_000),
      leaseMs: integer(env.IMPORT_LEASE_MS, 30_000, 'IMPORT_LEASE_MS', 120_000),
      replayMs: 24 * 60 * 60 * 1000,
    },
    logLevel: logLevel as ServerConfig['logLevel'],
  };
}
