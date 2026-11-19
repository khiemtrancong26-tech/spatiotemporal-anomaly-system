import { expect, it, vi } from 'vitest';
import type { Map as MapboxMap } from 'mapbox-gl';
import { createHeatmapTransition, heatLayer } from '../../../src/features/workspace/map-heatmap';
it('waits for the next source before crossfading, cancels obsolete frames and cleans up',()=>{
 const listeners=new Set<(event:unknown)=>void>(), paint=vi.fn(), setData=vi.fn();
 const map={setPaintProperty:paint,getSource:()=>({setData}),isSourceLoaded:()=>false,
  on:(_type:string,fn:(event:unknown)=>void)=>listeners.add(fn),off:(_type:string,fn:(event:unknown)=>void)=>listeners.delete(fn)};
 const data:GeoJSON.FeatureCollection<GeoJSON.Point>={type:'FeatureCollection',features:[]};
 const blend=createHeatmapTransition(map as unknown as MapboxMap,700,true);
 blend.stage(data,100);
 expect(paint.mock.calls.some(c=>c[0]==='pm25-heat-0'&&c[1]==='heatmap-opacity')).toBe(false);
 for(const listener of [...listeners])listener({sourceId:'other',isSourceLoaded:true});
 expect(listeners.size).toBe(1);
 blend.stage(data,120);expect(listeners.size).toBe(1);
 for(const listener of [...listeners])listener({sourceId:'pm25-heat-1',isSourceLoaded:true});
 expect(paint).toHaveBeenCalledWith('pm25-heat-1','heatmap-opacity-transition',{duration:700,delay:0});
 expect(paint).toHaveBeenCalledWith('pm25-heat-0','heatmap-opacity',0);expect(listeners.size).toBe(0);
 blend.toggle(false);expect(paint).toHaveBeenLastCalledWith('pm25-heat-1','heatmap-opacity',0);
 blend.stage(data,120);blend.dispose();expect(listeners.size).toBe(0);
});
it('uses transparent density zero, smooth zoom styling and supports reduced motion',()=>{
 const layer=heatLayer('heat','points',0,0);
 expect(layer.type).toBe('heatmap');expect(layer.paint?.['heatmap-opacity-transition']).toEqual({duration:0,delay:0});
 expect(JSON.stringify(layer.paint?.['heatmap-color'])).toContain('rgba(45,196,178,0)');
 expect(JSON.stringify(layer.paint?.['heatmap-radius'])).toContain('zoom');
});
