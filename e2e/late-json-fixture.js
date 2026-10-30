// Transport fixture: a parsed body deliberately ignores AbortSignal.
export async function holdJson(page,path,init=false){
 const inject=path=>{
  const original=window.fetch;
  window.fetch=async(url,options)=>{
   const response=await original(url,options);
   if(String(url)===path&&!window.jsonRetry){
    const data=await response.json();
    response.json=async()=>{await new Promise(resolve=>{window.releaseJson=resolve;});return data;};
   }
   return response;
  };
 };
 await page[init?'addInitScript':'evaluate'](inject,path);
}
export async function expireJson(page,ms,mode){
 if(mode==='timer')await page.clock.runFor(ms+1);
 else await page.evaluate(ms=>{window.jsonOriginalNow=performance.now.bind(performance);performance.now=()=>window.jsonOriginalNow()+ms+1;window.releaseJson();},ms);
}
export async function releaseJson(page){
 await page.evaluate(()=>{window.jsonRetry=true;if(window.jsonOriginalNow)performance.now=window.jsonOriginalNow;window.releaseJson();});
}
