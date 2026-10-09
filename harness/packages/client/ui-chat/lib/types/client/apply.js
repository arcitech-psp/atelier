import { resolveWorkspacePath } from '@deepseek-ai/dsh-util-workspace-path';
import { EMPTY_CHAT_SNAPSHOT } from "./contract/snapshot.js";
import { ApprovalCommand } from "./chat/ApprovalCommand.js";
import { ChatView } from "./chat/ChatView.js";
import { registerChatNodeRenderers } from "./chat/register-node-renderers.js";
import { StatsLine } from "./chat/StatsLine.js";
import { registerConversationNodes } from "./conversation-nodes/register.js";
import { DetailsPanel } from "./details/DetailsPanel.js";
import { en, NS, zh } from "./locale.js";
import { TranscriptViewRow } from "./settings/TranscriptViewRow.js";
import { createChatStore } from "./stores.js";
import { TranscriptViewPolicy } from "./transcript-view.js";
import { CHAT_SETTINGS_NAMESPACE } from "../chat-settings.js";
const CHAT_NODE_INJECT = {
    hooks: {
        turnData: ({ useChat }, nodeKey) => function useTurnData(key) {
            return useChat((snapshot) => {
                const location = snapshot.nodes.get(nodeKey)?.location;
                return location?.kind === 'turn' || location?.kind === 'step'
                    ? location.turn.data.get(key)
                    : undefined;
            });
        },
    },
};
/** Services required by the Chat target and its presentation registrations. */
export const inject = [
    'slots', 'sessions', 'uiSession', 'uiConversation', 'layout', 'locale',
    'settingsScope', 'remote', 'remote.session',
];
/**
 * Mount all Chat-owned contributions.
 * @param ctx - Client root context.
 */
export function apply(ctx) {
    const chatSources = new WeakMap();
    const chatSource = (binding) => {
        let source = chatSources.get(binding);
        if (source === undefined) {
            const target = ctx.uiConversation.binding(binding).target('chat');
            source = {
                getSnapshot: () => target.getSnapshot() ?? EMPTY_CHAT_SNAPSHOT,
                subscribe: listener => target.subscribe(listener),
            };
            chatSources.set(binding, source);
        }
        return source;
    };
    registerConversationNodes(ctx);
    registerChatNodeRenderers(ctx);
    ctx.uiSession.provide({
        hooks: ['chat'],
        resolve: binding => ({ hooks: { chat: chatSource(binding) } }),
    });
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-chat: dictionaries');
    const t = ctx.locale.bind(NS);
    const chatStore = createChatStore();
    const chatScrollPositions = new Map();
    const transcriptView = new TranscriptViewPolicy(ctx.settingsScope.bind({ namespace: CHAT_SETTINGS_NAMESPACE }));
    ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item',
        id: 'transcript-view',
        order: 12,
        locale: NS,
        inject: () => ({
            hooks: { transcriptView: transcriptView.mode },
            setTranscriptView: (mode) => { transcriptView.setMode(mode); },
        }),
    }, TranscriptViewRow));
    ctx.slots.inject('conversation.view', () => {
        const disposeView = ctx.slots.register({
            name: 'conversation.view',
            id: 'chat',
            order: 0,
            label: () => t('view.chat'),
            locale: NS,
            children: {
                'conversation.chat.node': { kind: 'keyed', scope: 'session', inject: CHAT_NODE_INJECT },
                'conversation.message.images': { kind: 'single', scope: 'session' },
            },
            store: chatStore,
            inject: (sessionId, actions) => {
                const session = ctx.sessions.binding(sessionId)?.session;
                if (session === undefined)
                    throw new Error(`ui-chat: unknown session "${sessionId}"`);
                return {
                    hooks: { transcriptView: transcriptView.mode },
                    openDetails: (target) => {
                        actions.select(target);
                        ctx.layout.openDetails();
                    },
                    fileMentions: (owner) => ctx.get('chatFileMentions')?.forClosing(owner),
                    openFile: async (path) => {
                        const cwd = ctx.sessions.list.getSnapshot().byId[sessionId]?.cwd;
                        const result = await ctx.remote.session.openWorkspacePath({
                            path: resolveWorkspacePath(cwd, path),
                        });
                        if (!result.ok)
                            throw new Error(`path open failed: ${result.error.message}`);
                    },
                    loadOlder: () => { void session.loadOlder(); },
                    loadImage: Object.assign((attachment) => ctx.uiConversation.imageUrl(sessionId, attachment), { peek: (attachment) => ctx.uiConversation.peekImageUrl(sessionId, attachment) }),
                    chatScroll: {
                        save: (position) => {
                            if (position === null)
                                chatScrollPositions.delete(sessionId);
                            else
                                chatScrollPositions.set(sessionId, position);
                        },
                        read: () => chatScrollPositions.get(sessionId) ?? null,
                    },
                    forkAt: (seq) => {
                        ctx.sessions.fork({ sessionId, atSeq: seq, increaseTitle: true })
                            .then((childId) => { ctx.sessions.open(childId); })
                            .catch(() => {
                            // Fork or child-title failure leaves the source view unchanged.
                        });
                    },
                };
            },
        }, ChatView);
        return disposeView;
    });
    ctx.slots.inject('conversation.composer.dock', () => ctx.slots.register({
        name: 'conversation.composer.dock', id: 'stats', order: 0, locale: NS,
    }, StatsLine));
    ctx.slots.inject('conversation.approval.detail', () => ctx.slots.register({ name: 'conversation.approval.detail' }, ApprovalCommand));
    ctx.slots.inject('details', () => ctx.slots.register({
        name: 'details',
        locale: NS,
        children: { 'conversation.details.tool': { kind: 'single', scope: 'session' } },
        store: chatStore,
        inject: () => ({ closeDetails: () => { ctx.layout.closeDetails(); } }),
    }, DetailsPanel));
}
