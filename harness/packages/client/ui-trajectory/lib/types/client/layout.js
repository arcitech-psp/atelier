import { formatElapsedSeconds } from "./trajectory-record.js";
import { COMPACTION_INTERRUPTED_ERROR } from "./copy-codes.js";
function layoutEntryOrder(entry) {
    return entry.kind === 'system' && entry.change.kind === 'initial'
        ? Number.NEGATIVE_INFINITY
        : entry.seq;
}
function inputCellDetail(node, t) {
    // An empty text block yields an empty preview; treat it as absent so an
    // image-bearing record still labels its row instead of rendering blank.
    const preview = previewContent(node.content);
    const previewMarkdown = preview === '' ? undefined : preview;
    const images = imageBlockCount(node.content);
    return {
        text: previewMarkdown === undefined && images > 0
            ? t('layout.imageOnly', { count: images })
            : '',
        ...(previewMarkdown === undefined ? {} : { previewMarkdown }),
        sourceSeq: node.seq,
        messageSource: node.source,
        inputDetail: detailContent(node.content),
        sourceBlocks: node.content.map(block => sourceBlock(block)),
        timeSeconds: 0,
        startedAt: finiteTime(node.time),
    };
}
/**
 * Fold a snapshot into turn → Message/Step groups with expanded cells.
 * @param input - nodes plus in-flight partial/runningCalls.
 * @param t - Trajectory locale translator.
 * @returns turns ordered by first appearance.
 */
