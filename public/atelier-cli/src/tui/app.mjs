// The terminal UI view. Ink handles input, resize and redraw; every row is composed here as styled text cut to the
// exact width, so the sidebar, chat, palette and status line never re-wrap unexpectedly on any terminal.
import React from 'react';
import {Box, Text, useApp, useInput, useStdout} from 'ink';
import {SLASH_COMMANDS, presetName} from './controller.mjs';
import {GLYPHS, fit, stringWidth, wrap} from './style.mjs';
import {renderChat, spinner, welcomeLines} from './view.mjs';

const h = React.createElement;

const ago = ms => {
  if (!ms) return '';
  const s = Math.max(0, (Date.now() - ms) / 1000);
  return s < 60 ? 'now' : s < 3600 ? `${Math.floor(s / 60)}m` : s < 86400 ? `${Math.floor(s / 3600)}h` : `${Math.floor(s / 86400)}d`;
};
const compact = n => n >= 1000 ? `${(n / 1000).toFixed(n >= 10000 ? 0 : 1)}k` : String(n ?? 0);

const FOOTER = {
  input: [['Enter', 'send'], ['/', 'commands'], ['Ctrl+N', 'new'], ['Ctrl+B', 'chats'], ['Ctrl+T', 'steps'], ['Ctrl+R', 'thinking'], ['PgUp/PgDn', 'scroll'], ['Esc', 'stop'], ['Ctrl+C', 'quit']],
  sidebar: [['Up/Down', 'choose'], ['Enter', 'open'], ['Ctrl+N', 'new'], ['Tab/Esc', 'back to typing'], ['Ctrl+C', 'quit']],
  overlay: [['Up/Down', 'choose'], ['Enter', 'select'], ['Esc', 'close']],
  approval: [['a', 'allow once'], ['r', 'reject'], ['Ctrl+C', 'quit']],
  question: [['type a number or an answer', ''], ['Enter', 'reply'], ['Esc', 'skip']],
};

function footerLine(kind, width, s) {
  const parts = FOOTER[kind].map(([key, label]) => `${s.accentSoft(key)}${label ? ` ${s.dim(label)}` : ''}`);
  let line = '';
  for (const part of parts) {
    const next = line ? `${line}${s.line('  ')}${part}` : part;
    if (stringWidth(next) > width - 2) break;
    line = next;
  }
  return ` ${line}`;
}

function sidebarLines(state, width, height, s) {
  const lines = [` ${s.bold(s.ink('Chats'))}`, ''];
  const list = state.sessions;
  if (!list.length) lines.push(...wrap(s.dim('No chats yet.'), width - 2).map(l => ` ${l}`));
  const room = height - lines.length;
  const start = Math.max(0, Math.min(state.sidebarIndex - Math.floor(room / 2), list.length - room));
  for (let i = start; i < Math.min(list.length, start + room); i++) {
    const item = list[i];
    const current = item.sessionId === state.sessionId;
    const title = item.projections?.values?.title || '(untitled)';
    const when = item.running ? GLYPHS.run : ago(item.updatedAt);
    const label = fit(`${current ? s.accent(GLYPHS.closed) : ' '} ${current ? s.bold(s.ink(title)) : s.ink(title)}`, width - stringWidth(when) - 2);
    const row = `${label} ${s.dim(when)} `;
    lines.push(state.focus === 'sidebar' && i === state.sidebarIndex ? s.selected(s.chalk.reset(fit(` ${title}`, width - stringWidth(when) - 1) + when + ' ')) : row);
  }
  return lines;
}

