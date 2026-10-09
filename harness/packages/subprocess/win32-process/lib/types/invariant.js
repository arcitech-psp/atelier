/** Package-owned invariant companion for `@deepseek-ai/dsh-win32-process`. */
const PACKAGE_NAME = '@deepseek-ai/dsh-win32-process';
export const name = 'win32-process-invariant';
export const inject = ['invariants'];
/** No runtime invariant: operations own only call-local native handles. */
const install = () => { };
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
/* jscpd:ignore-end */
