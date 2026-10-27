#!/usr/bin/python3
"""Prepare only project-local VM files from checksum-verified Ubuntu artifacts."""
import gzip
import hashlib
import json
import os
from pathlib import Path
import shutil
import subprocess
import tarfile

base = Path(__file__).resolve().parent.parent
assets = base / 'assets'
state = base / 'state'
state.mkdir(exist_ok=True)
(base / 'handoff').mkdir(exist_ok=True)

def sha256_file(file):
    result=hashlib.sha256()
    with file.open('rb') as source:
        for chunk in iter(lambda:source.read(1024*1024),b''):result.update(chunk)
    return result.hexdigest()

def reuse_prepared_guest():
    """Boot existing guest state without reopening a creation-only OS archive."""
    config_file=state/'config.json'
    manifest_file=state/'image-manifest.json'
    receipt_file=state/'native-ready.json'
    required=[config_file,manifest_file,receipt_file,state/'ubuntu.raw',state/'seed.iso',assets/'vmlinuz',assets/'initrd',base/'host/manta-vm']
    if not all(file.is_file() and not file.is_symlink() for file in required):return False
    config=json.loads(config_file.read_text());manifest=json.loads(manifest_file.read_text());receipt=json.loads(receipt_file.read_text())
    expected=dict(kernel=str(assets/'vmlinuz'),initrd=str(assets/'initrd'),disk=str(state/'ubuntu.raw'),seed=str(state/'seed.iso'),state=str(state),shared=str(base/'handoff'),cpu=4,memoryMiB=4096,minimumHostFreeGiB=5)
    if config!=expected:raise RuntimeError('Existing VM configuration differs from the fixed isolated runner')
    if manifest.get('architecture')!='arm64' or manifest.get('distribution')!='Ubuntu22.04':raise RuntimeError('Existing VM image manifest does not match the supported guest')
    if receipt.get('schema')!='manta-nos3-native-ready-v1' or receipt.get('ready') is not True:raise RuntimeError('Existing native readiness receipt is invalid')
    if not 1024**3 <= (state/'ubuntu.raw').stat().st_size <= 10*1024**3:raise RuntimeError('Existing VM disk exceeds the fixed resource cap')
    subprocess.run(['/usr/bin/codesign','--verify','--strict',str(base/'host/manta-vm')],check=True)
    prepared=manifest.get('preparedFiles')
    if prepared is None:
        # One-time upgrade of the original manifest: use the already pinned
        # compressed kernel, never the 603 MB rootfs creation archive.
        compressed=assets/'jammy-vmlinuz.part'
        if sha256_file(compressed)!=manifest['sha256']['jammy-server-cloudimg-arm64-vmlinuz-generic']:raise RuntimeError('Pinned kernel source integrity mismatch')
        result=hashlib.sha256()
        with gzip.open(compressed,'rb') as source:
            for chunk in iter(lambda:source.read(1024*1024),b''):result.update(chunk)
        prepared={'vmlinuz':result.hexdigest(),'initrd':manifest['sha256']['jammy-server-cloudimg-arm64-initrd-generic'],'seed.iso':sha256_file(state/'seed.iso')}
    for name,expected_hash in prepared.items():
        if name not in ['vmlinuz','initrd','seed.iso']:raise RuntimeError('Invalid prepared boot artifact')
        file=state/name if name=='seed.iso' else assets/name
        if sha256_file(file)!=expected_hash:raise RuntimeError('Prepared boot artifact integrity mismatch: '+name)
    manifest['preparedFiles']=prepared
    manifest_file.write_text(json.dumps(manifest,indent=2)+'\n')
    print(json.dumps({'reused':True,'creationArchiveRead':False,'config':str(config_file),'diskAllocatedBytes':(state/'ubuntu.raw').stat().st_blocks*512,'freeHostBytes':shutil.disk_usage(base).free},indent=2))
    return True

if reuse_prepared_guest():raise SystemExit(0)

def verify(path, manifest, filename):
    expected = next(line.split()[0] for line in manifest.read_text().splitlines() if line.split()[-1].lstrip('*') == filename)
    sha = hashlib.sha256()
    with path.open('rb') as handle:
        for chunk in iter(lambda: handle.read(8 * 1024 * 1024), b''):
            sha.update(chunk)
    actual = sha.hexdigest()
    if actual != expected:
        raise RuntimeError(f'Checksum mismatch for {filename}')
    return actual

checksums = {}
for local, manifest, name in [
    ('jammy-server-cloudimg-arm64.tar.gz.part', 'jammy-SHA256SUMS', 'jammy-server-cloudimg-arm64.tar.gz'),
    ('jammy-vmlinuz.part', 'jammy-unpacked-SHA256SUMS', 'jammy-server-cloudimg-arm64-vmlinuz-generic'),
    ('jammy-initrd.part', 'jammy-unpacked-SHA256SUMS', 'jammy-server-cloudimg-arm64-initrd-generic'),
]:
    checksums[name] = verify(assets / local, assets / manifest, name)

