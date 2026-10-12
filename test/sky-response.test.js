import test from 'node:test';
import assert from 'node:assert/strict';
import {skyRows} from '../src/client/sky-response.js';
const row={id:'1',name:'試験星座',azimuthDeg:360,altitudeDeg:-90};
const payload=rows=>({source:'hoshimiru-live',constellations:rows});
test('sky display accepts empty and bounded real rows, sorts without mutating input',()=>{
  assert.deepEqual(skyRows(payload([])),[]);
  const rows=[row,{...row,id:'2',altitudeDeg:90,description:'<script>text only</script>'}];
  assert.deepEqual(skyRows(payload(rows)).map(r=>r.id),['2','1']);
  assert.equal(rows[0],row);
});
test('one invalid row rejects the entire sky display payload',()=>{
  for(const patch of [{id:''},{name:' '},{azimuthDeg:null},{azimuthDeg:361},{altitudeDeg:'1'},{altitudeDeg:91},{story:{}},{description:'x'.repeat(8001)}]){
    assert.throws(()=>skyRows(payload([row,{...row,id:'2',...patch}])));
  }
  for(const value of [null,{...payload([]),source:'fixture'},payload([row,row]),payload([null]),payload(Array(89).fill(row))])assert.throws(()=>skyRows(value));
});
