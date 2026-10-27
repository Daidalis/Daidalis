import {createProfessionalRunnerService} from './professional-runner.mjs';
export function createProfessionalDispatcher(options){
 const numerical=createProfessionalRunnerService(options);let flight;
 async function flightRunner(){if(!flight){const module=await import('./stf-low-power.mjs');flight=module.createStfLowPowerRunner(options);}return flight;}
 return {
  async status(){const state=await numerical.status();let native;try{native=await (await flightRunner()).status();}catch(error){native={ready:false,state:'unavailable',reason:error.message};}return {...state,tools:{...state.tools,'nos3-stf':native}};},
  async prepare(ctx){const state=await numerical.prepare(ctx);return state;},
  async run(args,ctx){if(args.toolId==='nos3-stf')return (await flightRunner()).run(args,ctx);return numerical.run(args,ctx);},
  async close(){await numerical.close();await flight?.close?.();}
 };
}
