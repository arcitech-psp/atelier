import { COMMAND_PRIORITY_CRITICAL, KEY_ARROW_DOWN_COMMAND, KEY_ARROW_UP_COMMAND, KEY_ENTER_COMMAND, KEY_ESCAPE_COMMAND, KEY_SPACE_COMMAND, KEY_TAB_COMMAND, PASTE_COMMAND, } from 'lexical';
import { mergeRegister } from '@lexical/utils';
/** Composition state a keydown can trust (see the module doc's Safari note). */
function isComposingEvent(event, recentlyComposing) {
    // keyCode 229 is the legacy IME-composition signal engines emit without isComposing.
    // oxlint-disable-next-line typescript/no-deprecated
    return event.isComposing || event.keyCode === 229 || recentlyComposing();
}
/**
 * Register the composer keymap on one editor.
 * @param editor - the shell-owned editor.
 * @param handlers - bar-supplied behavior.
 * @returns the unregister disposer.
 */
export function registerComposerKeymap(editor, handlers) {
    // Composition watch: true through composition and for one tick after
    // compositionend (Safari's late closing keydown). The listener rides the
    // root element and re-arms on root swaps.
    let composing = false;
    let composingUntil = 0;
    const onCompositionStart = () => {
        composing = true;
    };
    const onCompositionEnd = () => {
        composing = false;
        composingUntil = Date.now() + 10;
    };
    const recentlyComposing = () => composing || Date.now() < composingUntil;
    const arrow = (key) => (event) => {
        const inComposition = event !== null && isComposingEvent(event, recentlyComposing);
        if (handlers.arbitrate(key, inComposition) === 'consumed') {
            event?.preventDefault();
            return true;
        }
        return false;
    };
    return mergeRegister(editor.registerRootListener((root, prevRoot) => {
        prevRoot?.removeEventListener('compositionstart', onCompositionStart);
        prevRoot?.removeEventListener('compositionend', onCompositionEnd);
        root?.addEventListener('compositionstart', onCompositionStart);
        root?.addEventListener('compositionend', onCompositionEnd);
    }), editor.registerCommand(KEY_ARROW_UP_COMMAND, arrow('up'), COMMAND_PRIORITY_CRITICAL), editor.registerCommand(KEY_ARROW_DOWN_COMMAND, arrow('down'), COMMAND_PRIORITY_CRITICAL), 
    // Tab drills into a drillable highlighted row; otherwise it passes so the
    // browser keeps its native focus traversal.
    editor.registerCommand(KEY_TAB_COMMAND, arrow('tab'), COMMAND_PRIORITY_CRITICAL), editor.registerCommand(KEY_ESCAPE_COMMAND, (event) => {
        // Escape layering: an open overlay closes; claimed without an overlay
        // does NOT release (backspacing the token is the only exit gesture).
        handlers.dismissPopup();
        if (handlers.arbitrate('escape', isComposingEvent(event, recentlyComposing)) === 'consumed') {
            event.preventDefault();
            return true;
        }
        return false;
    }, COMMAND_PRIORITY_CRITICAL), editor.registerCommand(KEY_SPACE_COMMAND, (event) => {
        if (isComposingEvent(event, recentlyComposing))
            return false;
        const consumed = handlers.space();
        if (consumed) {
            event.preventDefault(); // claim token already carries the trailing separator
            return true;
        }
        return false;
    }, COMMAND_PRIORITY_CRITICAL), editor.registerCommand(KEY_ENTER_COMMAND, (event) => {
        // Shift+Enter is the native line break UNCONDITIONALLY — decided before
        // the IME guard so a composition-closing Shift+Enter still breaks the line.
        if (event?.shiftKey === true)
            return false;
        if (event !== null && isComposingEvent(event, recentlyComposing)) {
            // The IME consumes this Enter (candidate pick); neither submit nor
            // break the line. No preventDefault: the browser owns the gesture.
            return true;
        }
        // Menu-open Enter picks the highlight through arbitration; a
        // no-highlight menu passes down to the submit gesture.
        if (handlers.arbitrate('enter', false) !== 'pass') {
            event?.preventDefault();
            return true;
        }
        event?.preventDefault();
        if (event?.repeat === true)
            return true; // held-down Enter must not machine-gun sends
        if (!handlers.canSubmit())
            return true;
        handlers.submit(event?.ctrlKey === true || event?.metaKey === true);
        return true;
    }, COMMAND_PRIORITY_CRITICAL), editor.registerCommand(PASTE_COMMAND, (event) => {
        // Duck-typed: the payload union includes InputEvent, and test engines
        // deliver clipboardData on plain events.
        const clipboardData = event.clipboardData ?? null;
        if (clipboardData === null)
            return false;
        const files = Array.from(clipboardData.items)
            .filter(item => item.kind === 'file')
            .map(item => item.getAsFile())
            .filter((file) => file !== null);
        if (files.length > 0)
            handlers.intakeFiles(files);
        const text = clipboardData.getData('text/plain');
        if (text === '') {
            if (files.length === 0)
                return false;
            event.preventDefault();
            return true;
        }
        event.preventDefault();
        handlers.pasteText(text);
        return true;
    }, COMMAND_PRIORITY_CRITICAL));
}
