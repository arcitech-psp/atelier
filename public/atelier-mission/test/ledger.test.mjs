import assert from 'node:assert/strict';
import {test} from 'node:test';
import {
  SLOW_START_MS, UsageTracker, addStep, bumpDay, describeUsage, diffUsage, emptyStopwatch, emptyUsage, pruneDays, sinceSnapshot, stopwatchAction, takeSnapshot,
} from '../ledger.mjs';
import {Ring, cpuPercent, cpuTicks, numberOrNull, parseNvidiaSmi, readNvidia, resetNvidia} from '../telemetry.mjs';
import {
  DEFAULT_WAIT_SECONDS, MAX_WAIT_SECONDS, MIN_WAIT_SECONDS, clampWait, dispatcherOptions, isLocalEndpoint, planDisable, planEnable, swapRetryPolicy,
} from '../swap.mjs';

// ---- the session event feed ---------------------------------------------------------------------------------------

const event = (type, time, data) => ({type, time, data});

function runStep(tracker, {session = 's1', turn = 1, step = 1, start, firstToken, end, usage}) {
  tracker.onEvent(session, event('step/start', start, {turn, step}));
  if (firstToken !== undefined) tracker.onEvent(session, event('assistant/chunk', firstToken, {turn, step, chunk: {type: 'text-delta', text: 'Hello'}}));
  if (end !== undefined) {
    tracker.onEvent(session, event('assistant/message', end, {turn, step, message: {}, usage}));
    tracker.onEvent(session, event('step/end', end, {turn, step}));
  }
}

test('a finished request records tokens, first-token wait and generation speed', () => {
  const steps = [];
  const tracker = new UsageTracker({onStep: step => steps.push(step), now: () => 100_000});
  runStep(tracker, {start: 1000, firstToken: 3000, end: 8000, usage: {inputTokens: 900, cacheReadTokens: 100, outputTokens: 251}});
  assert.equal(steps.length, 1);
  assert.equal(steps[0].ttftMs, 2000);
  assert.equal(steps[0].genMs, 5000);
  const usage = addStep(emptyUsage(), steps[0]);
  const shown = describeUsage(usage);
  assert.equal(shown.requests, 1);
  assert.equal(shown.inputTokens, 1000);        // uncached + cache read
  assert.equal(shown.outputTokens, 251);
  assert.equal(shown.totalTokens, 1251);
  assert.equal(shown.tokensPerSecond, 250 / 5);  // (251 - 1 first token) / 5 s
  assert.equal(shown.firstTokenSeconds, 2);
  assert.equal(shown.slowStarts, 0);
});

test('a first token later than 15 s counts as a slow start (a model load)', () => {
  let usage = emptyUsage();
  usage = addStep(usage, {usage: {inputTokens: 10, outputTokens: 5}, ttftMs: SLOW_START_MS + 1, genMs: 1000});
  usage = addStep(usage, {usage: {inputTokens: 10, outputTokens: 5}, ttftMs: 800, genMs: 1000});
  const shown = describeUsage(usage);
  assert.equal(shown.slowStarts, 1);
  assert.equal(shown.slowestFirstTokenSeconds, (SLOW_START_MS + 1) / 1000);
  assert.ok(Math.abs(shown.firstTokenSeconds - (SLOW_START_MS + 1 + 800) / 2 / 1000) < 1e-9);
});

test('reasoning and tool-call deltas count as the first token, empty ones do not', () => {
  const steps = [];
  const tracker = new UsageTracker({onStep: step => steps.push(step), now: () => 0});
  tracker.onEvent('s', event('step/start', 0, {turn: 1, step: 1}));
  tracker.onEvent('s', event('assistant/chunk', 100, {turn: 1, step: 1, chunk: {type: 'text-delta', text: ''}}));
  tracker.onEvent('s', event('assistant/chunk', 200, {turn: 1, step: 1, chunk: {type: 'usage', usage: {}}}));
  tracker.onEvent('s', event('assistant/chunk', 4000, {turn: 1, step: 1, chunk: {type: 'reasoning-delta', text: 'thinking'}}));
  tracker.onEvent('s', event('assistant/message', 5000, {turn: 1, step: 1, message: {}, usage: {inputTokens: 1, outputTokens: 3}}));
  assert.equal(steps[0].ttftMs, 4000);
});

