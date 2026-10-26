import {createServer} from 'node:http';
import {pathToFileURL} from 'node:url';
import os from 'node:os';
import {readGpus} from './telemetry.mjs';

export async function deviceReport({name = os.hostname(), readGpu = readGpus} = {}) {
  let accelerators = [];
  try {
    const result = await readGpu();
    if (result?.ok) accelerators = result.gpus.map((gpu, index) => ({
      id: String(gpu.id ?? gpu.index ?? index), name: gpu.name ?? `Accelerator ${index + 1}`,
      memoryUsedMiB: Number.isFinite(gpu.vramUsedMiB) ? gpu.vramUsedMiB : null,
      memoryTotalMiB: Number.isFinite(gpu.vramTotalMiB) ? gpu.vramTotalMiB : null,
    }));
  } catch { /* Unsupported driver readings are omitted. */ }
  return {name, platform: process.platform, accelerators, services: []};
}

export function createAgentServer(options = {}) {
  const server = createServer(async (request, response) => {
    if (request.method !== 'GET' || request.url !== '/api/atelier-mission/agent') {
      response.writeHead(404, {'content-type': 'application/json'}); response.end('{"error":"not found"}'); return;
    }
    const report = await deviceReport(options);
    response.writeHead(200, {'content-type': 'application/json', 'cache-control': 'no-store'});
    response.end(JSON.stringify(report));
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const host = process.env.ATELIER_MISSION_AGENT_HOST || '127.0.0.1';
  const port = Number(process.env.ATELIER_MISSION_AGENT_PORT || 41920);
  createAgentServer().listen(port, host, () => process.stdout.write(`Mission device agent listening on ${host}:${port}\n`));
}
