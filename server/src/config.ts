import { createHmac } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import type { ExplorationConfig } from './modules/exploration/exploration.types.js';

export interface ImportConfig {
  storageDir: string; maxFileBytes: number; maxRecordBytes: number; batchSize: number; batchBytes: number; readBufferBytes: number;
  maxIssues: number; maxSensors: number; uploadConcurrency: number; importConcurrency: number;
  scanConcurrency: number; scanMaxWaiting: number; importMaxWaiting: number; importWaitMs: number;
  timeoutMs: number; leaseMs: number; replayMs: number; recoveryBatchSize: number;
}
export interface AnalysisConfig {
  concurrency: number; leaseMs: number; heartbeatMs: number; pollMs: number;
  maxAttempts: number; timeoutMs: number; maxReadings: number; maxPending: number;
  maxSensorIds: number; replayMs: number; batchSize: number;
  pythonExecutable: string; artifactPath: string; manifestPath: string; scriptPath: string;
  pythonMaxInputBytes: number; pythonMaxOutputBytes: number; pythonMaxWaiting: number; pythonThreads: number;
  context: { maxReadings: number; maxSensors: number; maxBytes: number; maxStationMetadata: number };
  transaction: TransactionConfig;
}
export interface TransactionConfig {
  maxCommitTimeMS: number; timeoutMS: number;
}
export interface ReviewConfig {
  transaction: TransactionConfig; maxWaitingPerDataset: number; maxScheduled: number; waitMs: number;
}

export interface ServerConfig {
  host: string;
  port: number;
  mongodbUri: string;
  mongodbDatabase: string | undefined;
  mongodbTimeoutMs: number;
  mongodb: {
    serverSelectionTimeoutMS: number; connectTimeoutMS: number; waitQueueTimeoutMS: number; socketTimeoutMS: number;
    maxPoolSize?: number; minPoolSize?: number; maxConnecting?: number;
  };
  corsOrigins: string[];
  email: { gmailUser?: string | undefined; gmailAppPassword?: string | undefined; appUrl?: string | undefined };
  jwtSecret: string;
  cursorSecret: string;
  loginRateMax: number;
  loginRateWindowMs: number;
  imports: ImportConfig;
  analysis: AnalysisConfig;
  review: ReviewConfig;
  exploration: ExplorationConfig;
  logLevel: 'fatal' | 'error' | 'warn' | 'info' | 'debug' | 'trace' | 'silent';
}

function integer(value: string | undefined, fallback: number, name: string, maximum: number, minimum = 1): number {
  if (value === undefined) return fallback;
  if (!/^\d+$/.test(value)) throw new Error(`Invalid ${name}`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) throw new Error(`Invalid ${name}`);
  return parsed;
}

