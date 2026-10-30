export function createTaskRunner({invoke,isolated=false}){
  let cached=null,checked=0,pending=null;
  async function status(){
    if(pending)return pending;
    if(cached&&Date.now()-checked<30000)return cached;
    pending=(async()=>{
      try{
        const state=await invoke({kind:'probe',timeoutMs:20000});
        cached={...state,available:true,status:state.ready===true?'ready':'unavailable',isolated:state.ready===true&&isolated};
      }catch(error){cached={available:false,ready:false,status:'unavailable',reason:error.message,tools:{}};}
      checked=Date.now();return cached;
    })();
    try{return await pending;}finally{pending=null;}
  }
  return {status,async prepare(){checked=0;const state=await status();if(!state.ready)throw Error(state.reason||'Task runner is not ready');return state;},
    async run(args,ctx={}){return invoke({...args,kind:'professional',timeoutMs:600000},ctx);},async close(){}};
}
