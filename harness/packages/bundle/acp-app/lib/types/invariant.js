/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-acp-app`.
 * @module @deepseek-ai/dsh-acp-app/invariant
 */
const PACKAGE_NAME = '@deepseek-ai/dsh-acp-app';
/** Cordis companion plugin name. */
export const name = 'acp-app-invariant';
/** Service required before the companion can register. */
export const inject = ['invariants'];
/**
 * No runtime invariant: the bundle adds a process transport and startup latch;
 * source/built stdio tests own frame purity, help exclusion, and shutdown.
 */
const install = () => { };
/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
