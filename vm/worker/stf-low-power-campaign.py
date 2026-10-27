import pathlib,subprocess,os,time,socket,struct,collections,json,base64,signal,threading,pty,csv,argparse
p=argparse.ArgumentParser();p.add_argument('--output',required=True);p.add_argument('--duration',type=float,default=96);a=p.parse_args()
work=pathlib.Path('/srv/manta/stf-low-power');out=pathlib.Path(a.output);out.mkdir(parents=True,exist_ok=False)
simdir=work/'sims/build/bin';fswdir=work/'fsw/build/exe/cpu1';f42=work/'42run';processes=[];logs=[];terminals=[]
env=dict(os.environ,LD_LIBRARY_PATH=str(work/'sims/build/lib')+':/usr/lib',TERM='xterm');receiver=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);receiver.bind(('127.0.0.1',5013));receiver.setblocking(False);cmd=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);simcmd=socket.socket(socket.AF_INET,socket.SOCK_DGRAM);simcmd.setblocking(False);seq=collections.defaultdict(int);commands=(out/'commands.jsonl').open('w');packets=(out/'packets.jsonl').open('w');rows=[];mgr=None;counts=collections.Counter();phase='startup'
def start(name,args,cwd):
 log=(out/(name+'.log')).open('wb');logs.append(log)
 if name=='time':
  master,slave=pty.openpty();proc=subprocess.Popen([str(x) for x in args],cwd=cwd,stdin=slave,stdout=slave,stderr=subprocess.STDOUT,env=env);os.close(slave)
  def capture():
   try:
    while True:
     chunk=os.read(master,65536)
     if not chunk:break
     log.write(chunk);log.flush()
   except OSError:pass
  thread=threading.Thread(target=capture,daemon=True);thread.start();terminals.append((master,thread))
 else:proc=subprocess.Popen(['stdbuf','-oL','-eL']+[str(x) for x in args],cwd=cwd,stdin=subprocess.PIPE,stdout=log,stderr=subprocess.STDOUT,env=env)
 processes.append((name,proc));return proc

def send(mid,fc=0,payload=b''):
 body=bytearray(struct.pack('>HHHBB',mid,0xc000|(seq[mid]&0x3fff),len(payload)+1,fc,0)+payload);seq[mid]+=1;check=0xff
 for b in body:check^=b
 body[7]=check;cmd.sendto(body,('127.0.0.1',5012));commands.write(json.dumps({'time':time.monotonic()-began if 'began' in globals() else None,'mid':hex(mid),'functionCode':fc,'packetHex':body.hex()})+'\n')
