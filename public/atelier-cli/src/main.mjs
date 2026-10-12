// `atelier`: Atelier by ARCITECH from the terminal. A branded layer over the upstream DSH launcher
// (harness/apps/cli): the web app is still `dsh web` behind start-preview.mjs, and the terminal UI and `chat` are
// clients of that same server, so chats, profiles and model roles are shared with the browser.
import {spawn} from 'node:child_process';
import {mkdirSync, readFileSync, rmSync, writeFileSync} from 'node:fs';
import {createInterface} from 'node:readline/promises';
import {dirname, resolve} from 'node:path';
import {COMMANDS, UsageError, helpText, parseArgs} from './args.mjs';
import {START_PREVIEW, atelierHome, versionLine} from './paths.mjs';

const useColor = stream => stream.isTTY && !('NO_COLOR' in process.env && process.env.NO_COLOR !== '') && process.env.TERM !== 'dumb';
const paint = (stream, code, text) => useColor(stream) ? `\x1b[${code}m${text}\x1b[0m` : text;
const out = line => process.stdout.write(`${line}\n`);
const err = line => process.stderr.write(`${line}\n`);
const STATE_MARK = {ok: ['32', 'ok  '], warn: ['33', 'warn'], fail: ['31', 'FAIL'], info: ['2', 'info'],
  connected: ['32', 'connected'], failing: ['31', 'failing'], 'not-set': ['2', 'not set'], covered: ['32', 'covered by the brain']};
const mark = (stream, state) => { const [code, label] = STATE_MARK[state] ?? ['0', state]; return paint(stream, code, label); };
const printJson = value => out(JSON.stringify(value, null, 2));

async function readStdin() {
  if (process.stdin.isTTY) return '';
  const chunks = [];
  for await (const chunk of process.stdin) chunks.push(chunk);
  return Buffer.concat(chunks).toString('utf8').trim();
}

async function askYesNo(question) {
  if (!process.stdin.isTTY || !process.stderr.isTTY) return false;
  const rl = createInterface({input: process.stdin, output: process.stderr});
  try { return /^y(es)?$/i.test((await rl.question(`${question} [y/N] `)).trim()); } finally { rl.close(); }
}

// ---------------------------------------------------------------- chat
async function chatCommand({options, args}, home) {
  const {attach} = await import('./server.mjs');
  const {Conversation} = await import('./engine.mjs');
  const {lastAnswer, summarizeArgs} = await import('./transcript.mjs');
  const prompt = args.prompt || await readStdin();
  if (!prompt && !options.attach?.length) throw new UsageError('chat needs a prompt, as an argument or on stdin', COMMANDS.chat.usage);
  if (options.profile === 'cloud') throw Error('"cloud" is chosen for all new chats: run atelier profile use cloud, then chat.');
  const json = options.json === true, quiet = options.quiet === true || json;
  const status = line => { if (!quiet) err(paint(process.stderr, '2', line)); };
  const session = await attach(home, {port: options.port, onStarting: () => status('Starting Atelier (about 20 seconds)...')});
  const conversation = new Conversation(session.client, {
    onApproval: async request => {
      const name = request.toolName ?? 'a tool';
      if (!json && await askYesNo(`Vitruvius wants to run ${name}${request.reason ? ` (${request.reason})` : ''}. Allow once?`)) return 'allowed-once';
      status(`Declined ${name}. Use the terminal UI or the web app to approve steps.`);
      return 'rejected';
    },
  });
  let interrupted = false;
  const onSigint = () => { interrupted = true; conversation.cancel()?.catch(() => {}); };
  process.on('SIGINT', onSigint);
  try {
    await conversation.listen();
    if (options.session) await conversation.open(options.session);
    else await conversation.create({cwd: resolve(options.cwd ?? process.cwd()), preset: options.profile});
    // Stream: print each step's new answer text as it grows; show tool steps on stderr.
    const written = new Map(), shownTools = new Set();
    let printedAny = false;
    if (!json) {
      const prior = new Set(conversation.transcript.items);
      conversation.handlers.onUpdate = t => {
        for (const item of t.items) {
          if (prior.has(item)) continue;
          if (item.kind === 'assistant') {
            // `written` is an offset into the raw text; the first answer skips the model's leading blank lines.
            let from = written.get(item);
            if (from === undefined) {
              if (!item.text.trim()) continue;
              from = printedAny ? 0 : item.text.length - item.text.replace(/^\s+/, '').length;
              if (printedAny) process.stdout.write(String.fromCharCode(10, 10));
            }
            if (item.text.length > from) {
              process.stdout.write(item.text.slice(from));
              written.set(item, item.text.length); printedAny = true;
            }
          } else if (item.kind === 'tool' && item.done && !shownTools.has(item)) {
            shownTools.add(item);
            status(`\n  step ${item.name}${item.args ? ` (${summarizeArgs(item.args, 60)})` : ''}${item.isError ? ' failed' : ''}`);
          }
        }
      };
    }
    // After the printer is in place: waitForTurnEnd chains onto it.
    const done = conversation.waitForTurnEnd();
    await conversation.prompt(prompt, options.attach ?? [], {cwd: options.cwd});
    const t = await done;
    const reason = t.turnEnd?.kind ?? 'completed';
    if (json) {
      printJson({sessionId: conversation.sessionId, text: lastAnswer(t), stopReason: reason, provider: t.provider, model: t.model,
        profile: t.preset, usage: t.lastUsage ?? t.usage,
        steps: t.items.filter(i => i.kind === 'tool').map(i => ({name: i.name, arguments: i.args, isError: i.isError}))});
    } else {
      if (printedAny) process.stdout.write('\n');
      if (t.error) err(paint(process.stderr, '31', t.error));
      status(`session ${conversation.sessionId}  (continue: atelier chat --session ${conversation.sessionId} "...")`);
    }
    if (interrupted || reason === 'aborted' || reason === 'interrupted') return 130;
    return reason === 'error' ? 1 : 0;
  } finally {
    process.off('SIGINT', onSigint);
    conversation.close();
    session.release();
  }
}

