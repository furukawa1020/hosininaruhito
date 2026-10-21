import {parseCoordinates} from './requests.js';

export function mountLocation(document, window) {
  const $=id=>document.getElementById(id);
  const failures={
    1:'現在地を取得できません。位置情報が許可されていません。サイトの許可設定を確認するか、緯度・経度を入力してください。',
    2:'現在地を取得できません。端末が位置を確認できませんでした。緯度・経度を入力して進められます。',
    3:'現在地を取得できません。取得が時間切れになりました。再試行するか、緯度・経度を入力してください。'
  };
  let generation=0,timer=null,pending=false;
  function finish(message,state='error'){pending=false;window.clearTimeout(timer);$('locate').disabled=false;$('location-notice').textContent=message;$('location-notice').dataset.state=state;}
  function cancel(){if(!pending)return;generation++;finish('位置の取得を取り消しました。必要ならもう一度入力してください。');}
  $('locate').addEventListener('click',()=>{
    if(pending||document.hidden)return;
    if(!window.navigator.geolocation){finish('この端末では現在地を取得できません。緯度・経度を入力してください。');return;}
    const at=++generation;pending=true;$('locate').disabled=true;$('location-notice').textContent='ブラウザーの位置情報の許可を確認してください…';$('location-notice').dataset.state='pending';
    timer=window.setTimeout(()=>{if(at===generation){generation++;finish(failures[3]);}},12000);
    try{window.navigator.geolocation.getCurrentPosition(position=>{
      if(at!==generation||document.hidden)return;
      let coordinates;
      try{coordinates=parseCoordinates(String(position.coords.latitude),String(position.coords.longitude));}catch{generation++;finish('現在地を確認できません。緯度・経度を入力してください。');return;}
      finish('おおよその現在地を入力しました。内容を確認し、送信への同意を選んでから星座を探してください。','success');
      $('lat').value=coordinates.lat.toFixed(2);$('lng').value=coordinates.lng.toFixed(2);
      $('consent').checked=false;$('consent').dispatchEvent(new window.Event('change',{bubbles:true}));
      for(const id of ['lat','lng'])$(id).dispatchEvent(new window.Event('input',{bubbles:true}));
      $('location-notice').dataset.state='success';
    },error=>{if(at===generation){generation++;finish(failures[error?.code]||'現在地を取得できませんでした。再試行するか、緯度・経度を入力してください。');}},{enableHighAccuracy:false,timeout:10000,maximumAge:60000});}
    catch{generation++;finish('現在地を取得できませんでした。緯度・経度を入力してください。');}
  });
  for(const id of ['lat','lng','stop','sky','auth-logout','auth-guest','auth-login'])$(id).addEventListener(id==='lat'||id==='lng'?'input':'click',cancel);
  for(const id of ['lat','lng'])$(id).addEventListener('input',()=>{$('location-notice').dataset.state='idle';});
  $('sky-form').addEventListener('submit',()=>{cancel();$('location-notice').dataset.state='idle';});
  document.addEventListener('keydown',e=>{if(e.key==='Escape')cancel();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden)cancel();});
  window.addEventListener('pagehide',cancel);
}
