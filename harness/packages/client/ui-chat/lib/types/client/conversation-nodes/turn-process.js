import { isAppendSurfaceEvent } from '@deepseek-ai/dsh-session/surface';
import { hasAssistantReplyContent } from "../contract/assistant-content.js";
import { decodeTurnProcess, encodeTurnProcess, isSubagentDelegationTool, } from "../contract/turn-process.js";
import { CHAT_SYNTHETIC_SEQ_OFFSETS, chatNode } from "./common.js";
import { toAssistantBlocks } from "./event-projection.js";
function isChunkRunEvent(event) {
    return event.type === 'chunkrow/text-chunks'
        || event.type === 'chunkrow/reasoning-chunks'
        || event.type === 'chunkrow/tool-call-chunks';
}
function eventTurn(event) {
    const data = event.data;
    return typeof data.turn === 'number' ? data.turn : undefined;
}
function visibleAssistantEvent(event) {
    if (event.type === 'assistant/chunk') {
        const chunk = event.data.chunk;
        if (chunk.type === 'text-delta' || chunk.type === 'reasoning-delta')
            return chunk.text.trim() !== '';
        if (chunk.type === 'block-start') {
            return chunk.blockType !== 'text'
                && chunk.blockType !== 'reasoning'
                && chunk.blockType !== 'tool-call';
        }
        if (chunk.type !== 'block-end')
            return false;
        const block = chunk.block;
        if (block.type === 'tool-call')
            return false;
        if (block.type === 'text' || block.type === 'reasoning')
            return block.text.trim() !== '';
        return true;
    }
    return event.type === 'assistant/message'
        && isAppendSurfaceEvent(event)
        && toAssistantBlocks(event.data.message.content).some((block) => {
            if (block.kind === 'tool-call')
                return false;
            if (block.kind === 'text' || block.kind === 'reasoning')
                return block.text.trim() !== '';
            return true;
        });
}
function processEvidence(event) {
    if (isChunkRunEvent(event)) {
        if (event.type === 'chunkrow/tool-call-chunks')
            return undefined;
        const firstVisible = event.data.texts.findIndex(text => text.trim() !== '');
        return firstVisible < 0
            ? undefined
            : { kind: 'assistant', seq: event.seq + firstVisible, step: event.data.step };
    }
    if (visibleAssistantEvent(event)) {
        if (event.type !== 'assistant/chunk' && event.type !== 'assistant/message')
            return undefined;
        return { kind: 'assistant', seq: event.seq, step: event.data.step };
    }
    if (event.type === 'tool/call'
        || (event.type === 'tool/result' && isAppendSurfaceEvent(event))
        || event.type === 'llm/retry')
        return { kind: 'other', seq: event.seq };
    return undefined;
}
function turnLocation(context) {
    const location = context.start?.location ?? context.matches.at(-1)?.location;
    return location?.kind === 'turn' || location?.kind === 'step' ? location.turn : undefined;
}
function fallbackState(context) {
    const turn = context.matches.map(match => eventTurn(match.event)).find(candidate => candidate !== undefined);
    if (turn === undefined)
        return undefined;
    let state = {
        turn,
        assistantStartByStep: new Map(),
        messageCountByStep: new Map(),
        toolCallCount: 0,
        subagentCount: 0,
    };
    for (const match of context.matches)
        state = updateProcessState(state, match.event);
    return state;
}
function isFinalAssistant(data) {
    return data?.finalNode !== undefined;
}
function latestAnswer(turn) {
    const latestStep = turn.steps.at(-1);
    const data = latestStep?.data.get('assistant-step');
    if (!isFinalAssistant(data) || !hasAssistantReplyContent(data.blocks))
        return null;
    return data.blocks.some(block => block.kind === 'tool-call') ? null : data;
}
function processSpec(state, turn) {
    const controlAnchorSeq = Math.min(state.otherStartSeq ?? Number.POSITIVE_INFINITY, ...state.assistantStartByStep.values());
    if (!Number.isFinite(controlAnchorSeq))
        return null;
    const answer = latestAnswer(turn);
    const counts = {
        messageCount: answer === null
            ? [...state.messageCountByStep.values()].reduce((total, count) => total + count, 0)
            : [...state.messageCountByStep]
                .filter(([step]) => step < answer.step)
                .reduce((total, [, count]) => total + count, 0),
        toolCallCount: state.toolCallCount,
        subagentCount: state.subagentCount,
    };
    if (answer === null) {
        return {
            turn: turn.turn,
            controlAnchorSeq,
            processStartSeq: controlAnchorSeq,
            answerAnchorSeq: null,
            answerStep: null,
            inlineReasoning: false,
            ...counts,
        };
    }
    const inlineReasoning = answer.blocks.some(block => block.kind === 'reasoning' && block.text.trim() !== '');
    const earlierAssistantSeq = Math.min(...[...state.assistantStartByStep]
        .filter(([step]) => step < answer.step)
        .map(([, seq]) => seq));
    const externalProcessSeq = Math.min(state.otherStartSeq ?? Number.POSITIVE_INFINITY, earlierAssistantSeq);
    return {
        turn: turn.turn,
        controlAnchorSeq,
        processStartSeq: turn.start?.seq
            ?? (Number.isFinite(externalProcessSeq) ? externalProcessSeq : answer.finalNode.seq),
        answerAnchorSeq: answer.finalNode.seq,
        answerStep: answer.step,
        inlineReasoning,
        ...counts,
    };
}
function updateProcessState(state, event) {
    let current = state;
    if (event.type === 'assistant/message'
        && isAppendSurfaceEvent(event)
        && hasAssistantReplyContent(toAssistantBlocks(event.data.message.content))) {
        const messageCountByStep = new Map(current.messageCountByStep);
        messageCountByStep.set(event.data.step, (messageCountByStep.get(event.data.step) ?? 0) + 1);
        current = { ...current, messageCountByStep };
    }
    if (event.type === 'tool/call') {
        const subagent = isSubagentDelegationTool(event.data.name);
        current = {
            ...current,
            toolCallCount: current.toolCallCount + (subagent ? 0 : 1),
            subagentCount: current.subagentCount + (subagent ? 1 : 0),
        };
    }
    const evidence = processEvidence(event);
    if (evidence === undefined)
        return current;
    if (evidence.kind === 'other') {
        return current.otherStartSeq === undefined ? { ...current, otherStartSeq: evidence.seq } : current;
    }
    if (current.assistantStartByStep.has(evidence.step))
        return current;
    const assistantStartByStep = new Map(current.assistantStartByStep);
    assistantStartByStep.set(evidence.step, evidence.seq);
    return { ...current, assistantStartByStep };
}
/** Turn-scoped process range and answer-boundary Definition. */
export const turnProcessDefinition = {
    kind: 'turn-process',
    target: 'chat',
    match: (event) => {
        if (event.type === 'turn/start')
            return { id: String(event.data.turn), role: 'start' };
        const turn = eventTurn(event);
        if (turn === undefined)
            return null;
        if (event.type === 'assistant/chunk'
            || event.type === 'assistant/message'
            || isChunkRunEvent(event)
            || event.type === 'tool/call'
            || event.type === 'tool/result'
            || event.type === 'llm/retry'
            || event.type === 'step/start'
            || event.type === 'step/end'
            || event.type === 'turn/end') {
            return { id: String(turn), role: 'update' };
        }
        return null;
    },
    start: (_context, match) => {
        if (match.event.type !== 'turn/start')
            throw new Error('turn-process start requires turn/start');
        return {
            turn: match.event.data.turn,
            assistantStartByStep: new Map(),
            messageCountByStep: new Map(),
            toolCallCount: 0,
            subagentCount: 0,
        };
    },
    update: (context, match) => updateProcessState(context.state, match.event),
    publication: (match) => {
        if (isChunkRunEvent(match.event))
            return 'animation-frame';
        if (match.event.type === 'assistant/chunk') {
            const type = match.event.data.chunk.type;
            return type === 'usage' || type === 'finish' ? 'none' : 'animation-frame';
        }
        return 'immediate';
    },
    buildLocationData: (context, scope) => {
        if (scope !== 'turn')
            return null;
        const state = context.state ?? fallbackState(context);
        if (state === undefined)
            return null;
        const turn = turnLocation(context);
        if (turn === undefined)
            return null;
        const spec = processSpec(state, turn);
        return spec === null ? null : {
            kind: 'turn',
            turn: turn.turn,
            key: 'turn-process',
            value: encodeTurnProcess(spec),
        };
    },
    buildViewNode: (context) => {
        const turn = turnLocation(context);
        const signature = turn?.data.get('turn-process');
        if (turn === undefined || signature === undefined)
            return null;
        const data = decodeTurnProcess(signature);
        return chatNode(context, 'turn-process', data.controlAnchorSeq + CHAT_SYNTHETIC_SEQ_OFFSETS.processControl, data);
    },
};
/**
 * Register the Turn-scoped process disclosure projection.
 * @param ctx - owning UI Conversation context.
 */
export function registerTurnProcess(ctx) {
    ctx.uiConversation.events.register(turnProcessDefinition);
}
