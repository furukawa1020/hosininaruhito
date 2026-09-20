import { CameraSession } from './camera.js';

const messages = {
  idle: 'カメラは停止しています。撮影への同意後、自分で開始できます。',
  requesting: 'ブラウザのカメラ許可を確認してください。',
  preview: 'プレビュー中。映像はこの画面だけで表示し、送信・保存しません。',
  manual: 'カメラを停止しました。再開するには開始ボタンを押してください。',
  hidden: '画面が非表示になったためカメラを停止しました。',
  consent: '撮影への同意が必要です。位置情報の送信同意とは別です。',
  withdrawn: '撮影への同意を取り消したためカメラを停止しました。',
  pagehide: 'ページを離れたためカメラを停止しました。撮影にはもう一度同意してください。',
  denied: 'カメラへのアクセスが許可されませんでした。ブラウザのサイト設定を確認してから再試行してください。',
  missing: 'カメラが見つかりません。接続を確認してください。',
  unavailable: 'カメラを開始できません。他のアプリでの使用状況や機器の状態を確認してください。',
  disconnected: 'カメラの接続が終了しました。接続を確認してから再開してください。',
  interrupted: 'カメラの映像が途切れたため停止しました。状態を確認してから再開してください。',
  unsupported: 'この環境ではカメラを利用できません。対応ブラウザでHTTPSまたはlocalhostを開いてください。',
  failed: 'カメラの映像を表示できませんでした。設定を確認して再試行してください。'
};

export function mountCamera(document, window, { onChange = () => {} } = {}) {
  const $ = id => document.getElementById(id);
  const consent = $('camera-consent');
  const start = $('camera-start');
  const render = state => {
    start.disabled = !consent.checked || state.pending || state.state === 'preview' || document.hidden;
    $('camera-notice').textContent = (messages[state.reason] || messages.manual) +
      (state.pending && state.state !== 'requesting'
        ? ' 許可要求が残っている場合はブラウザで閉じてください。返ってきた映像も直ちに停止します。' : '');
    $('camera-notice').dataset.state = state.state;
    $('camera-video').hidden = state.state !== 'preview';
    $('camera-placeholder').hidden = state.state === 'preview';
    onChange(state);
    $('camera-badge').textContent = state.state === 'preview' ? '撮影中 / ローカル表示' : 'カメラ停止';
  };
  const camera = new CameraSession({
    video: $('camera-video'), mediaDevices: window.navigator.mediaDevices,
    isVisible: () => !document.hidden, isSecure: () => window.isSecureContext, onChange: render
  });
  const events = [];
  const listen = (target, name, handler) => {
    target.addEventListener(name, handler);
    events.push(() => target.removeEventListener(name, handler));
  };
  listen(start, 'click', () => camera.start({ consent: consent.checked }));
  listen(consent, 'change', () => {
    if (!consent.checked) camera.stop('withdrawn');
    render(camera.snapshot());
  });
  listen(document, 'visibilitychange', () => {
    if (document.hidden) camera.stop('hidden');
    render(camera.snapshot());
  });
  listen(window, 'pagehide', () => { consent.checked = false; camera.stop('pagehide'); });
  listen(window, 'pageshow', () => render(camera.snapshot()));
  render(camera.snapshot());
  return {
    stop: reason => camera.stop(reason),
    dispose: () => { for (const remove of events) remove(); camera.dispose(); }
  };
}
