import { jsx as _jsx } from "react/jsx-runtime";
import { memo, useCallback, useMemo } from 'react';
import { AssistantMarkdown } from "./AssistantMarkdown.js";
/** Streaming, settled, and interrupted Assistant states share one keyed renderer instance. */
export const AssistantNodeView = memo(function AssistantNodeView({ node, useTurnData, turnProcess, openFile, renderMessageImages, fileMentions, t, }) {
    const data = node.data;
    const turn = node.location.kind === 'turn' || node.location.kind === 'step'
        ? node.location.turn
        : undefined;
    const tail = useTurnData('turn-tail');
    const blocks = useMemo(() => {
        if (data.finalNode === undefined || tail?.closing?.finalNode.seq !== data.finalNode.seq
            || tail.finalImages.length === 0)
            return data.blocks;
        return [...data.blocks, ...tail.finalImages.map(attachment => ({ kind: 'image', attachment }))];
    }, [data.blocks, data.finalNode, tail]);
    const owner = useMemo(() => {
        if (turn?.status !== 'closed' || data.finalNode === undefined)
            return undefined;
        if (tail?.closing?.finalNode.seq !== data.finalNode.seq)
            return undefined;
        return { turn, seq: data.finalNode.seq, openFile };
    }, [data.finalNode, openFile, tail, turn]);
    const mentions = useMemo(() => owner === undefined ? undefined : fileMentions(owner), [fileMentions, owner]);
    const reasoningHidden = turnProcess !== undefined
        && turnProcess.foldable
        && turnProcess.spec.answerStep === data.step
        && turnProcess.spec.inlineReasoning
        && !turnProcess.open;
    const revealProcess = useCallback(() => { turnProcess?.setOpen(true); }, [turnProcess]);
    return (_jsx(AssistantMarkdown, { blocks: blocks, streaming: data.status === 'running', interrupted: data.status === 'interrupted', renderMessageImages: renderMessageImages, reasoningHidden: reasoningHidden, revealProcess: revealProcess, mentions: mentions, t: t }));
});
