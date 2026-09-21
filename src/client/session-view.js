import { evaluatePlan, validatePlannedProgram } from '../core/planner.js';
import { prepareSession } from '../core/session.js';
import { RequestSession } from './requests.js';
import {hasAccess,requestHeaders} from './access.js';

export function mountSession(document, window, { reach, trace }) {
  const $ = id => document.getElementById(id);
  const requests = new RequestSession();
  let selected = null, pending = false, disposed = false, plannerAvailable = false;
  let plannerProvider = null;
  const plannerName = () => plannerProvider === 'vertex' ? 'Vertex AI' : 'Codex';
  const messages = {
    upstream_quota: 'AIサービスの課金・利用上限を確認してください。',
    planner_destination_changed: 'AIの送信先が変わりました。接続を再確認し、送信先への同意を選び直してください。',
    daily_limit: '本日の利用上限に達しました。日付がUTCで変わってから利用できます。',
    service_paused: '運営側で接続を停止しています。',
    planner_rejected: 'AIの提案が配置条件を満たしませんでした。配置は開始していません。',
    upstream_timeout: 'AIの計画が時間内に終わりませんでした。',
    planner_sandbox: 'サーバーの実行制限を確認できませんでした。',
    upstream_unavailable: 'AIに接続できませんでした。',
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
      ($('planner-consent').checked && !plannerAvailable) || document.hidden || !$('consent').checked || !$('camera-consent').checked;
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
    if (!hasAccess(token)) { say('ログインまたは開発アクセストークンが必要です。', 'error'); return; }
    const calibration = reach.result();
    if (!calibration) return;
    const request = requests.begin();
    const input = { id: selected.id, ...selected.coordinates, at: new Date().toISOString() };
    pending = true; trace.configureProgram(null); render();
    say('恒星カタログを計算し、記録した範囲への配置を確認しています…', 'loading');
    try {
      const response = await fetch('/api/project', {
        method: 'POST', headers: await requestHeaders(token,request.signal),
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
      const useAI = $('planner-consent').checked;
      if (useAI) {
        const expectedSource = plannerProvider + '-live';
        say(plannerName() + 'が星の順序を計画しています…', 'loading');
        const planned = await fetch('/api/program', {
          method: 'POST', headers: { ...await requestHeaders(token,request.signal), 'X-HCR-Planner': plannerProvider },
          body: JSON.stringify({ program: fitted.program }),
          signal: AbortSignal.any([request.signal, AbortSignal.timeout(45000)])
        });
        const candidate = await planned.json();
        if (!request.isCurrent()) return;
        if (!planned.ok) throw new Error(messages[candidate.code] || 'AIの計画を取得できませんでした。');
        if (!reach.ready() || document.hidden || !$('planner-consent').checked ||
            !$('consent').checked || !$('camera-consent').checked) { invalidate(); return; }
        try {
          const checked = validatePlannedProgram(fitted.program, candidate, expectedSource);
          if (!evaluatePlan(fitted.program, checked, expectedSource).ok) throw Error();
          fitted.program = checked;
        } catch { throw new Error('AIの応答が元の配置条件と一致しません。配置は開始していません。'); }
      }
      trace.configureProgram(fitted);
      say('配置を準備しました。' + fitted.program.steps.length + '個の星 / 倍率 ' + fitted.scale.toFixed(2) +
        ' / 対象外 ' + fitted.excluded + '個。計算時刻 ' + fitted.at +
        '。星APIの観測時刻との一致は未確認です。' + (useAI ? plannerName() + 'の順序を検証しました。保持の判定は実測値で行います。' : 'カタログ順で実行します。'), 'ready');
    } catch (error) {
      if (request.isCurrent()) say(error.name === 'TimeoutError' ? '投影の取得が時間内に終わりませんでした。' :
        messages[error.message] || (error.name === 'Error' ? error.message : '投影の通信に失敗しました。'), 'error');
    } finally { if (request.isCurrent()) { pending = false; render(); } }
  };
  const consent = () => { if (!$('consent').checked) invalidate('位置送信の同意を外したため、星座選択を解除しました。', true); };
  const cameraConsent = () => { if (!$('camera-consent').checked) invalidate('撮影の同意を外しました。'); };
  const clear = () => { invalidate('配置と星の記録を消去しました。'); trace.configureProgram(null); };
  const handlers = [['session-prepare','click',prepare],['session-clear','click',clear],['trace-clear','click',clear],
    ['planner-consent','change',()=>invalidate('計画方法が変わりました。配置を準備し直してください。')],
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
    setServices(services, provider) {
      const next = ['codex','vertex'].includes(provider) ? provider : null;
      plannerAvailable = Boolean(services?.access && services?.planner && next);
      if (next !== plannerProvider || !plannerAvailable) {
        const hadConsent = $('planner-consent').checked;
        $('planner-consent').checked = false;
        if (hadConsent) invalidate('AIの接続条件が変わりました。送信先を確認して配置を準備し直してください。');
      }
      plannerProvider = next;
      $('planner-destination').textContent = next === 'vertex' ? 'Google Cloud / Vertex AI' : next === 'codex' ? 'OpenAI / Codex' : '未確認のAIサービス（接続を再確認してください）';
      render();
    },
    refresh: render,
    stop() { invalidate('停止しました。計測と配置を準備し直してください。'); },
    clearSelection() { invalidate('星APIで星座を選び直してください。', true); trace.configureProgram(null); }
  };
}
