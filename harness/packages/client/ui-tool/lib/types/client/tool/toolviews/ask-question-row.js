import { jsx as _jsx } from "react/jsx-runtime";
import { IconQuestionOutline14 } from '@deepseek-ai/dsh-client-ui-primitives';
import { singleResultText } from "../models/raw-tool-call.js";
import { toolRowModel } from "../models/tool-call-model.js";
import { ToolRow } from "../components/ToolRow.js";
import { CONVERSATION_NS as NS } from "../../locale.js";
function isRecord(value) {
    return typeof value === 'object' && value !== null && !Array.isArray(value);
}
function parseJson(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return undefined;
    }
}
/** Answer records from the result JSON; null when the result is malformed. */
function answerEntries(text) {
    const parsed = parseJson(text);
    if (!isRecord(parsed))
        return null;
    const answers = parsed.answers;
    if (!Array.isArray(answers) || !answers.every(isRecord))
        return null;
    const entries = [];
    for (const answer of answers) {
        if (typeof answer.id !== 'string'
            || !Array.isArray(answer.selected)
            || !answer.selected.every(item => typeof item === 'string')
            || (answer.custom !== undefined && typeof answer.custom !== 'string'))
            return null;
        entries.push({
            id: answer.id,
            selected: answer.selected,
            ...(answer.custom === undefined ? {} : { custom: answer.custom }),
        });
    }
    return entries;
}
/** Questions from call JSON; null when pairing with answers would be ambiguous. */
function questionEntries(argsRaw) {
    const parsed = parseJson(argsRaw);
    if (!isRecord(parsed) || !Array.isArray(parsed.questions) || parsed.questions.length === 0)
        return null;
    const questions = [];
    const ids = new Set();
    for (const question of parsed.questions) {
        if (!isRecord(question)
            || typeof question.id !== 'string'
            || typeof question.question !== 'string'
            || ids.has(question.id))
            return null;
        ids.add(question.id);
        questions.push({ id: question.id, question: question.question });
    }
    return questions;
}
/** Pair questions with result entries by their echoed stable ids. */
function pairAnswers(argsRaw, answers) {
    const questions = questionEntries(argsRaw);
    if (questions === null || questions.length !== answers.length)
        return null;
    const byId = new Map();
    for (const answer of answers) {
        if (byId.has(answer.id))
            return null;
        byId.set(answer.id, answer);
    }
    const paired = [];
    for (const question of questions) {
        const answer = byId.get(question.id);
        if (answer === undefined)
            return null;
        paired.push({
            ...question,
            answers: [
                ...answer.selected,
                ...(answer.custom === undefined || answer.custom === '' ? [] : [answer.custom]),
            ],
        });
    }
    return paired;
}
/** Answer summary plus structured transcript content from the two wire JSON documents. */
function answeredPresentation(argsRaw, text, t) {
    const answers = answerEntries(text);
    if (answers === null)
        return null;
    const answered = answers.filter(answer => answer.selected.length > 0 || (answer.custom ?? '') !== '').length;
    return {
        summary: t('ask.answered', { answered, total: answers.length }),
        questions: pairAnswers(argsRaw, answers),
    };
}
/** Best-effort answered-count summary when strict transcript pairing fails. */
function answeredSummary(text, t) {
    const parsed = parseJson(text);
    if (!isRecord(parsed))
        return null;
    const answers = parsed.answers;
    if (!Array.isArray(answers) || !answers.every(isRecord))
        return null;
    const answered = answers.filter(a => (Array.isArray(a.selected) && a.selected.length > 0)
        || (typeof a.custom === 'string' && a.custom !== '')).length;
    return t('ask.answered', { answered, total: answers.length });
}
/** Summarizes a pending, answered, cancelled, or interrupted question set. */
export function AskQuestionRow({ toolName, block, inspect, t }) {
    const model = toolRowModel(toolName, block);
    // Composer verdicts settle the call as specific UserQuestionErrors
    // (ask_user_question handler): 'ASK_CANCELLED' is the user's own
    // dismissal of the set, 'ASK_ABORTED' is a turn interrupt landing while the
    // question was pending. Both name their verdict instead of the generic
    // failed shape, and the abort keeps the shared stopped (amber) semantics of
    // any other interrupted tool call.
    const code = 'kind' in block ? block.error?.code : undefined;
    const argsRaw = ('kind' in block ? block.call?.argsRaw : block.argsRaw) ?? '';
    let summary = model.summary;
    let state = model.state;
    let transcript = null;
    if (code === 'ASK_CANCELLED') {
        summary = t('ask.cancelled');
        state = 'ok';
        const questions = questionEntries(argsRaw);
        if (questions !== null) {
            transcript = { kind: 'unanswered', questions, verdict: t('ask.cancelledDetail') };
        }
    }
    else if (code === 'ASK_ABORTED') {
        summary = t('ask.interrupted');
        state = 'stopped';
        const questions = questionEntries(argsRaw);
        if (questions !== null) {
            transcript = { kind: 'unanswered', questions, verdict: t('ask.interruptedDetail') };
        }
    }
    else if (model.state === 'running') {
        summary = t('ask.waiting');
    }
    else if ('kind' in block && model.state === 'ok') {
        const text = singleResultText(block);
        if (text !== undefined) {
            const presentation = answeredPresentation(argsRaw, text, t);
            // Full transcripts require stable ids and valid visible fields; retain the
            // legacy best-effort count when only strict pairing is unsafe.
            summary = presentation?.summary ?? answeredSummary(text, t) ?? model.summary;
            if (presentation?.questions !== null && presentation?.questions !== undefined) {
                transcript = { kind: 'answered', questions: presentation.questions, skippedLabel: t('ask.skipped') };
            }
        }
    }
    return (_jsx(ToolRow, { t: t, variant: model.variant, toolName: toolName, icon: _jsx(IconQuestionOutline14, {}), title: t('ask.rowTitle'), summary: summary, body: transcript === null ? model.body : null, output: transcript === null ? model.output : null, askQuestion: transcript, state: state, inspect: inspect }));
}
/** Registers the ask-user-question conversation row. */
export const askQuestionToolview = {
    name: 'ask-question-toolview',
    inject: ['slots'],
    apply(ctx) {
        ctx.slots.inject('tool.call.toolview', () => ctx.slots.register({
            name: 'tool.call.toolview', key: 'ask_user_question', locale: NS,
        }, AskQuestionRow));
    },
};
