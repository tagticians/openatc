// Re-tint Mapbox dark-v11 into a quiet radar-display base map: navy land, deep water,
// faint roads, muted place names. Keeps the geography readable without competing with traffic.
import type { Map as MapboxMap } from 'mapbox-gl';

const LAND = '#0a1424';
const WATER = '#040a15';
const WATERLINE = '#183352';
const ROAD = '#192a40';
const LABEL = '#58728e';

export function styleRadarMap(map: MapboxMap) {
  const layers = map.getStyle()?.layers ?? [];
  for (const l of layers) {
    const id = l.id;
    try {
      if (l.type === 'background') {
        map.setPaintProperty(id, 'background-color', LAND);
      } else if (l.type === 'fill') {
        if (/water/.test(id)) {
          map.setPaintProperty(id, 'fill-color', WATER);
          map.setPaintProperty(id, 'fill-outline-color', WATERLINE);
        } else if (/building/.test(id)) {
          map.setPaintProperty(id, 'fill-color', '#111e32');
          map.setPaintProperty(id, 'fill-opacity', 0.5);
        } else {
          map.setPaintProperty(id, 'fill-color', '#0d192b');
          map.setPaintProperty(id, 'fill-opacity', 0.5);
        }
      } else if (l.type === 'line') {
        if (/water/.test(id)) {
          map.setPaintProperty(id, 'line-color', WATERLINE);
          map.setPaintProperty(id, 'line-opacity', 0.7);
        } else if (/admin/.test(id)) {
          map.setPaintProperty(id, 'line-color', '#3a5372');
          map.setPaintProperty(id, 'line-opacity', 0.6);
        } else if (/road|bridge|tunnel|rail/.test(id)) {
          map.setPaintProperty(id, 'line-color', ROAD);
          map.setPaintProperty(id, 'line-opacity', 0.5);
        }
      } else if (l.type === 'symbol') {
        if (/settlement|place|water|natural/.test(id)) {
          map.setPaintProperty(id, 'text-color', LABEL);
          map.setPaintProperty(id, 'text-halo-color', LAND);
          map.setPaintProperty(id, 'text-opacity', 0.75);
        } else {
          map.setLayoutProperty(id, 'visibility', 'none');
        }
      }
    } catch {
      /* layer without that property */
    }
  }
}
