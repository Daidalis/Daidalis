let revision,pending,busy=false;
function editing(){
 if(document.querySelector('.modal,[data-run-status="running"],[data-run-status="queued"],[data-run-status="waiting_approval"]'))return true;
 return [...document.querySelectorAll('textarea,input:not([type="range"]):not([type="file"])')].some(field=>{
  if(field.id==='composer'||field.id==='side-composer')return Boolean(field.value.trim());
  if(['checkbox','radio'].includes(field.type))return field.checked!==field.defaultChecked;
  return field.value!==field.defaultValue;
 });
}
async function check(){
 if(busy)return;
 busy=true;
 try{
  const response=await fetch('/api/dev-reload',{cache:'no-store'});
  if(!response.ok)return;
  const current=(await response.json()).revision;
  if(!current)return;
  revision??=current;
  if(current!==revision)pending=current;
  if(pending&&!editing())location.reload();
 }catch{}finally{busy=false;}
}
void check();
setInterval(check,1000);
