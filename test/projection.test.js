import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MakeTime, Observer, Vector, RotateVector, Rotation_EQJ_EQD, EquatorFromVector, Horizon } from 'astronomy-engine';
import { equatorialUnit, projectHorizontal } from '../src/core/projection.js';
import { horizontalStars, projectConstellation } from '../src/providers/projection.js';
import { getConstellationCatalog } from '../src/providers/catalog.js';
import { createApp } from '../src/server/app.js';
const star = (id, azimuthDeg, altitudeDeg) => ({ id, azimuthDeg, altitudeDeg });
const constellation = stars => ({ id: '1', stars, lines: [stars.map(star => star.id)] });
const near = (a, b, tolerance = 1e-9) => assert.ok(Math.abs(a - b) < tolerance, a + ' != ' + b);
const observation = { lat: 51.4779, lng: 0, at: '2026-01-15T20:00:00.000Z' };

test('equatorial degrees produce finite unit vectors with correct axes and celestial poles', () => {
  for (const [ra, dec, expected] of [[0,0,[1,0,0]],[90,0,[0,1,0]],[0,90,[0,0,1]],[240,-90,[0,0,-1]]])
    equatorialUnit(ra, dec).forEach((value, i) => near(value, expected[i]));
  for (const args of [[360,0],[-1,0],[0,91],[NaN,0],[0,'0']]) assert.throws(() => equatorialUnit(...args));
});

test('azimuth wraps across north, right increases x and higher altitude decreases y without mirror', () => {
  const result = projectHorizontal(constellation([star('left',359,45),star('right',1,45),star('up',0,50)]));
  assert.equal(result.ok,true);
  assert.equal(result.mirrored,false);
  assert.ok(result.stars[0].x < result.stars[1].x);
  assert.ok(result.stars[2].y < result.stars[0].y);
  for (const point of result.stars) for (const key of ['x','y']) assert.ok(point[key] >= .1 - 1e-12 && point[key] <= .9 + 1e-12);
  near(result.stars[0].y,result.stars[1].y);
});

test('horizon boundary and hidden endpoints are removed without reconnecting a broken path', () => {
  const result = projectHorizontal(constellation([star('a',10,45),star('hidden',15,-1),star('b',20,45),star('horizon',25,0)]));
  assert.equal(result.ok,true);
  assert.deepEqual(result.excluded,[{id:'hidden',reason:'below_horizon'},{id:'horizon',reason:'below_horizon'}]);
  assert.deepEqual(result.lines,[]);
  assert.deepEqual(result.stars.map(p => p.id),['a','b']);
  assert.equal(projectHorizontal(constellation([star('a',0,0),star('b',10,-1)])).reason,'below_horizon');
});

test('projection uses adjacent original edges and one uniform scale', () => {
  const result = projectHorizontal(constellation([star('a',5,40),star('b',10,45),star('c',15,40)]),{azimuthDeg:10,altitudeDeg:45});
  assert.equal(result.ok,true);
  assert.deepEqual(result.lines,[['a','b'],['b','c']]);
  near(result.stars[0].y,result.stars[2].y);
  near(result.stars[1].x,.5);
  near(result.stars[0].x,.1);
  near(result.stars[2].x,.9);
});

test('zenith, coincident stars, one point and gnomonic back hemisphere return explicit reasons', () => {
  assert.equal(projectHorizontal(constellation([star('a',0,90),star('b',90,90)])).reason,'zenith_center');
  assert.equal(projectHorizontal(constellation([star('a',10,45),star('b',10,45)])).reason,'degenerate_projection');
  assert.equal(projectHorizontal({id:'1',stars:[star('a',0,45)],lines:[]}).reason,'insufficient_stars');
  const result=projectHorizontal(constellation([star('a',0,10),star('b',180,10)]),{azimuthDeg:0,altitudeDeg:10});
  assert.equal(result.reason,'insufficient_stars');
  assert.deepEqual(result.excluded,[{id:'b',reason:'outside_projection'}]);
});

