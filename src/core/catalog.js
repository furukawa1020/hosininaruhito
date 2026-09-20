// Mapping follows the provider's published 1..88 table, NOT catalogue array order.
const iau = 'And Ant Aps Aql Aqr Ara Ari Aur Boo Cae Cam Cap Car Cas Cen Cep Cet Cha Cir CMa CMi Cnc Col Com CrA CrB Crt Cru Crv CVn Cyg Del Dor Dra Equ Eri For Gem Gru Her Hor Hya Hyi Ind Lac Leo Lep Lib LMi Lup Lyn Lyr Men Mic Mon Mus Nor Oct Oph Ori Pav Peg Per Phe Pic PsA Psc Pup Pyx Ret Scl Sco Sct Ser Sex Sge Sgr Tau Tel TrA Tri Tuc UMa UMi Vel Vir Vol Vul'.split(' ');
export const CATALOG_IDS = Object.freeze(iau.map((code, i) => Object.freeze({ id: String(i + 1), iau: code })));
export const CATALOG_REVISION = '7e720a3de062059d4c5400a379146a601d9010e0';
const known = new Set(iau);
function invalid(reason) { throw Object.assign(new Error(reason), { code: reason }); }
function collection(data, max) {
  if (data?.type !== 'FeatureCollection' || !Array.isArray(data.features) || !data.features.length || data.features.length > max)
    invalid('invalid_catalog');
  return data.features;
}
function position(value) {
  return Array.isArray(value) && value.length === 2 && value.every(Number.isFinite) &&
    Math.abs(value[0]) <= 180 && Math.abs(value[1]) <= 90;
}

export function compileCatalog(starData, lineData) {
  const byPosition = new Map(), ids = new Set();
  for (const star of collection(starData, 50000)) {
    if (star?.type !== 'Feature' || !Number.isInteger(star.id) || star.id <= 0 || star.id > 200000 ||
        ids.has(star.id) || star.geometry?.type !== 'Point' || !position(star.geometry.coordinates) ||
        !Number.isFinite(star.properties?.mag) || star.properties.mag < -10 || star.properties.mag > 30) invalid('invalid_star');
    ids.add(star.id);
    const key = star.geometry.coordinates.join(',');
    byPosition.set(key, [...(byPosition.get(key) || []), star]);
  }
  const groups = new Map();
  for (const feature of collection(lineData, 89)) {
    if (feature?.type !== 'Feature' || !known.has(feature.id) || feature.geometry?.type !== 'MultiLineString' ||
        !Array.isArray(feature.geometry.coordinates) || !feature.geometry.coordinates.length || feature.geometry.coordinates.length > 100) invalid('invalid_lines');
    let group = groups.get(feature.id);
    if (group && (feature.id !== 'Ser' || group.parts >= 2)) invalid('duplicate_constellation');
    if (!group) { group = { stars: new Map(), lines: [], parts: 0 }; groups.set(feature.id, group); }
    group.parts++;
    for (const line of feature.geometry.coordinates) {
      if (!Array.isArray(line) || line.length < 2 || line.length > 100) invalid('invalid_lines');
      const path = [];
      for (const p of line) {
        if (!position(p)) invalid('invalid_lines');
        const matches = byPosition.get(p.join(','));
        if (!matches) invalid('missing_star');
        if (matches.length !== 1) invalid('ambiguous_star');
        const star = matches[0], id = 'HIP:' + star.id;
        if (path.at(-1) === id) invalid('degenerate_line');
        group.stars.set(id, { id, raDeg: (p[0] + 360) % 360, decDeg: p[1], magnitude: star.properties.mag });
        path.push(id);
      }
      group.lines.push(path);
    }
  }
  if (groups.size !== 88 || groups.get('Ser')?.parts !== 2) invalid('incomplete_catalog');
  return {
    version: 1, epoch: 'J2000', coordinateSystem: 'equatorial', angleUnit: 'degree',
    constellations: CATALOG_IDS.map(({ id, iau }) => {
      const group = groups.get(iau);
      if (!group) invalid('incomplete_catalog');
      return { id, iau, stars: [...group.stars.values()], lines: group.lines };
    })
  };
}

export function validateCatalog(data) {
  if (data?.version !== 1 || data.epoch !== 'J2000' || data.coordinateSystem !== 'equatorial' ||
      data.angleUnit !== 'degree' || !Array.isArray(data.constellations) || data.constellations.length !== 88) invalid('invalid_catalog');
  for (const [i, row] of data.constellations.entries()) {
    if (!row || row.id !== CATALOG_IDS[i].id || row.iau !== CATALOG_IDS[i].iau ||
        !Array.isArray(row.stars) || row.stars.length < 2 || row.stars.length > 200 ||
        !Array.isArray(row.lines) || !row.lines.length || row.lines.length > 100) invalid('invalid_constellation');
    const ids = new Set();
    for (const p of row.stars) {
      if (!p || !/^HIP:[1-9][0-9]{0,5}$/.test(p.id) || ids.has(p.id) ||
          !Number.isFinite(p.raDeg) || p.raDeg < 0 || p.raDeg >= 360 ||
          !Number.isFinite(p.decDeg) || Math.abs(p.decDeg) > 90 ||
          !Number.isFinite(p.magnitude) || p.magnitude < -10 || p.magnitude > 30) invalid('invalid_star');
      ids.add(p.id);
    }
    for (const line of row.lines) {
      if (!Array.isArray(line) || line.length < 2 || line.length > 100 ||
          Array.from(line).some((id, index) => !ids.has(id) || (index && id === line[index - 1]))) invalid('invalid_lines');
    }
  }
  return data;
}
