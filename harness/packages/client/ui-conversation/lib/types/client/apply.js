import { createSnapshotStore } from '@deepseek-ai/dsh-client-store';
import { resolveSlotLabel } from '@deepseek-ai/dsh-client-ui-slots';
import { UiConversation } from "./conversation/assembly.js";
import { KNOWLEDGE_GRAPH_MAX_BYTES, parseKnowledgeGraphResponse, } from "./contract/knowledge-graph.js";
import { createConversationStore } from "./stores.js";
import { ConversationController, UnsupportedImageMediaTypeError } from "./service.js";
import { ComposerBlockRegistry } from "./input/blocks.js";
import { InputHub } from "./input/hub.js";
import { ComposerSubmissionPolicy } from "./input/submission-policy.js";
import { queueDockEntry } from "./queue/QueueDock.js";
import { EnterBehaviorRow } from "./settings/EnterBehaviorRow.js";
import { ConversationRoot } from "./skeleton/ConversationRoot.js";
import { ConversationSession, ConversationSessionHeader } from "./skeleton/ConversationSession.js";
import { InputBar } from "./skeleton/InputBar.js";
import { todoDockEntry } from "./skeleton/TodoPanel.js";
import { en, NS, zh } from "./locales.js";
import { CONVERSATION_SETTINGS_NAMESPACE } from "../submission-settings.js";
/** Services required by the Conversation plugin. */
export const inject = [
    'slots', 'sessions', 'uiSession', 'uiWorkspace', 'locale', 'settingsScope',
];
// Stable no-session sources keep the renderer's observable-hook cache and
// hook order unchanged across current-Session transitions.
const ABSENT_NOTICES = {
    getSnapshot: () => null,
    subscribe: () => () => { },
};
const ABSENT_BLOCK = {
    getSnapshot: () => undefined,
    subscribe: () => () => { },
};
const EMPTY_LEXICON = new Map();
const ABSENT_LEXICON = {
    getSnapshot: () => EMPTY_LEXICON,
    subscribe: () => () => { },
};
const ABSENT_MENU_LAUNCHER = {
    getSnapshot: () => null,
    subscribe: () => () => { },
};
/** Resolve the session-scoped Conversation action face, failing loud. */
function scopedConversation(sessions, id) {
    const scoped = sessions.scope(id);
    if (scoped === undefined)
        throw new Error(`ui-conversation: session "${id}" resolved no scope`);
    const conversation = scoped.get('conversation');
    if (conversation === undefined) {
        throw new Error('ui-conversation: conversation service unavailable through the session scope');
    }
    return conversation;
}
/** Resolve package-internal attachment operations from the public service. */
function concreteConversation(ctx) {
    const conversation = ctx.get('conversation');
    if (conversation === undefined)
        throw new Error('ui-conversation: conversation service unavailable');
    return conversation;
}
/**
 * Create the session-scoped, read-only Knowledge Graph transport.
 * @returns a loader that accepts only bounded JSON and exposes cancellation.
 */
function createKnowledgeGraphTransport() {
    let controller;
    return {
        load: async () => {
            controller?.abort();
            const next = new AbortController();
            controller = next;
            try {
                const response = await fetch('/api/knowledge-graph', {
                    method: 'GET',
                    headers: { Accept: 'application/json' },
                    signal: next.signal,
                });
                const contentLength = Number(response.headers.get('content-length'));
                if (Number.isFinite(contentLength) && contentLength > KNOWLEDGE_GRAPH_MAX_BYTES) {
                    return { ok: false, error: 'Knowledge Graph response exceeds 512 KiB' };
                }
                const bytes = await response.arrayBuffer();
                if (bytes.byteLength > KNOWLEDGE_GRAPH_MAX_BYTES) {
                    return { ok: false, error: 'Knowledge Graph response exceeds 512 KiB' };
                }
                let payload;
                try {
                    payload = JSON.parse(new TextDecoder().decode(bytes));
                }
                catch {
                    return { ok: false, error: 'Knowledge Graph response was not valid JSON' };
                }
                const parsed = parseKnowledgeGraphResponse(payload);
                return response.ok
                    ? parsed
                    : parsed.ok
                        ? { ok: false, error: `Knowledge Graph request failed (${response.status})` }
                        : parsed;
            }
            catch (error) {
                if (next.signal.aborted)
                    throw error;
                return { ok: false, error: error instanceof Error ? error.message : String(error) };
            }
            finally {
                if (controller === next)
                    controller = undefined;
            }
        },
        abort: () => {
            controller?.abort();
            controller = undefined;
        },
    };
}
/**
 * Mount the Conversation core and target-neutral presentation.
 * @param ctx - Client root context.
 */
