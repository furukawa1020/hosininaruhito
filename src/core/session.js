import { CATALOG_REVISION } from './catalog.js';
import { fitConstellationToReach } from './reach.js';
import { ConstellationTrace } from './trace.js';

// Accept only the independently calculated catalogue template for this request.
export function prepareSession(projection, { id, at }, reach) {
  const fail = reason => ({ ok: false, reason });
  if (!projection || projection.at !== at || projection.timeBasis !== 'explicit-utc-catalog-calculation' ||
      projection.source?.catalog !== 'd3-celestial/XHIP' || projection.source?.commit !== CATALOG_REVISION ||
      projection.source?.license !== 'BSD-3-Clause' || projection.source?.calculation !== 'astronomy-engine@2.1.19')
    return fail('invalid_projection');
  if (projection.ok === false) return fail(['below_horizon','undefined_center','zenith_center','insufficient_stars','degenerate_projection'].includes(projection.reason) ? projection.reason : 'invalid_projection');
  if (projection.ok !== true || projection.id !== id || projection.projection !== 'gnomonic' ||
      projection.coordinateSystem !== 'normalized-image-template' || projection.mirrored !== false ||
      !Array.isArray(projection.stars) || projection.stars.length < 2 || !Array.isArray(projection.lines) ||
      !Array.isArray(projection.excluded) || projection.excluded.length > 200)
    return fail('invalid_projection');
  if (projection.stars.length > 12) return fail('too_many_stars');
  const fitted = fitConstellationToReach(projection, reach);
  if (!fitted.ok) return fitted;
  try { new ConstellationTrace({ program: fitted.program, lines: projection.lines, joint: reach.joint }); }
  catch { return fail('invalid_projection'); }
  return { ...fitted, lines: structuredClone(projection.lines), joint: reach.joint, at, excluded: projection.excluded.length };
}
