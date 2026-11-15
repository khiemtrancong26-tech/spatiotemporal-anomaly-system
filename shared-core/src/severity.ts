import type { Anomaly } from './contracts/index.js';

type Severity = Anomaly['severity'];

/**
 * ĐỀ XUẤT cho OPEN-04 (chưa được nhóm duyệt): ánh xạ score -> severity.
 * Thang score phụ thuộc family/method nên không so sánh trực tiếp giữa các method.
 *  - statistical: score = |z| hoặc số lần IQR vượt hàng rào
 *  - ml: score Isolation Forest ∈ (0,1), ~0.5 là bình thường
 */
export function proposeSeverity(family: 'statistical' | 'ml', score: number): Severity {
  if (family === 'ml') {
    if (score >= 0.7) return 'high';
    if (score >= 0.6) return 'medium';
    return 'low';
  }
  if (score >= 5) return 'high';
  if (score >= 3) return 'medium';
  return 'low';
}
