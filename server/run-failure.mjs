export function describeRuntimeFailure(error,events=[]){
  if(/(?:\b429\b.*Too Many Requests|rate.?limit)/i.test(error.message||''))return `模型服务拒绝了本次请求，可能触发限流或额度限制（${error.message}）。请检查服务端配额，稍后重试或切换连接。已有文件和执行记录仍保留。`;
  if(!/request timed out|request timeout/i.test(error.message||''))return error.message;
  const lastModelEvent=[...events].reverse().find(e=>['sdk.model.started','sdk.model.completed'].includes(e.type));
  if(lastModelEvent?.type!=='sdk.model.started')return error.message;
  return `等待模型服务回复超时（${error.message}）。本次模型请求未返回；请在设置中测试连接，或切换可用连接后在此线程重试。已有文件和执行记录仍保留；超时不代表工程验证失败。`;
}

// Turn-budget exhaustion is resumable; retain the last concrete tool failure.
export function describeRunFailure(error,events=[]){
  const failure=[...events].reverse().find(e=>e.type==='tool.completed'&&(e.data?.result?.error||e.data?.result?.executionSucceeded===false));
  const result=failure?.data?.result;
  const detail=result?.error||(result?.diagnostics||'').split('\n').find(line=>/Cannot fork|Resource temporarily unavailable|Error:|error:/i.test(line));
  return `已达到本轮执行预算（${error.message}）。已有文件、求解记录和会话已保留；可在此线程继续。${detail?` 最近失败的工具：${failure.data.tool}；原因：${String(detail).slice(0,600)}`:''}`;
}