// ---------------------------------------------------------------- sessions
const titleOf = item => item.projections?.values?.title || '(untitled)';
const when = ms => ms ? new Date(ms).toISOString().replace('T', ' ').slice(0, 16) : '';

async function sessionsCommand({action, options, args}, home) {
  if (action === 'open') {
    if (options.web) return webCommand({options: {port: options.port, open: false}}, home, args.id);
    const {runTui} = await import('./tui/run.mjs');
    return runTui({home, session: args.id, port: options.port, theme: options.theme});
  }
  const {attach} = await import('./server.mjs');
  const session = await attach(home, {port: options.port, onStarting: () => err(paint(process.stderr, '2', 'Starting Atelier (about 20 seconds)...'))});
  try {
    if (action === 'list') {
      let items = await session.client.listSessions();
      if (options.limit) items = items.slice(0, options.limit);
      if (options.json) {
        printJson(items.map(i => ({id: i.sessionId, title: i.projections?.values?.title ?? null, updatedAt: i.updatedAt ? new Date(i.updatedAt).toISOString() : null,
          running: i.running === true, profile: i.projections?.values?.agentPreset ?? null, cwd: i.cwd ?? null})));
        return 0;
      }
      if (!items.length) { out('No chats yet. Start one with: atelier   (or atelier chat "...")'); return 0; }
      for (const i of items) {
        out(`${paint(process.stdout, '2', when(i.updatedAt))}  ${i.sessionId}  ${titleOf(i)}${i.running ? paint(process.stdout, '33', '  (working)') : ''}`);
      }
      return 0;
    }
    // export
    const format = options.format ?? 'md';
    if (format === 'zip') {
      const zip = await session.client.exportZip(args.id);
      const file = resolve(options.out ?? `atelier-${args.id}.zip`);
      writeFileSync(file, zip);
      err(`Saved ${file}`);
      return 0;
    }
    const {Conversation} = await import('./engine.mjs');
    const {transcriptToMarkdown} = await import('./transcript.mjs');
    const conversation = new Conversation(session.client);
    try {
      const t = await conversation.open(args.id, {maxMessages: 100000});
      const text = format === 'md' ? transcriptToMarkdown(t, {id: args.id})
        : `${JSON.stringify({id: args.id, title: t.title, profile: t.preset, model: t.model, items: t.items}, null, 2)}\n`;
      if (options.out) { mkdirSync(dirname(resolve(options.out)), {recursive: true}); writeFileSync(resolve(options.out), text); err(`Saved ${resolve(options.out)}`); }
      else process.stdout.write(text);
    } catch (error) {
      if (error.code === 'session-not-found' || /not found/i.test(error.message)) throw Object.assign(Error(`No chat with id ${args.id}. List them with: atelier sessions list`), {exitCode: 2});
      throw error;
    } finally { conversation.close(); }
    return 0;
  } finally { session.release(); }
}

