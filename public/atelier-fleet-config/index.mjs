import {createHash} from 'node:crypto';
import {createServer} from 'node:http';
import {copyFile, mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';

const digest = value => createHash('sha256').update(JSON.stringify(Object.fromEntries(
  Object.entries(value).filter(([key]) => !['hash', 'revision', 'generatedAt'].includes(key)).sort(([a], [b]) => a.localeCompare(b)),
))).digest('hex');

/** Create an HTTP catalog server from a JSON file with {services, providers}. */
export function createCatalogServer({configPath, statePath, port = 8420, intervalMs = 60_000}) {
  let document, revision = 0, lastRefresh = null, lastError = null, probes = {};
  async function refresh() {
    try {
      const source = JSON.parse(await readFile(configPath, 'utf8'));
      const services = await Promise.all((source.services ?? []).map(async service => {
        let status = 'down', httpStatus = null, models = [];
        try {
          const response = await fetch(new URL(service.healthRoute, service.baseUrl), {signal: AbortSignal.timeout(2500)});
          httpStatus = response.status; status = response.ok ? 'up' : 'down';
          if (response.ok) {
            let body;
            if (service.modelsRoute) {
              const modelsResponse = await fetch(new URL(service.modelsRoute, service.baseUrl), {signal: AbortSignal.timeout(2500)});
              if (modelsResponse.ok) body = await modelsResponse.json();
            } else if (response.headers.get('content-type')?.includes('json')) body = await response.json();
            if (body) {
              models = (body.data ?? body.models ?? []).map(model => model.id).filter(Boolean);
            }
          }
        } catch {}
        probes[service.id] = {status, httpStatus, checkedAt: new Date().toISOString()};
        return {...service, modelIds: models, status};
      }));
      const base = {schemaVersion: '1.0.0', revision, generatedAt: new Date().toISOString(),
        services, providers: source.providers ?? []};
      const hash = digest(base);
      if (!document || document.hash !== hash) revision++;
      document = {...base, revision, hash}; lastRefresh = base.generatedAt; lastError = null;
      await mkdir(path.dirname(statePath), {recursive: true});
      await writeFile(statePath, JSON.stringify({revision, hash}));
      return document;
    } catch (error) {
      lastError = error.name; throw error;
    }
  }
  const server = createServer(async (request, response) => {
    const send = (code, value, headers = {}) => {
      const body = JSON.stringify(value);
      response.writeHead(code, {'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), ...headers});
      response.end(body);
    };
    if (request.method === 'GET' && request.url === '/config') {
      const value = document ?? await refresh(); const etag = `"${value.revision}-${value.hash}"`;
      if (request.headers['if-none-match'] === etag) { response.writeHead(304, {etag}); response.end(); return; }
      send(200, value, {etag, 'cache-control': 'no-cache'}); return;
    }
    if (request.method === 'GET' && request.url === '/status') {
      send(200, {revision, lastRefresh, error: lastError, probes}); return;
    }
    if (request.method === 'POST' && request.url === '/refresh') {
      send(200, {config: await refresh(), status: {revision, lastRefresh, error: lastError, probes}}); return;
    }
    send(404, {error: 'not found'});
  });
  return {server, async start() {
    try { revision = JSON.parse(await readFile(statePath, 'utf8')).revision ?? 0; } catch {}
    await refresh(); server.listen(port);
    const timer = setInterval(() => refresh().catch(() => {}), intervalMs); timer.unref(); return server;
  }};
}

/** Fetch and atomically replace only the managed fragment; keep a dated backup and append an audit record. */
export async function updateManagedFragment({url, fragmentPath, logPath}) {
  let old;
  try { old = JSON.parse(await readFile(fragmentPath, 'utf8')); } catch {}
  const headers = old?.hash && old?.revision !== undefined ? {'if-none-match': `"${old.revision}-${old.hash}"`} : {};
  let response;
  try { response = await fetch(new URL('/config', url), {headers}); }
  catch (error) { throw new Error(`catalog request failed: ${error.cause?.code ?? error.name}`); }
  if (response.status === 304) return false;
  if (!response.ok) throw new Error(`catalog returned HTTP ${response.status}`);
  const next = await response.json();
  if (next.schemaVersion !== '1.0.0' || digest(next) !== next.hash) throw new Error('invalid catalog schema or hash');
  if (old?.revision === next.revision && old?.hash === next.hash) return false;
  await mkdir(path.dirname(fragmentPath), {recursive: true});
  const stamp = new Date().toISOString().replaceAll(':', '').replaceAll('-', '');
  let backup = null;
  try { await readFile(fragmentPath); backup = `${fragmentPath}.${stamp}.bak`; await copyFile(fragmentPath, backup); } catch {}
  const temp = `${fragmentPath}.tmp`;
  await writeFile(temp, `${JSON.stringify(next, null, 2)}\n`, {encoding: 'utf8'});
  await rename(temp, fragmentPath);
  await mkdir(path.dirname(logPath), {recursive: true});
  await writeFile(logPath, `${JSON.stringify({at: new Date().toISOString(), action: 'updated', revision: next.revision, hash: next.hash, backup})}\n`, {flag: 'a'});
  return true;
}

/** Load the providers from a verified managed fragment for a settings adapter to include. */
export async function readManagedProviders(fragmentPath) {
  const value = JSON.parse(await readFile(fragmentPath, 'utf8'));
  if (value.schemaVersion !== '1.0.0' || digest(value) !== value.hash || !Array.isArray(value.providers)) {
    throw new Error('invalid managed provider fragment');
  }
  return value.providers;
}

/** Merge catalog providers by id while preserving unrelated local providers. */
export function mergeManagedProviders(settings, providers) {
  const current = settings?.providers ?? {};
  const additions = Object.fromEntries(providers.map(provider => [provider.id, provider]));
  return {...settings, providers: {...current, ...additions}};
}

/** Restore the newest timestamped backup and record the rollback. */
export async function rollbackManagedFragment({fragmentPath, logPath}) {
  const {readdir} = await import('node:fs/promises');
  const candidates = (await readdir(path.dirname(fragmentPath))).filter(name => name.startsWith(`${path.basename(fragmentPath)}.`) && name.endsWith('.bak')).sort().reverse();
  if (!candidates.length) throw new Error('no managed-fragment backup found');
  const backup = path.join(path.dirname(fragmentPath), candidates[0]);
  await copyFile(backup, fragmentPath);
  await writeFile(logPath, `${JSON.stringify({at: new Date().toISOString(), action: 'rollback', backup})}\n`, {flag: 'a'});
  return backup;
}
