export const ADVICE_LIMITS = Object.freeze({ intervalMs: 500, maxAgeMs: 1000, sampleAgeMs: 150, requests: 60, failures: 3 });
export function geometricCue({dx,dy,tolerance}) {
  if(Math.hypot(dx,dy)<=tolerance)return 'hold';
  return Math.abs(dx)>Math.abs(dy)?(dx>0?'right':'left'):(dy>0?'down':'up');
}
function valid(input,now) {
  return input && typeof input.targetId==='string' && input.targetId.length>0 && input.targetId.length<=200 &&
    ['dx','dy','at','tolerance'].every(k=>Number.isFinite(input[k])) &&
    Math.abs(input.dx)<=1 && Math.abs(input.dy)<=1 && input.tolerance>=.01 && input.tolerance<=.06 &&
    Number.isFinite(now) && now>=0 && input.at>=0 && now>=input.at && now-input.at<=ADVICE_LIMITS.sampleAgeMs;
}
// Advisory output only. This class has no reference to the capture/runtime state.
export class AdvisorySession {
  constructor({send,now,onChange=()=>{}}) {
    this.send=send;this.now=now;this.onChange=onChange;
    this.generation=0;this.active=false;this.pending=null;this.current=null;
    this.lastSent=-Infinity;this.lastNow=null;this.suggestion=null;
  }
  start({resetAllowance=true}={}) {
    this.stop();this.active=true;this.count=resetAllowance?0:(this.count||0);this.failures=0;this.retryAt=0;this.lastNow=null;
    this.onChange({state:'waiting'});
  }
  stop(state='idle') {
    this.active=false;this.current=null;this.suggestion=null;this.generation++;
    this.pending?.controller.abort();
    // Keep ownership until even an abort-ignoring transport settles.
    this.onChange({state});
  }
  update(input) {
    if(!this.active)return;
    const now=this.now();
    if(!valid(input,now)||(this.lastNow!==null&&now<this.lastNow)){this.stop('stale');return;}
    this.lastNow=now;
    if(this.current && this.current.targetId!==input.targetId){
      this.generation++;this.pending?.controller.abort();this.suggestion=null;this.onChange({state:'waiting'});
    }
    this.current={...input};
    if(this.suggestion&&(geometricCue(input)!==this.suggestion.action||now-this.suggestion.at>ADVICE_LIMITS.maxAgeMs)){
      this.suggestion=null;this.onChange({state:'waiting'});
    }
    if(this.pending||now-this.lastSent<ADVICE_LIMITS.intervalMs||now<this.retryAt)return;
    if(this.count>=ADVICE_LIMITS.requests){this.stop('limit');return;}
    const ticket={controller:new AbortController(),generation:this.generation,targetId:input.targetId,at:now};
    this.pending=ticket;this.lastSent=now;this.count++;
    const payload={dx:Math.round(input.dx*100)/100,dy:Math.round(input.dy*100)/100,tracked:true};
    this.request(ticket,payload);
  }
  async request(ticket,payload) {
    try {
      const result=await this.send(payload,{signal:ticket.controller.signal});
      const now=this.now();
      if(!this.active||ticket.generation!==this.generation||ticket.controller.signal.aborted)return;
      if(!valid(this.current,now)||now<ticket.at||now-ticket.at>ADVICE_LIMITS.maxAgeMs)return;
      if(result?.source!=='jev-live'||result.advisoryOnly!==true||
        !['left','right','up','down','hold','wait'].includes(result.action)||
        !Number.isFinite(result.confidence)||result.confidence<0||result.confidence>1)throw Error('invalid_response');
      this.failures=0;
      if(this.current.targetId!==ticket.targetId||geometricCue(this.current)!==result.action)return;
      this.suggestion={action:result.action,at:ticket.at};
      this.onChange({state:'advice',action:result.action,latencyMs:Math.round(now-ticket.at)});
    } catch {
      if(!this.active||ticket.generation!==this.generation||ticket.controller.signal.aborted)return;
      this.suggestion=null;this.failures++;this.retryAt=this.now()+2000;
      if(this.failures>=ADVICE_LIMITS.failures)this.stop('unavailable');
      else this.onChange({state:'error'});
    } finally {if(this.pending===ticket)this.pending=null;}
  }
}
