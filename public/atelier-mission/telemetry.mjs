// What this computer is doing right now: graphics card use and power (NVIDIA through nvidia-smi), processor use and
// memory. Other makes of graphics card are reported as "not available" instead of guessed: this file reads only
// what the driver tool prints. Nothing here leaves the computer.
import {execFile} from 'node:child_process';
import {existsSync} from 'node:fs';
import {cpus, freemem, totalmem} from 'node:os';

const NA = /^\s*(\[?(n\/a|not supported|not available|unknown error)\]?|)\s*$/i;
/** "123.45" to 123.45; "[N/A]", "[Not Supported]" and empty text to null. */
export function numberOrNull(value) {
  if (value === undefined || NA.test(String(value))) return null;
  const parsed = Number(String(value).trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export const NVIDIA_QUERY = 'index,name,utilization.gpu,memory.used,memory.total,temperature.gpu,power.draw,power.limit';

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