export function deriveTrajectoryLayout(input, t) {
    const { nodes, eventLocations, partial, runningCalls, requests = [], callSchemas, } = input;
    const resultByCall = indexResults(nodes);
    const callById = new Map(resultByCall);
    for (const call of runningCalls)
        callById.set(call.callId, call);
    const emittedCallIds = indexAssistantCallIds(nodes);
    const followingAssistants = indexFollowingAssistants(nodes);
    const callStartById = new Map();
    for (const result of resultByCall.values()) {
        const startedAt = finiteTime(result.callTime);
        if (startedAt !== null)
            callStartById.set(result.callId, startedAt);
    }
    for (const call of runningCalls) {
        const startedAt = finiteTime(call.time);
        if (startedAt !== null)
            callStartById.set(call.callId, startedAt);
    }
    const turns = new Map();
    const standaloneCompactions = [];
    let index = 0;
    let prevAbsTime = null;
    let lastAssistantTurn = null;
    const bucket = (turn) => {
        let entry = turns.get(turn);
        if (entry === undefined) {
            entry = { groups: [] };
            turns.set(turn, entry);
        }
        return entry;
    };
    const pushMessage = (turn, laid) => {
        const groups = bucket(turn).groups;
        const last = groups.at(-1);
        if (last?.title === t('group.message')) {
            last.laid.push(laid);
            return;
        }
        groups.push({ title: t('group.message'), laid: [laid] });
    };
    const pushStep = (turn, step, laid) => {
        if (laid.length === 0)
            return;
        const groups = bucket(turn).groups;
        const title = t('group.step', { step });
        const existing = groups.find(group => group.title === title);
        if (existing !== undefined) {
            existing.laid.push(...laid);
            return;
        }
        groups.push({ title, laid: [...laid] });
    };
    const pushStepInput = (turn, step, laid) => {
        if (laid.length === 0)
            return;
        const groups = bucket(turn).groups;
        const title = t('group.step', { step });
        const existing = groups.find(group => group.title === title);
        if (existing === undefined) {
            groups.push({ title, laid: [...laid] });
            return;
        }
        const request = existing.laid.findIndex(entry => entry.cell.requestOnly === true);
        if (request === -1)
            existing.laid.push(...laid);
        else
            existing.laid.splice(request, 0, ...laid);
    };
    const representedRequests = new Set();
    for (const node of nodes) {
        if (node.kind === 'assistant' && node.step > 0) {
            representedRequests.add(`${node.turn}\u0000${node.step}`);
        }
    }
    if (partial !== null && partial.step > 0) {
        representedRequests.add(`${partial.turn}\u0000${partial.step}`);
    }
    for (const call of runningCalls) {
        if (call.step > 0)
            representedRequests.add(`${call.turn}\u0000${call.step}`);
    }
    const entries = [
        ...nodes.map((node, nodeIndex) => ({
            kind: 'node',
            seq: node.seq,
            node,
            nodeIndex,
        })),
        ...requests
            .filter((request) => request.purpose === 'compaction')
            .map(request => ({
            kind: 'compaction',
            seq: request.startSeq,
            request,
        })),
        ...requests.flatMap(request => request.purpose !== 'assistant'
            || request.promptChange === undefined
            || request.prompt === undefined
            ? []
            : [{
                    kind: 'system',
                    seq: request.promptChange.seq,
                    request,
                    change: request.promptChange,
                }]),
        ...requests
            .filter((request) => request.purpose === 'assistant')
            .filter(request => !representedRequests.has(`${request.turn}\u0000${request.step}`))
            .map(request => ({
            kind: 'request',
            seq: request.startSeq,
            request,
        })),
    ].sort((left, right) => layoutEntryOrder(left) - layoutEntryOrder(right));
    for (const entry of entries) {
        if (entry.kind === 'request') {
            const { request } = entry;
            pushStep(request.turn, request.step, [{
                    absTime: finiteTime(request.startedAt),
                    cell: {
                        index: ++index,
                        kind: 'message',
                        text: '',
                        sourceSeq: request.startSeq,
                        requestOnly: true,
                        timeSeconds: request.completedAt === null
                            ? null
                            : durationSeconds(request.completedAt, request.startedAt),
                        startedAt: finiteTime(request.startedAt),
                        ...(request.status === 'error' ? { isError: true } : {}),
                    },
                }]);
            prevAbsTime = finiteTime(request.completedAt)
                ?? finiteTime(request.startedAt)
                ?? prevAbsTime;
            continue;
        }
        if (entry.kind === 'system') {
            const { change, request } = entry;
            const turn = change.kind === 'initial'
                ? firstVisibleTurn(nodes, partial)
                : enclosingPromptTurn(nodes, change.seq, partial);
            pushMessage(turn, {
                absTime: finiteTime(change.time),
                cell: {
                    index: ++index,
                    kind: 'system',
                    text: promptChangeLabel(change, t),
                    sourceSeq: change.seq,
                    ...(request.prompt === undefined ? {} : { promptDetail: request.prompt }),
                    ...(change.previous === undefined
                        ? {}
                        : { previousPromptDetail: change.previous }),
                    timeSeconds: 0,
                    startedAt: finiteTime(change.time),
                },
            });
            prevAbsTime = finiteTime(change.time) ?? prevAbsTime;
            continue;
        }
        if (entry.kind === 'compaction') {
            const request = entry.request;
            const rawOutput = request.rawOutput ?? request.summary;
            const thinkingDetail = rawOutput === undefined
                ? ''
                : detailReasoning(rawOutput);
            const cell = {
                index: ++index,
                kind: 'compacted',
                text: request.status === 'running'
                    ? t('layout.compacting')
                    : request.status === 'error'
                        ? request.error === COMPACTION_INTERRUPTED_ERROR
                            ? t('layout.compactionInterrupted')
                            : request.error ?? t('layout.compactionFailed')
                        : request.summary === undefined
                            ? t('layout.compacted')
                            : '',
                ...(request.status === 'complete' && request.summary !== undefined
                    ? previewContentProperty(request.summary)
                    : {}),
                sourceSeq: request.startSeq,
                ...(request.summary === undefined
                    ? {}
                    : {
                        outputDetail: detailContent(request.summary),
                        outputBlocks: request.summary.map(block => sourceBlock(block)),
                    }),
                ...(thinkingDetail === '' ? {} : { thinkingDetail }),
                ...(rawOutput === undefined
                    ? {}
                    : { sourceBlocks: rawOutput.map(block => sourceBlock(block)) }),
                ...(request.status === 'error' ? { isError: true } : {}),
                timeSeconds: request.completedAt === null
                    ? null
                    : durationSeconds(request.completedAt, request.startedAt),
                startedAt: finiteTime(request.startedAt),
            };
            attachUsage(cell, request.usage);
            const compaction = {
                groups: [{
                        title: t('group.compaction', { seq: request.startSeq }),
                        laid: [{
                                absTime: finiteTime(request.startedAt),
                                cell,
                            }],
                    }],
            };
            if (request.turn === null)
                standaloneCompactions.push(compaction);
            else
                bucket(request.turn).groups.push(...compaction.groups);
            prevAbsTime = finiteTime(request.completedAt) ?? finiteTime(request.startedAt) ?? prevAbsTime;
            continue;
        }
        const { node, nodeIndex: i } = entry;
        if (node.kind === 'user') {
            // user/message has no turn on the wire; enclose it in the next assistant
            // (or partial) turn, else open the turn after the last assistant.
            const turn = enclosingUserTurn(followingAssistants[i], partial, lastAssistantTurn);
            pushMessage(turn, {
                absTime: finiteTime(node.time),
                cell: {
                    index: ++index,
                    kind: 'user',
                    ...inputCellDetail(node, t),
                    opensTurn: true,
                },
            });
            prevAbsTime = finiteTime(node.time) ?? prevAbsTime;
            continue;
        }
        if (node.kind === 'steering') {
            const placement = steeringPlacement(followingAssistants[i], partial, lastAssistantTurn, eventLocations?.get(node.seq));
            const laid = {
                absTime: finiteTime(node.time),
                cell: {
                    index: ++index,
                    kind: 'user',
                    ...inputCellDetail(node, t),
                },
            };
            if (placement.step === undefined)
                pushMessage(placement.turn, laid);
            else
                pushStepInput(placement.turn, placement.step, [laid]);
            prevAbsTime = finiteTime(node.time) ?? prevAbsTime;
            continue;
        }
        if (node.kind === 'assistant') {
            const laidList = withSubCalls(expandAssistant(node, index + 1, prevAbsTime, resultByCall, callStartById, callById, t), t);
            if (node.step > 0)
                pushStep(node.turn, node.step, laidList);
            else
                for (const laid of laidList)
                    pushMessage(node.turn, laid);
            const last = laidList[laidList.length - 1];
            if (last !== undefined)
                index = last.cell.index;
            prevAbsTime = finiteTime(node.time) ?? prevAbsTime;
            lastAssistantTurn = node.turn;
            continue;
        }
        if (node.kind === 'context') {
            const turn = enclosingUserTurn(followingAssistants[i], partial, lastAssistantTurn);
            pushMessage(turn, {
                absTime: finiteTime(node.time),
                cell: {
                    index: ++index,
                    kind: 'context',
                    ...inputCellDetail(node, t),
                },
            });
            prevAbsTime = finiteTime(node.time) ?? prevAbsTime;
            continue;
        }
        if (node.kind === 'compaction') {
            // Chat owns the human-facing compaction marker. It contributes no
            // duplicate trajectory cell, but still advances the duration cursor.
            prevAbsTime = finiteTime(node.time) ?? prevAbsTime;
            continue;
        }
        if (node.kind === 'tool-result') {
            if (!emittedCallIds.has(node.callId)) {
                const toolName = node.call?.name;
                const resultPreview = summarizeResult(node, t);
                const laidList = [{
                        absTime: finiteTime(node.callTime ?? node.time),
                        ...(toolName !== undefined ? { toolName } : {}),
                        callId: node.callId,
                        subCalls: node.subCalls,
                        cell: {
                            index: ++index,
                            kind: 'tool',
                            sourceSeq: node.seq,
                            ...(node.call !== null
                                ? summarizeCall(node.call.name, node.call.argsRaw)
                                : resultAsText(resultPreview)),
                            ...(node.call !== null ? { inputDetail: node.call.argsRaw } : {}),
                            outputDetail: detailResult(node, t),
                            outputBlocks: node.content.map(block => sourceBlock(block)),
                            ...resultPreview,
                            callId: node.callId,
                            isError: node.isError,
                            timeSeconds: durationSeconds(node.time, node.callTime),
                            startedAt: finiteTime(node.callTime),
                        },
                    }];
                for (const laid of expandSubCalls(node.subCalls, index, t)) {
                    laidList.push(laid);
                    index = laid.cell.index;
                }
                pushStep(0, 1, laidList);
            }
            prevAbsTime = finiteTime(node.time) ?? prevAbsTime;
        }
    }
    if (partial !== null) {
        const fake = {
            kind: 'assistant', seq: Number.MAX_SAFE_INTEGER, time: 0,
            turn: partial.turn, step: partial.step, blocks: partial.blocks,
        };
        const laidList = withSubCalls(expandAssistant(fake, index + 1, prevAbsTime, resultByCall, callStartById, callById, t, { streaming: true }), t);
        if (partial.step > 0)
            pushStep(partial.turn, partial.step, laidList);
        else
            for (const laid of laidList)
                pushMessage(partial.turn, laid);
        const last = laidList[laidList.length - 1];
        if (last !== undefined)
            index = last.cell.index;
    }
    const seenCalls = collectCallIds(turns);
    for (const call of runningCalls) {
        if (seenCalls.has(call.callId))
            continue;
        const laidList = [{
                absTime: null,
                toolName: call.name,
                callId: call.callId,
                subCalls: call.subCalls,
                cell: {
                    index: ++index,
                    kind: 'tool',
                    ...summarizeCall(call.name, call.argsRaw),
                    inputDetail: call.argsRaw,
                    callId: call.callId,
                    timeSeconds: null,
                    startedAt: finiteTime(call.time),
                },
            }];
        for (const laid of expandSubCalls(call.subCalls, index, t)) {
            laidList.push(laid);
            index = laid.cell.index;
        }
        if (call.step > 0)
            pushStep(call.turn, call.step, laidList);
        else
            for (const laid of laidList)
                pushMessage(call.turn, laid);
    }
    // Orphan turn-0 cells (orphaned tools) fold into Turn 1.
    const prologue = turns.get(0);
    if (prologue !== undefined) {
        turns.delete(0);
        const emptyTurn = () => ({ groups: [] });
        const first = turns.get(1) ?? emptyTurn();
        first.groups = [...prologue.groups, ...first.groups];
        turns.set(1, first);
    }
    for (const entry of [...turns.values(), ...standaloneCompactions]) {
        for (const group of entry.groups) {
            for (const laid of group.laid)
                attachToolSchema(laid, callSchemas);
        }
    }
    return [
        ...[...turns.entries()].map(([turn, entry]) => toTurnModel(turn, entry, t)),
        ...standaloneCompactions.map(entry => toTurnModel(null, entry, t)),
    ].sort((left, right) => firstCellIndex(left) - firstCellIndex(right));
}
/**
 * Append the changing in-flight assistant cells to a stable finalized layout.
 * @param turns - Finalized layout derived with an empty-block partial anchor.
 * @param partial - Current in-flight assistant projection.
 * @param lastIndex - Highest cell index in the finalized layout.
 * @param t - Trajectory locale translator.
 * @returns The original layout without a partial, otherwise a layout sharing every unaffected turn.
 */
