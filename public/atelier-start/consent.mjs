// Refuse shell commands that install software, run downloaded code, or change system settings without named consent.
export const name = 'atelier-consent-guard';

const RULES = [
  // [kind, pattern]
  ['install', /\b(npm|pnpm|yarn|bun)\s+(install|i|add|ci|update|upgrade)\b(?!\s*--dry-run)|\b(npm|pnpm|yarn)\s+(-g|--global)\b/i],
  ['install', /\bnpx\s+(-y|--yes)\b|\bnpm\s+exec\s+(-y|--yes)\b/i],
  ['install', /\b(pip3?|uv\s+pip|pipx|conda|mamba|poetry)\s+(install|add)\b|\buv\s+(add|tool\s+install)\b|\bpython\d?(\.\d+)?\s+-m\s+pip\s+install\b|\bpy(\s+-\d(\.\d+)?)?\s+-m\s+pip\s+install\b/i],
  ['install', /\b(winget|choco|chocolatey|scoop)\s+(install|upgrade|add)\b/i],
  ['install', /\b(apt|apt-get|brew|dnf|yum|pacman|zypper|snap)\s+(install|-S|upgrade)\b/i],
  ['install', /\b(cargo|go|gem|dotnet\s+tool)\s+install\b/i],
  ['install', /\b(Install-Module|Install-Package|Install-Script|Add-AppxPackage|Enable-WindowsOptionalFeature|Add-WindowsCapability)\b/i],
  ['install', /\bmsiexec\b|\.msi\b.*\/(i|qn|quiet|passive)\b|\b(setup|installer|install)\w*\.exe\b|\.exe['"]?\s+(\/S|\/silent|\/verysilent|\/quiet|--silent|-silent)\b/i],
  ['install', /[\w.-]+(-cli)?(\.exe)?['"]?\s+(install|self-install|setup|bootstrap)\b(?!\s*--help)/i],
  ['remote script', /\b(iex|Invoke-Expression)\b[^\n]*\b(irm|iwr|Invoke-RestMethod|Invoke-WebRequest|DownloadString|curl|wget)\b|\b(irm|iwr|Invoke-RestMethod|Invoke-WebRequest)\b[^\n|]*\|\s*(iex|Invoke-Expression)\b|\b(curl|wget)\b[^\n|]*\|\s*(sh|bash|zsh|python\d?|pwsh|powershell)\b/i],
  ['download', /\b(Invoke-WebRequest|iwr|curl|wget|Start-BitsTransfer|DownloadFile)\b[^\n]*\.(exe|msi|msix|appx|zip|7z|tar\.gz|tgz|ps1|bat|cmd|sh|dll|whl)\b/i],
  ['system change', /\breg(\.exe)?\s+(add|delete|import)\b|\b(Set|New|Remove)-ItemProperty\b[^\n]*\b(HKLM|HKCU|HKEY_)|\bSet-ExecutionPolicy\b|\bsetx\b|\bnetsh\b|\bsc(\.exe)?\s+(create|config|delete)\b|\b(New|Set|Remove)-Service\b|\bschtasks(\.exe)?\s+\/(create|change|delete)\b|\bRegister-ScheduledTask\b|\bbcdedit\b|\bSet-MpPreference\b/i],
];

/** What a command would do that needs consent, as [{kind, match}], or [] when it needs none. Pure. */
// Words that are followed by "install" without installing anything (printing it, searching for it, asking for help).
const NOT_AN_INSTALLER = /^(echo|write-output|write-host|print|printf|grep|rg|findstr|select-string|man|help|git|cat|type|get-help|where|which)$/i;

export function needsConsent(command) {
  // Text that is only PRINTED cannot install anything: drop echo/Write-Output/... arguments up to the next ; | or line.
  const text = String(command ?? '').replace(/\b(echo|Write-Output|Write-Host|Write-Verbose|printf|print)\b[^;&|\n]*/gi, ' ');
  const out = [];
  for (const [kind, re] of RULES) {
    const m = re.exec(text);
    if (!m) continue;
    const token = m[0].trim().split(/\s+/)[0].replace(/^[&$'"]+|['"]+$/g, '');
    if (NOT_AN_INSTALLER.test(token)) continue;
    out.push({kind, match: m[0].trim().slice(0, 120)});
  }
  return out;
}

const STOP = new Set(['install', 'add', 'update', 'upgrade', 'global', 'yes', 'exe', 'cli', 'the', 'and', 'npm', 'pnpm', 'yarn', 'bun', 'pip', 'pip3', 'pipx', 'uv', 'conda', 'mamba', 'poetry', 'npx', 'winget', 'choco', 'scoop', 'apt', 'apt-get', 'brew', 'dnf', 'yum', 'pacman', 'zypper', 'snap', 'cargo', 'go', 'gem', 'dotnet',
  'powershell', 'pwsh', 'python', 'module', 'package', 'bin', 'users', 'appdata', 'local', 'program', 'files', 'setup', 'self']);

/** Names in a command that identify the software, tool, or file involved. */
export function subjectsOf(command) {
  const words = String(command ?? '').toLowerCase().match(/[a-z][a-z0-9._@/-]{2,}/g) ?? [];
  const names = new Set();
  for (const w of words) for (const part of w.split(/[\\/@]/)) {
    const base = part.replace(/\.(exe|msi|zip|ps1|whl)$/, '').replace(/-cli$/, '');
    if (base.length >= 3 && !STOP.has(base) && !/^-/.test(base)) names.add(base);
  }
  return [...names];
}

const CONSENT_VERB = /\b(install|download|set\s*up|setup|add|update|upgrade|go ahead|allow|approved?|permit)\b/i;
const YES = /^\s*(yes|yep|yeah|y|ok|okay|sure|go ahead|approved?|do it|proceed|please do|allowed?)\b/i;

/** Consent must name a command subject, or answer a direct question about that subject. */
export function consentGiven(userText, lastAssistantText, command) {
  const user = String(userText ?? '').toLowerCase();
  const subjects = subjectsOf(command);
  if (CONSENT_VERB.test(user) && subjects.some(s => user.includes(s))) return true;
  if (YES.test(user) && user.length < 120) {
    const asked = String(lastAssistantText ?? '').toLowerCase();
    return /\b(install|download|set up|setup|run the installer|change)\b/.test(asked) && subjects.some(s => asked.includes(s));
  }
  return false;
}

const commandOf = args => {
  const a = typeof args === 'string' ? (() => { try { return JSON.parse(args); } catch { return {command: args}; } })() : (args ?? {});
  return typeof a.command === 'string' ? a.command : typeof a.script === 'string' ? a.script : typeof a.cmd === 'string' ? a.cmd : '';
};

function latest(events, role) {
  for (let i = (events?.length ?? 0) - 1; i >= 0; i--) {
    const e = events[i];
    if (role === 'user' && e?.type === 'user/message') {
      const src = e.data?.source ?? e.data?.message?.source;
      if (src && src.kind !== 'user') continue;
      const parts = e.data?.content ?? e.data?.message?.content ?? [];
      const t = (Array.isArray(parts) ? parts : []).filter(p => p?.type === 'text').map(p => p.text ?? '').join('\n');
      if (/^\s*Current runtime context\b/.test(t)) continue;
      return t;
    }
    if (role === 'assistant' && e?.type === 'assistant/message') {
      const parts = e.data?.message?.content ?? [];
      const t = (Array.isArray(parts) ? parts : []).filter(p => p?.type === 'text').map(p => p.text ?? '').join('\n');
      if (t.trim()) return t;
    }
  }
  return '';
}

export function refusal(found, command) {
  const kinds = [...new Set(found.map(f => f.kind))].join(' + ');
  return `CONSENT_REQUIRED: not run. This command would ${kinds === 'install' ? 'INSTALL software' : kinds === 'download' ? 'DOWNLOAD a program or script'
    : kinds === 'remote script' ? 'download and RUN a remote script' : kinds === 'system change' ? 'CHANGE system settings' : kinds} `
    + `(${found.map(f => `"${f.match}"`).join(', ')}), and the user has not asked for that. Nothing on this machine is installed, `
    + 'downloaded to run, or changed in its settings without the user\'s explicit consent. Ask the user first, in plain words: what you '
    + 'want to install or change, where it comes from, and why the task needs it. Run it only after they say yes. If the task can be '
    + 'done without it, do that instead.';
}

/** The refusal for an agent-driven session (config.agentCaller): no chat message can consent. Pure. */
export function agentCallerRefusal(found, command) {
  const kinds = [...new Set(found.map(f => f.kind))].join(' + ');
  return `CONSENT_REQUIRED: not run. This command would ${kinds} (${found.map(f => `"${f.match}"`).join(', ')}). This session is `
    + 'driven by another agent, and an agent\'s request is not the user\'s consent, so nothing is installed, downloaded to run, or '
    + 'changed in system settings from here. Do the job without it if you can; otherwise stop and list it under open issues as '
    + '"needs the user\'s consent: <what, from where, why>".';
}

/** Script files invoked by a command, so their contents can be checked too. */
export function scriptsRun(command) {
  const out = new Set();
  const re = /(?:^|[;&|\s(])(?:&\s*|\.\s+|-File\s+|\/c\s+|bash\s+|sh\s+|pwsh(?:\.exe)?\s+|powershell(?:\.exe)?\s+)?["']?((?:[A-Za-z]:|\.{1,2}|~|\$env:\w+)?[^\s"';|&]*\.(?:ps1|bat|cmd|sh))["']?/gi;
  for (const m of String(command ?? '').matchAll(re)) out.add(m[1]);
  return [...out];
}

export function apply(ctx, config = {}) {
  if (config.enabled === false) return;
  const shellTools = new Set(config.tools ?? ['pwsh', 'bash', 'sh', 'powershell', 'shell', 'exec', 'exec_command', 'run_command', 'terminal']);
  ctx.on('tools/execute', async (exec, next) => {
    if (!shellTools.has(String(exec?.name ?? ''))) return next();
    const command = commandOf(exec.arguments);
    let checked = command;
    for (const s of scriptsRun(command)) {
      const path = s.replace(/^\$env:(\w+)/i, (_, v) => process.env[v] ?? '').replace(/^~/, process.env.USERPROFILE ?? '~');
      try {
        const {readFileSync, statSync} = await import('node:fs');
        const {resolve} = await import('node:path');
        const full = resolve(exec?.agent?.session?.header?.cwd ?? exec?.agent?.session?.cwd ?? process.cwd(), path);
        if (statSync(full).size < 512 * 1024) checked += `\n${readFileSync(full, 'utf8')}`;
      } catch { /* not a readable file: judge the command alone */ }
    }
    const found = needsConsent(checked);
    if (!found.length) return next();
    // An agent-driven session cannot grant the user's consent through its own messages.
    if (config.agentCaller === true) throw Error(agentCallerRefusal(found, command));
    const events = exec?.agent?.session?.events;
    if (consentGiven(latest(events, 'user'), latest(events, 'assistant'), checked)) return next();
    // Throwing makes the host display this as the tool's error result.
    throw Error(refusal(found, command));
  });
}