// ---------------------------------------------------------------- web
async function webCommand({options}, home, sessionHint) {
  const {cliServerRecord, findServer, newLaunchToken, pickPort} = await import('./server.mjs');
  const running = await findServer(home);
  if (running) {
    out(`Atelier is already running for this folder on http://localhost:${running.port}/`);
    out(`Open this address (keep it private; it carries your login token): http://localhost:${running.port}/?token=${running.token}`);
    if (sessionHint) out(`Then pick the chat "${sessionHint}" in the sidebar.`);
    return 0;
  }
  const port = await pickPort(options.port);
  const token = newLaunchToken();
  // --bottega: share this Atelier with paired devices on your private network (team mode); prints the address and a code.
  const child = spawn(process.execPath, [START_PREVIEW, ...options.open ? ['--open'] : [], ...options.bottega ? ['--bottega'] : []], {
    cwd: dirname(START_PREVIEW), stdio: 'inherit', windowsHide: true,
    env: {...process.env, ATELIER_HOME: home, ATELIER_PORT: String(port), DSH_BROWSER_LAUNCH_TOKEN: token},
  });
  mkdirSync(dirname(cliServerRecord(home)), {recursive: true, mode: 0o700});
  writeFileSync(cliServerRecord(home), JSON.stringify({port, token, pid: child.pid, source: 'atelier web'}), {mode: 0o600});
  const forward = signal => () => child.kill(signal);
  process.on('SIGINT', forward('SIGINT')); process.on('SIGTERM', forward('SIGTERM'));
  const code = await new Promise(done => child.on('exit', c => done(c ?? 0)));
  try { if (JSON.parse(readFileSync(cliServerRecord(home), 'utf8')).pid === child.pid) rmSync(cliServerRecord(home), {force: true}); } catch { /* gone */ }
  return code;
}

// ---------------------------------------------------------------- roles, profile, update, doctor
async function rolesCommand({action, options, args}, home) {
  const {listRoles, setRole, testRole, roleCatalog} = await import('./roles.mjs');
  if (action === 'list') {
    const roles = await listRoles(home);
    if (options.json) { printJson(roles); return 0; }
    for (const r of roles) {
      const where = r.config?.baseURL ? `${r.config.model || '(any model)'} at ${r.config.baseURL}${r.config.keyEnv ? `  key: $${r.config.keyEnv}` : ''}`
        : r.coveredByBrain ? 'covered by the brain (it reads images)' : r.config?.managed ? `${r.config.model} (from Settings > Models)` : paint(process.stdout, '2', 'not set');
      out(`${r.name.padEnd(18)} ${where}${r.required && !r.set ? paint(process.stdout, '31', '  needed') : ''}`);
    }
    return 0;
  }
  if (action === 'set') {
    const role = await setRole(home, args.role, {url: options.url, model: options.model, keyEnv: options['key-env'],
      vision: options.vision === true, context: options.context, voice: options.voice});
    out(`${role.name} now uses ${role.config.model || 'the server default'} at ${role.config.baseURL}.`);
    const {findServer} = await import('./server.mjs');
    if (await findServer(home) && args.role !== 'brain' && args.role !== 'helper') out('The running Atelier uses this role after its next start.');
    out(`Check it with: atelier roles test ${args.role}`);
    return 0;
  }
  const ids = args.role ? [args.role] : (await listRoles(home)).filter(r => r.set || r.required).map(r => r.id);
  if (args.role && !(await roleCatalog()).some(r => r.id === args.role)) throw Object.assign(Error(`Unknown role "${args.role}".`), {exitCode: 2});
  const results = [];
  for (const id of ids) results.push({role: id, ...await testRole(home, id)});
  if (options.json) printJson(results);
  else for (const r of results) out(`${r.role.padEnd(11)} ${mark(process.stdout, r.state)}  ${r.message}`);
  return results.some(r => r.state === 'failing' || (r.role === 'brain' && r.state === 'not-set')) ? 1 : 0;
}

async function profileCommand({action, options, args}, home) {
  const {listProfiles, useProfile} = await import('./profile.mjs');
  if (action === 'list') {
    const profiles = listProfiles(home);
    if (options.json) { printJson(profiles); return 0; }
    for (const p of profiles) out(`${p.active ? paint(process.stdout, '33', '*') : ' '} ${p.id.padEnd(15)} ${p.description}`);
    return 0;
  }
  const result = await useProfile(home, args.name);
  out(`Profile: ${result.profile}`);
  for (const note of result.notes) out(`  ${note}`);
  return 0;
}

