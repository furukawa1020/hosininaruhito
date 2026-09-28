import test from 'node:test';
import assert from 'node:assert/strict';
import {createPoseModel} from '../src/client/pose-model.js';
import {createPoseBitmap} from '../src/client/pose-bitmap.js';
const canvas=()=>({getContext:()=>({fillRect(){}})});
function model(fail=false){return {closed:0,results:0,detectForVideo(_,at){assert.equal(at,0);if(fail)throw Error('driver details');return {close:()=>this.results++};},close(){this.closed++;}};}
test('real CPU model is warmed before ready with unchanged multi-person and confidence gates',async()=>{
 const options=[],cpu=model();
 const result=await createPoseModel({create:async o=>{options.push(o);return cpu;},modelAssetPath:'/local.task',createCanvas:canvas});
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
