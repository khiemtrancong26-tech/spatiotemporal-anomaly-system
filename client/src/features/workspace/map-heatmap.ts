import type { ExpressionSpecification, HeatmapLayerSpecification, Map as MapboxMap, MapSourceDataEvent, GeoJSONSource } from 'mapbox-gl';
export const heatOpacity: ExpressionSpecification = ['interpolate',['linear'],['zoom'],0,0.78,11,0.78,15,0.18,17,0];
export function heatLayer(id: string, source: string, max: number, duration: number): HeatmapLayerSpecification {
  return { id, source, type:'heatmap', paint: {
    'heatmap-weight':['interpolate',['linear'],['get','value'],0,0,Math.max(1,max),1],
    'heatmap-intensity':['interpolate',['linear'],['zoom'],0,1,10,1.9,15,2.2],
    'heatmap-radius':['interpolate',['linear'],['zoom'],0,40,8,100,11,170,14,220,17,260],
    'heatmap-color':['interpolate',['linear'],['heatmap-density'],0,'rgba(45,196,178,0)',0.12,'#2DC4B2',0.3,'#A0E55A',0.5,'#F1F075',0.65,'#F28C28',0.82,'#E53935',1,'#7B1FA2'],
    'heatmap-opacity':0, 'heatmap-opacity-transition':{duration,delay:0},
  } };
}
/** Two real point sources, crossfaded after worker data is ready. No synthetic measurements. */
export function createHeatmapTransition(map: MapboxMap, duration: number, visible: boolean) {
  let current = 0, disposed = false, cancelPending = () => {};
  const opacity = () => visible ? heatOpacity : 0;
  function stage(data: GeoJSON.FeatureCollection<GeoJSON.Point>, max: number) {
    cancelPending();
    const next = 1-current, id = `pm25-heat-${next}`;
    map.setPaintProperty(id,'heatmap-opacity-transition',{duration:0,delay:0});
    map.setPaintProperty(id,'heatmap-opacity',0);
    map.setPaintProperty(id,'heatmap-weight',['interpolate',['linear'],['get','value'],0,0,Math.max(1,max),1]);
    let done = false;
    const finish = () => {
      if (disposed || done) return;
      done = true; map.off('sourcedata', onSource);
      map.setPaintProperty(id,'heatmap-opacity-transition',{duration,delay:0});
      map.setPaintProperty(id,'heatmap-opacity',opacity());
      map.setPaintProperty(`pm25-heat-${current}`,'heatmap-opacity',0);
      current = next;
    };
    const onSource = (event: MapSourceDataEvent) => { if (event.sourceId === id && event.isSourceLoaded) finish(); };
    cancelPending = () => { done = true; map.off('sourcedata',onSource); };
    map.on('sourcedata',onSource);
    (map.getSource(id) as GeoJSONSource).setData(data);
    if (map.isSourceLoaded(id)) finish();
  }
  return {stage, toggle(next: boolean) { visible=next; map.setPaintProperty(`pm25-heat-${current}`,'heatmap-opacity',opacity()); },
    dispose() { disposed=true;cancelPending(); } };
}