export function appendTrajectoryPartialLayout(turns, partial, lastIndex, t) {
    if (partial === null)
        return turns;
    const partialTurn = deriveTrajectoryLayout({
        nodes: [],
        partial,
        runningCalls: [],
    }, t).at(0);
    if (partialTurn === undefined)
        return turns;
    const streamed = {
        ...partialTurn,
        groups: partialTurn.groups.map(group => ({
            ...group,
            cells: group.cells.map(cell => ({ ...cell, index: cell.index + lastIndex })),
        })),
    };
    const turnIndex = turns.findIndex(turn => turn.turn === streamed.turn);
    if (turnIndex === -1)
        return [...turns, streamed];
    const current = turns[turnIndex];
    /* v8 ignore next -- findIndex proved the dense array position exists. */
    if (current === undefined)
        return turns;
    const groups = [...current.groups];
    for (const streamedGroup of streamed.groups) {
        const groupIndex = groups.findIndex(group => group.title === streamedGroup.title);
        if (groupIndex === -1) {
            groups.push(streamedGroup);
            continue;
        }
        const group = groups[groupIndex];
        /* v8 ignore next -- findIndex proved the dense array position exists. */
        if (group === undefined)
            continue;
        const streamedCallIds = new Set(streamedGroup.cells.flatMap(cell => cell.callId === undefined ? [] : [cell.callId]));
        groups[groupIndex] = {
            ...streamedGroup,
            cells: [
                ...group.cells.filter(cell => cell.requestOnly !== true
                    && (cell.callId === undefined || !streamedCallIds.has(cell.callId))),
                ...streamedGroup.cells,
            ],
        };
    }
    const updated = [...turns];
    updated[turnIndex] = { ...current, groups };
    return updated;
}
function attachToolSchema(laid, callSchemas) {
    if (laid.callId === undefined || callSchemas === undefined)
        return;
    const schema = callSchemas.get(laid.callId);
    if (schema === undefined)
        return;
    laid.cell.schemaDetail = JSON.stringify(schema, null, 2);
}
function toTurnModel(turn, entry, t) {
    const groups = entry.groups.map(({ title, laid }) => {
        const description = groupDescription(laid, t);
        return {
            title,
            ...(description !== undefined ? { description } : {}),
            cells: laid.map(l => l.cell),
        };
    });
    return { turn, groups };
}
/** Chronological section position from the fold's monotonically assigned cell indexes. */
function firstCellIndex(turn) {
    return Math.min(...turn.groups.flatMap(group => group.cells.map(cell => cell.index)), Number.POSITIVE_INFINITY);
}
/** Wall-span duration + tool histogram, e.g. `1.5 s bash×6`. */
function groupDescription(laid, t) {
    const parts = [];
    // Tool rows contribute start (absTime) and end (start + own duration) so a
    // single Tool cell still spans call→result for the group wall clock.
    const times = [];
    for (const l of laid) {
        if (l.absTime === null || !Number.isFinite(l.absTime))
            continue;
        times.push(l.absTime);
        if (l.cell.kind === 'tool' && l.cell.timeSeconds !== null && Number.isFinite(l.cell.timeSeconds)) {
            times.push(l.absTime + l.cell.timeSeconds * 1000);
        }
    }
    if (times.length >= 2) {
        const span = formatGroupDuration((Math.max(...times) - Math.min(...times)) / 1000, t);
        if (span !== undefined)
            parts.push(span);
    }
    else if (times.length === 1) {
        const own = laid.find(l => l.absTime === times[0])?.cell.timeSeconds;
        const span = own !== null && own !== undefined ? formatGroupDuration(own, t) : undefined;
        if (span !== undefined)
            parts.push(span);
    }
    const tools = new Map();
    for (const l of laid) {
        if (l.toolName === undefined || l.cell.kind !== 'tool')
            continue;
        tools.set(l.toolName, (tools.get(l.toolName) ?? 0) + 1);
    }
    for (const [name, count] of tools) {
        parts.push(count > 1 ? `${name}×${count}` : name);
    }
    return parts.length === 0 ? undefined : parts.join(' ');
}
function formatGroupDuration(seconds, t) {
    if (!Number.isFinite(seconds))
        return undefined;
    return formatElapsedSeconds(seconds, t);
}
/** Own-duration seconds from two epoch-ms stamps; null when either is unusable. */
function durationSeconds(later, earlier) {
    if (earlier === null || !Number.isFinite(later) || !Number.isFinite(earlier))
        return null;
    return Math.max(0, (later - earlier) / 1000);
}
/** Epoch-ms usable as an absolute time, else null. */
function finiteTime(time) {
    return typeof time === 'number' && Number.isFinite(time) ? time : null;
}
function expandAssistant(node, startIndex, prevAbsTime, results, callStarts, calls, t, opts) {
    if (opts?.streaming === true && node.blocks.length === 0)
        return [];
    const out = [];
    let index = startIndex - 1;
    const usage = node.usage;
    const streaming = opts?.streaming === true;
    const recordedStart = finiteTime(node.timing?.stepStartTime);
    const messageDuration = streaming
        ? null
        : durationSeconds(node.time, recordedStart ?? prevAbsTime);
    const nodeAbs = streaming ? null : finiteTime(node.time);
    const messageText = node.blocks
        .filter(block => block.kind === 'text' && (!streaming || block.text !== ''))
        .map(block => block.kind === 'text' ? block.text : '')
        .join('\n\n');
    const thinkingText = node.blocks
        .filter(block => block.kind === 'reasoning' && (!streaming || block.text !== ''))
        .map(block => block.kind === 'reasoning' ? block.text : '')
        .join('\n\n');
    const message = {
        index: ++index,
        recordId: `assistant\u0000${node.turn}\u0000${node.step}`,
        kind: 'message',
        sourceSeq: node.seq,
        text: messageText !== '' || thinkingText !== ''
            ? ''
            : summarizeAssistantActivity(node.blocks, t),
        ...(messageText !== ''
            ? { previewMarkdown: messageText }
            : thinkingText !== ''
                ? { previewMarkdown: thinkingText }
                : {}),
        ...(messageText !== '' ? { outputDetail: messageText } : {}),
        ...(thinkingText !== '' ? { thinkingDetail: thinkingText } : {}),
        sourceBlocks: node.blocks.map(block => assistantSourceBlock(block)),
        timeSeconds: messageDuration,
        startedAt: recordedStart,
    };
    attachUsage(message, usage);
    message.assistantMetrics = {
        timingRecorded: node.timing !== undefined,
        stepStartTime: node.timing?.stepStartTime ?? null,
        firstTokenTime: node.timing?.firstTokenTime ?? null,
        completedTime: streaming ? null : finiteTime(node.time),
        usageProvided: usage !== undefined,
        outputTokens: Number.isFinite(usage?.outputTokens) ? usage?.outputTokens ?? null : null,
    };
    out.push({ absTime: nodeAbs, cell: message });
    for (const block of node.blocks) {
        // Text and reasoning belong to the one Assistant record emitted above.
        if (block.kind !== 'tool-call')
            continue;
        const result = results.get(block.callId);
        const toolDuration = streaming || result === undefined
            ? null
            : durationSeconds(result.time, result.callTime);
        const callAbs = finiteTime(callStarts.get(block.callId));
        const call = calls.get(block.callId);
        const resultPreview = result === undefined ? undefined : summarizeResult(result, t);
        out.push({
            absTime: callAbs,
            toolName: block.name,
            callId: block.callId,
            ...(call === undefined ? {} : { subCalls: call.subCalls }),
            cell: {
                index: ++index, kind: 'tool',
                ...summarizeCall(block.name, block.argsRaw),
                inputDetail: block.argsRaw,
                callId: block.callId,
                ...(result !== undefined
                    ? {
                        outputDetail: detailResult(result, t),
                        outputBlocks: result.content.map(block => sourceBlock(block)),
                        ...resultPreview,
                        isError: result.isError,
                    }
                    : {}),
                timeSeconds: toolDuration,
                startedAt: callAbs,
            },
        });
    }
    return out;
}
function summarizeAssistantActivity(blocks, t) {
    const tools = new Map();
    for (const block of blocks) {
        if (block.kind !== 'tool-call')
            continue;
        tools.set(block.name, (tools.get(block.name) ?? 0) + 1);
    }
    if (tools.size > 0) {
        return t('layout.toolCallOnly');
    }
    const images = blocks.filter(block => block.kind === 'image').length;
    if (images > 0)
        return t('layout.imageOnly', { count: images });
    return '';
}
function promptChangeLabel(change, t) {
    if (change.kind === 'initial')
        return t('layout.initialSystemPrompt');
    if (change.kind === 'system')
        return t('layout.systemPromptUpdated');
    if (change.kind === 'tools')
        return t('layout.toolsUpdated');
    return t('layout.systemPromptAndToolsUpdated');
}
function assistantSourceBlock(block) {
    switch (block.kind) {
        case 'text': return { type: 'text', content: block.text };
        case 'reasoning': return { type: 'thinking', content: block.text };
        case 'tool-call': return {
            type: 'tool-call',
            content: block.argsRaw,
            callId: block.callId,
            toolName: block.name,
        };
        case 'image': return { type: 'image', content: '', attachment: block.attachment };
        case 'other': return sourceBlock(block.block);
    }
}
function sourceBlock(value) {
    if (typeof value !== 'object' || value === null) {
        return { type: 'unknown', content: stringifySourceValue(value) };
    }
    const block = value;
    const type = typeof block.type === 'string' ? block.type : 'unknown';
    if (typeof block.text === 'string') {
        return { type: type === 'reasoning' ? 'thinking' : type, content: block.text };
    }
    if (type === 'image'
        && typeof block.attachment === 'object' && block.attachment !== null
        && typeof block.attachment.attachmentId === 'string') {
        // Session-log content is validated into core ContentBlocks by the
        // Conversation node assembly; the `attachmentId` guard only keeps
        // wire-shaped 'other' blocks with an unrelated `attachment` member out.
        return { type, content: '', attachment: block.attachment };
    }
    return { type, content: stringifySourceValue(value) };
}
function imageBlockCount(content) {
    return content.filter(block => block.type === 'image').length;
}
function stringifySourceValue(value) {
    const json = JSON.stringify(value, null, 2);
    return json || String(value);
}
/**
 * Turn that encloses a user/message: next assistant turn, else the
 * in-flight partial, else the turn after the last finalized assistant (or 1).
 */
