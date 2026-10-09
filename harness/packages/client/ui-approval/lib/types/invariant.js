const PACKAGE_NAME = '@deepseek-ai/dsh-client-ui-approval';
/** Cordis companion plugin name. */
export const name = 'client-ui-approval-invariant';
/** Service required before the companion can reserve package ownership. */
export const inject = ['invariants'];
/** No runtime invariant: registries own and observe the Remote listener and temporary Slot entry. */
const install = () => { };
/**
 * Register this package's invariant companion.
 * @param ctx - Cordis context carrying the invariant service.
 * @returns The installed registration's disposer.
 */
export const apply = (ctx) => Promise.resolve(ctx.invariants.register(PACKAGE_NAME, install));
/* jscpd:ignore-end */
