import type { Reading } from '../contracts/index.js';
import { ML_METHOD, detectWithModel, loadModelArtifact, type MlDetectorOutput } from './model.js';

/**
 * Giao diện suy luận ML cho Server (Khiêm). Bất đồng bộ để sau này có thể thay bằng
 * Server Worker/process riêng (OPEN-06) mà không đổi nơi gọi.
 */
export interface MlInferenceAdapter {
  readonly family: 'ml';
  readonly method: typeof ML_METHOD;
  /** Ghi vào AnalysisRun.modelVersion. */
  readonly modelVersion: string;
  detect(readings: readonly Reading[]): Promise<MlDetectorOutput>;
}

/** `modelJson` là nội dung file artifact đã `JSON.parse`; sẽ được validate (ném lỗi nếu sai). */
export function createMlAdapter(modelJson: unknown, options: { threshold?: number } = {}): MlInferenceAdapter {
  const model = loadModelArtifact(modelJson);
  return {
    family: 'ml',
    method: ML_METHOD,
    modelVersion: model.version,
    detect: async (readings) => detectWithModel(readings, model, options),
  };
}
