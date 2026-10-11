// Tokens, timings and the stopwatch. Fed by the harness's own session events (the same `assistant/message` usage the
// chat view shows), so nothing is read from disk and no prompt text is ever touched: only counts and times.
import {addEnergy, localDay} from './energy.mjs';

export const emptyUsage = () => ({requests: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, genMs: 0, genTokens: 0, ttftMs: 0, ttftSteps: 0, maxTtftMs: 0, slowStarts: 0});

/** A first token later than this almost always means the model was being loaded first. */
export const SLOW_START_MS = 15_000;

const whole = value => (Number.isFinite(value) && value > 0 ? Math.round(value) : 0);

/**
 * Add one finished model request to a usage record. Returns a new record.
 * @param {ReturnType<typeof emptyUsage>} usage
 * @param {{usage?: {inputTokens?: number, outputTokens?: number, cacheReadTokens?: number, cacheWriteTokens?: number}, ttftMs?: number, genMs?: number}} step
 */
export function addStep(usage, step) {
  const used = step.usage ?? {};
  const next = {...usage, requests: usage.requests + 1};
  next.inputTokens += whole(used.inputTokens) + whole(used.cacheReadTokens) + whole(used.cacheWriteTokens);
  next.cacheReadTokens += whole(used.cacheReadTokens);
  next.outputTokens += whole(used.outputTokens);
  if (Number.isFinite(step.ttftMs) && step.ttftMs >= 0) {
    next.ttftMs += step.ttftMs; next.ttftSteps += 1; next.maxTtftMs = Math.max(next.maxTtftMs, step.ttftMs);
    if (step.ttftMs >= SLOW_START_MS) next.slowStarts += 1;
  }
  // Speed counts only requests that streamed for a measurable time and reported their output tokens.
  if (Number.isFinite(step.genMs) && step.genMs > 50 && whole(used.outputTokens) > 1) {
    next.genMs += step.genMs; next.genTokens += whole(used.outputTokens) - 1;
  }
  return next;
}

/** b minus a, for the figures that add up (the maximum is kept as it was in b). */
export function diffUsage(a, b) {
  const out = emptyUsage();
  for (const key of Object.keys(out)) out[key] = key === 'maxTtftMs' ? (b[key] ?? 0) : Math.max(0, (b[key] ?? 0) - (a?.[key] ?? 0));
  return out;
}

/** The figures the panel shows for a usage record. */
export function describeUsage(usage) {
  return {
    requests: usage.requests, inputTokens: usage.inputTokens, outputTokens: usage.outputTokens, totalTokens: usage.inputTokens + usage.outputTokens,
    tokensPerSecond: usage.genMs > 0 ? usage.genTokens / (usage.genMs / 1000) : null,
    firstTokenSeconds: usage.ttftSteps > 0 ? usage.ttftMs / usage.ttftSteps / 1000 : null,
    slowestFirstTokenSeconds: usage.ttftSteps > 0 ? usage.maxTtftMs / 1000 : null,
    slowStarts: usage.slowStarts,
  };
}

const isTokenDelta = chunk => {
  if (!chunk || typeof chunk !== 'object') return false;
  if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') return typeof chunk.text === 'string' && chunk.text !== '';
  if (chunk.type === 'tool-call-delta') return chunk.name !== undefined || (typeof chunk.argumentsDelta === 'string' && chunk.argumentsDelta !== '');
  return false;
};

/**
 * Follows the session event feed. For every model request ("step") it learns when it began, when the first token
 * arrived and how many tokens it used. Also keeps the time the harness spent waiting on a model, which the energy
 * estimate and the "waiting for the first token" hint need.
 */
export class UsageTracker {
  /** @param {{now?: () => number, onStep?: (step: {time: number, usage: any, ttftMs?: number, genMs?: number}) => void, maxOpen?: number}} [options] */
  constructor({now = Date.now, onStep = () => {}, maxOpen = 256} = {}) {
    this.now = now; this.onStep = onStep; this.maxOpen = maxOpen;
    this.open = new Map();   // "session|turn|step" -> {start, first}
    this.busyMs = 0;         // closed busy time
    this.busySince = 0;      // start of the current busy stretch (0 when idle)
    this.openCount = 0;
  }

  /** Total time at least one request was in flight, up to `time`. Monotonic. */
  busyTotal(time = this.now()) { return this.busyMs + (this.openCount > 0 ? Math.max(0, time - this.busySince) : 0); }

  /** How long the oldest request still waiting for its first token has waited (0 when none). */
  waitingMs(time = this.now()) {
    let oldest = 0;
    for (const entry of this.open.values()) if (entry.first === undefined) oldest = Math.max(oldest, time - entry.start);
    return oldest;
  }

