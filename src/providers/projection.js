import { Observer, Rotation_EQJ_HOR, RotateVector, Vector, MakeTime, HorizonFromVector } from 'astronomy-engine';
import { equatorialUnit, projectHorizontal } from '../core/projection.js';
import { getConstellationCatalog } from './catalog.js';
import { fail } from './http.js';

export function horizontalStars(catalog, { lat, lng, at }) {
  if (!Number.isFinite(lat) || Math.abs(lat) > 90 || !Number.isFinite(lng) || Math.abs(lng) > 180 ||
      typeof at !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/.test(at))
    fail('Invalid observation', 400, 'invalid_observation');
  const date = new Date(at);
  if (!Number.isFinite(date.getTime()) || date.toISOString() !== at || date.getUTCFullYear() < 2000 || date.getUTCFullYear() > 2100)
    fail('Invalid observation', 400, 'invalid_observation');
  if (catalog?.epoch !== 'J2000' || catalog.angleUnit !== 'degree' || catalog.coordinateSystem !== 'equatorial' ||
      !Array.isArray(catalog.stars) || !catalog.stars.length || catalog.stars.length > 200)
    fail('Invalid catalogue coordinates', 503, 'catalog_unavailable');
  try {
    const time = MakeTime(date);
    const rotation = Rotation_EQJ_HOR(time, new Observer(lat, lng, 0));
    return catalog.stars.map(star => {
      const [x, y, z] = equatorialUnit(star.raDeg, star.decDeg);
      const value = HorizonFromVector(RotateVector(rotation, new Vector(x, y, z, time)), null);
      if (![value.lon, value.lat].every(Number.isFinite)) throw Error('Invalid transformation');
      return { id: star.id, magnitude: star.magnitude, azimuthDeg: value.lon, altitudeDeg: value.lat };
    });
  } catch { fail('Coordinate transformation failed', 503, 'projection_unavailable'); }
}

export async function projectConstellation(input) {
  if (!input || Object.keys(input).some(key => !['id', 'lat', 'lng', 'at'].includes(key)))
    fail('Invalid projection input');
  const catalog = await getConstellationCatalog({ id: input.id });
  const stars = horizontalStars(catalog, input);
  const result = projectHorizontal({ id: catalog.id, stars, lines: catalog.lines });
  return { ...result, at: input.at, timeBasis: 'explicit-utc-catalog-calculation', refraction: 'none',
    source: { ...catalog.source, calculation: 'astronomy-engine@2.1.19' } };
}
