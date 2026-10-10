#!/usr/bin/env node
// Scripted TUI smoke test in a pseudo-terminal (no window opens). It boots Atelier for a throwaway home, checks the
// layout, the command palette, the help overlay, a resize, an optional real chat turn, and a clean Ctrl+C exit.
//
//   ATELIER_HOME=<throwaway dir> node test/smoke-pty.mjs [--port 3393] [--shots <dir>]
// For a live chat turn, the home's brain must answer (e.g. first run with ATELIER_BASE_URL and ATELIER_MODEL set).
// Set ATELIER_SMOKE_PROMPT to choose the prompt; ATELIER_SMOKE_NO_CHAT=1 skips the turn.
import {mkdirSync, writeFileSync} from 'node:fs';
import {join, resolve} from 'node:path';
import {Screen, screenToSvg} from './pty-harness.mjs';

const argv = process.argv.slice(2);
const flag = name => { const i = argv.indexOf(name); return i < 0 ? undefined : argv[i + 1]; };
const home = process.env.ATELIER_HOME;
if (!home) { console.error('Set ATELIER_HOME to a throwaway folder.'); process.exit(2); }
const port = flag('--port') ?? '3393';
const shots = flag('--shots');
const results = [];
const check = (name, ok, detail = '') => { results.push({name, ok}); console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? `  ${detail}` : ''}`); };

async function shot(screen, name, title) {
  if (!shots) return;
  mkdirSync(shots, {recursive: true});
  const svg = screenToSvg(screen.term, {title});
  const file = join(resolve(shots), `${name}.svg`);
  writeFileSync(file, svg);
  try {
    const {default: sharp} = await import('sharp');
    await sharp(Buffer.from(svg), {density: 144}).png().toFile(file.replace(/\.svg$/, '.png'));
  } catch { /* PNG is optional; the SVG is the screenshot */ }
  console.log(`      screenshot ${file}`);
}

const screen = new Screen({cols: 120, rows: 34, args: ['--port', port], env: {ATELIER_HOME: home}, cwd: home});
let code = 1;
try {
  await screen.waitFor(/ ready\s*$/m, {timeoutMs: 240000, label: 'the TUI to be ready'});
  await screen.settle(800);
  const text = screen.text().join('\n');
  check('header shows Atelier by ARCITECH', /Atelier by ARCITECH/.test(text));
  check('sidebar shows Chats', /Chats/.test(text));
  check('status line shows profile and brain', /Vitruvius .*brain/.test(text));
  check('footer shows keys', /Enter send/.test(text) && /Ctrl\+N new/.test(text));

  screen.type('/'); await screen.settle(500);
  check('slash palette lists commands', ['/model', '/roles', '/profile', '/new', '/sessions', '/attach', '/export'].every(c => screen.has(c)));
  screen.key('esc'); await screen.settle(300);

  screen.type('/help'); await screen.settle(300); screen.key('enter'); await screen.settle(600);
  check('help overlay opens', screen.has('Keys and commands'));
  screen.key('esc'); await screen.settle(300);

  if (process.env.ATELIER_SMOKE_NO_CHAT !== '1') {
    screen.type(process.env.ATELIER_SMOKE_PROMPT ?? 'Draw a simple concept plan of a 4 x 5 m reading room with a window seat on the canvas, then describe it in three short bullet points.');
    await screen.settle(300);
    screen.key('enter');
    await screen.waitFor(() => screen.has('working'), {timeoutMs: 30000, label: 'the turn to start'});
    check('turn starts (status shows working)', true);
    await screen.waitFor(() => /You/.test(screen.text().join('\n')) && / ready\s*$/m.test(screen.text().join('\n')), {timeoutMs: 600000, label: 'the answer'});
    await screen.settle(1200);
    const answer = screen.text().join('\n');
    check('answer streamed into the chat pane', /Vitruvius\n/.test(answer) || answer.includes('Vitruvius'));
    check('token usage in status line', /\d+(\.\d)?k? in/.test(answer));
    if (/\d+ steps?/.test(answer)) {
      check('tool steps shown collapsed', /▸ \d+ steps?/.test(answer));
      screen.key('ctrl+t'); await screen.settle(600);
      check('tool steps expand with Ctrl+T', /[✓✗…] \S+ {2}/.test(screen.text().join('\n')));
    }
    await shot(screen, 'tui-conversation', 'atelier — conversation');
  } else await shot(screen, 'tui-welcome', 'atelier — welcome');

  screen.type('/'); await screen.settle(500);
  await shot(screen, 'tui-palette', 'atelier — command palette');
  screen.key('esc'); await screen.settle(300);

  screen.resize(72, 24); await screen.settle(900);
  const narrow = screen.text();
  check('resize to 72x24 redraws (sidebar hidden, status kept)', !narrow.join('\n').includes('Chats ') && narrow.some(l => /ready/.test(l)));
  screen.resize(120, 34); await screen.settle(600);

  screen.key('ctrl+c');
  const exit = await Promise.race([screen.exited, new Promise(r => setTimeout(() => r('timeout'), 15000))]);
  check('Ctrl+C quits cleanly', exit !== 'timeout', `exit ${exit}`);
  check('alternate screen restored', screen.output.includes('\x1b[?1049l'));
  code = results.every(r => r.ok) ? 0 : 1;
} catch (error) {
  console.log(`FAIL  ${error.message}`);
  screen.kill();
}
console.log(`${results.filter(r => r.ok).length}/${results.length} checks passed`);
process.exit(code);