test('a message with no usage still counts as a request but adds no tokens', () => {
  const usage = addStep(emptyUsage(), {ttftMs: 100});
  assert.equal(usage.requests, 1);
  assert.equal(usage.inputTokens + usage.outputTokens, 0);
  assert.equal(describeUsage(usage).tokensPerSecond, null);
});

test('busy time and the wait for a first token follow the requests in flight', () => {
  let clock = 0;
  const tracker = new UsageTracker({now: () => clock});
  assert.equal(tracker.busyTotal(0), 0);
  assert.equal(tracker.waitingMs(0), 0);
  tracker.onEvent('a', event('step/start', 1000, {turn: 1, step: 1}));
  tracker.onEvent('b', event('step/start', 3000, {turn: 1, step: 1}));
  assert.equal(tracker.openCount, 2);
  assert.equal(tracker.waitingMs(11_000), 10_000);               // the oldest request waits longest
  assert.equal(tracker.busyTotal(11_000), 10_000);               // overlapping requests are not double counted
  tracker.onEvent('a', event('assistant/chunk', 12_000, {turn: 1, step: 1, chunk: {type: 'text-delta', text: 'x'}}));
  assert.equal(tracker.waitingMs(13_000), 10_000);               // now b waits (since 3000)
  tracker.onEvent('a', event('step/end', 14_000, {turn: 1, step: 1}));
  tracker.onEvent('b', event('step/end', 15_000, {turn: 1, step: 1}));
  assert.equal(tracker.openCount, 0);
  assert.equal(tracker.busyTotal(99_000), 14_000);               // 1000 -> 15000
  assert.equal(tracker.waitingMs(99_000), 0);
});

test('a session that goes away takes its open requests with it', () => {
  const tracker = new UsageTracker({now: () => 0});
  tracker.onEvent('a', event('step/start', 0, {turn: 1, step: 1}));
  tracker.onEvent('a', event('step/start', 0, {turn: 2, step: 1}));
  tracker.onEvent('b', event('step/start', 0, {turn: 1, step: 1}));
  tracker.onSessionGone('a', 5000);
  assert.equal(tracker.openCount, 1);
  tracker.onSessionGone('b', 7000);
  assert.equal(tracker.openCount, 0);
  assert.equal(tracker.busyTotal(10_000), 7000);
});

test('stray or malformed events are ignored', () => {
  const tracker = new UsageTracker({now: () => 0});
  assert.doesNotThrow(() => {
    tracker.onEvent('a', undefined);
    tracker.onEvent('a', event('assistant/message', 5, {turn: 9, step: 9, usage: {inputTokens: 1, outputTokens: 1}}));
    tracker.onEvent('a', event('step/end', 5, {turn: 9, step: 9}));
    tracker.onEvent('a', event('something/else', 5, {}));
  });
  assert.equal(tracker.openCount, 0);
});

// ---- the stopwatch ----------------------------------------------------------------------------------------------------

