// Turn-scoped file checkpoints and reversible undo.
import {createHash, randomUUID} from 'node:crypto';
import {existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync} from 'node:fs';
import {basename, dirname, isAbsolute, join, relative, resolve, sep} from 'node:path';
import {dshHomePath} from '@deepseek-ai/dsh-home-paths';

export const name='atelier-undo';
export const inject=['tools','webServer','connection'];
export const STORE=dshHomePath('atelier-undo');
export const LIMITS={files:2000,bytes:64*1024*1024,fileBytes:20*1024*1024,skipRecords:500};
const hash=b=>createHash('sha256').update(b).digest('hex');
const manifestPath=(store,id)=>join(store,'turns',`${id}.json`);
const blobPath=(store,h)=>join(store,'blobs',h);
const skipDir=new Set(['.git','node_modules']);

function walk(root,limit=LIMITS) {
  const files=new Map(), skipped=[]; let bytes=0,capped=false;
  const note=(path,reason)=>{const cap=limit.skipRecords??LIMITS.skipRecords;if(skipped.length<cap)skipped.push({path,reason});else{const tail=skipped.at(-1);if(tail?.reason==='additional skips summarized')tail.count++;else skipped[cap-1]={path:'*',reason:'additional skips summarized',count:1};}};
  try{const st=lstatSync(root);if(st.isSymbolicLink()){skipped.push({path:'.',reason:'symlink'});return {files,skipped,bytes};}if(st.isFile()){if(st.size>limit.fileBytes)skipped.push({path:basename(root),reason:'over 20 MB'});else if(st.size>limit.bytes)skipped.push({path:basename(root),reason:'snapshot size limit'});else{const data=readFileSync(root);files.set(resolve(root),{rel:'',data,hash:hash(data)});bytes=data.length;}return {files,skipped,bytes};}}catch{}
  const visit=dir=>{
    if(capped)return;
    let entries; try{entries=readdirSync(dir,{withFileTypes:true});}catch{return;}
    for(const e of entries){
      if(capped)return;
      const p=join(dir,e.name), rel=relative(root,p);
      if(e.isSymbolicLink()){note(rel,'symlink');continue;}
      if(e.isDirectory()){if(skipDir.has(e.name)){note(rel,'excluded directory');continue;} visit(p);continue;}
      if(!e.isFile())continue;
      if(files.size>=limit.files){note(rel,'file-count limit; remaining scope skipped');capped=true;return;}
      try{const st=statSync(p);if(st.size>limit.fileBytes){note(rel,'over 20 MB');continue;} if(bytes+st.size>limit.bytes){note(rel,'snapshot size limit; remaining scope skipped');capped=true;return;} const data=readFileSync(p);files.set(resolve(p),{rel,data,hash:hash(data)});bytes+=data.length;}catch{note(rel,'unreadable');}
    }
  }; visit(root); return {files,skipped,bytes};
}
function argsOf(exec){if(typeof exec.arguments==='string'){try{return JSON.parse(exec.arguments)}catch{return {text:exec.arguments}}}return exec.arguments??{};}
// Tools that can change files. Everything else (read, grep, glob, web, knowledge, todo...) passes through untouched:
// snapshotting every call meant two full scans of the workspace (up to 2000 files / 64 MB) around each read.
export const MUTATING=/(?:^|_)(?:write|edit|patch|move|rename|delete|remove|mkdir|notebook|bash|pwsh|powershell|shell|exec|command|terminal)/i;
const SHELL=/(?:^|_)(?:bash|pwsh|powershell|shell|exec|command|terminal)/i;
function rootsFor(exec){
  const a=argsOf(exec), name=String(exec?.name??'');
  const targets=[];
  for(const key of ['path','filePath','file_path','filename','file','target','destination','source'])if(typeof a[key]==='string'&&isAbsolute(a[key]))targets.push(a[key]);
  for(const paths of [a.paths,a.files])if(Array.isArray(paths))for(const p of paths)if(typeof p==='string'&&isAbsolute(p))targets.push(p);
  // A file-targeted tool: snapshot exactly those files (a missing file is a creation; its parent is not scanned).
  if(targets.length&&!SHELL.test(name))return [...new Set(targets.map(x=>resolve(x)))];
  const candidates=[...targets,a.cwd,a.workdir,a.directory,exec.cwd,exec.agent?.cwd,exec.agent?.workdir,exec.agent?.session?.header?.cwd,exec.agent?.session?.cwd];
  const text=[typeof exec.arguments==='string'?exec.arguments:'',...Object.values(a).filter(v=>typeof v==='string')].join('\n');
  for(const m of text.matchAll(/(?:FILES YOU MAY EDIT|JOB SCOPE|WORKING DIRECTORY|CWD):\s*([^\r\n]+)/gi)) for(const bit of m[1].split(/[;,]/)) if(isAbsolute(bit.trim())) candidates.push(bit.trim());
  // No known folder: no snapshot (never the host's own install folder).
  return [...new Set(candidates.filter(x=>typeof x==='string'&&isAbsolute(x)).map(x=>resolve(x)))];
}
function turnKey(exec){const agent=exec.agent;const events=agent?.session?.events??[];let start;for(let i=events.length-1;i>=0;i--)if(events[i]?.type==='turn/start'){start=events[i];break;}return String(agent?.session?.id??agent?.id??'session')+':'+String(start?.seq??start?.data?.turn??'active');}
function saveBlob(store,data){const h=hash(data),p=blobPath(store,h);mkdirSync(dirname(p),{recursive:true});if(!existsSync(p))writeFileSync(p,data,{flag:'wx'});return h;}
function loadManifest(store,id){return JSON.parse(readFileSync(manifestPath(store,id),'utf8'));}
function persist(store,m){mkdirSync(join(store,'turns'),{recursive:true});writeFileSync(manifestPath(store,m.id),JSON.stringify(m,null,2));}

