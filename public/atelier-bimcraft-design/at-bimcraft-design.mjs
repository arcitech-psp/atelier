// ARCITECH design kernel for BIMCraft 0.8.0. Native elements, no GUI or harness lifecycle.
// Coordinates and elevations are millimetres. Floor areas are centre-line areas.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {createHash} from 'node:crypto';
import {selectParti,selectRoof,roofProfiles,executionProcedure} from './design-method.mjs';

const round=n=>Math.round(n*1000)/1000;
const rect=(x0,y0,x1,y1)=>[[x0,y0],[x0,y1],[x1,y1],[x1,y0]];
const area=p=>Math.abs(p.reduce((a,v,i)=>{const q=p[(i+1)%p.length];return a+v[0]*q[1]-q[0]*v[1]},0)/2)/1e6;
const layer=(material,thickness,fn='structure')=>({material,thickness,function:fn});
export const ASSEMBLIES={
 cedar:[layer('Cedar vertical boards',20,'finish'),layer('Ventilated cavity',25,'thermal'),layer('Wood sheathing',12,'substrate'),layer('Insulated timber studs',140),layer('Service cavity',20,'thermal'),layer('Gypsum',13,'finish')],
 charcoal:[layer('Charred timber boards',20,'finish'),layer('Ventilated cavity',25,'thermal'),layer('Wood sheathing',12,'substrate'),layer('Insulated timber studs',140),layer('Service cavity',20,'thermal'),layer('Gypsum',13,'finish')],
 base:[layer('Mineral fibre cement',20,'finish'),layer('Ventilated cavity',25,'thermal'),layer('Wood sheathing',12,'substrate'),layer('Insulated timber studs',140),layer('Service cavity',20,'thermal'),layer('Gypsum',13,'finish')],
 partition:[layer('Gypsum',13,'finish'),layer('Acoustic timber studs',89),layer('Gypsum',13,'finish')],
 ground:[layer('Timber floor finish',15,'finish'),layer('Screed',100,'substrate'),layer('Concrete',150),layer('Insulation',100,'thermal')],
 upper:[layer('Timber floor finish',15,'finish'),layer('Acoustic mat',22,'thermal'),layer('Wood sheathing',25,'substrate'),layer('Insulated timber joists',240),layer('Resilient channel',25,'thermal'),layer('Gypsum',13,'finish')],
 metalRoof:[layer('Standing seam zinc',30,'finish'),layer('Ventilated cavity',25,'thermal'),layer('Roof underlay',10,'membrane'),layer('Insulated timber rafters',220),layer('Wood sheathing',12,'substrate'),layer('Gypsum',13,'finish')],
 deck:[layer('Deck boards',28,'finish'),layer('Timber deck joists',172)],
 green:[layer('Sedum',20,'finish'),layer('Growing medium',150,'substrate'),layer('Drainage',30,'substrate'),layer('Filter',1,'membrane'),layer('Roof membrane',10,'membrane'),layer('Insulation',160,'thermal'),layer('Timber deck',220)]
};
const MATERIALS={
 'Cedar vertical boards':{color:'#ad8059',surface:'vertical',texture:{kind:'boards',size:[140,2400],angle:90}},
 'Charred timber boards':{color:'#454c4a',surface:'vertical',texture:{kind:'boards',size:[140,2400],angle:90}},
 'Mineral fibre cement':{color:'#c9c5b9',surface:'horizontal'},
 'Standing seam zinc':{color:'#53616a',surface:'vertical'},
 'Gypsum':{color:'#efede6'},'Concrete':{color:'#969a99',cut:'concrete'},
 'Glulam':{color:'#b38a60'},'Metal':{color:'#343c40'},'Glass':{color:'#a2c4cf'},
 'Deck boards':{color:'#b18a64',surface:'horizontal',texture:{kind:'boards',size:[160,2000]}},
 'Sedum':{color:'#728263'},'Timber floor finish':{color:'#d2b087',surface:'none'}
};

function base(project,parti,site,brief){return {schema:'ait.bim-design/1',project,brief,parti,site,units:'mm',
 levels:[{name:'Ground Floor',elevation:0,occupied:true},{name:'Upper Floor',elevation:3000,occupied:true}],
 volumes:[],floors:[],roofs:[],walls:[],openings:[],rooms:[],stairs:[],guards:[],columns:[],beams:[],components:[],grids:[],
 design:{decisions:[],limitations:[],structure:{engineered:false,max_primary_span_mm:4800,cantilever_limit_mm:1200},solar:{},entry:{},circulation:[]}}}
function wall(d,id,a,b,{level='Ground Floor',type='cedar',height=2660,roof,exterior=true,base_offset=0}={}){
 d.walls.push({id,a,b,level,type,height,roof,exterior,base_offset});return id;
}
function loop(d,prefix,poly,opts={}){return poly.map((p,i)=>wall(d,`${prefix}${i}`,p,poly[(i+1)%poly.length],opts))}
function opening(d,id,host,at,width,height,sill=0,kind='window',role='daylight'){
 const h=d.walls.find(w=>w.id===host);if(!h)throw Error('Unknown host '+host);
 d.openings.push({id,host,at,width,height,sill,kind,level:h.level,role});
}
function room(d,id,name,point,level='Ground Floor'){d.rooms.push({id,name,point,level})}
function part(d,id,a,b,level='Upper Floor',roof){return wall(d,id,a,b,{level,type:'partition',exterior:false,height:level==='Ground Floor'?2660:3000,roof})}
function roof(d,id,line,profile,from,to,level='Roof Datum',type='metalRoof'){
 d.roofs.push({id,level,type,form:'extrusion',extrusion:{line,profile,from,to}});return id;
}
function beam(d,id,a,b,{level='Upper Floor',offset=0,end_offset,depth=360,width=160,role='primary'}={}){d.beams.push({id,a,b,level,offset,end_offset,depth,width,role})}
function column(d,id,at,{height=2660,level='Ground Floor',width=180,depth=180,base_offset=0}={}){d.columns.push({id,at,height,level,width,depth,base_offset})}
function component(d,family,type,at,level='Ground Floor',angle=0){d.components.push({family,type,at,level,angle})}
function dimensions(d){
 const all=d.walls.filter(w=>w.exterior).flatMap(w=>[w.a,w.b]);
 const xs=all.map(p=>p[0]),ys=all.map(p=>p[1]);d.bounds=[Math.min(...xs),Math.min(...ys),Math.max(...xs),Math.max(...ys)];
}
function rotatePoint(p,degrees){const a=degrees*Math.PI/180,c=Math.cos(a),s=Math.sin(a);return [round(p[0]*c-p[1]*s),round(p[0]*s+p[1]*c)]}
function orientToSite(d){
 const a=d.site.north_deg;if(!Number.isFinite(a)||Math.abs(a)>360)throw Error('north_deg must be a finite angle from -360 to 360, counter-clockwise from model +Y.');
 d.local_bounds=[...d.bounds];d.axis_angle_deg=a;
 const [x0,y0,x1,y1]=d.local_bounds,sy=d.stairs[0].start[1],sx=d.parti==='offset-bar'?7200:3600;
 d.sections=[{name:'Section A - stair and structure',start:[x0-600,sy],end:[x1+600,sy],depth:3500},{name:'Section B - roof and living',start:[sx,y1+600],end:[sx,y0-600],depth:5000}];
 d.elevations=[{name:'South elevation',start:[x0-1000,y0-3000],end:[x1+1000,y0-3000]},
 {name:'North elevation',start:[x1+1000,y1+3000],end:[x0-1000,y1+3000]},
 {name:'East elevation',start:[x1+3000,y0-1000],end:[x1+3000,y1+1000]},
 {name:'West elevation',start:[x0-3000,y1+1000],end:[x0-3000,y0-1000]}];
 if(!a)return;
 const p=x=>rotatePoint(x,a);
 for(const v of d.volumes)v.footprint=v.footprint.map(p);
 for(const f of d.floors){f.boundary=f.boundary.map(p);if(f.openings)f.openings=f.openings.map(v=>v.map(p))}
 for(const w of d.walls){w.a=p(w.a);w.b=p(w.b)}
 for(const o of d.openings)o.at=p(o.at);
 for(const r of d.rooms){r.point=p(r.point);if(r.label_at)r.label_at=p(r.label_at)}
 for(const r of d.roofs)r.extrusion.line=r.extrusion.line.map(p);
 for(const s of d.stairs){s.start=p(s.start);s.angle+=a;s.void=s.void.map(p);s.entry_clear=s.entry_clear.map(p);s.exit_clear=s.exit_clear.map(p)}
 for(const g of d.guards)g.path=g.path.map(p);
 for(const x of d.columns)x.at=p(x.at);
 for(const x of d.components){x.at=p(x.at);x.angle+=a}
 for(const b of d.beams){b.a=p(b.a);b.b=p(b.b)}
 for(const v of [...d.sections,...d.elevations]){v.start=p(v.start);v.end=p(v.end)}
 dimensions(d);
}

