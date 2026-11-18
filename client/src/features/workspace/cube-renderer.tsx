import { useEffect, useMemo, useRef, useState } from 'react';
import type { Reading, Sensor } from '../../shared/api/generated/wire';
import { Button, LoadingState } from '../../shared/ui/primitives';
import { cubeProjection, cubeTime, pm25Color, HOUR, type CubeMode, type CubeScope } from './cube-data';
import type { CubeCamera } from './state';

interface CubeView {
  rows: Reading[]; sensors: Sensor[]; scope: CubeScope; mode: CubeMode;
  focusedSensorId: string; showContext: boolean; timestamp?: string; selected?: string;
  marked: Set<string>; offset: number;
}
export default function CubeRenderer(props: CubeView & { onSelect: (id: string) => void; camera?: CubeCamera; onCamera?: (camera: CubeCamera) => void }) {
  const host = useRef<HTMLDivElement>(null), labels = useRef<HTMLDivElement>(null);
  const input = useRef(props), update = useRef<(view: CubeView) => void>(() => {});
  const action = useRef<(name: string) => void>(() => {});
  const [ready, setReady] = useState(false), [error, setError] = useState('');
  const [hovered, setHovered] = useState<string>();
  const { onSelect, ...view } = props;
  const { rows, sensors, scope, mode, focusedSensorId, showContext, timestamp, selected: selectedId, marked, offset } = props;
  const sceneView = useMemo(() => ({ rows, sensors, scope, mode, focusedSensorId, showContext, timestamp, selected: selectedId, marked, offset }), [rows, sensors, scope, mode, focusedSensorId, showContext, timestamp, selectedId, marked, offset]);
  useEffect(() => { input.current = props; }, [props]);
  useEffect(() => { update.current(sceneView); }, [sceneView]);
  useEffect(() => {
    let cancelled = false, cleanup = () => {};
    const element = host.current!, labelHost = labels.current!;
    async function start() {
      const T = await import('three');
      const { OrbitControls } = await import('three/addons/controls/OrbitControls.js');
      if (cancelled) return;
      const renderer = new T.WebGLRenderer({ antialias: true });
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      element.appendChild(renderer.domElement);
      const scene = new T.Scene(); scene.background = new T.Color('#F0F5F9');
      const camera = new T.PerspectiveCamera(43, 1, .01, 100); camera.up.set(0, 0, 1);
      const controls = new OrbitControls(camera, renderer.domElement);
      controls.minDistance = 2.8; controls.maxDistance = 12; controls.enableDamping = false;
      const saveCamera = () => input.current.onCamera?.({ position: camera.position.toArray(), target: controls.target.toArray() });
      const initial = input.current.camera;
      camera.position.fromArray(initial?.position ?? [2.8, -3.6, 2.4]);
      controls.target.fromArray(initial?.target ?? [0, 0, 0]);
      controls.update();
      const makeTexture = (ring: boolean) => {
        const canvas = document.createElement('canvas'); canvas.width = canvas.height = 64;
        const ctx = canvas.getContext('2d')!;
        ctx.beginPath(); ctx.arc(32, 32, ring ? 24 : 27, 0, Math.PI * 2);
        if (ring) { ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 12; ctx.stroke(); ctx.strokeStyle = '#7C3AED'; ctx.lineWidth = 6; ctx.stroke(); }
        else { ctx.fillStyle = '#ffffff'; ctx.fill(); }
        return new T.CanvasTexture(canvas);
      };
      const dot = makeTexture(false), ring = makeTexture(true);
      const makePoints = (opacity: number, size: number, texture = dot) => {
        const geometry = new T.BufferGeometry();
        const material = new T.PointsMaterial({ size, sizeAttenuation: false, vertexColors: true, transparent: true, opacity, map: texture, alphaTest: .05, depthWrite: false });
        const points = new T.Points(geometry, material); scene.add(points); return points;
      };
      const context = makePoints(.12, 5), normal = makePoints(.65, 6), focus = makePoints(1, 8);
      const rings = makePoints(1, 17, ring), selection = makePoints(1, 21, ring), feet = makePoints(.8, 8);
      const pointLayers = [context, normal, focus, rings, selection, feet];
      const box = new T.BoxGeometry(2, 2, 2), edges = new T.EdgesGeometry(box); box.dispose();
      const edgeMaterial = new T.LineBasicMaterial({ color: '#9FB3C7', transparent: true, opacity: .55 });
      scene.add(new T.LineSegments(edges, edgeMaterial));
      const gridGeometry = new T.BufferGeometry(), gridMaterial = new T.LineBasicMaterial({ color: '#B6C7D7', transparent: true, opacity: .27 });
      scene.add(new T.LineSegments(gridGeometry, gridMaterial));
      const planeGeometry = new T.PlaneGeometry(2, 2), planeMaterial = new T.MeshBasicMaterial({ color: '#7C3AED', transparent: true, opacity: .13, side: T.DoubleSide, depthWrite: false });
      const plane = new T.Mesh(planeGeometry, planeMaterial); scene.add(plane);
      const planeEdgeGeometry = new T.EdgesGeometry(planeGeometry), planeEdgeMaterial = new T.LineBasicMaterial({ color: '#7C3AED', transparent: true, opacity: .7 });
      const planeEdge = new T.LineSegments(planeEdgeGeometry, planeEdgeMaterial); scene.add(planeEdge);
      const curveGeometry = new T.BufferGeometry(), curveMaterial = new T.LineBasicMaterial({ color: '#087F86', transparent: true, opacity: .5 });
      const curve = new T.LineSegments(curveGeometry, curveMaterial); scene.add(curve);
      let anchors: { node: HTMLSpanElement; point: InstanceType<typeof T.Vector3> }[] = [];
      const label = (text: string, point: number[], className = '') => {
        const node = document.createElement('span'); node.textContent = text; node.className = `cube-label ${className}`;
        labelHost.appendChild(node); anchors.push({ node, point: new T.Vector3(...point) });
      };
      const render = () => {
        renderer.render(scene, camera);
        element.dataset.camera = camera.position.toArray().map(v => v.toFixed(3)).join(',');
        for (const anchor of anchors) {
          const p = anchor.point.clone().project(camera);
          const halfWidth = anchor.node.offsetWidth / 2, halfHeight = anchor.node.offsetHeight / 2;
          const x = Math.max(halfWidth + 4, Math.min(element.clientWidth - halfWidth - 4, (p.x + 1) / 2 * element.clientWidth));
          const y = Math.max(halfHeight + 4, Math.min(element.clientHeight - halfHeight - 4, (1 - p.y) / 2 * element.clientHeight));
          anchor.node.style.left = `${x}px`;
          anchor.node.style.top = `${y}px`;
          anchor.node.hidden = p.z > 1 || p.z < -1;
        }
      };
      const setPoints = (points: typeof normal, rows: Reading[], projection: ReturnType<typeof cubeProjection>, base = false, white = false) => {
        points.geometry.setAttribute('position', new T.Float32BufferAttribute(rows.flatMap(r => { const p = projection.point(r.location.coordinates, r.ts); return [p[0], p[1], base ? -1 : p[2]]; }), 3));
        points.geometry.setAttribute('color', new T.Float32BufferAttribute(rows.flatMap(r => { const c = new T.Color(white ? '#ffffff' : pm25Color(r.value)); return [c.r, c.g, c.b]; }), 3));
        points.geometry.computeBoundingSphere();
      };
      update.current = current => {
        const projection = cubeProjection(current.rows, current.sensors, current.scope);
        const active: Reading[] = [], usual: Reading[] = [], dim: Reading[] = [];
        for (const row of current.rows) {
          const selected = row.id === current.selected;
          const atTime = current.timestamp && Math.abs(Date.parse(row.ts) - Date.parse(current.timestamp)) <= HOUR / 2;
          const station = row.sensorId === current.focusedSensorId;
          if (current.mode === 'station' && !station) { if (current.showContext) dim.push(row); }
          else if (selected || (current.mode === 'station' && station) || (current.mode === 'anomaly' && current.marked.has(row.id)) || atTime) active.push(row);
          else if (current.mode === 'overview') usual.push(row);
          else dim.push(row);
        }
        setPoints(context, dim, projection); setPoints(normal, usual, projection); setPoints(focus, active, projection);
        setPoints(rings, current.mode === 'anomaly' ? current.rows.filter(r => current.marked.has(r.id)) : [], projection, false, true);
        setPoints(selection, current.rows.filter(r => r.id === current.selected && (current.mode !== 'station' || current.showContext || r.sensorId === current.focusedSensorId)), projection, false, true);
        const stationRows = [...new Map(current.rows.filter(r => current.mode !== 'station' || current.showContext || r.sensorId === current.focusedSensorId).map(r => [r.sensorId, r])).values()];
        setPoints(feet, stationRows, projection, true);
        const stationReadings = current.mode === 'station' ? current.rows.filter(r => r.sensorId === current.focusedSensorId).sort((a, b) => Date.parse(a.ts) - Date.parse(b.ts)) : [];
        const lines: number[] = [];
        stationReadings.forEach((r, i) => { const previous = stationReadings[i - 1]; if (previous && Date.parse(r.ts) - Date.parse(previous.ts) <= HOUR) lines.push(...projection.point(previous.location.coordinates, previous.ts), ...projection.point(r.location.coordinates, r.ts)); });
        curveGeometry.setAttribute('position', new T.Float32BufferAttribute(lines, 3)); curveGeometry.computeBoundingSphere();
        const grid: number[] = [];
        for (let i = 0; i <= 6; i++) { const v = -1 + i / 3; grid.push(-1, 1, v, 1, 1, v, -1, -1, v, -1, 1, v, v, -1, -1, v, 1, -1, -1, v, -1, 1, v, -1, v, 1, -1, v, 1, 1); }
        gridGeometry.setAttribute('position', new T.Float32BufferAttribute(grid, 3));
        anchors = []; labelHost.replaceChildren();
        label('X — Kinh độ →', [.35, -1.28, -1.25], 'cube-axis');
        label('Y — Vĩ độ →', [-1.3, .25, -1.23], 'cube-axis');
        label('Z — Thời gian ↑', [-1.15, -1.05, 1.22], 'cube-axis');
        for (let i = 0; i <= 4; i++) {
          const v = -1 + i / 2;
          const ts = new Date(projection.start + projection.duration * i / 4).toISOString();
          label(cubeTime(ts, current.offset, true), [-1.15, -1.05, v]);
        }
        label(projection.west.toFixed(3), [projection.point([projection.west, projection.south], current.scope.from)[0], -1.12, -1]); label(projection.east.toFixed(3), [projection.point([projection.east, projection.south], current.scope.from)[0], -1.12, -1]);
        label(projection.south.toFixed(3), [-1.12, projection.point([projection.west, projection.south], current.scope.from)[1], -1.18]); label(projection.north.toFixed(3), [-1.12, projection.point([projection.west, projection.north], current.scope.from)[1], -1.18]);
        plane.visible = planeEdge.visible = Boolean(current.timestamp);
        if (current.timestamp) { const z = projection.z(current.timestamp); plane.position.z = planeEdge.position.z = z; label(cubeTime(current.timestamp, current.offset, true), [1.03, 1, z], 'cube-slice-label'); }
        const focused = stationRows.find(r => r.sensorId === current.focusedSensorId);
        if (current.mode === 'station' && focused) label(current.sensors.find(s => s.id === focused.sensorId)?.name ?? focused.sensorId, [...projection.point(focused.location.coordinates, current.scope.from)], 'cube-station-label');
        element.dataset.points = String(current.rows.length); render();
      };
      action.current = name => {
        if (name === 'reset') { camera.position.set(2.8, -3.6, 2.4); controls.target.set(0, 0, 0); }
        if (name === 'in') camera.position.lerp(controls.target, .18);
        if (name === 'out') camera.position.lerp(controls.target, -.18);
        controls.update(); render(); saveCamera();
      };
      controls.addEventListener('change', render);
      controls.addEventListener('end', saveCamera);
      const resize = new ResizeObserver(() => { const width = element.clientWidth, height = element.clientHeight; if (!width || !height) return; renderer.setSize(width, height); camera.aspect = width / height; camera.fov = Math.max(43, Math.min(70, 43 / Math.max(.6, camera.aspect))); camera.updateProjectionMatrix(); render(); }); resize.observe(element);
      let down = [0, 0];
      const pointerDown = (event: PointerEvent) => { down = [event.clientX, event.clientY]; };
      const pick = (event: PointerEvent) => {
        const rect = renderer.domElement.getBoundingClientRect(), ray = new T.Raycaster(); ray.params.Points.threshold = .035;
        ray.setFromCamera(new T.Vector2((event.clientX - rect.left) / rect.width * 2 - 1, -(event.clientY - rect.top) / rect.height * 2 + 1), camera);
        const p = cubeProjection(input.current.rows, input.current.sensors, input.current.scope);
        const hits = input.current.rows.filter(r => input.current.mode !== 'station' || input.current.showContext || r.sensorId === input.current.focusedSensorId)
          .map(r => { const pos = new T.Vector3(...p.point(r.location.coordinates, r.ts)); return { row: r, distance: ray.ray.distanceSqToPoint(pos), depth: camera.position.distanceToSquared(pos) }; })
          .filter(h => h.distance < .003).sort((a, b) => a.distance - b.distance || a.depth - b.depth);
        const id = hits[0]?.row.id;
        if (event.type === 'pointerup' && Math.hypot(event.clientX - down[0], event.clientY - down[1]) < 5) { if (id) input.current.onSelect(id); }
        if (event.type === 'pointermove' && !event.buttons) { setHovered(previous => previous === id ? previous : id); renderer.domElement.style.cursor = id ? 'pointer' : 'grab'; }
      };
      const leave = () => setHovered(undefined);
      const lost = (event: Event) => { event.preventDefault(); setError('WebGL context bị mất. Dùng bảng readings hoặc mở lại Cube.'); };
      renderer.domElement.addEventListener('pointerdown', pointerDown); renderer.domElement.addEventListener('pointerup', pick); renderer.domElement.addEventListener('pointermove', pick); renderer.domElement.addEventListener('pointerleave', leave); renderer.domElement.addEventListener('webglcontextlost', lost);
      cleanup = () => {
        resize.disconnect(); controls.removeEventListener('change', render); controls.removeEventListener('end', saveCamera); controls.dispose();
        renderer.domElement.removeEventListener('pointerdown', pointerDown); renderer.domElement.removeEventListener('pointerup', pick); renderer.domElement.removeEventListener('pointermove', pick); renderer.domElement.removeEventListener('pointerleave', leave); renderer.domElement.removeEventListener('webglcontextlost', lost);
        pointLayers.forEach(p => { p.geometry.dispose(); p.material.dispose(); });
        [edges, gridGeometry, planeGeometry, planeEdgeGeometry, curveGeometry].forEach(g => g.dispose());
        [edgeMaterial, gridMaterial, planeMaterial, planeEdgeMaterial, curveMaterial].forEach(m => m.dispose());
        dot.dispose(); ring.dispose(); renderer.dispose(); renderer.forceContextLoss(); renderer.domElement.remove(); labelHost.replaceChildren();
      };
      update.current(input.current); setReady(true);
    }
    void start().catch(cause => { cleanup(); if (!cancelled) setError(cause instanceof Error ? cause.message : 'Không khởi tạo được Cube.'); });
    return () => { cancelled = true; cleanup(); update.current = () => {}; action.current = () => {}; };
  }, []);
  const selected = view.rows.find(r => r.id === (hovered ?? view.selected));
  return <div className="cube-renderer renderer-surface" data-ready={ready}>
    <div className="cube-camera-controls" aria-label="Điều khiển camera Cube"><span>↔ Orbit · kéo để xoay</span><Button variant="secondary" aria-label="Phóng to Cube" onClick={() => action.current('in')}>+</Button><Button variant="secondary" aria-label="Thu nhỏ Cube" onClick={() => action.current('out')}>−</Button><Button variant="secondary" onClick={() => action.current('reset')}>Reset camera</Button></div>
    {!ready && !error && <LoadingState label="Đang khởi tạo Cube…" />}{error && <p className="renderer-error" role="alert">{error}</p>}
    <div ref={host} className="cube-canvas" aria-label="Space–Time Cube" /><div ref={labels} className="cube-labels" aria-hidden="true" />
    {selected && <div className="cube-tooltip" role="tooltip"><strong>{view.sensors.find(s => s.id === selected.sensorId)?.name ?? selected.sensorId}</strong><b>{selected.value} µg/m³</b><span>{cubeTime(selected.ts, view.offset)} · UTC+0{view.offset}</span><small>ID: {selected.id}</small><Button variant="secondary" onClick={() => onSelect(selected.id)}>Xem chi tiết reading</Button></div>}
  </div>;
}
