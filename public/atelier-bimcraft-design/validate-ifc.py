"""Strict IFC gate plus bounded geometry extraction for the private IngeTrazo adapter."""
from pathlib import Path
import json, sys, time
import ifcopenshell
import ifcopenshell.validate
import ifcopenshell.geom
from collections import Counter
import os,threading
def _budget():
    import psutil
    start=time.monotonic()
    while True:
        if time.monotonic()-start>115 or psutil.Process().memory_info().rss>1024*1024*1024:os._exit(137)
        time.sleep(.5)
threading.Thread(target=_budget,daemon=True).start()

def validate(path):
    path=Path(path).resolve()
    if path.stat().st_size>64*1024*1024:
        raise ValueError('IFC exceeds 64 MiB input budget')
    model=ifcopenshell.open(str(path))
    logger=ifcopenshell.validate.json_logger()
    ifcopenshell.validate.validate(model,logger,express_rules=True)
    issues=[]
    for item in logger.statements:
        issues.append({k:str(v) for k,v in item.items()})
    products=model.by_type('IfcProduct'); classes=Counter(p.is_a() for p in products)
    guids=[p.GlobalId for p in products if getattr(p,'GlobalId',None)]
    for guid,n in Counter(guids).items():
        if n>1: issues.append({'type':'duplicate-guid','guid':guid,'count':n})
    voids=[r for r in model.by_type('IfcRelVoidsElement') if r.RelatedOpeningElement]
    fills=[r for r in model.by_type('IfcRelFillsElement') if r.RelatedBuildingElement]
    void_openings={r.RelatedOpeningElement.id() for r in voids}
    filled_openings={r.RelatingOpeningElement.id() for r in fills}
    openings=model.by_type('IfcOpeningElement')
    for opening in openings:
        if opening.id() not in void_openings: issues.append({'type':'unhosted-opening','id':opening.id(),'guid':opening.GlobalId})
    for element in [*model.by_type('IfcDoor'),*model.by_type('IfcWindow')]:
        if not any(r.RelatedBuildingElement.id()==element.id() for r in fills):
            issues.append({'type':'unfilled-door-window','id':element.id(),'class':element.is_a(),'guid':element.GlobalId})
    settings=ifcopenshell.geom.settings(); settings.set(settings.USE_WORLD_COORDS,True); checked_geometry=0
    geometry_classes=('IfcWall','IfcSlab','IfcRoof','IfcDoor','IfcWindow','IfcStairFlight','IfcRailing','IfcColumn','IfcMember')
    for item in products:
        if not item.Representation or not any(item.is_a(c) for c in geometry_classes): continue
        try:
            shape=ifcopenshell.geom.create_shape(settings,item); verts=shape.geometry.verts
            if not verts: raise ValueError('empty tessellation')
            axes=[verts[i::3] for i in range(3)]; extents=[max(axis)-min(axis) for axis in axes]
            if any(not (v>1e-6) for v in extents): issues.append({'type':'zero-size-geometry','id':item.id(),'class':item.is_a(),'extents_m':extents})
            checked_geometry+=1
        except Exception as exc:
            issues.append({'type':'geometry-failure','id':item.id(),'class':item.is_a(),'error':str(exc)})
    layer_sets=model.by_type('IfcMaterialLayerSet')
    for layer_set in layer_sets:
        for layer in layer_set.MaterialLayers:
            if layer.LayerThickness is None or layer.LayerThickness<=0: issues.append({'type':'invalid-material-layer','layer_set':layer_set.LayerSetName,'material':layer.Material.Name if layer.Material else None,'thickness':layer.LayerThickness})
    required={'IfcBuildingStorey':1,'IfcSlab':1,'IfcRoof':1,'IfcSpace':1,'IfcWall':1}
    for cls,minimum in required.items():
        if classes[cls]<minimum: issues.append({'type':'missing-ifc-class','class':cls,'minimum':minimum,'found':classes[cls]})
    receipt={'file':str(path),'schema':model.schema,'express_rules':True,'issues':issues,'valid':not issues,
             'products':len(products),'product_classes':dict(sorted(classes.items())),'checked_geometry':checked_geometry,
             'openings':len(openings),'hosted_openings':sum(opening.id() in void_openings for opening in openings),
             'filled_openings':sum(opening.id() in filled_openings for opening in openings),
             'material_layer_sets':len(layer_sets),'material_layers':sum(len(x.MaterialLayers) for x in layer_sets),
             'storeys':[{'name':s.Name,'elevation':s.Elevation} for s in model.by_type('IfcBuildingStorey')]}
    path.with_suffix('.validation.json').write_text(json.dumps(receipt,indent=2),encoding='utf-8')
    if issues:
        print(json.dumps(receipt));sys.exit(2)
    return model,receipt

if __name__=='__main__':
    model,receipt=validate(sys.argv[1]);print(json.dumps(receipt))
