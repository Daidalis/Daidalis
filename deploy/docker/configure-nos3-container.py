"""Apply only architecture and generated-source-directory adaptations to the VM recipe."""
import hashlib,pathlib,platform,subprocess
root=pathlib.Path('/opt/nos3-build');source=root/'configure_native.py'
text=source.read_text()
old="'CMAKE_SYSTEM_PROCESSOR      aarch64'"
assert text.count(old)==1
text=text.replace(old,repr('CMAKE_SYSTEM_PROCESSOR      '+{'x86_64':'amd64','aarch64':'aarch64'}[platform.machine()]))
old="'Kit', 'InOut', 'License', 'Makefile'"
assert text.count(old)==1
text=text.replace(old,"'Kit', 'InOut', 'License', 'MetaCode', 'Makefile'")
adapted=root/'configure-container.py';adapted.write_text(text)
subprocess.run(['python3',str(adapted),'--source','/srv/manta/source/nos3','--fortytwo','/srv/manta/source/42','--work','/srv/manta/nos3'],check=True)
