import { $getRoot, $getSelection, $isElementNode, $isLineBreakNode, $isRangeSelection, $isTextNode, } from 'lexical';
import { $isReferenceChipNode } from "./chip-node.js";
/** The detect-projection stand-in for one chip (object replacement character). */
export const ATOMIC_CHAR = '￼';
/**
 * Walk the composer document once, producing every projection segment in
 * document order. Blocks (paragraphs) contribute a one-newline gap between
 * one another in both text projections.
 * @returns the layout for this EditorState.
 */
export function $composerLayout() {
    const segments = [];
    const byKey = new Map();
    const children = new Map();
    const bounds = new Map();
    let detect = '';
    let clipboard = '';
    const pushLeaf = (kind, node, detectPiece, clipboardPiece) => {
        const segment = {
            kind,
            node,
            detectStart: detect.length,
            detectLength: detectPiece.length,
            clipboardStart: clipboard.length,
            clipboardLength: clipboardPiece.length,
        };
        segments.push(segment);
        byKey.set(node.getKey(), segment);
        detect += detectPiece;
        clipboard += clipboardPiece;
    };
    const walkElement = (element) => {
        const start = detect.length;
        const kids = element.getChildren();
        children.set(element.getKey(), kids.map(kid => kid.getKey()));
        for (const kid of kids) {
            if ($isReferenceChipNode(kid)) {
                pushLeaf('chip', kid, ATOMIC_CHAR, kid.getTextContent());
            }
            else if ($isTextNode(kid)) {
                const text = kid.getTextContent();
                pushLeaf('text', kid, text, text);
            }
            else if ($isLineBreakNode(kid)) {
                pushLeaf('linebreak', kid, '\n', '\n');
            }
            else if ($isElementNode(kid)) {
                /* v8 ignore next 4 -- plain-text composition nests no block elements today; the walk stays total for imported states. */
                walkElement(kid);
            }
            // Unknown inline decorators contribute nothing: this composer registers
            // no other decorator type, so the arm is unreachable by construction.
        }
        bounds.set(element.getKey(), { start, end: detect.length });
    };
    const root = $getRoot();
    const blocks = root.getChildren();
    children.set(root.getKey(), blocks.map(block => block.getKey()));
    const rootStart = detect.length;
    blocks.forEach((block, index) => {
        const previous = blocks[index - 1];
        if (index > 0 && previous !== undefined) {
            segments.push({
                kind: 'gap',
                node: null,
                detectStart: detect.length,
                detectLength: 1,
                clipboardStart: clipboard.length,
                clipboardLength: 1,
                gapBetween: { before: previous.getKey(), after: block.getKey() },
            });
            detect += '\n';
            clipboard += '\n';
        }
        if ($isElementNode(block))
            walkElement(block);
    });
    bounds.set(root.getKey(), { start: rootStart, end: detect.length });
    return {
        segments,
        detectLength: detect.length,
        detectText: detect,
        clipboardText: clipboard,
        byKey,
        children,
        bounds,
    };
}
/**
 * Fold one clipboard-projection offset to its detect-projection twin.
 * Offsets inside a chip's clipboard expansion snap to the chip's trailing
 * edge; callers only pass boundaries that were once a document end (submit
 * snapshots), which never split a chip.
 * @param layout - the current walk product.
 * @param clipboardOffset - offset into the clipboard projection.
 * @returns the detect offset covering the same document position.
 */
export function detectOffsetOfClipboardOffset(layout, clipboardOffset) {
    for (const segment of layout.segments) {
        const end = segment.clipboardStart + segment.clipboardLength;
        if (clipboardOffset > end)
            continue;
        if (clipboardOffset === end)
            return segment.detectStart + segment.detectLength;
        if (segment.kind === 'chip')
            return segment.detectStart + segment.detectLength;
        return segment.detectStart + (clipboardOffset - segment.clipboardStart);
    }
    return layout.detectLength;
}
/**
 * Fold one selection point to a detect offset.
 * @param layout - the current walk product.
 * @param point - selection anchor/focus point.
 * @returns detect offset, or null when the point references an unknown node.
 */
export function $detectOffsetOfPoint(layout, point) {
    if (point.type === 'text') {
        const segment = layout.byKey.get(point.key);
        return segment === undefined ? null : segment.detectStart + Math.min(point.offset, segment.detectLength);
    }
    const kids = layout.children.get(point.key);
    const elementBounds = layout.bounds.get(point.key);
    if (kids === undefined || elementBounds === undefined)
        return null;
    if (point.offset >= kids.length)
        return elementBounds.end;
    const childKey = kids[point.offset];
    if (childKey === undefined)
        return elementBounds.end;
    const childSegment = layout.byKey.get(childKey);
    if (childSegment !== undefined)
        return childSegment.detectStart;
    const childBounds = layout.bounds.get(childKey);
    return childBounds === undefined ? null : childBounds.start;
}
/**
 * Project the composer document and its caret.
 * @param idOf - stable occurrence-id assignment per chip NodeKey (the shell
 * owns the map so ids survive across projections of the same node).
 * @returns the three-view projection product.
 */
export function $projectComposer(idOf) {
    const layout = $composerLayout();
    const occurrences = [];
    for (const segment of layout.segments) {
        if (segment.kind !== 'chip' || !$isReferenceChipNode(segment.node))
            continue;
        const chip = segment.node;
        occurrences.push({
            occurrenceId: idOf(chip.getKey()),
            source: chip.getSource(),
            ref: chip.getReference(),
            offset: segment.clipboardStart,
            length: segment.clipboardLength,
            label: chip.getLabel(),
            ...(chip.getAppearance() === undefined ? {} : { appearance: chip.getAppearance() }),
            clipboardText: chip.getTextContent(),
            ...(chip.isInvalid() ? { invalid: true } : {}),
        });
    }
    const selection = $getSelection();
    let range = null;
    if ($isRangeSelection(selection)) {
        const anchor = $detectOffsetOfPoint(layout, selection.anchor);
        const focus = $detectOffsetOfPoint(layout, selection.focus);
        if (anchor !== null && focus !== null) {
            range = { start: Math.min(anchor, focus), end: Math.max(anchor, focus) };
        }
    }
    return {
        detectText: layout.detectText,
        clipboardText: layout.clipboardText,
        occurrences,
        selection: range,
        caret: range !== null && range.start === range.end ? range.start : null,
    };
}
