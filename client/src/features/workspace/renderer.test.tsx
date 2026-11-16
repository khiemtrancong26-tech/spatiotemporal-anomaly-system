import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Reading } from '../../shared/api/generated/wire';
const mocks = vi.hoisted(() => ({ instances: vi.fn(), remove: vi.fn(), addSource: vi.fn(), addLayer: vi.fn(), layout: vi.fn(), sourceData: vi.fn(), fit: vi.fn(), paint:vi.fn(), popup:vi.fn(), clicks:new Map<string,(event:unknown)=>void>(), loaded:true }));
vi.mock('mapbox-gl', () => ({ default: { supported: () => true, NavigationControl: class {}, Popup:class {remove(){} setLngLat(){return this;} setDOMContent(node:HTMLElement){mocks.popup(node);return this;} addTo(){return this;}}, LngLatBounds: class { extend() {return this;} }, Map: class {
  constructor() { mocks.instances(); }
  remove = mocks.remove; addSource = mocks.addSource; addLayer = mocks.addLayer; setLayoutProperty = mocks.layout; setPaintProperty = mocks.paint;
  addControl() {} easeTo() {} resize() {}
  isSourceLoaded(){return mocks.loaded;} off(){}
  getSource(id:string) { return id === 'composite' ? undefined : { setData: mocks.sourceData }; }
  getCanvas() { return {style:{cursor:''}}; }
  fitBounds = mocks.fit;
  on(event: string, layerOrCallback: unknown, callback?: (event:unknown)=>void) { if (event === 'load') queueMicrotask(layerOrCallback as ()=>void); if(callback)mocks.clicks.set(`${event}:${String(layerOrCallback)}`,callback); }
} } }));
import Renderer from './renderer';
beforeEach(() => { mocks.clicks.clear(); vi.stubGlobal('matchMedia',()=>({matches:false}));vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
it('toggles the soft heatmap layers without recreating the map or changing selection data', async () => {
  vi.stubEnv('VITE_MAPBOX_TOKEN','pk.test');
  const rows = [{id:'r1',sensorId:'s1',value:40,ts:'2026-11-11T00:00:00Z',location:{type:'Point',coordinates:[105,21]}}] as Reading[];
  const props = {rows,mode:'map' as const,onSelect:vi.fn(),marked:new Set<string>()};
  const ui = render(<Renderer {...props} spatialHeatmap={false} />);
  await waitFor(() => expect(mocks.addLayer).toHaveBeenCalledTimes(4));
  expect(mocks.addLayer.mock.calls[0][0]).toMatchObject({id:'pm25-heat-0',type:'heatmap'});
  expect(mocks.sourceData.mock.calls.some(call => call[0].features.length === 1)).toBe(true);
  await act(async () => ui.rerender(<Renderer {...props} spatialHeatmap />));
  expect(mocks.paint.mock.calls.some(call=>call[1]==='heatmap-opacity'&&Array.isArray(call[2]))).toBe(true);
  expect(mocks.addLayer.mock.calls.some(call=>call[0].type==='fill')).toBe(false);
  expect(mocks.instances).toHaveBeenCalledTimes(1); expect(mocks.remove).not.toHaveBeenCalled();
  ui.unmount(); expect(mocks.remove).toHaveBeenCalledTimes(1);
});

it('updates every station and preserves the map/camera when selecting a point or changing time', async () => {
  vi.stubEnv('VITE_MAPBOX_TOKEN','pk.test');
  const make = (id:string,sensorId:string,ts='2026-11-11T00:00:00Z') => ({id,sensorId,value:40,ts,location:{type:'Point',coordinates:[105,21]}} as Reading);
  const rows=[make('a','A'),make('b','B')], props={rows,mode:'map' as const,onSelect:vi.fn(),marked:new Set<string>()};
  const ui=render(<Renderer {...props}/>);
  await waitFor(()=>expect(mocks.sourceData).toHaveBeenCalled());
  const featureData=()=>mocks.sourceData.mock.calls.filter(call=>call[0].features[0]?.geometry.type==='Point').at(-1)![0];
  expect(featureData().features.map((f:{properties:{id:string}})=>f.properties.id)).toEqual(['a','b']);
  await act(async()=>ui.rerender(<Renderer {...props} selected="a"/>));
  expect(featureData().features).toHaveLength(2);expect(featureData().features[0].properties.selected).toBe(true);
  await act(async()=>ui.rerender(<Renderer {...props} rows={[make('c','A','2026-11-11T01:00:00Z'),make('d','B','2026-11-11T01:00:00Z')]}/>));
  expect(featureData().features.map((f:{properties:{id:string}})=>f.properties.id)).toEqual(['c','d']);
  expect(mocks.instances).toHaveBeenCalledTimes(1);expect(mocks.fit).toHaveBeenCalledTimes(1);expect(mocks.remove).not.toHaveBeenCalled();ui.unmount();
});

it('popup displays the original measurement timestamp and value, safely as text',async()=>{
 vi.stubEnv('VITE_MAPBOX_TOKEN','pk.test');
 const row={id:'r',sensorId:'<station>',value:118,ts:'2026-11-10T23:30:00.000Z',location:{type:'Point',coordinates:[105,21]}} as Reading;
 const ui=render(<Renderer rows={[row]} mode="map" marked={new Set()} onSelect={vi.fn()}/>);
 await waitFor(()=>expect(mocks.clicks.has('click:readings')).toBe(true));
 act(()=>mocks.clicks.get('click:readings')!({features:[{properties:{id:'r'}}]}));
 const popup=mocks.popup.mock.calls.at(-1)![0] as HTMLElement;
 expect(popup.textContent).toContain(row.ts);expect(popup.textContent).toContain('118 µg/m³');expect(popup.querySelector('station')).toBeNull();
 await act(async()=>ui.rerender(<Renderer rows={[row]} mode="map" zone="UTC" marked={new Set()} onSelect={vi.fn()}/>));
 act(()=>mocks.clicks.get('click:readings')!({features:[{properties:{id:'r'}}]}));
 expect((mocks.popup.mock.calls.at(-1)![0] as HTMLElement).textContent).toContain('23:30');
 await act(async()=>ui.rerender(<Renderer rows={[row]} mode="map" zone="+08:00" marked={new Set()} onSelect={vi.fn()}/>));
 act(()=>mocks.clicks.get('click:readings')!({features:[{properties:{id:'r'}}]}));
 expect((mocks.popup.mock.calls.at(-1)![0] as HTMLElement).textContent).toContain('07:30'); expect(mocks.instances).toHaveBeenCalledTimes(1); ui.unmount();
});
