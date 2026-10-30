import { mountStudio } from './studio.js';
import { skyRows } from './sky-response.js';
import './studio.css';
import { mountAdvice } from './advice-view.js';
import { validateAdvice } from './advice.js';
import {mountPlayGuide} from './play-guide.js';
import {mountLocation} from './location-view.js';
import {mountAccess,configureAccess,hasAccess,requestHeaders} from './access.js';
import './style.css';
import { mountSession } from './session-view.js';
import { mountTrace } from './trace-view.js';
import { mountReach } from './reach-view.js';
import { mountCamera } from './camera-view.js';
import { mountPose } from './pose-view.js';
import { RequestSession, parseCoordinates, fetchJson } from './requests.js';

const $ = id => document.getElementById(id);
const session = new RequestSession();
const statusSession = new RequestSession();
let pose, experience, advice, studio, location;
let observation = null;
let lastTraceState = null;
const camera = mountCamera(document, window, { onChange: state => pose?.cameraChanged(state) });
const reach = mountReach(document, window, { onChange: () => experience?.reachChanged() });
const trace = mountTrace(document, window, { onState: state => {
  const completed = state.state === 'complete' && lastTraceState !== 'complete';
  lastTraceState = state.state;
  advice?.update(state); studio?.onTrace(state);
  if (completed) queueMicrotask(() => {
    if (lastTraceState !== 'complete') return;
    camera.stop('complete'); pose?.stop();
  });
}, onFailure: () => { camera.stop('manual'); pose?.stop(); } });
advice = mountAdvice(document, window);
experience = mountSession(document, window, { reach, trace });
pose = mountPose(document, window, { onSample: frame => { reach.onFrame(frame); trace.onFrame(frame); experience.refresh(); } });
let services = null;
let busy = false;
let checking = false;
const labels = { access: 'アクセス認証', sky: '星をみるひとAPI', reflex: 'Jev / 助言', planner: 'AI / 振付' };
const errors = {
  daily_limit: '本日の利用上限に達しました。日付がUTCで変わってから利用できます。',
  service_paused: '運営側で接続を停止しています。',
  quota_unavailable: '利用上限を確認できません。時間をおいて試してください。',
  not_configured: 'サーバーの接続設定が不足しています。「接続の準備」を確認してください。',
  unauthorized: '認証情報が一致しません。ログインし直すか、開発環境ではアクセストークンを確認してください。',
  busy: 'サーバーが処理中です。少し待ってから再試行してください。',
  invalid_request: '入力内容が正しくありません。緯度・経度を確認してください。',
  invalid_json: '送信データを読み取れませんでした。',
  upstream_http: '外部APIがエラーを返しました。サーバーのAPIキーや利用状況を確認してください。',
  invalid_response: '外部APIの応答を確認できませんでした。結果は表示していません。',
  upstream_timeout: '外部APIの応答が時間内に届きませんでした。再試行してください。',
  upstream_unavailable: '外部APIに接続できませんでした。',
  cancelled: '通信を停止しました。',
  payload_too_large: '送信データが大きすぎます。'
};
function notice(message, tone = '') {
  $('notice').textContent = message;
  $('notice').dataset.tone = tone;
}
function updateControls() {
  $('services').setAttribute('aria-busy', String(checking));
  $('controls').disabled = busy || checking;
  $('refresh').disabled = busy || checking;
  $('sky').disabled = busy || checking || !(services?.access && services?.sky);
  $('jev').disabled = busy || checking || !(services?.access && services?.reflex);
}
function clearResults() {
  observation = null; experience.clearSelection();
  $('constellations').replaceChildren();
  $('detail').hidden = true;
  $('empty').hidden = false;
  $('empty-title').textContent = 'どんな星座に、なろう。';
  $('empty-help').textContent = '見つかった星座がここに並びます。気になる名前を押して選んでください。';
  $('count').textContent = '検索前';
  $('result').textContent = '実APIの応答をここに表示します。';
}
function stop(message = '通信とカメラを停止しました。再開するには、もう一度操作してください。', cameraReason = 'manual') {
  location?.cancel();
  advice.stop();
  experience.stop();
  trace.stop(cameraReason);
  camera.stop(cameraReason);
  pose.stop();
  session.cancel();
  statusSession.cancel();
  if (checking) $('services').textContent = '接続確認を停止しました。「再確認」でやり直せます。';
  checking = false;
  busy = false;
  updateControls();
  notice(message);
}
function showServices() {
  $('services').replaceChildren();
  for (const [key, label] of Object.entries(labels)) {
    const item = document.createElement('li');
    const name = document.createElement('span');
    const state = document.createElement('span');
    name.textContent = label;
    state.className = 'service-state';
    state.textContent = services[key] ? '設定済み / 接続未確認' : '未設定';
    state.dataset.ready = String(services[key]);
    item.append(name, state);
    $('services').append(item);
  }
}
async function loadStatus() {
  const request = statusSession.begin();
  services = null; experience.setServices(null); advice.setServices(null);
  checking = true;
  updateControls();
  $('services').textContent = 'サーバーを確認中…';
  notice('接続設定を確認しています…');
  try {
    const {response, data} = await fetchJson('/api/status', { cache: 'no-store', signal: request.signal }, 8000);
    if (!request.isCurrent()) return;
    if (!response.ok || data.mode !== 'live' || !data.services ||
        !Object.keys(labels).every(key => typeof data.services[key] === 'boolean')) throw new Error('Invalid status');
    configureAccess(data.auth);
    services = data.services; experience.setServices(services, data.plannerProvider); advice.setServices(services);
    showServices();
    // A changed identity can synchronously stop this status owner. Render the
    // committed service state even when that stop made finally non-current.
    updateControls();
    notice(services.access && services.sky
      ? '場所を決めて、送信に同意したら「この場所の星座を探す」を押してください。'
      : '星座を探す接続の準備ができていません。接続状況を確認してください。');
  } catch {
    if (!request.isCurrent()) return;
    $('services').textContent = 'サーバーの状態を取得できません。';
    notice('サーバーに接続できません。「再確認」で試し直してください。', 'error');
  } finally {
    if (request.isCurrent()) { checking = false; updateControls(); }
  }
}
function selectConstellation(row, button) {
  experience.select(row, observation);
  for (const card of $('constellations').children) card.setAttribute('aria-pressed', String(card === button));
  $('detail').hidden = false;
  $('detail-english').textContent = row.englishName || '';
  $('detail-name').textContent = row.name;
  $('detail-angles').textContent = '代表位置：方位 ' + row.azimuthDeg.toFixed(1) + '° / 高度 ' + row.altitudeDeg.toFixed(1) + '°' + (row.altitudeDeg < 0 ? '（地平線下）' : '');
  $('detail-description').textContent = row.description || row.summary || 'この星座の説明は取得されませんでした。';
  $('detail-story').textContent = row.story || '';
  $('story-section').hidden = !row.story;
  $('story-section').open = false;
}
function renderSky(data) {
  const rows = skyRows(data);
  $('count').textContent = rows.length + ' 星座';
  $('empty').hidden = rows.length > 0;
  if (!rows.length) {
    $('empty-title').textContent = '今回は星座が見つかりませんでした。';
    $('empty-help').textContent = '場所の入力を確認するか、時間をおいてもう一度探してください。';
    notice('接続成功。今回の条件では星座が返されませんでした。場所を確認するか、時間をおいてもう一度探してください。', 'success');
    return;
  }
  for (const row of rows) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'star-card';
    button.dataset.skyId = row.id;
    button.dataset.azimuth = String(row.azimuthDeg);
    button.dataset.altitude = String(row.altitudeDeg);
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-controls', 'detail');
    const name = document.createElement('strong');
    name.textContent = row.name;
    const position = document.createElement('small');
    position.textContent = '方位 ' + row.azimuthDeg.toFixed(1) + '° · 高度 ' + row.altitudeDeg.toFixed(1) + '°' + (row.altitudeDeg < 0 ? ' / 地平線下' : '');
    button.append(name, position);
    button.addEventListener('click', () => selectConstellation(row, button));
    $('constellations').append(button);
  }
  selectConstellation(rows[0], $('constellations').firstElementChild);
  notice('星APIに接続しました。' + rows.length + '件から、気になる星座を選んでください。最初は一番高い空の星座を選んでいます。', 'success');
}
async function call(path, body) {
  const token = $('token').value;
  if (!hasAccess(token)) { notice('ゲストとしてはじめるか、アカウントでログインしてください。開発環境ではアクセストークンを入力してください。', 'error'); return; }
  const request = session.begin();
  const focused = document.activeElement;
  const ownsFocus = path === '/api/sky' && !studio && $('sky-form').contains(focused);
  let focusTarget = $('sky'), phase = 'auth';
  busy = true;
  if (path === '/api/sky') clearResults();
  else $('result').textContent = 'Jevへの接続を確認中です。';
  updateControls();
  notice('参加の認証情報を確認しています…');
  try {
    const headers = await requestHeaders(token,request.signal);
    if (!request.isCurrent()) return;
    phase = 'api';
    notice(path === '/api/sky' ? '星をみるひとAPIから星座を取得しています…' : 'Jevへの接続を確認しています…');
    const {response, data} = await fetchJson(path, {
      method: 'POST', headers,
      body: JSON.stringify(body), signal: request.signal
    }, 45000);
    if (!request.isCurrent()) return;
    if (!response.ok) {
      const code = typeof data?.code === 'string' && Object.hasOwn(errors, data.code) ? data.code : 'request_failed';
      notice(code === 'request_failed' ? '接続に失敗しました。時間をおいて再試行してください。' : errors[code], 'error');
      $('result').textContent = 'HTTP ' + response.status + ' / ' + code;
      return;
    }
    let result = data;
    if (path === '/api/sky') {
      observation = { ...body }; renderSky(data);
      focusTarget = $('constellations').firstElementChild || $('sky');
    } else {
      result = validateAdvice(data);
      notice('Jevへの接続を確認しました。結果は開発用の接続確認に表示しています。身体誘導には使っていません。', 'success');
    }
    $('result').textContent = JSON.stringify(result, null, 2);
  } catch (error) {
    if (!request.isCurrent()) return;
    if (path === '/api/sky') clearResults();
    else $('result').textContent = 'Jevの応答を確認できませんでした。';
    notice(error?.name === 'TimeoutError'
      ? phase === 'auth' ? '参加の認証情報を時間内に確認できませんでした。もう一度試してください。' : 'APIの応答が時間内に届きませんでした。再試行してください。'
      : '通信または応答の確認に失敗しました。再試行してください。', 'error');
  } finally {
    if (request.isCurrent()) {
      const restoreFocus = ownsFocus && [document.body, focused].includes(document.activeElement);
      busy = false; updateControls();
      if (restoreFocus && !focusTarget.disabled && focusTarget.getClientRects().length) focusTarget.focus({preventScroll:true});
    }
  }
}
$('sky-form').addEventListener('submit', event => {
  event.preventDefault();
  if (busy || document.hidden || !$('consent').checked || !services?.access || !services?.sky) return;
  let coordinates;
  try { coordinates = parseCoordinates($('lat').value, $('lng').value); }
  catch (error) { notice(error.message, 'error'); return; }
  call('/api/sky', coordinates);
});
$('jev').addEventListener('click', () => {
  if (!busy && !document.hidden && services?.access && services?.reflex) call('/api/reflex', { dx: 0.1, dy: 0, tracked: true });
});
function invalidateSearch(message) {
  session.cancel(); clearResults(); busy = false; updateControls();
  if (!checking) notice(message);
}
for (const id of ['lat', 'lng', 'token']) $(id).addEventListener('input', () => invalidateSearch(id === 'token'
  ? '認証情報を変更しました。場所と送信への同意を確認して、もう一度星座を探してください。'
  : '場所を変更しました。入力を確認して、もう一度星座を探してください。'));
$('consent').addEventListener('change', () => { if (!$('consent').checked) invalidateSearch('位置送信への同意を取り消しました。検索するには、内容を確認して同意を選んでください。'); });
$('stop').addEventListener('click', () => stop());
$('camera-start').addEventListener('click', () => {
  // An explicit new camera attempt dismisses the previous drawing failure.
  if ($('trace-notice').dataset.state === 'error') trace.reset();
});
$('refresh').addEventListener('click', () => loadStatus());
document.addEventListener('keydown', event => { if (event.key === 'Escape') stop(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) stop('画面が非表示になったため通信とカメラを停止しました。', 'hidden'); });
window.addEventListener('pagehide', () => { session.cancel(); statusSession.cancel(); $('token').value = ''; });
// pagehide disposes the sensor/render owners. A cached document cannot reuse them.
window.addEventListener('pageshow', event => { if (event.persisted) window.location.reload(); });
mountAccess(document,()=>{stop('ログイン状態が変わりました。体験を準備し直してください。');clearResults();});
location = mountLocation(document,window);
mountPlayGuide(document,window,{hasAccess:()=>hasAccess($('token').value)});
studio = mountStudio(document,window,{hasAccess:()=>hasAccess($('token').value)});
loadStatus();

