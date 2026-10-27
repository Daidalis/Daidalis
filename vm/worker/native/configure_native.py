#!/usr/bin/env python3
"""Configure a native ARM64 NOS3 verification mission in a private Linux copy.

The flight components, cFE, OSAL, PSP, NOS Engine and 42 are original NASA code.
This mission selects the star-tracker/ADCS chain and UDP CI/TO ground interfaces.
"""
import argparse
import pathlib
import re
import shutil
import tarfile
import time

def plain_copy(source, destination):
    # virtiofs/macOS xattrs are not Linux source metadata. Do not copy xattrs or
    # use copy_file_range/sendfile across the shared-directory boundary.
    source, destination = pathlib.Path(source), pathlib.Path(destination)
    for attempt in range(8):
        try:
            with source.open('rb') as inp, destination.open('wb') as out:
                shutil.copyfileobj(inp, out, length=1024 * 1024)
            break
        except OSError as exc:
            if exc.errno != 35 or attempt == 7:
                raise
            time.sleep(.1 * (attempt + 1))
    destination.chmod(source.stat().st_mode & 0o777)
    return str(destination)

p = argparse.ArgumentParser()
p.add_argument('--source', type=pathlib.Path, required=True)
p.add_argument('--fortytwo', type=pathlib.Path, required=True)
p.add_argument('--work', type=pathlib.Path, required=True)
a = p.parse_args()
src, work = a.source.resolve(), a.work.resolve()
if src == work or not str(work).startswith('/srv/manta/'):
    raise SystemExit('Work must be a separate /srv/manta/ directory inside Linux')
if not (work / '.manta-isolated-nos3').exists():
    archive = src.parents[1] / 'nos3-source.tar.gz'
    if archive.exists() and work.name == 'nos3':
        # One compact source archive avoids repeated virtiofs per-file read
        # locking observed with this macOS host. Extract only safe source paths.
        work.parent.mkdir(parents=True, exist_ok=True)
        with tarfile.open(archive, 'r:gz') as tf:
            for member in tf.getmembers():
                path = pathlib.PurePosixPath(member.name)
                if not path.parts or path.parts[0] != 'nos3' or '..' in path.parts or path.is_absolute():
                    raise RuntimeError('Unsafe staged source archive')
            tf.extractall(work.parent)
    else:
        shutil.copytree(src, work, symlinks=True, dirs_exist_ok=True, copy_function=plain_copy,
                        ignore=shutil.ignore_patterns('.git', 'artifacts', 'engineering', '.manta'))
(work / '.manta-isolated-nos3').write_text('Private Linux verification copy; original host project untouched.\n')
build = work / 'cfg/build'
build.mkdir(parents=True, exist_ok=True)
for name in ['InOut', 'nos3_defs', 'sims']:
    shutil.copytree(work / 'cfg' / name, build / name, dirs_exist_ok=True)
defs = build / 'nos3_defs'
target = (defs / 'targets.cmake').read_text()
target = re.sub(r'list\(APPEND MISSION_GLOBAL_APPLIST\b.*?\n\)', '''list(APPEND MISSION_GLOBAL_APPLIST
    hwlib
    ci_lab
    to_lab
    sch
    generic_adcs/fsw/cfs
    generic_star_tracker/fsw/cfs
)''', target, count=1, flags=re.S)
(defs / 'targets.cmake').write_text(target)
# Labels in upstream targets are historical; actual compiler and ELF are native ARM64.
toolchain = defs / 'toolchain-amd64-nos3.cmake'
toolchain.write_text(toolchain.read_text().replace('CMAKE_SYSTEM_PROCESSOR      amd64', 'CMAKE_SYSTEM_PROCESSOR      aarch64'))
startup = '''CFE_LIB, hwlib, HWLIB_Init, HW_LIB, 0, 0, 0x0, 0;
CFE_APP, sch, SCH_AppMain, SCH, 40, 16384, 0x0, 0;
CFE_APP, ci_lab, CI_LAB_AppMain, CI_LAB_APP, 80, 16384, 0x0, 0;
CFE_APP, to_lab, TO_LAB_AppMain, TO_LAB_APP, 81, 32768, 0x0, 0;
CFE_APP, generic_adcs, ADCS_AppMain, ADCS, 60, 32768, 0x0, 0;
CFE_APP, generic_st, ST_AppMain, ST, 72, 32768, 0x0, 0;
!
'''
# Keep the exact entrypoint from the pinned source.
startup = startup.replace('HWLIB_Init', 'hwlib_Init').replace('CI_LAB_AppMain', 'CI_Lab_AppMain')
(defs / 'cpu1_cfe_es_startup.scr').write_text(startup)
# Use the scheduler's core-only table rather than unrelated mission apps.
for name in ['sch_def_msgtbl.c', 'sch_def_schtbl.c']:
    shutil.copyfile(work / 'fsw/apps/sch/fsw/tables' / name, defs / 'tables' / name)
