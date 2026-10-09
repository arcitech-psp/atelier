/** Validated configuration for the local PTY backend. */
import z from '@deepseek-ai/schemastery';
import { resolvePwshPath } from '@deepseek-ai/dsh-pwsh-local';
/** Bash dialect default executable. */
export const DEFAULT_BASH_SHELL = '/bin/bash';
/** Bash dialect default arguments (interactive, profile-free). */
export const DEFAULT_BASH_ARGS = ['--noprofile', '--norc', '-i'];
/** Pwsh dialect default arguments (interactive host, profile-free). */
export const DEFAULT_PWSH_ARGS = ['-NoLogo', '-NoProfile'];
/**
 * Resolve the effective per-dialect shell specification. Defaulting is this
 * explicit step: an unset or empty `shellPath`/`shellArgs` selects the
 * dialect's defaults, while a non-empty explicit value always wins.
 * (Schemastery materializes an absent optional array as `[]`, so emptiness —
 * not just `undefined` — means "dialect default".)
 * @param config - Schemastery-resolved plugin configuration.
 * @returns the fully resolved configuration.
 */
export function resolveConfig(config) {
    const shellDialect = config.shellDialect ?? 'bash';
    return {
        ...config,
        shellDialect,
        shellPath: config.shellPath !== undefined && config.shellPath.length > 0
            ? config.shellPath
            : (shellDialect === 'pwsh' ? resolvePwshPath() : DEFAULT_BASH_SHELL),
        shellArgs: config.shellArgs !== undefined && config.shellArgs.length > 0
            ? config.shellArgs
            : (shellDialect === 'pwsh' ? DEFAULT_PWSH_ARGS : DEFAULT_BASH_ARGS),
    };
}
/** Schemastery config exposed by the plugin. */
export const Config = z.object({
    backendType: z.string().default('shell'),
    shellDialect: z.union(['bash', 'pwsh']).default('bash'),
    shellPath: z.string().required(false),
    shellArgs: z.array(z.string()).required(false),
    rows: z.number().default(40),
    cols: z.number().default(160),
    scrollbackLines: z.number().default(10_000),
    scrollbackMaxBytes: z.number().default(4 * 1024 * 1024),
    maxReadBytes: z.number().default(256 * 1024),
    pollIntervalMs: z.number().default(50),
    exactProbeAfterMs: z.number().default(150),
    idleSilenceMs: z.number().default(3_000),
    handoffGraceMs: z.number().default(500),
    timeoutMs: z.number().default(30_000),
    disposeGraceMs: z.number().default(3_000),
});
/**
 * Assert every effective numeric config field is a positive safe integer and bounds compose.
 * @param config - Schemastery-resolved plugin configuration.
 * @returns Narrows the input to the fully resolved configuration.
 */
export function validateConfig(config) {
    const resolved = config;
    if (resolved.backendType.length === 0)
        throw new Error('terminal-bash: backendType must be non-empty');
    if (resolved.shellPath.length === 0)
        throw new Error('terminal-bash: shellPath must be non-empty');
    for (const [name, value] of Object.entries(resolved)) {
        if (typeof value === 'number' && (!Number.isSafeInteger(value) || value <= 0)) {
            throw new Error(`terminal-bash: ${name} must be a positive safe integer`);
        }
    }
    if (resolved.maxReadBytes > resolved.scrollbackMaxBytes) {
        throw new Error('terminal-bash: maxReadBytes must not exceed scrollbackMaxBytes');
    }
    if (resolved.handoffGraceMs < resolved.pollIntervalMs) {
        throw new Error('terminal-bash: handoffGraceMs must be at least pollIntervalMs so one readiness poll runs inside the grace window');
    }
}