async function settingsCommand({action, options, args}, home) {
  const {readGuardrails, setGuardrails, WARNING} = await import('./guardrails.mjs');
  if (action === 'list') {
    const on = readGuardrails(home);
    if (options.json) { printJson({guardrails: on ? 'on' : 'off'}); return 0; }
    out(`guardrails  ${on ? 'on' : paint(process.stdout, '33', 'off')}  ${on ? '(default) chats stay in their project folder and ask before anything wider'
      : 'full file access, no approval prompts, no time limit on long waits'}`);
    return 0;
  }
  if (args.name !== 'guardrails') throw Object.assign(Error(`Unknown setting "${args.name}". Settings: guardrails.`), {exitCode: 2});
  const value = String(args.value).toLowerCase();
  if (!['on', 'off'].includes(value)) throw Object.assign(Error('Use: atelier settings set guardrails on|off'), {exitCode: 2});
  if (value === 'off') {
    err(paint(process.stderr, '33', `Warning: ${WARNING}`));
    if (options['yes-i-understand'] !== true) {
      err('Nothing was changed. To turn guardrails off, run: atelier settings set guardrails off --yes-i-understand');
      return 1;
    }
  }
  const changed = await setGuardrails(home, value === 'on');
  out(value === 'on' ? `Atelier guardrails are on${changed ? '' : ' (they already were)'}.`
    : `Atelier guardrails are off${changed ? '' : ' (they already were)'}. Turn them back on with: atelier settings set guardrails on`);
  const {findServer} = await import('./server.mjs');
  if (await findServer(home)) out('The running Atelier picks this up at once, in open chats too.');
  return 0;
}

async function updateCommand({action, options}, home) {
  const {runUpdate} = await import('./update.mjs');
  const result = await runUpdate(action, {home, say: options.json ? () => {} : out});
  if (options.json) printJson(result);
  return 0;
}

async function doctorCommand({options}, home) {
  const {runDoctor, doctorExitCode} = await import('./doctor.mjs');
  const checks = await runDoctor({home, port: options.port});
  if (options.json) { printJson({home, checks}); return doctorExitCode(checks); }
  out(versionLine());
  out(paint(process.stdout, '2', `Atelier folder: ${home}`));
  for (const c of checks) {
    out(`${mark(process.stdout, c.state)}  ${c.label.padEnd(18)} ${c.detail}`);
    if (c.fix && c.state !== 'ok') out(`      ${paint(process.stdout, '2', `Fix: ${c.fix}`)}`);
  }
  const failed = checks.filter(c => c.state === 'fail').length;
  out(failed ? `\n${failed} problem${failed > 1 ? 's' : ''} to fix.` : '\nAll set.');
  return doctorExitCode(checks);
}

/** Run `atelier` with these arguments; resolves to the exit code. */
export async function main(argv = process.argv.slice(2), env = process.env) {
  let parsed;
  try { parsed = parseArgs(argv); }
  catch (error) {
    if (!(error instanceof UsageError)) throw error;
    err(`atelier: ${error.message}`);
    if (error.usage) err(`usage: ${error.usage}`);
    return 2;
  }
  if (parsed.version) { out(versionLine()); return 0; }
  if (parsed.help) { process.stdout.write(helpText(parsed.help, versionLine())); return 0; }
  const home = atelierHome(env);
  try {
    switch (parsed.command) {
      case 'tui': {
        const {runTui} = await import('./tui/run.mjs');
        return await runTui({home, session: parsed.options.session, port: parsed.options.port, theme: parsed.options.theme});
      }
      case 'web': return await webCommand(parsed, home);
      case 'chat': return await chatCommand(parsed, home);
      case 'sessions': return await sessionsCommand(parsed, home);
      case 'roles': return await rolesCommand(parsed, home);
      case 'profile': return await profileCommand(parsed, home);
      case 'settings': return await settingsCommand(parsed, home);
      case 'update': return await updateCommand(parsed, home);
      case 'doctor': return await doctorCommand(parsed, home);
      default: return 2;
    }
  } catch (error) {
    if (error instanceof UsageError) { err(`atelier: ${error.message}`); if (error.usage) err(`usage: ${error.usage}`); return 2; }
    err(`atelier: ${error.message}`);
    if (env.ATELIER_DEBUG) err(error.stack);
    return error.exitCode ?? 1;
  }
}