function overlayLines(overlay, width, height, s) {
  const lines = ['', ` ${s.accent.bold(overlay.title)}`, ''];
  if (overlay.kind === 'help') {
    const rows = [
      ['Enter', 'send your message'], ['/', 'open the command list (Tab completes)'], ['Esc', 'stop Vitruvius, or close a list'],
      ['Ctrl+N', 'new chat'], ['Ctrl+B', 'show or hide the chats sidebar; Tab moves between it and typing'],
      ['Ctrl+T', 'expand or collapse the tool steps'], ['Ctrl+R', 'show or hide the model\'s thinking'],
      ['PgUp / PgDn', 'scroll the chat'], ['Up / Down', 'earlier messages you typed'], ['Ctrl+U / Ctrl+W', 'clear the line / delete a word'],
      ['Ctrl+L', 'redraw the screen'], ['Ctrl+C', 'quit (a running answer keeps going in Atelier; see it in the web app)'],
    ];
    for (const [key, text] of rows) lines.push(...wrap(`${s.accentSoft(key.padEnd(16))}${s.ink(text)}`, width - 4).map(l => `   ${l}`));
    lines.push('', ` ${s.bold(s.ink('Commands'))}`);
    for (const c of SLASH_COMMANDS) lines.push(...wrap(`${s.accentSoft(c.name.padEnd(16))}${s.dim(c.help)}`, width - 4).map(l => `   ${l}`));
    lines.push('', ...wrap(s.dim('Chats, profiles and model roles are shared with the web app: run atelier web to open the same chats in a browser.'), width - 4).map(l => `   ${l}`));
    return lines;
  }
  const room = Math.max(3, height - lines.length - 1);
  const start = Math.max(0, Math.min(overlay.index - Math.floor(room / 2), overlay.items.length - room));
  for (let i = start; i < Math.min(overlay.items.length, start + room); i++) {
    const item = overlay.items[i];
    const state = item.state ? ` ${item.state === 'connected' || item.state === 'covered' ? s.ok(GLYPHS.ok) : item.state === 'failing' ? s.fail(GLYPHS.fail) : item.state === 'checking' ? s.dim(GLYPHS.run) : s.dim('-')}` : '';
    const text = `${item.label}`;
    const row = i === overlay.index
      ? s.selected(fit(` ${GLYPHS.closed} ${text}  ${item.hint ?? ''}`, width - 6))
      : `   ${s.ink(text)}  ${s.dim(item.hint ?? '')}`;
    lines.push(`  ${fit(row, width - 6)}${state}`);
    if (i === overlay.index && item.message) lines.push(...wrap(s.dim(item.message), width - 8).map(l => `      ${l}`));
  }
  return lines;
}

function inputLines(state, width, s) {
  const out = [];
  if (state.approval) {
    const r = state.approval.request ?? {};
    out.push(s.line(GLYPHS.rule.repeat(width)));
    out.push(...wrap(`${s.warn.bold('Approval')}  ${s.ink(`Vitruvius wants to run ${s.bold(r.toolName ?? 'a tool')}.`)}${r.reason ? s.dim(` ${r.reason}`) : ''}`, width - 2).map(l => ` ${l}`));
    out.push(` ${s.accentSoft('a')} ${s.ink('allow once')}   ${s.accentSoft('r')} ${s.ink('reject')}`);
    return out;
  }
  out.push(s.line(GLYPHS.rule.repeat(width)));
  if (state.question) {
    const item = state.question.request.questions?.[state.question.step] ?? {};
    out.push(...wrap(`${s.warn.bold('Question')}  ${s.ink(item.question ?? '')}`, width - 2).map(l => ` ${l}`));
    (item.options ?? []).slice(0, 6).forEach((o, i) => out.push(...wrap(`${s.accentSoft(`${i + 1}`)} ${s.ink(o.label)}${o.description ? s.dim(`  ${o.description}`) : ''}`, width - 4).map(l => `   ${l}`)));
  }
  const matches = state.focus === 'input' && !state.question ? paletteFor(state) : [];
  matches.slice(0, 7).forEach((c, i) => {
    const row = `${c.name.padEnd(11)} ${c.help}`;
    out.push(i === state.paletteIndex ? ` ${s.selected(fit(` ${row}`, width - 2))}` : `  ${s.accentSoft(c.name.padEnd(11))} ${s.dim(c.help)}`);
  });
  if (state.attachments.length) out.push(` ${s.dim(`attached: ${state.attachments.map(a => a.split(/[\\/]/).pop()).join(', ')}`)}`);
  const prompt = `${s.accent(GLYPHS.prompt)} `;
  const value = state.input;
  const before = value.slice(0, state.cursor), at = value.slice(state.cursor, state.cursor + 1) || ' ', after = value.slice(state.cursor + 1);
  const focused = state.focus === 'input' && !state.overlay;
  const placeholder = !value && focused ? s.dim(state.question ? 'Your answer' : state.transcript.running ? 'Type to add to the request, Esc to stop' : 'Describe the project, or type / for commands') : '';
  const text = placeholder ? `${s.inverse(' ')}${placeholder}` : `${s.ink(before)}${focused ? s.inverse(at) : s.ink(at)}${s.ink(after)}`;
  const wrapped = wrap(text, width - 3);
  out.push(...wrapped.slice(-4).map((l, i) => (i === 0 && wrapped.length <= 4 ? ` ${prompt}` : '   ') + l));
  return out;
}

