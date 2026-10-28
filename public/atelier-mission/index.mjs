// Atelier Mission Control, host half. It watches THIS computer only and reports to the browser half (client.js) over the
// harness's own authenticated connection:
//   - tokens, request speed and first-token waits, from the harness's session events (counts and times, never text)
//   - graphics card use, power and memory (NVIDIA through nvidia-smi; other cards are "not available")
//   - energy and its cost at the price per kWh the person entered (measured when the card reports power, else an estimate)
//   - which model is loaded now on LM Studio, Ollama or llama-swap, read from each tool's own endpoint
//   - "wait for models to load": the timers a one-GPU machine needs so a model swap is waited for, not failed
// Nothing is sent anywhere else. State lives in <Atelier home>/atelier-mission/state.json.
import {existsSync, readFileSync, writeFileSync, mkdirSync, renameSync} from 'node:fs';
import {readFile} from 'node:fs/promises';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {Agent, getGlobalDispatcher, setGlobalDispatcher} from 'undici';
import {dshHomePath} from '@deepseek-ai/dsh-home-paths';
import {credentialRef} from '@deepseek-ai/dsh-credentials';
import {settingsNamespace} from '@deepseek-ai/dsh-settings';
import {CURRENCIES, addEnergy, currencyForLocale, effectivePrice, integrateInterval, localDay, normalizePrefs, summarizeEnergy} from './energy.mjs';
import {Ring, cpuPercent, cpuTicks, memoryNow, readGpus} from './telemetry.mjs';
import {UsageTracker, addStep, bumpDay, describeUsage, emptyStopwatch, emptyUsage, pruneDays, sinceSnapshot, stopwatchAction, takeSnapshot} from './ledger.mjs';
import {PROVIDER_NAMES, applyWaiting, buildStatus, collectRoles, probeServer} from './models.mjs';
import {DEFAULT_WAIT_SECONDS, NO_LIMIT_SECONDS, clampWait, dispatcherOptions, planDisable, planEnable} from './swap.mjs';
import {MissionControl, SERVICES} from './control.mjs';

// Atelier guardrails (Settings > Safety, see atelier-start/guardrails.mjs): while they are off, the wait has no time limit.
const guardrails = () => (globalThis[Symbol.for('arcitech.atelier.guardrails')] ??= {off: false, listeners: new Set()});

export const name = 'atelier-mission';
export const inject = [];

const LLM = settingsNamespace('llm-pi-ai');
const DEFAULT_MODEL = settingsNamespace('agent-default-model');
const TICK_MS = 5_000;          // how often the card is read while somebody is watching or the harness is working
const WATCH_MS = 60_000;        // the panel counts as "being watched" for this long after its last request
const MODELS_TTL_MS = 4_000;    // model servers are asked at most this often
const SAVE_MS = 15_000;
const HISTORY_ROWS = 120;       // about ten minutes of charts at 5 s

const emptyEnergy = () => ({measuredWh: 0, estimatedWh: 0});

// "Wait for models to load" is on by default: on one graphics card the models take turns, and a first load must be waited
// for, not failed. It only touches routes on this computer or its own network; hosted APIs keep their timers.
function defaultState() {
  return {version: 1, prefs: normalizePrefs({currency: currencyForLocale(Intl.DateTimeFormat().resolvedOptions().locale)}), days: {},
    totals: {usage: emptyUsage(), energy: emptyEnergy()}, stopwatch: emptyStopwatch(), history: [], swap: {enabled: true, waitSeconds: DEFAULT_WAIT_SECONDS, managed: {}}};
}

