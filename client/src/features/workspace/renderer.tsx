import { useEffect, useRef, useState } from 'react';
import type { Reading } from '../../shared/api/generated/wire';
import { color, cubePoints, latestPerSensor } from './geometry';
import { Button } from '../../shared/ui/primitives';
export default function Renderer({ rows, mode, selected, onSelect, marked }: { rows: Reading[]; mode: 'map' | 'cube'; selected?: string; onSelect: (id: string) => void; marked: Set<string> }) {
  const host = useRef<HTMLDivElement>(null);
  const reset = useRef<() => void>(() => {});
  const [error, setError] = useState('');
  useEffect(() => {
    let cancelled = false;
    let cleanup = () => {};
    const element = host.current!;
    const min = Math.min(...rows.map(r => r.value)), max = Math.max(...rows.map(r => r.value));
    async function start() {
      if (mode === 'map') {
        const token = import.meta.env.VITE_MAPBOX_TOKEN;
        if (!token) throw new Error('Chưa cấu hình Mapbox token. Bạn vẫn có thể dùng Cube và bảng dữ liệu.');
        const { default: mapbox } = await import('mapbox-gl');
        await import('mapbox-gl/dist/mapbox-gl.css');
        if (cancelled) return;
        if (!mapbox.supported()) throw new Error('WebGL không khả dụng cho Mapbox. Dùng bảng dữ liệu bên dưới.');
        const points = latestPerSensor(rows, selected);
        const center = points[0]?.location.coordinates ?? [105, 21];
        const map = new mapbox.Map({ container: element, accessToken: token, style: 'mapbox://styles/mapbox/light-v11', center: [center[0], center[1]], zoom: 9, pitch: 55 });
        cleanup = () => map.remove();
        map.addControl(new mapbox.NavigationControl());
        reset.current = () => {
          if (points.length > 1) { const bounds = new mapbox.LngLatBounds(); points.forEach(r => bounds.extend([r.location.coordinates[0], r.location.coordinates[1]])); map.fitBounds(bounds, { padding: 50, maxZoom: 14, pitch: 55 }); }
          else map.easeTo({ center: [center[0], center[1]], zoom: 9, pitch: 55, bearing: 0 });
        };
        map.on('error', () => { if (!cancelled) setError('Không tải được bản đồ/token/tiles. Bảng dữ liệu và Cube vẫn dùng được.'); });
        map.on('load', () => {
          if (cancelled) return;
          map.addSource('readings', { type: 'geojson', data: { type: 'FeatureCollection', features: points.map(r => ({ type: 'Feature', geometry: { type: 'Point', coordinates: r.location.coordinates }, properties: { id: r.id, color: color(r.value, min, max), selected: r.id === selected, anomaly: marked.has(r.id) } })) } });
          map.addLayer({ id: 'readings', type: 'circle', source: 'readings', paint: { 'circle-color': ['get', 'color'], 'circle-radius': ['case', ['get', 'selected'], 10, 6], 'circle-stroke-width': 2, 'circle-stroke-color': ['case', ['get', 'anomaly'], '#8b00b5', '#ffffff'] } });
          map.on('click', 'readings', event => { const id = event.features?.[0]?.properties?.id; if (typeof id === 'string') onSelect(id); });
          reset.current();
        });
      } else {
        const T = await import('three');
        const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
        if (cancelled) return;
        const renderer = new T.WebGLRenderer({ antialias: true });
        renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
        element.appendChild(renderer.domElement);
        const scene = new T.Scene(); scene.background = new T.Color('#f1f5fa');
        const camera = new T.PerspectiveCamera(50, 1, 0.01, 100); camera.up.set(0, 0, 1);
        const controls = new OrbitControls(camera, renderer.domElement);
        const geometry = new T.BufferGeometry(); geometry.setAttribute('position', new T.Float32BufferAttribute(cubePoints(rows).flat(), 3));
        geometry.setAttribute('color', new T.Float32BufferAttribute(rows.flatMap(r => { const c = new T.Color(r.id === selected ? '#000000' : marked.has(r.id) ? '#8b00b5' : color(r.value, min, max)); return [c.r, c.g, c.b]; }), 3));
        const material = new T.PointsMaterial({ size: 0.13, vertexColors: true });
        const points = new T.Points(geometry, material); scene.add(points);
        const axes = new T.AxesHelper(2.2); axes.position.set(-1, -1, -1); scene.add(axes);
        const box = new T.BoxGeometry(2, 2, 2); const edges = new T.EdgesGeometry(box); box.dispose(); const edgeMaterial = new T.LineBasicMaterial({ color: '#9baec8' }); scene.add(new T.LineSegments(edges, edgeMaterial));
        const render = () => renderer.render(scene, camera);
        reset.current = () => { camera.position.set(3.5, -4, 3); controls.target.set(0, 0, 0); controls.update(); render(); }; reset.current();
        controls.addEventListener('change', render);
        const resize = new ResizeObserver(() => { const width = element.clientWidth; renderer.setSize(width, 420); camera.aspect = width / 420; camera.updateProjectionMatrix(); render(); }); resize.observe(element);
        const pick = (event: MouseEvent) => { const rect = renderer.domElement.getBoundingClientRect(); const ray = new T.Raycaster(); ray.params.Points.threshold = 0.07; ray.setFromCamera(new T.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera); const index = ray.intersectObject(points)[0]?.index; if (index !== undefined) onSelect(rows[index].id); };
        const lost = (event: Event) => { event.preventDefault(); setError('WebGL context bị mất. Dùng bảng dữ liệu hoặc mở lại chế độ xem.'); };
        renderer.domElement.addEventListener('click', pick); renderer.domElement.addEventListener('webglcontextlost', lost);
        cleanup = () => { resize.disconnect(); controls.removeEventListener('change', render); controls.dispose(); renderer.domElement.removeEventListener('click', pick); renderer.domElement.removeEventListener('webglcontextlost', lost); geometry.dispose(); material.dispose(); edges.dispose(); edgeMaterial.dispose(); axes.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); };
      }
    }
    void start().catch(cause => { cleanup(); if (!cancelled) setError(cause instanceof Error ? cause.message : 'Không khởi tạo được WebGL; dùng bảng dữ liệu.'); });
    return () => { cancelled = true; cleanup(); reset.current = () => {}; };
  }, [rows, mode, selected, onSelect, marked]);
  return <><Button variant="secondary" onClick={() => reset.current()}>Reset camera</Button>{error && <p role="alert">{error}</p>}<div ref={host} className="visualization-canvas" aria-label={mode === 'map' ? 'Mapbox 3D' : 'Space–Time Cube'} />{mode === 'cube' && <p>X đỏ: Đông (kinh độ) · Y xanh lá: Bắc (vĩ độ) · Z xanh dương: thời gian tăng từ dưới lên. Kéo để xoay, cuộn để zoom, chuột phải để pan.</p>}</>;
}
