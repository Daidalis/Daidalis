#!/usr/bin/env python3
"""Fixed, bounded GDAL/PROJ inspection of one project-pinned Shapefile ZIP.

This runs inside Manta's Linux bubblewrap namespace without network access. It
does not infer a mission footprint, legal collection permission, or acceptance.
"""
import base64
import csv
import hashlib
import io
import json
import os
import pathlib
import re
import stat
import sys
import tempfile
import zipfile

from osgeo import gdal, ogr, osr

MAX_ZIP = 32 * 1024 * 1024
MAX_UNCOMPRESSED = 128 * 1024 * 1024
MAX_PREVIEW = 1400000
MAX_PREVIEW_VERTICES = 12000
ALLOWED_MEMBERS = {'.shp', '.shx', '.dbf', '.prj', '.cpg'}
SHA = re.compile(r'^[a-f0-9]{64}$')
JOB = re.compile(r'^geospatial_[a-f0-9]{32}$')


def digest(value):
    return hashlib.sha256(value).hexdigest()


def tool_versions():
    return {
        'gdal': gdal.VersionInfo('--version'),
        'gdalRelease': gdal.VersionInfo('RELEASE_NAME'),
        'proj': '%d.%d.%d' % (
            osr.GetPROJVersionMajor(),
            osr.GetPROJVersionMinor(),
            osr.GetPROJVersionMicro(),
        ),
    }


def fail(message):
    raise ValueError(message)


def read_request():
    raw = sys.stdin.buffer.read(MAX_ZIP * 2 + 1)
    if len(raw) > MAX_ZIP * 2:
        fail('Job request exceeds the bounded transport size')
    request = json.loads(raw)
    if request.get('schema') != 'manta-geospatial-job-v1' or not JOB.fullmatch(str(request.get('jobId', ''))):
        fail('Invalid geospatial job schema or ID')
    if not SHA.fullmatch(str(request.get('inputHash', ''))) or not SHA.fullmatch(str(request.get('sourceHash', ''))):
        fail('Missing pinned input/source hash')
    if not isinstance(request.get('sourceBase64'), str):
        fail('Missing bounded source ZIP')
    source = base64.b64decode(request['sourceBase64'], validate=True)
    if not source or len(source) > MAX_ZIP or digest(source) != request['sourceHash']:
        fail('Source ZIP size or SHA-256 mismatch')
    if request.get('sourceBytes') != len(source):
        fail('Source ZIP byte count mismatch')
    if request.get('expectedSourceEpsg') not in (4269, 4326):
        fail('GIS v1 supports only geographic NAD83 EPSG:4269 or WGS84 EPSG:4326')
    points = request.get('points')
    if not isinstance(points, list) or len(points) > 100:
        fail('At most 100 control points are supported')
    return request, source


def members_of(source):
    archive = zipfile.ZipFile(io.BytesIO(source))
    entries = archive.infolist()
    if not entries or len(entries) > 32:
        fail('Shapefile ZIP has no members or more than 32')
    names = set()
    total = 0
    for item in entries:
        name = item.filename
        if '/' in name or '\\' in name or name in {'.', '..'} or name.startswith('.') or not re.fullmatch(r'[A-Za-z0-9_. -]{1,180}', name):
            fail('Shapefile ZIP contains a path or unsafe member name')
        if name in names or item.is_dir() or stat.S_ISLNK(item.external_attr >> 16):
            fail('Shapefile ZIP has duplicate, directory or symbolic-link member')
        names.add(name)
        extension = pathlib.PurePosixPath(name).suffix.lower()
        if extension not in ALLOWED_MEMBERS and not re.fullmatch(r'[A-Za-z0-9_. -]+\.shp(?:\.ea)?\.iso\.xml', name, re.IGNORECASE):
            fail('Shapefile ZIP contains unsupported member type')
        total += item.file_size
        if item.file_size > 64 * 1024 * 1024 or total > MAX_UNCOMPRESSED:
            fail('Shapefile ZIP exceeds uncompressed size limit')
        if item.compress_size and item.file_size / item.compress_size > 500:
            fail('Shapefile ZIP member has excessive compression ratio')
    core = [name for name in names if pathlib.PurePosixPath(name).suffix.lower() in ALLOWED_MEMBERS]
    stems = {pathlib.PurePosixPath(name).stem for name in core}
    if len(stems) != 1 or {'.shp', '.shx', '.dbf', '.prj'} - {pathlib.PurePosixPath(name).suffix.lower() for name in core}:
        fail('One complete SHP/SHX/DBF/PRJ layer is required')
    stem = next(iter(stems))
    if any(name not in {stem + '.shp.ea.iso.xml', stem + '.shp.iso.xml'} for name in names if name not in core):
        fail('Shapefile ZIP has an unrelated XML sidecar')
    return archive, entries


def spatial_reference(epsg):
    sr = osr.SpatialReference()
    if sr.ImportFromEPSG(epsg) != 0:
        fail('Unsupported EPSG identifier')
    sr.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    return sr


