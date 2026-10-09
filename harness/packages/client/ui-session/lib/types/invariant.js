const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-session';
/** Cordis companion plugin name. */
export const name = 'client-ui-session-invariant';
/** Service required before the companion reserves package ownership. */
export const inject = ['invariants'];
/** No runtime invariant: the adapter materialization path enforces Session binding consistency. */
const install = () => { };
/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns the installed registration's disposer.
 */
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
