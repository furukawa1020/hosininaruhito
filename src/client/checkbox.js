let loading;
function load(window,document) {
  if(window.grecaptcha?.enterprise?.render)return Promise.resolve(window.grecaptcha.enterprise);
  if(!loading)loading=new Promise((resolve,reject)=>{
    const script=document.createElement('script');
    script.src='https://www.google.com/recaptcha/enterprise.js?render=explicit&hl=ja';script.async=true;
    const timer=setTimeout(()=>reject(Error('Verification script timeout')),20000);
    script.onload=()=>window.grecaptcha?.enterprise?.ready(()=>{clearTimeout(timer);resolve(window.grecaptcha.enterprise);});
    script.onerror=()=>{clearTimeout(timer);reject(Error('Verification script unavailable'));};
    document.head.append(script);
  }).catch(error=>{loading=null;throw error;});
  return loading;
}

// A regular overlay lets Google's own challenge iframe receive focus. Native
// showModal() would put the application above that iframe and make it unusable.
export function requestCheckbox(document,siteKey,signal) {
  const window=document.defaultView,menu=document.getElementById('studio-dialog'),wasOpen=menu?.open;
  const root=document.createElement('section');root.className='human-check';root.setAttribute('role','dialog');root.setAttribute('aria-modal','true');root.setAttribute('aria-labelledby','human-check-title');
  root.innerHTML='<div><h2 id="human-check-title" tabindex="-1">確認して、星空へ。</h2><p>下のチェックを押し、Googleの案内に沿って確認してください。</p><div id="human-check-widget"></div><p id="human-check-notice" role="status">確認を読み込んでいます…</p><button id="human-check-stop" type="button">■ 停止して戻る</button></div>';
  menu?.close();
  // Only our UI becomes inert; Google may reuse a challenge frame already in body.
  const background=Array.from(document.querySelectorAll('.topbar, main, #studio, #studio-dialog')).map(node=>[node,node.inert]);
  for(const [node]of background)node.inert=true;
  document.body.append(root);root.querySelector('h2').focus();
  return new Promise((resolve,reject)=>{
    let finished=false,api,widget;
    const finish=(error,proof)=>{
      if(finished)return;finished=true;
      signal.removeEventListener('abort',abort);
      if(widget!==undefined)try{api.reset(widget);}catch{}
      root.remove();for(const [node,inert]of background)node.inert=inert;
      if(wasOpen&&!document.hidden&&!signal.aborted)menu.showModal();
      error?reject(error):resolve(proof);
    };
    const abort=()=>finish(Object.assign(Error('Verification cancelled'),{code:'hcr/verification-cancelled'}));
    signal.addEventListener('abort',abort,{once:true});
    root.querySelector('#human-check-stop').onclick=()=>finish(Object.assign(Error('Verification cancelled'),{code:'hcr/verification-cancelled'}));
    if(signal.aborted){abort();return;}
    load(window,document).then(value=>{
      if(finished)return;api=value;
      root.querySelector('#human-check-notice').textContent='映像や位置情報は使いません。';
      widget=api.render(root.querySelector('#human-check-widget'),{sitekey:siteKey,size:'compact',theme:'dark',
        callback:proof=>{if(typeof proof==='string'&&proof.length>=20&&proof.length<=8192)finish(null,proof);else finish(Object.assign(Error('Invalid proof'),{code:'hcr/verification-rejected'}));},
        'error-callback':()=>finish(Object.assign(Error('Verification unavailable'),{code:'appCheck/recaptcha-error'})),
        'expired-callback':()=>finish(Object.assign(Error('Verification expired'),{code:'hcr/verification-rejected'}))});
    }).catch(()=>finish(Object.assign(Error('Verification unavailable'),{code:'appCheck/recaptcha-error'})));
  });
}
