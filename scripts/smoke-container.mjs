import { spawnSync } from 'node:child_process';
import { randomUUID } from 'node:crypto';

const image = 'hcr-api:verification';
const vertex = process.argv.includes('--vertex');
const serverProbe = `
import {spawn} from 'node:child_process';
import {access} from 'node:fs/promises';
import {setTimeout as delay} from 'node:timers/promises';
const server=spawn(process.execPath,['src/server/index.js'],{
 env:{...process.env,HCR_ACCESS_TOKEN:'container-test-only',PORT:'18080',HCR_BIND:'127.0.0.1',HCR_PLANNER_PROVIDER:'${vertex ? 'vertex' : 'codex'}'},stdio:'ignore'});
const exited=new Promise(resolve=>server.once('exit',(code,signal)=>resolve({code,signal})));
try {
 let status;
 for(let attempt=0;attempt<50;attempt++){
  try{status=await fetch('http://127.0.0.1:18080/api/status');break;}catch{await delay(100);}
 }
 if(!status)throw Error('server_start_failed');
 const serviceStatus=await status.json();
 const options={method:'POST',headers:{'Content-Type':'application/json'},body:'{"id":"1"}'};
 const unauthorized=await fetch('http://127.0.0.1:18080/api/catalog',options);await unauthorized.arrayBuffer();
 const catalog=await fetch('http://127.0.0.1:18080/api/catalog',{...options,headers:{...options.headers,Authorization:'Bearer container-test-only'}});await catalog.arrayBuffer();
 let secretFile=false;try{await access('/app/.env');secretFile=true;}catch{}
 server.kill('SIGTERM');
 const stop=await Promise.race([exited,delay(3000).then(()=>({timeout:true}))]);
 const gracefulStop=stop.code===0;
 const report={uid:process.getuid(),status:status.status,unauthorized:unauthorized.status,catalog:catalog.status,secretFile,gracefulStop,planner:serviceStatus.plannerProvider};
 console.log(JSON.stringify(report));
 if(report.uid!==1000||report.status!==200||report.unauthorized!==401||report.catalog!==200||secretFile||!gracefulStop||report.planner!=='${vertex ? 'vertex' : 'codex'}')process.exitCode=1;
} finally {if(server.exitCode===null)server.kill('SIGKILL');}
`;
const vertexProbe = `
import {planWithVertex} from './src/providers/vertex.js';
const program={version:1,constellationId:'container-contract',source:'synthetic',steps:[{starId:'a',joint:'leftWrist',target:{x:.5,y:.5},holdMs:800,tolerance:.04}]};
const keepAlive=setTimeout(()=>{},5000);
try {
 await planWithVertex({program},{VERTEX_PROJECT_ID:'hosininaruhito-20260920',VERTEX_LOCATION:'global',VERTEX_MODEL:'gemini-test'},{timeoutMs:1000});
 console.log(JSON.stringify({ok:false,reason:'unexpected_success'}));process.exitCode=1;
}catch(error){
 const ok=['upstream_auth','upstream_timeout'].includes(error.code);
 console.log(JSON.stringify({ok,reason:error.code||'unexpected_failure',liveGeneration:false}));process.exitCode=ok?0:1;
}finally{clearTimeout(keepAlive);}
`;
const sandboxProbe = `
import {spawnSync} from 'node:child_process';
import {mkdtempSync} from 'node:fs';
const home=mkdtempSync('/tmp/hcr-codex-');
const probe="require('node:fs').readFileSync('/app/package.json');try{require('node:fs').writeFileSync('/tmp/hcr-sandbox-probe','probe');process.exit(2);}catch(e){if(!['EACCES','EPERM','EROFS'].includes(e.code))throw e;console.log('read_ok_write_denied');}";
const result=spawnSync('/app/node_modules/.bin/codex',['sandbox','-c','sandbox_mode="read-only"','--','node','-e',probe],{encoding:'utf8',timeout:15000,env:{...process.env,CODEX_HOME:home}});
const ok=result.status===0&&result.stdout.trim()==='read_ok_write_denied';
console.log(JSON.stringify({uid:process.getuid(),ok,reason:ok?'read_ok_write_denied':/namespace/.test(result.stderr)?'namespace_unavailable':result.error?.code||'sandbox_failed'}));
process.exitCode=ok?0:1;
`;
function probe(name, input) {
 const container='hcr-verification-'+randomUUID();
 try {
  const run=spawnSync('docker',['run','--name',container,'--rm','-i','--network','none','--read-only','--tmpfs','/tmp',
   '--memory','512m','--cpus','1','--pids-limit','128',image,'node','--input-type=module'],
   {input,encoding:'utf8',timeout:30000,maxBuffer:65536});
  let detail;
  try {detail=JSON.parse(run.stdout.trim());}catch {detail={reason:run.error?.code||'container_failed'};}
  return {test:name,ok:run.status===0,detail};
 } finally {
  // This unique name belongs only to this invocation, including timeout cleanup.
  spawnSync('docker',['rm','--force',container],{encoding:'utf8',timeout:10000,maxBuffer:65536});
 }
}
const results=[probe('container-api',serverProbe),vertex ? probe('vertex-no-credentials-rejected',vertexProbe) : probe('codex-read-only-sandbox',sandboxProbe)];
for(const result of results)console.log(JSON.stringify(result));
process.exitCode=results.every(r=>r.ok)?0:1;