function paletteFor(state) {
  const input = state.input;
  if (!input.startsWith('/') || input.includes(' ')) return [];
  return SLASH_COMMANDS.filter(c => c.name.startsWith(input.toLowerCase()));
}

function statusLine(state, width, s) {
  const t = state.transcript;
  const profile = presetName(t.preset ?? (state.profile === 'cloud' ? 'vitruvius' : state.profile)) + (state.profile === 'cloud' && !t.preset ? ' (cloud)' : '');
  const brain = state.brain;
  const dot = !brain ? s.dim('○') : brain.state === 'connected' ? s.ok('●') : brain.state === 'checking' ? s.dim('○') : brain.state === 'not-set' ? s.warn('○') : s.fail('●');
  const brainText = `${dot} ${s.ink(`brain ${t.model ?? brain?.label ?? '...'}`)}${brain && brain.state !== 'connected' && brain.state !== 'checking' ? s.dim(` ${brain.state === 'not-set' ? 'not set' : brain.state}`) : ''}`;
  const usage = t.lastUsage ? s.dim(`${compact(t.lastUsage.inputTokens)} in ${GLYPHS.dot} ${compact(t.lastUsage.outputTokens)} out`) : s.dim('0 tokens');
  const speed = t.speed ? s.dim(`${Math.round(t.speed)} tok/s`) : '';
  const working = t.running ? s.warn(`working ${spinner(state.frame)}`) : state.phase === 'ready' ? s.ok('ready') : s.dim(state.phase);
  const sep = s.line(` ${GLYPHS.bar} `);
  const left = [s.accentSoft(profile), brainText, usage, speed].filter(Boolean).join(sep);
  const room = width - stringWidth(working) - 3;
  return s.bar(`${fit(` ${left}`, room)} ${working}  `);
}

