import { useMemo } from 'react';
import type { Reading } from '../../shared/api/generated/wire';
import { color } from './geometry';
import { temporalCells } from './heatmap-data';
import { Icon } from '../../shared/ui/icons';
export function TemporalHeatmap({ rows }: { rows: Reading[] }) {
  const cells = useMemo(() => temporalCells(rows), [rows]);
  const days = [...new Set(cells.map(c => c.day))].sort().slice(-14);
  const lookup = new Map(cells.map(c => [`${c.day}/${c.hour}`, c]));
  const min = Math.min(...rows.map(r => r.value)), max = Math.max(...rows.map(r => r.value));
  return <section aria-labelledby="heatmap-heading"><h3 id="heatmap-heading"><Icon name="grid" size={18} /> Heatmap ngày × giờ</h3><p className="muted">PM2.5 trung bình · UTC+07 · 14 ngày có mẫu gần nhất trong phần readings đã tải. Gộp tất cả trạm đang lọc; không phải dự báo hay toàn bộ dataset.</p>{!rows.length ? <p>Chưa có readings để hiển thị heatmap.</p> : <><div className="heatmap-scroll" tabIndex={0} role="region" aria-label="Bảng heatmap ngày giờ"><table className="heatmap"><caption className="sr-only">PM2.5 trung bình theo ngày và giờ UTC+07. Mỗi ô có giá trị và số mẫu trong tên truy cập; ô trống là không có mẫu đã tải.</caption><thead><tr><th scope="col">Ngày / giờ</th>{Array.from({length:24}, (_,h) => <th scope="col" key={h}>{String(h).padStart(2,'0')}</th>)}</tr></thead><tbody>{days.map(day => <tr key={day}><th scope="row">{day.slice(8)}/{day.slice(5,7)}/{day.slice(0,4)}</th>{Array.from({length:24},(_,h) => { const c = lookup.get(`${day}/${h}`); const label = `${day} ${String(h).padStart(2,'0')}:00 UTC+07: ${c ? `${c.mean.toFixed(2)} µg/m³, ${c.count} mẫu` : 'Không có mẫu đã tải'}`; return <td key={h} aria-label={label} title={label} style={c ? { background: color(c.mean,min,max), color:'#0b1420' } : undefined}><span aria-hidden="true">{c ? Number(c.mean.toFixed(1)) : '—'}</span></td>; })}</tr>)}</tbody></table></div><div className="heatmap-legend"><span className="heatmap-empty-key"/>Không có mẫu<span className="color-ramp" style={{background:`linear-gradient(90deg, ${color(min,min,max)}, ${color(max,min,max)})`}}/>{min} – {max} µg/m³ · cùng thang màu readings</div></>}</section>;
}
