#!/usr/bin/env python3
"""Live read-only readiness probe for Manta's isolated GDAL/PROJ worker."""
import hashlib
import json
import os
import pathlib
import subprocess
import sys

RECEIPT = pathlib.Path('/srv/manta/receipts/geospatial-ready.json')
WORKER = pathlib.Path('/srv/manta/geospatial-worker/geospatial-run.py')
PINNED = {
    'python3-gdal': '3.4.1+dfsg-1build4',
    'gdal-bin': '3.4.1+dfsg-1build4',
    'proj-bin': '8.2.1-1',
}


def digest(file):
    return hashlib.sha256(pathlib.Path(file).read_bytes()).hexdigest()


def packages():
    result = subprocess.check_output(['dpkg-query', '-W', '-f=${Package}=${Version}\n', *PINNED], text=True)
    return dict(line.strip().split('=', 1) for line in result.splitlines())


def binaries():
    from osgeo import _ogr, _osr
    files = {
        'ogrinfo': '/usr/bin/ogrinfo',
        'ogr2ogr': '/usr/bin/ogr2ogr',
        'bwrap': '/usr/bin/bwrap',
        'pythonOgr': _ogr.__file__,
        'pythonOsr': _osr.__file__,
        'libgdal': '/usr/lib/libgdal.so.30',
        'libproj': '/usr/lib/aarch64-linux-gnu/libproj.so.22',
    }
    return {name: {'path': os.path.realpath(file), 'sha256': digest(os.path.realpath(file))} for name, file in files.items()}


def status(expected_worker=None):
    if not RECEIPT.is_file() or not WORKER.is_file():
        return {'ready': False, 'reason': 'Geospatial worker or readiness receipt is absent'}
    receipt = json.loads(RECEIPT.read_text())
    if receipt.get('schema') != 'manta-geospatial-ready-v1' or receipt.get('ready') is not True:
        return {'ready': False, 'reason': 'Invalid geospatial readiness receipt'}
    actual_packages = packages()
    if any(actual_packages.get(name) != version for name, version in PINNED.items()):
        return {'ready': False, 'reason': 'Pinned GIS package version mismatch', 'packages': actual_packages}
    current = binaries()
    if current != receipt.get('binaryHashes'):
        return {'ready': False, 'reason': 'GDAL, PROJ or sandbox binary hash changed'}
    from osgeo import gdal, osr
    versions = {'gdal': gdal.VersionInfo('--version'), 'proj': '%d.%d.%d' % (osr.GetPROJVersionMajor(), osr.GetPROJVersionMinor(), osr.GetPROJVersionMicro())}
    if versions != receipt.get('versions'):
        return {'ready': False, 'reason': 'Live GDAL/PROJ versions differ from receipt'}
    actual_worker = digest(WORKER)
    if actual_worker != receipt.get('workerSha256'):
        return {'ready': False, 'reason': 'Guest worker differs from pinned readiness receipt', 'workerSha256': actual_worker}
    if expected_worker and actual_worker != expected_worker:
        return {'ready': False, 'reason': 'Reviewed managed worker update available', 'workerSha256': actual_worker, 'expectedWorkerSha256': expected_worker}
    return {'ready': True, 'schema': receipt['schema'], 'tool': {'id': 'gdal-proj', 'name': 'GDAL / PROJ', 'version': versions['gdal']}, 'packages': actual_packages, 'versions': versions, 'workerSha256': actual_worker, 'binaryHashes': current, 'receiptSha256': digest(RECEIPT), 'isolation': 'Linux VM + per-job bubblewrap unshare-all', 'hostGlobalChanges': False}


if __name__ == '__main__':
    try:
        expected = sys.argv[1] if len(sys.argv) > 1 else None
        print(json.dumps(status(expected), ensure_ascii=False))
    except Exception as exc:
        print(json.dumps({'ready': False, 'reason': str(exc)[:1000]}, ensure_ascii=False))
