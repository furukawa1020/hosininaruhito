import './style.css';
const $=id=>document.getElementById(id);
async function call(path,body) {
  $('sky').disabled=$('jev').disabled=true;
  $('result').textContent='接続中…';
  try {
    const response=await fetch(path,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${$('token').value}`},body:JSON.stringify(body),signal:AbortSignal.timeout(45000)});
    $('result').textContent=JSON.stringify({status:response.status,...await response.json()},null,2);
  } catch(error) { $('result').textContent=`接続失敗: ${error.message}`; }
  finally { $('sky').disabled=$('jev').disabled=false; }
}
$('sky').onclick=()=>call('/api/sky',{lat:Number($('lat').value),lng:Number($('lng').value)});
$('jev').onclick=()=>call('/api/reflex',{dx:0.1,dy:0,tracked:true});
