import test from 'node:test';
import assert from 'node:assert/strict';
import {createPoseModel} from '../src/client/pose-model.js';
import {createPoseBitmap} from '../src/client/pose-bitmap.js';
const canvas=()=>({getContext:()=>({fillRect(){}})});
function model(fail=false){return {closed:0,results:0,detectForVideo(_,at){assert.ok(at===0||at===1);if(fail)throw Error('driver details');return {close:()=>this.results++};},close(){this.closed++;}};}
test('real CPU model is warmed before ready with unchanged multi-person and confidence gates',async()=>{
 const options=[],cpu=model();
 const result=await createPoseModel({create:async o=>{options.push(o);return cpu;},modelAssetPath:'/local.task',delegate:'CPU',createCanvas:canvas});
 assert.equal(result,cpu);assert.equal(cpu.results,1);
 assert.deepEqual(options,[{baseOptions:{modelAssetPath:'/local.task',delegate:'CPU'},runningMode:'VIDEO',numPoses:2,outputSegmentationMasks:false,minPoseDetectionConfidence:.5,minPosePresenceConfidence:.5,minTrackingConfidence:.5}]);
});
test('initialization failure is explicit and cannot return fake ready',async()=>{
 await assert.rejects(createPoseModel({create:async()=>{throw Error('private driver details');},modelAssetPath:'/local.task',createCanvas:canvas}),/^Error: model_failed$/);
});
test('failed warmup releases its model and never reports ready',async()=>{
 const cpu=model(true);
 await assert.rejects(createPoseModel({create:async()=>cpu,modelAssetPath:'/local.task',createCanvas:canvas}),/^Error: model_failed$/);
 assert.equal(cpu.closed,1);
});
test('inference images are resized without cropping or changing the aspect ratio',async()=>{
 for(const [w,h,rw,rh] of [[1280,720,640,360],[720,1280,360,640],[1920,1080,640,360]]){
  const video={videoWidth:w,videoHeight:h},bitmap={};
  const result=await createPoseBitmap(video,(...args)=>{assert.deepEqual(args,[video,{resizeWidth:rw,resizeHeight:rh,resizeQuality:'low'}]);return Promise.resolve(bitmap);});
  assert.equal(result,bitmap);
 }
});
test('small inference images are not enlarged and unavailable dimensions fail before capture',async()=>{
 const video={videoWidth:320,videoHeight:240};
 await createPoseBitmap(video,(...args)=>{assert.deepEqual(args,[video]);});
 for(const value of [0,-1,NaN,Infinity])assert.throws(()=>createPoseBitmap({videoWidth:value,videoHeight:480},()=>assert.fail('capture must not run')),/invalid_frame_size/);
});

test('GPU gets a dedicated uninitialized canvas, separate from the warmup image',async()=>{
 const canvases=[],gpu=model();let options;
 const result=await createPoseModel({modelAssetPath:'/local.task',createCanvas:()=>{
  const c={contexts:[],getContext(type){this.contexts.push(type);return {fillRect(){}};}};canvases.push(c);return c;
 },create:async o=>{options=o;assert.deepEqual(o.canvas.contexts,[]);return gpu;}});
 assert.equal(result,gpu);assert.equal(options.baseOptions.delegate,'GPU');
 assert.equal(options.canvas,canvases[0]);assert.equal(canvases.length,2);
 assert.deepEqual(canvases[0].contexts,[]);assert.deepEqual(canvases[1].contexts,['2d']);assert.equal(gpu.results,2);
});

test('slow GPU preparation releases the model so its worker can fall back before ready',async()=>{
 const gpu=model();let times=[10,111];
 await assert.rejects(createPoseModel({create:async()=>gpu,modelAssetPath:'/local.task',createCanvas:canvas,now:()=>times.shift()}),/^Error: model_failed$/);
 assert.equal(gpu.results,2);assert.equal(gpu.closed,1);
});
test('GPU preparation at the budget boundary succeeds without changing sensor freshness',async()=>{
 const gpu=model();let times=[10,110];
 assert.equal(await createPoseModel({create:async()=>gpu,modelAssetPath:'/local.task',createCanvas:canvas,now:()=>times.shift()}),gpu);
 assert.equal(gpu.results,2);assert.equal(gpu.closed,0);
});
