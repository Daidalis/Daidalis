"""Generate a small analytic square, not an external geographic reference dataset."""
import pathlib,sys,tempfile,zipfile
from osgeo import ogr,osr
with tempfile.TemporaryDirectory() as tmp:
    root=pathlib.Path(tmp);srs=osr.SpatialReference();srs.ImportFromEPSG(4326)
    dataset=ogr.GetDriverByName('ESRI Shapefile').CreateDataSource(str(root/'square.shp'))
    layer=dataset.CreateLayer('square',srs,ogr.wkbPolygon);layer.CreateField(ogr.FieldDefn('STATEFP',ogr.OFTString))
    feature=ogr.Feature(layer.GetLayerDefn());feature.SetField('STATEFP','01');feature.SetGeometry(ogr.CreateGeometryFromWkt('POLYGON ((0 0,2 0,2 2,0 2,0 0))'));layer.CreateFeature(feature)
    feature=None;layer=None;dataset=None
    with zipfile.ZipFile(sys.argv[1],'w') as archive:
        for file in sorted(root.iterdir()):archive.write(file,file.name)