def check_points(layer, source_srs, request):
    target_srs = spatial_reference(4326)
    wgs84_to_source = None if request['expectedSourceEpsg'] == 4326 else osr.CoordinateTransformation(target_srs, source_srs)
    field = request.get('featureIdField', 'STATEFP')
    if field not in [layer.GetLayerDefn().GetFieldDefn(i).GetName() for i in range(layer.GetLayerDefn().GetFieldCount())]:
        fail('Selected feature ID field is not present in the DBF')
    geometries = []
    invalid = []
    layer.ResetReading()
    for feature in layer:
        identifier = str(feature.GetField(field))
        geometry = feature.GetGeometryRef()
        if geometry is None or geometry.IsEmpty():
            invalid.append(identifier)
            continue
        original = geometry.Clone()
        if not original.IsValid():
            invalid.append(identifier)
        geometries.append((identifier, original))
        if len(geometries) > 1000:
            fail('The selected layer exceeds 1000 features')
    if not geometries:
        fail('Shapefile layer has no nonempty geometries')
    if len({identifier for identifier, _ in geometries}) != len(geometries):
        fail('Feature IDs are not unique in selected layer')
    results = []
    for point in request['points']:
        crs = point.get('crs', 'EPSG:4326')
        epsg = int(crs.split(':', 1)[1])
        x, y = point['lon'], point['lat']
        if epsg == 4326 and wgs84_to_source is not None:
            x, y, _ = wgs84_to_source.TransformPoint(x, y)
        location = ogr.Geometry(ogr.wkbPoint)
        location.AddPoint_2D(x, y)
        subset = [(identifier, geometry) for identifier, geometry in geometries if point.get('featureId') is None or identifier == point['featureId']]
        if point.get('featureId') is not None and not subset:
            fail('Control point refers to a missing feature ID: ' + str(point['featureId']))
        if any(identifier in invalid for identifier, _ in subset):
            actual = 'unknown-invalid-geometry'
        elif any(geometry.Touches(location) or geometry.Boundary().Distance(location) <= 1e-10 for _, geometry in subset):
            actual = 'boundary'
        elif any(geometry.Contains(location) for _, geometry in subset):
            actual = 'inside'
        else:
            actual = 'outside'
        expected = point.get('expected')
        results.append({
            'id': point['id'], 'lon': point['lon'], 'lat': point['lat'],
            'inputCrs': crs, 'sourceX': x, 'sourceY': y,
            'featureId': point.get('featureId'), 'actual': actual,
            'expected': expected, 'passed': (actual == expected) if expected else None,
            'scope': 'administrative polygon only; not sensor footprint, collection authorization or orbital coverage',
        })
    return results, geometries, invalid


def preview_geojson(geometries, checks, source_srs):
    target = spatial_reference(4326)
    transform = osr.CoordinateTransformation(source_srs, target)
    wanted = {row['featureId'] for row in checks if row['featureId']}
    selected = [(identifier, geometry) for identifier, geometry in geometries if identifier in wanted][:12]
    if not selected:
        selected = sorted(geometries, key=lambda row: row[0])[:8]
    features = []
    for identifier, original in selected:
        geometry = original.Clone()
        geometry.Transform(transform)
        simplified = geometry.SimplifyPreserveTopology(0.02)
        if simplified is None or simplified.IsEmpty():
            continue
        features.append({'type': 'Feature', 'properties': {'featureId': identifier, 'role': 'simplified-display-only'}, 'geometry': json.loads(simplified.ExportToJson())})
    for row in checks:
        if row['inputCrs'] == 'EPSG:4326':
            lon, lat = row['lon'], row['lat']
        else:
            trans = osr.CoordinateTransformation(source_srs, target)
            lon, lat, _ = trans.TransformPoint(row['sourceX'], row['sourceY'])
        features.append({'type': 'Feature', 'properties': {'id': row['id'], 'actual': row['actual'], 'expected': row['expected'], 'passed': row['passed'], 'role': 'control-point'}, 'geometry': {'type': 'Point', 'coordinates': [lon, lat]}})
    def vertex_count(value):
        if isinstance(value, list):
            if len(value) >= 2 and all(isinstance(n, (int, float)) for n in value[:2]):
                return 1
            return sum(vertex_count(part) for part in value)
        return 0
    vertices = sum(vertex_count(feature['geometry']['coordinates']) for feature in features)
    if len(features) > 500 or vertices > MAX_PREVIEW_VERTICES:
        fail('Bounded display preview exceeds 500 features or 12000 vertices')
    collection = {'type': 'FeatureCollection', 'name': 'Manta GIS review preview', 'metadata': {'coordinateReferenceSystem': 'EPSG:4326', 'sourceCrs': source_srs.ExportToWkt(), 'simplificationToleranceDegrees': 0.02, 'renderedPolygonCount': len(selected), 'totalPolygonCount': len(geometries), 'verificationGeometry': False}, 'features': features}
    encoded = json.dumps(collection, ensure_ascii=False, separators=(',', ':')).encode()
    if len(encoded) > MAX_PREVIEW:
        fail('Bounded map preview exceeds 1.4 MB; use fewer selected features')
    return encoded


