#!/usr/bin/env python3
"""Run real NOS Engine + 42 + star tracker simulator + cFS, recording UDP telemetry.

Ground scheduling sends only real cFS commands. No attitude/truth samples are
injected into the flight Software Bus. A separate verifier checks measured data.
"""
import argparse
import base64
import collections
import json
import os
import pathlib
import pty
import signal
import socket
import struct
import subprocess
import threading
import time

p = argparse.ArgumentParser()
p.add_argument('--work', type=pathlib.Path, default=pathlib.Path('/srv/manta/nos3'))
p.add_argument('--output', type=pathlib.Path, required=True)
p.add_argument('--duration', type=float, default=25)
a = p.parse_args()
if os.uname().sysname != 'Linux':
    raise SystemExit('Run only inside the dedicated Linux VM')
if not 5 <= a.duration <= 120:
    raise SystemExit('Duration outside bounded 5..120 seconds')
work, out = a.work.resolve(), a.output.resolve()
if not str(work).startswith('/srv/manta/') or not str(out).startswith('/srv/manta/'):
    raise SystemExit('Use private /srv/manta paths')
out.mkdir(parents=True, exist_ok=False)
simdir = work / 'sims/build/bin'
fswdir = work / 'fsw/build/exe/cpu1'
f42 = work.parent / '42'
processes, logs, terminals = [], [], []
receivers = []
for label, port in [('telemetry', 5013), ('truth', 5111)]:
    s = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
    s.bind(('127.0.0.1', port))
    s.setblocking(False)
    receivers.append((label, s))
cmd = socket.socket(socket.AF_INET, socket.SOCK_DGRAM)
seq = collections.defaultdict(int)
counts = collections.Counter()
env = dict(os.environ, LD_LIBRARY_PATH=str(work / 'sims/build/lib') + ':/usr/lib', TERM='xterm')

def start(label, args, cwd):
    log = (out / (label + '.log')).open('wb')
    logs.append(log)
    if label == 'time':
        # The production TimeDriver uses ncurses. Give it a private terminal;
        # no graphical window, host terminal, or replacement clock is needed.
        master, slave = pty.openpty()
        proc = subprocess.Popen(list(map(str, args)), cwd=cwd, stdin=slave, stdout=slave,
                                stderr=subprocess.STDOUT, env=env)
        os.close(slave)
        def capture_terminal():
            try:
                while True:
                    chunk = os.read(master, 65536)
                    if not chunk:
                        break
                    log.write(chunk)
                    log.flush()
            except OSError:
                pass
        reader = threading.Thread(target=capture_terminal, daemon=True)
        reader.start()
        terminals.append((master, reader))
    else:
        proc = subprocess.Popen(['stdbuf', '-oL', '-eL'] + list(map(str, args)), cwd=cwd,
                                stdin=subprocess.PIPE, stdout=log, stderr=subprocess.STDOUT, env=env)
    processes.append((label, proc))
    return proc

commands = (out / 'commands.jsonl').open('w')
packets = (out / 'packets.jsonl').open('w')

def send(mid, fc=0, payload=b''):
    sequence = seq[mid] & 0x3fff
    seq[mid] += 1
    body = bytearray(struct.pack('>HHHBB', mid, 0xc000 | sequence, len(payload) + 1, fc, 0) + payload)
    chk = 0xff
    for v in body:
        chk ^= v
    body[7] = chk
    cmd.sendto(body, ('127.0.0.1', 5012))
    commands.write(json.dumps({'wallTime': time.time(), 'mid': hex(mid), 'functionCode': fc,
                               'packetHex': body.hex()}) + '\n')

def cancelled(signum, frame):
    # All children remain in the worker campaign process group, so even the
    # worker's final hard-stop reaches them. A normal stop still runs cleanup.
    signal.signal(signal.SIGTERM, signal.SIG_IGN)
    signal.signal(signal.SIGINT, signal.SIG_IGN)
    raise SystemExit(128 + signum)

signal.signal(signal.SIGTERM, cancelled)
signal.signal(signal.SIGINT, cancelled)