function offsetHouse(project,site,brief){
 const d=base(project,'offset-bar',site,brief);
 d.levels.push({name:'Roof Datum',elevation:5700},{name:'Podium Cover',elevation:2660});
 d.volumes=[{id:'living-plinth',level:'Ground Floor',footprint:rect(0,0,12000,8000),role:'recessed social floor',material:'base'},
 {id:'sleeping-bar',level:'Upper Floor',footprint:rect(1200,-1200,13200,7800),role:'offset private floor',material:'cedar'}];
 const mono=roof(d,'main-shed',[[13200,-1200],[13200,7800]],[[-1200,-240],[9600,1920]],-600,12600);
 // The portions of the ground floor outside the upper footprint need a real weather enclosure.
 roof(d,'west-cover',[[0,0],[0,8000]],[[-300,0],[8300,0]],-1200,250,'Podium Cover');
 roof(d,'north-cover',[[0,7800],[12000,7800]],[[-250,0],[12250,0]],0,650,'Podium Cover');
 const g=loop(d,'G',rect(0,0,12000,8000),{type:'base'});
 const u=loop(d,'U',rect(1200,-1200,13200,7800),{level:'Upper Floor',height:2700,type:'cedar',roof:mono});
 part(d,'studio-south',[0,4800],[4800,4800],'Ground Floor');part(d,'studio-east',[4800,4800],[4800,8000],'Ground Floor');
 // Sleep rooms face the sun; wet services occupy the sheltered north-west corner.
 part(d,'bed-divider',[7200,-1200],[7200,3400],'Upper Floor',mono);
 part(d,'bed-hall',[1200,3400],[13200,3400],'Upper Floor',mono);
 part(d,'bath-east',[4400,3400],[4400,7800],'Upper Floor',mono);
 part(d,'bath-laundry',[1200,5800],[4400,5800],'Upper Floor',mono);
 d.floors.push({id:'ground',level:'Ground Floor',boundary:rect(0,0,12000,8000),type:'ground'},
 {id:'upper',level:'Upper Floor',boundary:rect(1200,-1200,13200,7800),type:'upper',openings:[rect(6200,5500,11800,6900)]},
 {id:'south-deck',level:'Ground Floor',boundary:rect(-300,-3600,12600,-100),type:'deck',offset:-150});
 // Exact wall hosts; 300 mm or larger solid returns frame the glazing.
 for(const [i,x] of [1500,4500].entries())opening(d,'LIVING-'+(i+1),g[3],[x,0],2400,2550,50,'window','living full height');
 opening(d,'ENTRY',g[3],[7300,0],1000,2300,0,'door','primary entry');
 opening(d,'DINING',g[3],[10500,0],2400,2550,50,'window','living full height');
 opening(d,'CORNER-W',g[0],[0,1600],2200,2250,300,'window','paired corner glazing with solid corner post');
 opening(d,'STUDIO-W',g[0],[0,6200],1500,1500,900);
 opening(d,'KITCHEN-N',g[1],[6700,8000],2000,800,1500);
 opening(d,'STUDIO-N',g[1],[2200,8000],1600,1000,1300);
 opening(d,'DINING-E',g[2],[12000,1800],2400,2250,300);
 opening(d,'STUDIO-DOOR','studio-east',[4800,6000],900,2100,0,'door');
 for(const [i,x] of [2700,5400,8700,11400].entries())opening(d,'BED-S-'+(i+1),u[3],[x,-1200],1800,1800,600);
 opening(d,'BED-W',u[0],[1200,1000],1500,1500,900);
 opening(d,'GALLERY-E',u[2],[13200,4700],1800,1600,900);
 opening(d,'BED-E',u[2],[13200,1000],1500,1500,900);
 opening(d,'BATH-N',u[1],[2800,7800],900,800,1700);
 opening(d,'GALLERY-N',u[1],[10000,7800],2400,1000,1400);
 opening(d,'BED-1-DOOR','bed-hall',[5500,3400],900,2100,0,'door');
 opening(d,'BED-2-DOOR','bed-hall',[9300,3400],900,2100,0,'door');
 opening(d,'BATH-DOOR','bath-east',[4400,4600],900,2100,0,'door');
 opening(d,'LAUNDRY-DOOR','bath-east',[4400,6800],900,2100,0,'door');
 room(d,'G01','Living / dining / kitchen',[6700,2800]);room(d,'G02','Studio',[2300,6200]);
 room(d,'U01','Bedroom 1',[4000,1000],'Upper Floor');room(d,'U02','Bedroom 2',[10100,1000],'Upper Floor');
 room(d,'U03','Bathroom',[2700,4600],'Upper Floor');room(d,'U04','Laundry / storage',[2700,6800],'Upper Floor');
 room(d,'U05','Gallery / stair',[8800,4500],'Upper Floor');
 d.stairs.push({id:'main-stair',start:[6400,6200],angle:0,level:'Ground Floor',top_level:'Upper Floor',width:1000,riser:177,tread:280,landings:[{at:8,turn:0}],void:rect(6200,5500,11800,6900),entry_clear:rect(5000,5700,6300,6700),exit_clear:rect(11600,5700,13000,6700)});
 d.guards.push({id:'void-guard',level:'Upper Floor',path:[[11800,5500],[6200,5500],[6200,6900],[11800,6900]]});
 // Continuous concept beams: 3 m x 4 m support grid, and trimmers clear of the stair void.
 for(const x of [3000,6000,9000,12000]){
  if(x===9000){beam(d,'cantilever-'+x,[x,-1200],[x,5420]);beam(d,'rear-'+x,[x,6980],[x,7800]);}
  else beam(d,'cantilever-'+x,[x,-1200],[x,7800]);
  for(const y of [0,4000,7800])column(d,'post-'+x+'-'+y,[x,y],{height:2640});
 }
 for(const y of [0,4000,7800])beam(d,'edge-'+y,[0,y],[13200,y],{depth:360,role:'continuous transfer with 3 m bays and 1.2 m east cantilever'});
 for(const y of [5420,6980])beam(d,'stair-header-'+y,[6120,y],[11880,y],{depth:450,role:'stair opening header; engineer 5.76 m span'});
 for(const x of [6120,11880])beam(d,'stair-trimmer-'+x,[x,5420],[x,6980],{depth:450,role:'stair trimmer'});
 // Ground entry canopy is the upper floor; a vertical timber screen makes the threshold legible.
 for(let x=8100;x<=9000;x+=225)column(d,'entry-screen-'+x,[x,-600],{width:60,depth:180,height:2580});
 d.design.entry={opening:'ENTRY',recess_mm:1200,canopy_depth_mm:1200,clear_width_mm:1500,marker:'timber fins beside door'};
 d.design.solar={target_summer_altitude_deg:62.4,target_winter_altitude_deg:15.5,overhang_mm:1200,window_height_mm:2550,head_gap_mm:60,facade:'south',method:'vertical shadow = projection * tan(altitude); solar noon concept check only'};
 d.design.decisions=['Raise and shift the sleeping bar 1.2 m south and east; preserve a simple service/stair spine at the rear.',
 'Make the south glass a recessed base, with a light mineral plinth below warm vertical timber.',
 'Use an 11.31 degree mono-pitch rising north; external low eave drainage avoids a concealed snow valley.',
 'The 1.2 m south projection shades the living glazing and covers the entry. Windows align on a 2.7 m bedroom rhythm.',
 'Close the uncovered west/north ground-floor strips with separate native roof elements.'];
 d.design.circulation=['South deck -> sheltered entry -> open social floor -> rear straight stair -> upper gallery -> bedrooms, bath and laundry.'];
 d.design.limitations.push('3 m x 4 m primary grid, 1.2 m cantilevers and 5.76 m stair headers are modeled; capacities and connections require engineering.','Flat secondary podium covers require detailed positive drainage; main roof is mono-pitch.');
 component(d,'Sofa','2000 x 900',[1300,1800]);component(d,'Table','2000 x 1000',[8400,2800]);
 component(d,'Base Cabinet','1800 x 600',[5800,7400]);component(d,'Base Cabinet','1800 x 600',[7600,7400]);
 component(d,'Desk','1400 x 700',[1800,6500]);
 for(const x of [3500,9500])component(d,'Bed','1600 x 2000',[x,1500],'Upper Floor');
 component(d,'Bathtub','1700 x 750',[2600,4300],'Upper Floor');component(d,'WC','400 x 650',[2000,5600],'Upper Floor');
 component(d,'Washbasin','600 x 450',[3300,5600],'Upper Floor');
 const labels={G01:[4800,3000],G02:[1000,7200],U01:[2000,2800],U02:[8000,2800],U03:[1500,4800],U04:[1600,7500],U05:[5000,4700]};
 for(const r of d.rooms)r.label_at=labels[r.id];d.rooms.find(r=>r.id==='U05').subtract_void_indices=[0];
 for(const o of d.openings.filter(o=>['BED-1-DOOR','BED-2-DOOR'].includes(o.id)))o.flip_facing=true;
 return d;
}

