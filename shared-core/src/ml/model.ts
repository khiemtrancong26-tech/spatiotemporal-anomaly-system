import { z } from 'zod';
import { quantileSorted } from '../detectors/stats.js';
import { ReadingSchema, UtcIsoSchema, type Reading } from '../contracts/index.js';
import { FEATURE_NAMES, buildFeatures } from './features.js';
import { scoreIsolationForest, trainIsolationForest, type IsolationForest } from './isolationForest.js';

/** Tên method ghi vào AnalysisRun.method / Anomaly.method khi family = 'ml'. */
export const ML_METHOD = 'isolation_forest' as const;

const TreeNodeSchema = z.tuple([z.number(), z.number(), z.number().int(), z.number().int()]);

/**
 * "Model artifact": file JSON do Khải huấn luyện ngoài request; Server nạp để suy luận.
 * `version` được ghi vào AnalysisRun.modelVersion.
 */
export const MLModelArtifactSchema = z.object({
  schemaVersion: z.literal(1),
  algorithm: z.literal('isolation-forest'),
  name: z.string().min(1),
  version: z.string().min(1),
  trainedAt: UtcIsoSchema,
  featureNames: z.array(z.string()).min(1),
  featureWindow: z.number().int().min(2),
  params: z.object({
    nTrees: z.number().int().positive(),
    sampleSize: z.number().int().positive(),
    seed: z.number().int(),
    contamination: z.number().gt(0).lt(0.5),
  }),
  psi: z.number().int().min(2),
  /** Điểm ≥ threshold bị coi là bất thường. */
  threshold: z.number().gt(0).lt(1),
  trainingSamples: z.number().int().positive(),
  trees: z.array(z.array(TreeNodeSchema).min(1)).min(1),
});
export type MLModelArtifact = z.infer<typeof MLModelArtifactSchema>;

export interface TrainOptions {
  name?: string;
  version?: string;
  nTrees?: number;
  sampleSize?: number;
  seed?: number;
  /** Tỉ lệ bất thường kỳ vọng, dùng chọn ngưỡng (mặc định 0.01). */
  contamination?: number;
  featureWindow?: number;
  /** Cho phép cố định thời điểm huấn luyện (tái lập/test). Phải là UTC ISO có Z. */
  trainedAt?: string;
}

export const MIN_TRAIN_ROWS = 50;

const round = (x: number) => Math.round(x * 1e5) / 1e5;

export function trainAnomalyModel(readings: readonly Reading[], options: TrainOptions = {}): MLModelArtifact {
  const featureWindow = options.featureWindow ?? 6;
  const rows = buildFeatures(readings, { window: featureWindow });
  if (rows.length < MIN_TRAIN_ROWS) {
    throw new Error(`Need at least ${MIN_TRAIN_ROWS} readings to train (got ${rows.length})`);
  }
  const nTrees = options.nTrees ?? 100;
  const sampleSize = options.sampleSize ?? 256;
  const seed = options.seed ?? 42;
  const contamination = options.contamination ?? 0.01;

  const forest = trainIsolationForest(
    rows.map((r) => r.features),
    { nTrees, sampleSize, seed },
  );
  const scores = rows.map((r) => scoreIsolationForest(forest, r.features)).sort((a, b) => a - b);
  const threshold = quantileSorted(scores, 1 - contamination);

  return MLModelArtifactSchema.parse({
    schemaVersion: 1,
    algorithm: 'isolation-forest',
    name: options.name ?? 'pm25-isolation-forest',
    version: options.version ?? '1.0.0',
    trainedAt: options.trainedAt ?? new Date().toISOString(),
    featureNames: [...FEATURE_NAMES],
    featureWindow,
    params: { nTrees, sampleSize: forest.psi, seed, contamination },
    psi: forest.psi,
    threshold: round(threshold),
    trainingSamples: rows.length,
    trees: forest.trees.map((t) => t.map(([f, v, l, r]) => [f, round(v), l, r])),
  });
}

/** Nạp + kiểm tra artifact từ JSON không tin cậy. Ném lỗi nếu sai định dạng/feature. */
export function loadModelArtifact(json: unknown): MLModelArtifact {
  const artifact = MLModelArtifactSchema.parse(json);
  const same =
    artifact.featureNames.length === FEATURE_NAMES.length &&
    artifact.featureNames.every((n, i) => n === FEATURE_NAMES[i]);
  if (!same) {
    throw new Error(
      `Model artifact feature mismatch: [${artifact.featureNames.join(', ')}] != [${FEATURE_NAMES.join(', ')}]`,
    );
  }
  return artifact;
}

export interface MlDetectorPoint {
  readingId: string;
  /** Isolation Forest ∈ (0,1); ~0.5 bình thường, càng gần 1 càng bất thường. */
  score: number;
  flagged: boolean;
}

export interface MlDetectorOutput {
  family: 'ml';
  method: typeof ML_METHOD;
  /** Ghi vào AnalysisRun.modelVersion. */
  modelVersion: string;
  status: 'completed' | 'insufficient_data' | 'invalid_input';
  results: MlDetectorPoint[];
  message?: string;
}

/**
 * Suy luận ML. Một kết quả cho mỗi reading (thứ tự đầu vào). Không có reading -> `insufficient_data`.
 * Đầu vào sai schema -> `invalid_input`. ML chỉ chạy ở Server (BR-11).
 */
export function detectWithModel(
  readings: readonly Reading[],
  artifact: MLModelArtifact,
  options: { threshold?: number } = {},
): MlDetectorOutput {
  const base = { family: 'ml' as const, method: ML_METHOD, modelVersion: artifact.version };
  const parsed = z.array(ReadingSchema).safeParse(readings);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    return { ...base, status: 'invalid_input', results: [], message: `${issue?.path.join('.')}: ${issue?.message}` };
  }
  if (readings.length === 0) {
    return { ...base, status: 'insufficient_data', results: [], message: 'No readings' };
  }
  const ids = new Set(readings.map((r) => r.id));
  if (ids.size !== readings.length) {
    return { ...base, status: 'invalid_input', results: [], message: 'readings contain duplicate id' };
  }

  const threshold = options.threshold ?? artifact.threshold;
  const forest: IsolationForest = {
    psi: artifact.psi,
    nFeatures: artifact.featureNames.length,
    trees: artifact.trees as IsolationForest['trees'],
  };
  const byId = new Map<string, MlDetectorPoint>();
  for (const row of buildFeatures(readings, { window: artifact.featureWindow })) {
    const score = scoreIsolationForest(forest, row.features);
    byId.set(row.readingId, { readingId: row.readingId, score, flagged: score >= threshold });
  }
  return { ...base, status: 'completed', results: readings.map((r) => byId.get(r.id)!) };
}