try:
    start('nosengine', ['/usr/bin/nos_engine_server_standalone', '-f', simdir / 'nos_engine_server_config.json'], simdir)
    time.sleep(1)
    start('fortytwo', [f42 / '42', 'NOS3InOut'], f42)
    start('truth42sim', [simdir / 'nos3-single-simulator', '-f', 'nos3-simulator.xml', 'truth42sim'], simdir)
    start('startracker', [simdir / 'nos3-single-simulator', '-f', 'nos3-simulator.xml', 'generic-star-tracker-sim'], simdir)
    time.sleep(1)
    start('fsw', [fswdir / 'core-cpu1', '-R', 'PO'], fswdir)
    start('time', [simdir / 'nos3-single-simulator', '-f', 'nos3-simulator.xml', 'time'], simdir)
    warmup = time.monotonic()
    while True:
        fsw_log = (out / 'fsw.log').read_text(errors='replace')
        st_log = (out / 'startracker.log').read_text(errors='replace')
        if 'CFE_ES_Main entering OPERATIONAL state' in fsw_log and 'Construction complete.' in st_log:
            break
        failed = [(name, proc.returncode) for name, proc in processes if proc.poll() is not None]
        if failed:
            raise RuntimeError('Startup process exited: ' + repr(failed))
        if time.monotonic() - warmup > 45:
            raise RuntimeError('Timed out waiting for actual cFS OPERATIONAL state and star-tracker UART readiness')
        time.sleep(.1)
    warmup_seconds = time.monotonic() - warmup
    began = time.monotonic()
    next_tick = began
    cycles = 0
    while time.monotonic() - began < a.duration:
        now = time.monotonic()
        # The production PSP and 42 receive the same NOS Engine 100 Hz time.
        # A headless ground client schedules the selected sensor chain at 10 Hz.
        if now >= next_tick:
            next_tick += .1
            if cycles == 0:
                send(0x18e8, 2, b'127.0.0.1'.ljust(16, b'\0'))
                send(0x1935, 2)  # Enable the actual star-tracker flight application.
            send(0x1936, 1)  # Request real UART device telemetry.
            time.sleep(.015)
            send(0x1942)  # Execute actual production ADAC update.
            for fc in [3, 4, 5]:
                send(0x1940, fc)  # Publish DI, AD and GNC Software Bus telemetry.
            cycles += 1
        for label, s in receivers:
            while True:
                try:
                    data, address = s.recvfrom(65535)
                except BlockingIOError:
                    break
                mid = hex(struct.unpack_from('>H', data)[0]) if len(data) >= 2 else 'short'
                counts[label + ':' + mid] += 1
                packets.write(json.dumps({'wallTime': time.time(), 'source': label, 'mid': mid,
                                          'length': len(data), 'packetBase64': base64.b64encode(data).decode()}) + '\n')
        failed = [(name, proc.returncode) for name, proc in processes if proc.poll() is not None]
        if failed:
            raise RuntimeError('Simulation process exited: ' + repr(failed))
        time.sleep(.003)
    (out / 'run.json').write_text(json.dumps({'status': 'executed', 'durationSeconds': a.duration,
        'cycles': cycles, 'warmupSeconds': warmup_seconds, 'packets': counts, 'pids': {name: proc.pid for name, proc in processes},
        'scope': 'Live NOS Engine + 42 + star-tracker UART simulator + cFS CI/SB/ADCS/TO; no synthetic truth injection',
        'validation': 'Execution receipt only; independent verifier decides validity.'}, indent=2) + '\n')
finally:
    for name, proc in reversed(processes):
        if proc.poll() is None:
            proc.terminate()
    for name, proc in processes:
        try:
            proc.wait(timeout=4)
        except subprocess.TimeoutExpired:
            proc.kill()
            proc.wait(timeout=2)
        if proc.stdin:
            proc.stdin.close()
    for master, reader in terminals:
        reader.join(timeout=2)
        os.close(master)
    for log in logs:
        log.close()
    for _, s in receivers:
        s.close()
    cmd.close()
    commands.close()
    packets.close()
print(out)
