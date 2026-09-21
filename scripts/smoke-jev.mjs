import {decideReflex} from '../src/providers/live.js';
const start=performance.now();
try{
 const result=await decideReflex({dx:.1,dy:0,tracked:true},process.env);
 console.log(JSON.stringify({test:'live-jev-synthetic-input',source:result.source,advisoryOnly:result.advisoryOnly,durationMs:Math.round(performance.now()-start)}));
}catch(error){
 console.error(JSON.stringify({test:'live-jev-synthetic-input',code:error.code||'failed'}));process.exitCode=1;
}