function enclosingUserTurn(followingAssistant, partial, lastAssistantTurn) {
    if (followingAssistant !== undefined)
        return followingAssistant.turn;
    if (partial !== null)
        return partial.turn;
    if (lastAssistantTurn !== null)
        return lastAssistantTurn + 1;
    return 1;
}
function steeringPlacement(followingAssistant, partial, lastAssistantTurn, location) {
    if (location?.kind === 'step') {
        return { turn: location.turn.turn, step: location.step.step };
    }
    const locatedTurn = location?.kind === 'turn' ? location.turn.turn : undefined;
    if (followingAssistant !== undefined
        && (locatedTurn === undefined || followingAssistant.turn === locatedTurn)) {
        return {
            turn: followingAssistant.turn,
            ...(followingAssistant.step > 0 ? { step: followingAssistant.step } : {}),
        };
    }
    if (partial !== null && (locatedTurn === undefined || partial.turn === locatedTurn)) {
        return { turn: partial.turn, ...(partial.step > 0 ? { step: partial.step } : {}) };
    }
    if (locatedTurn !== undefined)
        return { turn: locatedTurn };
    return { turn: lastAssistantTurn ?? 1 };
}
function indexFollowingAssistants(nodes) {
    const following = new Array(nodes.length);
    let assistant;
    for (let index = nodes.length - 1; index >= 0; index--) {
        following[index] = assistant;
        const node = nodes[index];
        if (node?.kind === 'assistant')
            assistant = node;
    }
    return following;
}
function enclosingPromptTurn(nodes, seq, partial) {
    const next = nodes.find(node => node.seq > seq && node.kind === 'assistant' && node.step > 0);
    if (next?.kind === 'assistant')
        return next.turn;
    return partial?.turn ?? 1;
}
/** Earliest raw turn represented by the selected trajectory branch. */
function firstVisibleTurn(nodes, partial) {
    const turns = nodes.flatMap(node => node.kind === 'assistant' && node.turn > 0
        ? [node.turn]
        : []);
    if (partial !== null && partial.turn > 0)
        turns.push(partial.turn);
    return turns.length === 0 ? 1 : Math.min(...turns);
}
/** Copy provider usage onto a Message cell when present. */
function attachUsage(cell, usage) {
    if (usage === undefined)
        return;
    if (usage.inputTokens !== undefined)
        cell.input = usage.inputTokens;
    if (usage.cacheReadTokens !== undefined)
        cell.cacheRead = usage.cacheReadTokens;
    if (usage.cacheWriteTokens !== undefined)
        cell.cacheWrite = usage.cacheWriteTokens;
    if (usage.outputTokens !== undefined)
        cell.output = usage.outputTokens;
    if (usage.reasoningTokens !== undefined)
        cell.think = usage.reasoningTokens;
}
function indexResults(nodes) {
    const map = new Map();
    for (const node of nodes) {
        if (node.kind === 'tool-result')
            map.set(node.callId, node);
    }
    return map;
}
function indexAssistantCallIds(nodes) {
    const ids = new Set();
    for (const node of nodes) {
        if (node.kind !== 'assistant')
            continue;
        for (const block of node.blocks) {
            if (block.kind === 'tool-call')
                ids.add(block.callId);
        }
    }
    return ids;
}
function collectCallIds(turns) {
    const ids = new Set();
    for (const entry of turns.values()) {
        for (const group of entry.groups) {
            for (const laid of group.laid) {
                if (laid.callId !== undefined)
                    ids.add(laid.callId);
            }
        }
    }
    return ids;
}
/** Interleave each tool cell's nested child calls right after it, reindexing followers. */
function withSubCalls(laidList, t) {
    if (!laidList.some(laid => laid.subCalls !== undefined && laid.subCalls.length > 0))
        return laidList;
    const out = [];
    let index = laidList[0] !== undefined ? laidList[0].cell.index - 1 : 0;
    for (const laid of laidList) {
        out.push({ ...laid, cell: { ...laid.cell, index: ++index } });
        for (const sub of expandSubCalls(laid.subCalls, index, t)) {
            out.push(sub);
            index = sub.cell.index;
        }
    }
    return out;
}
/** Sub-dispatch cells for one run_code parent, in start order (running = null duration). */
function expandSubCalls(subs, startIndex, t) {
    if (subs === undefined || subs.length === 0)
        return [];
    const out = [];
    let index = startIndex;
    for (const sub of subs) {
        const settled = 'kind' in sub;
        const resultPreview = settled ? summarizeResult(sub, t) : undefined;
        const laid = {
            absTime: settled ? finiteTime(sub.callTime ?? sub.time) : finiteTime(sub.time),
            toolName: settled ? sub.call?.name ?? sub.callId : sub.name,
            callId: sub.callId,
            cell: {
                index: ++index,
                kind: 'subtool',
                callId: sub.callId,
                ...(settled
                    ? (sub.call !== null
                        ? summarizeCall(sub.call.name, sub.call.argsRaw)
                        : resultAsText(resultPreview))
                    : summarizeCall(sub.name, sub.argsRaw)),
                ...(settled
                    ? (sub.call !== null ? { inputDetail: sub.call.argsRaw } : {})
                    : { inputDetail: sub.argsRaw }),
                ...(settled
                    ? {
                        outputDetail: detailResult(sub, t),
                        outputBlocks: sub.content.map(block => sourceBlock(block)),
                        ...resultPreview,
                        isError: sub.isError,
                    }
                    : {}),
                // The code-dispatch start/settle pair carries per-sub-call wall time;
                // a running (unsettled) or pre-pair log entry shows the em dash.
                timeSeconds: settled ? durationSeconds(sub.time, sub.callTime) : null,
                startedAt: settled
                    ? finiteTime(sub.callTime)
                    : finiteTime(sub.time),
            },
        };
        out.push(laid);
        for (const child of expandSubCalls(sub.subCalls, index, t)) {
            out.push(child);
            index = child.cell.index;
        }
    }
    return out;
}
function summarizeCall(name, argsRaw) {
    return {
        text: name,
        ...(argsRaw === '' ? {} : { previewMarkdown: argsRaw }),
    };
}
function summarizeResult(node, t) {
    if (node.isError) {
        return { result: node.error?.code ?? 'error' };
    }
    for (const block of node.content) {
        if (block.type === 'text' && typeof block.text === 'string' && block.text !== '') {
            return { result: '', resultPreviewMarkdown: block.text };
        }
    }
    const images = imageBlockCount(node.content);
    if (images > 0)
        return { result: t('layout.imageOnly', { count: images }) };
    return { result: t('record.noOutput') };
}
function resultAsText(result) {
    return {
        text: result?.result ?? '',
        ...(result?.resultPreviewMarkdown === undefined
            ? {}
            : { previewMarkdown: result.resultPreviewMarkdown }),
    };
}
function detailResult(node, t) {
    if (node.isError) {
        return node.error === undefined
            ? 'error'
            : `${node.error.name}: ${node.error.code}`;
    }
    const text = node.content
        .filter(block => block.type === 'text' && typeof block.text === 'string')
        .map(block => block.type === 'text' ? block.text : '')
        .join('\n');
    if (text !== '')
        return text;
    const images = imageBlockCount(node.content);
    if (images > 0)
        return t('layout.imageOnly', { count: images });
    if (node.content.length === 0
        || node.content.every(block => block.type === 'text' && (typeof block.text !== 'string' || block.text === '')))
        return t('record.noOutput');
    return JSON.stringify(node.content, null, 2);
}
function detailContent(content) {
    return content
        .filter(block => block.type === 'text' && typeof block.text === 'string')
        .map(block => block.text ?? '')
        .join('\n');
}
function detailReasoning(content) {
    return content
        .filter(block => block.type === 'reasoning' && typeof block.text === 'string')
        .map(block => block.text ?? '')
        .join('\n');
}
function previewContent(content) {
    for (const block of content) {
        if (block.type === 'text' && typeof block.text === 'string')
            return block.text;
    }
    return undefined;
}
function previewContentProperty(content) {
    const previewMarkdown = previewContent(content);
    return previewMarkdown === undefined ? {} : { previewMarkdown };
}
