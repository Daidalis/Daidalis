#!/usr/bin/env python3
"""Bounded 42 W-frame/NAD83 state-point cross-check in Manta's private Linux VM.

This is a geodetic screening product for native 42 spacecraft *positions*.
It does not calculate sensor footprints, imaging permission, orbit coverage,
revisit, ground contact, delivery, or a certified ITRF transformation.
"""
import base64
import csv
import datetime as dt
import hashlib
import io
import json
import math
import os
import pathlib
import re
import stat
import sys
import tempfile
import zipfile

from osgeo import gdal, ogr, osr

JOBS = pathlib.Path('/srv/manta/orbit42/jobs')
SHA = re.compile(r'^[a-f0-9]{64}$')
ORBIT_ID = re.compile(r'^orbit42_[a-f0-9]{32}$')
JOB_ID = re.compile(r'^orbitground_[a-f0-9]{32}$')
MAX_ZIP = 32 * 1024 * 1024
MAX_REQUEST = MAX_ZIP * 2
MAX_UNCOMPRESSED = 128 * 1024 * 1024
MAX_FILE = 12 * 1024 * 1024
CORE = {'.shp', '.shx', '.dbf', '.prj', '.cpg'}
KNOWN_2024_CENSUS_ZIP_SHA256 = 'ad00cbe66c7177091b668cee202e93d4a1ddcee271c28d1c9f9874af59c04b92'
CONUS = set('01 04 05 06 08 09 10 11 12 13 16 17 18 19 20 21 22 23 24 25 26 27 28 29 30 31 32 33 34 35 36 37 38 39 40 41 42 44 45 46 47 48 49 50 51 53 54 55 56'.split())


def digest(value):
    return hashlib.sha256(value).hexdigest()


def require(condition, message):
    if not condition:
        raise ValueError(message)


def keys(value, expected, label):
    require(isinstance(value, dict) and set(value) == set(expected), 'Invalid ' + label + ' fields')


def relative_path(value, extension):
    return (isinstance(value, str) and len(value) <= 240 and value.endswith(extension)
            and not value.startswith('/') and '\\' not in value
            and all(part and part not in ('.', '..') and not part.startswith('.') for part in value.split('/')))


def versions():
    return {'gdal': gdal.VersionInfo('--version'),
            'proj': '%d.%d.%d' % (osr.GetPROJVersionMajor(), osr.GetPROJVersionMinor(), osr.GetPROJVersionMicro())}


