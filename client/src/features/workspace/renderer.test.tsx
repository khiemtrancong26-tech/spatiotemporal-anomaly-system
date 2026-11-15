import { act, render, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import type { Reading } from '../../shared/api/generated/wire';
const mocks = vi.hoisted(() => ({ instances: vi.fn(), remove: vi.fn(), addSource: vi.fn(), addLayer: vi.fn(), layout: vi.fn(), sourceData: vi.fn(), fit: vi.fn() }));
vi.mock('mapbox-gl', () => ({ default: { supported: () => true, NavigationControl: class {}, LngLatBounds: class { extend() {return this;} }, Map: class {
  constructor() { mocks.instances(); }
  remove = mocks.remove; addSource = mocks.addSource; addLayer = mocks.addLayer; setLayoutProperty = mocks.layout;
  addControl() {} easeTo() {} resize() {}
  getSource(id:string) { return id === 'composite' ? undefined : { setData: mocks.sourceData }; }
  getCanvas() { return {style:{cursor:''}}; }
  fitBounds = mocks.fit;
  on(event: string, callback: () => void) { if (event === 'load') queueMicrotask(callback); }
} } }));
import Renderer from './renderer';
beforeEach(() => { vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} }); });
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); vi.clearAllMocks(); });
it('toggles the occupied heatmap layer without recreating the map or changing selection data', async () => {
  vi.stubEnv('VITE_MAPBOX_TOKEN','pk.test');
  const rows = [{id:'r1',sensorId:'s1',value:40,ts:'2026-11-11T00:00:00Z',location:{type:'Point',coordinates:[105,21]}}] as Reading[];
  const props = {rows,mode:'map' as const,onSelect:vi.fn(),marked:new Set<string>()};
  const ui = render(<Renderer {...props} spatialHeatmap={false} />);
  await waitFor(() => expect(mocks.addLayer).toHaveBeenCalledTimes(2));
  expect(mocks.addLayer.mock.calls[0][0]).toMatchObject({id:'pm25-grid',layout:{visibility:'none'}});
  expect(mocks.sourceData.mock.calls.some(call => call[0].features.length === 1)).toBe(true);
  await act(async () => ui.rerender(<Renderer {...props} spatialHeatmap />));
  expect(mocks.layout).toHaveBeenLastCalledWith('pm25-grid','visibility','visible');
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
