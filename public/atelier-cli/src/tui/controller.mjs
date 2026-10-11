// State and actions of the terminal UI, kept outside React so they are easy to follow and to test. The view
// (app.mjs) draws `state` and calls the actions; every change calls `emit()`.
import {writeFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {Conversation} from '../engine.mjs';
import {listProfiles, useProfile} from '../profile.mjs';
import {listRoles, testRole} from '../roles.mjs';
import {readSettings} from '../settings.mjs';
import {attach} from '../server.mjs';
import {createTranscript, transcriptToMarkdown} from '../transcript.mjs';

export const SLASH_COMMANDS = [
  {name: '/new', help: 'start a new chat'},
  {name: '/sessions', help: 'pick a chat (same list as the web app)'},
  {name: '/model', help: 'choose the model for this chat'},
  {name: '/roles', help: 'which model does which job, and whether each answers'},
  {name: '/profile', help: 'Vitruvius, Vitruvius Zero or Cloud'},
  {name: '/attach', help: 'attach a file or image: /attach <path>', arg: true},
  {name: '/export', help: 'save this chat as Markdown: /export [file]', arg: true},
  {name: '/help', help: 'keys and commands'},
  {name: '/quit', help: 'leave (Ctrl+C)'},
];

const PRESET_NAMES = {vitruvius: 'Vitruvius', 'vitruvius-zero': 'Vitruvius Zero'};
export const presetName = id => PRESET_NAMES[id] ?? (id ? id[0].toUpperCase() + id.slice(1) : 'Vitruvius');

export class Controller {
  constructor({home, session, port, cwd = process.cwd()}) {
    this.home = home; this.cwd = cwd; this.port = port; this.initialSession = session;
    this.listeners = new Set();
    this.state = {
      phase: 'starting', startMessage: 'Starting Atelier...', error: null,
      sessions: [], sidebarIndex: 0, focus: 'input', sidebarOpen: true,
      sessionId: null, transcript: createTranscript(),
      input: '', cursor: 0, history: [], historyIndex: -1, paletteIndex: 0,
      attachments: [], overlay: null, notice: null,
      approval: null, question: null,
      expandSteps: false, showReasoning: false, scroll: 0, frame: 0,
      brain: null, profile: 'vitruvius', defaultPreset: 'vitruvius', pendingModel: null,
    };
    this.session = undefined; this.conversation = undefined;
  }

  subscribe(listener) { this.listeners.add(listener); return () => this.listeners.delete(listener); }
  emit() { for (const listener of this.listeners) listener(); }
  set(patch) { Object.assign(this.state, patch); this.emit(); }
  notify(text, tone = 'info') { this.set({notice: {text, tone, at: Date.now()}}); }

  // ------------------------------------------------------------ lifecycle
  async start() {
    try {
      const settings = (() => { try { return readSettings(this.home); } catch { return {}; } })();
      const defaultPreset = settings['agent-presets']?.default ?? 'vitruvius';
      this.set({defaultPreset, profile: listProfiles(this.home).find(p => p.active)?.id ?? defaultPreset});
      this.session = await attach(this.home, {port: this.port, onStarting: () => this.set({startMessage: 'Starting Atelier (about 20 seconds)...'})});
      this.conversation = new Conversation(this.session.client, {
        onUpdate: t => { if (t === this.conversation.transcript) this.set({transcript: t}); },
        onApproval: request => new Promise(done => this.set({approval: {request, done}})),
        onQuestion: request => new Promise(done => this.set({question: {request, done, step: 0, answers: [], index: 0}})),
        onEvent: frame => { if (/^api-session\/(added|removed|status)$/.test(frame.event)) this.refreshSessions(); },
        onError: error => this.notify(error.message, 'fail'),
      });
      await this.conversation.listen();
      await this.refreshSessions();
      this.set({phase: 'ready'});
      if (this.initialSession) await this.openSession(this.initialSession);
      this.checkBrain();
    } catch (error) {
      this.set({phase: 'error', error: error.message});
    }
  }

  async checkBrain() {
    try {
      const roles = await listRoles(this.home);
      const brain = roles.find(r => r.id === 'brain');
      if (!brain?.set) { this.set({brain: {state: 'not-set', label: 'not set'}}); return; }
      this.set({brain: {state: 'checking', label: brain.config.model}});
      const result = await testRole(this.home, 'brain');
      this.set({brain: {state: result.state, label: brain.config.model || brain.config.route, message: result.message}});
    } catch (error) { this.set({brain: {state: 'failing', label: 'brain', message: error.message}}); }
  }

  async refreshSessions() {
    if (!this.session) return;
    clearTimeout(this.refreshTimer);
    this.refreshTimer = setTimeout(async () => {
      try {
        const sessions = await this.session.client.listSessions();
        this.set({sessions, sidebarIndex: Math.min(this.state.sidebarIndex, Math.max(0, sessions.length - 1))});
      } catch (error) { this.notify(`Could not list chats: ${error.message}`, 'warn'); }
    }, 150);
  }

  stop() {
    clearTimeout(this.refreshTimer);
    this.conversation?.close();
    this.session?.release();
  }

  // ------------------------------------------------------------ chats
  newChat() {
    this.conversation.follow?.cancel();
    this.conversation.sessionId = undefined;
    this.conversation.transcript = createTranscript();
    this.set({sessionId: null, transcript: this.conversation.transcript, scroll: 0, focus: 'input', overlay: null,
      profile: this.state.defaultPreset === 'vitruvius-zero' ? 'vitruvius-zero' : this.state.profile === 'cloud' ? 'cloud' : this.state.defaultPreset});
    this.notify('New chat. It is created when you send the first message.');
  }

  async openSession(id) {
    try {
      this.set({focus: 'input', overlay: null, scroll: 0});
      const t = await this.conversation.open(id);
      this.set({sessionId: id, transcript: t});
    } catch (error) { this.notify(`Could not open that chat: ${error.message}`, 'fail'); }
  }

  async send() {
    const text = this.state.input.trim();
    if (!text && !this.state.attachments.length) return;
    if (text.startsWith('/')) { await this.runCommand(text); return; }
    const attachments = this.state.attachments;
    this.set({input: '', cursor: 0, attachments: [], scroll: 0, history: [...this.state.history, text].slice(-100), historyIndex: -1});
    try {
      if (!this.conversation.sessionId) {
        const preset = this.state.profile === 'vitruvius-zero' ? 'vitruvius-zero' : this.state.profile === 'cloud' ? undefined : this.state.profile;
        const id = await this.conversation.create({cwd: this.cwd, preset});
        this.set({sessionId: id, transcript: this.conversation.transcript});
        if (this.state.pendingModel) {
          await this.conversation.selectModel(this.state.pendingModel.provider, this.state.pendingModel.model).catch(e => this.notify(e.message, 'warn'));
          this.set({pendingModel: null});
        }
        this.refreshSessions();
      }
      await this.conversation.prompt(text, attachments, {cwd: this.cwd});
    } catch (error) {
      this.set({input: text, cursor: text.length, attachments});
      this.notify(error.message, 'fail');
    }
  }

  async interrupt() {
    if (!this.state.transcript.running) return false;
    try { await this.conversation.cancel(); this.notify('Stopping...'); } catch (error) { this.notify(error.message, 'fail'); }
    return true;
  }

  // ------------------------------------------------------------ slash commands
  paletteMatches() {
    const input = this.state.input;
    if (!input.startsWith('/') || input.includes(' ')) return [];
    return SLASH_COMMANDS.filter(c => c.name.startsWith(input.toLowerCase()));
  }

  async runCommand(line) {
    const [name, ...rest] = line.trim().split(/\s+/);
    const arg = rest.join(' ').replace(/^"(.*)"$/, '$1');
    const command = SLASH_COMMANDS.find(c => c.name === name.toLowerCase()) ?? (this.paletteMatches().length === 1 ? this.paletteMatches()[0] : undefined);
    this.set({input: '', cursor: 0, paletteIndex: 0});
    if (!command) { this.notify(`Unknown command ${name}. Type / to see the commands.`, 'warn'); return; }
    switch (command.name) {
      case '/new': return this.newChat();
      case '/sessions': return this.showSessions();
      case '/model': return this.showModels();
      case '/roles': return this.showRoles();
      case '/profile': return this.showProfiles();
      case '/help': return this.set({overlay: {kind: 'help', title: 'Keys and commands'}});
      case '/quit': return this.onQuit?.();
      case '/attach': {
        if (!arg) { this.set({input: '/attach ', cursor: 8}); return this.notify('Type the file path after /attach, then Enter.'); }
        const path = resolve(this.cwd, arg);
        try {
          const {statSync} = await import('node:fs');
          if (!statSync(path).isFile()) throw Error('not a file');
          this.set({attachments: [...this.state.attachments, path]});
          return this.notify(`Attached ${path}. It goes with your next message.`);
        } catch { return this.notify(`No file at ${path}.`, 'fail'); }
      }
      case '/export': {
        if (!this.state.sessionId) return this.notify('Nothing to export yet.', 'warn');
        const file = resolve(this.cwd, arg || `atelier-${(this.state.transcript.title || 'chat').replace(/[^\w-]+/g, '-').slice(0, 40)}.md`);
        try { writeFileSync(file, transcriptToMarkdown(this.state.transcript, {id: this.state.sessionId})); return this.notify(`Saved ${file}`, 'ok'); }
        catch (error) { return this.notify(`Could not save: ${error.message}`, 'fail'); }
      }
      default: return undefined;
    }
  }

  showSessions() {
    if (this.state.sidebarOpen) return this.set({focus: 'sidebar', overlay: null});
    const items = this.state.sessions.map(s => ({label: s.projections?.values?.title || '(untitled)', value: s.sessionId, hint: s.running ? 'working' : ''}));
    this.set({overlay: {kind: 'pick', title: 'Chats', items, index: 0, onPick: item => this.openSession(item.value)}});
  }

  async showModels() {
    try {
      const catalog = await this.conversation.catalog();
      const current = this.state.transcript.model ?? catalog.default?.model;
      const items = (catalog.groups ?? []).flatMap(g => (g.models ?? []).map(m => ({label: m.name || m.id, value: {provider: g.id, model: m.id},
        hint: `${g.name ?? g.id}${m.id === current ? '  (in use)' : ''}`})));
      if (!items.length) return this.notify('No models are configured. Connect one with /roles.', 'warn');
      this.set({overlay: {kind: 'pick', title: 'Model for this chat', items, index: Math.max(0, items.findIndex(i => i.value.model === current)),
        onPick: async item => {
          if (!this.conversation.sessionId) { this.set({pendingModel: item.value}); return this.notify(`${item.label} will be used when this chat starts.`); }
          try { await this.conversation.selectModel(item.value.provider, item.value.model); this.notify(`Now using ${item.label}.`, 'ok'); }
          catch (error) { this.notify(error.message, 'fail'); }
        }}});
    } catch (error) { this.notify(`Could not read the models: ${error.message}`, 'fail'); }
  }

  async showRoles() {
    const roles = await listRoles(this.home);
    const items = roles.map(r => ({label: r.name, value: r.id,
      hint: r.config?.baseURL ? `${r.config.model || ''} ${r.config.baseURL}` : r.coveredByBrain ? 'covered by the brain' : r.config?.managed ? r.config.model : 'not set', state: r.set ? 'checking' : 'not-set'}));
    const overlay = {kind: 'pick', title: 'Model roles  (Enter: how to change one)', items, index: 0,
      onPick: item => this.notify(`Change it from a terminal: atelier roles set ${item.value} --url <address> --model <name>  (or Settings > Model roles in the web app)`)};
    this.set({overlay});
    for (const item of items) {
      if (item.state !== 'checking') continue;
      testRole(this.home, item.value).then(result => { item.state = result.state; item.message = result.message; this.emit(); });
    }
  }

  showProfiles() {
    const profiles = listProfiles(this.home);
    const blank = !this.state.sessionId || !this.state.transcript.items.length;
    const items = profiles.map(p => ({label: p.id === 'cloud' ? 'Cloud' : presetName(p.id), value: p.id, hint: `${p.description}${p.active ? '  (new chats)' : ''}`}));
    this.set({overlay: {kind: 'pick', title: blank ? 'Profile for this chat and new chats' : 'Profile for new chats (this chat has started)', items,
      index: Math.max(0, items.findIndex(i => i.value === this.state.profile)),
      onPick: async item => {
        try {
          const result = await useProfile(this.home, item.value);
          const defaultPreset = item.value === 'cloud' ? 'vitruvius' : item.value;
          this.set({defaultPreset, profile: blank ? item.value : this.state.profile});
          if (blank && this.conversation.sessionId && item.value !== 'cloud') await this.conversation.selectPreset(item.value);
          this.notify(result.notes.at(-1) ?? `Profile ${item.label}.`, 'ok');
          this.checkBrain();
        } catch (error) { this.notify(error.message, 'fail'); }
      }}});
  }

  // ------------------------------------------------------------ approvals and questions
  answerApproval(value) {
    const approval = this.state.approval;
    if (!approval) return;
    this.set({approval: null});
    approval.done(value);
  }

  answerQuestion(text) {
    const q = this.state.question;
    if (!q) return;
    const item = q.request.questions?.[q.step];
    if (!item) { this.set({question: null}); q.done(undefined); return; }
    const options = item.options ?? [];
    const n = Number(text.trim());
    const picked = Number.isInteger(n) && n >= 1 && n <= options.length ? options[n - 1].label : undefined;
    const answers = [...q.answers, picked ? {id: item.id, selected: [picked]} : {id: item.id, selected: [], custom: text.trim()}];
    if (q.step + 1 < (q.request.questions?.length ?? 0)) { this.set({question: {...q, step: q.step + 1, answers}, input: '', cursor: 0}); return; }
    this.set({question: null, input: '', cursor: 0});
    q.done({answers});
  }
}
