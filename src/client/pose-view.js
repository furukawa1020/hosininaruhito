import { PoseSession } from './pose-session.js';

const messages = {
  idle: 'カメラを開始すると、端末内で手首の位置を確認できます。',
  loading: '手首を推定する準備をしています…',
  tracking: '両手首を推定中です。星座への誘導はまだ行いません。',
  manual: '手首の推定を停止しました。',
  camera_stopped: 'カメラが停止したため、手首の推定も停止しました。',
  hidden: '画面が非表示になったため推定を停止しました。',
  no_person: '人物を検出できず、推定を停止しました。映り方を確認して再開してください。',
  multiple_people: '複数の人物を検出したため推定を停止しました。一人で映る状態で再開してください。',
  occluded: '両手首を十分に確認できず、推定を停止しました。映り方を確認してください。',
  stale_pose: '映像の更新が遅れたため推定を停止しました。再開ボタンで試し直せます。',
  frame_gap: '新しい映像が届かないため推定を停止しました。',
  model_failed: '推定用ファイルを読み込めませんでした。接続を確認して再試行してください。',
  model_timeout: '推定の準備が時間内に完了しませんでした。再試行してください。',
  unsupported: 'このブラウザでは端末内の身体推定を開始できません。',
  inference_failed: '手首の推定に失敗したため停止しました。',
  invalid_pose: '手首の計測値を確認できないため停止しました。'
};

export function mountPose(document, window) {
  const $ = id => document.getElementById(id);
  const video = $('camera-video');
  let cameraReady = false;
  let pose;
  const render = state => {
    $('pose-start').disabled = !cameraReady || state.state === 'loading' || state.state === 'tracking' || document.hidden;
    $('pose-notice').dataset.state = state.state;
    $('pose-notice').dataset.reason = state.reason;
    $('pose-notice').textContent = messages[state.reason] || messages.manual;
  };
  const showSample = frame => {
    $('pose-overlay').toggleAttribute('hidden', !frame);
    $('pose-latency').textContent = frame ? '更新遅延 ' + Math.round(frame.latencyMs) + ' ms' : '';
    if (!frame) return;
    $('pose-overlay').setAttribute('viewBox', '0 0 ' + video.videoWidth + ' ' + video.videoHeight);
    for (const [joint, sample] of Object.entries(frame.wrists)) {
      const marker = $(joint === 'leftWrist' ? 'left-wrist' : 'right-wrist');
      // Match object-fit:contain with SVG's xMidYMid meet. Mirror display only.
      marker.setAttribute('cx', (1 - sample.x) * video.videoWidth);
      marker.setAttribute('cy', sample.y * video.videoHeight);
      marker.setAttribute('r', Math.max(6, video.videoWidth * 0.012));
    }
  };
  pose = new PoseSession({
    video, createWorker: () => new Worker(new URL('./pose-worker.js', import.meta.url), { type: 'module' }),
    isVisible: () => !document.hidden, onChange: render, onSample: showSample
  });
  const start = () => { if (cameraReady && !document.hidden) pose.start(); };
  $('pose-start').addEventListener('click', start);
  render(pose.snapshot());
  return {
    cameraChanged(state) {
      cameraReady = state.state === 'preview';
      if (!cameraReady && pose.active) pose.stop('camera_stopped');
      render(pose.snapshot());
    },
    stop: () => pose.stop(),
    dispose: () => { $('pose-start').removeEventListener('click', start); pose.dispose(); }
  };
}
