import {mountGameMenu} from './game-menu.js';
// A presentation layer over the existing controls. It never supplies sensor samples.
export function mountStudio(document, window, { hasAccess }) {
  if (new URLSearchParams(window.location.search).get('view') === 'details') return null;
  const $ = id => document.getElementById(id);
  const root = document.createElement('section');
  root.id = 'studio';
  root.setAttribute('aria-label', '星座をつくる');
  root.innerHTML = `
    <div class="studio-bar"><span id="studio-selection">手を動かして、星座をつくる</span><button id="studio-settings" class="text-button" type="button">星座・設定</button></div>
    <div class="studio-layout">
      <div class="studio-view"><div id="game-welcome-dome"></div>
        <div id="studio-surface"></div>
        <div id="studio-example" class="studio-example">
          <svg viewBox="0 0 560 400" role="img" aria-labelledby="studio-example-title">
            <title id="studio-example-title">映り方の例。座って、顔・肩・ひじ・両手首をカメラへ。</title>
            <g fill="none" stroke="#e9e3d1" stroke-width="4" stroke-linecap="round" stroke-linejoin="round">
              <ellipse cx="280" cy="90" rx="38" ry="46"/>
              <path d="M251 127 247 152 207 170 178 269 202 296 230 218M309 127 313 152 353 170 382 269 358 296 330 218M235 167 230 344M325 167 330 344M230 344 330 344"/>
              <path d="M202 296 231 209M358 296 329 209" stroke="#e7bd6d" stroke-width="9"/>
              <path d="M224 213 221 187Q221 180 227 184L233 197 233 169Q236 161 240 170L241 195 247 182Q253 179 253 186L246 211M336 213 339 187Q339 180 333 184L327 197 327 169Q324 161 320 170L319 195 313 182Q307 179 307 186L314 211"/>
            </g>
            <g fill="#e7bd6d"><circle cx="232" cy="215" r="9"/><circle cx="328" cy="215" r="9"/></g>
            <g fill="#eee8d6" font-size="21" font-family="sans-serif"><text x="44" y="90">顔を映す</text><text x="358" y="214">両手は胸の前</text><text x="162" y="386">座ったままで大丈夫</text></g>
            <path d="M137 84H228M342 207H353" stroke="#c2bda9" fill="none"/>
          </svg>
          <span>映り方の例</span>
        </div>
        <div class="studio-view-footer"><span id="studio-camera-label">まだ撮影していません</span><span>鏡と同じ向き</span></div>
      </div>
      <aside class="studio-coach">
        <p id="studio-step" class="studio-step">手でつくる、今夜の星座</p>
        <h1 id="studio-title">その手で、<br>星をつなごう。</h1>
        <p id="studio-instruction"></p>
        <div id="studio-consent"></div>
        <div id="studio-options"></div>
        <div id="studio-movement" hidden aria-label="動かし方の例">
          <svg viewBox="0 0 280 76" aria-hidden="true"><path d="M35 48Q55 8 78 43T124 35T171 43T222 30" fill="none" stroke="currentColor" stroke-width="3" stroke-dasharray="5 7"/><circle class="demo-hand" cx="35" cy="48" r="9" fill="currentColor"/><path d="m212 24 16 2-6 16" fill="none" stroke="currentColor" stroke-width="3"/></svg>
          <span>動かし方の例。小さな範囲で、ゆっくり。</span>
        </div>
        <div id="studio-progress" hidden><div><span id="studio-progress-label"></span><strong id="studio-progress-value"></strong></div><progress id="studio-meter" max="1" value="0" aria-label="準備の進み具合"></progress></div>
        <p id="studio-status" role="status" aria-live="polite"></p>
        <div class="studio-actions"><button id="studio-action" class="primary" type="button"></button><button id="studio-practice" class="text-button" type="button">先にカメラだけ試す</button></div>
        <p class="studio-comfort">手は楽な高さで。つらいときは右上の「停止」。</p>
      </aside>
    </div>
    <dialog id="studio-dialog" aria-labelledby="studio-dialog-title"></dialog>`;
  document.body.append(root);
  document.body.classList.add('studio-open');
  const move = (node, parent) => $(parent).append(node);
  const cameraFrame = document.querySelector('.camera-frame');
  move(cameraFrame, 'studio-surface');
  cameraFrame.append($('trace-stage'));
  move($('camera-consent').closest('label'), 'studio-consent');
  move(document.querySelector('.reach-options'), 'studio-options');
  // Copy does not control access: the original consent and handlers are retained.
  $('camera-consent').closest('label').querySelector('span').textContent = 'カメラを使うことに同意します。映像は端末内だけで処理し、保存・送信しません。';
  let attempted = false, practice = false, action = null, latestTrace = null, disposed = false;
  const state = id => $(id).dataset.state;
  const say = (id, text) => { if ($(id).textContent !== text) $(id).textContent = text; };
  function fit() {
    const bounds = $('studio-surface').getBoundingClientRect();
    const video = $('camera-video');
    const ratio = video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 4 / 3;
    const width = Math.max(0, Math.min(bounds.width, bounds.height * ratio));
    cameraFrame.style.width = width + 'px'; cameraFrame.style.height = width / ratio + 'px';
  }
  const menu = mountGameMenu(document, window, {hasAccess, render, stop: () => $('stop').click()});
  function openSetup() { menu.open(); }
  function render() {
    if (disposed) return;
    const cam = state('camera-notice'), pose = state('pose-notice'), reach = state('reach-notice'), session = state('session-notice'), trace = state('trace-notice');
    const selected = !$('detail').hidden;
    const hand = $('reach-joint').value === 'leftWrist' ? '左手' : '右手';
    let phase = 'welcome', title = 'その手で、\n星をつなごう。', instruction = '画面の輪に、手首の光を重ねる。少し止めると、そこに星が残ります。',
      button = '星座を選んではじめる', target = 'setup', status = '', step = '手でつくる、今夜の星座';
    if (selected || practice) {
      phase = 'camera'; title = '両手を、胸の前に。'; instruction = '座ったままで大丈夫。顔・肩・ひじ・両手首が映るように、カメラを置いてください。';
      target = 'camera-start'; button = 'カメラをつける'; step = 'まず、手を映す';
      status = ['error','paused','requesting'].includes(cam) ? $('camera-notice').textContent : '';
      if (cam === 'preview') {
        phase = 'pose'; target = 'pose-start'; button = attempted && (pose === 'paused' || pose === 'error') ? 'もう一度、手を見つける' : '手を見つける';
        title = '両手首を映してください。'; instruction = '机より上に、両手を軽く上げます。手首に色の点がつけば準備できます。';
        status = $('pose-notice').textContent;
        if (pose === 'loading' || pose === 'searching') { button = '手を探しています…'; }
        if (pose === 'tracking') {
          phase = 'reach'; title = hand + 'を動かす準備。'; step = '次に、動かせる範囲を教える';
          instruction = '始めたら、胸の前で' + hand + 'をゆっくり上下・左右へ。反対の手も映したままにします。';
          target = 'reach-start'; button = '動かせる範囲を教える';
          status = ['paused','error'].includes(reach) ? $('reach-notice').textContent : '';
          if (reach === 'collecting') {
            phase = 'collecting'; title = hand + 'で、小さく上下・左右。';
            instruction = '塗るように、ゆっくり動かしてください。腕は伸ばしきらなくて大丈夫。';
            target = 'reach-finish'; button = 'この範囲で遊ぶ';
            status = $('reach-progress').textContent;
          }
          if (reach === 'ready') {
            phase = 'arrange'; title = selected ? '手の準備ができました。' : 'つくる星座を選ぼう。';
            step = 'いよいよ、星をつなぐ'; instruction = '両手を映したまま、楽な姿勢で。あなたが動かした範囲に星を置きます。';
            target = selected ? 'session-prepare' : 'setup'; button = selected ? 'この範囲に星を置く' : '星座を選ぶ';
            if (session === 'loading') button = '星を準備しています…';
            if (session === 'error') status = $('session-notice').textContent;
            if (session === 'ready') {
              phase = 'ready'; title = '輪に、' + hand + 'の光を重ねる。'; instruction = '輪に重なったら、0.8秒そのまま。星が残ったら、次の輪へ進みます。';
              target = 'trace-start'; button = '星をつなぎはじめる';
              if (trace === 'running') {
                phase = 'running'; target = null; button = '';
                title = hand + 'の光を、輪の中へ。'; instruction = '動かすのは' + hand + 'だけ。反対の手は映したまま、楽な位置に。';
                if (latestTrace?.state === 'running' && latestTrace.current && latestTrace.activeTarget) {
                  if (latestTrace.holdProgress > 0) { title = 'そこで、ひと呼吸。'; instruction = 'そのまま。輪が満ちると星になります。'; }
                  else {
                    const dx = latestTrace.current.x - latestTrace.activeTarget.target.x;
                    const dy = latestTrace.activeTarget.target.y - latestTrace.current.y;
                    title = hand + 'を、\n画面の' + (Math.abs(dx) > Math.abs(dy) ? dx > 0 ? '右へ →' : '左へ ←' : dy > 0 ? '下へ ↓' : '上へ ↑');
                  }
                  status = 'つないだ星 ' + latestTrace.captures.length + ' / ' + (latestTrace.captures.length + latestTrace.targets.length);
                }
              }
            }
          }
        }
      }
    }
    if (trace === 'complete') {
      phase = 'complete'; title = '星座が、できました。'; instruction = '手を止めた場所が、あなたの星座になりました。手を下ろして休んでください。';
      step = 'できあがり'; status = $('trace-count').textContent; target = 'trace-clear'; button = 'もう一度つくる';
    } else if (trace === 'error' && pose === 'tracking') {
      status = $('trace-notice').textContent;
    }
    if (root.dataset.phase !== phase) root.dataset.phase = phase;
    say('studio-title', title); say('studio-instruction', instruction); say('studio-step', step); say('studio-status', status);
    say('studio-selection', selected ? $('detail-name').textContent + 'をつくる' : '手を動かして、星座をつくる');
    say('studio-camera-label', cam === 'preview' ? 'カメラ使用中・映像はこの端末だけ' : 'カメラ停止中');
    $('studio-consent').hidden = phase !== 'camera';
    $('studio-options').hidden = phase !== 'reach';
    $('studio-example').hidden = phase !== 'camera';
    $('studio-movement').hidden = !['reach','collecting'].includes(phase);
    $('studio-practice').hidden = phase !== 'welcome';
    $('studio-action').hidden = !target;
    action = target;
    const elapsed = Number($('reach-notice').dataset.elapsed || 0), count = Number($('reach-notice').dataset.count || 0);
    const waiting = phase === 'collecting' && (elapsed < 3000 || count < 30);
    say('studio-action', waiting ? 'ゆっくり動かしてください…' : button);
    $('studio-action').disabled = target !== 'setup' && (!target || $(target).disabled || waiting);
    $('trace-stage').hidden = !['running','complete'].includes(phase);
    $('pose-overlay').classList.toggle('studio-muted', phase === 'running' || phase === 'complete');
    $('reach-overlay').classList.toggle('studio-muted', phase !== 'collecting');
    const progress = phase === 'collecting' ? Math.min(1,elapsed/3000) : phase === 'running' ? latestTrace?.holdProgress || 0 : null;
    $('studio-progress').hidden = progress === null;
    if (progress !== null) {
      $('studio-meter').value = progress;
      say('studio-progress-label', phase === 'collecting' ? '動かせる範囲を記録中' : '輪の中で、少し止める');
      say('studio-progress-value', phase === 'collecting' ? (elapsed/1000).toFixed(1) + '秒' : Math.round(progress*100) + '%');
    }
    menu.render();
  }
  $('studio-action').addEventListener('click', () => {
    if ($('studio-action').disabled) return;
    if (action === 'setup') openSetup();
    else if (action && !$(action).disabled) { if (action === 'pose-start') attempted = true; $(action).click(); }
  });
  $('studio-practice').addEventListener('click', () => { practice = true; render(); });
  $('studio-settings').addEventListener('click', openSetup);
  $('reach-joint').addEventListener('change', render);
  $('reach-posture').addEventListener('change', render);
  $('camera-consent').addEventListener('change', render);
  $('token').addEventListener('input', render);
  const observer = new window.MutationObserver(render);
  for (const id of ['camera-notice','pose-notice','reach-notice','reach-progress','session-notice','trace-notice','auth-notice','notice','detail-name','constellations']) observer.observe($(id), {attributes:true,childList:true,characterData:true,subtree:true});
  for (const id of ['camera-start','pose-start','reach-start','reach-finish','session-prepare','trace-start','trace-clear','detail']) observer.observe($(id), {attributes:true,attributeFilter:['disabled','hidden']});
  const resize = new window.ResizeObserver(fit); resize.observe($('studio-surface'));
  $('camera-video').addEventListener('loadedmetadata', fit);
  window.addEventListener('pagehide', () => { disposed = true; observer.disconnect(); resize.disconnect(); }, {once:true});
  render(); fit();
  return { onTrace(value) { latestTrace = value; render(); } };
}
