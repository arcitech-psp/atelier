// Small executable architecture rules. Policy is separate from coordinates and native commands.
export const DESIGN_RULES=Object.freeze({
 version:'1.0',units:'mm',primary_grid_mm:[3000,3600,4000,4800],facade_module_mm:600,
 minimum_distinct_volumes:2,minimum_entry_recess_mm:900,minimum_entry_clear_width_mm:1000,
 default_concept_cantilever_mm:1200,maximum_concept_cantilever_mm:1500,minimum_backspan_to_cantilever:3,
 minimum_circulation_clear_mm:1000,minimum_stair_clear_width_mm:1000,minimum_headroom_mm:2100,
 stair_riser_range_mm:[165,180],stair_going_range_mm:[270,300],minimum_opening_return_mm:150,
 south_glazing:[0.20,0.60],north_glazing:[0.08,0.35],east_glazing:[0.12,0.50],west_glazing:[0.05,0.30],
 require_flat_roof_reason:true,require_native_roof_profile:true,require_roof_wall_attachment:true,
 require_separate_outdoor_area:true,require_floor_void_subtraction:true,require_support_path:true
});

export function solarControl({latitude_deg=51.05,window_height_mm=2550,head_gap_mm=60,summer_shade_fraction=1,max_projection_mm=1500}={}){
 for(const n of [latitude_deg,window_height_mm,head_gap_mm,summer_shade_fraction,max_projection_mm])if(!Number.isFinite(n))throw Error('Solar dimensions must be finite');
 if(Math.abs(latitude_deg)>=66.56||Math.abs(latitude_deg)<=23.44)throw Error('Polar or tropical site needs an hourly/seasonal sun study; the temperate two-solstice shortcut is not applicable');
 const altitude_summer=90-Math.abs(latitude_deg)+23.44,altitude_winter=90-Math.abs(latitude_deg)-23.44;
 const needed=(window_height_mm*summer_shade_fraction+head_gap_mm)/Math.tan(altitude_summer*Math.PI/180);
 const projection=Math.min(max_projection_mm,Math.ceil(needed/50)*50),summer_shadow=projection*Math.tan(altitude_summer*Math.PI/180),winter_shadow=projection*Math.tan(altitude_winter*Math.PI/180);
 return {sun_facade:latitude_deg>=0?'south':'north',altitude_summer_deg:altitude_summer,altitude_winter_deg:altitude_winter,
  required_projection_mm:Math.round(needed),chosen_projection_mm:projection,
  summer_glass_shaded_fraction:Math.max(0,Math.min(1,(summer_shadow-head_gap_mm)/window_height_mm)),
  winter_glass_shaded_fraction:Math.max(0,Math.min(1,(winter_shadow-head_gap_mm)/window_height_mm)),
  target_met:projection>=needed,scope:'Solar-noon perpendicular facade section; not annual thermal or daylight simulation. East/west low sun requires fins, shutters or vegetation.'};
}

export function selectParti({brief='',site={},programme={}}={}){
 const p=[
  {id:'offset-bar',score:4,moves:['stack','shift upper 1200','recess living/entry','mono-pitch','south deck'],kernel_supported:true},
  {id:'courtyard-sawtooth',score:2,moves:['L-plan','court outdoor room','upper court cantilever','north clerestories','tall entry'],kernel_supported:true},
  {id:'u-court',score:0,moves:['three wings','protected court','bridge','separate roof per wing'],kernel_supported:false},
  {id:'terraced-split-level',score:0,moves:['step slabs with grade','short connecting stair','terrace roof of lower volume'],kernel_supported:false}
 ];
 const add=(id,n)=>p.find(x=>x.id===id).score+=n;
 if(/offset|cantilever|stack|mono.?pitch/i.test(brief))add('offset-bar',8);
 if(/court|L[- ](?:plan|shap)|sawtooth|north.light/i.test(brief))add('courtyard-sawtooth',10);
 if(site.width_m&&site.width_m<17)add('offset-bar',4);
 if(site.privacy==='high'||site.prevailing_wind==='northwest')add('courtyard-sawtooth',4);
 if(/U[- ](?:plan|shap)|enclosed court/i.test(brief))add('u-court',20);
 if(Math.abs(site.grade_drop_mm??0)>600||/split.level|steep site/i.test(brief))add('terraced-split-level',20);
 if((programme.area_per_floor_m2??96)>150)add('u-court',5);
 p.sort((a,b)=>b.score-a.score);
 return {selected:p[0].id,candidates:p,next:p[0].kernel_supported?'compile-tested-family':'brain-must-resolve-explicit-volumes-and-circulation; do not substitute a box'};
}

