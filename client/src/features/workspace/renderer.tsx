import { useEffect, useRef, useState } from 'react';
import type { Reading } from '../../shared/api/generated/wire';
import { spatialCells } from './heatmap-data';
import { color, cubePoints } from './geometry';
import { Button, LoadingState } from '../../shared/ui/primitives';
type View = { rows: Reading[]; selected?: string; marked: Set<string>; scale?: {min:number;max:number} };
export default function Renderer({ rows, mode, selected, onSelect, marked, spatialHeatmap = false, scale }: View & { spatialHeatmap?:boolean; mode:'map'|'cube'; onSelect:(id:string)=>void }) {
  const host = useRef<HTMLDivElement>(null), reset = useRef<()=>void>(()=>{});
  const update = useRef<(view:View)=>void>(()=>{});
  const input = useRef<View>({rows,selected,marked,scale});
  const choose = useRef(onSelect);
  const [error,setError] = useState(''), [ready,setReady] = useState(false);
  const heatmap = useRef(spatialHeatmap), toggleHeatmap = useRef<(visible:boolean)=>void>(()=>{});
  useEffect(()=>{input.current={rows,selected,marked,scale};choose.current=onSelect;update.current(input.current);},[rows,selected,marked,scale,onSelect]);
  useEffect(()=>{heatmap.current=spatialHeatmap;toggleHeatmap.current(spatialHeatmap);},[spatialHeatmap]);
  useEffect(()=>{
    let cancelled=false, cleanup=()=>{};
    const element=host.current!;
    const range=(view:View)=>view.scale??{min:Math.min(...view.rows.map(r=>r.value)),max:Math.max(...view.rows.map(r=>r.value))};
    async function start() {
      if(mode==='map') {
        const token=import.meta.env.VITE_MAPBOX_TOKEN;
        if(!token)throw new Error('Chưa cấu hình Mapbox token. Bạn vẫn có thể dùng Cube và bảng dữ liệu.');
        const {default:mapbox}=await import('mapbox-gl');await import('mapbox-gl/dist/mapbox-gl.css');
        if(cancelled)return;
        if(!mapbox.supported())throw new Error('WebGL không khả dụng cho Mapbox. Dùng bảng dữ liệu bên dưới.');
        const center=input.current.rows[0]?.location.coordinates??[105,21];
        const map=new mapbox.Map({container:element,accessToken:token,style:'mapbox://styles/mapbox/light-v11',center:[center[0],center[1]],zoom:12,pitch:45,antialias:true});
        map.addControl(new mapbox.NavigationControl(),'bottom-right');
        let fitted=false, previousWidth=element.clientWidth;
        cleanup=()=>map.remove();
        const resize=new ResizeObserver(()=>{map.resize();if(fitted && element.clientWidth!==previousWidth)reset.current();previousWidth=element.clientWidth;});
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
          if(map.getSource('composite')) map.addLayer({id:'context-buildings',source:'composite','source-layer':'building',type:'fill-extrusion',minzoom:14,filter:['==','extrude','true'],paint:{'fill-extrusion-color':'#d7e0eb','fill-extrusion-height':['coalesce',['get','height'],0],'fill-extrusion-base':['coalesce',['get','min_height'],0],'fill-extrusion-opacity':0.7}});
          map.addSource('readings',{type:'geojson',data:empty});map.addSource('pm25-grid',{type:'geojson',data:empty});
          map.addLayer({id:'pm25-grid',type:'fill',source:'pm25-grid',layout:{visibility:heatmap.current?'visible':'none'},paint:{'fill-color':['get','color'],'fill-opacity':.6,'fill-outline-color':'#ffffff'}});
          map.addLayer({id:'readings',type:'circle',source:'readings',paint:{'circle-color':['get','color'],'circle-radius':['case',['get','selected'],11,7],'circle-stroke-width':['case',['get','selected'],3,2],'circle-stroke-color':['case',['get','anomaly'],'#8b00b5',['get','selected'],'#142e50','#ffffff']}});
          toggleHeatmap.current=visible=>map.setLayoutProperty('pm25-grid','visibility',visible?'visible':'none');
          update.current=view=>{
            const {min,max}=range(view);
            const data:GeoJSON.FeatureCollection<GeoJSON.Point>={type:'FeatureCollection',features:view.rows.map(r=>({type:'Feature',geometry:{type:'Point',coordinates:r.location.coordinates},properties:{id:r.id,color:color(r.value,min,max),selected:r.id===view.selected,anomaly:view.marked.has(r.id)}}))};
            (map.getSource('readings') as import('mapbox-gl').GeoJSONSource).setData(data);
            (map.getSource('pm25-grid') as import('mapbox-gl').GeoJSONSource).setData(spatialCells(view.rows,min,max));
            if(!fitted&&view.rows.length){fitted=true;reset.current();}
          };
          map.on('click','readings',event=>{const id=event.features?.[0]?.properties?.id;if(typeof id==='string')choose.current(id);});
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
    void start().catch(cause=>{cleanup();if(!cancelled)setError(cause instanceof Error?cause.message:'Không khởi tạo được WebGL; dùng bảng dữ liệu.');});
    return()=>{cancelled=true;update.current=()=>{};toggleHeatmap.current=()=>{};reset.current=()=>{};cleanup();};
  },[mode]);
  return <div className="renderer-surface" data-ready={ready}><div className="renderer-controls"><Button variant="secondary" onClick={()=>reset.current()}>Reset camera</Button></div>{error&&<p role="alert" className="renderer-error">{error}</p>}{!ready&&!error&&<div className="renderer-loading"><LoadingState label="Đang khởi tạo vùng trực quan…"/></div>}<div ref={host} className="visualization-canvas" aria-label={mode==='map'?'Mapbox 3D':'Space–Time Cube'}/></div>;
}
