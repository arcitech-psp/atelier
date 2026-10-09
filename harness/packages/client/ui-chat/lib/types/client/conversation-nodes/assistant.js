import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface';
import { CHAT_SYNTHETIC_SEQ_OFFSETS, chatNode } from "./common.js";
import { emptyAssistantBlock, isTokenDelta, toAssistantBlock, toAssistantBlocks, } from "./event-projection.js";
function isChunkRunEvent(event) {
    return event.type === 'chunkrow/text-chunks'
        || event.type === 'chunkrow/reasoning-chunks'
        || event.type === 'chunkrow/tool-call-chunks';
}
function initialState(turn, step) {
    return {
        turn,
        step,
        blocks: [],
        visibleBlocks: 0,
        firstVisibleSeq: undefined,
        firstVisibleTime: undefined,
        firstTokenTime: undefined,
        hidden: false,
        final: undefined,
        usage: undefined,
    };
}
function compactBlocks(blocks) {
    return blocks.filter((block) => block !== undefined);
}
function blockIsVisible(block) {
    if (block === undefined || block.kind === 'tool-call')
        return false;
    if (block.kind === 'text' || block.kind === 'reasoning')
        return block.text.trim() !== '';
    return true;
}
function countVisibleBlocks(blocks) {
    let count = 0;
    for (const block of blocks)
        if (blockIsVisible(block))
            count++;
    return count;
}
function hasVisibleContent(blocks) {
    return blocks.some(blockIsVisible);
}
function hasInterruptionEvidence(blocks) {
    return blocks.some((block) => {
        if (block.kind === 'text' || block.kind === 'reasoning')
            return block.text.trim() !== '';
        return true;
    });
}
function resetForRetry(state) {
    return {
        ...initialState(state.turn, state.step),
        firstTokenTime: state.firstTokenTime,
        hidden: true,
    };
}
function updateChunk(state, match) {
    if (match.event.type !== 'assistant/chunk')
        return state;
    const chunk = match.event.data.chunk;
    const blocks = [...state.blocks];
    let changedIndex = -1;
    let previousVisible = false;
    switch (chunk.type) {
        case 'block-start':
            changedIndex = chunk.index;
            previousVisible = blockIsVisible(blocks[chunk.index]);
            blocks[chunk.index] = emptyAssistantBlock(chunk.blockType);
            break;
        case 'text-delta': {
            const previous = blocks[chunk.index];
            changedIndex = chunk.index;
            previousVisible = blockIsVisible(previous);
            blocks[chunk.index] = { kind: 'text', text: (previous?.kind === 'text' ? previous.text : '') + chunk.text };
            break;
        }
        case 'reasoning-delta': {
            const previous = blocks[chunk.index];
            changedIndex = chunk.index;
            previousVisible = blockIsVisible(previous);
            blocks[chunk.index] = { kind: 'reasoning', text: (previous?.kind === 'reasoning' ? previous.text : '') + chunk.text };
            break;
        }
        case 'tool-call-delta': {
            const previous = blocks[chunk.index];
            changedIndex = chunk.index;
            previousVisible = blockIsVisible(previous);
            const base = previous?.kind === 'tool-call'
                ? previous
                : { kind: 'tool-call', callId: '', name: '', argsRaw: '' };
            blocks[chunk.index] = {
                kind: 'tool-call',
                callId: base.callId || String(chunk.id),
                name: chunk.name ?? base.name,
                argsRaw: base.argsRaw + chunk.argumentsDelta,
            };
            break;
        }
        case 'block-end':
            changedIndex = chunk.index;
            previousVisible = blockIsVisible(blocks[chunk.index]);
            blocks[chunk.index] = toAssistantBlock(chunk.block);
            break;
        case 'usage':
            return { ...state, usage: chunk.usage };
        default:
            return state;
    }
    const visibleBlocks = state.visibleBlocks
        - Number(previousVisible)
        + Number(blockIsVisible(blocks[changedIndex]));
    const firstToken = isTokenDelta(chunk);
    return {
        ...state,
        blocks,
        visibleBlocks,
        hidden: visibleBlocks > 0 ? false : state.hidden,
        ...visibleBlocks > 0 && state.firstVisibleSeq === undefined
            ? { firstVisibleSeq: match.event.seq, firstVisibleTime: match.event.time }
            : {},
        ...firstToken && state.firstTokenTime === undefined
            ? { firstTokenTime: match.event.time }
            : {},
    };
}
function chunkRunBoundaries(event, needsToken, needsVisible, visibleFromStart) {
    const fragments = event.type === 'chunkrow/tool-call-chunks' ? event.data.args : event.data.texts;
    const nameStartsToken = event.type === 'chunkrow/tool-call-chunks'
        && Object.hasOwn(event.data, 'name');
    let firstTokenTime;
    let firstVisible;
    let time = event.time;
    for (let index = 0; index < fragments.length; index++) {
        const fragment = fragments[index];
        if (needsToken && firstTokenTime === undefined && (nameStartsToken || fragment !== '')) {
            firstTokenTime = time;
        }
        if (needsVisible && firstVisible === undefined
            && (visibleFromStart
                || (event.type !== 'chunkrow/tool-call-chunks' && fragment.trim() !== ''))) {
            firstVisible = { seq: event.seq + index, time };
        }
        if ((!needsToken || firstTokenTime !== undefined)
            && (!needsVisible || firstVisible !== undefined))
            break;
        time += event.data.dt[index] ?? 0;
    }
    return { firstTokenTime, firstVisible };
}
function updateChunkRun(state, event) {
    const blocks = [...state.blocks];
    const previous = blocks[event.data.index];
    const previousVisible = blockIsVisible(previous);
    let visibleFromStart = state.visibleBlocks - Number(previousVisible) > 0;
    if (event.type === 'chunkrow/text-chunks') {
        const text = previous?.kind === 'text' ? previous.text : '';
        visibleFromStart ||= text.trim() !== '';
        blocks[event.data.index] = { kind: 'text', text: text + event.data.texts.join('') };
    }
    else if (event.type === 'chunkrow/reasoning-chunks') {
        const text = previous?.kind === 'reasoning' ? previous.text : '';
        visibleFromStart ||= text.trim() !== '';
        blocks[event.data.index] = { kind: 'reasoning', text: text + event.data.texts.join('') };
    }
    else {
        const base = previous?.kind === 'tool-call'
            ? previous
            : { kind: 'tool-call', callId: '', name: '', argsRaw: '' };
        blocks[event.data.index] = {
            kind: 'tool-call',
            callId: base.callId || String(event.data.id),
            name: Object.hasOwn(event.data, 'name') ? event.data.name : base.name,
            argsRaw: base.argsRaw + event.data.args.join(''),
        };
    }
    const boundaries = chunkRunBoundaries(event, state.firstTokenTime === undefined, state.firstVisibleSeq === undefined, visibleFromStart);
    const visibleBlocks = state.visibleBlocks
        - Number(previousVisible)
        + Number(blockIsVisible(blocks[event.data.index]));
    return {
        ...state,
        blocks,
        visibleBlocks,
        hidden: visibleBlocks > 0 ? false : state.hidden,
        ...(boundaries.firstVisible === undefined ? {} : {
            firstVisibleSeq: boundaries.firstVisible.seq,
            firstVisibleTime: boundaries.firstVisible.time,
        }),
        ...(boundaries.firstTokenTime === undefined ? {} : {
            firstTokenTime: boundaries.firstTokenTime,
        }),
    };
}
function closedBoundary(location) {
    if (location.kind === 'step' && location.step.status === 'closed' && location.step.end !== undefined) {
        return location.step.end;
    }
    if ((location.kind === 'step' || location.kind === 'turn')
        && location.turn.status === 'closed' && location.turn.end !== undefined) {
        return location.turn.end;
    }
    return undefined;
}
function finalNode(state, context) {
    const final = state.final;
    if (final?.event.type === 'assistant/message') {
        const event = final.event;
        return {
            kind: 'assistant',
            seq: event.seq,
            messageId: event.data.message.id,
            time: event.time,
            turn: state.turn,
            step: state.step,
            blocks: toAssistantBlocks(event.data.message.content),
            usage: event.data.usage,
            timing: {
                stepStartTime: context.start?.event.time ?? null,
                firstTokenTime: state.firstTokenTime ?? null,
                completedTime: event.time,
            },
            ...event.data.interrupted === true ? { interrupted: true } : {},
        };
    }
    const location = context.start?.location ?? context.matches.at(-1)?.location;
    const boundary = location === undefined ? undefined : closedBoundary(location);
    if (boundary === undefined)
        return undefined;
    const blocks = compactBlocks(state.blocks);
    if (!hasInterruptionEvidence(blocks))
        return undefined;
    return {
        kind: 'assistant',
        seq: boundary.seq + CHAT_SYNTHETIC_SEQ_OFFSETS.interruptedAssistant,
        time: boundary.time,
        turn: state.turn,
        step: state.step,
        blocks,
        interrupted: true,
    };
}
function fallbackState(context) {
    let state;
    for (const match of context.matches) {
        if (isChunkRunEvent(match.event)) {
            state ??= initialState(match.event.data.turn, match.event.data.step);
            state = updateChunkRun(state, match.event);
            continue;
        }
        if (match.event.type === 'assistant/chunk') {
            state ??= initialState(match.event.data.turn, match.event.data.step);
            state = updateChunk(state, match);
            continue;
        }
        if (match.event.type === 'assistant/message') {
            state ??= initialState(match.event.data.turn, match.event.data.step);
            const blocks = toAssistantBlocks(match.event.data.message.content);
            state = {
                ...state,
                blocks,
                visibleBlocks: countVisibleBlocks(blocks),
                hidden: false,
                final: match,
                usage: match.event.data.usage,
            };
            continue;
        }
        if (match.event.type === 'llm/retry' && state !== undefined) {
            state = resetForRetry(state);
        }
    }
    return state;
}
function projectAssistant(context) {
    const state = context.state ?? fallbackState(context);
    if (state === undefined)
        return undefined;
    const settled = finalNode(state, context);
    const blocks = settled?.blocks ?? compactBlocks(state.blocks);
    const visible = settled === undefined ? state.visibleBlocks > 0 : hasVisibleContent(blocks);
    const status = settled?.interrupted === true
        ? 'interrupted'
        : settled === undefined ? 'running' : 'settled';
    const anchorSeq = settled?.seq ?? state.firstVisibleSeq ?? context.matches[0]?.event.seq ?? 0;
    const time = settled?.time ?? state.firstVisibleTime ?? context.matches[0]?.event.time ?? 0;
    return {
        anchorSeq,
        visible,
        settled,
        data: {
            status,
            turn: state.turn,
            step: state.step,
            blocks,
            time,
            ...state.usage === undefined ? {} : { usage: state.usage },
            ...settled === undefined ? {} : { finalNode: settled },
        },
    };
}
/** Per-step Assistant streaming/final/interruption Definition. */
export const assistantDefinition = {
    kind: 'assistant-step',
    target: 'chat',
    match: (event) => {
        if (event.type === 'step/start')
            return { id: `${event.data.turn}:${event.data.step}`, role: 'start' };
        if (event.type === 'assistant/chunk'
            || (event.type === 'assistant/message' && isAppendSurfaceEvent(event))) {
            return { id: `${event.data.turn}:${event.data.step}`, role: 'update' };
        }
        if (isChunkRunEvent(event)) {
            return { id: `${event.data.turn}:${event.data.step}`, role: 'update' };
        }
        if (event.type === 'llm/retry') {
            return { id: `${event.data.turn}:${event.data.step}`, role: 'update' };
        }
        return null;
    },
    start: (_context, match) => {
        if (match.event.type !== 'step/start')
            throw new Error('assistant-step start requires step/start');
        return initialState(match.event.data.turn, match.event.data.step);
    },
    update: (context, match) => {
        if (isChunkRunEvent(match.event)) {
            return updateChunkRun(context.state, match.event);
        }
        if (match.event.type === 'assistant/chunk')
            return updateChunk(context.state, match);
        if (match.event.type === 'assistant/message') {
            const blocks = toAssistantBlocks(match.event.data.message.content);
            return {
                ...context.state,
                blocks,
                visibleBlocks: countVisibleBlocks(blocks),
                hidden: false,
                final: match,
                usage: match.event.data.usage,
            };
        }
        if (match.event.type === 'llm/retry') {
            return resetForRetry(context.state);
        }
        return context.state;
    },
    publication: (match) => {
        if (match.event.type === 'step/start')
            return 'none';
        if (isChunkRunEvent(match.event))
            return 'animation-frame';
        if (match.event.type !== 'assistant/chunk')
            return 'immediate';
        const type = match.event.data.chunk.type;
        return type === 'usage' || type === 'finish' ? 'none' : 'animation-frame';
    },
    buildLocationData: (context, scope) => {
        if (scope !== 'step')
            return null;
        const projected = projectAssistant(context);
        if (projected === undefined)
            return null;
        return {
            kind: 'step',
            turn: projected.data.turn,
            step: projected.data.step,
            key: 'assistant-step',
            value: projected.data,
        };
    },
    buildViewNode: (context) => {
        const projected = projectAssistant(context);
        if (projected === undefined)
            return null;
        if (projected.settled === undefined && !projected.visible) {
            const state = context.state ?? fallbackState(context);
            if (state === undefined)
                return null;
            const current = context.current.get('chat');
            if (!state.hidden || current === undefined || current === null)
                return null;
        }
        return chatNode(context, 'assistant-step', projected.anchorSeq, projected.data, {
            visibility: projected.settled?.interrupted === true || projected.visible ? 'visible' : 'hidden',
        });
    },
};
/**
 * Register the Assistant lifecycle business contribution.
 * @param ctx - owning UI Conversation context.
 */
export function registerAssistantConversationNode(ctx) {
    ctx.uiConversation.events.register(assistantDefinition);
}
