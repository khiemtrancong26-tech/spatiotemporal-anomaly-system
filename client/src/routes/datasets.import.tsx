import { createFileRoute } from '@tanstack/react-router';
import { FeaturePlaceholder } from '../features/foundation/pages';
export const Route = createFileRoute('/datasets/import')({ component: () => <FeaturePlaceholder title="Nhập dataset" milestone="M3" description="Đưa dữ liệu CSV hoặc JSON vào hệ thống theo từng bước rõ ràng." steps={['Upload', 'Validation', 'Xác nhận mapping', 'Import và kết quả']} /> });