  _opened(time) { if (this.openCount === 0) this.busySince = time; this.openCount += 1; }
  _closed(time) {
    if (this.openCount === 0) return;
    this.openCount -= 1;
    if (this.openCount === 0) this.busyMs += Math.max(0, time - this.busySince);
  }

  /** @param {string} sessionId @param {{type: string, time?: number, data?: any}} event */
  onEvent(sessionId, event) {
    const time = Number.isFinite(event?.time) ? event.time : this.now();
    const data = event?.data ?? {};
    const key = `${sessionId}|${data.turn}|${data.step}`;
    switch (event?.type) {
      case 'step/start':
        if (!this.open.has(key)) {
          if (this.open.size >= this.maxOpen) this._forgetOldest(time);
          this.open.set(key, {start: time}); this._opened(time);
        }
        break;
      case 'assistant/chunk': {
        const entry = this.open.get(key);
        if (entry && entry.first === undefined && isTokenDelta(data.chunk)) entry.first = time;
        break;
      }
      case 'assistant/message': {
        const entry = this.open.get(key);
        if (!entry) break;
        const ttftMs = entry.first === undefined ? undefined : entry.first - entry.start;
        const genMs = entry.first === undefined ? undefined : time - entry.first;
        this.onStep({time, usage: data.usage, ttftMs, genMs});
        break;
      }
      case 'step/end':
        if (this.open.delete(key)) this._closed(time);
        break;
      default:
        break;
    }
  }

  /** A session went away: whatever it had in flight is over. */
  onSessionGone(sessionId, time = this.now()) {
    for (const key of [...this.open.keys()]) {
      if (key.startsWith(`${sessionId}|`)) { this.open.delete(key); this._closed(time); }
    }
  }

  _forgetOldest(time) {
    const first = this.open.keys().next().value;
    if (first !== undefined) { this.open.delete(first); this._closed(time); }
  }
}

// -- the stopwatch -----------------------------------------------------------------------------------------------------

export const emptyStopwatch = () => ({status: 'stopped', startedAt: 0, base: null, laps: []});

/** What the stopwatch compares against: usage and energy counters plus the clock. */
export const takeSnapshot = ({usage, energy, time}) => ({usage: {...usage}, energy: {...energy}, time});

const diffEnergy = (a, b) => ({measuredWh: Math.max(0, b.measuredWh - (a?.measuredWh ?? 0)), estimatedWh: Math.max(0, b.estimatedWh - (a?.estimatedWh ?? 0))});

/** The figures between a snapshot and now. */
export function sinceSnapshot(base, now) {
  return {wallMs: Math.max(0, now.time - base.time), usage: diffUsage(base.usage, now.usage), energy: diffEnergy(base.energy, now.energy)};
}

/** @returns {{stopwatch: any, history: any[]}} */
export function stopwatchAction(state, action, snapshot, id = String(snapshot.time)) {
  const {stopwatch, history} = state;
  switch (action) {
    case 'start':
      if (stopwatch.status === 'running') return state;
      return {stopwatch: {status: 'running', startedAt: snapshot.time, base: snapshot, lapBase: snapshot, laps: []}, history};
    case 'lap': {
      if (stopwatch.status !== 'running') return state;
      const lap = {...sinceSnapshot(stopwatch.lapBase, snapshot), index: stopwatch.laps.length + 1};
      return {stopwatch: {...stopwatch, lapBase: snapshot, laps: [...stopwatch.laps, lap]}, history};
    }
    case 'stop': {
      if (stopwatch.status !== 'running') return state;
      const run = {id, startedAt: stopwatch.startedAt, endedAt: snapshot.time, ...sinceSnapshot(stopwatch.base, snapshot), laps: stopwatch.laps};
      return {stopwatch: emptyStopwatch(), history: [run, ...history].slice(0, 20)};
    }
    case 'reset':
      return {stopwatch: emptyStopwatch(), history};
    case 'clear-history':
      return {stopwatch, history: []};
    default:
      return state;
  }
}

// -- the day ledger ---------------------------------------------------------------------------------------------------

/** Keep the last `keep` days. */
export function pruneDays(days, keep = 120) {
  const keys = Object.keys(days).sort();
  const drop = keys.slice(0, Math.max(0, keys.length - keep));
  if (drop.length === 0) return days;
  const next = {...days};
  for (const key of drop) delete next[key];
  return next;
}

/** Add usage and/or energy to today's row. Returns a new days object. */
export function bumpDay(days, time, {usageStep, energy}) {
  const key = localDay(time);
  const row = days[key] ?? {usage: emptyUsage(), energy: {measuredWh: 0, estimatedWh: 0}};
  return {...days, [key]: {
    usage: usageStep ? addStep(row.usage, usageStep) : row.usage,
    energy: energy ? addEnergy(row.energy, energy) : row.energy,
  }};
}
