// Atelier Mission Control, browser half. Two things in the session header, one store behind them:
//   - a small chip that always shows which model is loaded now (loaded / loading / not loaded / offline), read from the
//     model server's own endpoints by the host half (index.mjs);
//   - the Mission Control sheet it opens: models on this GPU, this computer, tokens and speed, energy and cost at the
//     person's own price, a stopwatch, and the "wait for models to load" switch for one-GPU machines.
// It shows this computer only. Estimates are labelled as estimates.
window.__ModuleLoader__.load({id: '@arcitech/atelier-mission', factory: require => {
  const React = require('react');
  const {createElement: h, Fragment, useEffect, useMemo, useRef, useState, useSyncExternalStore} = React;
  const {createPortal} = require('react-dom');
  const exports = {};
  exports.inject = ['slots', 'connection'];

  // ---- small helpers --------------------------------------------------------------------------------------------------
  const STATE_WORD = {loaded: 'Loaded', loading: 'Loading', unloading: 'Unloading', unloaded: 'Not loaded', unknown: 'Not tracked', offline: 'Offline'};
  const STATE_NOTE = {
    unloaded: 'Loads when it is first used.', unknown: 'This server does not report what it has loaded.', offline: 'The server does not answer.',
  };
  const int = value => (Number.isFinite(value) ? Math.round(value).toLocaleString() : '-');
  const one = value => (Number.isFinite(value) ? value.toFixed(1) : '-');
  const duration = ms => {
    if (!Number.isFinite(ms) || ms < 0) return '-';
    const total = Math.floor(ms / 1000), hours = Math.floor(total / 3600), minutes = Math.floor(total % 3600 / 60), seconds = total % 60;
    const pad = value => String(value).padStart(2, '0');
    return hours > 0 ? `${hours}:${pad(minutes)}:${pad(seconds)}` : `${pad(minutes)}:${pad(seconds)}`;
  };
  const seconds = value => (Number.isFinite(value) ? (value < 10 ? `${value.toFixed(1)} s` : `${Math.round(value)} s`) : '-');
  const gib = bytes => (Number.isFinite(bytes) ? `${(bytes / 1073741824).toFixed(bytes >= 10737418240 ? 0 : 1)} GB` : null);
  const mib = value => (Number.isFinite(value) ? (value >= 1024 ? `${(value / 1024).toFixed(1)} GB` : `${Math.round(value)} MB`) : '-');
  const energyText = wh => {
    if (!Number.isFinite(wh)) return '-';
    if (wh >= 1000) return `${(wh / 1000).toFixed(wh >= 10000 ? 1 : 2)} kWh`;
    return wh >= 100 ? `${Math.round(wh)} Wh` : wh >= 1 ? `${wh.toFixed(1)} Wh` : `${wh.toFixed(2)} Wh`;
  };
  const money = (amount, currency) => {
    if (!Number.isFinite(amount)) return '-';
    const abs = Math.abs(amount);
    const digits = abs === 0 || abs >= 1 ? undefined : abs >= 0.1 ? 3 : abs >= 0.01 ? 4 : 5;
    try { return new Intl.NumberFormat(undefined, {style: 'currency', currency, ...(digits ? {minimumFractionDigits: digits, maximumFractionDigits: digits} : {})}).format(amount); }
    catch { return `${amount.toFixed(digits ?? 2)} ${currency}`; }
  };
  const until = time => {
    const left = (time - Date.now()) / 1000;
    if (!Number.isFinite(left) || left <= 0) return null;
    return left < 90 ? `${Math.round(left)} s` : `${Math.round(left / 60)} min`;
  };
  const shortModel = id => {
    const text = String(id ?? '');
    const tail = text.slice(text.lastIndexOf('/') + 1);
    return tail.length > 28 ? `${tail.slice(0, 26)}…` : tail;
  };

  exports.apply = ctx => {
    const call = async (endpoint, payload) => {
      const result = await ctx.connection.rpc.call('/atelier-mission', endpoint, payload ?? {});
      if (!result?.ok) throw Error(result?.error?.message ?? 'Mission Control did not answer.');
      return result.value;
    };

    // ---- one store shared by the chip and the sheet ----------------------------------------------------------------------
    const store = {models: null, snapshot: null, offset: 0, error: null, listeners: new Set()};
    const emit = () => { for (const listener of store.listeners) listener(); };
    let version = 0;
    const subscribe = listener => { store.listeners.add(listener); return () => store.listeners.delete(listener); };
    const useStore = () => { useSyncExternalStore(subscribe, () => version); return store; };
    const set = patch => { Object.assign(store, patch); version += 1; emit(); };

    const refreshModels = async () => {
      try { const {models} = await call('models'); set({models, error: null}); }
      catch (error) { set({error: error.message}); }
    };
    const refreshSnapshot = async () => {
      try {
        const snapshot = await call('snapshot');
        set({snapshot, models: snapshot.models, offset: snapshot.now - Date.now(), error: null});
      } catch (error) { set({error: error.message}); }
    };

    // ---- the header chip -----------------------------------------------------------------------------------------------------
    const Chip = () => {
      const s = useStore();
      const [open, setOpen] = useState(false);
      const button = useRef(null);
      useEffect(() => {
        let alive = true, timer;
        const loop = async () => {
          if (!alive) return;
          await refreshModels();
          const state = store.models?.summary?.state;
          const busy = state === 'loading' || (store.models?.waitingMs ?? 0) > 0;
          if (alive) timer = setTimeout(loop, busy ? 2000 : 10000);
        };
        void loop();
        return () => { alive = false; clearTimeout(timer); };
      }, []);
      useEffect(() => {
        const openFromElsewhere = () => setOpen(true);
        window.addEventListener('atelier:mission-control:open', openFromElsewhere);
        return () => window.removeEventListener('atelier:mission-control:open', openFromElsewhere);
      }, []);
      const summary = s.models?.summary;
      const state = !summary ? (s.error ? 'offline' : 'idle') : summary.state;
      const tracked = summary && state !== 'unknown';
      const label = summary ? shortModel(summary.model) : 'Mission';
      const word = summary ? (summary.inferred && state === 'loading' ? 'Loading' : STATE_WORD[state]) : '';
      const title = summary
        ? `${summary.label}: ${summary.model} - ${STATE_WORD[state].toLowerCase()}${summary.inferred ? ' (waiting for the first token)' : ''}. Open Mission Control.`
        : 'Open Mission Control';
      return h(Fragment, null,
        h('button', {type: 'button', ref: button, className: 'msn-chip', 'data-state': state, 'aria-haspopup': 'dialog', 'aria-expanded': open, title, onClick: () => setOpen(value => !value)},
          h('span', {className: 'msn-dot', 'aria-hidden': true}),
          h('span', {className: 'msn-chip-model'}, label),
          tracked ? h('span', {className: 'msn-chip-state'}, word) : null),
        open ? h(Sheet, {onClose: () => { setOpen(false); button.current?.focus(); }}) : null);
    };

    // ---- the sheet -------------------------------------------------------------------------------------------------------------
    const Sheet = ({onClose}) => {
      const s = useStore();
      const [, tick] = useState(0);
      const closeRef = useRef(null);
      useEffect(() => {
        void refreshSnapshot();
        const poll = setInterval(() => { void refreshSnapshot(); }, 2000);
        const clock = setInterval(() => tick(value => value + 1), 1000);
        const escape = event => { if (event.key === 'Escape') onClose(); };
        document.addEventListener('keydown', escape);
        closeRef.current?.focus();
        return () => { clearInterval(poll); clearInterval(clock); document.removeEventListener('keydown', escape); };
      }, []);
      const snap = s.snapshot;
      const overall = !snap ? 'idle' : (snap.models?.summary?.state ?? 'idle');
      return createPortal(h('div', {className: 'msn-scope msn-backdrop', onMouseDown: event => { if (event.target === event.currentTarget) onClose(); }},
        h('section', {className: 'msn-sheet', role: 'dialog', 'aria-modal': 'true', 'aria-labelledby': 'msn-title'},
          h('header', {className: 'msn-head'},
            h('span', {className: 'msn-dot', 'data-state': overall, 'aria-hidden': true}),
            h('h2', {id: 'msn-title', className: 'msn-title'}, 'Mission Control'),
            h('span', {className: 'msn-meta'}, 'This computer'),
            h('button', {type: 'button', ref: closeRef, className: 'msn-close', 'aria-label': 'Close Mission Control', onClick: onClose}, '×')),
          !snap
            ? h('p', {className: 'msn-empty', role: 'status'}, s.error ? `Mission Control could not be read: ${s.error}` : 'Reading this computer…')
            : h('div', {className: 'msn-body'},
              h(ModelsPanel, {snap}),
              h(MachinePanel, {snap}),
              h(ActivityPanel, {snap}),
              h(EnergyPanel, {snap}),
              h(StopwatchPanel, {snap, offset: s.offset}),
              h(SwapPanel, {snap})))), document.body);
    };

    const Panel = ({id, title, aside, children}) => h('section', {className: 'msn-panel', 'aria-labelledby': `msn-h-${id}`},
      h('div', {className: 'msn-panel-head'}, h('h3', {id: `msn-h-${id}`, className: 'msn-h3'}, title), aside ? h('span', {className: 'msn-aside'}, aside) : null),
      h('div', {className: 'msn-panel-body'}, children));
    const Tile = ({label, value, note, tone}) => h('div', {className: 'msn-tile'},
      h('span', {className: 'msn-tile-value', 'data-tone': tone}, value), h('span', {className: 'msn-tile-label'}, label), note ? h('span', {className: 'msn-tile-note'}, note) : null);
    const Pill = ({state, children}) => h('span', {className: 'msn-pill', 'data-state': state}, h('span', {className: 'msn-dot', 'data-state': state, 'aria-hidden': true}), children);

    // ---- models on this GPU ------------------------------------------------------------------------------------------------------
    const ModelsPanel = ({snap}) => {
      const models = snap.models;
      const rows = models?.rows ?? [];
      const swappers = (models?.servers ?? []).filter(server => server.ok && ['lmstudio', 'ollama', 'llama-swap'].includes(server.provider));
      const waiting = models?.waitingMs ?? 0;
      const loadingNow = rows.filter(row => row.state === 'loading');
      return h(Panel, {id: 'models', title: 'Models', aside: models?.checkedAt ? 'read from your model server' : null},
        rows.length === 0 ? h('p', {className: 'msn-muted'}, models?.error ?? 'No model server is set up yet. Add one under Settings, Model roles.') : h('ul', {className: 'msn-models', role: 'list'},
          rows.map(row => {
            const detail = [];
            if (row.state === 'loaded') {
              const size = gib(row.vramBytes ?? row.sizeBytes);
              if (size) detail.push(`${size} in memory`);
              const left = row.expiresAt ? until(row.expiresAt) : null;
              if (left) detail.push(`unloads in ${left} if idle`);
              else if (row.ttlSeconds) detail.push(`unloads after ${Math.round(row.ttlSeconds / 60) || 1} min idle`);
            } else if (row.state === 'loading') detail.push(row.inferred ? `waiting for the first token${waiting ? ` (${seconds(waiting / 1000)})` : ''}` : 'loading now');
            else if (row.state === 'offline') detail.push(row.error ?? STATE_NOTE.offline);
            else if (STATE_NOTE[row.state]) detail.push(STATE_NOTE[row.state]);
            return h('li', {key: `${row.role}:${row.model}`, className: 'msn-model'},
              h('div', {className: 'msn-model-main'}, h('span', {className: 'msn-model-role'}, row.label), h('span', {className: 'msn-model-name', title: row.model}, row.model)),
              h(Pill, {state: row.state}, STATE_WORD[row.state] ?? row.state),
              h('div', {className: 'msn-model-sub'}, `${row.providerName}${detail.length ? ` · ${detail.join(' · ')}` : ''}`));
          })),
        loadingNow.length > 0 ? h('p', {className: 'msn-callout', role: 'status'}, 'A model is being loaded. The reply starts as soon as it is in memory; the harness waits for it.') : null,
        swappers.length > 0 && !snap.swap.enabled
          ? h('p', {className: 'msn-callout', 'data-tone': 'hint'}, 'Your models swap in and out of memory. Turn on “Wait for models to load” below so a slow load is waited for, not given up on.') : null,
        swappers.some(server => server.loaded.length > 1) ? h('p', {className: 'msn-muted'}, `In memory on ${swappers.filter(server => server.loaded.length > 1).map(server => server.providerName).join(', ')}: ${swappers.flatMap(server => server.loaded).map(model => shortModel(model.id)).join(', ')}.`) : null);
    };

    // ---- this computer -------------------------------------------------------------------------------------------------------------
    const Spark = ({rows, index, max, label, unit}) => {
      const points = rows.map((row, i) => [i, row[index]]).filter(point => Number.isFinite(point[1]));
      if (points.length < 2) return h('div', {className: 'msn-spark'}, h('div', {className: 'msn-spark-head'}, h('span', null, label), h('span', null, 'not available')));
      const top = max ?? Math.max(1, ...points.map(point => point[1]));
      const width = 160, height = 36, last = rows.length - 1 || 1;
      const path = points.map(([i, value], n) => `${n ? 'L' : 'M'}${(i / last * width).toFixed(1)} ${(height - 2 - value / top * (height - 4)).toFixed(1)}`).join(' ');
      const latest = points[points.length - 1][1];
      return h('div', {className: 'msn-spark'},
        h('div', {className: 'msn-spark-head'}, h('span', null, label), h('span', null, `${Math.round(latest)}${unit}`)),
        h('svg', {className: 'msn-spark-svg', viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'none', role: 'img', 'aria-label': `${label}, last ${Math.round(rows.length * 5 / 60)} minutes, now ${Math.round(latest)}${unit}`},
          h('path', {d: path, fill: 'none', stroke: 'currentColor', strokeWidth: 1.6, strokeLinejoin: 'round', strokeLinecap: 'round', vectorEffect: 'non-scaling-stroke'})));
    };
    const Meter = ({label, value, text, hot}) => h('div', {className: 'msn-meter-row'},
      h('span', null, label), h('span', {className: 'msn-meter', role: 'img', 'aria-label': `${label} ${text}`}, h('span', {className: 'msn-meter-fill', 'data-hot': hot ? 'true' : undefined, style: {width: `${Math.max(0, Math.min(100, value ?? 0))}%`}})), h('span', null, text));

    const MachinePanel = ({snap}) => {
      const {machine} = snap;
      const memoryPercent = machine.memory?.totalMiB ? machine.memory.usedMiB / machine.memory.totalMiB * 100 : null;
      const rows = machine.history ?? [];
      return h(Panel, {id: 'machine', title: 'This computer', aside: machine.gpus.length > 0 ? 'NVIDIA, read with nvidia-smi' : null},
        machine.gpus.length > 0 ? h('div', {className: 'msn-gpus'}, machine.gpus.map(gpu => h('div', {key: gpu.index, className: 'msn-gpu'},
          h('div', {className: 'msn-gpu-name'}, gpu.name),
          h(Meter, {label: 'GPU', value: gpu.util, text: gpu.util === null ? 'n/a' : `${Math.round(gpu.util)}%`, hot: gpu.util > 90}),
          h(Meter, {label: 'Memory', value: gpu.vramTotalMiB ? gpu.vramUsedMiB / gpu.vramTotalMiB * 100 : null,
            text: gpu.vramTotalMiB ? `${mib(gpu.vramUsedMiB)} of ${mib(gpu.vramTotalMiB)}` : 'n/a', hot: gpu.vramTotalMiB && gpu.vramUsedMiB / gpu.vramTotalMiB > 0.92}),
          h('div', {className: 'msn-gpu-facts'}, gpu.powerW === null ? 'power: not available' : `${Math.round(gpu.powerW)} W${gpu.powerLimitW ? ` of ${Math.round(gpu.powerLimitW)} W` : ''}`, gpu.tempC === null ? null : ` · ${Math.round(gpu.tempC)} °C`))))
          : h('p', {className: 'msn-muted'}, machine.gpuReason ?? 'Graphics card use is not available on this computer.'),
        h('div', {className: 'msn-gpu'},
          h(Meter, {label: 'Processor', value: machine.cpuPercent, text: machine.cpuPercent === null ? 'n/a' : `${machine.cpuPercent}%`, hot: machine.cpuPercent > 90}),
          h(Meter, {label: 'Memory', value: memoryPercent, text: machine.memory ? `${mib(machine.memory.usedMiB)} of ${mib(machine.memory.totalMiB)}` : 'n/a', hot: memoryPercent > 92})),
        rows.length > 1 ? h('div', {className: 'msn-sparks'},
          h(Spark, {rows, index: 1, max: 100, label: 'GPU use', unit: '%'}), h(Spark, {rows, index: 4, label: 'GPU power', unit: ' W'}),
          h(Spark, {rows, index: 2, label: 'GPU memory', unit: ' MB'}), h(Spark, {rows, index: 5, max: 100, label: 'Processor', unit: '%'})) : null);
    };

    // ---- tokens and speed ---------------------------------------------------------------------------------------------------------------
    const ActivityPanel = ({snap}) => {
      const {usage} = snap, today = usage.today, session = usage.session;
      return h(Panel, {id: 'activity', title: 'Tokens and speed', aside: usage.busyNow ? 'working now' : null},
        usage.waitingMs >= 1500 ? h('p', {className: 'msn-callout', role: 'status'}, `Waiting ${seconds(usage.waitingMs / 1000)} for the first token. After a model swap this is the load time.`) : null,
        h('div', {className: 'msn-tiles'},
          h(Tile, {label: 'Tokens today', value: int(today.totalTokens), note: `${int(today.inputTokens)} in · ${int(today.outputTokens)} out`}),
          h(Tile, {label: 'Requests today', value: int(today.requests), note: `${int(usage.week.requests)} this week`}),
          h(Tile, {label: 'Speed', value: today.tokensPerSecond === null ? '-' : `${one(today.tokensPerSecond)} tok/s`, note: 'while writing a reply'}),
          h(Tile, {label: 'First token', value: seconds(today.firstTokenSeconds), note: today.slowestFirstTokenSeconds === null ? null : `slowest ${seconds(today.slowestFirstTokenSeconds)}`}),
          h(Tile, {label: 'Model loads waited for', value: int(today.slowStarts), note: 'first token over 15 s'}),
          h(Tile, {label: 'Since Atelier started', value: int(session.totalTokens), note: `${int(session.requests)} requests`})),
        h('p', {className: 'msn-muted'}, 'Counts come from the harness itself: tokens each model reply reported, and the time to its first token. No text is stored.'));
    };

    // ---- energy and cost ---------------------------------------------------------------------------------------------------------------------
    const EnergyPanel = ({snap}) => {
      const {energy, prefs, currencies} = snap;
      const [price, setPrice] = useState(prefs.pricePerKwh === null ? '' : String(prefs.pricePerKwh));
      const [currency, setCurrency] = useState(prefs.currency);
      const [watts, setWatts] = useState(prefs.estimatedWatts === null ? '' : String(prefs.estimatedWatts));
      const [message, setMessage] = useState('');
      const [dirty, setDirty] = useState(false);
      const typical = (currencies.find(entry => entry.code === currency)?.price ?? 0.15);
      const save = async event => {
        event.preventDefault();
        try {
          await call('prefs', {currency, pricePerKwh: price.trim() === '' ? null : Number(price), estimatedWatts: watts.trim() === '' ? null : Number(watts)});
          setMessage('Saved.'); setDirty(false); await refreshSnapshot();
        } catch (error) { setMessage(error.message); }
      };
      const shown = (label, summary) => summary ? h(Tile, {label, value: energyText(summary.wh), note: `${money(summary.cost, summary.currency)}${summary.source === 'estimate' ? ' (estimate)' : summary.source === 'mixed' ? ' (partly estimated)' : ''}`}) : null;
      return h(Panel, {id: 'energy', title: 'Energy and cost', aside: energy.basis === 'measured' ? 'measured' : energy.basis === 'estimate' ? 'estimate' : 'no power reading'},
        h('div', {className: 'msn-tiles'}, shown('Today', energy.today), shown('Since Atelier started', energy.session), snap.stopwatch.status === 'running' ? shown('Stopwatch run', energy.stopwatch) : null),
        h('p', {className: 'msn-muted'}, energy.coverage),
        h('form', {className: 'msn-form', onSubmit: save},
          h('label', {className: 'msn-field'}, h('span', null, 'Currency'),
            h('select', {value: currency, onChange: event => { setCurrency(event.target.value); setDirty(true); setMessage(''); }}, currencies.map(entry => h('option', {key: entry.code, value: entry.code}, `${entry.code} - ${entry.name}`)))),
          h('label', {className: 'msn-field'}, h('span', null, `Price per kWh (${currency})`),
            h('input', {type: 'number', inputMode: 'decimal', min: 0, step: 'any', value: price, placeholder: `typical ${typical}`, onChange: event => { setPrice(event.target.value); setDirty(true); setMessage(''); }})),
          h('label', {className: 'msn-field'}, h('span', null, 'Power if the card cannot report it (W)'),
            h('input', {type: 'number', inputMode: 'decimal', min: 0, step: 'any', value: watts, placeholder: 'optional', onChange: event => { setWatts(event.target.value); setDirty(true); setMessage(''); }})),
          h('div', {className: 'msn-form-row'}, h('button', {type: 'submit', className: 'msn-button', disabled: !dirty}, 'Save'),
            h('span', {className: 'msn-form-message', role: 'status'}, message || (prefs.priceIsDefault ? `Using a typical ${prefs.currency} price (${prefs.price} per kWh). Enter the rate on your electricity bill.` : '')))));
    };

    // ---- stopwatch ----------------------------------------------------------------------------------------------------------------------------------
    const csvOf = history => {
      const cell = value => `"${String(value).replace(/"/g, '""')}"`;
      const rows = [['run', 'started', 'seconds', 'requests', 'input_tokens', 'output_tokens', 'energy_wh', 'energy_source', 'cost', 'currency']];
      for (const run of history) rows.push([run.id, new Date(run.startedAt).toISOString(), (run.wallMs / 1000).toFixed(1), run.usage.requests, run.usage.inputTokens, run.usage.outputTokens, run.energy.wh.toFixed(3), run.energy.source, run.energy.cost.toFixed(5), run.energy.currency]);
      return rows.map(row => row.map(cell).join(',')).join('\r\n');
    };
    const StopwatchPanel = ({snap, offset}) => {
      const {stopwatch, history, energy} = snap;
      const running = stopwatch.status === 'running';
      const elapsed = running ? Date.now() + offset - stopwatch.startedAt : 0;
      const act = async action => { try { await call('stopwatch', {action}); await refreshSnapshot(); } catch { /* the next refresh shows the state */ } };
      const download = () => {
        const url = URL.createObjectURL(new Blob([csvOf(history)], {type: 'text/csv'}));
        const link = document.createElement('a'); link.href = url; link.download = 'atelier-mission-runs.csv'; link.click();
        setTimeout(() => URL.revokeObjectURL(url), 2000);
      };
      return h(Panel, {id: 'stopwatch', title: 'Stopwatch', aside: running ? 'running' : null},
        h('div', {className: 'msn-clock', 'aria-live': 'off'}, duration(elapsed)),
        h('div', {className: 'msn-buttons'},
          h('button', {type: 'button', className: 'msn-button', disabled: running, onClick: () => act('start')}, 'Start'),
          h('button', {type: 'button', className: 'msn-button', disabled: !running, onClick: () => act('lap')}, 'Lap'),
          h('button', {type: 'button', className: 'msn-button', disabled: !running, onClick: () => act('stop')}, 'Stop'),
          h('button', {type: 'button', className: 'msn-button', disabled: !running && history.length === 0 && stopwatch.laps.length === 0, onClick: () => act(running ? 'reset' : 'clear-history')}, running ? 'Reset' : 'Clear')),
        stopwatch.live ? h('div', {className: 'msn-tiles'},
          h(Tile, {label: 'Tokens', value: int(stopwatch.live.usage.totalTokens), note: `${int(stopwatch.live.usage.requests)} requests`}),
          h(Tile, {label: 'Energy', value: energyText(energy.stopwatch?.wh), note: energy.stopwatch ? money(energy.stopwatch.cost, energy.stopwatch.currency) : null}),
          h(Tile, {label: 'Speed', value: stopwatch.live.usage.tokensPerSecond === null ? '-' : `${one(stopwatch.live.usage.tokensPerSecond)} tok/s`})) : null,
        stopwatch.laps.length > 0 ? h('ul', {className: 'msn-list', role: 'list', 'aria-label': 'Laps'}, stopwatch.laps.map(lap => h('li', {key: lap.index},
          h('span', null, `Lap ${lap.index}`), h('span', null, duration(lap.wallMs)), h('span', null, `${int(lap.usage.inputTokens + lap.usage.outputTokens)} tokens`)))) : null,
        history.length > 0 ? h(Fragment, null,
          h('h4', {className: 'msn-h4'}, 'Earlier runs'),
          h('ul', {className: 'msn-list', role: 'list'}, history.slice(0, 5).map(run => h('li', {key: run.id},
            h('span', null, new Date(run.startedAt).toLocaleString([], {month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit'})),
            h('span', null, `${duration(run.wallMs)} · ${int(run.usage.inputTokens + run.usage.outputTokens)} tokens`),
            h('span', null, `${energyText(run.energy.wh)} · ${money(run.energy.cost, run.energy.currency)}${run.energy.source === 'estimate' ? ' est.' : ''}`)))),
          h('button', {type: 'button', className: 'msn-button msn-button-quiet', onClick: download}, 'Download runs as CSV')) : null);
    };

    // ---- wait for models to load ------------------------------------------------------------------------------------------------------------------------
    const SwapPanel = ({snap}) => {
      const {swap} = snap;
      const [wait, setWait] = useState(Math.round(swap.waitSeconds / 60));
      const [busy, setBusy] = useState(false);
      const [message, setMessage] = useState('');
      const apply = async enabled => {
        setBusy(true); setMessage('');
        try {
          const result = await call('swap', {enabled, waitSeconds: Math.max(1, Number(wait) || 15) * 60});
          setMessage(enabled
            ? (result.hasSettings ? `On. Applies to your next message${result.routes.length ? ` for ${result.routes.join(', ')}` : ''}.` : 'On for this session. Model settings are not available in this mode.')
            : 'Off. The harness timers are back to their defaults.');
          await refreshSnapshot();
        } catch (error) { setMessage(error.message); } finally { setBusy(false); }
      };
      return h(Panel, {id: 'swap', title: 'Wait for models to load', aside: swap.enabled ? 'on' : 'off'},
        h('p', {className: 'msn-muted'}, 'For one graphics card that cannot hold every model at once. LM Studio, Ollama and llama-swap load a model the first time it is asked for. This makes the harness wait for that load, up to the time below, instead of giving up after five minutes. Only models on this computer or your own network are affected.'),
        h('div', {className: 'msn-form-row'},
          h('label', {className: 'msn-field msn-field-inline'}, h('span', null, 'Wait up to (minutes)'),
            h('input', {type: 'number', min: 1, max: 60, step: 1, value: wait, onChange: event => setWait(event.target.value)})),
          swap.enabled ? h('button', {type: 'button', className: 'msn-button', disabled: busy, onClick: () => apply(true)}, 'Update') : null,
          h('button', {type: 'button', className: 'msn-button msn-button-primary', disabled: busy, 'aria-pressed': swap.enabled, onClick: () => apply(!swap.enabled)}, swap.enabled ? 'Turn off' : 'Turn on')),
        h('p', {className: 'msn-form-message', role: 'status'}, message || (swap.enabled ? `On: waits up to ${Math.round(swap.waitSeconds / 60)} min${swap.routes.length ? `, set for ${swap.routes.join(', ')}` : ''}.` : '')));
    };

    ctx.slots.inject('conversation.session.header.utilities', () => ctx.slots.register({name: 'conversation.session.header.utilities', id: 'atelier-mission', order: 70}, Chip));

    if (typeof document !== 'undefined' && !document.getElementById('atelier-mission-style')) {
      const style = document.createElement('style');
      style.id = 'atelier-mission-style';
      style.textContent = CSS;
      document.head.appendChild(style);
      ctx.on?.('dispose', () => style.remove());
    }
  };

  // Colours come from the app's own design tokens, with fallbacks; state is always also written as a word.
  const CSS = `
.msn-chip, .msn-scope {
  --msn-ink: var(--dsw-alias-label-primary, #eceae6);
  --msn-ink-2: var(--dsw-alias-label-secondary, #a7afc0);
  --msn-ink-3: var(--dsw-alias-label-tertiary, #8791a5);
  --msn-rule: var(--dsw-alias-border-l2, #303746);
  --msn-bg: var(--dsw-alias-bg-layer-1, #171c26);
  --msn-bg-2: var(--dsw-alias-bg-layer-2, #1d2330);
  --msn-hover: var(--dsw-alias-interactive-bg-hover, #252b38);
  --msn-accent: #a8683a;
  --msn-ok: #1f7a4a;
  --msn-warn: #a15c00;
  --msn-bad: #b3261e;
  --msn-focus: var(--dsw-alias-label-primary, #eceae6);
}
body[data-ds-dark-theme] .msn-chip, body[data-ds-dark-theme] .msn-scope { --msn-accent: #d39a66; --msn-ok: #7fc79a; --msn-warn: #f0b545; --msn-bad: #f07878; }

.msn-chip {
  appearance: none; display: inline-flex; align-items: center; gap: 8px; min-height: 32px; max-width: 260px; padding: 0 12px;
  border: 1px solid var(--msn-rule); border-radius: 16px; background: transparent; color: var(--msn-ink); font: inherit; font-size: 13px; cursor: pointer;
}
.msn-chip:hover { background: var(--msn-hover); }
.msn-chip:focus-visible, .msn-scope button:focus-visible, .msn-scope input:focus-visible, .msn-scope select:focus-visible { outline: 2px solid var(--msn-focus); outline-offset: 2px; }
.msn-chip[aria-expanded="true"] { background: var(--dsw-alias-interactive-bg-active, var(--msn-hover)); }
.msn-chip-model { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.msn-chip-state { color: var(--msn-ink-2); white-space: nowrap; }
@media (max-width: 760px) { .msn-chip-state { display: none; } .msn-chip { max-width: 150px; } }
@media (max-width: 480px) { .msn-chip { max-width: 120px; padding: 0 10px; } }

.msn-dot { flex: none; width: 8px; height: 8px; border-radius: 50%; background: var(--msn-ink-3); }
[data-state="loaded"] > .msn-dot, .msn-dot[data-state="loaded"] { background: var(--msn-ok); }
[data-state="loading"] > .msn-dot, .msn-dot[data-state="loading"], [data-state="unloading"] > .msn-dot, .msn-dot[data-state="unloading"] { background: var(--msn-warn); animation: msn-pulse 1.4s ease-in-out infinite; }
[data-state="offline"] > .msn-dot, .msn-dot[data-state="offline"] { background: var(--msn-bad); }
[data-state="unknown"] > .msn-dot, .msn-dot[data-state="unknown"] { background: transparent; box-shadow: inset 0 0 0 1.5px var(--msn-ink-3); }
@keyframes msn-pulse { 50% { opacity: 0.35; } }
@media (prefers-reduced-motion: reduce) { .msn-dot { animation: none !important; } }

.msn-backdrop { position: fixed; inset: 0; z-index: 900; display: flex; justify-content: flex-end; background: color-mix(in srgb, var(--dsw-alias-bg-base, #11151d) 50%, transparent); color: var(--msn-ink); }
.msn-sheet {
  width: min(580px, 100vw); height: 100%; display: flex; flex-direction: column; min-height: 0; background: var(--msn-bg); border-left: 1px solid var(--msn-rule);
  box-shadow: -18px 0 48px rgb(0 0 0 / 28%); animation: msn-slide 160ms ease-out; font-size: 13px; line-height: 20px;
}
@keyframes msn-slide { from { transform: translateX(24px); opacity: 0; } }
@media (prefers-reduced-motion: reduce) { .msn-sheet { animation: none; } }
.msn-head { flex: none; display: flex; align-items: center; gap: 10px; padding: 12px 16px; border-bottom: 1px solid var(--msn-rule); }
.msn-title { margin: 0; font-size: 15px; line-height: 22px; font-weight: 600; }
.msn-meta { margin-left: auto; color: var(--msn-ink-3); font-size: 12px; }
.msn-close { appearance: none; width: 36px; height: 36px; border: 0; border-radius: 8px; background: transparent; color: var(--msn-ink-2); font-size: 22px; line-height: 1; cursor: pointer; }
.msn-close:hover { background: var(--msn-hover); color: var(--msn-ink); }
.msn-empty { margin: 0; padding: 24px 16px; color: var(--msn-ink-2); }
.msn-body { flex: 1; overflow: auto; padding: 12px 16px 32px; display: flex; flex-direction: column; gap: 12px; overscroll-behavior: contain; }

.msn-panel { flex: none; border: 1px solid var(--msn-rule); border-radius: 11px; background: var(--msn-bg-2); }
.msn-panel-head { display: flex; align-items: baseline; justify-content: space-between; gap: 12px; padding: 10px 12px 0; }
.msn-h3 { margin: 0; font-size: 13px; line-height: 20px; font-weight: 600; }
.msn-aside { font-size: 12px; color: var(--msn-ink-3); }
.msn-panel-body { display: flex; flex-direction: column; gap: 10px; padding: 8px 12px 12px; }
.msn-muted { margin: 0; font-size: 12px; line-height: 18px; color: var(--msn-ink-3); }
.msn-callout { margin: 0; padding: 8px 10px; border-radius: 8px; border-left: 3px solid var(--msn-warn); background: var(--msn-bg); font-size: 12px; line-height: 18px; }
.msn-callout[data-tone="hint"] { border-left-color: var(--msn-accent); }
.msn-h4 { margin: 4px 0 0; font-size: 12px; font-weight: 600; color: var(--msn-ink-2); }

.msn-models { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.msn-model { display: grid; grid-template-columns: minmax(0, 1fr) auto; gap: 2px 12px; align-items: center; padding: 8px 0; border-bottom: 1px solid var(--msn-rule); }
.msn-model:last-child { border-bottom: 0; }
.msn-model-main { display: flex; flex-direction: column; min-width: 0; }
.msn-model-role { font-size: 11px; line-height: 16px; color: var(--msn-ink-3); }
.msn-model-name { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; font-weight: 550; }
.msn-model-sub { grid-column: 1 / -1; font-size: 12px; line-height: 18px; color: var(--msn-ink-2); overflow-wrap: anywhere; }
.msn-pill { display: inline-flex; align-items: center; gap: 6px; min-height: 24px; padding: 0 9px; border: 1px solid var(--msn-rule); border-radius: 999px; font-size: 12px; white-space: nowrap; }

.msn-tiles { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); gap: 8px; }
.msn-tile { display: flex; flex-direction: column; gap: 1px; min-width: 0; padding: 9px 10px; border: 1px solid var(--msn-rule); border-radius: 9px; background: var(--msn-bg); }
.msn-tile-value { font-size: 16px; line-height: 22px; font-weight: 600; font-variant-numeric: tabular-nums; overflow-wrap: anywhere; }
.msn-tile-label { font-size: 11px; line-height: 16px; color: var(--msn-ink-2); }
.msn-tile-note { font-size: 11px; line-height: 16px; color: var(--msn-ink-3); }

.msn-gpus { display: flex; flex-direction: column; gap: 10px; }
.msn-gpu { display: flex; flex-direction: column; gap: 6px; }
.msn-gpu-name { font-weight: 550; }
.msn-gpu-facts { font-size: 12px; color: var(--msn-ink-3); font-variant-numeric: tabular-nums; }
.msn-meter-row { display: grid; grid-template-columns: 72px minmax(0, 1fr) auto; gap: 10px; align-items: center; font-size: 12px; color: var(--msn-ink-2); font-variant-numeric: tabular-nums; }
.msn-meter { display: block; height: 7px; border-radius: 999px; background: var(--dsw-alias-bg-layer-3, color-mix(in srgb, var(--msn-ink-3) 28%, transparent)); overflow: hidden; }
.msn-meter-fill { display: block; height: 100%; border-radius: 999px; background: var(--msn-accent); transition: width 400ms ease; }
.msn-meter-fill[data-hot="true"] { background: var(--msn-warn); }
.msn-sparks { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
.msn-spark { display: flex; flex-direction: column; gap: 2px; padding: 7px 9px; border: 1px solid var(--msn-rule); border-radius: 9px; background: var(--msn-bg); color: var(--msn-accent); }
.msn-spark-head { display: flex; justify-content: space-between; gap: 6px; font-size: 11px; color: var(--msn-ink-3); }
.msn-spark-svg { width: 100%; height: 34px; display: block; }

.msn-form { display: flex; flex-direction: column; gap: 10px; padding-top: 4px; border-top: 1px solid var(--msn-rule); }
.msn-field { display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: var(--msn-ink-2); }
.msn-field input, .msn-field select {
  box-sizing: border-box; width: 100%; min-height: 36px; padding: 6px 9px; border: 1px solid var(--msn-rule); border-radius: 8px;
  background: var(--dsw-alias-bg-base, var(--msn-bg)); color: var(--msn-ink); font: inherit; font-size: 13px;
}
.msn-field-inline { flex-direction: row; align-items: center; gap: 8px; }
.msn-field-inline input { width: 72px; }
.msn-form-row { display: flex; flex-wrap: wrap; align-items: center; gap: 8px 12px; }
.msn-form-message { margin: 0; font-size: 12px; line-height: 18px; color: var(--msn-ink-2); flex: 1 1 200px; }
.msn-button { appearance: none; min-height: 36px; padding: 0 14px; border: 1px solid var(--msn-rule); border-radius: 8px; background: var(--msn-bg); color: var(--msn-ink); font: inherit; font-size: 13px; cursor: pointer; }
.msn-button:hover:not(:disabled) { background: var(--msn-hover); }
.msn-button:disabled { opacity: 0.45; cursor: not-allowed; }
.msn-button-primary { border-color: var(--msn-accent); }
.msn-button-quiet { align-self: flex-start; color: var(--msn-ink-2); }
.msn-clock { font-size: 30px; line-height: 36px; font-weight: 600; font-variant-numeric: tabular-nums; letter-spacing: 0.02em; }
.msn-buttons { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 8px; }
.msn-list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; }
.msn-list > li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto; gap: 12px; padding: 5px 0; border-bottom: 1px solid var(--msn-rule); font-size: 12px; color: var(--msn-ink-2); font-variant-numeric: tabular-nums; }
.msn-list > li:last-child { border-bottom: 0; }
.msn-list > li > :nth-child(2) { text-align: right; }
.msn-list > li > :last-child { text-align: right; }

@media (max-width: 560px) {
  .msn-body { padding-left: 10px; padding-right: 10px; }
  .msn-tiles { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .msn-sparks { grid-template-columns: minmax(0, 1fr); }
  .msn-buttons { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .msn-meter-row { grid-template-columns: 62px minmax(0, 1fr) auto; }
}
`;
  return exports;
}});