function courtHouse(project,site,brief){
 const d=base(project,'courtyard-sawtooth',site,brief);
 d.levels.push({name:'Roof Datum',elevation:6100},{name:'Clerestory Sill',elevation:6410},{name:'Entry Canopy',elevation:2650});
 const gp=[[0,0],[0,12400],[12400,12400],[12400,7600],[4800,7600],[4800,0]];
 const up=[[0,0],[0,12400],[12400,12400],[12400,7600],[6000,7600],[6000,0]];
 d.volumes=[{id:'west-wing',level:'Ground Floor',footprint:rect(0,0,4800,12400),role:'living and stair wing',material:'cedar'},
 {id:'north-wing',level:'Ground Floor',footprint:rect(4800,7600,12400,12400),role:'studio and kitchen wing',material:'cedar'},
 {id:'upper-west',level:'Upper Floor',footprint:rect(0,0,6000,12400),role:'bedrooms with 1.2 m court cantilever',material:'charcoal'},
 {id:'upper-north',level:'Upper Floor',footprint:rect(6000,7600,12400,12400),role:'gallery and wet core',material:'charcoal'}];
 const r1=roof(d,'tooth-1',[[6000,0],[6000,3800]],[[-1000,-368.421],[3800,1400]],-500,6500);
 const r2=roof(d,'tooth-2',[[6000,3800],[6000,7600]],[[0,0],[3800,1400]],-500,6500);
 const r3=roof(d,'tooth-3',[[12400,7600],[12400,12400]],[[0,0],[5400,1575]],-600,13000);
 roof(d,'entry-canopy',[[4800,5400],[10800,5400]],[[0,0],[6000,0]],0,2200,'Entry Canopy');
 roof(d,'south-sun-porch',[[4800,0],[4800,-1250]],[[0,0],[1250,-25]],-4800,0,'Entry Canopy');
 const g=loop(d,'G',gp,{type:'cedar'});
 // Split the long west edge at each roof break, retaining one closed facade line.
 wall(d,'U-W1',[0,0],[0,3800],{level:'Upper Floor',type:'charcoal',roof:r1,height:3100});
 wall(d,'U-W2',[0,3800],[0,7600],{level:'Upper Floor',type:'charcoal',roof:r2,height:3100});
 wall(d,'U-W3',[0,7600],[0,12400],{level:'Upper Floor',type:'charcoal',roof:r3,height:3100});
 wall(d,'U-N',[0,12400],[12400,12400],{level:'Upper Floor',type:'charcoal',roof:r3,height:4500});
 wall(d,'U-E',[12400,12400],[12400,7600],{level:'Upper Floor',type:'charcoal',roof:r3,height:3100});
 wall(d,'U-SN',[12400,7600],[6000,7600],{level:'Upper Floor',type:'charcoal',roof:r3,height:3100});
 wall(d,'U-EC2',[6000,7600],[6000,3800],{level:'Upper Floor',type:'charcoal',roof:r2,height:3100});
 wall(d,'U-EC1',[6000,3800],[6000,0],{level:'Upper Floor',type:'charcoal',roof:r1,height:3100});
 wall(d,'U-S',[6000,0],[0,0],{level:'Upper Floor',type:'charcoal',roof:r1,height:3100});
 for(const [i,y] of [3800,7600].entries()){
  wall(d,'CL-'+i,[0,y],[6000,y],{level:'Clerestory Sill',type:'charcoal',height:1090});
  for(const [j,x] of [1200,3000,4800].entries())opening(d,`CL-${i}-${j}`,'CL-'+i,[x,y],1500,800,90,'window','north clerestory');
 }
 part(d,'studio-front',[9000,9200],[12400,9200],'Ground Floor');part(d,'studio-side',[9000,9200],[9000,12400],'Ground Floor');
 part(d,'bed-1-north',[0,3800],[6000,3800],'Upper Floor');
 part(d,'bed-2-north',[0,7600],[6000,7600],'Upper Floor');
 for(const w of d.walls.filter(w=>w.id==='bed-1-north'||w.id==='bed-2-north'))w.height=3100;
 // A 1.3 m gallery on the west connects bedrooms and the rear landing without crossing a bedroom.
 part(d,'gallery-1',[1300,0],[1300,3800],'Upper Floor',r1);part(d,'gallery-2',[1300,3800],[1300,7600],'Upper Floor',r2);
 part(d,'bath-front',[9600,9600],[12400,9600],'Upper Floor',r3);part(d,'bath-west',[9600,9600],[9600,12400],'Upper Floor',r3);
 const stairVoid=rect(2000,10800,7600,12200),lightVoid=rect(6500,7900,8900,9800);
 d.floors.push({id:'ground',level:'Ground Floor',boundary:gp,type:'ground'},
 {id:'upper',level:'Upper Floor',boundary:up,type:'upper',openings:[stairVoid,lightVoid]},
 {id:'court-deck',level:'Ground Floor',boundary:[[4800,0],[4800,7600],[12400,7600],[12400,5400],[7800,5400],[7800,0]],type:'deck',offset:-150});
 d.floors.push({id:'south-porch-deck',level:'Ground Floor',boundary:rect(0,-2100,7800,0),type:'deck',offset:-150});
 for(const [i,y] of [1900,5700].entries())opening(d,'LIVING-E-'+i,g[4],[4800,y],3000,2550,50,'window','court living full height');
 opening(d,'LIVING-S',g[5],[2400,0],3400,2250,300,'window','living south');
 opening(d,'LIVING-W',g[0],[0,2200],1200,1500,900);
 opening(d,'KITCHEN-W',g[0],[0,6500],1200,1000,1400);
 opening(d,'STAIR-W',g[0],[0,10300],1200,1600,900);
 opening(d,'ENTRY',g[3],[10000,7600],1000,2300,0,'door','primary entry');
 opening(d,'ENTRY-GLAZING',g[3],[7500,7600],2200,2550,50,'window','double-height hall lower glazing');
 opening(d,'STUDIO-E',g[2],[12400,10900],1400,1500,900);
 opening(d,'STUDIO-N',g[1],[10000,12400],2000,1000,1400);
 opening(d,'STAIR-N',g[1],[4000,12400],1800,1000,1400);
 opening(d,'STUDIO-DOOR','studio-front',[11200,9200],900,2100,0,'door');
 opening(d,'BED1-S','U-S',[3600,0],3000,2000,700);
 opening(d,'BED1-E','U-EC1',[6000,1800],2200,1600,800);
 opening(d,'BED2-E','U-EC2',[6000,5600],2200,1600,800);
 opening(d,'HALL-HIGH','U-SN',[7700,7600],2600,2400,400,'window','double height hall upper glazing');
 opening(d,'GALLERY-N','U-N',[6500,12400],2200,1000,1500);
 opening(d,'BATH-N','U-N',[11100,12400],900,800,1700);
 opening(d,'BATH-E','U-E',[12400,11000],700,800,1700);
 for(const [i,y] of [2100,5800,10300].entries())opening(d,'GALLERY-W-'+i,'U-W'+(i+1),[0,y],900,1400,1100);
 opening(d,'BED1-DOOR','gallery-1',[1300,2200],900,2100,0,'door');
 opening(d,'BED2-DOOR','gallery-2',[1300,5700],900,2100,0,'door');
 opening(d,'HALL-1','bed-1-north',[650,3800],900,2100,0,'door');
 opening(d,'HALL-2','bed-2-north',[650,7600],900,2100,0,'door');
 opening(d,'BATH-DOOR','bath-west',[9600,10900],900,2100,0,'door');
 room(d,'G01','Living / kitchen / entry',[2400,5000]);room(d,'G02','Studio',[10700,10800]);
 room(d,'U01','Bedroom 1',[3600,2000],'Upper Floor');room(d,'U02','Bedroom 2',[3600,5600],'Upper Floor');
 room(d,'U03','West gallery 1',[650,2000],'Upper Floor');room(d,'U04','West gallery 2',[650,5600],'Upper Floor');
 room(d,'U05','Bathroom / laundry',[11000,11100],'Upper Floor');room(d,'U06','Bridge / stair / library',[4700,9100],'Upper Floor');
 d.stairs.push({id:'main-stair',start:[2200,11500],angle:0,level:'Ground Floor',top_level:'Upper Floor',width:1000,riser:177,tread:280,landings:[{at:8,turn:0}],void:stairVoid,entry_clear:rect(800,11000,2100,12000),exit_clear:rect(7400,11000,8900,12000)});
 d.guards.push({id:'stair-guard',level:'Upper Floor',path:[[7600,10800],[2000,10800],[2000,12200],[7600,12200]]},
 {id:'light-well-guard',level:'Upper Floor',path:[[6500,7900],[6500,9800],[8900,9800],[8900,7900],[6500,7900]]});
 for(const y of [0,3800,7600]){beam(d,'court-cantilever-'+y,[0,y],[6000,y],{depth:360});column(d,'court-post-'+y,[4800,y]);}
 for(const x of [0,4800,9000,12400]){
  if(x===4800){beam(d,'north-beam-'+x,[x,7600],[x,10720]);beam(d,'north-rear-'+x,[x,12280],[x,12400]);}
  else beam(d,'north-beam-'+x,[x,7600],[x,12400]);
  if(x!==4800)column(d,'north-post-'+x,[x,7600],{height:2640}); // court-post-7600 already supports this junction.
 }
 for(const y of [10720,12280])beam(d,'stair-header-'+y,[1920,y],[7680,y],{depth:450,role:'stair opening header; engineer 5.76 m span'});
 for(const x of [1920,7680])beam(d,'stair-trimmer-'+x,[x,10720],[x,12280],{depth:450,role:'stair trimmer'});
 for(const y of [7820,9880])beam(d,'light-header-'+y,[6420,y],[8980,y],{depth:360,role:'double height opening header'});
 for(const x of [6420,8980])beam(d,'light-trimmer-'+x,[x,7820],[x,9880],{depth:360,role:'double height trimmer'});
 beam(d,'court-edge',[4800,0],[4800,7600],{depth:360});beam(d,'north-court-edge',[4800,7600],[12400,7600],{depth:360});
 for(const x of [5200,8000,10600])column(d,'canopy-post-'+x,[x,5600],{height:2410});
 beam(d,'canopy-edge',[4800,5600],[10800,5600],{level:'Entry Canopy',depth:240});
 for(const x of [300,4500])column(d,'south-porch-post-'+x,[x,-1100],{height:2385});
 beam(d,'south-porch-beam',[0,-1100],[4800,-1100],{level:'Entry Canopy',offset:-25,depth:240});
 // Shade the south bedroom glazing with the roof's 1 m projection; court east glazing gets cantilever shade.
 d.design.entry={opening:'ENTRY',recess_mm:2200,canopy_depth_mm:2200,clear_width_mm:1600,marker:'courtyard corner canopy and paired timber posts'};
 d.design.solar={target_summer_altitude_deg:62.4,target_winter_altitude_deg:15.5,overhang_mm:1250,window_height_mm:2250,head_gap_mm:75,facade:'south',method:'vertical shadow = projection * tan(altitude); gap measured at the projecting eave; solar noon concept check only',secondary_upper:{overhang_mm:1000,window_height_mm:2000,head_gap_mm:31.579}};
 d.design.decisions=['Two perpendicular timber wings define a sheltered southeast court; outdoor deck area stays outside the internal floor-area total.',
 'Upper west wing extends 1.2 m over the courtyard; its west-side gallery connects both bedrooms to the rear stair.',
 'Three actual roof extrusions make a north-light sawtooth. Native glazed upstand walls close both roof steps.',
 'A 2.4 x 1.9 m opening connects entry and upper bridge; guards surround it, with a separate stair void and a 1 m bridge strip.',
 'Snow-prone climate argues against a butterfly valley: outward-sloping metal roofs are selected, with detailed step flashings and drainage still required.'];
 d.design.circulation=['Court -> canopy -> tall entry -> north/west ground-floor spine -> stair -> bridge -> west gallery -> bedrooms.'];
 d.design.limitations.push('Sawtooth step flashings, snow drift accumulation and drainage outlets are design development items.','Room areas in BIMCraft include slab voids; usable floor totals subtract both void polygons separately.');
 component(d,'Sofa','2000 x 900',[1200,1800]);component(d,'Table','1600 x 900',[2400,5200]);
 component(d,'Base Cabinet','1800 x 600',[400,8000], 'Ground Floor',90);component(d,'Desk','1400 x 700',[9800,11200]);
 for(const y of [3200,7000])component(d,'Bed','1600 x 2000',[4700,y],'Upper Floor');
 component(d,'Bathtub','1700 x 750',[11000,10450],'Upper Floor');component(d,'WC','400 x 650',[11600,11600],'Upper Floor');
 component(d,'Washbasin','600 x 450',[10000,11800],'Upper Floor');
 const labels={G01:[1200,7000],G02:[9300,12000],U01:[1900,3100],U02:[1900,6900],U03:[200,2700],U04:[200,6500],U05:[10700,12050],U06:[2300,9000]};
 for(const r of d.rooms)r.label_at=labels[r.id];d.rooms.find(r=>r.id==='U06').subtract_void_indices=[0,1];
 for(const o of d.openings.filter(o=>['BED1-DOOR','BED2-DOOR','BATH-DOOR'].includes(o.id)))o.flip_facing=true;
 return d;
}

