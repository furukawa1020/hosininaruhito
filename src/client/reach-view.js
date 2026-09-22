import { ReachCalibration } from '../core/reach.js';
import { isFreshPoseTime } from '../core/pose.js';

const messages = {
  idle: '手首の推定を始めてから、計測できます。',
  collecting: '選んだ手を、楽に動かせる小さな範囲でゆっくり動かしてください。いつでも中断できます。',
  ready: 'この姿勢での動きを一時的に記録しました。星座を選び、下の「配置を準備する」へ進めます。',
  manual: '計測を中断し、記録を消去しました。',
  changed: '姿勢・使う手を変更したため、記録を消去しました。',
  tracking_lost: '手首の推定が停止したため、記録を消去しました。再開後に計測し直してください。',
  stale_sample: '計測の更新が遅れたため、記録を消去しました。',
  frame_changed: '映像の大きさが変わったため、計測し直してください。',
  insufficient_samples: '計測がまだ短いため確定できません。3秒以上の連続した計測が必要です。',
  narrow_range: '配置に使える広さを確認できませんでした。無理に手を伸ばさず、中断するか楽な範囲で計測し直してください。',
  time_limit: '30秒を超えたため計測を中断し、記録を消去しました。',
  invalid_setup: '映像を確認してから計測を開始してください。'
};

export function mountReach(document, window, { onChange = () => {} } = {}) {
  const $ = id => document.getElementById(id);
  const video = $('camera-video');
  const calibration = new ReachCalibration();
  let lastFrame = null, published = null;
  const size = () => ({ width: video.videoWidth, height: video.videoHeight });
  const tracking = () => lastFrame && !document.hidden && isFreshPoseTime(lastFrame.at, window.performance.now());
  const render = () => {
    const snapshot = calibration.snapshot();
    if (published !== calibration.result) { published = calibration.result; onChange(); }
    $('reach-start').disabled = !tracking() || snapshot.state === 'collecting';
    $('reach-finish').disabled = snapshot.state !== 'collecting';
    $('reach-clear').disabled = !['collecting', 'ready'].includes(snapshot.state);
    $('reach-start').textContent = snapshot.state === 'ready' ? '計測をやり直す' : '楽に動かせる範囲を計測する';
    $('reach-notice').dataset.state = snapshot.state;
    $('reach-notice').dataset.reason = snapshot.reason;
    $('reach-notice').dataset.elapsed = String(snapshot.elapsedMs);
    $('reach-notice').dataset.count = String(snapshot.count);
    const message = messages[snapshot.reason] || messages.manual;
    // Avoid announcing every frame to screen readers.
    if ($('reach-notice').textContent !== message) $('reach-notice').textContent = message;
    $('reach-progress').textContent = snapshot.count ? (snapshot.elapsedMs / 1000).toFixed(1) + ' 秒の動きを記録' : '';
    const points = calibration.points;
    $('reach-overlay').toggleAttribute('hidden', !points.length);
    $('reach-overlay').setAttribute('viewBox', '0 0 ' + video.videoWidth + ' ' + video.videoHeight);
    $('reach-points').setAttribute('d', points.map(p => 'M' + ((1 - p.x) * video.videoWidth) + ',' + (p.y * video.videoHeight) + 'h0.01').join(' '));
  };
  const start = () => {
    if (!tracking() || calibration.state === 'collecting') return;
    calibration.start({ joint: $('reach-joint').value, posture: $('reach-posture').value, size: size() }, window.performance.now());
    render();
  };
  const finish = () => { calibration.finish(window.performance.now()); render(); };
  const clear = () => { calibration.clear(); render(); };
  const changed = () => { calibration.clear('changed'); render(); };
  const handlers = [['reach-start', 'click', start], ['reach-finish', 'click', finish], ['reach-clear', 'click', clear],
    ['reach-joint', 'change', changed], ['reach-posture', 'change', changed]];
  for (const [id, event, handler] of handlers) $(id).addEventListener(event, handler);
  render();
  return {
    ready: () => Boolean(calibration.result && tracking()),
    result: () => calibration.result && tracking() ? structuredClone(calibration.result) : null,
    onFrame(frame) {
      lastFrame = frame;
      if (!frame) {
        if (['collecting', 'ready'].includes(calibration.state)) calibration.clear('tracking_lost');
      } else if (calibration.options) {
        calibration.tick(frame.wrists[calibration.options.joint], window.performance.now(), size());
      }
      render();
    },
    dispose() {
      for (const [id, event, handler] of handlers) $(id).removeEventListener(event, handler);
      lastFrame = null;
      calibration.clear();
      render();
    }
  };
}