export const defaultReviewConfig: ReviewConfig = {
  transaction: { maxCommitTimeMS: 10_000, timeoutMS: 15_000 }, maxWaitingPerDataset: 64, maxScheduled: 128, waitMs: 2_000,
};
export const defaultPythonThreads = 1;
export const defaultImportReadBufferBytes = 64 * 1024;

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
  const email = { gmailUser: env.GMAIL_USER?.trim(), gmailAppPassword: env.GMAIL_APP_PASSWORD?.replace(/\s/g, ''), appUrl: env.PUBLIC_APP_URL };
  if (email.gmailUser !== undefined && !/^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/.test(email.gmailUser)) throw new Error('Invalid GMAIL_USER');
  if (email.gmailAppPassword !== undefined && !/^[A-Za-z0-9]{16}$/.test(email.gmailAppPassword)) throw new Error('Invalid GMAIL_APP_PASSWORD');
  if (email.appUrl !== undefined) {
    const url = new URL(email.appUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.origin !== email.appUrl) throw new Error('Invalid PUBLIC_APP_URL');
  }
  const leaseMs = integer(env.ANALYSIS_LEASE_MS, 30_000, 'ANALYSIS_LEASE_MS', 300_000);
  const heartbeatMs = integer(env.ANALYSIS_HEARTBEAT_MS, 10_000, 'ANALYSIS_HEARTBEAT_MS', 100_000);
  if (heartbeatMs * 2 >= leaseMs) throw new Error('ANALYSIS_HEARTBEAT_MS must be less than half the lease');
  const mongodbTimeoutMs = integer(env.MONGODB_TIMEOUT_MS, 2_000, 'MONGODB_TIMEOUT_MS', 60_000);
  const poolOptions = {
    ...(env.MONGODB_MAX_POOL_SIZE !== undefined ? { maxPoolSize: integer(env.MONGODB_MAX_POOL_SIZE, 100, 'MONGODB_MAX_POOL_SIZE', 500) } : {}),
    ...(env.MONGODB_MIN_POOL_SIZE !== undefined ? { minPoolSize: integer(env.MONGODB_MIN_POOL_SIZE, 0, 'MONGODB_MIN_POOL_SIZE', 500, 0) } : {}),
    ...(env.MONGODB_MAX_CONNECTING !== undefined ? { maxConnecting: integer(env.MONGODB_MAX_CONNECTING, 2, 'MONGODB_MAX_CONNECTING', 64) } : {}),
  };
  if (poolOptions.maxPoolSize !== undefined && (poolOptions.minPoolSize ?? 0) > poolOptions.maxPoolSize) {
    throw new Error('MongoDB minimum pool size cannot exceed maximum pool size');
  }
  const transaction = {
    maxCommitTimeMS: integer(env.MONGODB_TRANSACTION_COMMIT_MS, defaultReviewConfig.transaction.maxCommitTimeMS, 'MONGODB_TRANSACTION_COMMIT_MS', 120_000),
    timeoutMS: integer(env.MONGODB_TRANSACTION_TIMEOUT_MS, defaultReviewConfig.transaction.timeoutMS, 'MONGODB_TRANSACTION_TIMEOUT_MS', 120_000),
  };
  if (transaction.maxCommitTimeMS > transaction.timeoutMS) throw new Error('MongoDB commit timeout cannot exceed the transaction timeout');
  return {
    host,
    port: integer(env.PORT, 3001, 'PORT', 65_535),
    mongodbUri,
    mongodbDatabase: env.MONGODB_DATABASE,
    mongodbTimeoutMs,
    mongodb: {
      ...poolOptions,
      serverSelectionTimeoutMS: integer(env.MONGODB_SERVER_SELECTION_TIMEOUT_MS, mongodbTimeoutMs, 'MONGODB_SERVER_SELECTION_TIMEOUT_MS', 120_000),
      connectTimeoutMS: integer(env.MONGODB_CONNECT_TIMEOUT_MS, mongodbTimeoutMs, 'MONGODB_CONNECT_TIMEOUT_MS', 120_000),
      waitQueueTimeoutMS: integer(env.MONGODB_WAIT_QUEUE_TIMEOUT_MS, mongodbTimeoutMs, 'MONGODB_WAIT_QUEUE_TIMEOUT_MS', 120_000),
      socketTimeoutMS: integer(env.MONGODB_SOCKET_TIMEOUT_MS, mongodbTimeoutMs, 'MONGODB_SOCKET_TIMEOUT_MS', 120_000),
    },
    review: { transaction,
      maxWaitingPerDataset: integer(env.REVIEW_MAX_WAITING_PER_DATASET, defaultReviewConfig.maxWaitingPerDataset, 'REVIEW_MAX_WAITING_PER_DATASET', 256, 0),
      maxScheduled: integer(env.REVIEW_MAX_SCHEDULED, defaultReviewConfig.maxScheduled, 'REVIEW_MAX_SCHEDULED', 1024),
      waitMs: integer(env.REVIEW_WAIT_MS, defaultReviewConfig.waitMs, 'REVIEW_WAIT_MS', 15_000),
    },
    corsOrigins,
    jwtSecret,
    email,
    // Stable across restarts with domain separation from JWT signing.
    cursorSecret: createHmac('sha256', jwtSecret).update('pm25:cursor:v1').digest('hex'),
    loginRateMax: integer(env.LOGIN_RATE_LIMIT_MAX, 10, 'LOGIN_RATE_LIMIT_MAX', 100_000),
    loginRateWindowMs: integer(env.LOGIN_RATE_LIMIT_WINDOW_MS, 60_000, 'LOGIN_RATE_LIMIT_WINDOW_MS', 86_400_000),
    exploration: {
      maxReadings: integer(env.EXPLORATION_MAX_READINGS, 500000, 'EXPLORATION_MAX_READINGS', 500000),
      maxSeries: integer(env.EXPLORATION_MAX_SERIES, 20, 'EXPLORATION_MAX_SERIES', 20),
      maxCells: integer(env.EXPLORATION_MAX_CELLS, 20000, 'EXPLORATION_MAX_CELLS', 20000),
      maxResponseBytes: integer(env.EXPLORATION_MAX_RESPONSE_BYTES, 5 * 1024 * 1024, 'EXPLORATION_MAX_RESPONSE_BYTES', 5 * 1024 * 1024),
      timeoutMs: integer(env.EXPLORATION_TIMEOUT_MS, 5000, 'EXPLORATION_TIMEOUT_MS', 5000),
      concurrency: integer(env.EXPLORATION_CONCURRENCY, 2, 'EXPLORATION_CONCURRENCY', 2),
    },
    analysis: {
      concurrency: integer(env.ANALYSIS_CONCURRENCY, 1, 'ANALYSIS_CONCURRENCY', 32),
      leaseMs, heartbeatMs,
      pollMs: integer(env.ANALYSIS_POLL_MS, 1000, 'ANALYSIS_POLL_MS', 60_000),
      maxAttempts: integer(env.ANALYSIS_MAX_ATTEMPTS, 3, 'ANALYSIS_MAX_ATTEMPTS', 10),
      timeoutMs: integer(env.ANALYSIS_TIMEOUT_MS, 120_000, 'ANALYSIS_TIMEOUT_MS', 600_000),
      maxReadings: integer(env.ANALYSIS_MAX_READINGS, 50_000, 'ANALYSIS_MAX_READINGS', 50_000),
      maxPending: integer(env.ANALYSIS_MAX_PENDING, 100, 'ANALYSIS_MAX_PENDING', 1000),
      maxSensorIds: integer(env.ANALYSIS_MAX_SENSOR_IDS, 10_000, 'ANALYSIS_MAX_SENSOR_IDS', 10_000),
      replayMs: 24 * 60 * 60 * 1000,
      batchSize: integer(env.ANALYSIS_BATCH_SIZE, 500, 'ANALYSIS_BATCH_SIZE', 5_000),
      transaction,
      pythonMaxInputBytes: integer(env.ANALYSIS_PYTHON_MAX_INPUT_BYTES, 16 * 1024 * 1024, 'ANALYSIS_PYTHON_MAX_INPUT_BYTES', 64 * 1024 * 1024),
      pythonMaxOutputBytes: integer(env.ANALYSIS_PYTHON_MAX_OUTPUT_BYTES, 16 * 1024 * 1024, 'ANALYSIS_PYTHON_MAX_OUTPUT_BYTES', 64 * 1024 * 1024),
      pythonMaxWaiting: integer(env.ANALYSIS_PYTHON_MAX_WAITING, 32, 'ANALYSIS_PYTHON_MAX_WAITING', 64),
      pythonThreads: integer(env.ANALYSIS_PYTHON_THREADS, defaultPythonThreads, 'ANALYSIS_PYTHON_THREADS', 32),
      context: {
        maxReadings: integer(env.ANALYSIS_CONTEXT_MAX_READINGS, 200_000, 'ANALYSIS_CONTEXT_MAX_READINGS', 200_000),
        maxSensors: integer(env.ANALYSIS_CONTEXT_MAX_SENSORS, 128, 'ANALYSIS_CONTEXT_MAX_SENSORS', 128),
        maxBytes: integer(env.ANALYSIS_CONTEXT_MAX_BYTES, 16 * 1024 * 1024, 'ANALYSIS_CONTEXT_MAX_BYTES', 16 * 1024 * 1024),
        maxStationMetadata: integer(env.ANALYSIS_CONTEXT_MAX_STATION_METADATA, 10_000, 'ANALYSIS_CONTEXT_MAX_STATION_METADATA', 10_000),
      },
      pythonExecutable: resolve(env.ANALYSIS_PYTHON ?? fileURLToPath(new URL(`../../.local/detector-venv/${process.platform === 'win32' ? 'Scripts/python.exe' : 'bin/python'}`, import.meta.url))),
      artifactPath: resolve(env.ANALYSIS_ARTIFACT ?? fileURLToPath(new URL('../../.local/models/pm25-iforest-v2/isolation_forest.joblib', import.meta.url))),
      manifestPath: fileURLToPath(new URL('../ml/pm25-v2-manifest.json', import.meta.url)),
      scriptPath: fileURLToPath(new URL('../ml/isolation_forest.py', import.meta.url)),
    },
    imports: {
      storageDir: env.IMPORT_STORAGE_DIR ? resolve(env.IMPORT_STORAGE_DIR) : fileURLToPath(new URL('../../.local/imports/', import.meta.url)),
      maxFileBytes: integer(env.IMPORT_MAX_FILE_BYTES, 100 * 1024 * 1024, 'IMPORT_MAX_FILE_BYTES', 1024 * 1024 * 1024),
      maxRecordBytes: integer(env.IMPORT_MAX_RECORD_BYTES, 1024 * 1024, 'IMPORT_MAX_RECORD_BYTES', 8 * 1024 * 1024),
      batchSize: integer(env.IMPORT_BATCH_SIZE, 1000, 'IMPORT_BATCH_SIZE', 5000),
      batchBytes: integer(env.IMPORT_BATCH_BYTES, 8 * 1024 * 1024, 'IMPORT_BATCH_BYTES', 12 * 1024 * 1024),
      readBufferBytes: integer(env.IMPORT_READ_BUFFER_BYTES, defaultImportReadBufferBytes, 'IMPORT_READ_BUFFER_BYTES', 1024 * 1024, 4096),
      maxIssues: integer(env.IMPORT_MAX_ISSUES, 1000, 'IMPORT_MAX_ISSUES', 1000),
      maxSensors: integer(env.IMPORT_MAX_SENSORS, 10000, 'IMPORT_MAX_SENSORS', 10000),
      uploadConcurrency: integer(env.IMPORT_UPLOAD_CONCURRENCY, 2, 'IMPORT_UPLOAD_CONCURRENCY', 32),
      importConcurrency: integer(env.IMPORT_CONCURRENCY, 1, 'IMPORT_CONCURRENCY', 32),
      scanConcurrency: integer(env.IMPORT_SCAN_CONCURRENCY, 2, 'IMPORT_SCAN_CONCURRENCY', 32),
      scanMaxWaiting: integer(env.IMPORT_SCAN_MAX_WAITING, 64, 'IMPORT_SCAN_MAX_WAITING', 256),
      importMaxWaiting: integer(env.IMPORT_MAX_WAITING, 0, 'IMPORT_MAX_WAITING', 128, 0),
      importWaitMs: integer(env.IMPORT_WAIT_MS, 2000, 'IMPORT_WAIT_MS', 30_000),
      timeoutMs: integer(env.IMPORT_TIMEOUT_MS, 120_000, 'IMPORT_TIMEOUT_MS', 600_000),
      leaseMs: integer(env.IMPORT_LEASE_MS, 30_000, 'IMPORT_LEASE_MS', 120_000),
      recoveryBatchSize: integer(env.IMPORT_RECOVERY_BATCH_SIZE, 10, 'IMPORT_RECOVERY_BATCH_SIZE', 100),
      replayMs: 24 * 60 * 60 * 1000,
    },
    logLevel: logLevel as ServerConfig['logLevel'],
  };
}