def read_request():
    raw = sys.stdin.buffer.read(MAX_REQUEST + 1)
    require(len(raw) <= MAX_REQUEST, 'Orbit-ground input exceeds bounded transport size')
    request = json.loads(raw)
    keys(request, ('schema', 'jobId', 'inputHash', 'orbit', 'census', 'maxSamples'), 'job')
    require(request['schema'] == 'manta-orbit-ground-input-v1' and isinstance(request['jobId'], str)
            and JOB_ID.fullmatch(request['jobId']), 'Invalid orbit-ground schema or job ID')
    require(isinstance(request['inputHash'], str) and SHA.fullmatch(request['inputHash']), 'Invalid job input SHA-256')
    orbit = request['orbit']
    keys(orbit, ('jobId', 'receiptSha256', 'modelSha256'), 'orbit')
    require(isinstance(orbit['jobId'], str) and ORBIT_ID.fullmatch(orbit['jobId']), 'Invalid native 42 job ID')
    require(all(isinstance(orbit[name], str) and SHA.fullmatch(orbit[name]) for name in ('receiptSha256', 'modelSha256')), 'Invalid native 42 pins')
    census = request['census']
    keys(census, ('path', 'sha256', 'base64', 'expectedSourceEpsg', 'featureIdField'), 'Census')
    require(relative_path(census['path'], '.zip'), 'Invalid project-relative Census ZIP path')
    require(isinstance(census['sha256'], str) and SHA.fullmatch(census['sha256']), 'Invalid Census ZIP SHA-256')
    require(census['expectedSourceEpsg'] == 4269 and census['featureIdField'] == 'STATEFP', 'Only Census NAD83 state layer with STATEFP is supported')
    sample_limit = request['maxSamples']
    require(type(sample_limit) is int and 2 <= sample_limit <= 201, 'maxSamples must be 2–201')
    pinned = {'orbit': {'jobId': orbit['jobId'], 'receiptSha256': orbit['receiptSha256'], 'modelSha256': orbit['modelSha256']},
              'census': {'path': census['path'], 'sha256': census['sha256'],
                         'expectedSourceEpsg': 4269, 'featureIdField': 'STATEFP'},
              'maxSamples': sample_limit}
    require(digest(json.dumps(pinned, ensure_ascii=False, separators=(',', ':')).encode()) == request['inputHash'],
            'Orbit-ground canonical input SHA-256 mismatch')
    require(isinstance(census['base64'], str) and len(census['base64']) <= (MAX_ZIP * 4 // 3 + 8), 'Census ZIP exceeds base64 bound')
    source = base64.b64decode(census['base64'], validate=True)
    require(0 < len(source) <= MAX_ZIP and digest(source) == census['sha256'], 'Census ZIP SHA-256 or size mismatch')
    return request, source


def regular_bytes(path, maximum):
    descriptor = os.open(path, os.O_RDONLY | getattr(os, 'O_NOFOLLOW', 0))
    try:
        before = os.fstat(descriptor)
        require(stat.S_ISREG(before.st_mode) and before.st_size <= maximum, 'Native artifact type or size mismatch: ' + path.name)
        with os.fdopen(descriptor, 'rb', closefd=False) as handle:
            data = handle.read(maximum + 1)
        after = os.fstat(descriptor)
        require(len(data) == before.st_size and before.st_ino == after.st_ino and before.st_mtime_ns == after.st_mtime_ns,
                'Native artifact changed while reading: ' + path.name)
        return data
    finally:
        os.close(descriptor)


def native_rows(data, columns, label):
    lines = data.decode('ascii').splitlines()
    require(2 <= len(lines) <= 2001, 'Native ' + label + ' sample count is out of bounds')
    result = []
    for line in lines:
        parts = line.split()
        require(len(parts) == columns, 'Native ' + label + ' column count mismatch')
        values = [float(part) for part in parts]
        require(all(math.isfinite(value) for value in values), 'Native ' + label + ' contains non-finite values')
        result.append(values)
    return result


def read_native(orbit):
    require(JOBS.is_dir() and not JOBS.is_symlink(), 'Native 42 job directory unavailable')
    folder = JOBS / orbit['jobId']
    work = folder / 'work'
    output = work / 'InOut'
    require(all(item.is_dir() and not item.is_symlink() for item in (folder, work, output)), 'Native 42 job is absent or linked')
    receipt_raw = regular_bytes(work / 'receipt.json', 256 * 1024)
    require(digest(receipt_raw) == orbit['receiptSha256'], 'Native 42 receipt SHA-256 mismatch')
    receipt = json.loads(receipt_raw)
    require(receipt.get('schema') == 'manta-orbit42-receipt-v1' and receipt.get('jobId') == orbit['jobId']
            and receipt.get('inputHash') == orbit['modelSha256'] and receipt.get('sourceFile', {}).get('sha256') == orbit['modelSha256']
            and receipt.get('tool', {}).get('id') == 'nasa-42', 'Native 42 receipt does not match the pinned completed job')
    raw_outputs = receipt.get('rawOutputs')
    require(isinstance(raw_outputs, list) and all(isinstance(row, dict) and set(row) == {'path', 'sha256'} for row in raw_outputs),
            'Native 42 job predates raw PosW/time hash receipts; rerun this model')
    hashes = {row['path']: row['sha256'] for row in raw_outputs}
    require(len(hashes) == len(raw_outputs) and all(SHA.fullmatch(str(value)) for value in hashes.values())
            and {'time.42', 'PosN.42', 'PosW.42'} <= set(hashes), 'Native 42 raw-output pins are incomplete')
    observed = {}
    for name in ('time.42', 'PosN.42', 'PosW.42'):
        observed[name] = regular_bytes(output / name, MAX_FILE)
        require(digest(observed[name]) == hashes[name], 'Native 42 ' + name + ' differs from its receipt SHA-256')
    times = native_rows(observed['time.42'], 1, 'time.42')
    positions_n = native_rows(observed['PosN.42'], 9, 'PosN.42')
    positions_w = native_rows(observed['PosW.42'], 3, 'PosW.42')
    require(len(times) == len(positions_n) == len(positions_w), 'Native 42 N/W/time rows are not aligned')
    seconds = [row[0] for row in times]
    require(abs(seconds[0]) < 1e-6 and all(b > a for a, b in zip(seconds, seconds[1:]))
            and seconds[-1] <= 2001, 'Native 42 elapsed time is not bounded and monotonic from zero')
    differences = [abs(math.hypot(*n[:3]) - math.hypot(*w)) for n, w in zip(positions_n, positions_w)]
    require(max(differences) <= 15.0, 'Native 42 N/W radius-invariance diagnostic failed')
    require(all(6_378_000 < math.hypot(*row) < 50_000_000 for row in positions_w), 'Native W-frame radius is out of the reviewed range')
    epoch_string = receipt.get('epochUtc')
    require(isinstance(epoch_string, str) and re.fullmatch(r'20\d\d-\d\d-\d\dT\d\d:\d\d:\d\dZ', epoch_string), 'Native 42 UTC epoch missing')
    epoch = dt.datetime.strptime(epoch_string, '%Y-%m-%dT%H:%M:%SZ').replace(tzinfo=dt.timezone.utc)
    leap = receipt.get('leapSecondsAssumed')
    require(type(leap) in (int, float) and math.isfinite(leap) and 0 <= leap <= 100, 'Native 42 leap-second assumption missing')
    return receipt, seconds, positions_w, hashes, max(differences), epoch


def census_layer(source):
    archive = zipfile.ZipFile(io.BytesIO(source))
    entries = archive.infolist()
    require(4 <= len(entries) <= 32, 'Expected one bounded Census state Shapefile ZIP')
    names = set()
    uncompressed = 0
    member_hashes = {}
    for entry in entries:
        name = entry.filename
        require(bool(re.fullmatch(r'[A-Za-z0-9_. -]{1,180}', name)) and name not in ('.', '..') and not name.startswith('.')
                and name not in names and not entry.is_dir() and not stat.S_ISLNK(entry.external_attr >> 16), 'Census ZIP has an unsafe or duplicate member')
        names.add(name)
        suffix = pathlib.PurePosixPath(name).suffix.lower()
        require(suffix in CORE or bool(re.fullmatch(r'[A-Za-z0-9_. -]+\.shp(?:\.ea)?\.iso\.xml', name, re.I)), 'Unsupported Census ZIP member')
        uncompressed += entry.file_size
        require(entry.file_size <= 64 * 1024 * 1024 and uncompressed <= MAX_UNCOMPRESSED
                and (not entry.compress_size or entry.file_size / entry.compress_size <= 500), 'Census ZIP expansion exceeds bounds')
    stems = {pathlib.PurePosixPath(name).stem for name in names if pathlib.PurePosixPath(name).suffix.lower() in CORE}
    require(len(stems) == 1 and {'.shp', '.shx', '.dbf', '.prj'} <= {pathlib.PurePosixPath(name).suffix.lower() for name in names},
            'Census ZIP must contain one complete state layer')
    with tempfile.TemporaryDirectory(prefix='manta-orbit-ground-') as temp:
        folder = pathlib.Path(temp)
        for entry in entries:
            data = archive.read(entry)
            require(len(data) == entry.file_size, 'Census ZIP member changed while extracting')
            member_hashes[entry.filename] = digest(data)
            if pathlib.PurePosixPath(entry.filename).suffix.lower() in CORE:
                (folder / entry.filename).write_bytes(data)
        shape = next(folder / item.filename for item in entries if item.filename.lower().endswith('.shp'))
        dataset = ogr.Open(str(shape), 0)
        require(dataset is not None and dataset.GetLayerCount() == 1, 'Census ZIP does not contain one readable layer')
        layer = dataset.GetLayer(0)
        source_srs = layer.GetSpatialRef()
        require(source_srs is not None, 'Census PRJ does not declare a CRS')
        source_srs.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        expected = osr.SpatialReference()
        require(expected.ImportFromEPSG(4269) == 0, 'Guest PROJ lacks NAD83 EPSG:4269')
        expected.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
        require(source_srs.IsSame(expected), 'Census source CRS is not EPSG:4269 NAD83')
        fields = [layer.GetLayerDefn().GetFieldDefn(index).GetName() for index in range(layer.GetLayerDefn().GetFieldCount())]
        require('STATEFP' in fields, 'Census state layer lacks STATEFP')
        features = []
        layer.ResetReading()
        for feature in layer:
            code = str(feature.GetField('STATEFP'))
            geometry = feature.GetGeometryRef()
            require(bool(re.fullmatch(r'\d\d', code)) and geometry is not None and not geometry.IsEmpty() and geometry.IsValid(),
                    'Census state geometry or STATEFP is invalid')
            features.append((code, geometry.Clone(), geometry.GetEnvelope()))
            require(len(features) <= 100, 'Census layer exceeds 100 bounded state features')
        require(len(features) >= 51 and len({row[0] for row in features}) == len(features)
                and {'02', '15', '11'} <= {row[0] for row in features}, 'Census state inventory is incomplete or duplicated')
        source_wkt = source_srs.ExportToWkt()
    return features, member_hashes, source_wkt


def spatial_reference(epsg):
    value = osr.SpatialReference()
    require(value.ImportFromEPSG(epsg) == 0, 'Required geodesy CRS unavailable: EPSG:' + str(epsg))
    value.SetAxisMappingStrategy(osr.OAMS_TRADITIONAL_GIS_ORDER)
    return value


def classify(lon, lat, transform, features):
    x, y, _ = transform.TransformPoint(lon, lat)
    point = ogr.Geometry(ogr.wkbPoint)
    point.AddPoint_2D(x, y)
    hits = []
    near = False
    for code, geometry, envelope in features:
        min_x, max_x, min_y, max_y = envelope
        if not (min_x - 0.03 <= x <= max_x + 0.03 and min_y - 0.03 <= y <= max_y + 0.03):
            continue
        if geometry.Touches(point):
            hits.append((code, 'boundary'))
        elif geometry.Contains(point):
            hits.append((code, 'inside'))
        # Geographic-degree distance is a conservative display caution only,
        # not a surveyed meter-scale boundary tolerance.
        elif geometry.Distance(point) <= 0.02:
            near = True
        if hits and geometry.Boundary().Distance(point) <= 0.02:
            near = True
    require(len(hits) <= 1, 'Overlapping state polygons make classification ambiguous')
    if not hits:
        return {'stateFp': None, 'relation': 'outside', 'region': None, 'nearBoundaryCaution': near}
    code, relation = hits[0]
    region = 'Alaska' if code == '02' else 'Hawaii' if code == '15' else 'CONUS-plus-DC' if code in CONUS else 'other-US-area'
    return {'stateFp': code, 'relation': relation, 'region': region, 'nearBoundaryCaution': near or relation == 'boundary'}


def encoded_file(name, mime_type, data):
    require(len(data) <= 2 * 1024 * 1024, 'Orbit-ground output exceeds 2 MiB artifact bound')
    return {'path': name, 'mimeType': mime_type, 'sha256': digest(data), 'contentBase64': base64.b64encode(data).decode()}


def run(request, source):
    orbit = request['orbit']
    native_receipt, seconds, positions, native_hashes, radius_error, epoch = read_native(orbit)
    features, member_hashes, source_wkt = census_layer(source)
    geocentric = spatial_reference(4978)
    geodetic = spatial_reference(4979)
    nad83 = spatial_reference(4269)
    to_geodetic = osr.CoordinateTransformation(geocentric, geodetic)
    to_nad83 = osr.CoordinateTransformation(geodetic, nad83)
    axis = to_geodetic.TransformPoint(6378137.0, 0.0, 0.0)
    require(abs(axis[0]) < 1e-7 and abs(axis[1]) < 1e-7 and abs(axis[2]) < 0.1,
            'ECEF/geodetic axis control failed; do not classify coordinates')
    east_axis = to_geodetic.TransformPoint(0.0, 6378137.0, 0.0)
    require(abs(east_axis[0] - 90.0) < 1e-7 and abs(east_axis[1]) < 1e-7 and abs(east_axis[2]) < 0.1,
            'ECEF/geodetic +Y east-axis control failed')
    polar_radius = 6378137.0 * (1 - 1 / 298.257223563)
    north_axis = to_geodetic.TransformPoint(0.0, 0.0, polar_radius)
    require(abs(north_axis[1] - 90.0) < 1e-7 and abs(north_axis[2]) < 0.1,
            'ECEF/geodetic north-pole control failed')
    # Independent forward WGS84 ellipsoid arithmetic provides a non-symmetric
    # longitude/latitude/altitude control for GDAL axis order and units.
    expected_lon, expected_lat, expected_height = -77.0, 39.0, 400_000.0
    longitude = math.radians(expected_lon)
    latitude = math.radians(expected_lat)
    flattening = 1 / 298.257223563
    eccentricity_squared = flattening * (2 - flattening)
    prime_vertical = 6378137.0 / math.sqrt(1 - eccentricity_squared * math.sin(latitude) ** 2)
    control_x = (prime_vertical + expected_height) * math.cos(latitude) * math.cos(longitude)
    control_y = (prime_vertical + expected_height) * math.cos(latitude) * math.sin(longitude)
    control_z = (prime_vertical * (1 - eccentricity_squared) + expected_height) * math.sin(latitude)
    recovered = to_geodetic.TransformPoint(control_x, control_y, control_z)
    require(abs(recovered[0] - expected_lon) < 1e-5 and abs(recovered[1] - expected_lat) < 1e-5
            and abs(recovered[2] - expected_height) < 0.2, 'Asymmetric WGS84 axis-order/height control failed')
    wrong_axis = to_geodetic.TransformPoint(control_y, control_x, control_z)
    require(abs(wrong_axis[0] - expected_lon) > 1.0, 'Swapped-axis negative control failed')
    controls = []
    for identifier, lon, lat, expected in (
            ('DC-control', -77.0369, 38.9072, '11'),
            ('Alaska-control', -149.9003, 61.2181, '02'),
            ('Hawaii-control', -157.8583, 21.3099, '15'),
            ('ocean-negative-control', -140.0, 0.0, None)):
        actual = classify(lon, lat, to_nad83, features)
        passed = actual['stateFp'] == expected and actual['relation'] == ('outside' if expected is None else 'inside')
        controls.append({'id': identifier, 'lon': lon, 'lat': lat, 'expectedStateFp': expected,
                         'actualStateFp': actual['stateFp'], 'relation': actual['relation'], 'passed': passed})
    require(all(row['passed'] for row in controls), 'Census state positive/ocean-negative controls failed')
    count = min(len(seconds), request['maxSamples'])
    indices = [round(index * (len(seconds) - 1) / (count - 1)) for index in range(count)]
    require(len(set(indices)) == count and indices[0] == 0 and indices[-1] == len(seconds) - 1, 'Bounded native sample selection failed')
    samples = []
    for index in indices:
        t = seconds[index]
        x, y, z = positions[index]
        lon, lat, height = to_geodetic.TransformPoint(x, y, z)
        require(all(math.isfinite(v) for v in (lon, lat, height)) and -180 <= lon <= 180 and -90 <= lat <= 90
                and 100_000 <= height <= 50_000_000, 'Native W-frame geodetic sample is out of physical bounds')
        location = classify(lon, lat, to_nad83, features)
        samples.append({'sampleIndex': index, 'timeSeconds': t,
                        'utc': (epoch + dt.timedelta(seconds=t)).isoformat().replace('+00:00', 'Z'),
                        'xWm': x, 'yWm': y, 'zWm': z,
                        'longitudeDeg': lon, 'latitudeDeg': lat, 'heightM': height,
                        'classificationConfidence': 'indeterminate-near-boundary' if location['nearBoundaryCaution'] else 'screening-only',
                        **location})
    csv_buffer = io.StringIO()
    columns = list(samples[0])
    csv_writer = csv.DictWriter(csv_buffer, fieldnames=columns)
    csv_writer.writeheader()
    csv_writer.writerows(samples)
    csv_data = csv_buffer.getvalue().encode()
    known_census = request['census']['sha256'] == KNOWN_2024_CENSUS_ZIP_SHA256
    geojson = {'type': 'FeatureCollection', 'name': 'Native 42 W-frame sub-satellite point screening',
               'metadata': {'crs': 'EPSG:4326 display coordinates', 'nativeFrame': '42 Earth rotating W',
                            'sourcePolygonCrs': 'EPSG:4269 NAD83', 'sourceAuthority': 'matches audited 2024 Census TIGER/Line ZIP SHA-256' if known_census else 'project-supplied; authority unverified',
                            'pointInterpretation': 'geodetic spacecraft longitude/latitude; not sensor footprint',
                            'certifiedITRF': False, 'coverageAnalysis': False},
               'features': [{'type': 'Feature', 'geometry': {'type': 'Point', 'coordinates': [row['longitudeDeg'], row['latitudeDeg']]},
                             'properties': {key: value for key, value in row.items() if key not in ('longitudeDeg', 'latitudeDeg')}} for row in samples]}
    geo_data = json.dumps(geojson, ensure_ascii=False, separators=(',', ':')).encode()
    report = (
        '# Native 42 orbit to NAD83 state-point screening\n\n'
        f"- NASA 42 job: `{orbit['jobId']}`; native receipt SHA-256 `{orbit['receiptSha256']}`.\n"
        f"- Project-supplied state ZIP: `{request['census']['path']}`; SHA-256 `{request['census']['sha256']}`; source EPSG:4269 NAD83. "
        f"{'Hash matches the project-audited 2024 Census TIGER/Line state ZIP.' if known_census else 'Data authority has not been independently established.'}\n"
        f"- Epoch: {native_receipt['epochUtc']} UTC; declared leap seconds {native_receipt['leapSecondsAssumed']}; {len(samples)} selected samples from {len(seconds)} native rows.\n"
        '- The native 42 source writes `PosW.42` as `World.CWN * SC[0].PosN` (Source/42report.c:426–429). '
        'Its GPS path uses `ECEFToWGS84(GPS.PosW)` (Source/42sensors.c:391–392). '
        'No separate inertial-to-ECEF rotation is invented here.\n'
        '- The worker transforms native 42 W coordinates to WGS84 geodetic coordinates with GDAL/PROJ and screens '
        'those positions against the supplied NAD83 state layer. This is an approximate datum bridge: '
        'the 42 clock uses a declared UTC epoch and leap-second assumption, while ITRF/EOP/UT1 and a '
        'time-dependent NAD83 realization or exact GDAL/PROJ coordinate operation/grids are not independently certified here.\n'
        '- A state match describes only a spacecraft sub-satellite geodetic point. It is not the sensor line of sight, '
        'swath, imaging authorization, orbital coverage, revisit, ground contact, downlink, or 24-hour delivery. '
        'Near-boundary classifications remain indeterminate; the geographic-degree caution is not a surveyed uncertainty bound.\n'
        '- Inspect `ground-samples.csv`, `ground-track.geojson`, and the hash-pinned `receipt.json`; failed controls '
        'would block all output. The zero/+Y/polar and asymmetric ECEF axis controls, swapped-axis negative, '
        'DC/Alaska/Hawaii positive state controls, and ocean negative control passed for this run.\n')
    report_data = report.encode()
    output_hashes = {'ground-samples.csv': digest(csv_data), 'ground-track.geojson': digest(geo_data), 'report.md': digest(report_data)}
    scope = 'Approximate native 42 W-frame geodetic point/state-layer screening only; no footprint, coverage, revisit or mission acceptance'
    metrics = {'nativeSamples': len(seconds), 'selectedSamples': len(samples),
               'selectedRawInsideStatePolygons': sum(row['relation'] == 'inside' for row in samples),
               'selectedInsideButNearBoundaryIndeterminate': sum(row['relation'] == 'inside' and row['nearBoundaryCaution'] for row in samples),
               'selectedBoundary': sum(row['relation'] == 'boundary' for row in samples),
               'selectedNearBoundaryCaution': sum(bool(row['nearBoundaryCaution']) for row in samples),
               'maxNativeNWRadiusDifferenceM': radius_error,
               'geodeticControls': {'equatorAxisPassed': True, 'eastAxisPassed': True, 'northPolePassed': True,
                                    'asymmetricAxisAndHeightPassed': True, 'swappedAxisNegativePassed': True,
                                    'asymmetricRecovered': recovered},
               'controls': controls,
               'startSeconds': seconds[0], 'stopSeconds': seconds[-1]}
    receipt = {'schema': 'manta-orbit-ground-receipt-v1', 'jobId': request['jobId'], 'inputHash': request['inputHash'],
               'workerSha256': digest(pathlib.Path(__file__).read_bytes()),
               'orbit': {'jobId': orbit['jobId'], 'receiptSha256': orbit['receiptSha256'], 'modelSha256': orbit['modelSha256'],
                         'posWSha256': native_hashes['PosW.42'], 'timeSha256': native_hashes['time.42'],
                         'epochUtc': native_receipt['epochUtc'], 'leapSecondsAssumed': native_receipt['leapSecondsAssumed']},
               'census': {'path': request['census']['path'], 'sha256': request['census']['sha256'],
                          'expectedSourceEpsg': 4269, 'featureIdField': 'STATEFP', 'memberSha256': member_hashes,
                          'sourceWktSha256': digest(source_wkt.encode()),
                          'authority': 'matches audited 2024 Census TIGER/Line ZIP SHA-256' if known_census else 'project-supplied; unverified'},
               'nativePosNSha256': native_hashes['PosN.42'], 'toolVersions': versions(),
               'controlChecks': {'geodetic': metrics['geodeticControls'], 'statePoints': controls},
               'sourceCodeEvidence': ['42 Source/42report.c:426-429', '42 Source/42sensors.c:391-392'],
               'frame': 'Native 42 Earth rotating W; approximate ECEF interpretation, not certified ITRF/EOP/UT1',
               'datum': 'WGS84 geodetic positions screened against NAD83 EPSG:4269 state polygons via installed GDAL/PROJ; exact coordinate operation/grids and time-dependent datum realization not certified',
               'scope': scope, 'outputSha256': output_hashes,
               'openGaps': ['approved orbit and sensor geometry', 'footprint and coastal/boundary uncertainty',
                            'independent high-precision reference-frame validation', 'revisit and three-month coverage',
                            'ground station contact and 24-hour delivery', 'system/physical verification and acceptance']}
    receipt_data = (json.dumps(receipt, ensure_ascii=False, indent=2) + '\n').encode()
    files = [encoded_file('ground-samples.csv', 'text/csv', csv_data),
             encoded_file('ground-track.geojson', 'application/geo+json', geo_data),
             encoded_file('report.md', 'text/markdown', report_data),
             encoded_file('receipt.json', 'application/json', receipt_data)]
    return {'schema': 'manta-orbit-ground-response-v1', 'success': True, 'exitCode': 0,
            'receipt': receipt, 'metrics': metrics, 'scope': scope, 'files': files,
            'diagnostics': f'Native 42 W-frame and supplied state-point screening completed: {len(samples)} bounded samples; no coverage claim'}


def main():
    try:
        gdal.UseExceptions()
        ogr.UseExceptions()
        osr.UseExceptions()
        request, source = read_request()
        print(json.dumps(run(request, source), ensure_ascii=False, separators=(',', ':')))
    except Exception as error:
        print(json.dumps({'schema': 'manta-orbit-ground-response-v1', 'success': False, 'exitCode': 1,
                          'diagnostics': str(error)[:2000], 'files': []}, ensure_ascii=False))


if __name__ == '__main__':
    main()
