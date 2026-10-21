// Argument parsing for `atelier`. Pure: argv in, a plain description out, so it is unit-tested without a terminal.
// Unknown flags are errors (with the command's usage), never silently ignored.

/** Option kinds: 'bool' takes no value, 'string' and 'int' take one, 'list' takes one and may repeat. */
const COMMON = {help: {kind: 'bool', short: 'h'}};
const SERVER = {port: {kind: 'int'}};

export const COMMANDS = {
  tui: {
    summary: 'open the terminal UI (the default when no command is given)',
    usage: 'atelier [--session <id>] [--theme auto|truecolor|256|mono] [--port <n>]',
    options: {...SERVER, session: {kind: 'string'}, theme: {kind: 'string', choices: ['auto', 'truecolor', '256', 'mono']}},
    positionals: [0, 0],
  },
  web: {
    summary: 'start the web app (and open it with --open)',
    usage: 'atelier web [--port <n>] [--open] [--bottega]',
    options: {...SERVER, open: {kind: 'bool'}, bottega: {kind: 'bool'}},
    positionals: [0, 0],
  },
  chat: {
    summary: 'answer one prompt and stream it to stdout (--json for scripts)',
    usage: 'atelier chat "<prompt>" [--json] [--session <id>] [--profile <name>] [--attach <file>]... [--cwd <dir>] [--port <n>]',
    options: {...SERVER, json: {kind: 'bool'}, session: {kind: 'string'}, profile: {kind: 'string'}, attach: {kind: 'list'},
      cwd: {kind: 'string'}, quiet: {kind: 'bool', short: 'q'}},
    positionals: [0, Infinity],
  },
  sessions: {
    summary: 'list, open or export chats (shared with the web app)',
    usage: 'atelier sessions list [--json] [--limit <n>] | open <id> [--web] | export <id> [--format md|json|zip] [--out <file>]',
    actions: {
      list: {options: {json: {kind: 'bool'}, limit: {kind: 'int'}, ...SERVER}, positionals: [0, 0]},
      open: {options: {web: {kind: 'bool'}, ...SERVER, theme: {kind: 'string', choices: ['auto', 'truecolor', '256', 'mono']}}, positionals: [1, 1], names: ['id']},
      export: {options: {format: {kind: 'string', choices: ['md', 'json', 'zip']}, out: {kind: 'string'}, ...SERVER}, positionals: [1, 1], names: ['id']},
    },
  },
  roles: {
    summary: 'see, set and test which model does which job (Model roles)',
    usage: 'atelier roles list [--json] | set <role> --url <url> --model <name> [--key-env <VAR>] [--vision] [--context <n>] | test [<role>] [--json]',
    actions: {
      list: {options: {json: {kind: 'bool'}}, positionals: [0, 0]},
      set: {options: {url: {kind: 'string', required: true}, model: {kind: 'string'}, 'key-env': {kind: 'string'},
        vision: {kind: 'bool'}, context: {kind: 'int'}, voice: {kind: 'string'}}, positionals: [1, 1], names: ['role']},
      test: {options: {json: {kind: 'bool'}}, positionals: [0, 1], names: ['role']},
    },
  },
  profile: {
    summary: 'see or choose the profile new chats start in',
    usage: 'atelier profile list [--json] | use <vitruvius|vitruvius-zero|einsteinium|picaso|hydra|cloud>',
    actions: {
      list: {options: {json: {kind: 'bool'}}, positionals: [0, 0]},
      use: {options: {}, positionals: [1, 1], names: ['name'], choices: ['vitruvius', 'vitruvius-zero', 'einsteinium', 'picaso', 'hydra', 'cloud']},
    },
  },
  settings: {
    summary: 'see or change Atelier settings: guardrails on|off',
    usage: 'atelier settings list [--json] | set guardrails on|off [--yes-i-understand]',
    actions: {
      list: {options: {json: {kind: 'bool'}}, positionals: [0, 0]},
      set: {options: {'yes-i-understand': {kind: 'bool'}}, positionals: [2, 2], names: ['name', 'value']},
    },
  },
  update: {
    summary: 'check for, apply or roll back an Atelier update',
    usage: 'atelier update check|apply|rollback [--json]',
    actions: {
      check: {options: {json: {kind: 'bool'}}, positionals: [0, 0]},
      apply: {options: {json: {kind: 'bool'}}, positionals: [0, 0]},
      rollback: {options: {json: {kind: 'bool'}}, positionals: [0, 0]},
    },
  },
  doctor: {
    summary: 'check Node, ports, endpoints, IngeTrazo and disk space, with plain-English fixes',
    usage: 'atelier doctor [--json] [--port <n>]',
    options: {json: {kind: 'bool'}, ...SERVER},
    positionals: [0, 0],
  },
};

/** Thrown for a usage error; `usage` is the line to show. */
export class UsageError extends Error {
  constructor(message, usage) { super(message); this.usage = usage; }
}

