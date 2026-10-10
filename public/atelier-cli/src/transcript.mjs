// Turns the web app's session journal (session/follow: a snapshot, then one event at a time) into a transcript the
// terminal can draw: user turns, assistant text and reasoning, tool steps with their results, usage and status.
// Pure and synchronous, so the TUI, `atelier chat` and the tests share it.

const textOf = content => (Array.isArray(content) ? content : [])
  .map(part => part?.type === 'text' ? part.text : part?.type === 'image' ? `[image${part.name ? ` ${part.name}` : ''}]` : '')
  .join('');

/** Short single-line preview of a tool's JSON arguments. */
export function summarizeArgs(raw, max = 80) {
  let value = raw;
  if (typeof raw === 'string') { try { value = JSON.parse(raw); } catch { value = raw; } }
  let text;
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    text = Object.entries(value).slice(0, 4).map(([k, v]) => `${k}: ${typeof v === 'string' ? v : JSON.stringify(v)}`).join(', ');
  } else text = typeof value === 'string' ? value : JSON.stringify(value ?? '');
  text = text.replace(/\s+/g, ' ').trim();
  return text.length > max ? `${text.slice(0, max - 1)}…` : text;
}

export function createTranscript() {
  return {
    title: null, running: false, provider: null, model: null, preset: null, cursor: 0,
    items: [],          // {kind:'user', text, id} | {kind:'assistant', key, reasoning, text, final} | {kind:'tool', id, name, args, result, isError, done}
    usage: {inputTokens: 0, outputTokens: 0}, lastUsage: null,
    stepStartedAt: null, stepOutputChars: 0, speed: null,   // characters per second of the last step, a cheap tokens/s stand-in
    turnEnd: null, error: null,
  };
}

const assistantKey = (turn, step) => `${turn}:${step}`;

function assistantItem(t, turn, step) {
  const key = assistantKey(turn, step);
  let item = t.items.findLast(i => i.kind === 'assistant' && i.key === key);
  if (!item) { item = {kind: 'assistant', key, reasoning: '', text: '', final: false}; t.items.push(item); }
  return item;
}

function toolItem(t, id, name) {
  let item = t.items.findLast(i => i.kind === 'tool' && i.id === id);
  if (!item) { item = {kind: 'tool', id, name: name ?? 'tool', args: '', result: '', isError: false, done: false}; t.items.push(item); }
  else if (name && item.name === 'tool') item.name = name;
  return item;
}

/** Apply one journal event (the `event` of a follow item or snapshot record). Returns the transcript. */
export function applyEvent(t, event) {
  if (!event?.type) return t;
  if (typeof event.seq === 'number') t.cursor = Math.max(t.cursor, event.seq);
  const d = event.data ?? {};
  switch (event.type) {
    case 'turn/start': t.running = true; t.turnEnd = null; t.error = null; break;
    case 'turn/end':
      t.running = false; t.turnEnd = d.reason ?? {kind: 'completed'};
      if (d.reason?.kind === 'error') t.error = d.reason.message ?? d.reason.error?.message ?? 'The model request failed.';
      break;
    case 'step/start': t.stepStartedAt = event.time ?? Date.now(); t.stepOutputChars = 0; break;
    case 'user/message':
      // Only what a person typed: the harness also injects reminders as user messages, with a non-user source.
      if (d.source?.kind === 'user') t.items.push({kind: 'user', id: d.id, text: textOf(d.content)});
      break;
    case 'session/title': t.title = d.title ?? t.title; break;
    case 'request/header': t.provider = d.header?.config?.provider ?? t.provider; t.model = d.header?.config?.model ?? t.model; break;
    case 'request/context': t.provider = d.provider ?? t.provider; t.model = d.model ?? t.model; t.contextWindow = d.contextWindow; break;
    case 'assistant/chunk': {
      const chunk = d.chunk ?? {};
      if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta') {
        const item = assistantItem(t, d.turn, d.step);
        if (item.final) break;
        if (chunk.type === 'text-delta') item.text += chunk.text ?? ''; else item.reasoning += chunk.text ?? '';
        t.stepOutputChars += (chunk.text ?? '').length;
        if (t.stepStartedAt && event.time) {
          const seconds = (event.time - t.stepStartedAt) / 1000;
          if (seconds > 0.5) t.speed = t.stepOutputChars / 4 / seconds;   // about four characters per token
        }
      } else if (chunk.type === 'tool-call-delta') {
        const item = toolItem(t, chunk.id, chunk.name);
        if (!item.done) item.args += chunk.argumentsDelta ?? '';
      } else if (chunk.type === 'usage') {
        t.lastUsage = chunk.usage;
      }
      break;
    }
    case 'assistant/message': {
      const item = assistantItem(t, d.turn, d.step);
      const content = d.message?.content ?? [];
      item.text = content.filter(b => b.type === 'text').map(b => b.text).join('');
      item.reasoning = content.filter(b => b.type === 'reasoning').map(b => b.text).join('');
      item.final = true; item.interrupted = d.interrupted === true;
      for (const block of content.filter(b => b.type === 'tool-call')) {
        const tool = toolItem(t, block.id, block.name);
        tool.args = typeof block.arguments === 'string' ? block.arguments : JSON.stringify(block.arguments ?? {});
      }
      if (d.usage) {
        t.lastUsage = d.usage;
        t.usage = {inputTokens: d.usage.inputTokens ?? t.usage.inputTokens, outputTokens: t.usage.outputTokens + (d.usage.outputTokens ?? 0)};
      }
      break;
    }
    case 'tool/call': {
      const tool = toolItem(t, d.callId, d.name);
      if (typeof d.arguments === 'string') tool.args = d.arguments;
      break;
    }
    case 'tool/result': {
      for (const part of d.message?.content ?? []) {
        if (part.type !== 'tool-result') continue;
        const tool = toolItem(t, part.toolCallId);
        tool.result = textOf(part.content) || (part.content?.length ? '[non-text result]' : '');
        tool.isError = part.isError === true || Boolean(d.error);
        tool.done = true;
      }
      break;
    }
    default: break;
  }
  return t;
}

