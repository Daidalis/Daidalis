"""One fresh native flight filesystem per broker job; reuse evidence validation."""
import importlib.util,json,pathlib,sys
p=pathlib.Path(__file__).resolve().parents[1]/'flight/service.py'
spec=importlib.util.spec_from_file_location('flight_service',p);service=importlib.util.module_from_spec(spec);spec.loader.exec_module(service)
handler=service.Handler.__new__(service.Handler)
handler.gone=lambda:False
if sys.argv[1] not in ('status','nos3'):raise ValueError('Unsupported flight task')
print(json.dumps(handler.dispatch({'method':sys.argv[1],'payload':json.load(sys.stdin) if sys.argv[1]=='nos3' else None})))
