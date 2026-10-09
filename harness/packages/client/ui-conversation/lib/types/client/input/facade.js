import { createSnapshotStore, } from '@deepseek-ai/dsh-client-store';
import { $addUpdateTag, $createParagraphNode, $createTextNode, $getRoot, $getSelection, $isParagraphNode, $isRangeSelection, CLEAR_HISTORY_COMMAND, createEditor, HISTORY_MERGE_TAG, PASTE_TAG, } from 'lexical';
import { registerPlainText } from '@lexical/plain-text';
import { createEmptyHistoryState, registerHistory } from '@lexical/history';
import { mergeRegister } from '@lexical/utils';
import { SubmitMachine } from "./machine.js";
import { ReferenceChipNode, $createReferenceChipNode } from "./editor/chip-node.js";
import { refreshClaimDecoration, registerClaimDecoration } from "./editor/claim-decor.js";
import { registerTextRefDecoration, rescanTextRefs, TextRefNode } from "./editor/text-ref.js";
import { $composerLayout, $projectComposer, detectOffsetOfClipboardOffset } from "./editor/projection.js";
import { $replaceDetectSpanWithNodes, $replaceDetectSpanWithText } from "./editor/span-map.js";
/** Guard tier from the machine phase. */
function guardOf(phase) {
    switch (phase) {
        case 'plain': return 'plain';
        case 'claimed': return 'claimed';
        default: return 'frozen'; // adjudicating / submitting
    }
}
/** Whether two projections differ in content (selection and caret excluded). */
function projectionContentChanged(prev, next) {
    if (prev.clipboardText !== next.clipboardText || prev.detectText !== next.detectText)
        return true;
    if (prev.occurrences.length !== next.occurrences.length)
        return true;
    return next.occurrences.some((occ, i) => {
        const old = prev.occurrences[i];
        return old === undefined || old.occurrenceId !== occ.occurrenceId || old.invalid !== occ.invalid;
    });
}
const EMPTY_QUEUE = [];
/** No-pipeline lexicon: zero text-ref decorations. */
const EMPTY_LEXICON = new Map();
/**
 * Detect-projection and legacy reference placeholders stripped from every
 * external text entering the document (paste, persisted-draft seed): a chip
 * is the only legitimate source of U+FFFC in the detect projection, so a
 * literal one in text would forge chip positions.
 */
const REFERENCE_PLACEHOLDER_RE = /[\uE100-\uE11D\uFFFC]/gu;
/** Undo merge window for contiguous typing, in ms (the old machine's mergeWindowMs). */
const HISTORY_MERGE_DELAY_MS = 1000;
/**
 * The per-session input facade: scoped-event application verbs +
 * setDraft/submit + the published InputState store, over a shell-owned
 * Lexical editor.
 */