test('stopwatch: start, lap, stop records time, tokens and energy for just that run', () => {
  const usageAt = (requests, input, output) => ({...emptyUsage(), requests, inputTokens: input, outputTokens: output});
  let state = {stopwatch: emptyStopwatch(), history: []};
  // before the run: 5 requests already counted, 10 Wh already used
  state = stopwatchAction(state, 'start', takeSnapshot({usage: usageAt(5, 1000, 500), energy: {measuredWh: 10, estimatedWh: 0}, time: 1_000}));
  assert.equal(state.stopwatch.status, 'running');
  state = stopwatchAction(state, 'start', takeSnapshot({usage: usageAt(9, 9, 9), energy: {measuredWh: 99, estimatedWh: 0}, time: 2_000}));   // second start does nothing
  assert.equal(state.stopwatch.startedAt, 1_000);
  state = stopwatchAction(state, 'lap', takeSnapshot({usage: usageAt(6, 1200, 600), energy: {measuredWh: 12, estimatedWh: 0}, time: 31_000}));
  assert.equal(state.stopwatch.laps.length, 1);
  assert.equal(state.stopwatch.laps[0].wallMs, 30_000);
  assert.equal(state.stopwatch.laps[0].usage.requests, 1);
  state = stopwatchAction(state, 'stop', takeSnapshot({usage: usageAt(8, 2000, 900), energy: {measuredWh: 15.5, estimatedWh: 0}, time: 61_000}), 'run-1');
  assert.equal(state.stopwatch.status, 'stopped');
  assert.equal(state.history.length, 1);
  const run = state.history[0];
  assert.equal(run.id, 'run-1');
  assert.equal(run.wallMs, 60_000);
  assert.equal(run.usage.requests, 3);
  assert.equal(run.usage.inputTokens, 1000);
  assert.equal(run.usage.outputTokens, 400);
  assert.equal(run.energy.measuredWh, 5.5);
  assert.equal(run.laps.length, 1);
  assert.equal(run.laps[0].usage.outputTokens, 100);
});

test('stopwatch: stop and lap while stopped do nothing; reset and clear work; history is capped', () => {
  const snap = time => takeSnapshot({usage: emptyUsage(), energy: {measuredWh: 0, estimatedWh: 0}, time});
  let state = {stopwatch: emptyStopwatch(), history: []};
  assert.equal(stopwatchAction(state, 'stop', snap(5)), state);
  assert.equal(stopwatchAction(state, 'lap', snap(5)), state);
  assert.equal(stopwatchAction(state, 'unknown', snap(5)), state);
  for (let index = 0; index < 25; index++) {
    state = stopwatchAction(state, 'start', snap(index * 10));
    state = stopwatchAction(state, 'stop', snap(index * 10 + 5), `r${index}`);
  }
  assert.equal(state.history.length, 20);
  assert.equal(state.history[0].id, 'r24');
  state = stopwatchAction(state, 'start', snap(1000));
  state = stopwatchAction(state, 'reset', snap(1001));
  assert.equal(state.stopwatch.status, 'stopped');
  assert.equal(state.history.length, 20);
  assert.deepEqual(stopwatchAction(state, 'clear-history', snap(1002)).history, []);
});

test('usage differences never go negative, and sinceSnapshot reports the clock', () => {
  const a = {...emptyUsage(), requests: 5, inputTokens: 100};
  const b = {...emptyUsage(), requests: 3, inputTokens: 150};
  const diff = diffUsage(a, b);
  assert.equal(diff.requests, 0);
  assert.equal(diff.inputTokens, 50);
  const since = sinceSnapshot(takeSnapshot({usage: a, energy: {measuredWh: 5, estimatedWh: 0}, time: 100}), takeSnapshot({usage: b, energy: {measuredWh: 4, estimatedWh: 0}, time: 400}));
  assert.equal(since.wallMs, 300);
  assert.equal(since.energy.measuredWh, 0);
});

test('day ledger adds to the right day and prunes old ones', () => {
  const time = new Date(2026, 9, 12, 10, 0, 0).getTime();
  let days = bumpDay({}, time, {usageStep: {usage: {inputTokens: 10, outputTokens: 5}}});
  days = bumpDay(days, time, {energy: {measuredWh: 2, estimatedWh: 0}});
  days = bumpDay(days, time, {usageStep: {usage: {inputTokens: 1, outputTokens: 1}}});
  assert.deepEqual(Object.keys(days), ['2026-10-12']);
  assert.equal(days['2026-10-12'].usage.requests, 2);
  assert.equal(days['2026-10-12'].energy.measuredWh, 2);
  const many = Object.fromEntries(Array.from({length: 10}, (_, index) => [`2026-01-${String(index + 1).padStart(2, '0')}`, {}]));
  assert.deepEqual(Object.keys(pruneDays(many, 3)), ['2026-01-08', '2026-01-09', '2026-01-10']);
  assert.equal(pruneDays(many, 99), many);
});

