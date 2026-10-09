/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-util-workspace-path`.
 * @module @deepseek-ai/dsh-util-workspace-path/invariant
 */
const PACKAGE_NAME = '@deepseek-ai/dsh-util-workspace-path';
/** Cordis companion plugin name. */
export const name = 'workspace-path-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/** No runtime invariant: this utility owns no mutable runtime relationship. */
const install = () => { };
/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
/* jscpd:ignore-end */
