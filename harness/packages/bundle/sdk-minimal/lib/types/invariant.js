/**
 * Package-owned invariant companion for `@deepseek-ai/dsh-sdk-minimal`.
 * @module @deepseek-ai/dsh-sdk-minimal/invariant
 */
const PACKAGE_NAME = '@deepseek-ai/dsh-sdk-minimal';
/** Cordis companion plugin name. */
export const name = 'sdk-minimal-bundle-invariant';
/** Service required before the companion can register. */
export const inject = ['invariants'];
// No runtime invariant: the package is a static patch-list carrier whose
// inserted rows own their runtime relationships and invariant companions.
const install = () => { };
/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer after setup succeeds.
 */
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
