// Only this restricted subprocess loads the third-party WebAssembly kernel.
// The WASM kernel has no WASI imports. Node permissions deny writes,
// process spawning and worker creation; macOS sandbox additionally denies network.
// Sources arrive over stdin.
import fs from 'node:fs/promises';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
import {gunzipSync} from 'node:zlib';

try {
  const runtime=process.argv[2];
  let input='';for await(const chunk of process.stdin){input+=chunk;if(Buffer.byteLength(input)>1100000)throw Error('Model request exceeds limit');}
  const request=JSON.parse(input), api=await import(pathToFileURL(path.join(runtime,'sysmlv2.js')).href);
  await api.default({module_or_path:await fs.readFile(path.join(runtime,'sysmlv2_bg.wasm'))});
  const sourceJSON=JSON.stringify(request.sources);
  const syntax=JSON.parse(api.checkSyntax(sourceJSON));
  if(syntax.some(f=>f.stage==='parse'&&f.severity==='error')) {
    process.stdout.write(JSON.stringify({version:api.version(),findings:syntax,valid:false,scope:'sysml-v2-syntax-and-supported-semantic-rules',data:null}));
  } else {
    const bundle=gunzipSync(await fs.readFile(path.join(runtime,'stdlib/sysml-library.json.gz'))).toString('utf8');
    const recording=gunzipSync(await fs.readFile(path.join(runtime,'stdlib/sysml-library.libcache.gz')));
    const snapshot=gunzipSync(await fs.readFile(path.join(runtime,'stdlib/sysml-library.prepared.gz')));
    const library=api.PreparedLibrary.fromSnapshotStream(snapshot,bundle,recording);
    const session=api.Session.fromSourcesWithPreparedLibrary(sourceJSON,library);
    try {
      const findings=JSON.parse(session.check());
      // The kernel deliberately permits unresolved draft references as warnings.
      // Manta's import/acceptance gate treats referential warnings as failures.
      const valid=!findings.some(f=>f.severity==='error'||f.stage==='referential');
      let data;
      switch(request.operation){
        case 'query':data=request.query?JSON.parse(session.query(request.query)):JSON.parse(session.toGraph());break;
        case 'verify':data=JSON.parse(session.verify());break;
        case 'export':
          if(!valid)throw Error('Export requires a model with no errors or unresolved references');
          if(request.format==='compact-json')data=session.toCompactJson();
          else if(request.format==='full-json')data=session.toFullJson(true);
          else if(request.format==='plantuml')data=session.toPlantuml();
          else throw Error('Unknown export format');break;
        default:data={graph:JSON.parse(session.toGraph()),elementCount:JSON.parse(session.toCompactJson()).length};
      }
      process.stdout.write(JSON.stringify({version:api.version(),findings,valid,scope:'sysml-v2-syntax-and-supported-semantic-rules',data}));
    } finally {session.free();library.free();}
  }
} catch(error){process.stderr.write(String(error?.stack||error));process.exitCode=1;}