# Retain core, CI/TO and selected-chain subscriptions. These are actual SB messages.
table = (work / 'fsw/apps/to_lab/fsw/tables/to_lab_sub.c').read_text()
table = table.replace('/* CFE_SB_MSGID_RESERVED entry', '''{CFE_SB_MSGID_WRAP_VALUE(0x0935), {0, 0}, 32},
                                      {CFE_SB_MSGID_WRAP_VALUE(0x0936), {0, 0}, 32},
                                      {CFE_SB_MSGID_WRAP_VALUE(0x0940), {0, 0}, 32},
                                      {CFE_SB_MSGID_WRAP_VALUE(0x0941), {0, 0}, 32},
                                      {CFE_SB_MSGID_WRAP_VALUE(0x0942), {0, 0}, 32},
                                      {CFE_SB_MSGID_WRAP_VALUE(0x0943), {0, 0}, 32},
                                      /* CFE_SB_MSGID_RESERVED entry''')
(defs / 'tables/to_lab_sub.c').write_text(table)
# Runtime references use guest loopback aliases; no macOS DNS or network changes.
# The pinned upstream configuration uses numeric-leading tags (e.g.
# <42-css-scale-factor>) accepted by Boost property_tree but not XML parsers.
# Preserve that exact format and edit only bounded simulator sections.
xml_path = build / 'sims/nos3-simulator.xml'
xml = xml_path.read_text()
def select_sim(match):
    block = match.group(0)
    name = re.search(r'<name>([^<]+)</name>', block).group(1)
    active = 'true' if name in ['time', 'truth42sim', 'generic-star-tracker-sim'] else 'false'
    return re.sub(r'<active>[^<]+</active>', f'<active>{active}</active>', block, count=1)
xml = re.sub(r'<simulator>.*?</simulator>', select_sim, xml, flags=re.S)
xml = re.sub(r'tcp://[^:<\s]+:(1200[01])', r'tcp://127.0.0.1:\1', xml)
xml = re.sub(r'<(hostname|cosmos-hostname)>[^<]+</\1>', lambda m: f'<{m.group(1)}>127.0.0.1</{m.group(1)}>', xml)
xml_path.write_text(xml)
sim = build / 'InOut/Inp_Sim.txt'
text = (work / 'cfg/InOut/Inp_Sim_STF1.txt').read_text()
text = re.sub(r'^TRUE\s+!\s+Graphics Front End\?', 'FALSE                           !  Graphics Front End?', text, flags=re.M)
text = re.sub(r'^604800\.0\s+0\.01', '120.0   0.01', text, flags=re.M)
sim.write_text(text)
ipc = build / 'InOut/Inp_IPC.txt'
lines = ipc.read_text().splitlines(keepends=True)
enabled = False
for i, line in enumerate(lines):
    if line.startswith('***'):
        enabled = 'Star Tracker IPC' in line or 'Truth data' in line
    if 'IPC Mode (' in line and not enabled:
        lines[i] = 'OFF                                     ! IPC Mode (OFF,TX,RX,TXRX,ACS,WRITEFILE,READFILE)\n'
ipc.write_text(''.join(lines))
nos3 = build / 'InOut/Inp_NOS3.txt'
nos3.write_text(nos3.read_text().replace('nos-engine-server', '127.0.0.1'))
f42 = work.parent / '42'
if not f42.exists():
    f42.mkdir()
    for child in a.fortytwo.resolve().iterdir():
        if child.name in ['World', 'Model']:
            private_assets = pathlib.Path('/srv/manta/42-assets') / child.name
            (f42 / child.name).symlink_to(private_assets if private_assets.exists() else child)
        elif child.name in ['Source', 'Include', 'Kit', 'InOut', 'License', 'Makefile']:
            if child.is_dir():
                shutil.copytree(child, f42 / child.name, copy_function=plain_copy)
            else:
                plain_copy(child, f42 / child.name)
    (f42 / 'Object').mkdir(exist_ok=True)
for name in ['Model', 'World']:
    private_assets = pathlib.Path('/srv/manta/42-assets') / name
    target = f42 / name
    if private_assets.exists() and target.is_symlink() and target.resolve() != private_assets:
        target.unlink()
        target.symlink_to(private_assets)
(f42 / '.manta-isolated-42').write_text('Private Linux verification copy of NASA 42.\n')
shutil.copytree(build / 'InOut', f42 / 'NOS3InOut', dirs_exist_ok=True)
print('Configured native mission:', work)