// Brief -> scored parti -> dimensional skeleton -> native construction. Deliberately bounded,
// so unsupported programmes cannot silently fall back to a familiar box.
export function generateDesign({brief='',project,parti,site={},programme={}}={}){
 const configured={latitude_deg:51.05,north_deg:0,street:'south',climate:'cold-snow',...site};
 const numerals={one:1,two:2,three:3,four:4,single:1,double:2};
 const bedroomsText=/\b([1-9]|one|two|three|four)[ -]*(?:bedrooms?|beds?)\b/i.exec(brief)?.[1];
 const storeysText=/\b([1-9]|one|two|three|four|single|double)[ -]*(?:storeys?|stories|story|floors?)\b/i.exec(brief)?.[1];
 const bathsText=/\b([1-9]|one|two|three|four)[ -]*(?:bathrooms?|baths?)\b/i.exec(brief)?.[1];
 const areaText=/\b(\d+(?:\.\d+)?)\s*(?:m2|m²|sqm|square metres?)\s*(?:per|each)\s*(?:floor|storey)/i.exec(brief)?.[1];
 const bedrooms=programme.bedrooms??(bedroomsText?(numerals[bedroomsText.toLowerCase()]??Number(bedroomsText)):2),storeys=programme.storeys??(storeysText?(numerals[storeysText.toLowerCase()]??Number(storeysText)):2),target=programme.area_per_floor_m2??Number(areaText??96);
 const bathrooms=programme.bathrooms??(bathsText?(numerals[bathsText.toLowerCase()]??Number(bathsText)):1);
 if(bedrooms!==2||storeys!==2)throw Error('Design kernel v1 supports two storeys and two bedrooms; resolve another programme before building.');
 if(bathrooms!==1)throw Error('Design kernel v1 supports one bathroom; resolve another wet-core programme before building.');
 if(target<96||target>112)throw Error('Design kernel v1 tested area range is 96-112 m2 per floor; re-plan outside this range.');
 const selection=selectParti({brief,site:configured,programme}),scores=selection.candidates;
 const selected=parti??selection.selected;if(!['offset-bar','courtyard-sawtooth'].includes(selected))throw Error(`Parti ${selected} requires the brain to resolve custom volumes, levels and circulation; no fallback box was built.`);
 const name=project??(/\b(?:named|called)\s+["“]?([^"”\n.,;]+)/i.exec(brief)?.[1]?.trim())??(selected==='offset-bar'?'Offset Timber House':'Court and Light House');
 const d=selected==='offset-bar'?offsetHouse(name,configured,brief):courtHouse(name,configured,brief);
 d.programme={bedrooms,storeys,bathrooms,target_area_per_floor_m2:target,area_tolerance:0.15};
 d.design.parti_candidates=scores;d.design.selected_reason=parti?'Explicit architect selection':`Highest brief/site score (${scores[0].score})`;
 d.design.procedure=executionProcedure({brief,site:configured,programme});
 const roofPolicy=selectRoof({brief,site:configured,parti:selected});d.design.roof_policy=roofPolicy;
 if(selected==='courtyard-sawtooth'&&roofPolicy.selected!=='sawtooth')throw Error(`The requested ${roofPolicy.selected} roof needs a resolved multi-wing roof design. Use the roof profile compiler and explicit design schema; do not call a hip roof a shed.`);
 if(selected==='offset-bar'&&roofPolicy.selected==='sawtooth')throw Error('Use the courtyard-sawtooth family or resolve a custom offset-bar clerestory assembly.');
 if(selected==='offset-bar'&&['gable','butterfly','flat-green'].includes(roofPolicy.selected)){
  const main=d.roofs.find(r=>r.id==='main-shed');
  const compiled=roofProfiles({form:roofPolicy.selected,line:main.extrusion.line,span_mm:9000,sweep_mm:12000,pitch_deg:12,overhang_mm:600,level:main.level,type:main.type})[0];
  main.extrusion=compiled.extrusion;
  if(roofPolicy.selected==='flat-green'){
   main.type='green';main.extrusion.from=0;main.extrusion.to=12000;
   loop(d,'P',rect(1200,-1200,13200,7800),{level:'Roof Datum',type:'cedar',height:630,base_offset:591});
   d.design.roof_exception='Flat planted roof explicitly requested; 2% falls, parapet geometry, drainage/overflow detailing required.';
  }
  d.design.decisions=d.design.decisions.filter(x=>!x.startsWith('Use an 11.31'));
  d.design.decisions.push(`Primary roof: ${roofPolicy.selected}. ${roofPolicy.reason}`);
  d.design.limitations.push(...roofPolicy.hold_points);
 }
 d.design.assumptions=[`Concept site: true north ${configured.north_deg} degrees counter-clockwise from model +Y, street to true south; verify surveyed setbacks and site constraints before use.`, 'Area uses wall centre lines, not finished-face net usable area.','Structural sizes are concept placeholders with explicit spans, not certified engineering.'];
 d.design.limitations.push('BIMCraft 0.8.0 exports IFC TrueNorth unset. The plan north arrow and design-intent site.north_deg carry the declared orientation; georeference the IFC explicitly during project integration.');
 // Area variation is one-dimensional: width changes, service clearances and stair going do not.
 const sx=target/96;
 d.design.structure.east_projection_mm=round(1200*sx);d.design.structure.south_projection_mm=selected==='offset-bar'?1200:0;d.design.structure.stair_header_span_mm=round(5760*sx);
 if(sx!==1){d.design.decisions=d.design.decisions.map(t=>t.replace('1.2 m south and east',`1.2 m south and ${(1.2*sx).toFixed(2)} m east`).replace('extends 1.2 m over',`extends ${(1.2*sx).toFixed(2)} m over`));d.design.limitations.push(`Width variation: east cantilever ${(1.2*sx).toFixed(2)} m and stair header ${(5.76*sx).toFixed(2)} m; resize/engineer members before construction.`)}
 if(sx!==1){
  const point=p=>[round(p[0]*sx),p[1]];
  for(const v of d.volumes)v.footprint=v.footprint.map(point);
  for(const f of d.floors){f.boundary=f.boundary.map(point);if(f.openings)f.openings=f.openings.map(p=>p.map(point))}
  for(const w of d.walls){w.a=point(w.a);w.b=point(w.b)}
  for(const o of d.openings)o.at=point(o.at);
  for(const r of d.rooms){r.point=point(r.point);if(r.label_at)r.label_at=point(r.label_at)}
  for(const r of d.roofs){const line=r.extrusion.line;const dx=line[1][0]-line[0][0];r.extrusion.line=line.map(point);if(dx){r.extrusion.profile=r.extrusion.profile.map(([a,u])=>[a*sx,u])}else {r.extrusion.from*=sx;r.extrusion.to*=sx}}
  for(const s of d.stairs){s.start=point(s.start);s.void=s.void.map(point);s.entry_clear=s.entry_clear.map(point);s.exit_clear=s.exit_clear.map(point)}
  for(const g of d.guards)g.path=g.path.map(point);
  for(const x of [...d.columns,...d.components])x.at=point(x.at);
  for(const b of d.beams){b.a=point(b.a);b.b=point(b.b)}
 }
 // The last riser must meet the upper slab edge. A clearance margin belongs at
 // the lower end and sides of the hole, never beyond the upper stair exit.
 for(const s of d.stairs){const rise=d.levels.find(l=>l.name===s.top_level).elevation-d.levels.find(l=>l.name===s.level).elevation,risers=Math.ceil(rise/s.riser),run=(risers-1-s.landings.length)*s.tread+s.landings.length*s.width,end=s.start[0]+run,f=d.floors.find(f=>f.level===s.top_level&&f.type==='upper'),oldEnd=Math.max(...f.openings[0].map(p=>p[0]));
  f.openings[0]=f.openings[0].map(([x,y])=>[Math.abs(x-oldEnd)<1?end:x,y]);s.void=f.openings[0].map(p=>[...p]);
  const ys=s.exit_clear.map(p=>p[1]);s.exit_clear=rect(end,Math.min(...ys),end+1400,Math.max(...ys));
 }
 dimensions(d);orientToSite(d);
 const latitude=Math.abs(configured.latitude_deg);d.design.solar.target_summer_altitude_deg=round(Math.min(90,90-latitude+23.44));d.design.solar.target_winter_altitude_deg=round(Math.max(0,90-latitude-23.44));
 d.design.solar.summer_shadow_mm=round(d.design.solar.overhang_mm*Math.tan(d.design.solar.target_summer_altitude_deg*Math.PI/180));
 d.design.solar.winter_shadow_mm=round(d.design.solar.overhang_mm*Math.tan(d.design.solar.target_winter_altitude_deg*Math.PI/180));
 d.design.solar.minimum_full_summer_shade_mm=round((d.design.solar.window_height_mm+d.design.solar.head_gap_mm)/Math.tan(d.design.solar.target_summer_altitude_deg*Math.PI/180));
 d.design.solar.summer_shaded_fraction=round(Math.max(0,Math.min(1,(d.design.solar.summer_shadow_mm-d.design.solar.head_gap_mm)/d.design.solar.window_height_mm)));
 d.design.solar.winter_shaded_fraction=round(Math.max(0,Math.min(1,(d.design.solar.winter_shadow_mm-d.design.solar.head_gap_mm)/d.design.solar.window_height_mm)));
 if(d.design.solar.secondary_upper){const s=d.design.solar.secondary_upper;s.summer_shaded_fraction=round(Math.max(0,Math.min(1,(s.overhang_mm*Math.tan(d.design.solar.target_summer_altitude_deg*Math.PI/180)-s.head_gap_mm)/s.window_height_mm)));}
 if(configured.latitude_deg<0)throw Error('Southern hemisphere requires a mirrored solar/programme layout; kernel v1 refuses an unreviewed northern layout.');
 if(Math.abs(configured.north_deg%90)>0.01)d.design.limitations.push('BIMCraft 0.8.0 angled section A render needs beams hidden in that view; full beam geometry remains in IFC and other views.');
 const audit=validateDesign(d);if(!audit.ok)throw Error('Design preflight failed: '+audit.errors.join('; '));d.preflight=audit;return d;
}

