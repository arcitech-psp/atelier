// What this computer is doing right now: graphics card use and power (NVIDIA through nvidia-smi), processor use and
// memory. Other makes of graphics card are reported as "not available" instead of guessed: this file reads only
// what the driver tool prints. Nothing here leaves the computer.
import {execFile} from 'node:child_process';
import {existsSync} from 'node:fs';
import {readdir, readFile, stat} from 'node:fs/promises';
import {cpus, freemem, totalmem} from 'node:os';

const NA = /^\s*(\[?(n\/a|not supported|not available|unknown error)\]?|)\s*$/i;
/** "123.45" to 123.45; "[N/A]", "[Not Supported]" and empty text to null. */
export function numberOrNull(value) {
  if (value === undefined || NA.test(String(value))) return null;
  const parsed = Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export const NVIDIA_QUERY = 'index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit';

const SYSFS_DRM = '/sys/class/drm';
const VENDOR_INTEL = '0x8086';
const VENDOR_AMD = '0x1002';
const busyCounters = new Map();

/**
 * Parse `nvidia-smi --query-gpu=<NVIDIA_QUERY> --format=csv,noheader,nounits`.
 * @param {string} output
 * @returns {{index: number, name: string, util: number|null, vramUsedMiB: number|null, vramTotalMiB: number|null, tempC: number|null, powerW: number|null, powerLimitW: number|null}[]}
 */
export function parseNvidiaSmi(output) {
  const gpus = [];
  for (const line of String(output ?? '').split(/\r?\n/)) {
    if (!line.trim()) continue;
    const cells = line.split(',').map(cell => cell.trim());
    // A name may not contain commas in practice; a short row is a failure message, not data.
    if (cells.length < 8 || !cells[1]) continue;
    gpus.push({
      index: numberOrNull(cells[0]) ?? gpus.length, name: cells[1].replace(/^NVIDIA\s+/i, ''),
      util: numberOrNull(cells[2]), vramUsedMiB: numberOrNull(cells[3]), vramTotalMiB: numberOrNull(cells[4]),
      tempC: numberOrNull(cells[5]), powerW: numberOrNull(cells[6]), powerLimitW: numberOrNull(cells[7]),
    });
  }
  return gpus;
}

/** Where nvidia-smi usually lives when it is not on PATH. */
function nvidiaCandidates(env = process.env) {
  const list = ['nvidia-smi'];
  if (process.platform === 'win32') {
    list.push(`${env.SystemRoot ?? 'C:\\Windows'}\\System32\\nvidia-smi.exe`, `${env.ProgramFiles ?? 'C:\\Program Files'}\\NVIDIA Corporation\\NVSMI\\nvidia-smi.exe`);
  }
  return list;
}

const run = (file, args, timeoutMs = 3000) => new Promise(resolve => {
  execFile(file, args, {timeout: timeoutMs, windowsHide: true, maxBuffer: 1 << 20}, (error, stdout) => resolve(error ? null : String(stdout)));
});

let resolvedTool; // the nvidia-smi command that worked once, or false when none does

/** Read every NVIDIA card. Resolves to {ok, gpus, reason}; never throws. */
export async function readNvidia({exec = run} = {}) {
  const args = [`--query-gpu=${NVIDIA_QUERY}`, '--format=csv,noheader,nounits'];
  const tries = resolvedTool ? [resolvedTool] : nvidiaCandidates().filter(file => file === 'nvidia-smi' || existsSync(file));
  for (const tool of tries) {
    const output = await exec(tool, args);
    if (output === null) continue;
    const gpus = parseNvidiaSmi(output);
    if (gpus.length > 0) { resolvedTool = tool; return {ok: true, gpus}; }
  }
  if (resolvedTool) resolvedTool = undefined; // it stopped working: look again next time
  return {ok: false, gpus: [], reason: 'nvidia-smi was not found. Graphics card use and power are only readable on NVIDIA cards.'};
}

/** Forget which nvidia-smi worked (tests). */
export const resetNvidia = () => { resolvedTool = undefined; };

const readText = async file => { try { return (await readFile(file, 'utf8')).trim(); } catch { return null; } };
const children = async path => { try { return await readdir(path, {withFileTypes: true}); } catch { return []; } };
const firstNumber = async (paths, scale = 1) => {
  for (const path of paths) {
    const value = numberOrNull(await readText(path));
    if (value !== null) return value / scale;
  }
  return null;
};

async function filesBelow(root, accept, depth = 7) {
  const found = [];
  const visited = new Set();
  async function visit(path, level) {
    if (level > depth) return;
    let directory;
    try { directory = await stat(path); } catch { return; }
    const identity = `${directory.dev}:${directory.ino}`;
    if (visited.has(identity)) return;
    visited.add(identity);
    for (const entry of await children(path)) {
      const full = `${path}/${entry.name}`;
      if (entry.isFile() && accept(entry.name)) found.push(full);
      else if (entry.isDirectory() || entry.isSymbolicLink()) await visit(full, level + 1);
    }
  }
  await visit(root, 0);
  return found;
}

function busyPercent(path, counter, now = Date.now()) {
  if (counter === null) return null;
  const prior = busyCounters.get(path);
  busyCounters.set(path, {counter, now});
  if (!prior || counter < prior.counter || now <= prior.now) return null;
  // Intel engine busy files are cumulative nanoseconds; AMD's gpu_busy_percent is already a percentage.
  return Math.max(0, Math.min(100, 100 * (counter - prior.counter) / ((now - prior.now) * 1e6)));
}

/** Read local Intel and AMD DRM sysfs data. All paths and reads are local and read-only. */
export async function readDrmGpus({root = SYSFS_DRM, now = Date.now()} = {}) {
  const cards = [];
  for (const entry of await children(root)) {
    if (!/^card\d+$/.test(entry.name)) continue;
    try { if ((await stat(`${root}/${entry.name}`)).isDirectory()) cards.push(entry); } catch { /* disconnected adapter */ }
  }
  const gpus = [];
  for (const card of cards) {
    const device = `${root}/${card.name}/device`;
    const vendor = (await readText(`${device}/vendor`))?.toLowerCase();
    if (vendor !== VENDOR_INTEL && vendor !== VENDOR_AMD) continue;
    const intel = vendor === VENDOR_INTEL;
    const model = await readText(`${device}/product_name`);
    const name = model ? (/^(?:Intel|AMD)\b/i.test(model) ? model : `${intel ? 'Intel' : 'AMD'} ${model}`) : `${intel ? 'Intel' : 'AMD'} GPU`;
    const used = await firstNumber([`${device}/mem_info_vram_used`, `${device}/mem_info_gtt_used`], 1048576);
    const total = await firstNumber([`${device}/mem_info_vram_total`, `${device}/mem_info_gtt_total`], 1048576);
    const busyPath = (await filesBelow(device, file => intel ? file === 'busy' || file === 'gpu_busy_percent' : file === 'gpu_busy_percent'))[0];
    const busyRaw = busyPath ? numberOrNull(await readText(busyPath)) : null;
    const util = busyPath && (!intel || busyPath.endsWith('/gpu_busy_percent')) ? busyRaw : busyPath ? busyPercent(busyPath, busyRaw, now) : null;
    const hwmon = await filesBelow(device, file => /^(?:temp\d+_input|power\d+_(?:average|input))$/.test(file));
    const temps = hwmon.filter(path => /temp\d+_input$/.test(path));
    const powers = hwmon.filter(path => /power\d+_(?:average|input)$/.test(path));
    const power = await firstNumber(powers, 1e6);
    gpus.push({
      index: numberOrNull(card.name.slice(4)) ?? gpus.length,
      name,
      util: util === null ? null : Math.max(0, Math.min(100, util)),
      vramUsedMiB: used,
      vramTotalMiB: total,
      tempC: await firstNumber(temps, 1000),
      powerW: power,
      powerLimitW: null,
    });
  }
  return gpus;
}

function rowsIn(value) {
  if (Array.isArray(value)) return value.flatMap(rowsIn);
  if (!value || typeof value !== 'object') return [];
  const keys = Object.keys(value).map(key => key.toLowerCase());
  if (keys.some(key => /device.?name|gpu.?name|gpu.?use|gpu.?util|power|temperature|vram|memory/.test(key))) return [value];
  return Object.values(value).flatMap(rowsIn);
}

function field(row, pattern) {
  for (const [key, value] of Object.entries(row)) if (pattern.test(key.toLowerCase())) {
    const raw = typeof value === 'object' && value !== null ? value.value ?? value.current ?? value : value;
    const parsed = numberOrNull(raw) ?? (typeof raw === 'string' ? Number.parseFloat(raw) : null);
    const number = Number.isFinite(parsed) ? parsed : null;
    if (number !== null) return number;
  }
  return null;
}

/** Parse xpu-smi's JSON dump output without depending on one driver release's wrapper keys. */
export function parseXpuSmi(output) {
  let data;
  try { data = JSON.parse(String(output)); } catch { return []; }
  if (Array.isArray(data?.device_level)) {
    const metrics = Object.fromEntries(data.device_level.map(item => [String(item.metrics_type ?? '').replace(/^XPUM_STATS_/, '').toLowerCase(), item.value]));
    return [{
      index: numberOrNull(data.device_id) ?? 0,
      name: 'Intel GPU',
      util: field(metrics, /gpu.?utilization|gpu.?usage/),
      vramUsedMiB: field(metrics, /memory.?used|vram.?used/),
      vramTotalMiB: field(metrics, /memory.?total|vram.?total|physical.?size/),
      tempC: field(metrics, /core.?temperature|gpu.?temperature/),
      powerW: field(metrics, /^(?:gpu.?power|power)$/),
      powerLimitW: field(metrics, /power.?limit/),
    }];
  }
  return rowsIn(data).map((row, index) => ({
    index: field(row, /device.?id|gpu.?id/) ?? index,
    name: Object.entries(row).find(([key]) => /device.?name|gpu.?name/i.test(key))?.[1] ?? 'Intel GPU',
    util: field(row, /gpu.?util|utilization/),
    vramUsedMiB: field(row, /memory.?used|vram.?used/),
    vramTotalMiB: field(row, /memory.?total|vram.?total|physical.?size/),
    tempC: field(row, /core.?temperature|gpu.?temperature|temperature/),
    powerW: field(row, /gpu.?power|power.?draw/),
    powerLimitW: field(row, /power.?limit/),
  }));
}

/** Parse the JSON output of rocm-smi, whose key casing varies across releases. */
export function parseRocmSmi(output) {
  let data;
  try { data = JSON.parse(String(output)); } catch { return []; }
  return rowsIn(data).map((row, index) => {
    const memoryMiB = kind => {
      for (const [key, raw] of Object.entries(row)) {
        const label = key.toLowerCase();
        if (!/(?:vram|memory)/.test(label) || (kind === 'used' ? !/used/.test(label) : !/total/.test(label) || /used/.test(label))) continue;
        const value = numberOrNull(raw) ?? (typeof raw === 'string' ? Number.parseFloat(raw) : null);
        if (Number.isFinite(value)) return value > 1_000_000 ? value / 1048576 : value;
      }
      return null;
    };
    return {
      index: field(row, /card.?number|device.?id|gpu.?id/) ?? index,
      name: Object.entries(row).find(([key]) => /product.?name|gpu.?name/i.test(key))?.[1] ?? 'AMD GPU',
      util: field(row, /gpu.?use|gpu.?util/),
      vramUsedMiB: memoryMiB('used'),
      vramTotalMiB: memoryMiB('total'),
      tempC: field(row, /temperature/),
      powerW: field(row, /average.*power|power.*average|power.?draw/),
      powerLimitW: field(row, /power.?cap|power.?limit/),
    };
  });
}

/** Prefer sysfs discovery; fill missing values with vendor-tool readings for the same adapter. */
export async function readOtherGpus({exec = run, root = SYSFS_DRM} = {}) {
  const sysfs = await readDrmGpus({root});
  if (sysfs.length === 0) return [];
  const vendors = new Set(sysfs.map(gpu => /^Intel\b/i.test(gpu.name) ? VENDOR_INTEL : VENDOR_AMD));
  const vendor = new Map([[VENDOR_INTEL, []], [VENDOR_AMD, []]]);
  if (vendors.has(VENDOR_INTEL)) {
    let discovery;
    try { discovery = JSON.parse(await exec('xpu-smi', ['discovery', '-j']) ?? 'null'); } catch { discovery = null; }
    for (const device of discovery?.device_list ?? []) {
      if (!Number.isInteger(Number(device.device_id))) continue;
      const stats = parseXpuSmi(await exec('xpu-smi', ['stats', '-d', String(device.device_id), '-j']) ?? '');
      const card = /card(\d+)/.exec(device.drm_device ?? '')?.[1];
      for (const gpu of stats) vendor.get(VENDOR_INTEL).push({...gpu, index: card ? Number(card) : gpu.index, name: device.device_name ?? gpu.name});
    }
  }
  if (vendors.has(VENDOR_AMD)) vendor.set(VENDOR_AMD, parseRocmSmi(await exec('rocm-smi', ['--json', '--showuse', '--showmeminfo', 'vram', '--showtemp', '--showpower']) ?? ''));
  const vendorIndices = new Map([[VENDOR_INTEL, 0], [VENDOR_AMD, 0]]);
  return sysfs.map((gpu, index) => {
    const type = /^Intel\b/i.test(gpu.name) ? VENDOR_INTEL : VENDOR_AMD;
    const readings = vendor.get(type);
    const extra = readings.find(item => item.index === gpu.index) ?? readings[vendorIndices.get(type)];
    vendorIndices.set(type, vendorIndices.get(type) + 1);
    if (!extra) return gpu;
    return {...gpu,
      util: gpu.util ?? extra.util, vramUsedMiB: gpu.vramUsedMiB ?? extra.vramUsedMiB,
      vramTotalMiB: gpu.vramTotalMiB ?? extra.vramTotalMiB, tempC: gpu.tempC ?? extra.tempC,
      powerW: gpu.powerW ?? extra.powerW, powerLimitW: gpu.powerLimitW ?? extra.powerLimitW};
  });
}

/** Select the first available local GPU reader; resolves to {ok, gpus, reason}, never throws. */
export async function readGpus({exec = run, root = SYSFS_DRM} = {}) {
  const nvidia = await readNvidia({exec});
  if (nvidia.ok) return nvidia;
  try {
    const gpus = await readOtherGpus({exec, root});
    if (gpus.length) return {ok: true, gpus};
  } catch { /* unavailable driver tools fall back to sysfs and CPU-only reporting */ }
  return {ok: false, gpus: [], reason: 'No supported graphics card metrics are available on this computer.'};
}

// -- processor and memory ------------------------------------------------------------------------------------------

/** Total and idle ticks over all cores. */
export function cpuTicks(list = cpus()) {
  let idle = 0, total = 0;
  for (const core of list) {
    for (const [kind, value] of Object.entries(core.times)) { total += value; if (kind === 'idle') idle += value; }
  }
  return {idle, total};
}

/** Busy percentage between two cpuTicks readings (null when no time passed). */
export function cpuPercent(previous, current) {
  if (!previous || !current) return null;
  const total = current.total - previous.total, idle = current.idle - previous.idle;
  return total > 0 ? Math.max(0, Math.min(100, Math.round(100 * (1 - idle / total)))) : null;
}

export function memoryNow() {
  const total = totalmem(), free = freemem();
  return {totalMiB: Math.round(total / 1048576), usedMiB: Math.round((total - free) / 1048576)};
}

// -- a short history for the little charts ---------------------------------------------------------------------------

/** Fixed-size history: push() drops the oldest row. */
export class Ring {
  constructor(size) { this.size = size; this.rows = []; }
  push(row) { this.rows.push(row); if (this.rows.length > this.size) this.rows.splice(0, this.rows.length - this.size); }
  toJSON() { return this.rows; }
}