/** Reusable store API; the scope is scanned before and after the supplied operation. */
export function createTurnUndo({store=STORE,limits=LIMITS}={}) {
  const storeDir=store;
  const active=new Map();
  async function around(exec,next){
    const key=turnKey(exec);let state=active.get(key);
    if(!state){const events=exec.agent?.session?.events??[];const start=[...events].reverse().find(e=>e?.type==='turn/start');const lastAssistant=[...events].reverse().find(e=>e?.type==='assistant/message');state={id:randomUUID(),key,sessionId:exec.agent?.session?.id??null,turnNumber:start?.data?.turn??null,assistantMessageId:lastAssistant?.data?.message?.id??null,startedAt:new Date().toISOString(),entries:new Map(),skipped:[],roots:[],status:'recording'};active.set(key,state);}
    const roots=rootsFor(exec);if(!roots.length)return next();state.roots=[...new Set([...state.roots,...roots])];
    const before=new Map();
    const recordSkipped=(items,root)=>{for(const item of items){if(state.skipped.length<1000)state.skipped.push({...item,root});else{state.skippedOverflow??={};state.skippedOverflow[item.reason]=(state.skippedOverflow[item.reason]??0)+1;}}};
    for(const root of roots){const scan=walk(root,limits);recordSkipped(scan.skipped,root);for(const [p,v] of scan.files)before.set(p,v);}
    // Save pre-images durably before a tool runs.
    for(const [p,v] of before) if(!state.entries.has(p)) state.entries.set(p,{root:roots.find(r=>p===r||p.startsWith(r+sep)),rel:relative(roots.find(r=>p===r||p.startsWith(r+sep)),p),before:saveBlob(store,v.data),beforeHash:v.hash,initiallyExisted:true});
    persist(store,serialize(state));
    let result,error;try{result=await next();}catch(e){error=e;}
    const after=new Map();for(const root of roots){const scan=walk(root,limits);recordSkipped(scan.skipped,root);for(const [p,v] of scan.files)after.set(p,v);}
    const paths=new Set([...before.keys(),...after.keys()]);
    for(const p of paths){const b=before.get(p),a=after.get(p);if(b?.hash===a?.hash){if(state.entries.get(p)?.afterHash===undefined)state.entries.delete(p);continue;}
      let entry=state.entries.get(p);
      if(!entry){const root=roots.find(r=>p===r||p.startsWith(r+sep));entry={root,rel:relative(root,p),before:null,beforeHash:null,initiallyExisted:false};state.entries.set(p,entry);}
      entry.afterHash=a?.hash??null;entry.after= a?saveBlob(store,a.data):null;
    }
    state.updatedAt=new Date().toISOString();persist(store,serialize(state));if(error)throw error;return result;
  }
  function serialize(s){return {id:s.id,key:s.key,sessionId:s.sessionId,turnNumber:s.turnNumber,assistantMessageId:s.assistantMessageId,startedAt:s.startedAt,updatedAt:s.updatedAt,finishedAt:s.finishedAt,undoneAt:s.undoneAt,archive:s.archive,entries:Object.fromEntries(s.entries),skipped:s.skipped,skippedOverflow:s.skippedOverflow??{},roots:s.roots,status:s.status};}
  function finish(key,agent,turn){const s=active.get(key);if(!s)return null;const events=agent?.session?.events??[];const answer=[...events].reverse().find(e=>e?.type==='assistant/message');s.sessionId=agent?.session?.id??s.sessionId;s.turnNumber=turn??s.turnNumber;s.assistantMessageId=answer?.data?.message?.id??s.assistantMessageId;s.status='finished';s.finishedAt=new Date().toISOString();persist(store,serialize(s));active.delete(key);return s.id;}
  function latest(){const dir=join(store,'turns');if(!existsSync(dir))return null;return readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>loadManifest(store,f.slice(0,-5))).filter(m=>m.status==='finished').sort((a,b)=>String(b.finishedAt).localeCompare(String(a.finishedAt)))[0]?.id??null;}
  function undo(id){
    if(typeof id!=='string'||!/^([0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12})$/i.test(id))return {ok:false,message:'Invalid turn id.'};
    const m=loadManifest(store,id);if(m.status==='undone')return {ok:false,message:'This turn has already been undone.'};
    const turns=join(store,'turns');for(const f of readdirSync(turns)){if(!f.endsWith('.json')||f===`${id}.json`)continue;const later=JSON.parse(readFileSync(join(turns,f),'utf8'));if(later.status!=='undone'&&new Date(later.startedAt)>=new Date(m.startedAt)){const overlap=Object.keys(m.entries).filter(p=>p in later.entries);if(overlap.length)return {ok:false,message:`Undo blocked: a later turn touched ${overlap.slice(0,5).map(p=>relative(process.cwd(),p)).join(', ')}. Undo the later turn first.`};}}
    for(const [p,e] of Object.entries(m.entries)){const exists=existsSync(p),current=exists?readFileSync(p):null,currentHash=current?hash(current):null;if(currentHash!==e.afterHash)return {ok:false,message:`Undo blocked: ${p} changed since this turn. Preserve or undo that later change first.`};}
    const archive=join(store,'archive',`${Date.now()}-${m.id}`);mkdirSync(archive,{recursive:true});
    for(const [p,e] of Object.entries(m.entries)){
      if(existsSync(p)){const relPath=relative(e.root,p);const dest=join(archive,e.root.replaceAll(':',''),relPath);mkdirSync(dirname(dest),{recursive:true});renameSync(p,dest);}
      if(e.initiallyExisted){const data=readFileSync(blobPath(store,e.before));mkdirSync(dirname(p),{recursive:true});writeFileSync(p,data);}
    }
    m.status='undone';m.undoneAt=new Date().toISOString();m.archive=archive;persist(store,m);return {ok:true,archive,files:Object.keys(m.entries).length};
  }
  function matching(sessionId,messageId){const dir=join(store,'turns');if(!existsSync(dir))return [];return readdirSync(dir).filter(f=>f.endsWith('.json')).map(f=>loadManifest(store,f.slice(0,-5))).filter(m=>m.status==='finished'&&m.sessionId===sessionId&&m.assistantMessageId===messageId);}
  return {around,finish,undo,latest,active,matching,store:storeDir};
}

