let mode='development', current=null, generation=0, settings=null, sdk=null;
let documentRef, changed=()=>{};
export function mountAccess(document,onChange) {
  documentRef=document;changed=onChange;
  const $=id=>document.getElementById(id);
  $('auth-login').addEventListener('click',async()=>{
    const at=++generation;current=null;changed();$('auth-logout').hidden=true; $('auth-login').disabled=true;
    $('auth-notice').textContent='ログインを確認しています…';
    try {
      sdk ||= await import('./firebase-access.js');
      const user=await sdk.login(settings,$('auth-email').value,$('auth-password').value);
      $('auth-password').value='';
      if(at!==generation){await sdk.logout();return;}
      current=user;changed();$('auth-notice').textContent='ログインしました。観測地点を選んでください。';
      $('auth-logout').hidden=false;
    }catch{current=null;$('auth-password').value='';$('auth-notice').textContent='ログインできませんでした。案内されたメールとパスワード、接続環境を確認してください。';}
    finally{$('auth-login').disabled=false;}
  });
  $('auth-logout').addEventListener('click',async()=>{
    generation++;current=null;changed();$('auth-logout').hidden=true;
    try{await sdk?.logout();$('auth-notice').textContent='ログアウトしました。';}
    catch{$('auth-notice').textContent='操作を停止しました。ページを閉じてログイン状態を消去してください。';}
  });
}
export function configureAccess(value) {
  const next=value?.mode||'development';
  if(JSON.stringify(settings)!==JSON.stringify(value)||mode!==next){const hadSession=!!current;generation++;current=null;settings=value;mode=next;if(hadSession)changed();}
  if(!documentRef)return;
  documentRef.getElementById('cloud-login').hidden=mode!=='firebase';
  documentRef.getElementById('development-token').hidden=mode!=='development';
  const field=documentRef.getElementById('token');field.required=mode==='development';if(mode!=='development')field.value='';
}
export function hasAccess(token) {return mode==='firebase'?!!current:mode==='development'&&!!token.trim();}
export async function requestHeaders(token,signal) {
  signal?.throwIfAborted();
  if(mode==='development')return {'Content-Type':'application/json',Authorization:'Bearer '+token};
  if(mode!=='firebase'||!current||!sdk)throw Error('ログインしてください。');
  const at=generation,headers=await sdk.headers();
  signal?.throwIfAborted();if(at!==generation||!current)throw Error('ログイン状態が変わりました。');
  return {'Content-Type':'application/json',...headers};
}