def sim(text):simcmd.sendto(text.encode(),('127.0.0.1',5556));commands.write(json.dumps({'time':time.monotonic()-began,'simCommand':text})+'\n')
def stop(signum,frame):raise SystemExit(128+signum)
signal.signal(signal.SIGTERM,stop);signal.signal(signal.SIGINT,stop)
try:
 start('nosengine',['/usr/bin/nos_engine_server_standalone','-f',simdir/'nos_engine_server_config.json'],simdir);time.sleep(1)
 start('fortytwo',[f42/'42','InOut'],f42)
 for name in ['truth42sim','generic-star-tracker-sim','generic-eps-sim','sample-sim','udp-terminal']:start(name,[simdir/'nos3-single-simulator','-f','nos3-simulator.xml',name],simdir)
 time.sleep(1);start('fsw',[fswdir/'core-cpu1','-R','PO'],fswdir);start('time',[simdir/'nos3-single-simulator','-f','nos3-simulator.xml','time'],simdir)
 warm=time.monotonic()
 while 'CFE_ES_Main entering OPERATIONAL state' not in (out/'fsw.log').read_text(errors='replace') or 'Construction complete.' not in (out/'generic-eps-sim.log').read_text(errors='replace'):
  dead=[(n,p.returncode) for n,p in processes if p.poll() is not None]
  if dead:raise RuntimeError('Startup process exited '+repr(dead))
  if time.monotonic()-warm>45:raise RuntimeError('Timed out waiting for cFS OPERATIONAL')
  time.sleep(.1)
 began=time.monotonic();tick=began;cycle=0;done=set()
 while time.monotonic()-began<a.duration:
  t=time.monotonic()-began
  if t>=0 and 'ground' not in done:
   done.add('ground');send(0x18e8,2,b'127.0.0.1'.ljust(16,b'\0'));sim('SET SIMNODE eps-command');sim('WRITE STATE_OF_CHARGE=65')
  if t>=5 and 'init' not in done:
   done.add('init');phase='science_entry';send(0x18e8,2,b'127.0.0.1'.ljust(16,b'\0'));send(0x18A4,2,struct.pack('<HH',1,0));send(0x18F8,2,b'\x03');sim('SET SIMNODE eps-command');sim('WRITE STATE_OF_CHARGE=65');send(0x191A,2,bytes([7,0xAA]));send(0x18A9,7,struct.pack('<HH',26,0));send(0x18A9,4,struct.pack('<HH',26,0))
  if t>=27 and 'above' not in done:done.add('above');phase='above_critical';sim('WRITE STATE_OF_CHARGE=55')
  if t>=40 and 'critical' not in done:done.add('critical');phase='below_critical';sim('WRITE STATE_OF_CHARGE=35')
  if t>=55 and 'restore' not in done:
   done.add('restore');phase='reenter_science';sim('WRITE STATE_OF_CHARGE=65');send(0x18F8,2,b'\x03');send(0x18A9,7,struct.pack('<HH',26,0));send(0x18A9,4,struct.pack('<HH',26,0))
  if t>=76 and 'onagain' not in done:done.add('onagain');phase='reentry_above';send(0x191A,2,bytes([7,0xAA]))
  if t>=80 and 'criticalagain' not in done:done.add('criticalagain');phase='reentry_critical';sim('WRITE STATE_OF_CHARGE=35')
  for switch in range(8):
   marker='on-'+str(switch)
   if t>=30+switch*.25 and marker not in done:done.add(marker);send(0x191A,2,bytes([switch,0xAA]))
  if time.monotonic()>=tick:
   tick+=.2;send(0x191B);send(0x18A5);send(0x18AA);
   if t>=5:send(0x18A6,0,struct.pack('<HHHH',1,40,1,0))
   if cycle%5==0:send(0x18AB);send(0x18F9)
   cycle+=1
  while True:
   try:data,_=receiver.recvfrom(65535)
   except BlockingIOError:break
   mid=struct.unpack_from('>H',data)[0] if len(data)>=2 else 0;counts[hex(mid)]+=1;packets.write(json.dumps({'time':t,'mid':hex(mid),'length':len(data),'packetBase64':base64.b64encode(data).decode()})+'\n')
   if mid==0x08f8 and len(data)>18:mgr=data[18]
   if mid==0x091a and len(data)>=84:
    battery=struct.unpack_from('<H',data,20)[0];switches=[struct.unpack_from('<H',data,40+6*i)[0]&0xff for i in range(8)];rows.append([t,battery,mgr,*switches,phase])
  for label,proc in processes:
   if proc.poll() is not None:raise RuntimeError('Process exited '+label+' '+str(proc.returncode))
  time.sleep(.01)
 with (out/'eps-telemetry.csv').open('w') as f:
  w=csv.writer(f);w.writerow(['time','batteryMillivolts','mode',*[f'switch{i}' for i in range(8)],'phase']);w.writerows(rows)
 (out/'run.json').write_text(json.dumps({'status':'executed','rows':len(rows),'counts':counts,'duration':a.duration,'scope':'Actual NOS Engine + 42 + EPS I2C simulator + cFS EPS/LC/SC/MGR/SAMPLE. CI test client schedules app messages; complete original mission scheduler remains unverified.'},indent=2))
 print(json.dumps({'rows':len(rows),'counts':counts,'last':rows[-1] if rows else None}),flush=True)
finally:
 for name,proc in reversed(processes):
  if proc.poll() is None:proc.terminate()
 for name,proc in processes:
  try:proc.wait(timeout=4)
  except subprocess.TimeoutExpired:proc.kill();proc.wait(timeout=2)
  if proc.stdin:proc.stdin.close()
 for master,thread in terminals:thread.join(timeout=2);os.close(master)
 for log in logs:log.close()
 receiver.close();cmd.close();simcmd.close();commands.close();packets.close()
