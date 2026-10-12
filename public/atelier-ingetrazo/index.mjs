import {createConnection} from 'node:net';
import {join} from 'node:path';
import {existsSync} from 'node:fs';
import * as mcp from '@deepseek-ai/dsh-mcp-client';

export const name = 'atelier-ingetrazo';
export const inject = ['tools'];

/** Admit the optional integration only after the local bridge answers a model query. */
export async function bridgeAnswers(port = 4763) {
  return new Promise(resolve => {
    const socket = createConnection({host:'localhost', port, family:4});
    let data = '', settled = false;
    const finish = value => { if (settled) return; settled = true; socket.destroy(); resolve(value); };
    socket.setTimeout(1500, () => finish(false));
    socket.once('error', () => finish(false));
    socket.once('connect', () => socket.write(JSON.stringify({id:1,tool:'query_model',args:{}})+'\n'));
    socket.on('data', chunk => {
      data += chunk.toString();
      if (data.length > 65536) return finish(false);
      if (!data.includes('\n')) return;
      try { const reply = JSON.parse(data.split('\n')[0]); finish(reply.ok === true && typeof reply.result === 'object'); }
      catch { finish(false); }
    });
    socket.once('close', () => finish(false));
  });
}

/** Load the independently installed official MCP server; absent bridge means no tools. */
export async function apply(ctx) {
  const port = Number(process.env.ATELIER_INGETRAZO_PORT || 4763);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw Error('Invalid local IngeTrazo bridge port.');
  if (!await bridgeAnswers(port)) return;
  const installed = process.platform === 'win32' ? [
    join(process.env.ProgramFiles || 'C:/Program Files','IngeTrazo','ingetrazo-mcp.exe'),
    ...(process.env.LOCALAPPDATA ? [join(process.env.LOCALAPPDATA,'Programs','IngeTrazo','ingetrazo-mcp.exe')] : []),
  ] : [];
  const command = process.env.ATELIER_INGETRAZO_COMMAND || (process.platform === 'win32'
    ? installed.find(existsSync) || installed[0] : 'ingetrazo');
  let args;
  try { args = JSON.parse(process.env.ATELIER_INGETRAZO_ARGS || (process.platform === 'win32' ? '[]' : '["--mcp"]')); }
  catch { throw Error('ATELIER_INGETRAZO_ARGS must be a JSON array of strings.'); }
  if (!Array.isArray(args) || args.some(value => typeof value !== 'string')) throw Error('Invalid official MCP arguments.');
  await mcp.apply(ctx, mcp.Config({serverName:'ingetrazo', transport:'stdio', command, args,
    env:{INGETRAZO_AI_HOST:'localhost',INGETRAZO_AI_PORT:String(port),PYTHONIOENCODING:'utf-8'},
    failOnStartupError:false, toolCallTimeoutMs:300000, reconnect:{enabled:false}}));
}