disk = state / 'ubuntu.raw'
if not disk.exists():
    with tarfile.open(assets / 'jammy-server-cloudimg-arm64.tar.gz.part', 'r|gz') as archive:
        for entry in archive:
            if entry.name != 'jammy-server-cloudimg-arm64.img' or not entry.isfile():
                continue
            source = archive.extractfile(entry)
            with disk.open('xb') as target:
                while True:
                    block = source.read(1024 * 1024)
                    if not block:
                        break
                    if block.count(0) == len(block):
                        target.seek(len(block), 1)
                    else:
                        target.write(block)
                target.truncate(entry.size)
            break
    if not disk.exists():
        raise RuntimeError('Verified archive did not contain expected raw disk')
    with disk.open('r+b') as target:
        target.truncate(10 * 1024**3)

kernel = assets / 'vmlinuz'
if not kernel.exists():
    with gzip.open(assets / 'jammy-vmlinuz.part', 'rb') as source, kernel.open('xb') as target:
        shutil.copyfileobj(source, target)
initrd = assets / 'initrd'
if not initrd.exists():
    shutil.copyfile(assets / 'jammy-initrd.part', initrd)

key = state / 'id_ed25519'
if not key.exists():
    subprocess.run(['/usr/bin/ssh-keygen', '-q', '-t', 'ed25519', '-N', '', '-C', 'manta-project-linux-vm', '-f', str(key)], check=True)
public_key = key.with_suffix('.pub').read_text().strip()
seed = state / 'seed'
seed.mkdir(exist_ok=True)
(seed / 'meta-data').write_text('instance-id: manta-nos3-jammy-arm64-v1\nlocal-hostname: manta-nos3\n')
userdata = '''#cloud-config
users:
  - name: manta
    gecos: Manta isolated engineering runner
    groups: [adm, sudo]
    shell: /bin/bash
    sudo: ALL=(ALL) NOPASSWD:ALL
    lock_passwd: true
    ssh_authorized_keys:
      - PUBLIC_KEY
ssh_pwauth: false
disable_root: true
package_update: false
package_upgrade: false
growpart:
  mode: auto
  devices: ['/']
resize_rootfs: true
write_files:
  - path: /usr/local/lib/manta/vsock-ssh.py
    owner: root:root
    permissions: '0755'
    content: |
      #!/usr/bin/python3
      import socket, threading, select
      def relay(client):
          upstream = socket.create_connection(('127.0.0.1',22))
          try:
              while True:
                  ready, _, _ = select.select([client,upstream],[],[])
                  for source in ready:
                      data = source.recv(65536)
                      if not data: return
                      (upstream if source is client else client).sendall(data)
          finally:
              client.close(); upstream.close()
      listener = socket.socket(socket.AF_VSOCK,socket.SOCK_STREAM)
      listener.bind((socket.VMADDR_CID_ANY,2222)); listener.listen(16)
      while True:
          connection, _ = listener.accept()
          threading.Thread(target=relay,args=(connection,),daemon=True).start()
  - path: /etc/systemd/system/manta-vsock-ssh.service
    permissions: '0644'
    content: |
      [Unit]
      Description=Manta project-only SSH over Virtio socket
      After=ssh.service
      [Service]
      ExecStart=/usr/bin/python3 /usr/local/lib/manta/vsock-ssh.py
      Restart=on-failure
      RestartSec=2
      [Install]
      WantedBy=multi-user.target
  - path: /etc/ssh/sshd_config.d/99-manta-vsock-only.conf
    permissions: '0644'
    content: |
      ListenAddress 127.0.0.1
      PasswordAuthentication no
      PermitRootLogin no
runcmd:
  - [systemctl, daemon-reload]
  - [systemctl, restart, ssh]
  - [systemctl, enable, --now, manta-vsock-ssh.service]
  - [mkdir, -p, /mnt/manta-transfer]
  - [sh, -c, 'echo "manta-transfer /mnt/manta-transfer virtiofs defaults,nofail 0 0" >> /etc/fstab']
  - [mount, /mnt/manta-transfer]
  - [sh, -c, 'printf "MANTA_GUEST_READY\\n" > /dev/hvc0']
'''.replace('PUBLIC_KEY', public_key)
(seed / 'user-data').write_text(userdata)
seed_iso = state / 'seed.iso'
if not seed_iso.exists():
    subprocess.run(['/usr/bin/hdiutil','makehybrid','-iso','-joliet','-default-volume-name','cidata','-o',str(seed_iso),str(seed)],check=True)
config = dict(kernel=str(kernel),initrd=str(initrd),disk=str(disk),seed=str(seed_iso),state=str(state),shared=str(base/'handoff'),cpu=4,memoryMiB=4096,minimumHostFreeGiB=5)
(state / 'config.json').write_text(json.dumps(config,indent=2)+'\n')
(state / 'image-manifest.json').write_text(json.dumps(dict(source='https://cloud-images.ubuntu.com/jammy/20261020/',sha256=checksums,architecture='arm64',distribution='Ubuntu22.04',diskVirtualGiB=10,preparedFiles={'vmlinuz':sha256_file(kernel),'initrd':sha256_file(initrd),'seed.iso':sha256_file(seed_iso)}),indent=2)+'\n')
os.chmod(key,0o600)
print(json.dumps({'config':str(state/'config.json'),'diskLogicalBytes':disk.stat().st_size,'diskAllocatedBytes':disk.stat().st_blocks*512,'freeHostBytes':shutil.disk_usage(base).free},indent=2))
