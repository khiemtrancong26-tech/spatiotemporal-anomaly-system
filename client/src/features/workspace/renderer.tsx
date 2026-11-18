import { formatWorkspaceTime, zoneLabel } from './time';
import type { ExplorationTimeZone } from '@pm25/shared-core';
import { useEffect, useRef, useState } from 'react';
import type { Reading } from '../../shared/api/generated/wire';
import { createHeatmapTransition, heatLayer } from './map-heatmap';
import { color, cubePoints } from './geometry';
import { Button, LoadingState } from '../../shared/ui/primitives';
import type { StyleSpecification } from 'mapbox-gl';

async function loadStandardStyle(token: string, signal: AbortSignal): Promise<StyleSpecification> {
  const url = new URL('https://api.mapbox.com/styles/v1/mapbox/standard');
  url.searchParams.set('access_token', token);
  const response = await fetch(url, { signal });
  if (!response.ok) throw new Error('Không tải được bản đồ/token/tiles. Bảng dữ liệu và Cube vẫn dùng được.');
  const basemap = await response.json() as StyleSpecification;

  // Mapbox GL JS #13750: ground elevation sends these zero-offset lines
  // through line-progress evaluation, although their vector tiles have no line metrics.
  for (const layer of basemap.layers) {
    if (layer.type !== 'line' || (layer.id !== 'gate-fence-hedge' && layer.id !== 'gate-fence-hedge-shade')) continue;
    const layout = layer.layout;
    if (layout?.['line-elevation-reference'] === 'ground' && (layout['line-z-offset'] ?? 0) === 0) {
      layout['line-elevation-reference'] = 'none';
    }
  }
  return {
    version: 8,
    imports: [{ id: 'basemap', url: 'mapbox://styles/mapbox/standard', data: basemap }],
    sources: {},
    layers: [],
  };
}

