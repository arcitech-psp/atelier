"""IFC mesh evidence for architectural clearances. CPU geometry math, no renderer.

Uses the installed IfcOpenShell environment. The sampled stair check casts vertical
rays against actual roof/slab/beam triangles; it is not a declaration of code compliance.
"""
from pathlib import Path
import json, math, sys
import ifcopenshell, ifcopenshell.geom, ifcopenshell.guid

def inside(point, poly):
    x,y=point; hit=False
    for a,b in zip(poly,poly[1:]+poly[:1]):
        if (a[1]>y)!=(b[1]>y) and x<(b[0]-a[0])*(y-a[1])/(b[1]-a[1])+a[0]:hit=not hit
    return hit

def tri_z(x,y,a,b,c):
    den=(b[1]-c[1])*(a[0]-c[0])+(c[0]-b[0])*(a[1]-c[1])
    if abs(den)<1e-8:return None
    u=((b[1]-c[1])*(x-c[0])+(c[0]-b[0])*(y-c[1]))/den
    v=((c[1]-a[1])*(x-c[0])+(a[0]-c[0])*(y-c[1]))/den
    w=1-u-v
    if min(u,v,w)<-1e-7:return None
    return u*a[2]+v*b[2]+w*c[2]

def run(folder):
    folder=Path(folder);d=json.loads((folder/'design-intent.json').read_text());e=json.loads((folder/'elements.json').read_text());ids=json.loads((folder/'native-ids.json').read_text())
    model=ifcopenshell.open(str(folder/'project.ifc'));settings=ifcopenshell.geom.settings();settings.set(settings.USE_WORLD_COORDS,True)
    by_native={x['id']:x for x in e};by_guid={x['guid']:x for x in e};meshes={};errors=[];warnings=[]
    for p in model.by_type('IfcProduct'):
        if not p.Representation:continue
        try:
            sh=ifcopenshell.geom.create_shape(settings,p);v=sh.geometry.verts;f=sh.geometry.faces
            verts=[tuple(v[i+j]*1000 for j in range(3)) for i in range(0,len(v),3)]
            faces=[tuple(f[i+j] for j in range(3)) for i in range(0,len(f),3)]
            meshes[p.GlobalId]={'ifc':p,'verts':verts,'faces':faces,'bbox':[[min(a[j] for a in verts),max(a[j] for a in verts)] for j in range(3)]}
        except Exception as ex:errors.append({'kind':'mesh-failure','class':p.is_a(),'error':str(ex)})
    def mesh(native):return meshes.get(ifcopenshell.guid.compress(native['guid'].replace('-','')))
    # Actual floor footprint containment, including voids. Does not infer furniture origins.
    furniture=[];facades={};wall_faces=[]
    for w in (w for w in d['walls'] if w['exterior']):
        native=by_native[ids[w['id']]];m=mesh(native);a,b=w['a'],w['b'];dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy);normal=(-dy/length,dx/length)
        plane=(a[0]+normal[0]*native['thickness']/2,a[1]+normal[1]*native['thickness']/2);opaque=0
        for f in m['faces']:
            ta,tb,tc=[m['verts'][j] for j in f]
            if any(abs((v[0]-plane[0])*normal[0]+(v[1]-plane[1])*normal[1])>0.5 for v in [ta,tb,tc]):continue
            ab=[tb[i]-ta[i] for i in range(3)];ac=[tc[i]-ta[i] for i in range(3)]
            cross=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]]
            opaque+=math.sqrt(sum(v*v for v in cross))/2/1e6
        openings=[o for o in d['openings'] if o['host']==w['id']]
        glazing=sum(by_native[ids[o['id']]]['width']*by_native[ids[o['id']]]['height']/1e6 for o in openings if o['kind']=='window')
        holes=sum(by_native[ids[o['id']]]['width']*by_native[ids[o['id']]]['height']/1e6 for o in openings)
        gross=opaque+holes
        if opaque<=0:errors.append({'kind':'no-exterior-face-area','wall':w['id']})
        angle=(math.degrees(math.atan2(normal[1],normal[0]))-d['site']['north_deg'])%360
        facing=['east','north','west','south'][int((angle+45)//90)%4]
        fac=facades.setdefault(facing,{'gross_wall_m2':0,'window_opening_m2':0,'opaque_wall_m2':0})
        fac['gross_wall_m2']+=gross;fac['window_opening_m2']+=glazing;fac['opaque_wall_m2']+=opaque
        wall_faces.append({'wall':w['id'],'orientation':facing,'gross_m2':round(gross,4),'opaque_m2':round(opaque,4),'glazing_m2':round(glazing,4)})
    for direction,fac in facades.items():
        fac['ratio']=round(fac['window_opening_m2']/fac['gross_wall_m2'],4)
        for k in ['gross_wall_m2','window_opening_m2','opaque_wall_m2']:fac[k]=round(fac[k],4)
        fac['target']=d['preflight']['preliminary_facades'][direction]['target']
        fac['within_target']=fac['target'][0]<=fac['ratio']<=fac['target'][1]
        if not fac['within_target']:warnings.append(f"{direction} measured glazing ratio {fac['ratio']:.4f} is outside the design target {fac['target']}; resolve explicitly in design review.")
    for x in (x for x in e if x['category']=='component'):
        m=mesh(x)
        if not m:errors.append({'kind':'missing-furniture-mesh','id':x['id']});continue
        level=by_guid[x['level']]['name'];floor=next(f for f in d['floors'] if f['level']==level and f['type']!='deck')
        outside=[v for v in m['verts'] if not inside(v[:2],floor['boundary']) or any(inside(v[:2],h) for h in floor.get('openings',[]))]
        result={'id':x['id'],'family':x['family'],'level':level,'bounds_mm':m['bbox'],'outside_vertices':len(outside)};furniture.append(result)
        if outside:errors.append({'kind':'furniture-outside-floor','id':x['id'],'family':x['family'],'vertices':len(outside)})
        for w in (w for w in d['walls'] if w['level']==level):
            wn=by_native[ids[w['id']]];wm=mesh(wn)
            if not wm:continue
            wa,wb=w['a'],w['b'];dx,dy=wb[0]-wa[0],wb[1]-wa[1];length=math.hypot(dx,dy)
            projected=[((v[0]-wa[0])*dx/length+(v[1]-wa[1])*dy/length,-(v[0]-wa[0])*dy/length+(v[1]-wa[1])*dx/length) for v in m['verts']]
            ext=[[min(v[i] for v in projected),max(v[i] for v in projected)] for i in [0,1]]
            overlap=[min(ext[0][1],length)-max(ext[0][0],0),min(ext[1][1],wn['thickness']/2)-max(ext[1][0],-wn['thickness']/2),min(m['bbox'][2][1],wm['bbox'][2][1])-max(m['bbox'][2][0],wm['bbox'][2][0])]
            if min(overlap)>5:errors.append({'kind':'furniture-wall-bounds-overlap','family':x['family'],'id':x['id'],'wall':w['id'],'overlap_mm':[round(v,1) for v in overlap]})
    # Actual IFC beam footprint extents must not cross slab voids. Three tracks at <=100 mm.
    beam_checks=[]
    upper=next(f for f in d['floors'] if f['type']=='upper')
    for b in d['beams']:
        if b['level']!='Upper Floor':continue
        m=mesh(by_native[ids[b['id']]])
        if not m:continue
        a,c=b['a'],b['b'];dx,dy=c[0]-a[0],c[1]-a[1];length=math.hypot(dx,dy)
        projected=[((v[0]-a[0])*dx/length+(v[1]-a[1])*dy/length,-(v[0]-a[0])*dy/length+(v[1]-a[1])*dx/length) for v in m['verts']]
        lo,hi=min(v[0] for v in projected),max(v[0] for v in projected)
        left,right=min(v[1] for v in projected),max(v[1] for v in projected)
        n=max(2,math.ceil((hi-lo)/100));clashes=0
        for i in range(n+1):
            along=lo+(hi-lo)*i/n
            for edge in [left+1,(left+right)/2,right-1]:
                p=[a[0]+dx/length*along-dy/length*edge,a[1]+dy/length*along+dx/length*edge]
                if any(inside(p,h) for h in upper.get('openings',[])):clashes+=1
        beam_checks.append({'id':b['id'],'void_intersection_samples':clashes,'basis':'actual IFC mesh extents projected to beam axis; three tracks at <=100 mm'})
        if clashes:errors.append({'kind':'beam-crosses-void','beam':b['id'],'samples':clashes})
    obstacles=[]
    for m in meshes.values():
        if m['ifc'].is_a() not in ['IfcRoof','IfcSlab','IfcBeam']:continue
        # The stair landing exports as an IfcSlab: exclude its own circulation surface.
        if any(rel.is_a('IfcRelAggregates') and rel.RelatingObject.is_a('IfcStair') for rel in m['ifc'].Decomposes):continue
        for f in m['faces']:
            a,b,c=[m['verts'][j] for j in f]
            obstacles.append((a,b,c,m['ifc'].is_a(),m['ifc'].GlobalId))
    stair_results=[]
    for native in (x for x in e if x['category']=='stair'):
        rise=native['riser_height'];base=by_guid[native['level']]['elevation'];tread=native['tread'];spec=next(s for s in d['stairs'] if ids[s['id']]==native['id'])
        samples=[];before=0
        for run_i,(a,b) in enumerate(native['runs']):
            dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy);steps=round(length/tread)
            for step in range(steps):
                foot_z=base+(before+step+1)*rise
                for across in [-native['width']/2+100,0,native['width']/2-100]:
                    x=a[0]+dx/length*(step+.5)*tread-dy/length*across;y=a[1]+dy/length*(step+.5)*tread+dx/length*across
                    hits=[]
                    for ta,tb,tc,kind,guid in obstacles:
                        z=tri_z(x,y,ta,tb,tc)
                        if z is not None and z>foot_z+40:hits.append((z-foot_z,kind,guid))
                    h=min(hits,default=(None,None,None),key=lambda x:x[0] if x[0] is not None else 1e20)
                    samples.append({'x_mm':round(x,1),'y_mm':round(y,1),'foot_z_mm':round(foot_z,1),'clear_mm':round(h[0],1) if h[0] else None,'obstacle':h[1]})
            before+=steps+1
        # Include intermediate landing at its actual elevation, on three transverse tracks.
        for landing_i,landing in enumerate(native.get('landings',[])):
            a=native['runs'][landing_i][1];b=native['runs'][landing_i+1][0]
            for t in [.1,.5,.9]:
                for across in [-native['width']/2+100,0,native['width']/2-100]:
                    dx,dy=b[0]-a[0],b[1]-a[1];length=math.hypot(dx,dy)
                    x=a[0]+dx*t-dy/length*across;y=a[1]+dy*t+dx/length*across;zfoot=base+landing['at']*rise;hits=[]
                    for ta,tb,tc,kind,guid in obstacles:
                        z=tri_z(x,y,ta,tb,tc)
                        if z is not None and z>zfoot+40:hits.append((z-zfoot,kind))
                    h=min(hits,default=(None,None),key=lambda x:x[0] if x[0] is not None else 1e20)
                    samples.append({'x_mm':round(x,1),'y_mm':round(y,1),'foot_z_mm':round(zfoot,1),'clear_mm':round(h[0],1) if h[0] else None,'obstacle':h[1],'landing':True})
        measured=[x['clear_mm'] for x in samples if x['clear_mm'] is not None];minimum=min(measured) if measured else None
        # The upper floor must start immediately after the final stair riser.
        # Cast onto the actual upper IFC slab on three tracks, 1/50/500 mm beyond it.
        upper_mesh=mesh(by_native[ids[upper['id']]]);end_a,end_b=native['runs'][-1];dx,dy=end_b[0]-end_a[0],end_b[1]-end_a[1];run_length=math.hypot(dx,dy)
        target_z=next(l['elevation'] for l in d['levels'] if l['name']==spec['top_level']);landing_checks=[]
        for beyond in [1,50,500]:
            for across in [-native['width']/2+100,0,native['width']/2-100]:
                x=end_b[0]+dx/run_length*beyond-dy/run_length*across;y=end_b[1]+dy/run_length*beyond+dx/run_length*across
                hits=[tri_z(x,y,*[upper_mesh['verts'][j] for j in f]) for f in upper_mesh['faces']]
                floor_top=max((z for z in hits if z is not None),default=None);covered=floor_top is not None and abs(floor_top-target_z)<1
                landing_checks.append({'beyond_riser_mm':beyond,'across_mm':across,'floor_top_mm':floor_top,'covered':covered})
                if not covered:errors.append({'kind':'stair-upper-landing-gap','stair':native['id'],'beyond_riser_mm':beyond,'across_mm':across,'actual_floor_top_mm':floor_top})
        stair_results.append({'id':native['id'],'sample_count':len(samples),'minimum_headroom_mm':minimum,'samples':samples,'upper_landing_checks':landing_checks})
        if minimum is None or minimum<2100:errors.append({'kind':'stair-headroom','id':native['id'],'minimum_mm':minimum})
    roof_checks=[]
    for r in d['roofs']:
        m=mesh(by_native[ids[r['id']]])
        roof_checks.append({'id':r['id'],'ifc_class':m['ifc'].is_a() if m else None,'bounds_mm':m['bbox'] if m else None})
    report={'ok':not errors,'errors':errors,'warnings':warnings,'mesh_count':len(meshes),'furniture':furniture,'beam_void_checks':beam_checks,'stairs':stair_results,'roofs':roof_checks,'facades':facades,'wall_face_areas':wall_faces,
            'facade_area_basis':'Actual tessellated exterior wall face area plus hosted window/door openings. Window opening area includes frame; glazed door area is not inferred.',
            'limits':['Headroom is sampled above flight treads and intermediate landings; approaches are identified separately in design intent.','Floor containment and wall bounding-box checks do not prove furniture usability, door swing clearance, accessibility, structural capacity or regulatory compliance.']}
    (folder/'geometry-audit.json').write_text(json.dumps(report,indent=2)+'\n')
    print(json.dumps({'folder':str(folder),'ok':report['ok'],'errors':errors,'meshes':len(meshes),'stair_minima':[x['minimum_headroom_mm'] for x in stair_results],'furniture':len(furniture)}))
    return not errors

if __name__=='__main__':sys.exit(0 if run(sys.argv[1]) else 1)
