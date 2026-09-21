import { ConstellationTrace } from '../core/trace.js';
import { isFreshPoseTime } from '../core/pose.js';

export function mountTrace(document, window, { onFailure = () => {} } = {}) {
  const $ = id => document.getElementById(id);
  let trace = new ConstellationTrace(), renderer = null, lastFrame = null, dimensions = null;
  let generation = 0, loading = false, disposed = false, error = null;
  const tracking = () => !disposed && lastFrame && !document.hidden && $('camera-consent').checked && isFreshPoseTime(lastFrame.at, window.performance.now());
  const size = () => ({ width: $('camera-video').videoWidth, height: $('camera-video').videoHeight });
  const messages = {
    idle: '手首の推定を始めてから、光の軌跡を試せます。',
    running: '選んだ手の軌跡を表示しています。今の表示は動いた跡で、星座の確定ではありません。',
    paused: '軌跡を静止しました。再開すると古い軌跡を消して、新しく描き始めます。',
    complete: '保持した実測点がそろいました。',
    webgl_unavailable: 'この環境では光の描画を開始できません。描画は停止しています。',
    context_lost: '描画機能との接続が切れたため停止しました。再開するには、もう一度開始してください。',
    render_failed: '描画に失敗したため停止しました。',
    frame_changed: '映像の大きさが変わったため、軌跡を消去しました。'
  };
  const render = () => {
    const frame = trace.snapshot();
    $('trace-start').disabled = !tracking() || loading || frame.state === 'running';
    $('trace-start').textContent = frame.state === 'paused' || error ? '光の軌跡を再開する' : '光の軌跡を描く';
    $('trace-clear').disabled = !frame.trail.length && !frame.captures.length && !loading;
    $('trace-notice').dataset.state = error ? 'error' : frame.state;
    $('trace-notice').dataset.reason = error || frame.reason;
    const text = loading ? '光の描画を準備しています…' : messages[error || frame.state] || messages.paused;
    if ($('trace-notice').textContent !== text) $('trace-notice').textContent = text;
    $('trace-count').textContent = frame.trail.length + ' 点の軌跡 / 確定した星 ' + frame.captures.length;
    $('trace-empty').hidden = frame.trail.length > 0 || frame.captures.length > 0;
    renderer?.draw(frame);
  };
  const release = () => { renderer?.dispose(); renderer = null; };
  const stop = (reason = 'manual') => {
    generation++; loading = false; trace.stop(reason); render();
  };
  const reset = () => {
    generation++; loading = false; trace.reset(); error = null; dimensions = null;
    render(); release();
  };
  const fail = reason => {
    error = reason; stop(reason); release(); onFailure(reason);
  };
  const resize = () => {
    const canvas = $('trace-canvas'), bounds = canvas.getBoundingClientRect();
    renderer?.resize(bounds.width, bounds.height, window.devicePixelRatio);
  };
  const start = async () => {
    if (disposed || !tracking() || loading || trace.state === 'running') return;
    const ticket = ++generation;
    loading = true; error = null; render();
    try {
      const { TraceRenderer } = await import('./trace-renderer.js');
      if (ticket !== generation || disposed || !tracking()) return;
      release();
      // A deliberately lost WebGL context cannot be reused on the same canvas.
      const oldCanvas = $('trace-canvas');
      oldCanvas.replaceWith(oldCanvas.cloneNode(false));
      const candidate = new TraceRenderer($('trace-canvas'), { onFailure: fail });
      if (candidate.failed || candidate.disposed || ticket !== generation) { candidate.dispose(); return; }
      renderer = candidate;
      dimensions = size();
      $('trace-stage').style.aspectRatio = dimensions.width + ' / ' + dimensions.height;
      trace = new ConstellationTrace({ joint: $('trace-joint').value });
      trace.start(window.performance.now());
      resize();
    } catch { if (ticket === generation) fail('webgl_unavailable'); }
    finally {
      if (ticket === generation) { loading = false; render(); }
      // Tracking may disappear while the module is loading.
      else if (!disposed) render();
    }
  };
  const frame = value => {
    lastFrame = value;
    if (!value) { if (trace.state === 'running' || loading) stop('tracking_lost'); render(); return; }
    if (trace.state === 'running') {
      const current = size();
      if (current.width !== dimensions?.width || current.height !== dimensions?.height) {
        reset(); error = 'frame_changed';
      } else trace.tick(value.wrists[trace.joint], window.performance.now());
    }
    render();
  };
  const changed = () => reset();
  const consent = () => { if (!$('camera-consent').checked) reset(); };
  const handlers = [['trace-start', 'click', start], ['trace-clear', 'click', reset],
    ['trace-joint', 'change', changed], ['camera-consent', 'change', consent]];
  for (const [id, event, handler] of handlers) $(id).addEventListener(event, handler);
  const observer = new window.ResizeObserver(resize);
  observer.observe($('trace-stage'));
  window.addEventListener('resize', resize);
  const timer = window.setInterval(() => {
    if (trace.state === 'running') { trace.watch(window.performance.now()); if (trace.state !== 'running') render(); }
  }, 50);
  const dispose = () => {
    if (disposed) return;
    disposed = true; reset(); lastFrame = null;
    window.clearInterval(timer); observer.disconnect();
    window.removeEventListener('resize', resize);
    window.removeEventListener('pagehide', dispose);
    for (const [id, event, handler] of handlers) $(id).removeEventListener(event, handler);
  };
  window.addEventListener('pagehide', dispose);
  render();
  return { onFrame: frame, stop, reset, dispose };
}