function segmentProjection(p,a,b){const dx=b[0]-a[0],dy=b[1]-a[1],len=Math.hypot(dx,dy),t=((p[0]-a[0])*dx+(p[1]-a[1])*dy)/(len*len);return {len,t,along:t*len,distance:Math.hypot(p[0]-a[0]-t*dx,p[1]-a[1]-t*dy)}}
function orientation(w,north=0){const dx=w.b[0]-w.a[0],dy=w.b[1]-w.a[1],a=(Math.atan2(dx,-dy)*180/Math.PI-north+360)%360;return ['east','north','west','south'][Math.round(a/90)%4]}
export function validateDesign(d){
 const errors=[],warnings=[],areas={},facades={};
 const supportPositions=new Map();for(const col of d.columns){const k=JSON.stringify([col.level,col.at.map(round),col.base_offset??0,col.height,col.width,col.depth]);if(supportPositions.has(k))errors.push(`Duplicate column geometry ${col.id} / ${supportPositions.get(k)}`);supportPositions.set(k,col.id)}
 for(const f of d.floors){const gross=area(f.boundary),holes=(f.openings??[]).reduce((n,p)=>n+area(p),0);if(f.type==='deck')continue;areas[f.level]={gross_m2:round(gross),void_m2:round(holes),usable_slab_m2:round(gross-holes)};if(Math.abs(gross-holes-d.programme.target_area_per_floor_m2)/d.programme.target_area_per_floor_m2>d.programme.area_tolerance)errors.push(`${f.level}: slab area outside programme tolerance`)}
 const grouped=new Map();
 for(const o of d.openings){const w=d.walls.find(w=>w.id===o.host);if(!w){errors.push('Missing host '+o.id);continue}const p=segmentProjection(o.at,w.a,w.b);if(p.distance>1||p.along<o.width/2+140||p.len-p.along<o.width/2+140)errors.push('Invalid opening host/return '+o.id);const items=grouped.get(w.id)??[];for(const q of items)if(Math.abs(p.along-q.along)<(o.width+q.width)/2+140)errors.push('Opening overlap '+o.id);items.push({along:p.along,width:o.width});grouped.set(w.id,items)}
 for(const w of d.walls.filter(x=>x.exterior)){const dir=orientation(w,d.site.north_deg);const f=facades[dir]??{gross_wall_m2:0,window_m2:0};f.gross_wall_m2+=Math.hypot(w.b[0]-w.a[0],w.b[1]-w.a[1])*w.height/1e6;f.window_m2+=d.openings.filter(o=>o.host===w.id&&o.kind==='window').reduce((n,o)=>n+o.width*o.height/1e6,0);facades[dir]=f}
 for(const [dir,f]of Object.entries(facades)){f.ratio=round(f.window_m2/f.gross_wall_m2);f.target={south:[0.20,0.60],north:[0.08,0.35],east:[0.12,0.50],west:[0.05,0.30]}[dir];if(f.ratio<f.target[0]||f.ratio>f.target[1])warnings.push(`${dir} preliminary glazing ratio ${f.ratio} outside design target ${f.target}`);f.gross_wall_m2=round(f.gross_wall_m2);f.window_m2=round(f.window_m2)}
 if(d.volumes.length<2)errors.push('At least two useful volumes required');
 if(!d.roofs.some(r=>r.extrusion?.profile.some((p,i,a)=>i&&Math.abs(p[1]-a[i-1][1])>300))&&!d.design.roof_exception)errors.push('No non-flat roof; explicit brief exception required');
 if(d.design.entry.recess_mm<900||d.design.entry.clear_width_mm<900)errors.push('Entry not legible/clear');
 for(const s of d.stairs){const rise=d.levels.find(l=>l.name===s.top_level).elevation-d.levels.find(l=>l.name===s.level).elevation,risers=Math.ceil(rise/s.riser),run=(risers-1-s.landings.length)*s.tread+s.landings.length*s.width,local=s.void.map(p=>rotatePoint(p,-(d.axis_angle_deg??0))),xs=local.map(p=>p[0]),ys=local.map(p=>p[1]);if(Math.max(...xs)-Math.min(...xs)<run+199||Math.max(...ys)-Math.min(...ys)<s.width+199)errors.push('Stair void too small '+s.id)}
 if(d.site.width_m&&d.bounds[2]-d.bounds[0]>d.site.width_m*1000)errors.push('Building exceeds site width even before setbacks');
 if(d.site.depth_m&&d.bounds[3]-d.bounds[1]>d.site.depth_m*1000)errors.push('Building exceeds site depth even before setbacks');
 return {ok:!errors.length,errors,warnings,areas,preliminary_facades:facades,volume_count:d.volumes.length,non_flat_roofs:d.roofs.filter(r=>r.extrusion.profile.some((p,i,a)=>i&&Math.abs(p[1]-a[i-1][1])>300)).length};
}

