import { $createRangeSelection, $getRoot, $setSelection } from 'lexical';
import { $composerLayout } from "./projection.js";
/**
 * Resolve one detect offset to a selection point. Ownership rule: the first
 * segment whose half-open [start, end) contains the offset resolves it; the
 * document end falls to the last block. Atomic segments (chip, linebreak)
 * resolve to element points beside them, so a span can only ever address a
 * chip as a whole; a gap offset is the end of the block before it.
 * @param layout - current walk product.
 * @param offset - detect offset in [0, detectLength].
 * @returns the point, or null when the offset is out of bounds.
 */
function resolvePoint(layout, offset) {
    if (offset < 0 || offset > layout.detectLength)
        return null;
    for (const segment of layout.segments) {
        if (offset >= segment.detectStart + segment.detectLength)
            continue;
        if (segment.kind === 'text' && segment.node !== null) {
            return { key: segment.node.getKey(), offset: offset - segment.detectStart, type: 'text' };
        }
        if (segment.kind === 'gap' && segment.gapBetween !== undefined) {
            const before = segment.gapBetween.before;
            return { key: before, offset: layout.children.get(before)?.length ?? 0, type: 'element' };
        }
        // Atomic leaf (chip / linebreak): the element point on its leading side.
        /* v8 ignore next -- non-gap segments always carry their node. */
        if (segment.node === null)
            return null;
        const element = segment.node.getParent();
        /* v8 ignore next -- a walked leaf always has a parent element. */
        if (element === null)
            return null;
        return { key: element.getKey(), offset: segment.node.getIndexWithinParent(), type: 'element' };
    }
    // offset === detectLength: the end of the last block (or the empty root).
    const blocks = $getRoot().getChildren();
    const last = blocks[blocks.length - 1];
    if (last === undefined)
        return { key: $getRoot().getKey(), offset: 0, type: 'element' };
    return { key: last.getKey(), offset: layout.children.get(last.getKey())?.length ?? 0, type: 'element' };
}
/**
 * Build and apply a live RangeSelection over one detect span.
 * @param layout - current walk product.
 * @param span - detect span.
 * @returns the applied selection, or null when either endpoint fails to map.
 */
function selectSpan(layout, span) {
    if (span.start < 0 || span.start > span.end || span.end > layout.detectLength)
        return null;
    const anchor = resolvePoint(layout, span.start);
    const focus = resolvePoint(layout, span.end);
    /* v8 ignore next -- bounds were checked above; resolvePoint only fails out of bounds. */
    if (anchor === null || focus === null)
        return null;
    const selection = $createRangeSelection();
    selection.anchor.set(anchor.key, anchor.offset, anchor.type);
    selection.focus.set(focus.key, focus.offset, focus.type);
    $setSelection(selection);
    return selection;
}
/**
 * Select one detect span (collapsed spans place the caret). Exposed for the
 * shell's caret placement and tests; the replace helpers below build on it.
 * @param span - detect span to select.
 * @returns whether both endpoints mapped.
 */
export function $selectDetectSpan(span) {
    return selectSpan($composerLayout(), span) !== null;
}
/**
 * Replace one detect span with plain text (empty text deletes the span).
 * The caret lands after the insertion.
 * @param span - detect span to replace.
 * @param text - replacement text.
 * @returns whether the span mapped and the edit applied.
 */
export function $replaceDetectSpanWithText(span, text) {
    const selection = selectSpan($composerLayout(), span);
    if (selection === null)
        return false;
    if (text === '' && !selection.isCollapsed())
        selection.removeText();
    else
        selection.insertText(text);
    return true;
}
/**
 * Replace one detect span with nodes (chip insertion path). The caret lands
 * after the last inserted node.
 * @param span - detect span to replace.
 * @param nodes - replacement nodes in order.
 * @returns whether the span mapped and the edit applied.
 */
export function $replaceDetectSpanWithNodes(span, nodes) {
    const selection = selectSpan($composerLayout(), span);
    if (selection === null)
        return false;
    selection.insertNodes([...nodes]);
    return true;
}