export function selectRoof({brief='',site={},parti='offset-bar'}={}){
 const cold=/cold|snow|alpine/i.test(site.climate??'cold-snow');
 const options=[
  {form:'mono-pitch',score:cold?6:4,reason:'One external drainage edge; simple timber spanning and a deep solar eave.'},
  {form:'gable',score:cold?5:2,reason:'Two external drainage edges; balanced load path and no central valley.'},
  {form:'sawtooth',score:parti==='courtyard-sawtooth'?10:0,reason:'North light to studio/upper rooms; price step flashings and snow drift loads.'},
  {form:'flat-green',score:0,reason:'Retained planted outdoor/ecological surface; needs load, falls, drainage and parapet design.'},
  {form:'butterfly',score:cold?-10:0,reason:'Central collection valley; requires redundant drainage and maintenance access.'}
 ];
 if(/alpine|high.wind|heavy.snow/i.test(site.climate??''))options.find(x=>x.form==='gable').score+=5;
 for(const [pattern,form]of [[/mono.?pitch|shed/i,'mono-pitch'],[/gable/i,'gable'],[/sawtooth|clerestory/i,'sawtooth'],[/green roof|planted roof|flat roof/i,'flat-green'],[/butterfly/i,'butterfly']]){
  const match=pattern.exec(brief);if(!match)continue;
  const before=brief.slice(Math.max(0,match.index-45),match.index),after=brief.slice(match.index+match[0].length,match.index+match[0].length+40);
  const negated=/\b(?:no|not|avoid|without|instead of|rather than)\s+(?:(?:a|an|the|plain|simple)\s+)*$/i.test(before);
  const optional=/^\s*(?:or|unless|if suitable)/i.test(after);
  options.find(x=>x.form===form).score+=negated?-100:optional?3:30;
 }
 options.sort((a,b)=>b.score-a.score);
 return {selected:options[0].form,reason:options[0].reason,options,
  hold_points:options[0].form==='butterfly'&&cold?['Explicit cold-climate valley/drain/snow strategy required before construction acceptance']:[]};
}

// Roof profile compiler. Native BIMCraft profiles are UNDERSIDE, measured from the
// roof datum. A line in +X sweeps +Y; caller may rotate the line to any plan axis.
export function roofProfiles({form='mono-pitch',line=[[0,0],[8000,0]],span_mm=8000,sweep_mm=6000,pitch_deg=12,overhang_mm=600,teeth=2,level='Roof Datum',type='metalRoof'}={}){
 if(!['mono-pitch','gable','butterfly','flat-green','sawtooth'].includes(form))throw Error('Unknown roof form');
 if(span_mm<=0||sweep_mm<=0||pitch_deg<0||pitch_deg>60||overhang_mm<0||!Number.isInteger(teeth)||teeth<1||teeth>8)throw Error('Invalid roof dimensions');
 const m=Math.tan(pitch_deg*Math.PI/180),L=span_mm,H=overhang_mm;
 const spec=profile=>({level,type,extrusion:{line,profile,from:-H,to:sweep_mm+H}});
 if(form==='mono-pitch')return [spec([[-H,-H*m],[L+H,(L+H)*m]])];
 if(form==='gable')return [spec([[-H,-H*m],[L/2,L/2*m],[L+H,-H*m]])];
 if(form==='butterfly')return [spec([[-H,(L/2+H)*m],[L/2,0],[L+H,(L/2+H)*m]])];
 if(form==='flat-green')return [spec([[0,0],[L,L*0.02]])]; // 2% falls, not a zero-fall lid.
 const bay=L/teeth;
 return Array.from({length:teeth},(_,i)=>spec([[i*bay-(i===0?H:0),i===0?-H*m:0],[i*bay+bay+(i===teeth-1?H:0),bay*m+(i===teeth-1?H*m:0)]]));
}

export function executionProcedure(input={}){
 const parti=selectParti(input),roof=selectRoof({...input,parti:parti.selected});
 const rise=input.programme?.floor_to_floor_mm??3000,risers=Math.ceil(rise/177);
 return {rules:DESIGN_RULES,parti,roof,solar:solarControl({latitude_deg:input.site?.latitude_deg??51.05}),
  staircase:{rise_mm:rise,risers,actual_riser_mm:rise/risers,going_mm:280,width_mm:1000,landing_after:Math.floor(risers/2)},
  required_decisions:['site and true north','adjacency and entry','conditioned volumes and outdoor room','roof and drainage edges','support grid and opening headers','stair/void/landing topology','facade modules and orientation ratios','native elements','measured IFC checks','look at two opposite axonometrics and sheets'],
  completion:'A model may be valid IFC and still fail the brief, clearances or visual review.'};
}
