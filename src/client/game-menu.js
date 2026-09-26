import {mountSkyDome} from './sky-dome.js';

// Page navigation only. Auth, location, consent and star selection retain their
// existing controls and event handlers; no network requests originate here.
export function mountGameMenu(document, window, {hasAccess, render, stop}) {
  const $=id=>document.getElementById(id), dialog=$('studio-dialog');
  dialog.innerHTML=`
    <header><button id="studio-back" class="game-back" type="button">← 戻る</button><ol class="game-route" aria-label="準備の順番"><li>参加</li><li>場所</li><li>星座</li></ol><button id="studio-close" type="button">■ 停止して閉じる</button></header>
    <div class="game-menu-layout">
      <div id="game-dome-slot"><div id="game-dome"><div id="game-sphere"></div><p id="game-dome-caption">空を回して、今夜の星座を探そう。</p><button id="game-center" class="text-button" type="button">向きを戻す ↺</button></div></div>
      <section class="game-page" aria-labelledby="studio-dialog-title">
        <h2 id="studio-dialog-title" tabindex="-1"></h2>
        <div id="studio-access"></div>
        <div id="studio-location"></div>
        <div id="studio-stars"></div>
        <div id="game-account" hidden></div>
        <div id="game-settings" hidden><div id="studio-ai"></div><p>AIは星をたどる順序を考えます。映像や身体の記録は送りません。</p><div id="game-reconnect"></div></div>
        <div id="game-reading" hidden><p id="game-reading-text"></p><div class="game-pager"><button id="game-text-prev" type="button" aria-label="前の説明">←</button><span id="game-text-count"></span><button id="game-text-next" type="button" aria-label="次の説明">→</button></div></div>
        <div id="game-star-pager" class="game-pager"><button id="game-prev" type="button" aria-label="前の星座">←</button><span id="game-page-count"></span><button id="game-next" type="button" aria-label="次の星座">→</button></div>
        <p id="studio-dialog-notice" role="status"></p>
        <button id="studio-choose" class="primary" type="button">この星座で遊ぶ →</button>
        <div id="game-subnav"><button id="game-login" class="text-button" type="button">アカウントでログイン</button><button id="game-privacy" class="text-button" type="button">ログイン情報について</button><button id="game-about" class="text-button" type="button">この星座について</button></div>
      </section>
    </div>
    <footer><button id="game-options" class="text-button" type="button">設定</button><span>星の情報：星をみるひとAPI</span><div id="studio-account-actions"></div></footer>`;
  const move=(node,parent)=>$(parent).append(node);
  move($('start'),'studio-access');
  move(document.querySelector('.observation-panel'),'studio-location');
  move(document.querySelector('.sky-panel'),'studio-stars');
  move($('planner-consent').closest('label'),'studio-ai');
  move($('auth-logout'),'studio-account-actions');
  move($('auth-account'),'game-account');$('auth-account').open=true;
  move($('refresh'),'game-reconnect');
  const privacy=document.querySelector('#cloud-login .fine-details');
  const privacyText=privacy.querySelector('p').textContent;privacy.hidden=true;
  const privacyLinks=document.createElement('p');privacyLinks.id='game-privacy-links';
  for(const link of privacy.querySelectorAll('a'))privacyLinks.append(link.cloneNode(true),' ');
  $('game-reading').append(privacyLinks);
  $('location-notice').textContent='現在地を使うか、緯度・経度を入力してください。';
  const dome=mountSkyDome($('game-sphere'),{onSelect:index=>cards()[index]?.click()});
  let page='', extra=null, previousExtra=null, locationEdit=false, texts=[],textIndex=0, rowKey='', rows=[], selection=-1;
  const cards=()=>Array.from($('constellations').children);
  const say=(id,value)=>{if($(id).textContent!==value)$(id).textContent=value;};
  function showReading(text,kind){
    previousExtra=extra;extra=kind;texts=Array.from(text.matchAll(/[\s\S]{1,120}/gu),m=>m[0]);textIndex=0;refresh();
  }
  function base(){return !hasAccess()?'access':!locationEdit&&cards().length?'stars':'location';}
  function refresh(){
    if(!dialog.open)return;
    if(hasAccess()&&extra==='account')extra=null;
    const next=extra||base(),changed=page!==next;page=next;dialog.dataset.page=page;
    for(const [id,name]of [['studio-access','access'],['studio-location','location'],['studio-stars','stars'],['game-account','account'],['game-settings','settings']])$(id).hidden=page!==name;
    $('game-reading').hidden=!['about','privacy'].includes(page);
    $('game-privacy-links').hidden=page!=='privacy';
    for(const id of ['studio-choose','game-star-pager','game-about'])$(id).hidden=page!=='stars';
    for(const id of ['game-login','game-privacy'])$(id).hidden=page!=='access';
    $('studio-choose').disabled=$('detail').hidden;
    const titles={access:'星空へ、ようこそ。',account:'アカウントで入る',location:'どこの空で遊ぶ？',stars:'どの星座にする？',settings:'あそびの設定',about:'この星座のお話',privacy:'ログイン情報について'};
    say('studio-dialog-title',titles[page]);
    say('studio-dialog-notice',page==='location'?$('notice').textContent:['access','account'].includes(page)?$('auth-notice').textContent:page==='settings'?$('notice').textContent:'');
    const buttons=cards(),key=buttons.map(b=>b.dataset.skyId).join('|'),index=buttons.findIndex(b=>b.getAttribute('aria-pressed')==='true');
    if(key!==rowKey){rowKey=key;rows=buttons.map(b=>({name:b.querySelector('strong').textContent,azimuthDeg:Number(b.dataset.azimuth),altitudeDeg:Number(b.dataset.altitude)}));}
    if(selection!==index||domeRows!==rows){selection=index;domeRows=rows;dome.update(rows,index);}
    say('game-page-count',buttons.length?(index+1)+' / '+buttons.length:'');
    $('game-prev').disabled=$('game-next').disabled=buttons.length<2;
    say('game-dome-caption',rows.length?'ドラッグで回す · 光は星座の位置の目印':'地平線を囲む、空の地図');
    say('game-reading-text',texts[textIndex]||'説明がありません。');
    say('game-text-count',(textIndex+1)+' / '+Math.max(1,texts.length));
    $('game-text-prev').disabled=textIndex<=0;$('game-text-next').disabled=textIndex>=texts.length-1;
    const step=hasAccess()?(base()==='stars'?2:1):0;
    document.querySelectorAll('.game-route li').forEach((el,i)=>el.setAttribute('aria-current',String(step===i)));
    if(changed&&dialog.open){$('studio-dialog-title').focus({preventScroll:true});}
  }
  let domeRows=null;
  function turn(delta){const list=cards();if(!list.length)return;const i=list.findIndex(b=>b.getAttribute('aria-pressed')==='true');list[(i+delta+list.length)%list.length].click();refresh();}
  function close(){stop();dialog.close();}
  $('studio-close').addEventListener('click',close);
  $('studio-back').addEventListener('click',()=>{
    if(extra){extra=previousExtra;previousExtra=null;}
    else if(page==='stars')locationEdit=true;
    else{close();return;}
    refresh();
  });
  $('studio-choose').addEventListener('click',()=>{dialog.close();render();$('studio-action').focus({preventScroll:true});});
  $('game-prev').addEventListener('click',()=>turn(-1));$('game-next').addEventListener('click',()=>turn(1));
  dialog.addEventListener('keydown',e=>{if(page==='stars'&&['ArrowLeft','ArrowRight'].includes(e.key)){e.preventDefault();turn(e.key==='ArrowLeft'?-1:1);}});
  $('game-center').addEventListener('click',()=>dome.center());
  $('game-login').addEventListener('click',()=>{extra='account';refresh();});
  $('game-options').addEventListener('click',()=>{extra='settings';refresh();});
  $('game-privacy').addEventListener('click',()=>showReading(privacyText,'privacy'));
  $('game-about').addEventListener('click',()=>showReading($('detail-description').textContent+' '+$('detail-story').textContent,'about'));
  for(const [id,delta]of [['game-text-prev',-1],['game-text-next',1]])$(id).addEventListener('click',()=>{textIndex=Math.max(0,Math.min(texts.length-1,textIndex+delta));refresh();});
  $('sky-form').addEventListener('submit',()=>{locationEdit=false;});
  $('auth-logout').addEventListener('click',()=>{extra=null;previousExtra=null;refresh();});
  dialog.addEventListener('cancel',stop);
  dialog.addEventListener('close',()=>{move($('game-dome'),'game-welcome-dome');dome.resize();render();});
  const selectionObserver=new MutationObserver(refresh);selectionObserver.observe($('constellations'),{subtree:true,attributes:true,attributeFilter:['aria-pressed']});
  window.addEventListener('pagehide',()=>{selectionObserver.disconnect();dome.dispose();},{once:true});
  move($('game-dome'),'game-welcome-dome');
  return {
    render:refresh,
    open(){if(['preview','requesting'].includes($('camera-notice').dataset.state))stop();extra=null;previousExtra=null;locationEdit=false;move($('game-dome'),'game-dome-slot');if(!dialog.open)dialog.showModal();refresh();dome.resize();$('studio-dialog-title').focus({preventScroll:true});},
  };
}
