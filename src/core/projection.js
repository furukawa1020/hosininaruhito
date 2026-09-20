const RAD = Math.PI / 180;
const dot = (a, b) => a.reduce((sum, n, i) => sum + n * b[i], 0);
const direction = (az, alt) => [Math.cos(alt * RAD) * Math.sin(az * RAD), Math.cos(alt * RAD) * Math.cos(az * RAD), Math.sin(alt * RAD)];
const identifier = value => typeof value === 'string' && value.trim().length > 0 && value.length <= 200;
const angles = star => star && Number.isFinite(star.azimuthDeg) && star.azimuthDeg >= 0 && star.azimuthDeg < 360 &&
  Number.isFinite(star.altitudeDeg) && Math.abs(star.altitudeDeg) <= 90;

export function equatorialUnit(raDeg, decDeg) {
  if (!Number.isFinite(raDeg) || raDeg < 0 || raDeg >= 360 || !Number.isFinite(decDeg) || Math.abs(decDeg) > 90)
    throw Error('invalid_equatorial');
  return [Math.cos(decDeg * RAD) * Math.cos(raDeg * RAD), Math.cos(decDeg * RAD) * Math.sin(raDeg * RAD), Math.sin(decDeg * RAD)];
}

// Tangent plane viewed from inside the sky: azimuth increases right, altitude up.
// This is a shape template, not camera orientation, world-space depth or physical reach.
export function projectHorizontal(constellation, center = null) {
  const excluded = [];
  const fail = reason => ({ ok: false, reason, excluded });
  if (!identifier(constellation?.id) || !Array.isArray(constellation.stars) ||
      !constellation.stars.length || constellation.stars.length > 200 ||
      Array.from(constellation.stars).some(star => !identifier(star?.id) || !angles(star)) ||
      new Set(constellation.stars.map(star => star.id)).size !== constellation.stars.length ||
      !Array.isArray(constellation.lines) || constellation.lines.length > 100) return fail('invalid_constellation');
  const all = new Set(constellation.stars.map(star => star.id));
  if (Array.from(constellation.lines).some(line => !Array.isArray(line) || line.length < 2 || line.length > 100 ||
      Array.from(line).some((id, i) => !all.has(id) || (i > 0 && id === line[i - 1])))) return fail('invalid_lines');
  if (center !== null && (!angles(center) || center.altitudeDeg <= 0)) return fail('invalid_center');
  const visible = constellation.stars.filter(star => {
    if (star.altitudeDeg > 0) return true;
    excluded.push({ id: star.id, reason: 'below_horizon' }); return false;
  });
  if (!visible.length) return fail('below_horizon');
  if (!center) {
    const sum = visible.map(star => direction(star.azimuthDeg, star.altitudeDeg))
      .reduce((a, b) => a.map((n, i) => n + b[i]), [0, 0, 0]);
    const length = Math.hypot(...sum);
    if (length < 1e-9) return fail('undefined_center');
    center = { azimuthDeg: (Math.atan2(sum[0], sum[1]) / RAD + 360) % 360,
      altitudeDeg: Math.atan2(sum[2], Math.hypot(sum[0], sum[1])) / RAD };
  }
  if (Math.abs(Math.cos(center.altitudeDeg * RAD)) < 1e-8) return fail('zenith_center');
  const az = center.azimuthDeg * RAD, alt = center.altitudeDeg * RAD;
  const forward = direction(center.azimuthDeg, center.altitudeDeg);
  const right = [Math.cos(az), -Math.sin(az), 0];
  const up = [-Math.sin(alt) * Math.sin(az), -Math.sin(alt) * Math.cos(az), Math.cos(alt)];
  const projected = [];
  for (const star of visible) {
    const vector = direction(star.azimuthDeg, star.altitudeDeg), denominator = dot(vector, forward);
    if (denominator <= Math.cos(80 * RAD)) {
      excluded.push({ id: star.id, reason: 'outside_projection' }); continue;
    }
    projected.push({ ...star, planeX: dot(vector, right) / denominator, planeY: -dot(vector, up) / denominator });
  }
  if (projected.length < 2) return fail('insufficient_stars');
  const x = projected.map(p => p.planeX), y = projected.map(p => p.planeY);
  const minX = Math.min(...x), maxX = Math.max(...x), minY = Math.min(...y), maxY = Math.max(...y);
  const span = Math.max(maxX - minX, maxY - minY);
  if (span < 1e-9) return fail('degenerate_projection');
  const scale = 0.8 / span;
  const stars = projected.map(({ planeX, planeY, ...star }) => ({ ...star,
    x: 0.5 + (planeX - (minX + maxX) / 2) * scale,
    y: 0.5 + (planeY - (minY + maxY) / 2) * scale }));
  const included = new Set(stars.map(star => star.id));
  // Split into original adjacent edges; never connect across an excluded star.
  const lines = constellation.lines.flatMap(line => line.slice(1).flatMap((id, i) =>
    included.has(line[i]) && included.has(id) ? [[line[i], id]] : []));
  return { ok: true, id: constellation.id, stars, lines, excluded, center: { ...center },
    projection: 'gnomonic', coordinateSystem: 'normalized-image-template', mirrored: false,
    normalization: { scale, centerX: (minX + maxX) / 2, centerY: (minY + maxY) / 2, margin: 0.1 } };
}
