// Perspective projection of a rotatable unit sphere. Markers are constellation
// representative directions from the sky API, never individual star positions.
export function mountSkyDome(host, {onSelect = () => {}} = {}) {
  const canvas = host.ownerDocument.createElement('canvas');
  canvas.setAttribute('aria-label', '回せる天球。光の目印は星座の代表位置です。左右ボタンでも星座を選べます。');
  canvas.setAttribute('role', 'img');
  host.append(canvas);
  const ctx = canvas.getContext('2d');
  let rows = [], selected = -1, yaw = -.45, pitch = .38, width = 1, height = 1, drag = null, hits = [], disposed = false;
  const rad = Math.PI / 180;
  function point(az, alt) {
    const a = az * rad, b = alt * rad;
    const x = Math.sin(a)*Math.cos(b), y = Math.sin(b), z = Math.cos(a)*Math.cos(b);
    const xx = x*Math.cos(yaw)-z*Math.sin(yaw), zz = x*Math.sin(yaw)+z*Math.cos(yaw);
    const yy = y*Math.cos(pitch)-zz*Math.sin(pitch), depth = y*Math.sin(pitch)+zz*Math.cos(pitch);
    const size = Math.min(width*.35,height*.36)*3.5/(3.5-depth);
    return {x:width/2+xx*size, y:height/2-yy*size, depth};
  }
  function draw() {
    if (!ctx || disposed || width<2 || height<2) return;
    ctx.clearRect(0,0,width,height); hits=[];
    const radius = Math.min(width,height)*.47;
    const glow=ctx.createRadialGradient(width/2,height/2,0,width/2,height/2,radius);
    glow.addColorStop(0,'#223c6450');glow.addColorStop(.7,'#19395230');glow.addColorStop(1,'#10203700');
    ctx.fillStyle=glow;ctx.fillRect(0,0,width,height);
    function curve(points, horizon=false) {
      for(let i=1;i<points.length;i++){
        const p=points[i-1],q=points[i];ctx.beginPath();ctx.moveTo(p.x,p.y);ctx.lineTo(q.x,q.y);
        ctx.strokeStyle=horizon?'rgba(117,221,214,'+(q.depth>0?.6:.15)+')':'rgba(136,174,219,'+(q.depth>0?.22:.065)+')';
        ctx.lineWidth=horizon?1.4:1;ctx.stroke();
      }
    }
    for(const alt of [-60,-30,0,30,60])curve(Array.from({length:121},(_,i)=>point(i*3,alt)),alt===0);
    for(let az=0;az<180;az+=30)curve(Array.from({length:121},(_,i)=>point(az+(i>60?180:0),i>60?270-i*3:-90+i*3)));
    ctx.font='500 13px sans-serif';ctx.textAlign='center';
    for(const [az,name] of [[0,'北'],[90,'東'],[180,'南'],[270,'西']]){
      const p=point(az,0);ctx.fillStyle=p.depth>0?'#a6d7d8':'#63818f';ctx.fillText(name,p.x,p.y+20);
    }
    const ordered=rows.map((r,i)=>({...point(r.azimuthDeg,r.altitudeDeg),i})).sort((a,b)=>a.depth-b.depth);
    for(const p of ordered){
      const active=p.i===selected,alpha=p.depth>0?1:.24;
      ctx.globalAlpha=alpha;ctx.fillStyle=active?'#ffe9a8':'#b8e9f4';
      ctx.shadowColor=active?'#ffd577':'#94d9ee';ctx.shadowBlur=active?25:9;
      ctx.beginPath();ctx.arc(p.x,p.y,active?6:3,0,Math.PI*2);ctx.fill();ctx.shadowBlur=0;
      if(active){
        ctx.strokeStyle='#ffe9a8';ctx.lineWidth=1.5;ctx.beginPath();ctx.arc(p.x,p.y,16,0,Math.PI*2);ctx.stroke();
        ctx.font='600 17px sans-serif';ctx.fillText(rows[p.i].name,p.x,Math.max(22,p.y-29));
      }
      if(p.depth>0)hits.push(p);
    }
    ctx.globalAlpha=1;
    host.dataset.markers=String(rows.length);host.dataset.orientation=yaw.toFixed(3)+','+pitch.toFixed(3);
  }
  function resize(){
    const r=host.getBoundingClientRect();width=r.width;height=r.height;
    const ratio=Math.min(2,devicePixelRatio||1);canvas.width=Math.round(width*ratio);canvas.height=Math.round(height*ratio);
    ctx?.setTransform(ratio,0,0,ratio,0,0);draw();
  }
  canvas.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    drag={x:event.clientX,y:event.clientY,yaw,pitch,moved:false};canvas.setPointerCapture(event.pointerId);
  });
  canvas.addEventListener('pointermove',event=>{
    if(!drag)return;
    const dx=event.clientX-drag.x,dy=event.clientY-drag.y;
    if(Math.hypot(dx,dy)>5)drag.moved=true;
    yaw=drag.yaw-dx*.008;pitch=Math.max(-1.4,Math.min(1.4,drag.pitch+dy*.008));draw();
  });
  canvas.addEventListener('pointerup',event=>{
    if(!drag)return;
    if(!drag.moved){const r=canvas.getBoundingClientRect();const hit=hits.filter(p=>Math.hypot(event.clientX-r.left-p.x,event.clientY-r.top-p.y)<24).sort((a,b)=>b.depth-a.depth)[0];if(hit)onSelect(hit.i);}
    drag=null;
  });
  canvas.addEventListener('pointercancel',()=>{drag=null;});
  const observer=new ResizeObserver(resize);observer.observe(host);
  if(!ctx){host.dataset.fallback='true';canvas.hidden=true;}
  return {
    update(next,index){
      const changed=rows!==next||selected!==index;rows=next;selected=index;
      if(changed&&rows[index]){yaw=rows[index].azimuthDeg*rad;pitch=rows[index].altitudeDeg*rad;}
      if(changed)draw();
    },
    center(){if(rows[selected]){yaw=rows[selected].azimuthDeg*rad;pitch=rows[selected].altitudeDeg*rad;}else{yaw=-.45;pitch=.38;}draw();},
    resize,
    dispose(){disposed=true;observer.disconnect();canvas.width=canvas.height=0;rows=[];hits=[];}
  };
}