export function apply(ctx, config = {}) {
  const root = config.home ?? dshHomePath('atelier-mission');
  const file = join(root, 'state.json');
  const rolesFile = config.rolesFile ?? join(dshHomePath('atelier-roles'), 'roles.json');
  const fetchImpl = config.fetch ?? fetch;
  const profileRole = Object.fromEntries(SERVICES.filter(row => row.role).map(row => [row.id, row.role]));
  const control = new MissionControl({file: join(root, 'control.json'), fetch: fetchImpl,
    onAssign: async (service, assignment) => {
      const roles = ctx.get('atelierRoles');
      if (!roles) return null;
      await roles.ready?.();
      const role = profileRole[service], before = {mission: roles.missionAssignment(service), role: role ? roles.peek(role) : undefined};
      await roles.setMissionAssignment(service, assignment);
      if (role) await roles.assign(role, {...assignment, baseURL: assignment.endpoint});
      return {service, role, before};
    },
    onRestore: async ({service, role, before}) => {
      const roles = ctx.get('atelierRoles');
      if (!roles) return;
      await roles.ready?.();
      await roles.setMissionAssignment(service, before?.mission);
      if (role) { if (before?.role) await roles.assign(role, before.role); else await roles.reset(role); }
    }});
  const controlReady = control.start();
  controlReady.catch(error => ctx.logger?.warn?.('atelier-mission: control config could not be loaded (%s)', error.message));

  // ---- state -------------------------------------------------------------------------------------------------------
  let state = defaultState();
  try {
    if (existsSync(file)) {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      state = {...state, ...saved, prefs: normalizePrefs(saved.prefs, state.prefs), swap: {...state.swap, ...saved.swap},
        totals: {usage: {...emptyUsage(), ...saved.totals?.usage}, energy: {...emptyEnergy(), ...saved.totals?.energy}},
        stopwatch: saved.stopwatch?.status ? saved.stopwatch : emptyStopwatch(), history: Array.isArray(saved.history) ? saved.history : [], days: saved.days ?? {}};
    }
  } catch (error) { ctx.logger?.warn?.('atelier-mission: could not read state.json (%s); starting fresh', error.message); }

  let dirty = false, lastSave = 0;
  const save = () => {
    if (!dirty) return;
    dirty = false; lastSave = Date.now();
    try {
      mkdirSync(root, {recursive: true});
      const temp = join(root, `${randomUUID()}.pending`);
      writeFileSync(temp, JSON.stringify({...state, days: pruneDays(state.days)}, null, 1));
      renameSync(temp, file);
    } catch (error) { ctx.logger?.warn?.('atelier-mission: could not save state.json (%s)', error.message); dirty = true; }
  };
  const touch = () => { dirty = true; };

  // ---- usage and energy counters (since this Atelier started) ------------------------------------------------------
  let sessionUsage = emptyUsage();
  let sessionEnergy = emptyEnergy();
  const tracker = new UsageTracker({onStep: step => {
    sessionUsage = addStep(sessionUsage, step);
    state.totals.usage = addStep(state.totals.usage, step);
    state.days = bumpDay(state.days, step.time, {usageStep: step});
    touch();
  }});
  ctx.on('session/event', (session, event) => {
    try {
      tracker.onEvent(session.id, event);
      if (event.type === 'step/start' || event.type === 'step/end') void tick();
    } catch (error) { ctx.logger?.debug?.('atelier-mission: event ignored (%s)', error.message); }
  });
  ctx.on('session/disposed', session => { try { tracker.onSessionGone(session.id); } catch { /* nothing in flight to clean */ } });

  // ---- machine sampling --------------------------------------------------------------------------------------------
  const ring = new Ring(HISTORY_ROWS);
  let machine = {gpu: {ok: false, gpus: [], reason: 'Not read yet.'}, cpuPercent: null, memory: memoryNow(), sampledAt: 0};
  let lastTick = null, lastCpu = cpuTicks(), lastWanted = 0, ticking = null, lastTickAt = 0;

  const wanted = () => Date.now() - lastWanted < WATCH_MS || tracker.openCount > 0 || state.stopwatch.status === 'running';

  async function tick(force = false) {
    if (ticking) return ticking;
    if (!force && Date.now() - lastTickAt < 1_000) return undefined;
    const stillWanted = wanted();
    // Nobody is watching and nothing runs: forget the last reading, so idle hours are never counted as a gap bridged.
    if (!force && !stillWanted && !lastTick) return undefined;
    ticking = (async () => {
      const time = Date.now();
      const gpu = config.readGpu === false ? {ok: false, gpus: [], reason: 'Graphics card reading is switched off in the Atelier settings (readGpu: false).'} : await readGpus();
      const cpu = cpuTicks();
      const percent = cpuPercent(lastCpu, cpu); lastCpu = cpu;
      const powerW = gpu.ok && gpu.gpus.length > 0 && gpu.gpus.every(card => card.powerW !== null) ? gpu.gpus.reduce((sum, card) => sum + card.powerW, 0) : null;
      const busy = tracker.busyTotal(time);
      if (lastTick) {
        const energy = integrateInterval({fromT: lastTick.time, toT: time, powerFromW: lastTick.powerW, powerToW: powerW,
          busyMs: busy - lastTick.busy, estimatedWatts: state.prefs.estimatedWatts});
        if (energy.measuredWh > 0 || energy.estimatedWh > 0) {
          sessionEnergy = addEnergy(sessionEnergy, energy);
          state.totals.energy = addEnergy(state.totals.energy, energy);
          state.days = bumpDay(state.days, time, {energy}); touch();
        }
      }
      // One last reading closes the interval after the work ended; then the idle clock starts.
      lastTick = !force && !stillWanted ? null : {time, powerW, busy};
      lastTickAt = time;
      machine = {gpu, cpuPercent: percent, memory: memoryNow(), sampledAt: time, powerW};
      ring.push([time,
        gpu.ok ? Math.max(...gpu.gpus.map(card => card.util ?? 0)) : null,
        gpu.ok ? gpu.gpus.reduce((sum, card) => sum + (card.vramUsedMiB ?? 0), 0) : null,
        gpu.ok ? gpu.gpus.reduce((sum, card) => sum + (card.vramTotalMiB ?? 0), 0) : null,
        powerW, percent]);
    })().catch(error => ctx.logger?.debug?.('atelier-mission: sample failed (%s)', error.message)).finally(() => { ticking = null; });
    return ticking;
  }

  ctx.effect(() => {
    const timer = setInterval(() => {
      void tick();
      if (Date.now() - lastSave >= SAVE_MS) save();
    }, TICK_MS);
    const controlTimer = setInterval(() => {
      void controlReady.then(() => Promise.all([control.probeAll(), control.checkAll()])).catch(error => ctx.logger?.debug?.('atelier-mission: control refresh failed (%s)', error.message));
    }, 30_000);
    timer.unref?.(); controlTimer.unref?.();
    void controlReady.then(() => Promise.all([control.probeAll(), control.checkAll()]));
    return () => { clearInterval(timer); clearInterval(controlTimer); save(); };
  }, 'atelier-mission sampler');

  // ---- which model is loaded ---------------------------------------------------------------------------------------
  let settings;
  let modelsCache = {time: 0, value: null, pending: null};

  const secret = async name => {
    if (!name) return undefined;
    if (process.env[name]) return process.env[name];
    try { return (await ctx.get('credentials')?.resolve(credentialRef(name)))?.value; } catch { return undefined; }
  };

  async function readRolesFile() {
    try { return JSON.parse(await readFile(rolesFile, 'utf8'))?.roles ?? {}; } catch { return {}; }
  }

  async function readModels(force = false) {
    if (!force && modelsCache.value && Date.now() - modelsCache.time < MODELS_TTL_MS) return modelsCache.value;
    if (modelsCache.pending) return modelsCache.pending;
    modelsCache.pending = (async () => {
      const providers = settings?.get(LLM)?.providers ?? {};
      const selection = settings?.get(DEFAULT_MODEL) ?? {};
      const roles = collectRoles({providers, selection, roles: await readRolesFile()});
      const origins = new Map();
      for (const role of roles) if (!origins.has(role.origin)) origins.set(role.origin, role);
      const servers = new Map();
      await Promise.all([...origins.entries()].map(async ([origin, role]) => {
        const key = await secret(role.apiKeyEnv);
        servers.set(origin, await probeServer(origin, {fetchImpl, apiBase: role.baseURL, headers: key ? {authorization: `Bearer ${key}`} : {}}));
      }));
      return {...buildStatus(roles, servers), checkedAt: Date.now(), configured: roles.length > 0};
    })().then(value => { modelsCache = {time: Date.now(), value, pending: null}; return value; },
      error => { modelsCache = {...modelsCache, pending: null}; throw error; });
    return modelsCache.pending;
  }

  // The "waiting for the first token" part changes every second; keep it fresh without re-asking the servers.
  const modelsNow = async force => {
    const waitingMs = tracker.waitingMs();
    return {...applyWaiting(await readModels(force), waitingMs), waitingMs};
  };

  // ---- wait for models to load -------------------------------------------------------------------------------------
  let previousDispatcher;
  const effectiveWait = () => (guardrails().off ? NO_LIMIT_SECONDS : state.swap.waitSeconds);
  function applyDispatcher() {
    try {
      if (state.swap.enabled) {
        previousDispatcher ??= getGlobalDispatcher();
        setGlobalDispatcher(new Agent(dispatcherOptions(effectiveWait())));
      } else if (previousDispatcher) {
        setGlobalDispatcher(previousDispatcher); previousDispatcher = undefined;
      }
    } catch (error) { ctx.logger?.warn?.('atelier-mission: could not change the HTTP timers (%s)', error.message); }
  }
  ctx.effect(() => () => { if (previousDispatcher) { try { setGlobalDispatcher(previousDispatcher); } catch { /* shutting down */ } previousDispatcher = undefined; } }, 'atelier-mission http timers');

  async function applySwapSettings() {
    if (!settings) return {routes: []};
    const section = settings.get(LLM);
    // The model provider registers its settings a moment after this plugin starts. Until it has, there is nothing to read,
    // and an empty answer must never be taken for "no providers": that would forget which values this feature set.
    if (section === undefined) throw new Error('The model settings are not loaded yet.');
    const providers = section.providers ?? {};
    if (state.swap.enabled) {
      const plan = planEnable(providers, effectiveWait(), state.swap.managed);
      if (plan.ops.length > 0) await settings.mutate(LLM, plan.ops);
      state.swap.managed = plan.managed; touch();
      return {routes: plan.routes};
    }
    const plan = planDisable(state.swap.managed);
    const present = plan.ops.filter(op => providers[op.path[1]]?.[op.path[2]] !== undefined);
    if (present.length > 0) await settings.mutate(LLM, present);
    state.swap.managed = {}; touch();
    return {routes: []};
  }

  applyDispatcher();
  ctx.inject(['settings'], sctx => {
    settings = sctx.settings;
    // A route added later (the Model roles page) gets the same patience as the ones present when the mode was turned on.
    // The first look waits for the model provider to register its settings.
    if (state.swap.enabled) {
      let tries = 0;
      const attempt = () => {
        applySwapSettings().catch(error => {
          if (settings && ++tries < 40) { retry = setTimeout(attempt, 1_500); retry.unref?.(); } else ctx.logger?.warn?.('atelier-mission: %s', error.message);
        });
      };
      let retry;
      attempt();
      sctx.effect(() => () => clearTimeout(retry));
    }
    sctx.effect(() => () => { settings = undefined; });
  });

  // Other Atelier parts ask how long to be patient with a model that has to load first (the vision and embedding calls of the
  // Model roles page do): 0 while "Wait for models to load" is off.
  ctx.provide('atelierMission', {waitMs: () => (state.swap.enabled ? effectiveWait() * 1000 : 0)});

  // Guardrails switched: the wait follows at once (no limit while they are off, the chosen minutes while they are on).
  const onGuardrails = () => {
    if (!state.swap.enabled) return;
    applyDispatcher();
    applySwapSettings().catch(error => ctx.logger?.warn?.('atelier-mission: %s', error.message));
  };
  guardrails().listeners.add(onGuardrails);
  ctx.effect(() => () => { guardrails().listeners.delete(onGuardrails); }, 'atelier-mission guardrails');

  // ---- what the panel gets -----------------------------------------------------------------------------------------
  function snapshotCounters(time = Date.now()) {
    const day = state.days[localDay(time)] ?? {usage: emptyUsage(), energy: emptyEnergy()};
    // The stopwatch compares against all-time counters (kept in state.json), so a run survives a restart of Atelier.
    return {day, now: takeSnapshot({usage: state.totals.usage, energy: state.totals.energy, time})};
  }

  async function snapshot() {
    lastWanted = Date.now();
    if (Date.now() - machine.sampledAt > TICK_MS + 1_500) await tick(true);
    const time = Date.now();
    const {day, now} = snapshotCounters(time);
    const prefs = state.prefs;
    const stopwatch = state.stopwatch;
    const live = stopwatch.status === 'running' ? sinceSnapshot(stopwatch.base, now) : null;
    const week = Object.entries(state.days).filter(([key]) => key >= localDay(time - 6 * 86_400_000))
      .reduce((sum, [, row]) => ({requests: sum.requests + row.usage.requests, tokens: sum.tokens + row.usage.inputTokens + row.usage.outputTokens}), {requests: 0, tokens: 0});
    const price = effectivePrice(prefs);
    const hasPower = machine.powerW !== null && machine.powerW !== undefined;
    return {
      now: time, platform: process.platform,
      machine: {
        gpus: machine.gpu.ok ? machine.gpu.gpus : [], gpuReason: machine.gpu.ok ? null : machine.gpu.reason, powerW: machine.powerW ?? null,
        cpuPercent: machine.cpuPercent, memory: machine.memory, sampledAt: machine.sampledAt, history: ring.rows,
      },
      usage: {today: describeUsage(day.usage), session: describeUsage(sessionUsage), week, busyNow: tracker.openCount > 0, waitingMs: tracker.waitingMs(time)},
      energy: {
        today: summarizeEnergy(day.energy, prefs), session: summarizeEnergy(sessionEnergy, prefs),
        stopwatch: live ? summarizeEnergy(live.energy, prefs) : null,
        // What the figures are made of, in words the panel prints under them.
        basis: hasPower ? 'measured' : prefs.estimatedWatts ? 'estimate' : 'none',
        coverage: hasPower ? 'Measured on this computer only: graphics card power read from nvidia-smi, summed over its cards. The processor, screen and the rest of the computer are not included, and neither is a model server on another computer or in the cloud.'
          : prefs.estimatedWatts ? `No power reading is available, so this is an estimate for this computer: ${prefs.estimatedWatts} W for the time the harness was working on model replies. A model server on another computer is not included.`
            : 'No power reading is available on this computer. Enter your computer\'s typical power draw while it works to get an estimate.',
        price: price.price, priceIsDefault: price.isDefault,
      },
      prefs: {...prefs, price: price.price, priceIsDefault: price.isDefault},
      currencies: CURRENCIES,
      stopwatch: {status: stopwatch.status, startedAt: stopwatch.startedAt, elapsedMs: stopwatch.status === 'running' ? time - stopwatch.startedAt : 0,
        laps: stopwatch.laps, live: live ? {...live, usage: describeUsage(live.usage)} : null},
      history: state.history.map(run => ({...run, usage: describeUsage(run.usage), energy: summarizeEnergy(run.energy, prefs)})),
      swap: {enabled: state.swap.enabled, waitSeconds: state.swap.waitSeconds, unlimited: guardrails().off, routes: Object.keys(state.swap.managed)},
      providerNames: PROVIDER_NAMES,
      models: await modelsNow(false).catch(error => ({rows: [], servers: [], summary: null, error: error.message, configured: false})),
    };
  }

  // ---- the browser's calls -----------------------------------------------------------------------------------------
  const bad = message => { const error = new Error(message); error.userMessage = message; return error; };

  const handlers = {
    snapshot: () => snapshot(),
    async control() { await controlReady; return control.snapshot(); },
    async addDevice(payload) { await controlReady; const result = await control.addDevice(payload); await control.probeAll(); return control.snapshot(); },
    async removeDevice(payload) { await controlReady; return control.removeDevice(String(payload?.id ?? '')); },
    async probeDevices() { await controlReady; return control.probeAll(); },
    async assignService(payload) { await controlReady; return control.assign(payload); },
    async testAssignment(payload) { await controlReady; return control.testAssignment(payload); },
    async checkServices() { await controlReady; return control.checkAll(); },
    async undoControl() { await controlReady; return control.undo(); },
    async configureServer(payload) { await controlReady; return control.configureServer(payload?.url); },
    async publishConfig() { await controlReady; return control.publish(); },
    async pullConfig() { await controlReady; return control.pull(); },
    models: async () => ({models: await modelsNow(false)}),
    async prefs(payload) {
      const next = normalizePrefs({...state.prefs, ...payload}, state.prefs);
      // Asked for a bad number? Say so instead of silently keeping the old one.
      if (payload && 'pricePerKwh' in payload && payload.pricePerKwh !== null && payload.pricePerKwh !== '' && next.pricePerKwh === null) throw bad('The price per kWh must be a number between 0 and 100000.');
      if (payload && 'estimatedWatts' in payload && payload.estimatedWatts !== null && payload.estimatedWatts !== '' && next.estimatedWatts === null) throw bad('The estimated power must be a number of watts between 1 and 5000.');
      state.prefs = next; touch(); save();
      return {ok: true};
    },
    async stopwatch(payload) {
      const action = String(payload?.action ?? '');
      if (!['start', 'stop', 'lap', 'reset', 'clear-history'].includes(action)) throw bad('Unknown stopwatch action.');
      await tick(true);
      const {now} = snapshotCounters();
      const next = stopwatchAction({stopwatch: state.stopwatch, history: state.history}, action, now);
      state.stopwatch = next.stopwatch; state.history = next.history; touch(); save();
      return {ok: true};
    },
    async swap(payload) {
      const enabled = payload?.enabled === true;
      state.swap.enabled = enabled;
      if (payload && payload.waitSeconds !== undefined) state.swap.waitSeconds = clampWait(payload.waitSeconds);
      applyDispatcher();
      let result = {routes: []};
      try { result = await applySwapSettings(); } catch (error) { touch(); save(); throw bad(`Could not update the model settings: ${error.message}`); }
      save();
      return {ok: true, routes: result.routes, hasSettings: settings !== undefined};
    },
  };

  ctx.inject(['connection'], cctx => cctx.effect(() => cctx.connection.rpc.handle('/atelier-mission', async (endpoint, payload) => {
    try {
      const handler = Object.hasOwn(handlers, endpoint) ? handlers[endpoint] : undefined;
      if (!handler) throw bad('Unknown Mission Control operation.');
      return {ok: true, value: await handler(payload)};
    } catch (error) {
      return {ok: false, error: {code: 'bad-request', message: error.userMessage ?? 'Mission Control could not do that.'}};
    }
  })));
}
