import { ComposerAttachments } from "./ComposerAttachments.js";
import { MessageImages } from "./MessageImages.js";
/** Slot registry required by this presentation plugin. */
export const inject = ['slots'];
/** Register attachment presentation without exporting React components as package values. */
export function apply(ctx) {
    ctx.slots.inject('conversation.input.attachments', () => ctx.slots.register({
        name: 'conversation.input.attachments',
        locale: 'conversation',
    }, ComposerAttachments));
    ctx.slots.inject('conversation.message.images', () => ctx.slots.register({
        name: 'conversation.message.images',
        locale: 'conversation',
    }, MessageImages));
    ctx.slots.inject('conversation.trajectory.images', () => ctx.slots.register({
        name: 'conversation.trajectory.images',
        locale: 'conversation',
    }, MessageImages));
}
