import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import css from './AskQuestionCard.module.css';
/**
 * Render a validated ask-user transcript from plain card data.
 * @param props - Localized transcript card data.
 * @returns the readable answered or unanswered question list.
 */
export function AskQuestionCard({ card }) {
    if (card.kind === 'unanswered') {
        return (_jsxs("div", { className: css.card, children: [_jsx("p", { className: css.verdict, children: card.verdict }), _jsx("ul", { className: css.questionList, children: card.questions.map(question => (_jsx("li", { className: css.unansweredQuestion, children: question.question }, question.id))) })] }));
    }
    return (_jsx("dl", { className: css.card, children: card.questions.map(question => (_jsxs("div", { className: css.item, children: [_jsx("dt", { className: css.question, children: question.question }), _jsx("dd", { className: css.answer, children: question.answers.length === 0
                        ? _jsx("span", { className: css.skipped, children: card.skippedLabel })
                        : question.answers.map((answer, index) => (_jsx("span", { className: css.answerLine, children: answer }, `${question.id}-${String(index)}`))) })] }, question.id))) }));
}
