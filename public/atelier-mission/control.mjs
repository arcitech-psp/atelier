import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import {dirname, join} from 'node:path';
import {randomUUID} from 'node:crypto';

export const SERVICES = [
  {id: 'chat', name: 'Chat model', role: 'brain'},
  {id: 'image', name: 'Image generation', role: 'image'},
  {id: 'video', name: 'Video generation'},
  {id: 'speech-to-text', name: 'Speech to text', role: 'stt'},
  {id: 'text-to-speech', name: 'Text to speech', role: 'tts'},
  {id: 'embeddings', name: 'Embeddings', role: 'embeddings'},
  {id: 'three-d', name: '3D generation'},
  {id: 'search', name: 'Search'},
];

const cleanText = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';
const validUrl = value => { try { return ['http:', 'https:'].includes(new URL(value).protocol); } catch { return false; } };
const joinUrl = (base, path) => `${base.replace(/\/+$/u, '')}/${path.replace(/^\/+/, '')}`;

export function normalizeControl(value) {
  const source = value && typeof value === 'object' ? value : {};
  const devices = Array.isArray(source.devices) ? source.devices.filter(row => row && typeof row === 'object' && typeof row.id === 'string' && validUrl(row.address)).map(row => ({
    id: cleanText(row.id, 80), name: cleanText(row.name, 80) || cleanText(row.address, 160), address: cleanText(row.address, 500).replace(/\/+$/u, ''),
  })) : [];
  const assignments = {};
  for (const service of SERVICES) {
    const row = source.assignments?.[service.id];
    if (!row || typeof row !== 'object') continue;
    const device = devices.find(item => item.id === row.deviceId);
    if (!device) continue;
    assignments[service.id] = {deviceId: device.id, gpuId: cleanText(row.gpuId, 100), endpoint: cleanText(row.endpoint, 500),
      healthPath: cleanText(row.healthPath, 200) || '/health', model: cleanText(row.model, 200)};
  }
  return {version: 1, devices, assignments, configServer: validUrl(source.configServer) ? source.configServer.replace(/\/+$/u, '') : ''};
}

export async function loadControl(file) {
  try { return normalizeControl(JSON.parse(await readFile(file, 'utf8'))); }
  catch (error) { if (error.code === 'ENOENT') return {version: 1, devices: [], assignments: {}, configServer: ''}; throw error; }
}

export async function writeAtomic(file, value) {
  await mkdir(dirname(file), {recursive: true});
  const temp = join(dirname(file), `${randomUUID()}.pending`);
  await writeFile(temp, JSON.stringify(value, null, 2), {mode: 0o600});
  await rename(temp, file);
}

export class MissionControl {
  constructor({file, fetch: fetchImpl = fetch, now = Date.now, timeoutMs = 4000, onAssign, onRestore} = {}) {
    this.file = file;
    this.fetch = fetchImpl;
    this.now = now;
    this.timeoutMs = timeoutMs;
    this.onAssign = onAssign;
    this.onRestore = onRestore;
    this.state = {version: 1, devices: [], assignments: {}, configServer: ''};
    this.devices = new Map();
    this.health = new Map();
    this.backupFile = join(dirname(file), 'control.backup.json');
  }

