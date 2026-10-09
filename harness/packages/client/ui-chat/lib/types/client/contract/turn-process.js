const TURN_PROCESS_INDEPENDENT_KIND_LIST = [
    'system-prompt',
    'user',
    'steering',
    'turn-process',
    'turn-error',
    'turn-max-tokens',
    'turn-tail',
];
/** Chat Node kinds that remain independent of a Turn's process disclosure. */
export const TURN_PROCESS_INDEPENDENT_KINDS = new Set(TURN_PROCESS_INDEPENDENT_KIND_LIST);
/**
 * Identify one finalized answer generation without using its ordering anchor.
 * @param spec - current Turn process specification.
 * @returns stable identity until the finalized answer Step is withdrawn or replaced.
 */
export function turnProcessGeneration(spec) {
    return `${String(spec.turn)}|${spec.answerStep === null ? '' : String(spec.answerStep)}`;
}
/**
 * Encode one process specification as a primitive Location-data value.
 * @param spec - current Turn process specification.
 * @returns reference-stable scalar for equal specifications.
 */
export function encodeTurnProcess(spec) {
    return [
        spec.turn,
        spec.controlAnchorSeq,
        spec.processStartSeq,
        spec.answerAnchorSeq ?? '',
        spec.answerStep ?? '',
        spec.inlineReasoning ? 1 : 0,
        spec.messageCount,
        spec.toolCallCount,
        spec.subagentCount,
    ].join('|');
}
/**
 * Decode a same-process signature produced by {@link encodeTurnProcess}.
 * @param signature - encoded Turn process value.
 * @returns decoded process specification.
 */
export function decodeTurnProcess(signature) {
    const [turn, controlAnchorSeq, processStartSeq, answerAnchorSeq, answerStep, inlineReasoning, messageCount, toolCallCount, subagentCount,] = signature.split('|');
    return {
        turn: Number(turn),
        controlAnchorSeq: Number(controlAnchorSeq),
        processStartSeq: Number(processStartSeq),
        answerAnchorSeq: answerAnchorSeq === '' ? null : Number(answerAnchorSeq),
        answerStep: answerStep === '' ? null : Number(answerStep),
        inlineReasoning: inlineReasoning === '1',
        messageCount: Number(messageCount),
        toolCallCount: Number(toolCallCount),
        subagentCount: Number(subagentCount),
    };
}
/**
 * Recognize the shipped subagent delegation name and its configured variants.
 * Control tools use distinct names such as `send_message` and `list_agents`.
 * @param name - durable Tool-call name.
 * @returns whether the call creates or forks a subagent.
 */
export function isSubagentDelegationTool(name) {
    return name === 'subagent' || name.startsWith('subagent_');
}