export class SessionInputShell {
    deps;
    /** Published editor projection + submit-plane state + queue overlay (the InputZone currency source). */
    state;
    /** Latest surfaced notice (null after clear); the bar renders errors as banners and information inline. */
    notices = createSnapshotStore(null);
    /** The shell-owned editor (text + chip truth); the composer binds its contenteditable to it. */
    editor;
    /** The public provide-channel action face (one stable identity per session). */
    actions = {
        setDraft: (text) => { this.setDraft(text); },
        addImages: ids => this.addImages(ids),
        removeImage: (id) => { this.removeImage(id); },
        pruneImages: (ids) => { this.pruneImages(ids); },
        submit: () => { this.submit('queue'); },
    };
    core = new SubmitMachine();
    projection = { detectText: '', clipboardText: '', occurrences: [], selection: null, caret: null };
    rev = 0;
    /** Stable occurrence ids per chip NodeKey (undo restores keys, so ids survive it too). */
    occurrenceIds = new Map();
    occurrenceSeq = 0;
    unregister;
    noticeSeq = 0;
    lastMirroredDraft = '';
    imageIds = [];
    disposed = false;
    /** Draft persistence mirror (Conversation store write; receives the clipboard projection). */
    mirrorFn;
    /** Live lexicon subscription disposer; undefined until the controller resolves. */
    lexiconOff;
    /** Default sends retained until admission settles or scope disposal releases their images. */
    detachedDrafts = new Map();
    /** Failed default sends waiting to be restored together in submission order. */
    failedDetached = new Map();
    /** Revision of the last automatic failure restoration. */
    failedRestoreRev;
    restoringFailures = false;
    imageFlightSeq = 0;
    /** Image-only sends retained until admission settles or scope disposal releases their images. */
    imageFlights = new Map();
    constructor(deps) {
        this.deps = deps;
        this.editor = createEditor({
            namespace: 'dsh-composer',
            nodes: [ReferenceChipNode, TextRefNode],
            onError: (error) => { throw error; },
        });
        this.unregister = mergeRegister(registerPlainText(this.editor), registerHistory(this.editor, createEmptyHistoryState(), HISTORY_MERGE_DELAY_MS), this.editor.registerUpdateListener(() => { this.onEditorUpdate(); }), registerClaimDecoration(this.editor, () => this.activeClaimToken()), registerTextRefDecoration(this.editor, () => this.lexicon.getSnapshot(), () => this.activeClaimToken()), () => { this.lexiconOff?.(); });
        this.state = createSnapshotStore(this.compose());
        deps.queue?.subscribe(() => { this.publish(); });
    }
    // ---- editor plumbing ----
    /**
     * Run one editor edit whose result is observable on return. At the top
     * level this is a discrete update. Inside this editor's own update —
     * command handlers land here synchronously (space/enter picks, paste) —
     * $-functions are already legal, and wrapping them in update() would DEFER
     * them past the synchronous bail answer (and a nested discrete throws);
     * the body runs directly and the outer update commits it.
     * @param fn - the $-edit body.
     */
    applyEdit(fn, tag) {
        if (this.editor._updating) {
            // Nested application joins the enclosing update (the PASTE_COMMAND
            // dispatch path always lands here), so the tag attaches to that update.
            if (tag !== undefined)
                $addUpdateTag(tag);
            fn();
            return;
        }
        this.editor.update(fn, { discrete: true, ...(tag === undefined ? {} : { tag }) });
    }
    /**
     * Subscribe the text-ref re-scan to the controller's lexicon once the
     * controller resolves. The deps thunk cannot resolve at construction (the
     * shell is created inside the sessions provide materialization), so the
     * first interactive updates retry until it can.
     */
    ensureLexiconSubscription() {
        if (this.lexiconOff !== undefined)
            return;
        const controller = this.deps.inputTriggers?.();
        if (controller === undefined)
            return;
        this.lexiconOff = controller.lexicon.subscribe(() => { rescanTextRefs(this.editor); });
    }
    /** Re-project, run the claim watch, publish, and feed trigger tracking after every editor commit. */
    onEditorUpdate() {
        this.ensureLexiconSubscription();
        const prev = this.projection;
        this.projection = this.editor.getEditorState().read(() => $projectComposer(key => this.occurrenceIdOf(key)));
        // Selection-only commits advance neither the revision nor the published
        // state: menus still track the caret below, while draftRev moves only
        // with content so a snapshot-built span (apply.ts) stays CAS-valid across
        // caret motion and subscribers do not re-render per caret move.
        if (projectionContentChanged(prev, this.projection)) {
            this.rev += 1;
            if (!this.restoringFailures && this.failedRestoreRev !== undefined) {
                this.failedDetached.clear();
                this.failedRestoreRev = undefined;
            }
            this.dispatchRun(({ type: 'draft-changed', draft: this.projection.clipboardText }));
        }
        const caret = this.projection.caret;
        if (caret !== null) {
            this.deps.inputTriggers?.()?.track(this.projection.detectText, caret, { tier: guardOf(this.core.state.phase) }, this.rev);
        }
    }
    occurrenceIdOf(key) {
        const existing = this.occurrenceIds.get(key);
        if (existing !== undefined)
            return existing;
        this.occurrenceSeq += 1;
        this.occurrenceIds.set(key, this.occurrenceSeq);
        return this.occurrenceSeq;
    }
    // ---- SessionInput face ----
    /**
     * Replace the whole draft (persisted-draft seed and programmatic writes).
     * Placeholder-sanitized; newlines split paragraphs; the caret lands at the
     * end. Merged into history so a seed is not an undoable step of its own.
     * @param text - the full next draft.
     */
    setDraft(text) {
        const clean = text.replace(REFERENCE_PLACEHOLDER_RE, '');
        if (clean === this.projection.clipboardText)
            return;
        this.editor.update(() => {
            const root = $getRoot();
            root.clear();
            for (const line of clean.split('\n')) {
                const paragraph = $createParagraphNode();
                if (line !== '')
                    paragraph.append($createTextNode(line));
                root.append(paragraph);
            }
            root.selectEnd();
        }, { discrete: true, tag: HISTORY_MERGE_TAG });
    }
    /** Append plain-text paragraphs without replacing typed content or reference chips. */
    appendDraft(text) {
        const clean = text.replace(REFERENCE_PLACEHOLDER_RE, '');
        if (clean === '')
            return;
        this.applyEdit(() => {
            const root = $getRoot();
            const lines = clean.split('\n');
            const last = root.getLastChild();
            if ($isParagraphNode(last) && last.getTextContent() === '') {
                const first = lines.shift();
                if (first !== undefined && first !== '')
                    last.append($createTextNode(first));
            }
            for (const line of lines) {
                const paragraph = $createParagraphNode();
                if (line !== '')
                    paragraph.append($createTextNode(line));
                root.append(paragraph);
            }
            root.selectEnd();
        }, HISTORY_MERGE_TAG);
    }
    /** Append ordered image ids unless an admission transaction is locked. */
    addImages(ids) {
        if (this.snapshot.phase === 'adjudicating' || this.snapshot.phase === 'submitting')
            return false;
        if (ids.length === 0)
            return true;
        this.imageIds = [...this.imageIds, ...ids];
        this.publish();
        return true;
    }
    /**
     * Remove one image id from this draft. Busy admission phases refuse, like
     * {@link addImages}: a removal landing while a command submit serializes
     * would otherwise vanish from the rail yet still ride the in-flight send.
     */
    removeImage(id) {
        if (this.snapshot.phase === 'adjudicating' || this.snapshot.phase === 'submitting')
            return;
        const next = this.imageIds.filter(candidate => candidate !== id);
        if (next.length === this.imageIds.length)
            return;
        this.imageIds = next;
        this.publish();
    }
    /**
     * Keep only image ids that still resolve in the browser attachment registry.
     * @param available - live registry ids.
     */
    pruneImages(available) {
        const keep = new Set(available);
        const next = this.imageIds.filter(id => keep.has(id));
        if (next.length === this.imageIds.length)
            return;
        this.imageIds = next;
        this.publish();
    }
    /**
     * Clear the draft as a successful-send commit: the editor empties (no undo
     * unit) and the undo history is cut, so Ctrl/Cmd-Z cannot resurrect sent
     * content (the command path gets the same discipline from submit-settled).
     * @param imageIds - admitted image ids to remove from this draft.
     */
    commitSend(imageIds) {
        const submitted = new Set(imageIds);
        this.imageIds = this.imageIds.filter(id => !submitted.has(id));
        this.dispatchRun(({ type: 'send-committed' }));
    }
    /**
     * Insert pasted plain text over the current editor selection
     * (placeholder-sanitized). The paste event's own default is suppressed by
     * the caller; PASTE_TAG makes the paste its own history boundary, so one
     * undo never removes both the paste and typing inside the merge window.
     * @param text - pasted plain text.
     */
    paste(text) {
        const clean = text.replace(REFERENCE_PLACEHOLDER_RE, '');
        if (clean === '')
            return;
        this.applyEdit(() => {
            const selection = $getSelection();
            if ($isRangeSelection(selection)) {
                selection.insertText(clean);
                return;
            }
            // No selection yet (never-focused surface): land at the document end,
            // growing the first paragraph when the tree is empty.
            const root = $getRoot();
            if (root.getChildrenSize() === 0)
                root.append($createParagraphNode());
            root.selectEnd().insertText(clean);
        }, PASTE_TAG);
    }
    /**
     * Enter adjudication + submit transaction + default sink. Effects fan out
     * from the machine; this method only feeds the event. Lock entry
     * (adjudicating/submitting) force-closes the transient layers: the popup
     * dismisses and the menu tracks frozen.
     */
    submit(mode = 'queue') {
        if (this.snapshot.draft.trim() === '' && this.imageIds.length > 0) {
            if (this.snapshot.phase === 'plain') {
                const imageIds = [...this.imageIds];
                const controller = new AbortController();
                this.imageFlightSeq += 1;
                const flight = this.imageFlightSeq;
                this.imageFlights.set(flight, { controller, imageIds });
                this.commitSend(imageIds);
                void this.deps.defaultSink('', imageIds, mode, controller.signal).then((outcome) => {
                    if (this.disposed || !this.imageFlights.delete(flight))
                        return;
                    if (outcome.kind === 'success')
                        return;
                    this.restoreImages(imageIds);
                    if (outcome.text !== undefined)
                        this.notify('error', outcome.text);
                }, (error) => {
                    if (this.disposed || !this.imageFlights.delete(flight))
                        return;
                    this.restoreImages(imageIds);
                    this.notify('error', error instanceof Error ? error.message : String(error));
                });
            }
            return;
        }
        // Claimed pre-gate: a claim that does not declare image acceptance never
        // submits while images are attached — one notice, everything retained.
        // Enter-time adjudication applies the same policy for unclaimed lines
        // inside the command source itself.
        const before = this.snapshot;
        if (before.phase === 'claimed' && this.imageIds.length > 0 && before.claim?.images !== true) {
            this.notify('error', this.deps.commandImages.unsupportedNotice(before.claim?.token ?? before.draft));
            return;
        }
        this.dispatchRun(({ type: 'enter', mode, draft: this.projection.clipboardText }));
        const phase = this.snapshot.phase;
        if (phase === 'adjudicating' || phase === 'submitting') {
            this.deps.popup?.()?.dismiss();
            this.deps.inputTriggers?.()?.track(this.projection.detectText, 0, { tier: 'frozen' }, this.rev);
        }
    }
    /**
     * Keyboard arbitration while the menu is open.
     * @param key - the intercepted key.
     * @param composing - IME composition guard state.
     * @returns the menu's verdict; 'pass' when no pipeline is mounted.
     */
    arbitrate(key, composing) {
        return this.deps.inputTriggers?.()?.arbitrate(key, composing) ?? 'pass';
    }
    /**
     * Steer every still-pending queued message into the running turn (the
     * empty-draft accelerated-Enter gesture). Execution belongs to the hub's
     * queue choreography; absent dep = the gesture falls back to the machine's
     * empty-draft no-op.
     */
    steerQueue() {
        this.deps.steerQueue?.();
    }
    /**
     * Space adjudication over the controller's hot state.
     * @returns true = a claim/insert was applied — the caller preventDefaults.
     */
    space() {
        const inputTriggers = this.deps.inputTriggers?.();
        if (inputTriggers === undefined)
            return false;
        return inputTriggers.onSpace();
        // No re-track here: applying the claim/insert mutates the editor, and the
        // update listener re-tracks at the settled caret on its own.
    }
    /** Dismiss the popupSelect shell (any interaction outside the box). */
    dismissPopup() {
        this.deps.popup?.()?.dismiss();
    }
    /**
     * The live selection as a detect-coordinate span (menu-launcher synthetic
     * hits replace it on pick); an absent selection answers a collapsed span at
     * the document end.
     * @returns the ordered [start, end) span in detect coordinates.
     */
    caretSpan() {
        if (this.projection.selection !== null)
            return this.projection.selection;
        const at = this.projection.detectText.length;
        return { start: at, end: at };
    }
    /**
     * Hot plain-text reference lexicon source for the decoration scan:
     * delegates to the controller's aggregated store. Stable
     * identity per shell; without a pipeline the snapshot is the empty Map and
     * subscribers never fire.
     */
    lexicon = {
        getSnapshot: () => this.deps.inputTriggers?.()?.lexicon.getSnapshot() ?? EMPTY_LEXICON,
        subscribe: fn => this.deps.inputTriggers?.()?.lexicon.subscribe(fn) ?? (() => { }),
    };
    // ---- scoped-event application verbs ----
    /**
     * Apply one command claim (scoped begin-command event listener body): the
     * editor replaces [0, span.end) with the claim token, then the machine
     * enters claimed.
     * @param claim - the command claim from the pick path.
     * @param span - pick-time span snapshot (detect coordinates).
     * @returns whether the edit applied (phase, span CAS, and leading guard passed).
     */
    beginCommand(claim, span) {
        const phase = this.core.state.phase;
        if (phase !== 'plain' && phase !== 'claimed')
            return false;
        if (span.draftRev !== this.rev)
            return false;
        // Leading-trigger contract: only whitespace may precede the span; the
        // whitespace prefix is dropped so the claimed watch (startsWith) holds.
        if (this.projection.detectText.slice(0, span.start).trim() !== '')
            return false;
        let applied = false;
        this.applyEdit(() => {
            applied = $replaceDetectSpanWithText({ start: 0, end: span.end }, claim.token);
        });
        if (!applied)
            return false;
        this.dispatchRun(({ type: 'claim', claim }));
        return true;
    }
    /**
     * Apply one reference insertion (scoped insert-reference event listener
     * body): the editor replaces the span with one chip node, followed by a
     * separating space unless one is already next.
     * @param ref - the reference insertion from the pick path.
     * @param span - pick-time span snapshot (detect coordinates).
     * @returns whether the edit applied.
     */
    insertReference(ref, span) {
        const phase = this.core.state.phase;
        if (phase !== 'plain' && phase !== 'claimed')
            return false;
        if (span.draftRev !== this.rev)
            return false;
        const tail = this.projection.detectText.slice(span.end, span.end + 1);
        let applied = false;
        this.applyEdit(() => {
            const nodes = tail === ' '
                ? [$createReferenceChipNode(ref)]
                : [$createReferenceChipNode(ref), $createTextNode(' ')];
            applied = $replaceDetectSpanWithNodes(span, nodes);
        });
        return applied;
    }
    /**
     * Consume one command token after business success (scoped consume-token
     * event listener body). Span guard: revision CAS then splice; bare-token
     * guard: trimmed-draft equality then clear.
     * @param guard - exact span or bare-token guard.
     * @returns whether the token was consumed.
     */
    consumeToken(guard) {
        if (guard.kind === 'span') {
            if (guard.span.draftRev !== this.rev || guard.span.start === guard.span.end)
                return false;
            let applied = false;
            this.applyEdit(() => {
                applied = $replaceDetectSpanWithText(guard.span, '');
            });
            return applied;
        }
        if (guard.token === '' || this.projection.clipboardText.trim() !== guard.token)
            return false;
        this.setDraft('');
        return true;
    }
    /**
     * Insert plain reference text over the pick-time span (scoped insert-text
     * event listener body; the plain-text reference path). The editor gains
     * ordinary characters — no chip node; the chip look is a scan-derived
     * decoration, never state.
     * @param text - the plain reference text to splice in (e.g. `/name `).
     * @param span - pick-time span snapshot (detect coordinates).
     * @param keepCompleting - contract passenger; completion re-opening is
     * automatic here (the update listener re-tracks at the settled caret, so an
     * open token — a directory pick's trailing slash — reopens the menu without
     * an explicit re-track).
     * @returns whether the text was applied.
     */
    insertText(text, span, keepCompleting = false) {
        void keepCompleting;
        if (span.draftRev !== this.rev)
            return false;
        let applied = false;
        this.applyEdit(() => {
            applied = $replaceDetectSpanWithText(span, text);
        });
        return applied;
    }
    /**
     * Surface a notice from outside the machine (detached command results).
     * @param level - severity tier.
     * @param text - notice body.
     */
    notify(level, text) {
        this.noticeSeq += 1;
        this.notices.set({ level, text, seq: this.noticeSeq });
    }
    // ---- wiring-layer extras (not on the frozen SessionInput face) ----
    /**
     * Teardown the shell and return every browser-owned image still retained by
     * the draft or an unsettled default send.
     * @returns image ids the scope disposer must release.
     */
    dispose() {
        if (this.disposed)
            return [];
        const retained = new Set(this.imageIds);
        for (const record of this.detachedDrafts.values()) {
            for (const imageId of record.imageIds)
                retained.add(imageId);
        }
        for (const flight of this.imageFlights.values()) {
            for (const imageId of flight.imageIds)
                retained.add(imageId);
            flight.controller.abort();
        }
        this.disposed = true;
        this.dispatchRun(({ type: 'release' }));
        this.unregister();
        this.editor.setRootElement(null);
        this.detachedDrafts.clear();
        this.failedDetached.clear();
        this.imageFlights.clear();
        return [...retained];
    }
    /** Read the live input state (guard derivation reads here). */
    get snapshot() {
        return this.state.getSnapshot();
    }
    /**
     * Bind the draft persistence mirror (Conversation store write). Adopt-on-bind: the
     * store draft may hold a persisted value from a previous mount; the caller
     * seeds it via setDraft BEFORE binding, and afterwards every editor-adopted
     * draft mirrors out.
     * @param write - store draft write.
     * @returns the unbind disposer.
     */
    bindMirror(write) {
        this.mirrorFn = write;
        return () => {
            if (this.mirrorFn === write)
                this.mirrorFn = undefined;
        };
    }
    // ---- effect executor ----
    /** The claim token the decoration transform styles; null while unclaimed. */
    activeClaimToken() {
        const core = this.core.state;
        return (core.phase === 'claimed' || core.phase === 'submitting') && core.claim !== undefined
            ? core.claim.token
            : null;
    }
    /** Dispatch + execute, refreshing the claim decoration when the styled token flips. */
    dispatchRun(ev) {
        const beforeToken = this.activeClaimToken();
        this.run(this.core.dispatch(ev));
        if (this.activeClaimToken() !== beforeToken)
            refreshClaimDecoration(this.editor);
    }
    run(effects) {
        for (const fx of effects)
            this.execute(fx);
        this.publish();
    }
    execute(fx) {
        switch (fx.type) {
            case 'notice': {
                this.noticeSeq += 1;
                this.notices.set({ level: fx.level, text: fx.text, seq: this.noticeSeq });
                return;
            }
            case 'adjudicate': {
                this.adjudicate(fx.attempt, fx.draft);
                return;
            }
            case 'begin-submit': {
                this.beginSubmit(fx.attempt, fx.claim, fx.args);
                return;
            }
            case 'default-sink': {
                this.sinkSerialized(fx.attempt, fx.draft, fx.mode);
                return;
            }
            case 'commit-draft': {
                this.commitDraft(fx.retainSuffixOf);
                return;
            }
        }
    }
    /**
     * Execute the commit-draft effect: clear the committed content (retaining
     * a pure typed-during-flight suffix when the snapshot allows) and cut the
     * undo history so sent content cannot resurrect.
     */
    commitDraft(retainSuffixOf) {
        this.editor.update(() => {
            const layout = $composerLayout();
            const clip = layout.clipboardText;
            if (retainSuffixOf !== null && clip !== retainSuffixOf && clip.startsWith(retainSuffixOf)) {
                $replaceDetectSpanWithText({ start: 0, end: detectOffsetOfClipboardOffset(layout, retainSuffixOf.length) }, '');
                return;
            }
            const root = $getRoot();
            root.clear();
            root.selectEnd();
        }, { discrete: true, tag: HISTORY_MERGE_TAG });
        this.editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
    }
    /**
     * Prompt serialization before the sink: expand each chip occurrence to its
     * owner's model form via the session controller's codec routing. Owner
     * missing or serialization failure rejects the detached send and restores
     * its editor snapshot. Chip-free drafts skip the async detour.
     */
    sinkSerialized(attempt, draft, mode) {
        const imageIds = [...this.imageIds];
        this.imageIds = [];
        const occurrences = this.projection.occurrences;
        const record = { draft, occurrences, imageIds };
        this.detachedDrafts.set(attempt.seq, record);
        if (this.failedRestoreRev === this.rev) {
            this.failedDetached.clear();
            this.failedRestoreRev = undefined;
        }
        if (occurrences.length === 0) {
            this.settleSink(attempt, this.deps.defaultSink(draft.trim(), imageIds, mode, attempt.signal));
            return;
        }
        const inputTriggers = this.deps.inputTriggers?.();
        void Promise.all(occurrences.map(async (o) => {
            if (inputTriggers === undefined)
                throw new Error(`no serializer for reference source "${o.source}"`);
            return {
                offset: o.offset,
                length: o.length,
                text: await inputTriggers.serializeReference(o.source, o.ref, attempt.signal),
            };
        })).then((parts) => {
            if (this.disposed)
                return;
            // Splice model forms over their clipboard ranges (offsets are
            // clipboard-projection; parts arrive offset-sorted since chips walk in
            // document order).
            let out = '';
            let cursor = 0;
            for (const part of parts) {
                out += draft.slice(cursor, part.offset) + part.text;
                cursor = part.offset + part.length;
            }
            out += draft.slice(cursor);
            this.settleSink(attempt, this.deps.defaultSink(out.trim(), imageIds, mode, attempt.signal));
        }, (error) => {
            if (this.dead(attempt))
                return;
            const message = error instanceof Error ? error.message : String(error);
            this.settleDetachedFailure(attempt, message);
        });
    }
    /** Settle one detached default send independently of other sends. */
    settleSink(attempt, pending) {
        pending.then((outcome) => {
            if (this.dead(attempt))
                return;
            if (outcome.kind !== 'success') {
                this.settleDetachedFailure(attempt, outcome.text);
                return;
            }
            this.detachedDrafts.delete(attempt.seq);
            this.dispatchRun(({ type: 'sink-settled', attempt, ok: true, outcome }));
        }, (error) => {
            if (this.dead(attempt))
                return;
            this.settleDetachedFailure(attempt, error instanceof Error ? error.message : String(error));
        });
    }
    /** Restore one failed detached send without overwriting text entered after a restoration. */
    settleDetachedFailure(attempt, message) {
        const record = this.detachedDrafts.get(attempt.seq);
        if (record === undefined)
            return;
        this.detachedDrafts.delete(attempt.seq);
        this.restoreImages(record.imageIds);
        this.failedDetached.set(attempt.seq, record);
        if (this.projection.clipboardText === '' || this.failedRestoreRev === this.rev) {
            this.restoreFailedDrafts();
        }
        this.dispatchRun(({ type: 'sink-settled', attempt, ok: false, ...(message === undefined ? {} : { message }) }));
    }
    /** Rebuild all currently failed snapshots in submission order. */
    restoreFailedDrafts() {
        const records = [...this.failedDetached.entries()].sort(([a], [b]) => a - b).map(([, record]) => record);
        if (records.length === 0)
            return;
        const separator = '\n\n';
        let draft = '';
        const occurrences = [];
        for (const record of records) {
            const base = draft.length + (draft === '' ? 0 : separator.length);
            if (draft !== '')
                draft += separator;
            draft += record.draft;
            for (const occurrence of record.occurrences) {
                occurrences.push({ ...occurrence, offset: base + occurrence.offset });
            }
        }
        this.restoringFailures = true;
        try {
            this.editor.update(() => {
                const root = $getRoot();
                root.clear();
                let paragraph = $createParagraphNode();
                root.append(paragraph);
                const appendText = (text) => {
                    const lines = text.split('\n');
                    for (let i = 0; i < lines.length; i += 1) {
                        const line = lines[i];
                        if (line !== '')
                            paragraph.append($createTextNode(line));
                        if (i < lines.length - 1) {
                            paragraph = $createParagraphNode();
                            root.append(paragraph);
                        }
                    }
                };
                let cursor = 0;
                for (const occurrence of occurrences) {
                    appendText(draft.slice(cursor, occurrence.offset));
                    paragraph.append(new ReferenceChipNode({
                        source: occurrence.source,
                        ref: occurrence.ref,
                        label: occurrence.label,
                        ...(occurrence.appearance === undefined ? {} : { appearance: occurrence.appearance }),
                        clipboardText: occurrence.clipboardText,
                    }, occurrence.invalid === true));
                    cursor = occurrence.offset + occurrence.length;
                }
                appendText(draft.slice(cursor));
                root.selectEnd();
            }, { discrete: true, tag: HISTORY_MERGE_TAG });
            this.editor.dispatchCommand(CLEAR_HISTORY_COMMAND, undefined);
            this.failedRestoreRev = this.rev;
        }
        finally {
            this.restoringFailures = false;
        }
    }
    /** Return failed-send images to the head of the rail (ids still resolve — release happens only after success). */
    restoreImages(imageIds) {
        if (imageIds.length === 0)
            return;
        const current = new Set(this.imageIds);
        const restored = imageIds.filter(id => !current.has(id));
        if (restored.length === 0)
            return;
        this.imageIds = [...restored, ...this.imageIds];
        this.publish();
    }
    /** Enter adjudication: poll the session controller; failure = notice + draft retained (never a silent downgrade). */
    adjudicate(attempt, draft) {
        const inputTriggers = this.deps.inputTriggers?.();
        if (inputTriggers === undefined) {
            // No pipeline mounted: the '/' line is an ordinary message.
            this.dispatchRun(({ type: 'adjudicated', attempt, outcome: undefined }));
            return;
        }
        inputTriggers.adjudicate(draft.trim(), attempt.signal, { images: this.imageIds.length }).then((outcome) => {
            if (this.dead(attempt))
                return;
            this.dispatchRun(({ type: 'adjudicated', attempt, outcome }));
        }, (error) => {
            if (this.dead(attempt))
                return;
            const message = error instanceof Error ? error.message : String(error);
            this.dispatchRun(({ type: 'adjudication-failed', attempt, message }));
        });
    }
    /**
     * The submit transaction: claim.submit against the session scope; ok maps
     * from the outcome kind. An accepting claim receives the serialized draft
     * images, which are cleared and released only on a success outcome; a
     * failure (serialize, transport, or handler error) keeps draft and images
     * for correction.
     */
    beginSubmit(attempt, claim, args) {
        const imageIds = claim.images === true ? [...this.imageIds] : [];
        Promise.resolve()
            .then(async () => {
            const images = imageIds.length > 0 ? await this.deps.commandImages.serialize(imageIds) : [];
            // Serialization may outlive the attempt (large files, session
            // teardown); a dead attempt must not reach the Host executor.
            if (this.dead(attempt))
                return undefined;
            return claim.submit(args, this.deps.actx, images);
        })
            .then((outcome) => {
            if (outcome === undefined || this.dead(attempt))
                return;
            if (outcome.kind === 'success' && imageIds.length > 0) {
                const submitted = new Set(imageIds);
                this.imageIds = this.imageIds.filter(id => !submitted.has(id));
                this.deps.commandImages.release(imageIds);
            }
            this.dispatchRun(({
                type: 'submit-settled', attempt, ok: outcome.kind === 'success',
                draft: this.projection.clipboardText, outcome,
                ...(outcome.kind === 'error' && outcome.text === undefined ? { message: 'command failed' } : {}),
            }));
        }, (error) => {
            if (this.dead(attempt))
                return;
            const message = error instanceof Error ? error.message : String(error);
            this.dispatchRun(({
                type: 'submit-settled', attempt, ok: false,
                draft: this.projection.clipboardText, message,
            }));
        });
    }
    /** Late-settlement guard: superseded attempts and disposed facades drop silently. */
    dead(attempt) {
        return this.disposed || attempt.signal.aborted;
    }
    compose() {
        const core = this.core.state;
        return {
            draft: this.projection.clipboardText,
            imageIds: this.imageIds,
            draftRev: this.rev,
            phase: core.phase,
            ...(core.claim !== undefined ? { claim: core.claim } : {}),
            occurrences: this.projection.occurrences,
            queue: this.deps.queue?.getSnapshot() ?? EMPTY_QUEUE,
        };
    }
    publish() {
        const next = this.compose();
        this.state.set(next);
        if (next.draft !== this.lastMirroredDraft) {
            this.lastMirroredDraft = next.draft;
            this.mirrorFn?.(next.draft);
        }
    }
}
