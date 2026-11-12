export const DEFAULT_EXECUTION_BUDGET=Object.freeze({maxRunTurns:64,maxRunContinuations:1,runTimeoutMs:7200000,commandTimeoutMs:300000});
export const MAX_COMMAND_TIMEOUT_MS=1800000;
export const RESOURCE_LIMITS=Object.freeze({maxConcurrentAgents:[1,32],maxTasksPerRun:[1,100],maxAutoResumes:[0,10],maxAutoTurns:[1,12],maxAutoRunMs:[1000,300000],maxRunTurns:[2,200],maxRunContinuations:[0,3],runTimeoutMs:[1800000,28800000],commandTimeoutMs:[1000,MAX_COMMAND_TIMEOUT_MS]});

export function commandTimeout(value=DEFAULT_EXECUTION_BUDGET.commandTimeoutMs){
  if(!Number.isSafeInteger(value)||value<1||value>MAX_COMMAND_TIMEOUT_MS)throw Error('Command timeout must be a positive integer up to 1800000 milliseconds');
  return value;
}
