import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
import { useMemo, useRef, useState } from 'react';
import clsx from 'clsx';
import { Button, IconCheckOutline14, IconChevronDownOutline14, IconChevronLeftOutline14, IconChevronRightOutline14, IconChevronUpOutline14, IconCloseOutline16, IconEditOutline16, MarkdownText, } from '@deepseek-ai/dsh-client-ui-primitives';
import { planReviewOf, } from "./contract/slots.js";
import { PlanReviewPanel } from "./PlanReviewPanel.js";
import css from './QuestionComposer.module.css';
/**
 * Split the conventional recommendation suffix without changing the answer value.
 * @param label - Original option label returned if selected.
 * @returns Display label plus recommendation state.
 */
export function parseRecommendedLabel(label) {
    const suffix = /\s*(?:\((?:recommended|推荐)\)|（(?:recommended|推荐)）)\s*$/i;
    return suffix.test(label)
        ? { label: label.replace(suffix, ''), recommended: true }
        : { label, recommended: false };
}
/** Return whether a text-field key event belongs to an active IME composition. */
function isComposing(event) {
    // keyCode 229 is the legacy IME-composition signal engines emit without isComposing.
    // oxlint-disable-next-line typescript/no-deprecated
    return event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229;
}
/**
 * Auto-growing free-text answer: a textarea, so a long answer soft-wraps and
 * Shift+Enter breaks a line, over a hidden mirror that owns the height.
 *
 * The mirror renders the draft plus a trailing newline in normal flow and so
 * sizes the grid row (counting rows by '\n' cannot see soft wraps); the
 * textarea shares that one cell and stretches to it, and `rows={1}` keeps the
 * control's own intrinsic height out of the row sizing so the mirror alone
 * decides. Past the mirror's cap the textarea scrolls itself — it is the only
 * scrollport in the stack, there being no second glyph layer to keep aligned.
 * Mirror and textarea MUST share font, line-height, padding and wrapping rules
 * or the two heights diverge.
 *
 * @param props - visual variant, draft text, and the field's event handlers.
 * @returns The mirrored auto-growing field.
 */
function AnswerField(props) {
    return (_jsxs("div", { className: clsx(css.field, props.variant === 'inline' ? css.customInline : css.customBlock), children: [_jsx("div", { "aria-hidden": true, className: css.fieldMirror, children: `${props.value}\n` }), _jsx("textarea", { autoFocus: props.autoFocus, className: css.fieldInput, value: props.value, disabled: props.disabled, rows: 1, placeholder: props.placeholder, onFocus: props.onFocus, onChange: props.onChange, onKeyDown: props.onKeyDown })] }));
}
/**
 * Composer takeover router. Generic-question drafts live in this entry's
 * Session-scoped Slot store, keyed by the pending carrier, so a strict Session
 * entry remount restores the same request without exposing it to another one.
 *
 * One takeover, two presentations: a request that declares a presentation intent this
 * package renders uses that presentation (a plan review is one decision over one
 * plan, not a question set), and every other request takes the generic flow.
 * The routing lives here, at the one entry that owns the composer seat, so
 * neither presentation can claim a request the other is already rendering.
 *
 * @param props - the selector-matched pending question carrier plus the framework standard kit.
 * @returns The question flow, or the intent's own surface, for this request.
 */