test('malformed directions, lines, centers and duplicate IDs never yield NaN templates', () => {
  const valid=constellation([star('a',0,45),star('b',5,50)]);
  for (const mutate of [
    d => {d.stars[0].altitudeDeg=NaN;}, d => {d.stars[0].azimuthDeg=360;},
    d => {d.stars[0].altitudeDeg=91;}, d => {d.stars[1].id='a';},
    d => {d.lines=[['a','missing']];}, d => {d.lines=[['a','a']];},
    d => {delete d.stars[0];}, d => {d.id='';}
  ]) {const data=structuredClone(valid);mutate(data);assert.equal(projectHorizontal(data).ok,false);}
  assert.equal(projectHorizontal(valid,{azimuthDeg:0,altitudeDeg:-10}).reason,'invalid_center');
});

test('J2000 adapter agrees with independent equator-of-date plus Horizon API across poles and date boundaries', async () => {
  const catalog=await getConstellationCatalog({id:'60'});
  for (const place of [
    observation,
    {lat:90,lng:180,at:'2000-01-01T00:00:00.000Z'},
    {lat:-90,lng:-180,at:'2100-12-31T23:59:59.999Z'},
    {lat:0,lng:179,at:'2026-01-01T00:00:00.000Z'}
  ]) {
    const transformed=horizontalStars(catalog,place);
    const time=MakeTime(new Date(place.at)), rotation=Rotation_EQJ_EQD(time);
    for (const [i,p] of catalog.stars.entries()) {
      const xyz=equatorialUnit(p.raDeg,p.decDeg);
      const equator=EquatorFromVector(RotateVector(rotation,new Vector(...xyz,time)));
      const reference=Horizon(time,new Observer(place.lat,place.lng,0),equator.ra,equator.dec,null);
      near(transformed[i].altitudeDeg,reference.altitude,1e-7);
      const delta=((transformed[i].azimuthDeg-reference.azimuth+540)%360)-180;
      near(delta,0,1e-7);
    }
  }
});

test('invalid UTC, calendar, observer coordinates and catalogue epoch are rejected', async () => {
  const catalog=await getConstellationCatalog({id:'60'});
  for (const bad of [
    {at:'2026-01-15T20:00:00'}, {at:'2026-01-15T20:00:00.000+09:00'},
    {at:'2026-02-30T20:00:00.000Z'}, {at:'1999-12-31T23:59:59.999Z'},
    {at:'2101-01-01T00:00:00.000Z'}, {lat:91},{lng:181},{lat:'0'}
  ]) assert.throws(() => horizontalStars(catalog,{...observation,...bad}),error => error.status===400);
  assert.throws(() => horizontalStars({...catalog,epoch:'of-date'},observation),error => error.status===503);
});

test('real catalogue yields a finite template and explicit calculation provenance without external calls', async t => {
  t.mock.method(globalThis,'fetch',() => {throw Error('Network must not be used');});
  const result=await projectConstellation({id:'60',...observation});
  assert.equal(result.ok,true);
  assert.equal(result.at,observation.at);
  assert.equal(result.timeBasis,'explicit-utc-catalog-calculation');
  assert.equal(result.refraction,'none');
  assert.equal(result.source.calculation,'astronomy-engine@2.1.19');
  assert.ok(result.stars.every(p => Number.isFinite(p.x) && Number.isFinite(p.y)));
  assert.equal(JSON.stringify(result).includes('"lat":'),false);
  await assert.rejects(projectConstellation({id:'60',...observation,datetime:'inferred'}));
});

test('projection route authenticates, validates input and preserves source ID and UTC', async () => {
  const app=createApp({HCR_ACCESS_TOKEN:'test'});
  const request=(data,auth=true) => ({method:'POST',headers:{'Content-Type':'application/json',...(auth?{Authorization:'Bearer test'}:{})},body:JSON.stringify(data)});
  assert.equal((await app.request('/api/project',request({id:'60',...observation},false))).status,401);
  assert.equal((await app.request('/api/project',request({id:'60',...observation,lat:91}))).status,400);
  const response=await app.request('/api/project',request({id:'60',...observation}));
  assert.equal(response.status,200);
  assert.equal(response.headers.get('cache-control'),'no-store');
  const data=await response.json();
  assert.equal(data.id,'60');
  assert.equal(data.ok,true);
});
