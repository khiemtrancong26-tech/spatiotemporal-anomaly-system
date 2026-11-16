import { DataSourceError, errorMessage } from '../../shared/api/errors';
export function explorationError(error: unknown): string {
  if (error instanceof DataSourceError && error.error && error.status !== 401 && error.status !== 403) {
    if (error.error.code === 'C2_MOCK_NOT_IMPLEMENTED') return 'Exploration chưa được mô phỏng trong chế độ demo. Dùng chế độ online để gọi Backend thật.';
    return `${errorMessage(error)} ${error.error.message}`;
  }
  return errorMessage(error);
}