/** Expand a packed chunk row from a snapshot into the assistant/chunk events it stands for. */
export function expandChunkRow(row) {
  const d = row?.data ?? {};
  const kind = row?.type;
  const times = [];
  let time = row?.time ?? 0;
  for (const dt of d.dt ?? []) { time += dt; times.push(time); }
  if (kind === 'chunkrow/text-chunks' || kind === 'chunkrow/reasoning-chunks') {
    const type = kind === 'chunkrow/text-chunks' ? 'text-delta' : 'reasoning-delta';
    return (d.texts ?? []).map((text, i) => ({type: 'assistant/chunk', time: times[i] ?? row.time, data: {turn: d.turn, step: d.step, chunk: {type, index: d.index, text}}}));
  }
  if (kind === 'chunkrow/tool-call-chunks') {
    return (d.args ?? []).map((argumentsDelta, i) => ({type: 'assistant/chunk', time: times[i] ?? row.time,
      data: {turn: d.turn, step: d.step, chunk: {type: 'tool-call-delta', index: d.index, id: d.id, name: i === 0 ? d.name : undefined, argumentsDelta}}}));
  }
  return [];
}

/** Apply one session/follow item (snapshot or event). */
export function applyFollowItem(t, item) {
  if (item?.type === 'snapshot') {
    for (const record of item.records ?? []) {
      if (record.type === 'chunks') for (const event of expandChunkRow(record.event)) applyEvent(t, event);
      else applyEvent(t, record.event);
    }
    const p = item.projections?.values ?? {};
    if (typeof p.title === 'string') t.title = p.title;
    if (typeof p.agentPreset === 'string') t.preset = p.agentPreset;
    if (typeof item.cursor === 'number') t.cursor = item.cursor;
    t.snapshotLoaded = true;
    t.hasMore = item.hasMore === true;
    return t;
  }
  if (item?.type === 'event') return applyEvent(t, item.event);
  return t;
}

/** The final answer text of the last assistant step, for `atelier chat`. */
export function lastAnswer(t) {
  const answers = t.items.filter(i => i.kind === 'assistant' && i.text.trim());
  return answers.at(-1)?.text.replace(/^\s+/, '') ?? '';
}

/** Render a transcript as Markdown (for `sessions export --format md` and /export). */
export function transcriptToMarkdown(t, {id} = {}) {
  const lines = [`# ${t.title || 'Atelier chat'}`, ''];
  if (id) lines.push(`Session \`${id}\`${t.model ? ` · ${t.model}` : ''}${t.preset ? ` · ${t.preset}` : ''}`, '');
  for (const item of t.items) {
    if (item.kind === 'user') lines.push('## You', '', item.text.trim(), '');
    else if (item.kind === 'assistant' && item.text.trim()) lines.push('## Vitruvius', '', item.text.trim(), '');
    else if (item.kind === 'tool') lines.push(`> Step: \`${item.name}\` ${summarizeArgs(item.args)}${item.isError ? ' (failed)' : ''}`, '');
  }
  return `${lines.join('\n').trim()}\n\n---\nExported from Atelier by ARCITECH.\n`;
}