  async start() { this.state = await loadControl(this.file); return this.snapshot(); }
  snapshot() {
    const devices = this.state.devices.map(device => ({...device, ...(this.devices.get(device.id) ?? {reachable: false, latencyMs: null, lastSeen: null, accelerators: []})}));
    return {schemaVersion: 1, services: SERVICES, devices, assignments: this.state.assignments, configServer: this.state.configServer,
      health: Object.fromEntries(this.health)};
  }
  async save(next, metadata = {}) {
    const normalized = normalizeControl(next);
    await writeAtomic(this.backupFile, {state: this.state, ...metadata});
    await writeAtomic(this.file, normalized);
    this.state = normalized;
    return this.snapshot();
  }
  async undo() {
    let backup;
    try { backup = JSON.parse(await readFile(this.backupFile, 'utf8')); } catch (error) { if (error.code === 'ENOENT') throw Error('There is no saved change to undo.'); throw error; }
    const previous = normalizeControl(backup.state ?? backup);
    const nextBackup = {state: this.state};
    await writeAtomic(this.backupFile, nextBackup);
    await writeAtomic(this.file, previous);
    this.state = previous;
    if (Array.isArray(backup.profileBefore)) { for (const item of [...backup.profileBefore].reverse()) await this.onRestore?.(item); }
    else if (backup.profileBefore) await this.onRestore?.(backup.profileBefore);
    return this.snapshot();
  }
  async addDevice(input) {
    const address = cleanText(input?.address, 500).replace(/\/+$/u, '');
    if (!validUrl(address)) throw Error('Enter a device address starting with http:// or https://.');
    const id = cleanText(input?.id, 80) || randomUUID();
    const row = {id, address, name: cleanText(input?.name, 80) || new URL(address).host};
    return this.save({...this.state, devices: [...this.state.devices.filter(device => device.id !== id), row]});
  }
  async removeDevice(id) {
    const devices = this.state.devices.filter(row => row.id !== id);
    const assignments = Object.fromEntries(Object.entries(this.state.assignments).filter(([, row]) => row.deviceId !== id));
    return this.save({...this.state, devices, assignments});
  }
  async probeDevice(id) {
    const device = this.state.devices.find(row => row.id === id);
    if (!device) throw Error('Choose a connected device.');
    const started = this.now();
    try {
      let response, report = {};
      try {
        response = await this.fetch(joinUrl(device.address, '/api/atelier-mission/agent'), {redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs)});
        if (response.ok) report = await response.json();
        else if (response.status !== 404) throw Error(`Device agent answered HTTP ${response.status}.`);
      } catch (error) {
        if (error?.cause?.code !== 'ECONNREFUSED' && error?.name !== 'TimeoutError' && error?.name !== 'AbortError' && !/fetch failed/i.test(error.message)) throw error;
      }
      if (!response?.ok) response = await this.fetch(device.address, {redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs)});
      if (response.status >= 500) throw Error(`Device answered HTTP ${response.status}.`);
      const result = {reachable: true, latencyMs: Math.max(0, this.now() - started), lastSeen: this.now(), accelerators: Array.isArray(report.accelerators) ? report.accelerators : [],
        running: Array.isArray(report.services) ? report.services : []};
      this.devices.set(id, result);
      return result;
    } catch (error) {
      const result = {...(this.devices.get(id) ?? {}), reachable: false, latencyMs: null, accelerators: [], error: String(error.message).slice(0, 180)};
      this.devices.set(id, result);
      return result;
    }
  }
  async probeAll() { await Promise.all(this.state.devices.map(row => this.probeDevice(row.id))); return this.snapshot(); }
  async checkService(id) {
    const assignment = this.state.assignments[id];
    if (!assignment?.endpoint) return {state: 'unassigned', checkedAt: null, nextCheckAt: null};
    const previous = this.health.get(id), now = this.now();
    if (previous && now < previous.nextCheckAt) return previous;
    const started = now;
    try {
      const response = await this.fetch(joinUrl(assignment.endpoint, assignment.healthPath), {redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs)});
      const checkedAt = this.now();
      if (!response.ok) throw Object.assign(Error(`Health route answered HTTP ${response.status}.`), {checkedAt});
      const state = {state: 'healthy', checkedAt, latencyMs: Math.max(0, checkedAt - started), failures: 0, nextCheckAt: checkedAt + 30_000};
      this.health.set(id, state); return state;
    } catch (error) {
      const checkedAt = error.checkedAt ?? this.now(), failures = (previous?.failures ?? 0) + 1;
      const delay = Math.min(15 * 60_000, 30_000 * 2 ** Math.min(failures - 1, 5));
      const state = {state: 'offline', checkedAt, latencyMs: null, failures, error: String(error.message).slice(0, 180), nextCheckAt: checkedAt + delay};
      this.health.set(id, state); return state;
    }
  }
  async checkAll() { await Promise.all(Object.keys(this.state.assignments).map(id => this.checkService(id))); return this.snapshot(); }
  async testAssignment(input) {
    const service = cleanText(input?.service, 80);
    if (!SERVICES.some(row => row.id === service)) throw Error('Choose a service.');
    const device = this.state.devices.find(row => row.id === input?.deviceId);
    if (!device) throw Error('Connect a device first.');
    const endpoint = cleanText(input?.endpoint, 500).replace(/\/+$/u, ''), healthPath = cleanText(input?.healthPath, 200) || '/health';
    if (!validUrl(endpoint) || !healthPath.startsWith('/')) throw Error('Enter a valid service address and an absolute health route.');
    const assignment = {deviceId: device.id, gpuId: cleanText(input?.gpuId, 100), endpoint, healthPath, model: cleanText(input?.model, 200)};
    const previous = this.health.get(service), started = this.now(), target = joinUrl(endpoint, healthPath);
    if (previous && started < previous.nextCheckAt) {
      if (previous.target === target && previous.state === 'healthy') return {assignment, result: {ok: true, status: previous.status, latencyMs: previous.latencyMs, service, cached: true}};
      throw Error('This service was checked recently. Wait before testing it again.');
    }
    try {
      const response = await this.fetch(target, {redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs)});
      const checkedAt = this.now();
      if (!response.ok) throw Object.assign(Error(`The health route answered HTTP ${response.status}.`), {checkedAt, status: response.status});
      const state = {state: 'healthy', checkedAt, latencyMs: Math.max(0, checkedAt - started), failures: 0, status: response.status, target, nextCheckAt: checkedAt + 30_000};
      this.health.set(service, state);
      return {assignment, result: {ok: true, status: response.status, latencyMs: state.latencyMs, service}};
    } catch (error) {
      const checkedAt = error.checkedAt ?? this.now(), failures = (previous?.failures ?? 0) + 1;
      const delay = Math.min(15 * 60_000, 30_000 * 2 ** Math.min(failures - 1, 5));
      this.health.set(service, {state: 'offline', checkedAt, latencyMs: null, failures, status: error.status ?? null, target,
        error: String(error.message).slice(0, 180), nextCheckAt: checkedAt + delay});
      throw error;
    }
  }
  async assign(input) {
    const tested = await this.testAssignment(input);
    const profileBefore = await this.onAssign?.(input.service, tested.assignment);
    await this.save({...this.state, assignments: {...this.state.assignments, [input.service]: tested.assignment}}, {profileBefore});
    return {...tested, snapshot: this.snapshot()};
  }
  async configureServer(url) {
    const configServer = cleanText(url, 500).replace(/\/+$/u, '');
    if (configServer && !validUrl(configServer)) throw Error('Enter a config server address starting with http:// or https://.');
    return this.save({...this.state, configServer});
  }
  async publish() {
    if (!this.state.configServer) throw Error('Add a config server address first.');
    const response = await this.fetch(joinUrl(this.state.configServer, '/api/config/publish'), {method: 'POST', headers: {'content-type': 'application/json'}, body: JSON.stringify({schemaVersion: 1, devices: this.state.devices, assignments: this.state.assignments}), redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs)});
    if (!response.ok) throw Error(`Config server answered HTTP ${response.status}.`);
    return {ok: true, status: response.status};
  }
  async pull() {
    if (!this.state.configServer) throw Error('Add a config server address first.');
    const response = await this.fetch(joinUrl(this.state.configServer, '/api/config/current'), {redirect: 'error', signal: AbortSignal.timeout(this.timeoutMs)});
    if (!response.ok) throw Error(`Config server answered HTTP ${response.status}.`);
    const incoming = await response.json();
    if (incoming.schemaVersion !== 1 || !Array.isArray(incoming.devices) || !incoming.assignments || typeof incoming.assignments !== 'object') throw Error('The config server returned a document that does not match Mission Control schema version 1.');
    const next = normalizeControl({...incoming, configServer: this.state.configServer});
    const profileBefore = [];
    for (const [service, assignment] of Object.entries(next.assignments)) {
      const previous = await this.onAssign?.(service, assignment);
      if (previous) profileBefore.push(previous);
    }
    return this.save(next, {profileBefore});
  }
}
