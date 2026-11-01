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
  const documentEvents={};
  const host={ownerDocument:{createElement(){return canvas;},addEventListener(type,fn){documentEvents[type]=fn;},removeEventListener(type){delete documentEvents[type];}},append(){},dataset:{},getBoundingClientRect(){return rect;}};
  const dome=mountSkyDome(host,{onSelect:i=>selected.push(i)});dome.resize();dome.update(rows,0);
  const pointer=(type,x=200,y=200)=>events[type]({pointerId:1,button:0,clientX:x,clientY:y});
  return {dome,host,canvas,pointer,selected,arcs,labels,rows,captured,rect,events,documentEvents};
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

test('pointer capture failure and lost capture before release never select a marker',t=>{
 const s=setup(t),capture=s.canvas.setPointerCapture;
 s.canvas.setPointerCapture=()=>{throw Error('fixture');};
 assert.doesNotThrow(()=>s.pointer('pointerdown'));s.pointer('pointerup');assert.deepEqual(s.selected,[]);
 s.canvas.setPointerCapture=capture;s.pointer('pointerdown');s.captured.clear();s.pointer('pointerup');assert.deepEqual(s.selected,[]);
 s.pointer('pointerdown');s.pointer('pointerup');assert.deepEqual(s.selected,[0]);
});
test('pointer release exceptions cancel selection and do not block subsequent gestures',t=>{
 const s=setup(t),release=s.canvas.releasePointerCapture;
 s.canvas.releasePointerCapture=()=>{throw Error('fixture');};
 s.pointer('pointerdown');assert.doesNotThrow(()=>s.pointer('pointerup'));assert.deepEqual(s.selected,[]);
 s.pointer('pointerdown');assert.doesNotThrow(()=>s.dome.center());
 s.canvas.releasePointerCapture=release;s.captured.clear();s.pointer('pointerdown');s.pointer('pointerup');assert.deepEqual(s.selected,[0]);
});

test('zero sized dome discards old hits and restores selection after resizing',t=>{
 const s=setup(t);s.rect.width=0;s.dome.resize();s.pointer('pointerdown');s.pointer('pointerup');assert.deepEqual(s.selected,[]);
 s.rect.width=400;s.dome.resize();s.pointer('pointerdown');s.pointer('pointerup');assert.deepEqual(s.selected,[0]);
});
test('resize cancels an old gesture only when geometry changes',t=>{
 const s=setup(t);s.pointer('pointerdown');s.dome.resize();assert.equal(s.captured.size,1);
 s.rect.height=450;s.dome.resize();assert.equal(s.captured.size,0);s.pointer('pointerup');assert.deepEqual(s.selected,[]);
 s.pointer('pointerdown',200,225);s.pointer('pointerup',200,225);assert.deepEqual(s.selected,[0]);
});
test('hidden document releases capture and ignores old and hidden presses',t=>{
 const s=setup(t);s.pointer('pointerdown');s.host.ownerDocument.hidden=true;s.documentEvents.visibilitychange();assert.equal(s.captured.size,0);
 s.pointer('pointerdown');s.pointer('pointerup');assert.deepEqual(s.selected,[]);
 s.host.ownerDocument.hidden=false;s.documentEvents.visibilitychange();s.pointer('pointerup');assert.deepEqual(s.selected,[]);
 s.pointer('pointerdown');s.pointer('pointerup');assert.deepEqual(s.selected,[0]);
});
test('context loss shows fallback and restoration rebuilds markers',t=>{
 const s=setup(t);s.pointer('pointerdown');s.events.contextlost();assert.equal(s.host.dataset.fallback,'true');assert.equal(s.canvas.hidden,true);assert.equal(s.captured.size,0);
 s.pointer('pointerup');s.pointer('pointerdown');s.pointer('pointerup');assert.deepEqual(s.selected,[]);
 s.events.contextrestored();assert.equal(s.host.dataset.fallback,undefined);assert.equal(s.canvas.hidden,false);
 s.pointer('pointerdown');s.pointer('pointerup');assert.deepEqual(s.selected,[0]);
});
test('disposed dome ignores late resize, update, centering and context recovery',t=>{
 const s=setup(t);s.dome.dispose();const before=s.host.dataset.orientation;
 s.dome.resize();s.dome.update(s.rows,0);s.dome.center();s.events.contextrestored();
 assert.equal(s.canvas.width,0);assert.equal(s.canvas.height,0);assert.equal(s.host.dataset.orientation,before);assert.deepEqual(s.documentEvents,{});
});
