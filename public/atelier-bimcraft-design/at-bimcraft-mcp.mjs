// Pinned BIMCraft stdio client and project-confined MCP proxy. No shell, windows, or updater.
import {spawn,execFile} from 'node:child_process';
import {createInterface} from 'node:readline';
import {resolve,relative,isAbsolute,dirname,extname} from 'node:path';
import {realpath,lstat,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';

export const CLI = process.env.BIMCRAFT_CLI ?? 'bimcraft-cli';
export async function confined(root, input, {write=false, extensions}={}) {
  if (typeof input !== 'string' || !input || /[\x00-\x1f]/.test(input) || input.startsWith('\\\\') || input.startsWith('//') || input.includes(':') && !/^[A-Za-z]:[\\/]/.test(input)) throw Error('Invalid local project path');
  // Refuse NTFS alternate streams, device names and trailing-dot aliases.
  if (input.replace(/^[A-Za-z]:/, '').includes(':') || input.split(/[\\/]/).some(s => /[. ]$/.test(s) && s !== '..' && s !== '.' || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(s))) throw Error('Unsafe Windows path');
  const base=await realpath(resolve(root));
  const target=resolve(base,input), rel=relative(base,target);
  if (rel.startsWith('..') || isAbsolute(rel)) throw Error('Path must remain inside the configured project folder');
  let p=base;
  for (const part of rel.split(/[\\/]/).filter(Boolean)) {
    p=resolve(p,part);
    try { const st=await lstat(p); if(st.isSymbolicLink()) throw Error('Symlinks and junctions are refused'); const real=await realpath(p), r=relative(base,real); if(r.startsWith('..')||isAbsolute(r))throw Error('Path escapes project'); }
    catch(e) { if(e.code!=='ENOENT') throw e; }
  }
  if(extensions && !extensions.includes(extname(target).toLowerCase()))throw Error('Unsupported file extension');
  if(write)await mkdir(dirname(target),{recursive:true});
  return target;
}

export class BimClient {
  constructor({cli=CLI, cwd=process.cwd(), timeoutMs=120000, connect=false, version='0.8.0'}={}) {
    this.seq=0;this.pending=new Map();this.timeoutMs=timeoutMs;this.stderr='';this.lastUse=Date.now();
    this.version=version;this.child=spawn(cli,['mcp',...(connect?['--connect']:[])],{cwd,windowsHide:true,env:{...process.env,BIMCRAFT_NO_UPDATE_CHECK:'1',BIMCRAFT_FAVORITES:resolve(cwd,'favorites.json')},stdio:['pipe','pipe','pipe']});
    this.lifetime=setTimeout(()=>this.abort('BIMCraft 10 minute wall-clock limit'),600000);
    this.budget=setInterval(()=>{if(Date.now()-this.lastUse>120000){this.abort('BIMCraft 2 minute idle limit');return}if(this.monitor)return;this.monitor=true;
      execFile('powershell.exe',['-NoProfile','-NonInteractive','-Command',`(Get-Process -Id ${this.child.pid} -ErrorAction Stop).WorkingSet64`],{windowsHide:true,timeout:5000},(err,out)=>{this.monitor=false;if(!err&&Number(out.trim())>768*1024*1024)this.abort('BIMCraft 768 MiB RSS limit')});
    },5000);this.budget.unref();this.lifetime.unref();
    this.child.stderr.on('data',d=>{this.stderr=(this.stderr+d).slice(-4096)});
    this.lines=createInterface({input:this.child.stdout});
    this.lines.on('line',line=>{try{const r=JSON.parse(line),p=this.pending.get(r.id);if(!p)return;clearTimeout(p.timer);this.pending.delete(r.id);r.error?p.reject(Error(r.error.message)):p.resolve(r.result)}catch(e){this.fail(e)}});
    this.child.on('error',e=>this.abort(e.message));this.child.on('exit',(code)=>{clearInterval(this.budget);clearTimeout(this.lifetime);this.fail(Error(`BIMCraft exited (${code}): ${this.stderr}`))});
  }
  fail(e){for(const p of this.pending.values()){clearTimeout(p.timer);p.reject(e)}this.pending.clear()}
  abort(message){this.fail(Error(message));this.close()}
  rpc(method,params={}){this.lastUse=Date.now();return new Promise((resolve,reject)=>{const id=++this.seq;const timer=setTimeout(()=>{this.pending.delete(id);reject(Error('BIMCraft request timed out'));this.close()},this.timeoutMs);this.pending.set(id,{resolve,reject,timer});this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',id,method,params})+'\n',e=>{if(e)this.fail(e)})})}
  async init(){const info=await this.rpc('initialize',{protocolVersion:'2025-06-18',capabilities:{},clientInfo:{name:'atelier-bimcraft',version:'1.0.0'}});if(info.serverInfo.version!==this.version)throw Error(`BIMCraft pin mismatch: expected ${this.version}, got ${info.serverInfo.version}`);this.child.stdin.write(JSON.stringify({jsonrpc:'2.0',method:'notifications/initialized'})+'\n');return info}
  async raw(name,args={}){return this.rpc('tools/call',{name,arguments:args})}
  async call(name,args={}){const r=await this.raw(name,args);if(r.isError)throw Error(r.content?.map(c=>c.text??'').join('\n')??'BIMCraft tool failed');const t=r.content?.find(c=>c.type==='text')?.text;try{return JSON.parse(t)}catch{return r}}
  async exec(command,params={}){return this.call('execute',{command,params})}
  close(){clearInterval(this.budget);clearTimeout(this.lifetime);this.lines?.close();this.child.stdin.end();this.child.kill();this.fail(Error('BIMCraft client closed'))}
}

// Canonical v0.6.0 model commands. Filesystem commands use only the guarded tools;
// favorite is deliberately absent because its default is a user-global file.
const SAFE=new Set(('new undo redo level grid wall door window floor ceiling shaft mass mass_floors wall_by_face floor_by_face roof_by_face update_by_face show_mass room column structural_column footing beam strip_footing pipe conduit cable_tray wire down_conductor ground_conductor cabling stair ramp railing roof dormer dimension text spot tag section elevation sheet place crop scale detail visual_style type material paint parameter family component flip modify move copy rotate mirror corner split delete units language inspect schedule graphics filter template phase phase_filter option measure elements').split(' '));
async function validateCommand(root,command,params){
  if(!SAFE.has(command))throw Error(`Command ${command} is not exposed by the project-confined server`);
  // These commands need no external files. In particular, texture paths and nested file readers are disallowed.
  function scan(v){if(!v||typeof v!=='object')return;for(const [k,x]of Object.entries(v)){if(k==='path'&&Array.isArray(x)&&x.every(p=>Array.isArray(p)&&p.length===2&&p.every(Number.isFinite)))continue;if(/^(path|file|filename|url|uri|save)$/i.test(k))throw Error('File-bearing command arguments are refused; use guarded open/save');scan(x)}}
  scan(params);return {command,params};
}
export async function validateCall(root,name,args={}) {
  args=structuredClone(args);
  if(name==='open'||name==='save'){
    if(!args.path)throw Error('An explicit project path is required');
    args.path=await confined(root,args.path,{write:name==='save',extensions:name==='open'?['.bimcraft','.ifc']:['.bimcraft','.ifc','.svg','.png','.pdf']});
    if(name==='open' && (await (await import('node:fs/promises')).stat(args.path)).size>64*1024*1024)throw Error('Model exceeds 64 MiB import limit');
  } else if(name==='execute')await validateCommand(root,args.command,args.params??{});
  else if(name==='script'){
    if(typeof args.text!=='string'||Buffer.byteLength(args.text)>1024*1024)throw Error('Script exceeds 1 MiB');
    for(const line of args.text.split(/\r?\n/)){const t=line.trim();if(!t||t.startsWith('#'))continue;const m=/^(\w+)\s*(.*)$/.exec(t);if(!m)throw Error('Invalid script line');await validateCommand(root,m[1],m[2]?JSON.parse(m[2]):{})}
  } else if(!['list_commands','inspect_model','query_elements','schedule','render','new_model'].includes(name))throw Error('Unknown tool');
  if(name==='schedule'){
    const allowed=new Set(['name','category','fields','filters','sort','grouped']);for(const k of Object.keys(args))if(!allowed.has(k))throw Error(`Schedule argument ${k} is not exposed`);
  }
  if(name==='render')for(const k of Object.keys(args))if(!['view','ceiling','width','height','azimuth','elevation'].includes(k))throw Error(`Render argument ${k} is not exposed`);
  if(name==='render' || name==='execute'&&args.command==='render'){
    for(const k of ['width','height'])if(args[k]!=null && (!Number.isInteger(args[k])||args[k]<64||args[k]>4096))throw Error('Render dimensions must be 64..4096');
  }
  if(name==='query_elements'){args.limit=Math.min(500,Math.max(1,args.limit??100));if(!Number.isInteger(args.offset??0)||(args.offset??0)<0)throw Error('Invalid offset')}
  return args;
}

async function proxy(){
  const root=process.env.AT_BIMCRAFT_PROJECT_ROOT;if(!root)throw Error('AT_BIMCRAFT_PROJECT_ROOT must be explicitly configured');await realpath(root);
  const clients=new Map();const input=createInterface({input:process.stdin});
  for await(const line of input){let msg;try{if(Buffer.byteLength(line)>2*1024*1024)throw Error('Message too large');msg=JSON.parse(line);if(!msg.method)continue;if(msg.id==null)continue;
    if(!['initialize','ping','tools/list','tools/call'].includes(msg.method))throw Error('Unsupported method');
    let client,result;
    if(msg.method==='tools/call'){
      const args=msg.params.arguments??{},session=args._atelier_session,project=args._atelier_project;delete args._atelier_session;delete args._atelier_project;
      if(typeof session!=='string'||!/^[\w-]{1,160}$/.test(session)||typeof project!=='string')throw Error('Trusted Atelier session context required');
      const cwd=await confined(root,project);
      let record=clients.get(session);
      if(record&&record.cwd!==cwd)throw Error('Session project cannot be rebound');
      if(!record){if(clients.size>=4)throw Error('Four active BIM sessions maximum');client=new BimClient({cwd,connect:process.env.BIMCRAFT_CONNECT==='1'});await client.init();record={client,cwd};clients.set(session,record);client.child.once('exit',()=>clients.delete(session))}
      client=record.client;msg.params.arguments=await validateCall(cwd,msg.params.name,args);result=await client.rpc(msg.method,msg.params);
    }else{
      // Metadata requests get a short-lived CLI, never a shared mutable model.
      client=new BimClient({cwd:root});try{result=await client.rpc(msg.method,msg.params)}finally{client.close()}
    }
    process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,result})+'\n');
  }catch(e){if(msg?.id!=null)process.stdout.write(JSON.stringify({jsonrpc:'2.0',id:msg.id,result:{isError:true,content:[{type:'text',text:String(e.message)}]}})+'\n');else process.stderr.write(String(e.message)+'\n')}}
  for(const {client}of clients.values())client.close();
}
if(process.argv[1] && resolve(process.argv[1])===fileURLToPath(import.meta.url))proxy().catch(e=>{process.stderr.write(e.stack+'\n');process.exitCode=1});
