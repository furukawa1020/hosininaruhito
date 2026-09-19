import './style.css';
import { mountCamera } from './camera-view.js';
import { RequestSession, parseCoordinates } from './requests.js';

const $ = id => document.getElementById(id);
const session = new RequestSession();
const camera = mountCamera(document, window);
let services = null;
let busy = false;
const labels = { access: '開発アクセス認証', sky: '星をみるひとAPI', reflex: 'Jev / 助言', planner: 'Codex / 振付' };
const errors = {
  not_configured: 'サーバーの接続設定が不足しています。「接続の準備」を確認してください。',
  unauthorized: '開発アクセストークンが一致しません。入力を確認してください。',
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
  $('controls').disabled = busy;
  $('refresh').disabled = busy;
  $('sky').disabled = busy || !(services?.access && services?.sky);
  $('jev').disabled = busy || !(services?.access && services?.reflex);
}
function clearResults() {
  $('constellations').replaceChildren();
  $('detail').hidden = true;
  $('empty').hidden = false;
  $('count').textContent = 'AWAITING OBSERVATION';
  $('result').textContent = '実APIの応答をここに表示します。';
}
function stop(message = '通信とカメラを停止しました。再開するには、もう一度操作してください。', cameraReason = 'manual') {
  camera.stop(cameraReason);
  session.cancel();
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
  const request = session.begin();
  services = null;
  busy = true;
  updateControls();
  $('services').textContent = 'サーバーを確認中…';
  try {
    const response = await fetch('/api/status', { cache: 'no-store', signal: AbortSignal.any([request.signal, AbortSignal.timeout(8000)]) });
    const data = await response.json();
    if (!request.isCurrent()) return;
    if (!response.ok || data.mode !== 'live' || !data.services ||
        !Object.keys(labels).every(key => typeof data.services[key] === 'boolean')) throw new Error('Invalid status');
    services = data.services;
    showServices();
    notice(services.access && services.sky
      ? '星APIの設定を確認しました。観測地点を入力して接続してください。'
      : '星APIへの接続には、サーバーの HCR_ACCESS_TOKEN と HOSHIMIRU_API_TOKEN を設定してください。');
  } catch {
    if (!request.isCurrent()) return;
    $('services').textContent = 'サーバーの状態を取得できません。';
    notice('サーバーに接続できません。「再確認」で試し直してください。', 'error');
  } finally {
    if (request.isCurrent()) { busy = false; updateControls(); }
  }
}
function selectConstellation(row, button) {
  for (const card of $('constellations').children) card.setAttribute('aria-pressed', String(card === button));
  $('detail').hidden = false;
  $('detail-english').textContent = row.englishName || 'CONSTELLATION / ' + row.id;
  $('detail-name').textContent = row.name;
  $('detail-angles').textContent = '方位 ' + row.azimuthDeg.toFixed(1) + '° / 高度 ' + row.altitudeDeg.toFixed(1) + '°';
  $('detail-description').textContent = row.description || row.summary || 'この星座の説明は取得されませんでした。';
  $('detail-story').textContent = row.story || '';
  $('story-section').hidden = !row.story;
  $('story-section').open = false;
}
function renderSky(data) {
  if (data.source !== 'hoshimiru-live' || !Array.isArray(data.constellations)) throw new Error('Invalid sky response');
  const rows = [...data.constellations].sort((a, b) => b.altitudeDeg - a.altitudeDeg);
  $('count').textContent = rows.length + ' CONSTELLATIONS';
  $('empty').hidden = rows.length > 0;
  if (!rows.length) {
    notice('接続成功。今回の条件では星座が返されませんでした。', 'success');
    return;
  }
  for (const row of rows) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'star-card';
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
  notice('星APIに接続しました。' + rows.length + '件の星座を高度順に表示しています。日時はAPIの既定値です。', 'success');
}
async function call(path, body) {
  const token = $('token').value;
  if (!token.trim()) { notice('開発アクセストークンを入力してください。', 'error'); $('token').focus(); return; }
  const request = session.begin();
  busy = true;
  clearResults();
  updateControls();
  notice('実APIに接続しています…');
  try {
    const response = await fetch(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
      body: JSON.stringify(body), signal: AbortSignal.any([request.signal, AbortSignal.timeout(45000)])
    });
    const data = await response.json();
    if (!request.isCurrent()) return;
    if (!response.ok) {
      notice(errors[data.code] || '接続に失敗しました。サーバーの設定を確認してください。', 'error');
      $('result').textContent = 'HTTP ' + response.status + ' / ' + (data.code || 'request_failed');
      return;
    }
    if (path === '/api/sky') renderSky(data);
    else notice('Jevへの接続を確認しました。結果は開発用の接続確認に表示しています。身体誘導には使っていません。', 'success');
    $('result').textContent = JSON.stringify(data, null, 2);
  } catch (error) {
    if (!request.isCurrent()) return;
    notice(error.name === 'TimeoutError' ? '応答が時間内に届きませんでした。再試行してください。' : '通信または応答の確認に失敗しました。再試行してください。', 'error');
  } finally {
    if (request.isCurrent()) { busy = false; updateControls(); }
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
$('stop').addEventListener('click', () => stop());
$('refresh').addEventListener('click', () => loadStatus());
document.addEventListener('keydown', event => { if (event.key === 'Escape') stop(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) stop('画面が非表示になったため通信とカメラを停止しました。', 'hidden'); });
window.addEventListener('pagehide', () => { session.cancel(); $('token').value = ''; });
loadStatus();

