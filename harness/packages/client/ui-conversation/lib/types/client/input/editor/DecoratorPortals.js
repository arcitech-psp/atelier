import { Fragment as _Fragment, jsx as _jsx } from "react/jsx-runtime";
/**
 * Decorator render loop: portals every decorator node's React face into its
 * host element (what @lexical/react's composer does internally, scoped to
 * this composer's needs). Chip DOM identity rides the NodeKey — text edits
 * around a chip never remount its portal.
 */
import * as React from 'react';
import { createPortal } from 'react-dom';
/**
 * Render every decorator's React face into its editor host element.
 * @param props - the editor to observe.
 * @returns the live portal set.
 */
export function DecoratorPortals({ editor }) {
    const [decorators, setDecorators] = React.useState(() => editor === null ? {} : editor.getDecorators());
    React.useLayoutEffect(() => {
        if (editor === null)
            return;
        setDecorators(editor.getDecorators());
        return editor.registerDecoratorListener((next) => { setDecorators(next); });
    }, [editor]);
    if (editor === null)
        return null;
    return (_jsx(_Fragment, { children: Object.entries(decorators).map(([key, jsx]) => {
            const el = editor.getElementByKey(key);
            return el === null ? null : createPortal(jsx, el, key);
        }) }));
}