export function QuestionComposer(props) {
    const question = props.matched;
    const review = useMemo(() => planReviewOf(question.questions), [question]);
    return review === undefined
        ? (_jsx(QuestionFlow, { pending: question, t: props.t, useStore: props.useStore, actions: props.actions }, question.key))
        : _jsx(PlanReviewPanel, { pending: question, review: review, t: props.t }, question.key);
}
function QuestionFlow({ pending, t, useStore, actions }) {
    const questions = pending.questions;
    const markdownLabels = useMemo(() => ({
        code: { copyLabel: t('copy'), copiedLabel: t('copied') },
        footnotes: t('markdown.footnotes'),
    }), [t]);
    const initialProgress = useMemo(() => ({
        index: 0,
        drafts: questions.map(() => ({ selected: [], custom: '', skipped: false })),
    }), [questions]);
    const storedProgress = useStore(state => (state.requestKey === pending.key && state.progress.drafts.length === questions.length
        ? state.progress
        : undefined));
    const { index, drafts } = storedProgress ?? initialProgress;
    const [busy, setBusy] = useState(null);
    const [error, setError] = useState(null);
    // Collapsed to the header strip so the conversation above stays readable
    // while the user decides; answer drafts live in the Session store above.
    const [minimized, setMinimized] = useState(false);
    // The free-form textarea autofocuses on first presentation; re-expanding a
    // collapsed question must not steal focus from the expand toggle back into
    // the input, so focus is granted once per question index.
    const focusedQuestions = useRef(new Set());
    // Every navigation write stays in bounds and drafts mirrors questions 1:1.
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const question = questions[index];
    // oxlint-disable-next-line typescript/no-non-null-assertion
    const draft = drafts[index];
    const hasOptions = (question.options?.length ?? 0) > 0;
    const replaceProgress = (nextIndex, nextDrafts) => {
        actions.replace(pending.key, { index: nextIndex, drafts: nextDrafts });
    };
    const cancelFlow = () => {
        setBusy('cancel');
        setError(null);
        void pending.cancel()
            .then(() => { actions.clear(pending.key); })
            .catch((cause) => {
            setBusy(null);
            setError({ text: cause instanceof Error ? cause.message : String(cause) });
        });
    };
    const updateDraft = (update, nextIndex = index) => {
        const nextDrafts = drafts.map((item, itemIndex) => itemIndex === index ? update(item) : item);
        replaceProgress(nextIndex, nextDrafts);
        setError(null);
    };
    const choose = (label) => {
        updateDraft((current) => {
            if (question.multiSelect === true) {
                const selected = current.selected.includes(label)
                    ? current.selected.filter(item => item !== label)
                    : [...current.selected, label];
                return { ...current, selected, skipped: false };
            }
            return { selected: [label], custom: '', skipped: false };
        }, question.multiSelect !== true && index < questions.length - 1 ? index + 1 : index);
    };
    const answered = (item) => item.selected.length > 0 || item.custom.trim() !== '';
    const completed = (item) => answered(item) || item.skipped;
    const submitDrafts = (values) => {
        const missing = values.findIndex(item => !completed(item));
        if (missing >= 0) {
            replaceProgress(missing, values);
            setError({ key: 'error.incomplete' });
            return;
        }
        const answer = {
            answers: questions.map((item, itemIndex) => {
                const value = values[itemIndex];
                if (value.skipped)
                    return { id: item.id, selected: [] };
                const custom = value.custom.trim();
                return {
                    id: item.id,
                    selected: custom === '' || item.multiSelect === true ? value.selected : [],
                    ...(custom === '' ? {} : { custom }),
                };
            }),
        };
        setBusy('answer');
        setError(null);
        void pending.answer(answer)
            .then(() => { actions.clear(pending.key); })
            .catch((cause) => {
            setBusy(null);
            setError({ text: cause instanceof Error ? cause.message : String(cause) });
        });
    };
    const continueFlow = () => {
        if (!answered(draft)) {
            setError({ key: 'error.unanswered' });
            return;
        }
        if (index < questions.length - 1) {
            replaceProgress(index + 1, drafts);
            setError(null);
            return;
        }
        submitDrafts(drafts);
    };
    // Shared by the inline custom field and the optionless one: a multi-select
    // draft retains checked labels, while a single-select custom answer replaces
    // its selection. Enter continues the flow, Shift+Enter breaks a line.
    const draftCustom = (event) => {
        const value = event.target.value;
        updateDraft(current => ({
            ...current,
            selected: question.multiSelect === true ? current.selected : [],
            custom: value,
            skipped: false,
        }));
    };
    const continueFromCustom = (event) => {
        if (event.key !== 'Enter' || event.shiftKey || isComposing(event))
            return;
        event.preventDefault();
        continueFlow();
    };
    const skipQuestion = () => {
        const nextDrafts = drafts.map((item, itemIndex) => itemIndex === index
            ? { selected: [], custom: '', skipped: true }
            : item);
        replaceProgress(index < questions.length - 1 ? index + 1 : index, nextDrafts);
        setError(null);
        if (index < questions.length - 1) {
            return;
        }
        submitDrafts(nextDrafts);
    };
    return (_jsx("div", { className: css.frame, "data-question-key": pending.key, children: _jsxs("section", { className: clsx(css.card, minimized && css.cardMinimized), "aria-labelledby": `question-${pending.key}-${String(index)}`, children: [_jsxs("header", { className: css.header, children: [_jsxs("div", { className: css.headingBlock, children: [question.header !== undefined && _jsx("div", { className: css.eyebrow, children: question.header }), _jsx("h2", { className: css.title, id: `question-${pending.key}-${String(index)}`, children: question.question })] }), _jsxs("div", { className: css.headerActions, children: [_jsx("button", { type: "button", className: css.iconButton, "aria-label": t(minimized ? 'nav.maximize' : 'nav.minimize'), title: t(minimized ? 'nav.maximize' : 'nav.minimize'), "aria-expanded": !minimized, disabled: busy !== null, onClick: () => { setMinimized(current => !current); }, children: minimized ? _jsx(IconChevronUpOutline14, {}) : _jsx(IconChevronDownOutline14, {}) }), _jsx("button", { type: "button", className: css.iconButton, "aria-label": t('nav.cancel'), title: t('nav.cancel'), disabled: busy !== null, onClick: cancelFlow, children: _jsx(IconCloseOutline16, {}) })] })] }), !minimized && (_jsxs(_Fragment, { children: [_jsxs("div", { className: css.body, "data-question-scroll": true, children: [question.detail !== undefined && (_jsx("div", { className: css.detail, children: _jsx(MarkdownText, { text: question.detail, labels: markdownLabels }) })), _jsxs("div", { className: css.options, role: question.multiSelect === true ? 'group' : 'radiogroup', children: [(question.options ?? []).map((option, optionIndex) => {
                                            const selected = draft.selected.includes(option.label);
                                            const display = parseRecommendedLabel(option.label);
                                            return (_jsxs("button", { type: "button", className: clsx(css.option, selected && question.multiSelect !== true && css.optionSelected), role: question.multiSelect === true ? 'checkbox' : 'radio', "aria-checked": selected, "aria-label": display.label, disabled: busy !== null, onClick: () => { choose(option.label); }, onKeyDown: (event) => {
                                                    if (event.key !== 'Enter' || !drafts.every(completed))
                                                        return;
                                                    event.preventDefault();
                                                    submitDrafts(drafts);
                                                }, children: [question.multiSelect === true
                                                        ? (_jsx("span", { className: clsx(css.checkbox, selected && css.checkboxChecked), "aria-hidden": "true", children: selected && _jsx(IconCheckOutline14, { size: 12 }) }))
                                                        : _jsx("span", { className: css.number, children: optionIndex + 1 }), _jsx("span", { className: css.optionCopy, children: _jsxs("span", { className: css.optionLine, children: [_jsx("span", { className: css.optionLabel, children: display.label }), display.recommended && (_jsx("span", { className: css.badge, children: t('option.recommended') })), option.description !== undefined && (_jsx("span", { className: css.description, children: option.description }))] }) })] }, `${option.label}-${String(optionIndex)}`));
                                        }), hasOptions
                                            ? (_jsxs("div", { className: clsx(css.customRow, draft.custom !== '' && css.customRowActive), children: [question.multiSelect === true
                                                        ? (_jsx("span", { className: clsx(css.checkbox, draft.custom !== '' && css.checkboxChecked), "aria-hidden": "true", children: draft.custom !== '' && _jsx(IconCheckOutline14, { size: 12 }) }))
                                                        : (_jsx("span", { className: css.number, "aria-hidden": "true", children: _jsx(IconEditOutline16, { size: 12 }) })), _jsx(AnswerField, { variant: "inline", value: draft.custom, disabled: busy !== null, placeholder: t('custom.placeholder'), onChange: draftCustom, onKeyDown: continueFromCustom })] }))
                                            : (_jsx(AnswerField, { autoFocus: !focusedQuestions.current.has(index), variant: "block", value: draft.custom, disabled: busy !== null, placeholder: t('custom.placeholder'), onFocus: () => { focusedQuestions.current.add(index); }, onChange: draftCustom, onKeyDown: continueFromCustom }))] })] }), _jsxs("footer", { className: css.footer, children: [_jsxs("div", { className: css.pager, children: [_jsx("button", { type: "button", className: css.iconButton, "aria-label": t('nav.prev'), disabled: index === 0 || busy !== null, onClick: () => { replaceProgress(index - 1, drafts); setError(null); }, children: _jsx(IconChevronLeftOutline14, {}) }), _jsxs("span", { className: css.progress, children: [index + 1, " / ", questions.length] }), _jsx("button", { type: "button", className: css.iconButton, "aria-label": t('nav.next'), disabled: index === questions.length - 1 || busy !== null, onClick: () => { replaceProgress(index + 1, drafts); setError(null); }, children: _jsx(IconChevronRightOutline14, {}) })] }), _jsx("div", { className: css.feedback, role: "status", children: error === null ? null : 'key' in error ? t(error.key) : error.text }), _jsxs("div", { className: css.footerActions, children: [_jsx(Button, { variant: "outline", disabled: busy !== null, onClick: skipQuestion, children: t('action.skip') }), _jsx(Button, { variant: "primary", disabled: busy !== null || !answered(draft), onClick: continueFlow, children: busy === 'answer'
                                                ? t('submitting')
                                                : index === questions.length - 1 ? t('submit') : t('action.next') })] })] })] }))] }) }));
}
