import importlib.util,json,sys,pathlib
p=pathlib.Path(__file__).resolve().parents[1]/'desktop/service.py'
spec=importlib.util.spec_from_file_location('desktop',p);desktop=importlib.util.module_from_spec(spec);spec.loader.exec_module(desktop)
desktop.start()
for line in sys.stdin:
    try:
        request=json.loads(line)
        result=desktop.action(request['payload'])
        print(json.dumps({'id':request['id'],'result':result}),flush=True)
    except Exception as error:
        print(json.dumps({'id':request.get('id'),'error':str(error)}),flush=True)