// ---- nvidia-smi and the machine ---------------------------------------------------------------------------------------

const SMI_ONE = '0, NVIDIA GeForce RTX 4080 Laptop GPU, 37, 13512, 12282, 61, 118.52, 150.00\n';
const SMI_TWO = '0, NVIDIA RTX A4000, 5, 800, 16376, 40, 22.10, 140.00\n1, NVIDIA GeForce RTX 3060, 0, 12, 12288, 35, 14.30, 170.00\n';

test('nvidia-smi: one card and two cards', () => {
  const [card] = parseNvidiaSmi(SMI_ONE);
  assert.deepEqual(card, {index: 0, name: 'GeForce RTX 4080 Laptop GPU', util: 37, vramUsedMiB: 13512, vramTotalMiB: 12282, tempC: 61, powerW: 118.52, powerLimitW: 150});
  const two = parseNvidiaSmi(SMI_TWO);
  assert.equal(two.length, 2);
  assert.deepEqual(two.map(gpu => gpu.name), ['RTX A4000', 'GeForce RTX 3060']);
  assert.equal(two[1].index, 1);
});

test('nvidia-smi: unsupported readings are null, not zero, and garbage is ignored', () => {
  const [card] = parseNvidiaSmi('0, NVIDIA GeForce GT 1030, [N/A], 300, 2048, 45, [Not Supported], [N/A]\n');
  assert.equal(card.util, null);
  assert.equal(card.powerW, null);
  assert.equal(card.powerLimitW, null);
  assert.equal(card.vramUsedMiB, 300);
  assert.deepEqual(parseNvidiaSmi(''), []);
  assert.deepEqual(parseNvidiaSmi('NVIDIA-SMI has failed because it could not communicate with the NVIDIA driver.'), []);
  assert.deepEqual(parseNvidiaSmi(undefined), []);
  assert.equal(numberOrNull('  '), null);
  assert.equal(numberOrNull('12.5'), 12.5);
  assert.equal(numberOrNull('abc'), null);
});

test('reading the card: ok with output, a plain message when the tool is missing', async () => {
  resetNvidia();
  const ok = await readNvidia({exec: async () => SMI_ONE});
  assert.equal(ok.ok, true);
  assert.equal(ok.gpus[0].powerW, 118.52);
  resetNvidia();
  const missing = await readNvidia({exec: async () => null});
  assert.equal(missing.ok, false);
  assert.deepEqual(missing.gpus, []);
  assert.match(missing.reason, /only readable on NVIDIA/);
  resetNvidia();
});

test('processor percentage from tick counters, and the chart history keeps the newest rows', () => {
  assert.equal(cpuPercent({idle: 100, total: 200}, {idle: 150, total: 400}), 75);
  assert.equal(cpuPercent({idle: 100, total: 200}, {idle: 100, total: 200}), null);
  assert.equal(cpuPercent(null, {idle: 1, total: 2}), null);
  assert.ok(cpuTicks().total > 0);
  const ring = new Ring(3);
  for (let index = 0; index < 5; index++) ring.push([index]);
  assert.deepEqual(ring.rows, [[2], [3], [4]]);
});

// ---- waiting for models to load ----------------------------------------------------------------------------------------

test('wait settings are clamped to something sensible', () => {
  assert.equal(clampWait(undefined), DEFAULT_WAIT_SECONDS);
  assert.equal(clampWait('abc'), DEFAULT_WAIT_SECONDS);
  assert.equal(clampWait(5), MIN_WAIT_SECONDS);
  assert.equal(clampWait(999_999), MAX_WAIT_SECONDS);
  assert.equal(clampWait(600.4), 600);
  assert.deepEqual(dispatcherOptions(600), {headersTimeout: 600_000, bodyTimeout: 600_000});
});