type View = { zone: ExplorationTimeZone; rows: Reading[]; selected?: string; focusedSensorId?:string; marked: Set<string>; scale?: {min:number;max:number} };
export default function Renderer({ rows, mode, selected, focusedSensorId, onSelect, marked, spatialHeatmap = false, scale, zone = '+07:00' }: Omit<View, 'zone'> & { zone?: ExplorationTimeZone; spatialHeatmap?:boolean; mode:'map'|'cube'; onSelect:(id:string)=>void }) {
  const host = useRef<HTMLDivElement>(null), reset = useRef<()=>void>(()=>{});
  const update = useRef<(view:View)=>void>(()=>{});
  const input = useRef<View>({rows,selected,focusedSensorId,marked,scale,zone});
  const choose = useRef(onSelect);
  const [error,setError] = useState(''), [ready,setReady] = useState(false);
  const heatmap = useRef(spatialHeatmap), toggleHeatmap = useRef<(visible:boolean)=>void>(()=>{});
  useEffect(()=>{input.current={rows,selected,focusedSensorId,marked,scale,zone};choose.current=onSelect;update.current(input.current);},[rows,selected,focusedSensorId,marked,scale,onSelect,zone]);
  useEffect(()=>{heatmap.current=spatialHeatmap;toggleHeatmap.current(spatialHeatmap);},[spatialHeatmap]);
  useEffect(()=>{
    let cancelled=false, cleanup=()=>{};
    const controller = new AbortController();
    const element=host.current!;
    const range=(view:View)=>view.scale??{min:Math.min(...view.rows.map(r=>r.value)),max:Math.max(...view.rows.map(r=>r.value))};
    async function start() {
      if(mode==='map') {
        const token=import.meta.env.VITE_MAPBOX_TOKEN;
        if(!token)throw new Error('Chưa cấu hình Mapbox token. Bạn vẫn có thể dùng Cube và bảng dữ liệu.');
        const {default:mapbox}=await import('mapbox-gl');await import('mapbox-gl/dist/mapbox-gl.css');
        if(cancelled)return;
        if(!mapbox.supported())throw new Error('WebGL không khả dụng cho Mapbox. Dùng bảng dữ liệu bên dưới.');
        const style = await loadStandardStyle(token, controller.signal);
        if (cancelled) return;
        const center=input.current.rows[0]?.location.coordinates??[105,21];
        const map=new mapbox.Map({container:element,accessToken:token,style,center:[center[0],center[1]],zoom:12,pitch:45,antialias:true});
        map.addControl(new mapbox.NavigationControl(),'bottom-right');
        let fitted=false, previousWidth=element.clientWidth;
        cleanup=()=>map.remove();
        const resize=new ResizeObserver(()=>{if(!element.clientWidth||!element.clientHeight)return;map.resize();if(fitted && element.clientWidth!==previousWidth)reset.current();previousWidth=element.clientWidth;});
        cleanup=()=>{resize.disconnect();map.remove();};resize.observe(element);
        reset.current=()=>{
          const points=input.current.rows;
          if(points.length>1){const bounds=new mapbox.LngLatBounds();points.forEach(r=>bounds.extend([r.location.coordinates[0],r.location.coordinates[1]]));map.fitBounds(bounds,{padding:70,maxZoom:13,pitch:45,duration:0});}
          else if(points[0])map.easeTo({center:[points[0].location.coordinates[0],points[0].location.coordinates[1]],zoom:12,pitch:45,bearing:0,duration:0});
        };
        map.on('error',()=>{if(!cancelled)setError('Không tải được bản đồ/token/tiles. Bảng dữ liệu và Cube vẫn dùng được.');});
        map.on('load',()=>{
          if(cancelled)return;
          const empty:GeoJSON.FeatureCollection={type:'FeatureCollection',features:[]};
          map.addSource('readings',{type:'geojson',data:empty});
          const duration=window.matchMedia('(prefers-reduced-motion: reduce)').matches?0:700;
          for (const slot of [0,1]) { const id=`pm25-heat-${slot}`;map.addSource(id,{type:'geojson',data:empty});map.addLayer(heatLayer(id,id,range(input.current).max,duration)); }
          const blend=createHeatmapTransition(map,duration,heatmap.current);
          const previousCleanup=cleanup;
          const popup=new mapbox.Popup({closeButton:true,closeOnClick:true,maxWidth:'280px'});
          cleanup=()=>{blend.dispose();popup.remove();previousCleanup();};
          let previousRows:Reading[]|undefined,previousMax:number|undefined,previousZone:ExplorationTimeZone|undefined;
          map.addLayer({id:'readings',type:'circle',source:'readings',paint:{'circle-color':['get','color'],'circle-radius':['interpolate',['linear'],['zoom'],5,['case',['get','selected'],7,3],12,['case',['get','selected'],11,6],16,['case',['get','selected'],13,9]],'circle-opacity':['interpolate',['linear'],['zoom'],5,0.5,12,0.9,15,1],'circle-stroke-width':['case',['any',['get','selected'],['get','focused']],3,2],'circle-stroke-color':['case',['get','anomaly'],'#8b00b5',['get','selected'],'#142e50',['get','focused'],'#087F86','#ffffff']}});
          map.addLayer({id:'reading-values',type:'symbol',source:'readings',minzoom:13,layout:{'text-field':['concat',['to-string',['get','value']],' µg/m³'],'text-size':12,'text-offset':[0,1.5],'text-anchor':'top'},paint:{'text-color':'#18314c','text-halo-color':'#ffffff','text-halo-width':2}});
          toggleHeatmap.current=visible=>blend.toggle(visible);
          update.current=view=>{
            const {min,max}=range(view);
            const data:GeoJSON.FeatureCollection<GeoJSON.Point>={type:'FeatureCollection',features:view.rows.map(r=>({type:'Feature',geometry:{type:'Point',coordinates:r.location.coordinates},properties:{id:r.id,value:r.value,sensorId:r.sensorId,ts:r.ts,color:color(r.value,min,max),selected:r.id===view.selected,focused:r.sensorId===view.focusedSensorId,anomaly:view.marked.has(r.id)}}))};
            (map.getSource('readings') as import('mapbox-gl').GeoJSONSource).setData(data);
            if(previousRows!==view.rows || previousMax!==max || previousZone!==view.zone){blend.stage(data,max);popup.remove();previousRows=view.rows;previousMax=max;previousZone=view.zone;}
            if(!fitted&&view.rows.length){fitted=true;reset.current();}
          };
          map.on('click','readings',event=>{
            const id=event.features?.[0]?.properties?.id;
            const row=input.current.rows.find(r=>r.id===id);if(!row)return;
            choose.current(row.id);
            const card=document.createElement('div');card.className='station-popup';
            const heading=document.createElement('h3');heading.textContent=`Trạm ${row.sensorId}`;
            const value=document.createElement('strong');value.textContent=`${row.value} µg/m³`;
            const measured=document.createElement('p');measured.textContent=`Đo thực tế: ${formatWorkspaceTime(row.ts, input.current.zone)} · ${zoneLabel(input.current.zone)}`;
            const raw=document.createElement('small');raw.textContent=row.ts;
            card.append(heading,value,measured,raw);
            popup.setLngLat([row.location.coordinates[0],row.location.coordinates[1]]).setDOMContent(card).addTo(map);
          });
          map.on('mouseenter','readings',()=>{map.getCanvas().style.cursor='pointer';});map.on('mouseleave','readings',()=>{map.getCanvas().style.cursor='';});
          update.current(input.current);setReady(true);
        });
      } else {
        const T=await import('three');const {OrbitControls}=await import('three/addons/controls/OrbitControls.js');if(cancelled)return;
        const renderer=new T.WebGLRenderer({antialias:true});renderer.setPixelRatio(Math.min(devicePixelRatio,2));element.appendChild(renderer.domElement);
        const scene=new T.Scene();scene.background=new T.Color('#eef3f8');
        const camera=new T.PerspectiveCamera(50,1,.01,100);camera.up.set(0,0,1);
        const controls=new OrbitControls(camera,renderer.domElement);
        const geometry=new T.BufferGeometry(), material=new T.PointsMaterial({size:.13,vertexColors:true});
        const points=new T.Points(geometry,material);scene.add(points);
        const axes=new T.AxesHelper(2.2);axes.position.set(-1,-1,-1);scene.add(axes);
        const box=new T.BoxGeometry(2,2,2),edges=new T.EdgesGeometry(box);box.dispose();const edgeMaterial=new T.LineBasicMaterial({color:'#9baec8'});scene.add(new T.LineSegments(edges,edgeMaterial));
        const render=()=>renderer.render(scene,camera);
        reset.current=()=>{camera.position.set(3.5,-4,3);controls.target.set(0,0,0);controls.update();render();};
        let previousRows:Reading[]|undefined;
        update.current=view=>{
          if(previousRows!==view.rows){geometry.setAttribute('position',new T.Float32BufferAttribute(cubePoints(view.rows).flat(),3));geometry.computeBoundingSphere();previousRows=view.rows;}
          const {min,max}=range(view);
          geometry.setAttribute('color',new T.Float32BufferAttribute(view.rows.flatMap(r=>{const c=new T.Color(r.id===view.selected?'#000000':view.marked.has(r.id)?'#8b00b5':color(r.value,min,max));return[c.r,c.g,c.b];}),3));render();
        };
        update.current(input.current);reset.current();controls.addEventListener('change',render);
        const resize=new ResizeObserver(()=>{const width=element.clientWidth,height=element.clientHeight;renderer.setSize(width,height);camera.aspect=width/height;camera.updateProjectionMatrix();render();});resize.observe(element);
        const pick=(event:MouseEvent)=>{const rect=renderer.domElement.getBoundingClientRect(),ray=new T.Raycaster();ray.params.Points.threshold=.07;ray.setFromCamera(new T.Vector2((event.clientX-rect.left)/rect.width*2-1,-(event.clientY-rect.top)/rect.height*2+1),camera);const index=ray.intersectObject(points)[0]?.index;if(index!==undefined)choose.current(input.current.rows[index].id);};
        const lost=(event:Event)=>{event.preventDefault();setError('WebGL context bị mất. Dùng bảng dữ liệu hoặc mở lại chế độ xem.');};
        renderer.domElement.addEventListener('click',pick);renderer.domElement.addEventListener('webglcontextlost',lost);setReady(true);
        cleanup=()=>{resize.disconnect();controls.removeEventListener('change',render);controls.dispose();renderer.domElement.removeEventListener('click',pick);renderer.domElement.removeEventListener('webglcontextlost',lost);geometry.dispose();material.dispose();edges.dispose();edgeMaterial.dispose();axes.dispose();renderer.dispose();renderer.forceContextLoss();renderer.domElement.remove();};
      }
    }
    void start().catch((cause: unknown)=>{cleanup();if(!cancelled)setError(cause instanceof Error?cause.message:'Không khởi tạo được WebGL; dùng bảng dữ liệu.');});
    return()=>{cancelled=true;controller.abort();update.current=()=>{};toggleHeatmap.current=()=>{};reset.current=()=>{};cleanup();};
  },[mode]);
  return <div className="renderer-surface" data-ready={ready}><div className="renderer-controls"><Button variant="secondary" onClick={()=>reset.current()}>Reset camera</Button></div>{error&&<p role="alert" className="renderer-error">{error}</p>}{!ready&&!error&&<div className="renderer-loading"><LoadingState label="Đang khởi tạo vùng trực quan…"/></div>}<div ref={host} className="visualization-canvas" aria-label={mode==='map'?'Mapbox 3D':'Space–Time Cube'}/></div>;
}
