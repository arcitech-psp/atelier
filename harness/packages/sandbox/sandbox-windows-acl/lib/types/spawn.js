/** Restricted-token adapters over the shared Win32 process owner. */
import { spawnInheritedJobProcess, spawnPipedProcess, waitForProcessExit, } from '@deepseek-ai/dsh-win32-process';
export { drainPipe } from '@deepseek-ai/dsh-win32-process';
/**
 * Spawn a restricted-token child with piped stdout/stderr.
 * @param api - ACL/token binding table.
 * @param token - restricted primary token.
 * @param options - command, args, and working directory.
 * @returns process and caller-owned pipe handles.
 */
export function spawnSandboxed(api, token, options) {
    return spawnPipedProcess(api, { ...options, token });
}
/**
 * Spawn a restricted-token child in a kill-on-close Job with inherited stdio.
 * @param api - ACL/token binding table.
 * @param token - restricted primary token.
 * @param options - command, args, and working directory.
 * @returns process and Job handles after assignment and resume.
 */
export function spawnSandboxedInherited(api, token, options) {
    return spawnInheritedJobProcess(api, { ...options, token });
}
/**
 * Wait for a restricted child and close its process handle.
 * @param api - ACL/token binding table.
 * @param process - caller-owned process handle.
 * @returns direct process exit code.
 */
export function waitForExit(api, process) {
    return waitForProcessExit(api, process);
}
