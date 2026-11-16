import { useEffect, useRef, useState } from 'react';
import type { ReadingAggregation } from '../../shared/api/generated/wire';
import type { ExplorationTimeZone } from '@pm25/shared-core';
import { formatWorkspaceTime, zoneLabel } from './time';
import { number as formatNumber } from './analyst';
const colors = ['#087E8B','#2463D4','#D08A2F','#9457B5','#566D87','#C05C75','#398450','#814E2D','#3E74A6','#A43B4B','#6868B5','#8F7420','#3F8270','#976EAD','#4B637C','#BF6B31','#3B7490','#816C5A','#6C7D38','#9C4E87'];
export function aggregatePath(buckets: ReadingAggregation['series'][number]['buckets'], x: (i: number) => number, y: (v: number) => number) {
  let connected = false;
  return buckets.map((bucket, i) => {
    if (bucket.mean === null) { connected = false; return ''; }
    const command = `${connected ? 'L' : 'M'}${x(i)},${y(bucket.mean)}`; connected = true; return command;
  }).join(' ');
}
export function ExplorationChart({ result, zone, name }: { result: ReadingAggregation; zone: ExplorationTimeZone; name: (id: string) => string }) {
  const host = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(800), [index, setIndex] = useState(0);
  useEffect(() => { const observer = new ResizeObserver(entries => setWidth(Math.max(280, entries[0].contentRect.width))); observer.observe(host.current!); return () => observer.disconnect(); }, []);
  useEffect(() => setIndex(0), [result]);
  const height = width < 500 ? 230 : 320, left = 48, right = width - 18, bottom = height - 38;
  const count = result.series[0]?.buckets.length ?? 0;
  const values = result.series.flatMap(s => s.buckets.flatMap(b => b.mean === null ? [] : [b.mean]));
  const min = Math.min(0, ...values), max = Math.max(1, ...values), span = max - min || 1;
  const x = (i: number) => count === 1 ? (left + right) / 2 : left + i / Math.max(1, count - 1) * (right - left);
  const y = (v: number) => bottom - (v - min) / span * (bottom - 24);
  const safeIndex = Math.min(index, Math.max(0, count - 1)), bucket = result.series[0]?.buckets[safeIndex];
  const ticks = width < 500 ? 3 : 6;
  return <div ref={host} className="ux-chart"><div className="ux-chart-legend">{result.series.map((s, i) => <span key={s.sensorId}><i style={{ background: colors[i % colors.length] }} />{name(s.sensorId)}</span>)}</div>
    <svg width="100%" viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`So sánh mean PM2.5 · ${zoneLabel(zone)}; khoảng trống không có mẫu`} onPointerMove={e => { const rect = e.currentTarget.getBoundingClientRect(); setIndex(Math.max(0, Math.min(count - 1, Math.round(((e.clientX - rect.left) / rect.width * width - left) / (right - left) * (count - 1))))); }}>
      {[0, 1, 2, 3, 4].map(i => { const value = min + span * i / 4; return <g key={i}><line x1={left} x2={right} y1={y(value)} y2={y(value)} stroke="#E5EBF2" /><text x={left - 9} y={y(value) + 4} textAnchor="end">{formatNumber(value, 0)}</text></g>; })}<text x={left} y="14">µg/m³</text>
      {result.series.map((s, i) => <g key={s.sensorId}><path d={aggregatePath(s.buckets, x, y)} fill="none" stroke={colors[i % colors.length]} strokeWidth="2" strokeLinejoin="round" /><path d={s.buckets.map((b,j) => b.mean !== null && s.buckets[j-1]?.mean == null && s.buckets[j+1]?.mean == null ? `M${x(j)-2},${y(b.mean)}a2,2 0 1,0 4,0a2,2 0 1,0 -4,0` : '').join(' ')} fill={colors[i % colors.length]} />{s.buckets[safeIndex]?.mean != null && <circle cx={x(safeIndex)} cy={y(s.buckets[safeIndex].mean!)} r="4" fill={colors[i % colors.length]} />}</g>)}
      {count > 0 && <line x1={x(safeIndex)} x2={x(safeIndex)} y1="24" y2={bottom} stroke="#9AACBF" strokeDasharray="4 4" />}
      {Array.from(new Set(Array.from({ length: ticks }, (_, i) => Math.round(i / (ticks - 1) * Math.max(0, count - 1))))).map(i => <text key={i} x={x(i)} y={height - 10} textAnchor={i === 0 ? 'start' : i === count - 1 ? 'end' : 'middle'}>{result.series[0]?.buckets[i] && formatWorkspaceTime(result.series[0].buckets[i].start, zone, true)}</text>)}
    </svg>{bucket && <><label className="ux-chart-scrubber">Khám phá bucket bằng chuột hoặc bàn phím<input type="range" aria-label="Bucket đang xem" min="0" max={Math.max(0, count - 1)} value={safeIndex} onChange={e => setIndex(Number(e.target.value))} aria-valuetext={`${formatWorkspaceTime(bucket.start, zone)} · ${zoneLabel(zone)}`} /></label><div className="ux-chart-inspection" aria-live="polite"><strong>{formatWorkspaceTime(bucket.start, zone)} → {formatWorkspaceTime(bucket.end, zone)} · {zoneLabel(zone)}</strong>{result.series.map(s => { const b = s.buckets[safeIndex]; return <span key={s.sensorId}>{name(s.sensorId)}: <b>{formatNumber(b?.mean)} µg/m³</b> · {b?.count ?? 0} mẫu · thiếu slot: {b?.coverage.missingSlots ?? 'chưa xác định'}</span>; })}</div></>}
  </div>;
}
