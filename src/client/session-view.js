import { prepareSession } from '../core/session.js';
import { RequestSession } from './requests.js';

export function mountSession(document, window, { reach, trace }) {
  const $ = id => document.getElementById(id);
  const requests = new RequestSession();
  let selected = null, pending = false, disposed = false;
  const messages = {
    invalid_projection: '投影データを確認できませんでした。',
    below_horizon: '計算時刻では、この星座の星は地平線下です。',
    insufficient_stars: '投影できる星が2個未満です。',
    undefined_center: 'この星座の投影中心を決められません。',
    zenith_center: '天頂付近のため、この方法では投影できません。',
    degenerate_projection: '星を区別できる形に投影できません。',
    too_many_stars: '対象が12個を超えています。現在はこの星座を扱えません。',
    too_close: '目標が近すぎて区別できません。別の星座を選べます。',
    overlapping_stars: '星の位置が重なり、区別できません。',
    unobserved_targets: '記録した動きから、各目標付近を通ったことを確認できません。無理に手を伸ばさず、別の星座を選ぶか楽な範囲で計測し直してください。',
    invalid_calibration: '動かせる範囲を計測し直してください。',
    narrow_range: '配置に使える広さを確認できませんでした。無理に広げず中断できます。',
    unauthorized: '開発アクセストークンを確認してください。',
    busy: 'サーバーが処理中です。少し待ってから試してください。',
    not_configured: 'サーバーの設定が不足しています。',
    catalog_unavailable: '恒星カタログを利用できません。'
  };
  const say = (text, state) => {
    $('session-notice').textContent = text;
    $('session-notice').dataset.state = state;
  };
  const render = () => {
    $('session-prepare').disabled = disposed || pending || !selected || !reach.ready() ||
      document.hidden || !$('consent').checked || !$('camera-consent').checked;
    $('session-selection').textContent = selected ? selected.name + ' / 星をみるひとAPIから選択' : '先に星APIで星座を選んでください。';
  };
  const invalidate = (message = '条件が変わりました。配置を準備し直してください。', clear = false) => {
    requests.cancel(); pending = false;
    trace.invalidateProgram();
    if (clear) selected = null;
    say(message, 'idle'); render();
  };
  const prepare = async () => {
    if ($('session-prepare').disabled || !selected) return;
    const token = $('token').value;
    if (!token.trim()) { say('開発アクセストークンを入力してください。', 'error'); return; }
    const calibration = reach.result();
    if (!calibration) return;
    const request = requests.begin();
    const input = { id: selected.id, ...selected.coordinates, at: new Date().toISOString() };
    pending = true; trace.configureProgram(null); render();
    say('恒星カタログを計算し、記録した範囲への配置を確認しています…', 'loading');
    try {
      const response = await fetch('/api/project', {
        method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
        body: JSON.stringify(input), signal: AbortSignal.any([request.signal, AbortSignal.timeout(15000)])
      });
      const data = await response.json();
      if (!request.isCurrent()) return;
      if (!response.ok) throw new Error(messages[data.code] || '投影を取得できませんでした。');
      if (!reach.ready() || document.hidden || !$('consent').checked || !$('camera-consent').checked) {
        invalidate(); return;
      }
      const fitted = prepareSession(data, input, calibration);
      if (!fitted.ok) throw new Error(messages[fitted.reason] || '記録した範囲へ配置できませんでした。');
      trace.configureProgram(fitted);
      say('配置を準備しました。' + fitted.program.steps.length + '個の星 / 倍率 ' + fitted.scale.toFixed(2) +
        ' / 対象外 ' + fitted.excluded + '個。計算時刻 ' + fitted.at +
        '。星APIの観測時刻との一致は未確認です。カタログ順で実行し、AIの振付はまだ使用しません。', 'ready');
    } catch (error) {
      if (request.isCurrent()) say(error.name === 'TimeoutError' ? '投影の取得が時間内に終わりませんでした。' :
        messages[error.message] || (error.name === 'Error' ? error.message : '投影の通信に失敗しました。'), 'error');
    } finally { if (request.isCurrent()) { pending = false; render(); } }
  };
  const consent = () => { if (!$('consent').checked) invalidate('位置送信の同意を外したため、星座選択を解除しました。', true); };
  const cameraConsent = () => { if (!$('camera-consent').checked) invalidate('撮影の同意を外しました。'); };
  const clear = () => { invalidate('配置と星の記録を消去しました。'); trace.configureProgram(null); };
  const handlers = [['session-prepare','click',prepare],['session-clear','click',clear],['trace-clear','click',clear],
    ['consent','change',consent],['camera-consent','change',cameraConsent]];
  for (const [id, event, fn] of handlers) $(id).addEventListener(event,fn);
  render();
  const dispose = () => { disposed = true; invalidate('', true); for (const [id,event,fn] of handlers) $(id).removeEventListener(event,fn); };
  window.addEventListener('pagehide',dispose,{once:true});
  return {
    select(row, coordinates) {
      invalidate(); trace.configureProgram(null);
      selected = row && coordinates ? { id: row.id, name: row.name, coordinates: { ...coordinates } } : null;
      render();
    },
    reachChanged() { invalidate('計測が変わりました。範囲を確定したら配置を準備してください。'); },
    refresh: render,
    stop() { invalidate('停止しました。計測と配置を準備し直してください。'); },
    clearSelection() { invalidate('星APIで星座を選び直してください。', true); trace.configureProgram(null); }
  };
}
