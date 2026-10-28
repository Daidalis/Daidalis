"""Execute the existing STF controller inside the dedicated, networkless flight container."""
import ast,hashlib,io,json,os,pathlib,sys
if os.getuid()==0 or os.environ.get('MANTA_FLIGHT_CONTAINER')!='1':raise RuntimeError('Dedicated non-root flight container required')
root=pathlib.Path('/opt/manta');reference=root/'vm/worker/stf-low-power-run.py'
source=reference.read_text();tree=ast.parse(source)
# Docker supplies the outer namespace. Preserve all model, hash, build and telemetry checks.
found=0
for node in tree.body:
    if isinstance(node,ast.FunctionDef) and node.name=='sandbox':
        node.body=ast.parse('return command').body;found+=1
assert found==1
class DescribeIsolation(ast.NodeTransformer):
    def visit_Constant(self,node):
        if isinstance(node.value,str) and node.value=='guest bubblewrap: private network/process/user/IPC namespaces; no host mounts, worker secrets or home':
            return ast.copy_location(ast.Constant('dedicated non-root flight container; no application credentials/project mounts; shared runtime between serialized jobs'),node)
        return node
tree=ast.fix_missing_locations(DescribeIsolation().visit(tree))
os.environ.clear();os.environ.update(PATH='/usr/bin:/bin',LANG='C.UTF-8',HOME='/tmp',TMPDIR='/tmp',CFS_APP_PATH='../components',MISSION_DEFS='../cfg/build/',MISSIONCONFIG='../cfg/build/nos3',OMP_NUM_THREADS='1',OPENBLAS_NUM_THREADS='1')
os.chdir('/srv/manta/stf-low-power')
stdout=sys.stdout;output=io.StringIO();sys.stdout=output
try:
    try:exec(compile(tree,str(reference),'exec'),{'__name__':'__main__','__file__':str(reference)})
    except SystemExit as error:
        if error.code not in (None,0):raise
finally:sys.stdout=stdout
result=json.loads(output.getvalue())
result['containerAdapterSha256']=hashlib.sha256(pathlib.Path(__file__).read_bytes()).hexdigest()
result['isolated']=True;result['isolation']='dedicated-flight-container'
if 'receipt' in result:result['receipt']['containerAdapterSha256']=result['containerAdapterSha256'];result['receipt']['isolation']=result['isolation']
print(json.dumps(result))