function parseOptions(tokens, spec, usage) {
  const options = {}, positionals = [];
  const all = {...COMMON, ...spec};
  const shorts = Object.fromEntries(Object.entries(all).filter(([, s]) => s.short).map(([name, s]) => [s.short, name]));
  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    if (token === '--') { positionals.push(...tokens.slice(i + 1)); break; }
    let name, inline;
    if (token.startsWith('--') && token.length > 2) {
      const eq = token.indexOf('=');
      name = eq < 0 ? token.slice(2) : token.slice(2, eq);
      inline = eq < 0 ? undefined : token.slice(eq + 1);
      if (name.startsWith('no-') && all[name.slice(3)]?.kind === 'bool' && inline === undefined) { options[name.slice(3)] = false; continue; }
    } else if (/^-[a-zA-Z]$/.test(token)) {
      name = shorts[token.slice(1)];
      if (!name) throw new UsageError(`unknown option ${token}`, usage);
    } else { positionals.push(token); continue; }
    const s = all[name];
    if (!s) throw new UsageError(`unknown option --${name}`, usage);
    if (s.kind === 'bool') {
      if (inline !== undefined) throw new UsageError(`--${name} takes no value`, usage);
      options[name] = true; continue;
    }
    let value = inline;
    if (value === undefined) {
      if (i + 1 >= tokens.length || (tokens[i + 1].startsWith('--') && tokens[i + 1].length > 2)) throw new UsageError(`--${name} needs a value`, usage);
      value = tokens[++i];
    }
    if (s.kind === 'int') {
      if (!/^\d+$/.test(value)) throw new UsageError(`--${name} must be a whole number (got "${value}")`, usage);
      value = Number(value);
      if (name === 'port' && (value < 1024 || value > 65535)) throw new UsageError('--port must be between 1024 and 65535', usage);
    }
    if (s.choices && !s.choices.includes(value)) throw new UsageError(`--${name} must be one of: ${s.choices.join(', ')}`, usage);
    if (s.kind === 'list') (options[name] ??= []).push(value); else options[name] = value;
  }
  return {options, positionals};
}

function checkCount(positionals, [min, max], usage, what) {
  if (positionals.length < min) throw new UsageError(`${what} needs ${min === 1 ? 'an argument' : `${min} arguments`}`, usage);
  if (positionals.length > max) throw new UsageError(`unexpected argument "${positionals[max]}"`, usage);
}

/**
 * Parse `atelier` arguments.
 * @param {string[]} argv - arguments after `node atelier.mjs`.
 * @returns {{command: string, action?: string, options: object, args: object, positionals: string[]}
 *   | {help: string|true} | {version: true}}
 * @throws {UsageError}
 */
export function parseArgs(argv) {
  const tokens = [...argv];
  if (tokens[0] === '-V' || tokens[0] === '--version' || tokens[0] === 'version') return {version: true};
  if (tokens[0] === 'help') return {help: tokens[1] && COMMANDS[tokens[1]] ? tokens[1] : true};
  if (tokens.length === 1 && (tokens[0] === '-h' || tokens[0] === '--help')) return {help: true};
  const command = tokens[0] && !tokens[0].startsWith('-') ? tokens.shift() : 'tui';
  const spec = COMMANDS[command];
  if (!spec) throw new UsageError(`unknown command "${command}"`, 'atelier --help lists the commands');
  if (!spec.actions) {
    const {options, positionals} = parseOptions(tokens, spec.options, spec.usage);
    if (options.help) return {help: command};
    checkCount(positionals, spec.positionals, spec.usage, command);
    // A chat prompt may also arrive on stdin (`echo ... | atelier chat`); that is checked when the command runs.
    const args = command === 'chat' ? {prompt: positionals.join(' ').trim()} : {};
    return {command, options, args, positionals};
  }
  if (tokens.length === 0 || tokens[0] === '-h' || tokens[0] === '--help') {
    if (tokens.length === 0 && command === 'sessions') return {command, action: 'list', options: {}, args: {}, positionals: []};
    if (tokens.length === 0 && (command === 'roles' || command === 'profile' || command === 'settings')) return {command, action: 'list', options: {}, args: {}, positionals: []};
    if (tokens.length === 0 && command === 'update') return {command, action: 'check', options: {}, args: {}, positionals: []};
    return {help: command};
  }
  const action = tokens.shift();
  const actionSpec = spec.actions[action];
  if (!actionSpec) throw new UsageError(`unknown ${command} action "${action}" (use: ${Object.keys(spec.actions).join(', ')})`, spec.usage);
  const {options, positionals} = parseOptions(tokens, actionSpec.options, spec.usage);
  if (options.help) return {help: command};
  checkCount(positionals, actionSpec.positionals, spec.usage, `${command} ${action}`);
  for (const [name, s] of Object.entries(actionSpec.options)) {
    if (s.required && options[name] === undefined) throw new UsageError(`${command} ${action} needs --${name}`, spec.usage);
  }
  const args = Object.fromEntries((actionSpec.names ?? []).map((name, i) => [name, positionals[i]]).filter(([, v]) => v !== undefined));
  if (actionSpec.choices && !actionSpec.choices.includes(positionals[0])) {
    throw new UsageError(`unknown ${command} "${positionals[0]}" (use: ${actionSpec.choices.join(', ')})`, spec.usage);
  }
  return {command, action, options, args, positionals};
}

/** The text of `atelier --help` or `atelier help <command>`. */
export function helpText(topic, versionLine) {
  if (topic !== true && COMMANDS[topic]) {
    const spec = COMMANDS[topic];
    return `${spec.usage}\n\n  ${spec.summary}\n\nSee docs/CLI.md for examples.\n`;
  }
  const rows = Object.entries(COMMANDS).map(([name, spec]) => `  ${(name === 'tui' ? '(none)' : name).padEnd(10)} ${spec.summary}`);
  return `${versionLine}

Usage: atelier [command] [options]

Commands:
${rows.join('\n')}

Options:
  -h, --help     help for atelier, or for one command (atelier help roles)
  -V, --version  show the version

Examples:
  atelier                                   open the terminal UI
  atelier chat "Suggest three facade materials for a coastal cabin"
  atelier chat --json "List the rooms in a two-bed flat" | jq -r .text
  atelier roles set brain --url http://localhost:8000/v1 --model my-model
  atelier settings set guardrails on
  atelier doctor

Your chats, settings and roles are shared with the web app (atelier web).
`;
}
