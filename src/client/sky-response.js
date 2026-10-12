// Validate the complete display payload before any selection or DOM mutation.
export function skyRows(data) {
  const text = (value, limit) => typeof value === 'string' && value.trim() && value.length <= limit;
  if (data?.source !== 'hoshimiru-live' || !Array.isArray(data.constellations) || data.constellations.length > 88) throw Error('Invalid sky response');
  const ids = new Set();
  for (const row of data.constellations) {
    if (!row || !text(row.id, 200) || ids.has(row.id) || !text(row.name, 200) ||
      !Number.isFinite(row.azimuthDeg) || row.azimuthDeg < 0 || row.azimuthDeg > 360 ||
      !Number.isFinite(row.altitudeDeg) || Math.abs(row.altitudeDeg) > 90) throw Error('Invalid sky row');
    ids.add(row.id);
    for (const [key, limit] of [['englishName',200],['summary',2000],['description',8000],['story',16000]]) {
      if (row[key] != null && (typeof row[key] !== 'string' || row[key].length > limit)) throw Error('Invalid sky text');
    }
  }
  return [...data.constellations].sort((a,b) => b.altitudeDeg - a.altitudeDeg);
}
