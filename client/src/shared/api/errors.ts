import type { Error as WireError } from './generated/wire';

export type ErrorKind = 'http' | 'network' | 'aborted' | 'invalid-response';
export class DataSourceError extends Error {
  constructor(
    public readonly kind: ErrorKind,
    message: string,
    public readonly status?: number,
    public readonly error?: WireError['error'],
  ) { super(message); this.name = 'DataSourceError'; }
}

export function errorMessage(error: unknown): string {
  if (!(error instanceof DataSourceError)) return 'Không thể hoàn tất thao tác. Vui lòng thử lại.';
  if (error.kind === 'network') return 'Không kết nối được Backend. Kiểm tra kết nối rồi thử lại.';
  if (error.kind === 'aborted') return 'Đã dừng chờ phản hồi. Thao tác ghi có thể vẫn được Server xử lý.';
  if (error.kind === 'invalid-response') return 'Phản hồi Server không đúng hợp đồng dữ liệu.';
  if (error.status === 401) return 'Phiên chưa hợp lệ hoặc đã hết hạn. Vui lòng đăng nhập.';
  if (error.status === 403) return 'Tài khoản không có quyền thực hiện thao tác này.';
  if (error.status === 404) return 'Không tìm thấy dữ liệu được yêu cầu.';
  if (error.status === 409) return 'Dữ liệu hoặc thao tác đã thay đổi. Cần kiểm tra trước khi gửi lại.';
  if (error.status === 422) return 'Dữ liệu gửi lên chưa hợp lệ. Kiểm tra các trường nhập.';
  return 'Server chưa thể xử lý yêu cầu. Vui lòng thử lại sau.';
}