export function apply(ctx, config = {}){
  const engine=createTurnUndo({store: config.store ?? STORE});
  ctx.on('tools/execute',(exec,next)=>exec?.name==='undo_turn'||!MUTATING.test(String(exec?.name??''))?next():engine.around(exec,next));
  const schema={type:'object',properties:{turnId:{type:'string'}},additionalProperties:false};
  const tool={name:'undo_turn',description:'Undo a completed tool turn. Restores its pre-turn files and archives the post-turn versions. Refuses if a later turn changed those files.',parameters:schema,execute(args){const id=args?.turnId??engine.latest();if(!id)return {text:'No undoable turn was found.'};return engine.undo(id);},output:{schema:{type:'object'},render:(_a,v)=>[{type:'text',text:v.message??(v.ok?`Turn restored. ${v.files} file(s) moved to archive ${v.archive}.`:'Undo failed.')} ]}};
  if(ctx.effect)ctx.effect(()=>ctx.tools.register(tool));else ctx.tools?.register?.(tool);
  ctx.on('agent/turn-stopping',({agent,turn})=>{const k=turnKey({agent});engine.finish(k,agent,turn);});
  ctx.effect(()=>ctx.webServer.register({kind:'exact',path:'/api/turn-undo',handler:async(req,res)=>{
    if(!ctx.connection.authorizeIndex(req,res))return;
    if(req.method!=='POST'){res.writeHead(405,{allow:'POST'});res.end();return;}
    let body='';for await(const c of req){body+=c;if(body.length>4096){res.writeHead(413);res.end();return;}}
    try{const input=JSON.parse(body);let id=input.turnId;if(!id&&typeof input.sessionId==='string'&&typeof input.messageId==='string'){
      const matches=engine.matching(input.sessionId,input.messageId);
      if(matches.length!==1){res.writeHead(matches.length?409:404,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,message:matches.length?'More than one turn matches this message.':'No completed turn matches this message.'}));return;}id=matches[0].id;
    }if(typeof id!=='string')throw Error();const result=engine.undo(id);res.writeHead(result.ok?200:409,{'content-type':'application/json','cache-control':'no-store'});res.end(JSON.stringify(result));}catch{res.writeHead(400,{'content-type':'application/json'});res.end(JSON.stringify({ok:false,message:'Invalid turn id.'}));}
  }}));
}
