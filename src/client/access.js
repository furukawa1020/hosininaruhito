let mode='development', current=null, generation=0, settings=null, sdk=null, pending=false;
let documentRef, changed=()=>{};
export function mountAccess(document,onChange) {
  documentRef=document;changed=onChange;
  const $=id=>document.getElementById(id);
  async function begin(guest) {
    if(pending||mode!=='firebase'||document.hidden||(guest&&settings?.guestEnabled!==true))return;
    const at=++generation;pending=true;current=null;changed();
    $('auth-login').disabled=true;$('auth-guest').disabled=true;
    $('auth-logout').hidden=false;$('auth-logout').textContent='開始を取り消す';
    $('auth-notice').textContent=guest?'ゲストの体験を準備しています…':'ログインを確認しています…';
    try {
      sdk ||= await import('./firebase-access.js');
      if(at!==generation)return;
      const user=guest?await sdk.guest(settings):await sdk.login(settings,$('auth-email').value,$('auth-password').value);
      $('auth-password').value='';
      if(at!==generation){await sdk.logout();return;}
      current=user;changed();
      $('auth-notice').textContent=guest?'ゲストとして開始しました。観測地点を選んでください。':'ログインしました。観測地点を選んでください。';
      $('auth-logout').textContent=guest?'ゲストを終了する':'ログアウト';
    }catch{
      if(at===generation){current=null;$('auth-notice').textContent=guest?'ゲストとして開始できませんでした。通信環境を確認して、もう一度お試しください。':'ログインできませんでした。案内されたメールとパスワード、接続環境を確認してください。';}
    }finally{
      pending=false;$('auth-password').value='';$('auth-login').disabled=false;$('auth-guest').disabled=false;$('auth-logout').hidden=!current;
    }
  }
  function cancelPending(){if(pending){generation++;$('auth-password').value='';$('auth-logout').hidden=true;$('auth-notice').textContent='開始を取り消しました。もう一度操作すると再開できます。';}}
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