export function App({controller, onExit}) {
  const {exit} = useApp();
  const {stdout} = useStdout();
  const [, setTick] = React.useState(0);
  const [size, setSize] = React.useState({cols: stdout.columns || 100, rows: stdout.rows || 30});

  React.useEffect(() => {
    let pending = false;
    const off = controller.subscribe(() => {
      if (pending) return;
      pending = true;
      setTimeout(() => { pending = false; setTick(n => n + 1); }, 33);
    });
    const onResize = () => setSize({cols: stdout.columns || 100, rows: stdout.rows || 30});
    stdout.on('resize', onResize);
    const timer = setInterval(() => {
      const st = controller.state;
      if (st.phase === 'starting' || st.transcript.running || (st.brain?.state === 'checking')) { st.frame++; controller.emit(); }
    }, 150);
    controller.onQuit = () => { onExit(); exit(); };
    return () => { off(); stdout.off('resize', onResize); clearInterval(timer); };
  }, []);

  const state = controller.state;
  const s = controller.styler;

  useInput((input, key) => {
    if (key.ctrl && input === 'c') { controller.onQuit(); return; }
    if (state.phase !== 'ready') { if (state.phase === 'error') controller.onQuit(); return; }
    if (state.approval) {
      if (/^[ay]$/i.test(input)) controller.answerApproval('allowed-once');
      else if (/^[rn]$/i.test(input) || key.escape) controller.answerApproval('rejected');
      return;
    }
    if (key.ctrl && input === 'l') { stdout.write('\x1b[2J\x1b[H'); controller.emit(); return; }
    if (key.ctrl && input === 'n') { controller.newChat(); return; }
    if (key.ctrl && input === 't') { controller.set({expandSteps: !state.expandSteps}); return; }
    if (key.ctrl && input === 'r') { controller.set({showReasoning: !state.showReasoning}); return; }
    if (key.ctrl && input === 'b') { const open = !state.sidebarOpen; controller.set({sidebarOpen: open, focus: open ? 'sidebar' : 'input'}); return; }
    if (key.pageUp) { controller.set({scroll: state.scroll + Math.max(3, size.rows - 10)}); return; }
    if (key.pageDown) { controller.set({scroll: Math.max(0, state.scroll - Math.max(3, size.rows - 10))}); return; }

    if (state.overlay) {
      const o = state.overlay;
      if (key.escape) controller.set({overlay: null});
      else if (o.kind === 'pick' && key.upArrow) { o.index = Math.max(0, o.index - 1); controller.emit(); }
      else if (o.kind === 'pick' && key.downArrow) { o.index = Math.min(o.items.length - 1, o.index + 1); controller.emit(); }
      else if (key.return) { const item = o.items?.[o.index]; controller.set({overlay: null}); if (item) o.onPick?.(item); }
      return;
    }
    if (state.focus === 'sidebar') {
      if (key.upArrow) controller.set({sidebarIndex: Math.max(0, state.sidebarIndex - 1)});
      else if (key.downArrow) controller.set({sidebarIndex: Math.min(state.sessions.length - 1, state.sidebarIndex + 1)});
      else if (key.return && state.sessions[state.sidebarIndex]) controller.openSession(state.sessions[state.sidebarIndex].sessionId);
      else if (key.tab || key.escape) controller.set({focus: 'input'});
      return;
    }
    // Typing.
    const value = state.input, cursor = state.cursor;
    const edit = (next, at) => controller.set({input: next, cursor: at, paletteIndex: 0, historyIndex: -1});
    const palette = paletteFor(state);
    if (key.escape) {
      if (state.question) { const q = state.question; controller.set({question: null}); q.done(undefined); return; }
      if (palette.length || value.startsWith('/')) { edit('', 0); return; }
      controller.interrupt();
      return;
    }
    if (key.return) {
      if (state.question) { controller.answerQuestion(value); return; }
      if (palette.length && value !== palette[state.paletteIndex].name) {
        const chosen = palette[state.paletteIndex];
        if (chosen.arg) { edit(`${chosen.name} `, chosen.name.length + 1); return; }
        controller.runCommand(chosen.name); return;
      }
      controller.send(); return;
    }
    if (key.tab) {
      if (palette.length) { const chosen = palette[state.paletteIndex]; edit(`${chosen.name}${chosen.arg ? ' ' : ''}`, chosen.name.length + (chosen.arg ? 1 : 0)); }
      else if (!value && state.sidebarOpen) controller.set({focus: 'sidebar'});
      return;
    }
    if (key.upArrow) {
      if (palette.length) { controller.set({paletteIndex: Math.max(0, state.paletteIndex - 1)}); return; }
      const history = state.history; if (!history.length) return;
      const index = state.historyIndex < 0 ? history.length - 1 : Math.max(0, state.historyIndex - 1);
      controller.set({historyIndex: index, input: history[index], cursor: history[index].length}); return;
    }
    if (key.downArrow) {
      if (palette.length) { controller.set({paletteIndex: Math.min(palette.length - 1, state.paletteIndex + 1)}); return; }
      if (state.historyIndex < 0) return;
      const index = state.historyIndex + 1;
      if (index >= state.history.length) controller.set({historyIndex: -1, input: '', cursor: 0});
      else controller.set({historyIndex: index, input: state.history[index], cursor: state.history[index].length});
      return;
    }
    if (key.leftArrow) { controller.set({cursor: Math.max(0, cursor - 1)}); return; }
    if (key.rightArrow) { controller.set({cursor: Math.min(value.length, cursor + 1)}); return; }
    if (key.backspace || key.delete) { if (cursor > 0) edit(value.slice(0, cursor - 1) + value.slice(cursor), cursor - 1); return; }
    if (key.ctrl && input === 'a') { controller.set({cursor: 0}); return; }
    if (key.ctrl && input === 'e') { controller.set({cursor: value.length}); return; }
    if (key.ctrl && input === 'u') { edit(value.slice(cursor), 0); return; }
    if (key.ctrl && input === 'w') {
      const head = value.slice(0, cursor).replace(/\S+\s*$/, '');
      edit(head + value.slice(cursor), head.length); return;
    }
    if (key.ctrl || key.meta || !input) return;
    // Pasted text arrives in one piece; keep it on one line.
    const text = input.replace(/\r\n?|\n/g, ' ');
    edit(value.slice(0, cursor) + text + value.slice(cursor), cursor + text.length);
  });

  const cols = Math.max(40, size.cols - 1), rows = Math.max(12, size.rows - 1);
  const rowsOut = [];

  // Header.
  const title = state.transcript.title ?? (state.sessionId ? '' : 'New chat');
  const brand = `${s.accent.bold(' Atelier')} ${s.dim('by ARCITECH')}`;
  rowsOut.push(s.bar(fit(`${brand}${title ? `${s.line(`  ${GLYPHS.bar}  `)}${s.ink(title)}` : ''}`, cols)));

  if (state.phase !== 'ready') {
    const body = state.phase === 'error'
      ? ['', ...wrap(s.fail(`${GLYPHS.fail} ${state.error}`), cols - 4), '', s.dim('Run atelier doctor for a check with fixes. Press any key to quit.')]
      : ['', s.ink(`${state.startMessage} ${spinner(state.frame)}`), '', s.dim('The terminal and the web app share your chats, profiles and model roles.')];
    for (let i = 0; i < rows - 1; i++) rowsOut.push(fit(i < body.length ? `   ${body[i]}` : '', cols));
    return h(Box, {flexDirection: 'column'}, rowsOut.map((line, i) => h(Text, {key: i, wrap: 'truncate-end'}, line)));
  }

  const footerKind = state.approval ? 'approval' : state.question ? 'question' : state.overlay ? 'overlay' : state.focus === 'sidebar' ? 'sidebar' : 'input';
  const showSidebar = state.sidebarOpen && cols >= 80;
  const sideWidth = showSidebar ? Math.min(34, Math.max(24, Math.floor(cols * 0.24))) : 0;
  const chatWidth = cols - sideWidth - (showSidebar ? 1 : 0);
  const paneWidth = Math.max(20, chatWidth - 4);
  const input = inputLines(state, chatWidth, s);
  const notice = state.notice && Date.now() - state.notice.at < 8000 ? state.notice : null;
  const bodyHeight = rows - 1 - input.length - (notice ? 1 : 0) - 2;

  let chat;
  if (state.overlay) chat = overlayLines(state.overlay, chatWidth, bodyHeight, s);
  else if (!state.transcript.items.length && !state.transcript.running) {
    chat = welcomeLines(paneWidth, s, {profile: presetName(state.profile === 'cloud' ? 'vitruvius' : state.profile), brain: state.brain?.label && state.brain.state !== 'not-set' ? `${state.brain.label}${state.brain.state === 'failing' ? ' (not answering: /roles)' : ''}` : null}).map(l => `  ${l}`);
  } else {
    const all = renderChat(state.transcript, paneWidth, s, {expandSteps: state.expandSteps, showReasoning: state.showReasoning, frame: state.frame,
      assistantName: presetName(state.transcript.preset ?? 'vitruvius')}).map(l => `  ${l}`);
    const maxScroll = Math.max(0, all.length - bodyHeight);
    const scroll = Math.min(state.scroll, maxScroll);
    const end = all.length - scroll;
    chat = ['', ...all].slice(Math.max(0, end + 1 - bodyHeight), end + 1);
    if (scroll > 0) chat[chat.length - 1] = s.dim(`  ${GLYPHS.open} ${scroll} more lines below (PgDn)`);
  }
  // Keep the newest chat lines just above the input, like a conversation.
  const chatRows = state.overlay ? chat.slice(0, bodyHeight) : [...Array(Math.max(0, bodyHeight - chat.length)).fill(''), ...chat].slice(-bodyHeight);
  const sideRows = showSidebar ? sidebarLines(state, sideWidth, bodyHeight + input.length + (notice ? 1 : 0), s) : [];
  const sep = s.line(GLYPHS.bar);
  const lowerRows = [...(notice ? [` ${notice.tone === 'fail' ? s.fail(notice.text) : notice.tone === 'warn' ? s.warn(notice.text) : notice.tone === 'ok' ? s.ok(notice.text) : s.dim(notice.text)}`] : []), ...input];
  const right = [...chatRows, ...lowerRows];
  for (let i = 0; i < right.length; i++) {
    rowsOut.push(showSidebar ? `${fit(sideRows[i] ?? '', sideWidth)}${sep}${fit(right[i], chatWidth)}` : fit(right[i], cols));
  }
  rowsOut.push(statusLine(state, cols, s));
  rowsOut.push(fit(footerLine(footerKind, cols, s), cols));
  return h(Box, {flexDirection: 'column'}, rowsOut.map((line, i) => h(Text, {key: i, wrap: 'truncate-end'}, line)));
}
