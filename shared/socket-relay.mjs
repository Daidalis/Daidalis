// Acknowledged binary frames: at most one 64 KiB frame in flight per socket.
// No connection can accumulate an unbounded writable/readable queue.
export function createSocketRelay({send,maxConnections=8,maxBytes=64*1024*1024,idleMs=120000,lifetimeMs=300000}={}){
 const entries=new Map();let closed=false;
 const emit=message=>{try{send(message);}catch{close();}};
 function add(id,socket,{paused=false}={}){
  if(closed||typeof id!=='string'||!/^[a-zA-Z0-9-]{1,80}$/.test(id)||entries.has(id)||entries.size>=maxConnections){socket.destroy();throw Error('Egress connection unavailable');}
  const entry={socket,sent:0,received:0,waiting:false,writing:false};entries.set(id,entry);
  const timer=setTimeout(()=>socket.destroy(),lifetimeMs);timer.unref();
  socket.pause();socket.setTimeout(idleMs,()=>socket.destroy());
  const pump=()=>{
   if(entry.waiting||paused||socket.destroyed)return;
   const size=Math.min(socket.readableLength,65536);if(!size)return;
   const chunk=socket.read(size);if(!chunk)return;
   entry.sent+=chunk.length;if(entry.sent>maxBytes)return socket.destroy();
   entry.waiting=true;emit({type:'egress.data',id,data:chunk.toString('base64')});
  };
  entry.pump=pump;
  socket.on('readable',pump);
  socket.on('end',()=>{entry.ended=true;if(!entry.waiting)socket.end();});
  socket.on('error',()=>socket.destroy());
  socket.on('close',()=>{clearTimeout(timer);entries.delete(id);emit({type:'egress.close',id});});
  return {start(){paused=false;pump();}};
 }
 function handle(m){
  if(!m||!['egress.data','egress.ack','egress.close'].includes(m.type))return false;
  const entry=entries.get(m.id);if(!entry)return true;
  const {socket}=entry;
  if(m.type==='egress.close'){socket.destroy();return true;}
  if(m.type==='egress.ack'){
   if(!entry.waiting){socket.destroy();return true;}
   entry.waiting=false;entry.pump();if(entry.ended&&!entry.waiting)socket.end();return true;
  }
  if(entry.writing||typeof m.data!=='string'||m.data.length>87384||!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(m.data)){socket.destroy();return true;}
  const data=Buffer.from(m.data,'base64');entry.received+=data.length;
  if(!data.length||data.length>65536||entry.received>maxBytes){socket.destroy();return true;}
  entry.writing=true;socket.write(data,()=>{entry.writing=false;if(!socket.destroyed)emit({type:'egress.ack',id:m.id});});return true;
 }
 function close(){if(closed)return;closed=true;for(const {socket} of entries.values())socket.destroy();entries.clear();}
 return {add,handle,close,get size(){return entries.size;}};
}