def checks_csv(checks):
    out = io.StringIO()
    columns = ['id', 'lon', 'lat', 'inputCrs', 'sourceX', 'sourceY', 'featureId', 'actual', 'expected', 'passed']
    writer = csv.DictWriter(out, fieldnames=columns, extrasaction='ignore')
    writer.writeheader()
    writer.writerows(checks)
    return out.getvalue().encode()


def main():
    gdal.UseExceptions()
    ogr.UseExceptions()
    osr.UseExceptions()
    request, source = read_request()
    archive, entries = members_of(source)
    hashes = {}
    with tempfile.TemporaryDirectory(prefix='manta-gis-') as temp:
        root = pathlib.Path(temp)
        for item in entries:
            data = archive.read(item)
            hashes[item.filename] = digest(data)
            if pathlib.PurePosixPath(item.filename).suffix.lower() in ALLOWED_MEMBERS:
                (root / item.filename).write_bytes(data)
        shp = next(root / item.filename for item in entries if item.filename.lower().endswith('.shp'))
        dataset = ogr.Open(str(shp), 0)
        if dataset is None or dataset.GetLayerCount() != 1:
            fail('Expected one readable Shapefile layer')
        layer = dataset.GetLayer(0)
        source_srs = layer.GetSpatialRef()
        if source_srs is None:
            fail('Shapefile PRJ does not declare a CRS')
        source_srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        expected = spatial_reference(request['expectedSourceEpsg'])
        if not source_srs.IsSame(expected):
            fail('Shapefile CRS does not match explicitly expected EPSG:%d' % request['expectedSourceEpsg'])
        actual_epsg = source_srs.GetAuthorityCode(None) or source_srs.GetAuthorityCode('GEOGCS')
        checks, geometries, invalid = check_points(layer, source_srs, request)
        source_wkt = source_srs.ExportToWkt()
        extent = layer.GetExtent()
        fields = [layer.GetLayerDefn().GetFieldDefn(i).GetName() for i in range(layer.GetLayerDefn().GetFieldCount())]
        preview = preview_geojson(geometries, checks, source_srs)
    csv_bytes = checks_csv(checks)
    verification = {'status': 'not-requested' if not any(row['expected'] for row in checks) else 'failed' if any(row['passed'] is False for row in checks) else 'unknown' if any(row['passed'] is None for row in checks) else 'passed', 'checks': checks}
    output = {
        'schema': 'manta-geospatial-runner-result-v1', 'jobId': request['jobId'],
        'exitCode': 0, 'success': True, 'tool': {'id': 'gdal-proj', 'version': tool_versions()['gdal'], 'versions': tool_versions()},
        'receipt': {
            'inputHash': request['inputHash'], 'sourceSha256': request['sourceHash'],
            'sourceBytes': len(source), 'memberSha256': hashes,
            'sourceEpsgExpected': request['expectedSourceEpsg'], 'sourceEpsgIdentified': actual_epsg,
            'sourceWktSha256': digest(source_wkt.encode()), 'sourceWkt': source_wkt,
            'controlInputCrs': sorted({row['inputCrs'] for row in checks}),
            'previewCrs': 'EPSG:4326', 'workerSha256': digest(pathlib.Path(__file__).read_bytes()),
            'toolVersions': tool_versions(), 'featureIdField': request.get('featureIdField', 'STATEFP'),
        },
        'metadata': {'featureCount': len(geometries), 'invalidFeatureIds': invalid, 'sourceExtent': [float(x) for x in extent], 'sourceExtentOrder': '[minX,maxX,minY,maxY]', 'fields': fields},
        'verification': verification,
        'diagnostics': '%d features, %d controls; source EPSG:%d; GDAL/PROJ transform to EPSG:4326 for display only' % (len(geometries), len(checks), request['expectedSourceEpsg']),
        'files': [
            {'path': 'preview.geojson', 'mimeType': 'application/geo+json', 'sha256': digest(preview), 'contentBase64': base64.b64encode(preview).decode()},
            {'path': 'checks.csv', 'mimeType': 'text/csv', 'sha256': digest(csv_bytes), 'contentBase64': base64.b64encode(csv_bytes).decode()},
        ],
    }
    print(json.dumps(output, ensure_ascii=False, separators=(',', ':')))


if __name__ == '__main__':
    try:
        main()
    except Exception as exc:
        print(json.dumps({'schema': 'manta-geospatial-runner-result-v1', 'exitCode': 2, 'success': False, 'reason': str(exc)[:2000], 'diagnostics': str(exc)[:2000], 'tool': {'id': 'gdal-proj', 'version': tool_versions()['gdal']}, 'files': []}, ensure_ascii=False))
