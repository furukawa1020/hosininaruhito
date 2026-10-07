let mode='development', current=null, generation=0, settings=null, sdk=null, pending=false;
let documentRef, changed=()=>{};
const START_TIMEOUT_MS=45000;
function failureNotice(error,guest) {
  const code=error?.code;
  if(['appCheck/initial-throttle','appCheck/throttled'].includes(code))return 'ブラウザーの確認が通らず、開始を制限されています。続けて押さず、時間をおいてお試しください。';
  if(code==='appCheck/recaptcha-error')return 'ブラウザーの確認を完了できませんでした。通常のブラウザーで開き、Googleへの接続を確認してください。';
  if(['appCheck/fetch-network-error','auth/network-request-failed'].includes(code))return '通信が途切れました。接続を確認してから、もう一度開始してください。';
  if(['auth/invalid-credential','auth/invalid-email','auth/wrong-password','auth/user-not-found'].includes(code))return 'メールアドレスまたはパスワードを確認してください。';
  if(code==='auth/too-many-requests')return '開始の試行が多いため、一時的に制限されています。時間をおいてお試しください。';
  if(code==='auth/operation-not-allowed')return '現在、この開始方法を利用できません。設定の確認が必要です。';
  return guest?'ゲストとして開始できませんでした。時間をおいて、もう一度お試しください。':'ログインできませんでした。案内されたメールとパスワード、接続環境を確認してください。';
}
export function mountAccess(document,onChange) {
  documentRef=document;changed=onChange;
  const $=id=>document.getElementById(id);
  async function begin(guest) {
    if(pending||mode!=='firebase'||document.hidden||(guest&&settings?.guestEnabled!==true))return;
    const at=++generation;pending=true;current=null;changed();
    const deadline=Date.now()+START_TIMEOUT_MS;
    let expired=false;
    $('auth-recovery').hidden=true;
    $('auth-login').disabled=true;$('auth-guest').disabled=true;
    $('auth-logout').hidden=false;$('auth-logout').textContent='開始を取り消す';
    $('auth-notice').textContent=guest?'ゲストの体験を準備しています…':'ログインを確認しています…';
    const progress=phase=>{
      if(at!==generation||expired)return;
      $('auth-notice').textContent=phase==='verification'?'ブラウザーを確認しています…':guest?'ゲストの参加を確認しています…':'ログインを確認しています…';
    };
    const expire=()=>{
      if(expired)return;
      expired=true;
      const active=at===generation;
      if(active)generation++;
      $('auth-password').value='';
      $('auth-notice').textContent=active?'開始の確認が45秒以内に終わりませんでした。接続を確認し、ページを読み直してください。':'取消の処理が終わりません。ページを読み直すと、最初から始められます。';
      $('auth-logout').hidden=true;$('auth-recovery').hidden=false;
    };
    const timer=setTimeout(expire,START_TIMEOUT_MS);
    try {
      sdk ||= await import('./firebase-access.js');
      if(Date.now()>=deadline)expire();
      if(at!==generation)return;
      const user=guest?await sdk.guest(settings,progress):await sdk.login(settings,$('auth-email').value,$('auth-password').value,progress);
      $('auth-password').value='';
      if(Date.now()>=deadline)expire();
      if(at!==generation){await sdk.logout();return;}
      current=user;changed();
      $('auth-notice').textContent=guest?'ゲストとして開始しました。観測地点を選んでください。':'ログインしました。観測地点を選んでください。';
      $('auth-logout').textContent=guest?'ゲストを終了する':'ログアウト';
    }catch(error){
      if(at===generation){current=null;$('auth-notice').textContent=failureNotice(error,guest);}
    }finally{
      clearTimeout(timer);
      pending=false;$('auth-password').value='';$('auth-login').disabled=false;$('auth-guest').disabled=false;$('auth-logout').hidden=!current;
      if(at!==generation&&!expired)$('auth-notice').textContent='開始を取り消しました。もう一度操作すると再開できます。';
    }
  }
  function cancelPending(){if(pending){generation++;$('auth-password').value='';$('auth-logout').hidden=true;$('auth-notice').textContent='開始を取り消しました。終了処理を待っています。';}}
  $('auth-reload').addEventListener('click',()=>{generation++;current=null;changed();document.defaultView.location.reload();});
  $('auth-login').addEventListener('click',()=>begin(false));
  $('auth-guest').addEventListener('click',()=>begin(true));
  $('stop').addEventListener('click',cancelPending);
  document.addEventListener('keydown',event=>{if(event.key==='Escape')cancelPending();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancelPending();});
  document.defaultView.addEventListener('pagehide',cancelPending);
  $('auth-logout').addEventListener('click',async()=>{
    if(pending){cancelPending();return;}
    generation++;current=null;changed();$('auth-logout').hidden=true;
    // Serialize SDK identity changes so a late logout cannot clear a new login.
    pending=true;$('auth-login').disabled=true;$('auth-guest').disabled=true;
    try{await sdk?.logout();$('auth-notice').textContent='ログアウトしました。';}
    catch{$('auth-notice').textContent='操作を停止しました。ページを閉じてログイン状態を消去してください。';}
    finally{pending=false;$('auth-login').disabled=false;$('auth-guest').disabled=false;}
  });
}
export function configureAccess(value) {
  const next=value?.mode||'development';
  if(JSON.stringify(settings)!==JSON.stringify(value)||mode!==next){const hadSession=!!current;generation++;current=null;settings=value;mode=next;if(hadSession)changed();}
  if(!documentRef)return;
  documentRef.getElementById('cloud-login').hidden=mode!=='firebase';
  documentRef.getElementById('auth-guest').hidden=mode!=='firebase'||value?.guestEnabled!==true;
  if(value?.guestEnabled!==true)documentRef.getElementById('auth-account').open=true;
  documentRef.getElementById('development-token').hidden=mode!=='development';
  const field=documentRef.getElementById('token');field.required=mode==='development';if(mode!=='development')field.value='';
}
export function hasAccess(token) {return mode==='firebase'?!!current:mode==='development'&&!!token.trim();}
export async function requestHeaders(token,signal) {
  signal?.throwIfAborted();
  if(mode==='development')return {'Content-Type':'application/json',Authorization:'Bearer '+token};
  if(mode!=='firebase'||!current||!sdk)throw Error('ゲスト開始またはログインが必要です。');
  const at=generation,headers=await sdk.headers();
  signal?.throwIfAborted();if(at!==generation||!current)throw Error('ログイン状態が変わりました。');
  return {'Content-Type':'application/json',...headers};
}
