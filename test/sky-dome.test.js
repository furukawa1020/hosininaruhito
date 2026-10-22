import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mountSkyDome} from '../src/client/sky-dome.js';

function setup(t, rows=[{name:'最初',azimuthDeg:0,altitudeDeg:0}]) {
  const oldObserver=globalThis.ResizeObserver,oldRatio=globalThis.devicePixelRatio;
  globalThis.ResizeObserver=class {observe(){} disconnect(){}};
  globalThis.devicePixelRatio=1;
  t.after(()=>{globalThis.ResizeObserver=oldObserver;globalThis.devicePixelRatio=oldRatio;});
  const events={},captured=new Set(),selected=[],arcs=[],labels=[];
  const ctx={clearRect(){arcs.length=labels.length=0;},createRadialGradient(){return {addColorStop(){}};},
    fillRect(){},beginPath(){},moveTo(){},lineTo(){},stroke(){},fill(){},setTransform(){},
    arc(x,y,r){arcs.push({x,y,r});},fillText(...args){labels.push(args);},measureText(text){return {width:Array.from(text).length*17};}};
  const rect={left:0,top:0,width:400,height:400};
  const canvas={setAttribute(){},getContext(){return ctx;},getBoundingClientRect(){return rect;},
    addEventListener(type,fn){events[type]=fn;},setPointerCapture(id){captured.add(id);},
    hasPointerCapture(id){return captured.has(id);},releasePointerCapture(id){captured.delete(id);}};
  const host={ownerDocument:{createElement(){return canvas;}},append(){},dataset:{},getBoundingClientRect(){return rect;}};
  const dome=mountSkyDome(host,{onSelect:i=>selected.push(i)});dome.resize();dome.update(rows,0);
  const pointer=(type,x=200,y=200)=>events[type]({pointerId:1,button:0,clientX:x,clientY:y});
  return {dome,host,pointer,selected,arcs,labels,rows,captured,rect};
}

test('small pointer jitter preserves orientation and tap; deliberate drag rotates without selecting',t=>{
  const s=setup(t),before=s.host.dataset.orientation;
  s.pointer('pointerdown');s.pointer('pointermove',203,202);
  assert.equal(s.host.dataset.orientation,before);s.pointer('pointerup',203,202);assert.deepEqual(s.selected,[0]);
  s.pointer('pointerdown');s.pointer('pointermove',230,200);s.pointer('pointerup',230,200);
  assert.notEqual(s.host.dataset.orientation,before);assert.deepEqual(s.selected,[0]);
});
test('a distant pointerup without move events does not select a marker',t=>{
  const s=setup(t);s.pointer('pointerdown',120,200);s.pointer('pointerup');assert.deepEqual(s.selected,[]);
  s.pointer('pointerdown');s.pointer('pointerup');assert.deepEqual(s.selected,[0]);
});
test('nearby markers prefer pointer distance over depth, with stable overlap selection and misses',t=>{
  const s=setup(t,[{name:'中央',azimuthDeg:0,altitudeDeg:0},{name:'隣',azimuthDeg:5,altitudeDeg:0}]);
  const adjacent=s.arcs.find(p=>p.r===3);assert.ok(Math.abs(adjacent.x-200)<24);
  s.pointer('pointerdown',adjacent.x,adjacent.y);s.pointer('pointerup',adjacent.x,adjacent.y);assert.deepEqual(s.selected,[1]);
  s.pointer('pointerdown',0,0);s.pointer('pointerup',0,0);assert.deepEqual(s.selected,[1]);
  s.dome.update([{name:'a',azimuthDeg:0,altitudeDeg:0},{name:'b',azimuthDeg:0,altitudeDeg:0}],0);
  s.pointer('pointerdown');s.pointer('pointerup');assert.deepEqual(s.selected,[1,0]);
});
for(const reset of ['center','update','dispose'])test('dome '+reset+' releases old drag and ignores its remaining events',t=>{
  const s=setup(t);s.pointer('pointerdown');s.pointer('pointermove',240,200);
  if(reset==='update')s.dome.update([{name:'new',azimuthDeg:90,altitudeDeg:20}],0);else s.dome[reset]();
  const before=s.host.dataset.orientation;assert.equal(s.captured.size,0);
  s.pointer('pointermove',270,200);s.pointer('pointerup');assert.equal(s.host.dataset.orientation,before);assert.deepEqual(s.selected,[]);
  if(reset!=='dispose'){s.pointer('pointerdown');s.pointer('pointermove',230,200);assert.notEqual(s.host.dataset.orientation,before);}
});
test('dome labels remain bounded and preserve short names and source data',t=>{
  const s=setup(t);assert.equal(s.labels.at(-1)[0],'最初');
  const name='長い星座'.repeat(50);s.dome.update([{name,azimuthDeg:0,altitudeDeg:0}],0);
  const [label,x,,maxWidth]=s.labels.at(-1);assert.ok(label.endsWith('…'));assert.ok(label.length<name.length);
  assert.ok(x-maxWidth/2>=12);assert.ok(x+maxWidth/2<=s.rect.width-12);
  s.rect.width=80;s.dome.resize();assert.equal(s.labels.at(-1)[3],56);
});
