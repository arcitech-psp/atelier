import { jsx as _jsx, jsxs as _jsxs, Fragment as _Fragment } from "react/jsx-runtime";
/**
 * Atelier workspace chooser: the in-app replacement for the OS "Select
 * Workspace Directory" dialog. One card, no native window, works on a phone:
 *
 *  - Recent workspaces (most recent first, with the time they were last used)
 *    and pinned favourites: click one to open it at once.
 *  - A type-a-path box with autocomplete: the host lists the folders of the
 *    directory being typed, the last segment filters them, Tab completes,
 *    clicking a folder steps into it (Desktop / Documents / OneDrive shortcuts
 *    jump straight to a known place).
 *  - "New folder..." creates a folder under the folder being shown.
 *  - "Browse with Windows..." (small link, local browsers only) still reaches
 *    the host's native folder dialog for the rare case it is wanted.
 *
 * Pure consumer of the injected browse calls; the owning flow decides what
 * "Open" means. Favourites and the local last-used list live in this browser's
 * localStorage (never on the host), so they never touch the workspace registry.
 */
import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import clsx from 'clsx';
import { Button, IconChevronRightOutline14, IconCloseOutline16, IconFolderClose16, IconPlusOutline16, Modal, relativeTime, } from '@deepseek-ai/dsh-client-ui-primitives';
import css from './WorkspaceChooser.module.css';
const PINS_KEY = 'atelier.workspaceChooser.pins.v1';
const RECENT_KEY = 'atelier.workspaceChooser.recent.v1';
const MAX_RECENT_SHOWN = 8;
const MAX_RECENT_STORED = 30;
const EMPTY_SNAPSHOT = { items: [] };
const EMPTY_SOURCE = {
    getSnapshot: () => EMPTY_SNAPSHOT,
    subscribe: () => () => { },
};
function readJson(key, fallback) {
    try {
        const raw = window.localStorage.getItem(key);
        return raw === null ? fallback : JSON.parse(raw);
    }
    catch {
        return fallback;
    }
}
function writeJson(key, value) {
    try {
        window.localStorage.setItem(key, JSON.stringify(value));
    }
    catch {
        // Private mode / quota: favourites simply do not persist.
    }
}
/** Case/separator-insensitive identity of a path (Windows paths compare case-insensitively). */
function pathKey(path) {
    return path.replace(/[\\/]+$/, '').replace(/\//g, '\\').toLowerCase();
}
function baseName(path) {
    const trimmed = path.replace(/[\\/]+$/, '');
    const index = Math.max(trimmed.lastIndexOf('\\'), trimmed.lastIndexOf('/'));
    const name = index < 0 ? trimmed : trimmed.slice(index + 1);
    return name === '' ? path : name;
}
function failureText(error) {
    if (error !== null && typeof error === 'object' && 'rpcError' in error) {
        const rpcError = error.rpcError;
        if (rpcError !== null && typeof rpcError === 'object' && 'message' in rpcError
            && typeof rpcError.message === 'string')
            return rpcError.message;
    }
    return error instanceof Error ? error.message : String(error);
}
function isLoopbackPage() {
    try {
        const host = window.location.hostname;
        return host === 'localhost' || host === 'localhost' || host === '[::1]' || host === '::1';
    }
    catch {
        return false;
    }
}
/** Split what the operator typed into the directory to list and the prefix to filter by. */
function splitDraft(raw, sep) {
    const draft = raw.replace(/^"+|"+$/g, '');
    const index = Math.max(draft.lastIndexOf('\\'), draft.lastIndexOf('/'));
    if (index < 0) {
        if (/^[A-Za-z]:$/.test(draft))
            return { dir: draft + sep, prefix: '' };
        return { dir: null, prefix: draft };
    }
    return { dir: draft.slice(0, index + 1), prefix: draft.slice(index + 1) };
}
function RelTime({ at, t }) {
    const rel = relativeTime(at, Date.now());
    return _jsx("span", { className: css.when, children: t(`chooser.time.${rel.unit}`, { n: String(rel.n) }) });
}
function PinGlyph({ filled }) {
    return (_jsx("svg", { width: "16", height: "16", viewBox: "0 0 16 16", "aria-hidden": "true", children: _jsx("path", { d: "M8 1.8l1.9 4 4.3.6-3.1 3 .8 4.3L8 11.6l-3.9 2.1.8-4.3-3.1-3 4.3-.6z", fill: filled ? 'currentColor' : 'none', stroke: "currentColor", strokeWidth: "1.2", strokeLinejoin: "round" }) }));
}
/**
 * The chooser dialog.
 * @param props - owner conversation, browse calls, and copy.
 * @returns the dialog element (renders nothing while closed).
 */
export function WorkspaceChooser(props) {
    const { open, busy, listDirectory, createDirectory, pickNative, onOpen, onClose, t } = props;
    const source = props.workspaces ?? EMPTY_SOURCE;
    const store = useMemo(() => ({ subscribe: (listener) => source.subscribe(listener), getSnapshot: () => source.getSnapshot() }), [source]);
    const snapshot = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot);
    const [draft, setDraft] = useState('');
    const [home, setHome] = useState(null);
    const [shortcuts, setShortcuts] = useState([]);
    const [view, setView] = useState(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState(null);
    const [highlight, setHighlight] = useState(-1);
    const [pins, setPins] = useState(() => readJson(PINS_KEY, []));
    const [recents, setRecents] = useState(() => readJson(RECENT_KEY, []));
    const [folderDraft, setFolderDraft] = useState(null);
    const [creating, setCreating] = useState(false);
    const [nativeBusy, setNativeBusy] = useState(false);
    const [committing, setCommitting] = useState(false);
    const cache = useRef(new Map());
    const inputRef = useRef(null);
    const showNative = useMemo(isLoopbackPage, []);
    const sep = home !== null && (home.includes('\\') || /^[A-Za-z]:/.test(home)) ? '\\' : '/';
    // Reset on each open, then learn the host's home and probe the shortcuts.
    useEffect(() => {
        if (!open)
            return undefined;
        setDraft('');
        setView(null);
        setError(null);
        setHighlight(-1);
        setFolderDraft(null);
        setPins(readJson(PINS_KEY, []));
        setRecents(readJson(RECENT_KEY, []));
        cache.current.clear();
        const abort = new AbortController();
        void (async () => {
            try {
                const base = await listDirectory(undefined, abort.signal);
                if (abort.signal.aborted)
                    return;
                setHome(base.home);
                const s = base.home.includes('\\') || /^[A-Za-z]:/.test(base.home) ? '\\' : '/';
                const join = (...parts) => base.home + s + parts.join(s);
                const candidates = {
                    desktop: [join('Desktop'), join('OneDrive', 'Desktop')],
                    documents: [join('Documents'), join('OneDrive', 'Documents')],
                    onedrive: [join('OneDrive')],
                };
                const found = [];
                for (const key of ['desktop', 'documents', 'onedrive']) {
                    for (const candidate of candidates[key]) {
                        try {
                            const listing = await listDirectory(candidate, abort.signal);
                            cache.current.set(pathKey(listing.path), listing);
                            found.push({ key, path: listing.path });
                            break;
                        }
                        catch {
                            if (abort.signal.aborted)
                                return;
                        }
                    }
                }
                if (!abort.signal.aborted)
                    setShortcuts(found);
            }
            catch (reason) {
                if (!abort.signal.aborted)
                    setError(failureText(reason));
            }
        })();
        return () => { abort.abort(); };
    }, [open, listDirectory]);
    const { dir, prefix } = useMemo(() => splitDraft(draft, sep), [draft, sep]);
    // Autocomplete: list the directory the draft names (cached; debounced).
    useEffect(() => {
        if (!open || dir === null) {
            setView(null);
            setLoading(false);
            return undefined;
        }
        const cached = cache.current.get(pathKey(dir));
        if (cached !== undefined) {
            setView({ dir, listing: cached, error: null });
            setLoading(false);
            return undefined;
        }
        setLoading(true);
        const abort = new AbortController();
        const timer = window.setTimeout(() => {
            listDirectory(dir, abort.signal).then((listing) => {
                if (abort.signal.aborted)
                    return;
                cache.current.set(pathKey(dir), listing);
                cache.current.set(pathKey(listing.path), listing);
                setView({ dir, listing, error: null });
                setLoading(false);
            }, (reason) => {
                if (abort.signal.aborted)
                    return;
                setView({ dir, listing: null, error: failureText(reason) });
                setLoading(false);
            });
        }, 90);
        return () => {
            window.clearTimeout(timer);
            abort.abort();
        };
    }, [open, dir, listDirectory]);
    const suggestions = useMemo(() => {
        if (view === null || view.listing === null || dir === null || pathKey(view.dir) !== pathKey(dir))
            return [];
        const needle = prefix.toLowerCase();
        const showHidden = needle.startsWith('.');
        return view.listing.entries.filter(entry => (showHidden || !entry.hidden) && entry.name.toLowerCase().startsWith(needle));
    }, [view, dir, prefix]);
    useEffect(() => { setHighlight(-1); }, [draft]);
    const currentListing = view !== null && dir !== null && pathKey(view.dir) === pathKey(dir) ? view.listing : null;
    const currentPath = currentListing?.path ?? null;
    const parentPath = currentListing !== null && currentListing.crumbs.length > 1
        ? currentListing.crumbs[currentListing.crumbs.length - 2]?.path ?? null
        : null;
    const remember = useCallback((path) => {
        const next = [{ path, at: Date.now() }, ...readJson(RECENT_KEY, []).filter(r => pathKey(r.path) !== pathKey(path))]
            .slice(0, MAX_RECENT_STORED);
        writeJson(RECENT_KEY, next);
        setRecents(next);
    }, []);
    const adopt = useCallback((path) => {
        remember(path);
        onOpen(path);
    }, [onOpen, remember]);
    const togglePin = useCallback((path) => {
        setPins((prev) => {
            const exists = prev.some(p => pathKey(p) === pathKey(path));
            const next = exists ? prev.filter(p => pathKey(p) !== pathKey(path)) : [...prev, path];
            writeJson(PINS_KEY, next);
            return next;
        });
    }, []);
    const isPinned = useCallback((path) => pins.some(p => pathKey(p) === pathKey(path)), [pins]);
    const goTo = useCallback((path) => {
        setError(null);
        setDraft(/[\\/]$/.test(path) ? path : path + sep);
        inputRef.current?.focus();
    }, [sep]);
    // Open whatever the box names: verify it is a real folder first.
    const commitDraft = useCallback(async () => {
        const typed = draft.replace(/^"+|"+$/g, '').trim();
        if (typed === '')
            return;
        setCommitting(true);
        setError(null);
        try {
            const listing = await listDirectory(typed);
            adopt(listing.path);
        }
        catch (reason) {
            setError(failureText(reason));
        }
        finally {
            setCommitting(false);
        }
    }, [draft, listDirectory, adopt]);
    const runNative = useCallback(async () => {
        setNativeBusy(true);
        setError(null);
        try {
            const picked = await pickNative();
            if (picked !== null)
                adopt(picked);
        }
        catch (reason) {
            setError(failureText(reason));
        }
        finally {
            setNativeBusy(false);
        }
    }, [pickNative, adopt]);
    const newFolderParent = currentPath ?? home;
    const confirmCreate = useCallback(async () => {
        if (folderDraft === null || newFolderParent === null)
            return;
        const name = folderDraft.trim();
        if (name === '')
            return;
        setCreating(true);
        setError(null);
        try {
            const created = await createDirectory(newFolderParent, name);
            cache.current.delete(pathKey(newFolderParent));
            setFolderDraft(null);
            goTo(created);
        }
        catch (reason) {
            setError(failureText(reason));
        }
        finally {
            setCreating(false);
        }
    }, [folderDraft, newFolderParent, createDirectory, goTo]);
    // Home view rows: pinned first, then recents (registry + local picks), newest first.
    const recentRows = useMemo(() => {
        const byKey = new Map();
        for (const item of snapshot.items) {
            if (item.markers !== undefined && item.markers.length > 0)
                continue;
            const at = Date.parse(item.updatedAt);
            byKey.set(pathKey(item.path), { path: item.path, title: item.title, at: Number.isNaN(at) ? 0 : at });
        }
        for (const local of recents) {
            const key = pathKey(local.path);
            const existing = byKey.get(key);
            if (existing === undefined)
                byKey.set(key, { path: local.path, title: baseName(local.path), at: local.at });
            else if (local.at > existing.at)
                existing.at = local.at;
        }
        const pinnedKeys = new Set(pins.map(pathKey));
        return [...byKey.values()]
            .filter(row => !pinnedKeys.has(pathKey(row.path)))
            .sort((a, b) => b.at - a.at)
            .slice(0, MAX_RECENT_SHOWN);
    }, [snapshot, recents, pins]);
    const pinnedRows = useMemo(() => pins.map((path) => {
        const match = snapshot.items.find(item => pathKey(item.path) === pathKey(path));
        return { path, title: match?.title ?? baseName(path) };
    }), [pins, snapshot]);
    const parentInert = busy || committing || nativeBusy;
    const browsing = dir !== null;
    const canOpen = draft.trim() !== '' && !parentInert;
    const onKeyDown = (event) => {
        if (event.nativeEvent.isComposing)
            return;
        if (event.key === 'ArrowDown' && suggestions.length > 0) {
            event.preventDefault();
            setHighlight(i => Math.min(suggestions.length - 1, i + 1));
        }
        else if (event.key === 'ArrowUp' && suggestions.length > 0) {
            event.preventDefault();
            setHighlight(i => Math.max(-1, i - 1));
        }
        else if (event.key === 'Tab' && prefix !== '' && suggestions.length > 0) {
            event.preventDefault();
            const pick = suggestions[highlight >= 0 ? highlight : 0];
            if (pick !== undefined)
                goTo(pick.path);
        }
        else if (event.key === 'Enter') {
            event.preventDefault();
            const pick = highlight >= 0 ? suggestions[highlight] : undefined;
            if (pick !== undefined)
                goTo(pick.path);
            else
                void commitDraft();
        }
    };
    return (_jsx(Modal, { open: open, onClose: () => { if (!parentInert && folderDraft === null)
            onClose(); }, title: t('chooser.title'), className: clsx(css.dialog), headless: true, children: _jsxs("div", { className: css.card, children: [_jsxs("div", { className: css.header, children: [_jsx("h2", { className: css.title, children: t('chooser.title') }), _jsxs("div", { className: css.pathBox, children: [_jsx("input", { ref: inputRef, className: css.pathInput, value: draft, autoFocus: true, spellCheck: false, autoCapitalize: "off", autoCorrect: "off", "aria-label": t('chooser.pathLabel'), placeholder: t('chooser.pathPlaceholder'), disabled: parentInert, onChange: (event) => { setError(null); setDraft(event.target.value); }, onKeyDown: onKeyDown }), draft !== '' && (_jsx("button", { type: "button", className: css.clear, "aria-label": t('chooser.clear'), onClick: () => { setDraft(''); setError(null); inputRef.current?.focus(); }, children: _jsx(IconCloseOutline16, { size: 14 }) }))] }), _jsx("div", { className: css.shortcuts, children: shortcuts.map(shortcut => (_jsx("button", { type: "button", className: css.shortcut, disabled: parentInert, onClick: () => { goTo(shortcut.path); }, children: t(`chooser.${shortcut.key}`) }, shortcut.key))) })] }), _jsxs("div", { className: css.body, children: [!browsing && (_jsxs(_Fragment, { children: [pinnedRows.length > 0 && (_jsxs("section", { className: css.section, children: [_jsx("h3", { className: css.sectionTitle, children: t('chooser.pinned') }), pinnedRows.map(row => (_jsxs("div", { className: css.rowWrap, children: [_jsxs("button", { type: "button", className: css.row, disabled: parentInert, onClick: () => { adopt(row.path); }, title: row.path, children: [_jsx(IconFolderClose16, { size: 16, className: css.rowIcon }), _jsxs("span", { className: css.rowText, children: [_jsx("span", { className: css.rowName, children: row.title }), _jsx("span", { className: css.rowPath, children: row.path })] })] }), _jsx("button", { type: "button", className: clsx(css.pin, css.pinOn), "aria-label": t('chooser.unpin'), "aria-pressed": true, onClick: () => { togglePin(row.path); }, children: _jsx(PinGlyph, { filled: true }) })] }, row.path)))] })), _jsxs("section", { className: css.section, children: [_jsx("h3", { className: css.sectionTitle, children: t('chooser.recent') }), recentRows.length === 0 && _jsx("p", { className: css.empty, children: t('chooser.empty') }), recentRows.map(row => (_jsxs("div", { className: css.rowWrap, children: [_jsxs("button", { type: "button", className: css.row, disabled: parentInert, onClick: () => { adopt(row.path); }, title: row.path, children: [_jsx(IconFolderClose16, { size: 16, className: css.rowIcon }), _jsxs("span", { className: css.rowText, children: [_jsx("span", { className: css.rowName, children: row.title }), _jsx("span", { className: css.rowPath, children: row.path })] }), row.at > 0 && _jsx(RelTime, { at: row.at, t: t })] }), _jsx("button", { type: "button", className: css.pin, "aria-label": t('chooser.pin'), "aria-pressed": false, onClick: () => { togglePin(row.path); }, children: _jsx(PinGlyph, { filled: false }) })] }, row.path)))] })] })), browsing && (_jsxs("section", { className: css.section, children: [currentListing !== null && (_jsxs("div", { className: css.crumbRow, children: [_jsx("div", { className: css.crumbs, children: currentListing.crumbs.map((crumb, index) => (_jsxs("span", { className: css.crumbItem, children: [index > 0 && _jsx(IconChevronRightOutline14, { size: 12, className: css.crumbChevron }), _jsx("button", { type: "button", className: css.crumb, disabled: parentInert, onClick: () => { goTo(crumb.path); }, children: crumb.name })] }, crumb.path))) }), _jsx("button", { type: "button", className: clsx(css.pin, isPinned(currentListing.path) && css.pinOn), "aria-label": t(isPinned(currentListing.path) ? 'chooser.unpin' : 'chooser.pin'), "aria-pressed": isPinned(currentListing.path), onClick: () => { togglePin(currentListing.path); }, children: _jsx(PinGlyph, { filled: isPinned(currentListing.path) }) })] })), _jsxs("div", { role: "listbox", "aria-label": t('chooser.pathLabel'), className: css.list, children: [parentPath !== null && prefix === '' && (_jsxs("button", { type: "button", className: css.row, disabled: parentInert, onClick: () => { goTo(parentPath); }, children: [_jsx(IconFolderClose16, { size: 16, className: css.rowIcon }), _jsxs("span", { className: css.rowText, children: [_jsx("span", { className: css.rowName, children: ".." }), _jsx("span", { className: css.rowPath, children: t('chooser.up') })] })] })), suggestions.map((entry, index) => (_jsxs("button", { type: "button", role: "option", "aria-selected": index === highlight, className: clsx(css.row, index === highlight && css.rowActive), disabled: parentInert, onMouseEnter: () => { setHighlight(index); }, onClick: () => { goTo(entry.path); }, title: entry.path, children: [_jsx(IconFolderClose16, { size: 16, className: css.rowIcon }), _jsx("span", { className: css.rowText, children: _jsx("span", { className: css.rowName, children: entry.name }) }), _jsx(IconChevronRightOutline14, { size: 12, className: css.crumbChevron })] }, entry.path))), loading && _jsx("p", { className: css.empty, children: t('chooser.loading') }), !loading && view !== null && view.error === null && suggestions.length === 0 && (_jsx("p", { className: css.empty, children: t('chooser.noMatch') })), !loading && view !== null && view.error !== null && _jsx("p", { className: css.errorInline, children: view.error }), currentListing?.truncated === true && _jsx("p", { className: css.empty, children: t('chooser.truncated') })] })] })), error !== null && _jsx("div", { className: css.error, role: "alert", children: error })] }), folderDraft !== null && (_jsxs("div", { className: css.newFolderRow, children: [_jsx("input", { className: css.newFolderInput, value: folderDraft, autoFocus: true, spellCheck: false, disabled: creating, "aria-label": t('chooser.folderName'), placeholder: t('chooser.folderName'), onChange: (event) => { setFolderDraft(event.target.value); }, onKeyDown: (event) => {
                                if (event.nativeEvent.isComposing)
                                    return;
                                if (event.key === 'Enter') {
                                    event.preventDefault();
                                    void confirmCreate();
                                }
                                if (event.key === 'Escape') {
                                    event.stopPropagation();
                                    setFolderDraft(null);
                                }
                            } }), _jsx(Button, { variant: "outline", size: "sm", disabled: creating, onClick: () => { setFolderDraft(null); }, children: t('chooser.cancel') }), _jsx(Button, { variant: "primary", size: "sm", disabled: creating || folderDraft.trim() === '' || newFolderParent === null, onClick: () => { void confirmCreate(); }, children: t('chooser.create') })] })), _jsxs("div", { className: css.footer, children: [_jsx(Button, { variant: "outline", icon: _jsx(IconPlusOutline16, { size: 14 }), disabled: parentInert || newFolderParent === null || folderDraft !== null, onClick: () => { setFolderDraft(''); setError(null); }, children: t('chooser.newFolder') }), showNative && (_jsx("button", { type: "button", className: css.nativeLink, disabled: parentInert, onClick: () => { void runNative(); }, children: t('chooser.native') })), _jsx("span", { className: css.gap }), _jsx(Button, { variant: "outline", disabled: busy, onClick: onClose, children: t('chooser.cancel') }), _jsx(Button, { variant: "primary", disabled: !canOpen, onClick: () => { void commitDraft(); }, children: t('chooser.open') })] })] }) }));
}
