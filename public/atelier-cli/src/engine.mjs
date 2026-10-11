// One conversation with the web app's engine: create or open a chat, follow it live, send prompts and files, stop a
// turn, answer approvals and questions. Used by the TUI and by `atelier chat`.
import {randomUUID} from 'node:crypto';
import {readFileSync, statSync} from 'node:fs';
import {basename, extname, resolve} from 'node:path';
import {applyFollowItem, createTranscript} from './transcript.mjs';

const IMAGE_TYPES = {'.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.gif': 'image/gif'};
const MAX_IMAGE_BYTES = 20 * 1024 * 1024;

/**
 * Prompt content for a text and attached files. Images travel inline (as the web composer sends them); other files
 * are named by their full path, which Vitruvius reads with its file tools, as in the web app.
 */
export function buildContent(text, attachments = [], cwd = process.cwd()) {
  const images = [], references = [];
  for (const file of attachments) {
    const path = resolve(cwd, file);
    const stat = statSync(path, {throwIfNoEntry: false});
    if (!stat?.isFile()) throw Error(`Cannot attach ${file}: no such file.`);
    const mediaType = IMAGE_TYPES[extname(path).toLowerCase()];
    if (mediaType) {
      if (stat.size > MAX_IMAGE_BYTES) throw Error(`Cannot attach ${file}: images up to 20 MB.`);
      images.push({type: 'image', mediaType, data: readFileSync(path).toString('base64'), name: basename(path)});
    } else references.push(path);
  }
  const lead = references.length ? `${references.map(p => `Attached file: ${p}`).join('\n')}\n\n` : '';
  const body = `${lead}${text}`.trim();
  return [...images, ...body ? [{type: 'text', text: body}] : []];
}

const clientTimeZone = () => {
  const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return zone === 'UTC' || /^[A-Za-z_]+\/[A-Za-z0-9_+\-/]+$/.test(zone ?? '') ? zone : undefined;
};

export class Conversation {
  /**
   * @param {import('./server.mjs').AtelierClient} client
   * @param {{onUpdate?: (t) => void, onApproval?: (req) => Promise<'allowed-once'|'rejected'|undefined>,
   *   onQuestion?: (req) => Promise<object|undefined>, onError?: (e: Error) => void}} handlers
   */
  constructor(client, handlers = {}) {
    this.client = client; this.handlers = handlers;
    this.sessionId = undefined; this.transcript = createTranscript();
    this.follow = undefined; this.events = undefined; this.clientId = undefined;
  }

  /** Listen for approvals and questions addressed to any chat; answer only those for this conversation. */
  async listen() {
    this.events = await this.client.open('$events', {});
    (async () => {
      for await (const frame of this.events) {
        if (frame.type === 'ready') { this.clientId = frame.clientId; continue; }
        if (frame.type === 'emit') this.handlers.onEvent?.(frame);
        if (frame.type === 'emit' && frame.event === 'api-session/status' && frame.args?.[0] === this.sessionId) {
          this.transcript.running = frame.args[1] === true; this.handlers.onUpdate?.(this.transcript);
        }
        if (frame.type !== 'waterfall') continue;
        const mine = !frame.agentId || frame.agentId === this.sessionId;
        let outcome = {kind: 'next'};
        try {
          if (mine && frame.event === 'approval/request' && this.handlers.onApproval) {
            const value = await this.handlers.onApproval(frame.request ?? {});
            if (value) outcome = {kind: 'result', value};
          } else if (mine && frame.event === 'user-questions/request' && this.handlers.onQuestion) {
            const value = await this.handlers.onQuestion(frame.request ?? {});
            if (value) outcome = {kind: 'result', value};
          }
        } catch { /* fall through to next */ }
        await this.client.call('$events/result', {clientId: this.clientId, eventId: frame.eventId, outcome}).catch(() => {});
      }
    })().catch(error => this.handlers.onError?.(error));
  }

  async create({cwd = process.cwd(), preset} = {}) {
    let created;
    try { created = await this.client.call('session/create', {request: {cwd, ...preset ? {agentPreset: preset} : {}}}); }
    catch (error) {
      if (error.code === 'agent-preset-not-found') throw Error(`No profile "${preset}" here. Available: ${(error.details?.available ?? []).join(', ')}.`);
      throw error;
    }
    await this.open(created.sessionId);
    if (created.agentPreset) this.transcript.preset = created.agentPreset;
    return created.sessionId;
  }

  /** Follow a chat: the snapshot arrives first, then every new event. Resolves once the snapshot is in. */
  async open(sessionId, {maxMessages = 200} = {}) {
    this.follow?.cancel();
    this.sessionId = sessionId; this.transcript = createTranscript();
    const stream = await this.client.open('session/follow', {request: {address: {kind: 'session', sessionId}, maxMessages}});
    this.follow = stream;
    let firstResolve, firstReject;
    const first = new Promise((res, rej) => { firstResolve = res; firstReject = rej; });
    (async () => {
      for await (const item of stream) {
        if (this.follow !== stream) return;
        applyFollowItem(this.transcript, item);
        if (item.type === 'snapshot') firstResolve();
        this.handlers.onUpdate?.(this.transcript);
      }
    })().catch(error => { firstReject(error); if (error.code !== 'closed' || this.follow === stream) this.handlers.onError?.(error); });
    await first;
    return this.transcript;
  }

  async prompt(text, attachments = [], {cwd} = {}) {
    if (!this.sessionId) throw Error('No chat is open.');
    const content = buildContent(text, attachments, cwd);
    if (!content.length) throw Error('Nothing to send.');
    this.transcript.turnEnd = null;
    try {
      return await this.client.call('session/prompt', {request: {requestId: randomUUID(), sessionId: this.sessionId,
        mode: this.transcript.running ? 'steer' : 'queue', content, ...clientTimeZone() ? {clientTimeZone: clientTimeZone()} : {}}});
    } catch (error) {
      if (error.code === 'model-unavailable') throw Error(`${error.message} Check the brain with: atelier roles test brain`);
      if (error.code === 'attachment-error') throw Error(`${error.message} The current model may not read images; attach them to a vision model.`);
      throw error;
    }
  }

  cancel() { return this.sessionId ? this.client.call('session/cancel', {request: {sessionId: this.sessionId}}) : undefined; }

  presets() { return this.client.call('agentPresets/list', {}); }

  /** Switch profile (agent preset). Only possible before the first message, as in the web app. */
  selectPreset(preset) { return this.client.call('agentPresets/select', {agentId: this.sessionId, agentPreset: preset}); }

  catalog() { return this.client.call('session/modelCatalog', {}); }

  selectModel(provider, model) {
    return this.client.call('session/selectModel', {request: {sessionId: this.sessionId, provider, model}});
  }

  /** Wait until the current turn ends (turn/end), for one-shot answers. */
  waitForTurnEnd(timeoutMs = 30 * 60 * 1000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(Error('No answer within 30 minutes.')), timeoutMs);
      const previous = this.handlers.onUpdate;
      this.handlers.onUpdate = t => {
        previous?.(t);
        if (t.turnEnd) { clearTimeout(timer); this.handlers.onUpdate = previous; resolve(t); }
      };
    });
  }

  close() { this.follow?.cancel(); this.events?.cancel(); }
}