export async function allElements(c){const out=[];for(let offset=0;offset<50000;offset+=500){const r=await c.call('query_elements',{offset,limit:500});out.push(...r.elements);if(out.length>=r.count)return out;if(!r.elements.length)break}throw Error('Incomplete native element query')}
async function json(path,data){await writeFile(path,JSON.stringify(data,null,2)+'\n')}
async function nativeImage(c,folder,view,file,extra={}){const r=await c.raw('render',{view,width:1800,height:view==='{3D}'?1600:1200,...extra});if(r.isError)throw Error(JSON.stringify(r));const im=r.content.find(x=>x.type==='image');if(!im)throw Error('No native view image');const path=join(folder,file);await writeFile(path,Buffer.from(im.data,'base64'));return path}

export async function buildDesign(c,d,folder,{sheets=true,views=true}={}){
 if(sheets&&Math.abs((d.axis_angle_deg??0)%90)>0.01)throw Error('BIMCraft 0.8.0 cannot reliably draw the full angled section sheet set. Export rotated model/IFC/views with sheets:false, or author in a documented orthogonal project frame. No partial sheet set is accepted.');
 await mkdir(folder,{recursive:true});await json(join(folder,'design-intent.json'),d);
 const existing=await allElements(c);if(existing.some(x=>x.category!=='level'))throw Error('Design route requires an empty dedicated headless client; existing projects must be preserved.');
 const commands=[],ids={};
 const exec=async(command,params={})=>{commands.push({command,params});try{return await c.exec(command,params)}catch(e){await json(join(folder,'failed-command.json'),{index:commands.length,command,params,error:e.message});await writeFile(join(folder,'build-script.txt'),commands.map(x=>x.command+' '+JSON.stringify(x.params)).join('\n'));throw e}};
 const saveID=(key,r)=>ids[key]=r.id??r.ids?.[0];
 await exec('new',{name:d.project});const initial=await c.call('inspect_model');
 for(const [i,l]of d.levels.entries()){if(i<initial.levels.length)await exec('modify',{id:initial.levels[i].id,name:l.name,elevation:l.elevation});else await exec('level',{name:l.name,elevation:l.elevation})}
 const mats=new Set(Object.values(ASSEMBLIES).flat().map(x=>x.material));for(const m of Object.keys(MATERIALS))mats.add(m);
 for(const name of mats)await exec('material',{name,color:'#b9b4a9',...(MATERIALS[name]??{})});
 for(const name of ['cedar','charcoal','base','partition'])await exec('type',{category:'wall',name,layers:ASSEMBLIES[name]});
 for(const name of ['ground','upper','deck'])await exec('type',{category:'floor',name,layers:ASSEMBLIES[name]});
 for(const name of ['metalRoof','green'])await exec('type',{category:'roof',name,layers:ASSEMBLIES[name]});
 await exec('type',{category:'railing',name:'Guard 1100',height:1100,spacing:100});
 // Register an explicit design move on native products (exported as properties by BIMCraft).
 await exec('parameter',{name:'Design role',kind:'text',categories:['wall','floor','roof','door','window','column','stair','railing','room']});
 await exec('parameter',{name:'Floor area excluding voids',kind:'number',categories:['room']});
 for(const r of d.roofs){saveID(r.id,await exec('roof',{level:r.level,type:r.type,extrusion:r.extrusion}));await exec('modify',{id:ids[r.id],params:{'Design role':r.id}})}
 for(const f of d.floors){saveID(f.id,await exec('floor',{level:f.level,type:f.type,boundary:f.boundary,openings:f.openings??[],offset:f.offset??0,structural:f.type!=='deck'}));await exec('modify',{id:ids[f.id],params:{'Design role':f.id}})}
 for(const w of d.walls){saveID(w.id,await exec('wall',{points:[w.a,w.b],level:w.level,type:w.type,height:w.height,base_offset:w.base_offset??0,...(w.roof?{attach_top:ids[w.roof]}:{})}));}
 for(const o of d.openings){const w=d.walls.find(w=>w.id===o.host),offset=segmentProjection(o.at,w.a,w.b).along;
  const type=`${o.width}x${o.height}`,family=o.kind==='window'?'Fixed Window':'Single Door';
  await exec('family',{name:family,types:{[type]:{Width:o.width,Height:o.height,...(o.kind==='window'?{'Sill Height':o.sill,'Frame Depth':120}:{}),'Frame Width':60,'Frame Material':'Metal'}}});
  saveID(o.id,await exec(o.kind,{wall:ids[o.host],offset,level:o.level,family,type,mark:o.id,...(o.kind==='window'?{sill:o.sill}:{}),...(o.flip_facing?{flip_facing:true}:{})}));
  await exec('modify',{id:ids[o.id],params:{'Design role':o.role}});
 }
 for(const col of d.columns){const type=`Post ${col.width}x${col.depth}`;await exec('type',{category:'column',name:type,width:col.width,depth:col.depth});saveID(col.id,await exec('column',{at:col.at,level:col.level,height:col.height,base_offset:col.base_offset,type}));await exec('paint',{id:ids[col.id],material:'Glulam'})}
 for(const b of d.beams){const type=`Glulam ${b.width}x${b.depth}`;await exec('type',{category:'beam',name:type,width:b.width,depth:b.depth,material:'Glulam'});saveID(b.id,await exec('beam',{points:[b.a,b.b],level:b.level,offset:b.offset,end_offset:b.end_offset??b.offset,type,system:b.role}))}
 for(const s of d.stairs){saveID(s.id,await exec('stair',{start:s.start,angle:s.angle,level:s.level,top_level:s.top_level,width:s.width,riser:s.riser,tread:s.tread,landings:s.landings,railings:true}));}
 for(const g of d.guards){saveID(g.id,await exec('railing',{path:g.path,level:g.level,type:'Guard 1100'}));await exec('paint',{id:ids[g.id],material:'Metal'})}
 for(const r of d.rooms)saveID(r.id,await exec('room',{point:r.point,level:r.level,name:r.name,number:r.id}));
 const roomElements=await allElements(c),roomAreas=[];
 for(const r of d.rooms){
  const actual=roomElements.find(x=>x.id===ids[r.id]),floor=d.floors.find(f=>f.level===r.level&&f.type!=='deck');
  const subtract=(r.subtract_void_indices??[]).reduce((n,i)=>n+area(floor.openings[i]),0),net=round(actual.area_m2-subtract);
  await exec('modify',{id:ids[r.id],params:{'Floor area excluding voids':net}});
  roomAreas.push({id:r.id,name:r.name,level:r.level,centre_line_room_m2:actual.area_m2,void_m2:round(subtract),centre_line_floor_m2:net});
  if(r.label_at)await exec('text',{view:r.level,text:`${r.name}\n${r.id} / ${net.toFixed(2)} m2 floor`,at:r.label_at,size:1.8});
 }
 await json(join(folder,'room-floor-schedule.json'),roomAreas);
 for(const f of d.components)await exec('component',f);
 const [x0,y0,x1,y1]=d.bounds;
 const [lx0,ly0,lx1,ly1]=d.local_bounds??d.bounds,angle=d.axis_angle_deg??0,world=p=>rotatePoint(p,angle),local=p=>rotatePoint(p,-angle);
 for(const [i,x]of [lx0,(lx0+lx1)/2,lx1].entries())await exec('grid',{name:String.fromCharCode(65+i),start:world([x,ly0]),end:world([x,ly1])});
 for(const [i,y]of [ly0,(ly0+ly1)/2,ly1].entries())await exec('grid',{name:String(i+1),start:world([lx0,y]),end:world([lx1,y])});
 for(const l of d.levels.filter(l=>l.occupied)){
  await exec('scale',{view:l.name,scale:50});await exec('detail',{view:l.name,detail:'fine'});
  await exec('graphics',{view:l.name,hide:['sections','elevations','beams','rooms']});
  await exec('crop',{view:l.name,region:[[x0-1000,y0-2200],[x1+2200,y1+1000]]});
  // Short opening marks and a separate schedule keep plans readable.
  const walls=d.walls.filter(w=>w.level===l.name).map(w=>({...w,a:local(w.a),b:local(w.b)}));
  for(const r of d.rooms.filter(r=>r.level===l.name)){
   const [x,y]=local(r.point),v=walls.filter(w=>Math.abs(w.a[0]-w.b[0])<1&&y>Math.min(w.a[1],w.b[1])&&y<Math.max(w.a[1],w.b[1])),h=walls.filter(w=>Math.abs(w.a[1]-w.b[1])<1&&x>Math.min(w.a[0],w.b[0])&&x<Math.max(w.a[0],w.b[0]));
   const left=v.filter(w=>w.a[0]<x).sort((a,b)=>b.a[0]-a.a[0])[0],right=v.filter(w=>w.a[0]>x).sort((a,b)=>a.a[0]-b.a[0])[0],bottom=h.filter(w=>w.a[1]<y).sort((a,b)=>b.a[1]-a.a[1])[0],top=h.filter(w=>w.a[1]>y).sort((a,b)=>a.a[1]-b.a[1])[0];
   if(left&&right&&bottom)await exec('dimension',{level:l.name,refs:[{id:ids[left.id]},{id:ids[right.id]}],at:world([x,bottom.a[1]+350])});
   if(bottom&&top&&left)await exec('dimension',{level:l.name,refs:[{id:ids[bottom.id]},{id:ids[top.id]}],at:world([left.a[0]+350,y])});
  }
  // An overall orthogonal dimension between two extremal parallel exterior walls.
  const vs=walls.filter(w=>w.exterior&&Math.abs(w.a[0]-w.b[0])<1).sort((a,b)=>a.a[0]-b.a[0]);
  const hs=walls.filter(w=>w.exterior&&Math.abs(w.a[1]-w.b[1])<1).sort((a,b)=>a.a[1]-b.a[1]);
  if(vs.length>1)await exec('dimension',{level:l.name,refs:[{id:ids[vs[0].id]},{id:ids[vs.at(-1).id]}],at:world([(lx0+lx1)/2,ly0-1800])});
  if(hs.length>1)await exec('dimension',{level:l.name,refs:[{id:ids[hs[0].id]},{id:ids[hs.at(-1).id]}],at:world([lx1+1600,(ly0+ly1)/2])});
  // A text leader points toward its target: place its arrow tip to declared north.
  await exec('text',{view:l.name,text:'N',at:world([lx1+700,ly1-200]),size:3,leader:world([lx1+700,ly1+500])});
 }
 for(const spec of d.sections)await exec('section',spec);
 for(const spec of d.elevations)await exec('elevation',spec);
 if(Math.abs(angle%90)>0.01)await exec('graphics',{view:'Section A - stair and structure',hide:['beams']});
 const supportLevels=(await c.call('inspect_model')).levels.filter(l=>['Podium Cover','Entry Canopy','Clerestory Sill'].includes(l.name)).map(l=>l.id);
 for(const view of ['Section A - stair and structure','Section B - roof and living','South elevation','East elevation','North elevation','West elevation'])await exec('graphics',{view,hide_elements:supportLevels});
 await exec('graphics',{view:'{3D}',hide:['levels','grids','rooms','dimensions','sections','elevations']});
 await exec('visual_style',{view:'{3D}',style:'shaded'});
 const model=join(folder,'project.bimcraft'),ifc=join(folder,'project.ifc');await c.call('save',{path:model});await c.call('save',{path:ifc});
 const elements=await allElements(c),inspect=await c.call('inspect_model');await json(join(folder,'elements.json'),elements);await json(join(folder,'inspect.json'),inspect);await json(join(folder,'native-ids.json'),ids);
 const audit=auditBuiltDesign(d,elements,inspect,ids);await json(join(folder,'design-audit.json'),audit);if(!audit.ok)throw Error('Native design audit failed: '+audit.errors.join('; '));
 const files={model,ifc,views:[],sheets:[]};
 if(views){for(const [view,file,extra]of [['{3D}','exterior-sw.png',{azimuth:225+angle,elevation:24}],['{3D}','exterior-se.png',{azimuth:315+angle,elevation:24}],['{3D}','exterior-ne.png',{azimuth:45+angle,elevation:28}],['Ground Floor','ground-plan.png',{}],['Upper Floor','upper-plan.png',{}],['Section B - roof and living','section-roof.png',{}]])files.views.push(await nativeImage(c,folder,view,file,extra));}
 if(sheets){
  const pageViews=['Ground Floor','Upper Floor','Section A - stair and structure','Section B - roof and living','South elevation','East elevation','North elevation','West elevation','{3D}'];
  for(const [i,v]of pageViews.entries()){
   const number='AIT'+String(100+i),is3d=v==='{3D}',name=is3d?'Exterior axonometric':v;
   const large=(y1-y0+3200)/50>330||(x1-x0+3200)/50>540,paper=large?[841,594]:[594,420];
   await exec('sheet',{number,name,size:large?'A1':'A2'});await exec('place',{sheet:number,view:v,scale:is3d?65:50,at:[paper[0]/2,paper[1]/2+20],...(is3d?{azimuth:315+angle,elevation:24}:{})});
   await exec('text',{view:number,text:'ARCITECH - CONCEPT DESIGN - NOT FOR CONSTRUCTION',at:[20,paper[1]-25],size:2.4});
   if(i===2&&Math.abs(angle%90)>0.01)await exec('text',{view:number,text:'Beams omitted in this angled section view due to a native drawing limitation. Full members remain in IFC and 3D.',at:[20,72],size:2});
   if(i===3)for(const [j,text]of ['ROOF: 30 metal + 25 cavity + 10 underlay + 220 insulated rafters + 12 sheathing + 13 lining = 310 mm',
    'STRUCTURE: concept glulam grid; verify snow, drift, wind, deflection and connections.',
    'FLOORS: 365 mm ground / 340 mm timber intermediate. WALLS: 230 mm timber envelope.'].entries())await exec('text',{view:number,text,at:[20,72-j*6],size:2.0});
   files.sheets.push({number,view:v,scale:is3d?65:50,png:await nativeImage(c,folder,number,'sheet-'+number+'.png')});
  }
  files.pdf=join(folder,'sheets.pdf');files.sheet_model=join(folder,'sheets.bimcraft');await c.call('save',{path:files.pdf});await c.call('save',{path:files.sheet_model});
 }
 await writeFile(join(folder,'build-script.txt'),commands.map(x=>x.command+' '+JSON.stringify(x.params)).join('\n')+'\n');
 const hash=async path=>createHash('sha256').update(await readFile(path)).digest('hex');
 await json(join(folder,'manifest.json'),{project:d.project,files,counts:inspect.counts,audit_ok:audit.ok,commands:commands.length,generated_at:new Date().toISOString(),
  kernel_sha256:await hash(new URL(import.meta.url)),method_sha256:await hash(new URL('./design-method.mjs',import.meta.url)),design_sha256:await hash(join(folder,'design-intent.json')),native_sha256:await hash(model),ifc_sha256:await hash(ifc),...(files.sheet_model?{sheet_model_sha256:await hash(files.sheet_model),pdf_sha256:await hash(files.pdf)}:{})});
 return {files,audit,counts:inspect.counts,commands:commands.length};
}

