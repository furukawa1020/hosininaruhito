// Navigation only: permission, API, tracking and capture decisions stay in their owners.
export function mountPlayGuide(document, window, {hasAccess}) {
  const $=id=>document.getElementById(id), state=id=>$(id).dataset.state;
  for(const id of ['start','observe','camera-setup','pose-setup','reach-setup','arrange','draw'])$(id).tabIndex=-1;
  let signature='';
  function render(){
    let step='sky',key='start',target='start',label='開始の操作へ',message='ゲストとしてはじめると、場所を選べます。';
    if(hasAccess()){
      key='location';target='observe';label='場所を選ぶ';message='場所を入力し、送信に同意して「この場所の星座を探す」を押してください。';
      if($('notice').dataset.tone==='error')message='星座を取得できませんでした。表示された理由を確認して、もう一度試してください。';
      if(!$('detail').hidden){
        step='body';key='camera';target='camera-setup';label='カメラの準備へ';message=$('detail-name').textContent+'を選んでいます。撮影に同意して、カメラを開始しましょう。';
        if(state('camera-notice')==='error')message='カメラを開始できませんでした。カメラ欄の案内を確認してください。';
        if(state('camera-notice')==='preview'){
          key='pose';target='pose-setup';label='手首を見つける';message='顔と両手首を映し、「手首の推定を開始・再開する」を押してください。';
          if(state('pose-notice')==='loading')message='手首を見つける準備中です。そのままお待ちください。';
          if(state('pose-notice')==='paused'||state('pose-notice')==='error')message='手首の追跡が止まりました。映り方を確認し、手首の推定を再開してください。';
          if(state('pose-notice')==='tracking'){
            key='reach';target='reach-setup';label='動かせる範囲を記録';message='動かす手を選び、計測を始めてください。上下・左右に、楽な範囲で動かします。';
            if(state('reach-notice')==='collecting'){key='collecting';message='手をゆっくり動かし、3秒以上記録したら「ここまでを使う」を押してください。';label='計測の操作へ';}
            if(state('reach-notice')==='ready'){
              step='play';key='arrange';target='arrange';label='星を配置する';message='手の準備ができました。「配置を準備する」で、星の位置を決めましょう。';
              if(state('session-notice')==='loading'){key='preparing';message='星の配置を準備しています。完了するまで、そのままお待ちください。';}
              if(state('session-notice')==='error'){key='arrange-error';message='この条件では配置できませんでした。配置欄の理由を確認し、星座の選び直しや再計測をしてください。';}
              if(state('session-notice')==='ready'){
                key='draw';target='draw';label='星座づくりへ';message='配置できました。「配置した星座を開始する」を押すと、目標の輪が現れます。';
                if(state('trace-notice')==='running'){key='running';message='手の光を輪に重ね、楽なら0.8秒止めましょう。星が残ったら次の輪へ。';label='手の光を見る';}
                if(state('trace-notice')==='complete'){key='complete';message='星座ができました！ あなたが手を止めた場所に、星が残っています。';label='できた星座を見る';}
                if(state('trace-notice')==='error'){key='draw-error';message='光の表示を開始できませんでした。描画欄の案内を確認してください。';}
              }
            }
          }
        }
      }
    }
    const next=JSON.stringify({step,key,target,label,message});if(next===signature)return;signature=next;
    $('guide-message').textContent=message;$('guide-next').href='#'+target;$('guide-next').textContent=label+' ↓';
    document.body.dataset.guide=key;
    for(const name of ['sky','body','play']){const el=$('step-'+name);if(name===step)el.setAttribute('aria-current','step');else el.removeAttribute('aria-current');}
    for(const id of ['camera-setup','pose-setup','reach-setup','arrange','draw'])$(id).classList.toggle('current-action',id===target);
    $('body-next').hidden=state('reach-notice')!=='ready';
    $('session-next').hidden=state('session-notice')!=='ready';
  }
  const observer=new window.MutationObserver(render);
  for(const id of ['camera-notice','pose-notice','reach-notice','session-notice','trace-notice'])observer.observe($(id),{attributes:true,attributeFilter:['data-state']});
  observer.observe($('detail'),{attributes:true,attributeFilter:['hidden']});
  observer.observe($('detail-name'),{childList:true});
  observer.observe($('auth-notice'),{childList:true});
  observer.observe($('notice'),{attributes:true,attributeFilter:['data-tone']});
  $('token').addEventListener('input',render);render();
  window.addEventListener('pagehide',()=>observer.disconnect(),{once:true});
}
