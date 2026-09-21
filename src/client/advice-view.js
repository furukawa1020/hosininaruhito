import { AdvisorySession } from './advice.js';
export function mountAdvice(document,window) {
  const $=id=>document.getElementById(id);
  let services=null,wasActive=false,disposed=false,lastExecution=null;
  const cues={left:'表示の右側に目標があります。',right:'表示の左側に目標があります。',
    up:'表示の上側に目標があります。',down:'表示の下側に目標があります。',hold:'目標の近くです。確定は画面の保持表示で確認してください。'};
  const messages={idle:'Jevの助言は停止しています。',waiting:'Jevの助言を待っています。輪と保持表示を確認してください。',
    stale:'計測が古いため、Jevの助言を停止しました。',limit:'この実行の助言回数上限に達しました。',
    error:'Jevの応答を確認できませんでした。輪と保持表示は端末内で動作しています。',
    unavailable:'Jevへの接続失敗が続いたため、助言を停止しました。'};
  const controller=new AdvisorySession({now:()=>window.performance.now(),
    send:async(body,{signal})=>{
      const response=await fetch('/api/reflex',{method:'POST',headers:{'Content-Type':'application/json',Authorization:'Bearer '+$('token').value},
        body:JSON.stringify(body),signal:AbortSignal.any([signal,AbortSignal.timeout(1000)])});
      if(!response.ok)throw Error('request_failed');
      return response.json();
    },
    onChange:result=>{
      $('advice-notice').dataset.state=result.state;
      $('advice-notice').textContent=result.state==='advice'?
        'Jevの助言: '+cues[result.action]+'（応答 '+result.latencyMs+'ms）':messages[result.state];
    }});
  const stop=()=>{wasActive=false;controller.stop();};
  const update=frame=>{
    const active=!disposed&&!document.hidden&&$('advice-consent').checked&&$('camera-consent').checked&&
      services?.access&&services?.reflex&&frame.state==='running'&&frame.current&&frame.activeTarget;
    if(!active){if(wasActive)stop();return;}
    if(!wasActive){controller.start({resetAllowance:frame.executionId!==lastExecution});lastExecution=frame.executionId;wasActive=true;}
    const target=frame.activeTarget,current=frame.current;
    controller.update({targetId:target.starId,dx:target.target.x-current.x,dy:target.target.y-current.y,tolerance:target.tolerance,at:current.at});
  };
  const consent=()=>{stop();if($('advice-consent').checked&&!services?.reflex)$('advice-notice').textContent='Jevは未設定です。接続の準備を確認してください。';};
  $('advice-consent').addEventListener('change',consent);
  const dispose=()=>{disposed=true;stop();$('advice-consent').removeEventListener('change',consent);};
  window.addEventListener('pagehide',dispose,{once:true});stop();
  return {update,stop,setServices(value){services=value;if(!services?.reflex)stop();}};
}