export function auditBuiltDesign(d,e,inspect,ids){
 const errors=[],warnings=[...d.preflight.warnings,...d.design.limitations],byId=new Map(e.map(x=>[x.id,x])),byGuid=new Map(e.map(x=>[x.guid,x])),facades={};
 const na=d.site.north_deg*Math.PI/180,northVector=[-Math.sin(na),Math.cos(na)],northNotes=e.filter(x=>x.category==='text'&&x.text==='N');
 if(northNotes.length!==d.levels.filter(l=>l.occupied).length)errors.push('Missing plan north annotation');
 for(const n of northNotes){const v=n.leader?.map((x,i)=>x-n.at[i]),length=v?Math.hypot(...v):0;if(length<100||(v[0]*northVector[0]+v[1]*northVector[1])/length<0.99)errors.push('North annotation points away from declared north '+n.id)}
 for(const w of d.walls.filter(w=>w.exterior)){const actual=byId.get(ids[w.id]);if(!actual){errors.push('Missing native wall '+w.id);continue}const dir=orientation(w,d.site.north_deg),f=facades[dir]??{gross_wall_m2:0,glazing_m2:0,openings:0};
  // Native wall.height is maximum height for a roof-attached wall; report conservative denominator.
  f.gross_wall_m2+=actual.length*actual.height/1e6;
  for(const o of d.openings.filter(o=>o.host===w.id&&o.kind==='window')){const n=byId.get(ids[o.id]);if(!n){errors.push('Missing native window '+o.id);continue}f.glazing_m2+=n.width*n.height/1e6;f.openings++}facades[dir]=f;
 }
 for(const f of Object.values(facades)){f.ratio=round(f.glazing_m2/f.gross_wall_m2);f.glazing_m2=round(f.glazing_m2);f.gross_wall_m2=round(f.gross_wall_m2)}
 const rooms=e.filter(x=>x.category==='room');for(const r of rooms)if(!r.enclosed||r.area_m2<=0)errors.push('Unenclosed room '+r.name);
 const roofs=d.roofs.map(r=>{const actual=byId.get(ids[r.id]),p=actual?.extrusion?.profile??[],rise=p.length?Math.max(...p.map(x=>x[1]))-Math.min(...p.map(x=>x[1])):0;return {id:r.id,native_id:actual?.id,profile_rise_mm:round(rise),form:actual?.extrusion?'extrusion':'unexpected',ridge_mm:actual?.ridge}});
 if(!roofs.some(r=>r.profile_rise_mm>300)&&!d.design.roof_exception)errors.push('No measured non-flat primary roof');
 for(const w of d.walls.filter(w=>w.roof))if(byId.get(ids[w.id])?.attach_top!==byId.get(ids[w.roof])?.guid)errors.push('Wall is not attached to its selected roof '+w.id);
 const stairs=e.filter(x=>x.category==='stair');if(stairs.length!==d.stairs.length)errors.push('Missing stair');
 if(inspect.warnings.length)errors.push(...inspect.warnings.map(x=>'Native warning: '+x));
 const floors=d.floors.map(f=>({id:f.id,level:f.level,native_area_m2:byId.get(ids[f.id])?.area_m2,gross_m2:round(area(f.boundary)),void_m2:round((f.openings??[]).reduce((n,p)=>n+area(p),0)),outdoor:f.type==='deck'}));
 return {ok:!errors.length,errors,warnings,counts:inspect.counts,volumes:d.volumes.length,roofs,rooms:rooms.map(r=>({name:r.name,area_m2:r.area_m2,enclosed:r.enclosed})),floors,facades,facade_area_basis:'window opening area / native maximum-height wall envelope; roof-attached tapered walls make denominator conservative; frames not deducted',solar:d.design.solar,entry:d.design.entry,stair_native:stairs,structural_status:'concept members modeled; load capacity not certified'};
}
