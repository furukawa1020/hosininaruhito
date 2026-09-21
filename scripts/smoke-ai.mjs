import { planWithCodex } from '../src/providers/planner.js';
const program = { version: 1, constellationId: 'synthetic-smoke', source: 'synthetic-contract',
  steps: [0.3,0.5,0.7].map((x,i)=>({starId:'test-'+i,joint:'leftWrist',target:{x,y:0.5},holdMs:800,tolerance:0.045})) };
const started = performance.now();
try {
  const result = await planWithCodex({program}, process.env);
  console.log(JSON.stringify({test:'live-codex-synthetic-input',source:result.source,attempts:result.planning.attempts,
    usageTokens:result.planning.usageTokens,simulation:result.planning.simulation,durationMs:Math.round(performance.now()-started)}));
} catch (error) {
  console.error(JSON.stringify({test:'live-codex-synthetic-input',code:error.code || 'failed',durationMs:Math.round(performance.now()-started)}));
  process.exitCode=1;
}
