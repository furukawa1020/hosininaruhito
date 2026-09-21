// Test-only identity adapter. Never used by the product or live acceptance.
export const guestAuth={mode:'firebase',guestEnabled:true,config:{projectId:'fixture'},siteKey:'fixture'};
export async function guestSdk(page,{fail=false,delayed=false}={}){
 await page.route('**/assets/firebase-access-*.js',r=>r.fulfill({contentType:'text/javascript',body:`
 let current;
 export async function guest(){window.guestCalls=(window.guestCalls||0)+1;${delayed?'await new Promise(resolve=>window.releaseGuest=resolve);':''}${fail?'throw Error("fixture failure");':''}return current={uid:'guest-fixture',isAnonymous:true};}
 export async function login(){return current={uid:'member-fixture'};}
 export async function logout(){current=null;window.guestSignouts=(window.guestSignouts||0)+1;}
 export async function headers(){if(!current)throw Error('fixture signed out');return {Authorization:'Bearer '+current.uid,'X-Firebase-AppCheck':'fixture-app'};}
 `}));
}
