import { OfficialBrandMark, OfficialBrandName } from "./Brand.js";
/** Required service: the UI slot registry. */
export const inject = ['slots'];
/**
 * Fill every shipped brand slot as one declaration-aware registration set.
 * @param ctx - Client root context.
 */
export function apply(ctx) {
    if (process.env.DSH_CLIENT_BUILD_PROFILE !== 'official')
        return;
    ctx.slots.inject('sidebar.brand.mark', () => ctx.slots.inject('sidebar.brand.name', () => ctx.slots.inject('conversation.hero.brand.mark', function* () {
        yield ctx.slots.register({ name: 'sidebar.brand.mark' }, OfficialBrandMark);
        yield ctx.slots.register({ name: 'sidebar.brand.name' }, OfficialBrandName);
        yield ctx.slots.register({ name: 'conversation.hero.brand.mark' }, OfficialBrandMark);
    })));
}
