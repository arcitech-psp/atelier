// Staging adapter for luna-bimcraft-arch. Caller owns confinement, client lifetime and tool routing.
import {mkdir,readFile,writeFile} from 'node:fs/promises';
import {join,basename,dirname,extname} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {execFile} from 'node:child_process';import {promisify} from 'node:util';
import {fileURLToPath} from 'node:url';
import {generateDesign,buildDesign,auditBuiltDesign,allElements} from './at-bimcraft-design.mjs';
const here=dirname(fileURLToPath(import.meta.url)),runFile=promisify(execFile);
const readJSON=async p=>JSON.parse(await readFile(p,'utf8'));
const hash=async p=>createHash('sha256').update(await readFile(p)).digest('hex');
export async function buildDesignRoute(c,project,args,config={}){
 if(config.connect)throw Error('New architecture design uses a dedicated headless client; preserve the connected owner project.');
 if(!args.brief||args.plan||args.plan_files)throw Error('Design route expects brief, not source drawing inputs.');
 const python=config.ifcPython??process.env.AT_BIMCRAFT_IFC_PYTHON;
 if(!python)throw Error('Configure the existing IfcOpenShell Python for design acceptance.');
 const explicit=/\b(?:named|called)\s+["“]?([^"”\n.,;]+)/i.exec(args.brief)?.[1]?.trim();
 const d=generateDesign({brief:args.brief,project:args.project_name??explicit??basename(project),parti:args.design_parti,site:args.design_site,programme:args.design_programme});
 const folder=join(project,'bim-design-'+randomUUID().slice(0,8));await mkdir(folder);
 const result=await buildDesign(c,d,folder);
 const validation=await runFile(python,[join(here,'validate-ifc.py'),result.files.ifc],{windowsHide:true,timeout:120000,maxBuffer:2*1024*1024});
 const ifc=JSON.parse(validation.stdout);if(!ifc.valid)throw Error('IFC validation failed: '+JSON.stringify(ifc.issues));
 await writeFile(join(folder,'ifc-validation.json'),JSON.stringify(ifc,null,2));
 await runFile(python,[join(here,'audit-design-geometry.py'),folder],{windowsHide:true,timeout:120000,maxBuffer:2*1024*1024});
 const geometry=await readJSON(join(folder,'geometry-audit.json'));if(!geometry.ok)throw Error('Architectural geometry audit failed');
 return {ok:true,project_name:d.project,plan_source:'ait.bim-design/1',design_intent:join(folder,'design-intent.json'),
  files:result.files,counts:result.counts,rooms:await readJSON(join(folder,'room-floor-schedule.json')),
  parti:d.parti,roof_policy:d.design.roof_policy,ifc_validation:ifc,geometry_audit:join(folder,'geometry-audit.json'),
  design_warnings:[...result.audit.warnings,...geometry.warnings],visual_review_required:result.files.views};
}
export async function inspectDesignRoute(c,model){
 const folder=dirname(model),d=await readJSON(join(folder,'design-intent.json')),ids=await readJSON(join(folder,'native-ids.json')),manifest=await readJSON(join(folder,'manifest.json'));
 if(extname(model).toLowerCase()!=='.bimcraft')throw Error('Inspect the native project.bimcraft or sheets.bimcraft for design intent; validate the IFC separately.');
 const actualHash=await hash(model);if(![manifest.native_sha256,manifest.sheet_model_sha256].includes(actualHash))throw Error('Model changed since design receipt; regenerate its measured checks before acceptance.');
 const e=await allElements(c),inspect=await c.call('inspect_model'),audit=auditBuiltDesign(d,e,inspect,ids);
 if(!audit.ok)throw Error('Design audit failed: '+audit.errors.join('; '));
 return {project_name:d.project,counts:inspect.counts,audit,rooms:await readJSON(join(folder,'room-floor-schedule.json')),geometry:await readJSON(join(folder,'geometry-audit.json'))};
}
export async function designSheetsRoute(model){
 const folder=dirname(model),m=await readJSON(join(folder,'manifest.json'));if(!m.files.pdf||!m.files.sheet_model)throw Error('Design has no accepted sheet set');
 if(![m.native_sha256,m.sheet_model_sha256].includes(await hash(model)))throw Error('Model changed since sheet acceptance');
 if(await hash(m.files.sheet_model)!==m.sheet_model_sha256)throw Error('Sheet model changed since acceptance');
 if(await hash(m.files.pdf)!==m.pdf_sha256)throw Error('Sheet PDF changed since acceptance');
 return {project_name:m.project,pdf:m.files.pdf,model:m.files.sheet_model,pages:m.files.sheets.map(x=>({number:x.number,view:x.view,scale:x.scale})),png_files:m.files.sheets.map(x=>x.png),reused_existing:true};
}