test('only this computer and its own network count as local endpoints', () => {
  for (const url of ['http://localhost:1234/v1', 'http://127.0.0.1:8080/v1', 'http://[::1]:11434/v1', 'http://192.168.1.20:8000/v1', 'http://10.0.0.5/v1', 'http://studio.local:1234/v1', 'http://box.lan/v1']) {
    assert.equal(isLocalEndpoint(url), true, url);
  }
  for (const url of ['https://api.openai.com/v1', 'https://openrouter.ai/api/v1', 'http://8.8.8.8/v1', 'not a url', undefined]) {
    assert.equal(isLocalEndpoint(url), false, String(url));
  }
});

test('turning the mode on sets only what the person has not set, and remembers it', () => {
  const providers = {
    local: {baseURL: 'http://localhost:1234/v1', models: [{id: 'm'}]},
    custom: {baseURL: 'http://localhost:8080/v1', streamIdleTimeoutMs: 42_000, models: [{id: 'm'}]},
    hosted: {baseURL: 'https://api.example.com/v1', models: [{id: 'm'}]},
  };
  const plan = planEnable(providers, 600, {});
  const byRoute = route => plan.ops.filter(op => op.path[1] === route).map(op => op.path[2]).sort();
  assert.deepEqual(byRoute('local'), ['retryPolicy', 'streamIdleTimeoutMs', 'timeoutMs']);
  assert.deepEqual(byRoute('custom'), ['retryPolicy', 'timeoutMs']);       // their own idle timeout is respected
  assert.deepEqual(byRoute('hosted'), []);                               // hosted APIs keep their timers
  assert.deepEqual(plan.managed.custom.sort(), ['retryPolicy', 'timeoutMs']);
  assert.equal(plan.ops.find(op => op.path[1] === 'local' && op.path[2] === 'streamIdleTimeoutMs').value, 600_000);
  assert.deepEqual(plan.routes.sort(), ['custom', 'local']);
  const retry = swapRetryPolicy();
  assert.equal(retry.mode, 'normal');
  assert.ok(!retry.retryableCodes.includes('TIMEOUT'));
  assert.ok(retry.backoff.initialDelayMs <= retry.backoff.maxDelayMs);
});

test('the idle timer at the harness default counts as not set (the settings service fills schema defaults in)', () => {
  const providers = {local: {baseURL: 'http://localhost:1234/v1', streamIdleTimeoutMs: 300_000, models: []}};
  const plan = planEnable(providers, 600, {});
  assert.deepEqual(plan.ops.map(op => op.path[2]).sort(), ['retryPolicy', 'streamIdleTimeoutMs', 'timeoutMs']);
  assert.equal(plan.ops.find(op => op.path[2] === 'streamIdleTimeoutMs').value, 600_000);
});

test('changing the wait rewrites only our own values; turning it off removes exactly those', () => {
  const providers = {local: {baseURL: 'http://localhost:1234/v1', streamIdleTimeoutMs: 600_000, timeoutMs: 600_000, retryPolicy: swapRetryPolicy(), models: []},
    mine: {baseURL: 'http://localhost:9/v1', timeoutMs: 123, models: []}};
  const managed = {local: ['streamIdleTimeoutMs', 'timeoutMs', 'retryPolicy']};
  // same wait: nothing to write
  assert.deepEqual(planEnable(providers, 600, managed).ops.filter(op => op.path[1] === 'local'), []);
  // longer wait: our two timers are rewritten, the retry policy is unchanged
  const longer = planEnable(providers, 1200, managed);
  assert.deepEqual(longer.ops.filter(op => op.path[1] === 'local').map(op => op.path[2]).sort(), ['streamIdleTimeoutMs', 'timeoutMs']);
  // a value the person set is never taken over, even if it equals ours by chance
  assert.equal(planEnable(providers, 600, managed).ops.filter(op => op.path[1] === 'mine' && op.path[2] === 'timeoutMs').length, 0);
  const off = planDisable(managed);
  assert.deepEqual(off.ops.map(op => op.op), ['unset', 'unset', 'unset']);
  assert.ok(off.ops.every(op => op.path[1] === 'local'));
  assert.deepEqual(planDisable({}).ops, []);
});