export function apply(ctx) {
    const sessions = ctx.sessions;
    const slots = ctx.slots;
    const workspaceNavigation = ctx.get('uiWorkspace');
    const uiConversation = new UiConversation(ctx, sessions);
    ctx.effect(() => ctx.locale.register(NS, { zh, en }), 'ui-conversation: dictionaries');
    const t = ctx.locale.bind(NS);
    const conversationStore = createConversationStore();
    const sidePanelAvailable = {
        getSnapshot: () => slots.entries('conversation.session.side-panel').length > 0,
        subscribe: listener => slots.subscribe('conversation.session.side-panel', listener),
    };
    const conversationPreferenceActions = new Map();
    ctx.effect(() => {
        if (typeof window === 'undefined')
            return () => { };
        const onStorage = (event) => {
            const prefix = 'dsh.conversation.';
            if (event.key === null || !event.key.startsWith(prefix) || event.newValue === null)
                return;
            const actions = conversationPreferenceActions.get(event.key.slice(prefix.length));
            if (actions === undefined)
                return;
            try {
                const value = JSON.parse(event.newValue);
                if (typeof value.knowledgeGraphOpen === 'boolean') {
                    actions.setKnowledgeGraphOpen(value.knowledgeGraphOpen);
                }
                if (typeof value.knowledgeGraphWidth === 'number' && Number.isFinite(value.knowledgeGraphWidth)) {
                    actions.setKnowledgeGraphWidth(value.knowledgeGraphWidth);
                }
                if (typeof value.sidePanelOpen === 'boolean')
                    actions.setSidePanelOpen(value.sidePanelOpen);
                if (typeof value.sidePanelWidth === 'number' && Number.isFinite(value.sidePanelWidth)) {
                    actions.setSidePanelWidth(value.sidePanelWidth);
                }
            }
            catch {
                // A storage event from another tab is untrusted; the active store keeps its current state.
            }
        };
        window.addEventListener('storage', onStorage);
        return () => { window.removeEventListener('storage', onStorage); conversationPreferenceActions.clear(); };
    }, 'ui-conversation: Conversation panel preference storage');
    const submissionPolicy = new ComposerSubmissionPolicy(ctx.settingsScope.bind({ namespace: CONVERSATION_SETTINGS_NAMESPACE }));
    ctx.slots.inject('settings.general.item', () => ctx.slots.register({
        name: 'settings.general.item',
        id: 'composer-enter',
        order: 20,
        locale: NS,
        inject: () => ({
            hooks: { busyEnter: submissionPolicy.busyEnter },
            setBusyEnter: (behavior) => { submissionPolicy.setBusyEnter(behavior); },
        }),
    }, EnterBehaviorRow));
    const viewTabs = () => {
        const tabs = [];
        for (const entry of slots.entries('conversation.view')) {
            /* v8 ignore next -- list registration validates id at load. */
            if (entry.options.id === undefined)
                continue;
            tabs.push({
                id: entry.options.id,
                label: resolveSlotLabel(entry.options.label) ?? entry.options.id,
            });
        }
        return tabs;
    };
    const conversationViews = createSnapshotStore(viewTabs());
    const refreshViews = () => {
        const current = conversationViews.getSnapshot();
        const next = viewTabs();
        if (current.length === next.length
            && current.every((tab, index) => {
                const candidate = next.at(index);
                return candidate !== undefined && tab.id === candidate.id && tab.label === candidate.label;
            }))
            return;
        conversationViews.set(next);
    };
    ctx.effect(() => {
        const disposeViews = slots.subscribe('conversation.view', refreshViews);
        const disposeLocale = ctx.locale.subscribe(refreshViews);
        return () => {
            disposeLocale();
            disposeViews();
        };
    }, 'ui-conversation: View roster');
    const inputHub = new InputHub(ctx, t);
    const composerBlocks = new ComposerBlockRegistry();
    // Conversation assembly and input share the Session binding lifecycle. The
    // source roster is installed before any consuming Slot entry.
    ctx.uiSession.provide({
        hooks: ['conversation', 'input'],
        props: ['inputActions'],
        resolve: (binding) => {
            const shell = inputHub.shellFor(binding);
            return {
                hooks: {
                    conversation: uiConversation.binding(binding).snapshot,
                    input: shell.state,
                },
                props: { inputActions: shell.actions },
            };
        },
    });
    const registerConversationRoot = () => slots.register({
        name: 'conversation',
        locale: NS,
        children: {
            'conversation.session': { kind: 'single', scope: 'session' },
            'conversation.session.header': { kind: 'single', scope: 'session' },
            'conversation.composer': { kind: 'chain', scope: 'session' },
            'conversation.composer.bar': { kind: 'single', scope: 'session-maybe' },
            'conversation.input.overlay': { kind: 'list', scope: 'session' },
            'conversation.input.dock': { kind: 'list', scope: 'session' },
            'conversation.composer.dock': { kind: 'list', scope: 'session' },
            'conversation.input.left': { kind: 'list', scope: 'session' },
            'conversation.input.right': { kind: 'list', scope: 'session' },
            'conversation.hero.brand.mark': { kind: 'single', scope: 'root' },
            'conversation.hero.workspace': { kind: 'single', scope: 'root' },
            'conversation.hero.agentPreset': { kind: 'single', scope: 'root' },
        },
        inject: (sessionId) => ({
            hooks: {
                composerBlock: sessionId === undefined ? ABSENT_BLOCK : composerBlocks.storeFor(sessionId),
            },
            selectWorkspace: async (workspaceId) => {
                const nextId = await workspaceNavigation.connectWorkspace(workspaceId);
                if (sessionId !== undefined && nextId !== sessionId) {
                    const from = inputHub.shell(sessionId);
                    const draft = from.snapshot.draft;
                    const imageIds = from.snapshot.imageIds;
                    const next = inputHub.shell(nextId);
                    if (imageIds.length === 0 || next.addImages(imageIds)) {
                        if (draft !== '') {
                            next.setDraft(draft);
                            from.setDraft('');
                        }
                        if (imageIds.length > 0) {
                            for (const id of imageIds)
                                from.removeImage(id);
                        }
                    }
                }
                sessions.open(nextId);
            },
        }),
    }, ConversationRoot);
    const registerConversationSession = () => slots.register({
        name: 'conversation.session',
        locale: NS,
        children: {
            'conversation.view': { kind: 'list', scope: 'session' },
            'conversation.session.side-panel': { kind: 'single', scope: 'session' },
            'conversation.activity.helpers': { kind: 'single', scope: 'session' },
        },
        store: conversationStore,
        inject: (sessionId, _actions) => {
            conversationPreferenceActions.set(String(sessionId), _actions);
            return {
                hooks: { conversationViews, sidePanelAvailable },
                bindDraftMirror: write => inputHub.shell(sessionId).bindMirror(write),
                stageAttachment: (file, caption, options) => Promise.resolve().then(() => {
                    const session = sessions.binding(sessionId)?.session;
                    if (session === undefined)
                        throw new Error(`ui-conversation: session "${sessionId}" resolved no binding`);
                    if (session.getSnapshot().subagent !== null) {
                        const message = t('image.subagentUnsupported');
                        inputHub.shell(sessionId).notify('error', message);
                        throw new Error(message);
                    }
                    const conversation = concreteConversation(ctx);
                    const shell = inputHub.shell(sessionId);
                    let images;
                    try {
                        images = conversation.createDraftImages([file], {
                            sessionId,
                            ...options,
                        });
                    }
                    catch (error) {
                        if (error instanceof UnsupportedImageMediaTypeError) {
                            throw new Error(t('image.unsupportedType'));
                        }
                        throw error;
                    }
                    if (!shell.addImages(images.map(image => image.id))) {
                        conversation.releaseDraftImages(images);
                        throw new Error(t('image.dropBlocked'));
                    }
                    try {
                        const text = caption.trim() === '' ? '' : caption;
                        shell.appendDraft(text);
                    }
                    catch (error) {
                        for (const image of images)
                            shell.removeImage(image.id);
                        conversation.releaseDraftImages(images);
                        throw error;
                    }
                }),
                knowledgeGraph: createKnowledgeGraphTransport(),
                releaseKnowledgeGraphStorage: () => {
                    if (conversationPreferenceActions.get(String(sessionId)) === _actions) {
                        conversationPreferenceActions.delete(String(sessionId));
                    }
                },
            };
        },
    }, ConversationSession);
    const registerConversationHeader = () => slots.register({
        name: 'conversation.session.header',
        locale: NS,
        children: {
            'conversation.session.header.lineage': { kind: 'single', scope: 'session' },
            'conversation.session.header.actions': { kind: 'list', scope: 'session' },
            'conversation.session.header.utilities': { kind: 'list', scope: 'session' },
        },
        store: conversationStore,
        inject: () => ({
            hooks: { conversationViews, sidePanelAvailable },
            open: (id) => { sessions.open(id); },
        }),
    }, ConversationSessionHeader);
    const registerComposerBar = () => slots.register({
        name: 'conversation.composer.bar',
        locale: NS,
        children: {
            'conversation.input.attachments': { kind: 'single', scope: 'session-maybe' },
            'conversation.input.plan': { kind: 'single', scope: 'session' },
            'conversation.input.model': { kind: 'single', scope: 'session' },
        },
        inject: (sessionId) => {
            if (sessionId === undefined) {
                return {
                    keyboard: undefined,
                    addImages: undefined,
                    removeImage: undefined,
                    draftImages: undefined,
                    resolveSubmitMode: (running, gesture, steeringAvailable) => submissionPolicy.resolve(running, gesture, steeringAvailable),
                    toggleCommandMenu: undefined,
                    stop: undefined,
                    command: undefined,
                    hooks: {
                        notices: ABSENT_NOTICES,
                        lexicon: ABSENT_LEXICON,
                        menuLauncher: ABSENT_MENU_LAUNCHER,
                    },
                };
            }
            const conversation = concreteConversation(ctx);
            const shell = inputHub.shell(sessionId);
            const inputTriggers = inputHub.inputTriggers(sessionId);
            return {
                keyboard: shell,
                addImages: (files) => {
                    try {
                        const images = conversation.createDraftImages(files);
                        if (!shell.addImages(images.map(image => image.id))) {
                            conversation.releaseDraftImages(images);
                        }
                        return null;
                    }
                    catch (error) {
                        if (error instanceof UnsupportedImageMediaTypeError)
                            return t('image.unsupportedType');
                        return error instanceof Error ? error.message : String(error);
                    }
                },
                removeImage: (id) => {
                    conversation.releaseDraftImage(id);
                    shell.removeImage(id);
                },
                draftImages: ids => conversation.draftImages(ids),
                resolveSubmitMode: (running, gesture, steeringAvailable) => submissionPolicy.resolve(running, gesture, steeringAvailable),
                toggleCommandMenu: inputTriggers === undefined
                    ? undefined
                    : (selection) => {
                        shell.dismissPopup();
                        const snapshot = shell.snapshot;
                        inputTriggers.toggleSource('command', {
                            trigger: '/',
                            query: '',
                            quoted: false,
                            position: snapshot.draft.slice(0, selection.start).trim() === '' ? 'leading' : 'inline',
                            span: { ...selection, draftRev: snapshot.draftRev },
                        });
                    },
                stop: () => {
                    scopedConversation(sessions, sessionId).cancel().catch(() => {
                        // Stop failure is published through Session promptError.
                    });
                },
                command: async (line) => {
                    const session = sessions.binding(sessionId)?.session;
                    if (session === undefined)
                        return false;
                    const result = await session.command(line);
                    return result.ok && result.value.matched;
                },
                hooks: {
                    notices: shell.notices,
                    lexicon: shell.lexicon,
                    menuLauncher: inputTriggers?.launcher ?? ABSENT_MENU_LAUNCHER,
                },
            };
        },
    }, InputBar);
    slots.inject('conversation', function* () {
        yield registerConversationRoot();
        yield registerConversationSession();
        yield registerConversationHeader();
        yield registerComposerBar();
    });
    ctx.plugin(ConversationController, { input: inputHub, blocks: composerBlocks });
    ctx.plugin(todoDockEntry);
    ctx.plugin(queueDockEntry);
}
