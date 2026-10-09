window.__ModuleLoader__.load({
	id: "@deepseek-ai/dsh-client-ui-directory-picker-browse",
	factory: (require) => {
		var module = { exports: {} };
		var exports = module.exports;
		Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
		let react = require("react");
		let _deepseek_ai_dsh_client_ui_primitives = require("@deepseek-ai/dsh-client-ui-primitives");
		let react_jsx_runtime = require("react/jsx-runtime");
		//#region ../../../node_modules/.pnpm/clsx@2.1.1/node_modules/clsx/dist/clsx.mjs
		function r(e) {
			var t, f, n = "";
			if ("string" == typeof e || "number" == typeof e) n += e;
			else if ("object" == typeof e) if (Array.isArray(e)) {
				var o = e.length;
				for (t = 0; t < o; t++) e[t] && (f = r(e[t])) && (n && (n += " "), n += f);
			} else for (f in e) e[f] && (n && (n += " "), n += f);
			return n;
		}
		function clsx() {
			for (var e, t, f = 0, n = "", o = arguments.length; f < o; f++) (e = arguments[f]) && (t = r(e)) && (n && (n += " "), n += t);
			return n;
		}
		//#endregion

		const css = ".QUtxCW_dialog.QUtxCW_dialog{--dsh-scrollbar-thumb:var(--dsw-alias-scrollbar-bg-l2);--dsh-scrollbar-thumb-hover:var(--dsw-alias-scrollbar-hover-l2);gap:0;width:min(560px,100%);height:min(640px,100dvh - 32px);padding:0}.QUtxCW_card{flex-direction:column;flex:1 1 0;height:100%;min-height:0;display:flex}.QUtxCW_header{border-bottom:1px solid var(--dsw-alias-border-l3);flex-direction:column;flex:none;gap:10px;padding:18px 20px 12px 24px;display:flex}.QUtxCW_title{color:var(--dsw-alias-label-primary);margin:0;font-size:16px;font-weight:510;line-height:24px}.QUtxCW_pathBox{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);border-radius:20px;align-items:center;gap:6px;height:40px;padding:0 10px 0 14px;display:flex}.QUtxCW_pathBox:focus-within{border-color:var(--dsw-alias-button-info-fill)}.QUtxCW_pathInput{box-sizing:border-box;min-width:0;height:24px;color:var(--dsw-alias-label-primary);background:0 0;border:none;outline:none;flex:1 1 0;padding:0;font-size:14px;line-height:22px}.QUtxCW_pathInput::placeholder{color:var(--dsw-alias-label-caption)}.QUtxCW_clear{width:24px;height:24px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:12px;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.QUtxCW_clear:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.QUtxCW_shortcuts{flex-wrap:wrap;gap:8px;min-height:0;display:flex}.QUtxCW_shortcuts:empty{display:none}.QUtxCW_shortcut{border:1px solid var(--dsw-alias-border-l2);height:28px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border-radius:14px;padding:0 12px;font-size:13px;font-weight:500;line-height:20px}.QUtxCW_shortcut:hover:enabled{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.QUtxCW_shortcut:disabled{color:var(--dsw-alias-label-caption);cursor:default}.QUtxCW_body{flex-direction:column;flex:1 1 0;min-height:0;padding:8px 14px 8px 20px;display:flex;overflow-y:auto}.QUtxCW_section{flex-direction:column;gap:2px;padding:6px 0;display:flex}.QUtxCW_sectionTitle{letter-spacing:.02em;color:var(--dsw-alias-label-tertiary);margin:0 0 2px;padding:0 4px;font-size:12px;font-weight:510;line-height:18px}.QUtxCW_rowWrap{align-items:center;gap:2px;display:flex}.QUtxCW_list{flex-direction:column;gap:1px;display:flex}.QUtxCW_row{box-sizing:border-box;text-align:left;cursor:pointer;background:0 0;border:none;border-radius:8px;flex:1 1 0;align-items:center;gap:10px;width:100%;min-width:0;min-height:36px;padding:4px 8px;display:flex}.QUtxCW_row:hover:enabled,.QUtxCW_rowActive,.QUtxCW_rowActive:hover:enabled{background:var(--dsw-alias-interactive-bg-hover)}.QUtxCW_row:disabled{cursor:default;opacity:.6}.QUtxCW_rowIcon{color:var(--dsw-alias-label-secondary);flex:none}.QUtxCW_rowText{flex-direction:column;flex:1 1 0;min-width:0;display:flex}.QUtxCW_rowName{text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-primary);font-size:14px;font-weight:500;line-height:20px;overflow:hidden}.QUtxCW_rowPath{text-overflow:ellipsis;white-space:nowrap;color:var(--dsw-alias-label-tertiary);font-size:12px;line-height:16px;overflow:hidden}.QUtxCW_when{color:var(--dsw-alias-label-tertiary);white-space:nowrap;flex:none;font-size:12px;line-height:16px}.QUtxCW_pin{width:32px;height:32px;color:var(--dsw-alias-label-caption);cursor:pointer;background:0 0;border:none;border-radius:8px;flex:none;justify-content:center;align-items:center;padding:0;display:inline-flex}.QUtxCW_pin:hover{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.QUtxCW_pinOn{color:var(--dsw-alias-button-info-fill)}.QUtxCW_crumbRow{align-items:center;gap:4px;padding-bottom:4px;display:flex}.QUtxCW_crumbs{flex-wrap:wrap;flex:1 1 0;align-items:center;gap:2px;min-width:0;display:flex}.QUtxCW_crumbItem{align-items:center;gap:2px;display:inline-flex}.QUtxCW_crumb{text-overflow:ellipsis;white-space:nowrap;max-width:180px;color:var(--dsw-alias-label-secondary);cursor:pointer;background:0 0;border:none;border-radius:6px;padding:2px 6px;font-size:13px;line-height:20px;overflow:hidden}.QUtxCW_crumb:hover:enabled{background:var(--dsw-alias-interactive-bg-hover);color:var(--dsw-alias-label-primary)}.QUtxCW_crumbChevron{color:var(--dsw-alias-label-tertiary);flex:none}.QUtxCW_empty{color:var(--dsw-alias-label-secondary);margin:0;padding:8px;font-size:13px;line-height:20px}.QUtxCW_error,.QUtxCW_errorInline{color:var(--dsw-alias-state-error-primary);margin:0;padding:6px 8px;font-size:12px;line-height:18px}.QUtxCW_newFolderRow{flex:none;align-items:center;gap:8px;padding:10px 20px 0 24px;display:flex}.QUtxCW_newFolderInput{box-sizing:border-box;border:1px solid var(--dsw-alias-border-l2);min-width:0;height:32px;color:var(--dsw-alias-label-primary);background:0 0;border-radius:16px;outline:none;flex:1 1 0;padding:0 12px;font-size:14px}.QUtxCW_newFolderInput:focus{border-color:var(--dsw-alias-button-info-fill)}.QUtxCW_footer{border-top:1px solid var(--dsw-alias-border-l3);flex-wrap:wrap;flex:none;align-items:center;gap:8px;padding:14px 20px 14px 24px;display:flex}.QUtxCW_gap{flex:1 1 0}.QUtxCW_nativeLink{color:var(--dsw-alias-label-tertiary);text-underline-offset:2px;cursor:pointer;white-space:nowrap;background:0 0;border:none;padding:4px 6px;font-size:12px;line-height:18px;text-decoration:underline}.QUtxCW_nativeLink:hover:enabled{color:var(--dsw-alias-label-primary)}.QUtxCW_nativeLink:disabled{cursor:default}@media (width<=640px),(pointer:coarse){.QUtxCW_row{min-height:48px}.QUtxCW_pin{width:44px;height:44px}.QUtxCW_shortcut{height:36px;padding:0 16px}.QUtxCW_pathInput,.QUtxCW_newFolderInput{font-size:16px}.QUtxCW_pathBox{height:44px}.QUtxCW_header{padding:14px 16px 10px}.QUtxCW_body{padding:6px 8px 6px 12px}.QUtxCW_footer{padding:12px 16px}.QUtxCW_newFolderRow{padding:10px 16px 0}}";
		const tagId = "@deepseek-ai/dsh-client-ui-directory-picker-browse/WorkspaceChooser.module.css";
		if (typeof document !== "undefined" && document.querySelector("style[data-plugin-css=" + JSON.stringify(tagId) + "]") === null) {
			const tag = document.createElement("style");
			tag.dataset.plugin = "@deepseek-ai/dsh-client-ui-directory-picker-browse";
			tag.dataset.pluginCss = tagId;
			tag.textContent = css;
			document.head.appendChild(tag);
		}
		var WorkspaceChooser_module_css_default = {
			"body": "QUtxCW_body",
			"card": "QUtxCW_card",
			"clear": "QUtxCW_clear",
			"crumb": "QUtxCW_crumb",
			"crumbChevron": "QUtxCW_crumbChevron",
			"crumbItem": "QUtxCW_crumbItem",
			"crumbRow": "QUtxCW_crumbRow",
			"crumbs": "QUtxCW_crumbs",
			"dialog": "QUtxCW_dialog",
			"empty": "QUtxCW_empty",
			"error": "QUtxCW_error",
			"errorInline": "QUtxCW_errorInline",
			"footer": "QUtxCW_footer",
			"gap": "QUtxCW_gap",
			"header": "QUtxCW_header",
			"list": "QUtxCW_list",
			"nativeLink": "QUtxCW_nativeLink",
			"newFolderInput": "QUtxCW_newFolderInput",
			"newFolderRow": "QUtxCW_newFolderRow",
			"pathBox": "QUtxCW_pathBox",
			"pathInput": "QUtxCW_pathInput",
			"pin": "QUtxCW_pin",
			"pinOn": "QUtxCW_pinOn",
			"row": "QUtxCW_row",
			"rowActive": "QUtxCW_rowActive",
			"rowIcon": "QUtxCW_rowIcon",
			"rowName": "QUtxCW_rowName",
			"rowPath": "QUtxCW_rowPath",
			"rowText": "QUtxCW_rowText",
			"rowWrap": "QUtxCW_rowWrap",
			"section": "QUtxCW_section",
			"sectionTitle": "QUtxCW_sectionTitle",
			"shortcut": "QUtxCW_shortcut",
			"shortcuts": "QUtxCW_shortcuts",
			"title": "QUtxCW_title",
			"when": "QUtxCW_when"
		};
		//#endregion
		//#region src/client/WorkspaceChooser.tsx
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
		const PINS_KEY = "atelier.workspaceChooser.pins.v1";
		const RECENT_KEY = "atelier.workspaceChooser.recent.v1";
		const MAX_RECENT_SHOWN = 8;
		const MAX_RECENT_STORED = 30;
		const EMPTY_SNAPSHOT = { items: [] };
		const EMPTY_SOURCE = {
			getSnapshot: () => EMPTY_SNAPSHOT,
			subscribe: () => () => {}
		};
		function readJson(key, fallback) {
			try {
				const raw = window.localStorage.getItem(key);
				return raw === null ? fallback : JSON.parse(raw);
			} catch {
				return fallback;
			}
		}
		function writeJson(key, value) {
			try {
				window.localStorage.setItem(key, JSON.stringify(value));
			} catch {}
		}
		/** Case/separator-insensitive identity of a path (Windows paths compare case-insensitively). */
		function pathKey(path) {
			return path.replace(/[\\/]+$/, "").replace(/\//g, "\\").toLowerCase();
		}
		function baseName(path) {
			const trimmed = path.replace(/[\\/]+$/, "");
			const index = Math.max(trimmed.lastIndexOf("\\"), trimmed.lastIndexOf("/"));
			const name = index < 0 ? trimmed : trimmed.slice(index + 1);
			return name === "" ? path : name;
		}
		function failureText(error) {
			if (error !== null && typeof error === "object" && "rpcError" in error) {
				const rpcError = error.rpcError;
				if (rpcError !== null && typeof rpcError === "object" && "message" in rpcError && typeof rpcError.message === "string") return rpcError.message;
			}
			return error instanceof Error ? error.message : String(error);
		}
		function isLoopbackPage() {
			try {
				const host = window.location.hostname;
				return host === "localhost" || host === "localhost" || host === "[::1]" || host === "::1";
			} catch {
				return false;
			}
		}
		/** Split what the operator typed into the directory to list and the prefix to filter by. */
		function splitDraft(raw, sep) {
			const draft = raw.replace(/^"+|"+$/g, "");
			const index = Math.max(draft.lastIndexOf("\\"), draft.lastIndexOf("/"));
			if (index < 0) {
				if (/^[A-Za-z]:$/.test(draft)) return {
					dir: draft + sep,
					prefix: ""
				};
				return {
					dir: null,
					prefix: draft
				};
			}
			return {
				dir: draft.slice(0, index + 1),
				prefix: draft.slice(index + 1)
			};
		}
		function RelTime({ at, t }) {
			const rel = (0, _deepseek_ai_dsh_client_ui_primitives.relativeTime)(at, Date.now());
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
				className: WorkspaceChooser_module_css_default.when,
				children: t(`chooser.time.${rel.unit}`, { n: String(rel.n) })
			});
		}
		function PinGlyph({ filled }) {
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)("svg", {
				width: "16",
				height: "16",
				viewBox: "0 0 16 16",
				"aria-hidden": "true",
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("path", {
					d: "M8 1.8l1.9 4 4.3.6-3.1 3 .8 4.3L8 11.6l-3.9 2.1.8-4.3-3.1-3 4.3-.6z",
					fill: filled ? "currentColor" : "none",
					stroke: "currentColor",
					strokeWidth: "1.2",
					strokeLinejoin: "round"
				})
			});
		}
		/**
		* The chooser dialog.
		* @param props - owner conversation, browse calls, and copy.
		* @returns the dialog element (renders nothing while closed).
		*/
		function WorkspaceChooser(props) {
			const { open, busy, listDirectory, createDirectory, pickNative, onOpen, onClose, t } = props;
			const source = props.workspaces ?? EMPTY_SOURCE;
			const store = (0, react.useMemo)(() => ({ subscribe: (listener) => source.subscribe(listener), getSnapshot: () => source.getSnapshot() }), [source]);
			const snapshot = (0, react.useSyncExternalStore)(store.subscribe, store.getSnapshot, store.getSnapshot);
			const [draft, setDraft] = (0, react.useState)("");
			const [home, setHome] = (0, react.useState)(null);
			const [shortcuts, setShortcuts] = (0, react.useState)([]);
			const [view, setView] = (0, react.useState)(null);
			const [loading, setLoading] = (0, react.useState)(false);
			const [error, setError] = (0, react.useState)(null);
			const [highlight, setHighlight] = (0, react.useState)(-1);
			const [pins, setPins] = (0, react.useState)(() => readJson(PINS_KEY, []));
			const [recents, setRecents] = (0, react.useState)(() => readJson(RECENT_KEY, []));
			const [folderDraft, setFolderDraft] = (0, react.useState)(null);
			const [creating, setCreating] = (0, react.useState)(false);
			const [nativeBusy, setNativeBusy] = (0, react.useState)(false);
			const [committing, setCommitting] = (0, react.useState)(false);
			const cache = (0, react.useRef)(/* @__PURE__ */ new Map());
			const inputRef = (0, react.useRef)(null);
			const showNative = (0, react.useMemo)(isLoopbackPage, []);
			const sep = home !== null && (home.includes("\\") || /^[A-Za-z]:/.test(home)) ? "\\" : "/";
			(0, react.useEffect)(() => {
				if (!open) return void 0;
				setDraft("");
				setView(null);
				setError(null);
				setHighlight(-1);
				setFolderDraft(null);
				setPins(readJson(PINS_KEY, []));
				setRecents(readJson(RECENT_KEY, []));
				cache.current.clear();
				const abort = new AbortController();
				(async () => {
					try {
						const base = await listDirectory(void 0, abort.signal);
						if (abort.signal.aborted) return;
						setHome(base.home);
						const s = base.home.includes("\\") || /^[A-Za-z]:/.test(base.home) ? "\\" : "/";
						const join = (...parts) => base.home + s + parts.join(s);
						const candidates = {
							desktop: [join("Desktop"), join("OneDrive", "Desktop")],
							documents: [join("Documents"), join("OneDrive", "Documents")],
							onedrive: [join("OneDrive")]
						};
						const found = [];
						for (const key of [
							"desktop",
							"documents",
							"onedrive"
						]) for (const candidate of candidates[key]) try {
							const listing = await listDirectory(candidate, abort.signal);
							cache.current.set(pathKey(listing.path), listing);
							found.push({
								key,
								path: listing.path
							});
							break;
						} catch {
							if (abort.signal.aborted) return;
						}
						if (!abort.signal.aborted) setShortcuts(found);
					} catch (reason) {
						if (!abort.signal.aborted) setError(failureText(reason));
					}
				})();
				return () => {
					abort.abort();
				};
			}, [open, listDirectory]);
			const { dir, prefix } = (0, react.useMemo)(() => splitDraft(draft, sep), [draft, sep]);
			(0, react.useEffect)(() => {
				if (!open || dir === null) {
					setView(null);
					setLoading(false);
					return;
				}
				const cached = cache.current.get(pathKey(dir));
				if (cached !== void 0) {
					setView({
						dir,
						listing: cached,
						error: null
					});
					setLoading(false);
					return;
				}
				setLoading(true);
				const abort = new AbortController();
				const timer = window.setTimeout(() => {
					listDirectory(dir, abort.signal).then((listing) => {
						if (abort.signal.aborted) return;
						cache.current.set(pathKey(dir), listing);
						cache.current.set(pathKey(listing.path), listing);
						setView({
							dir,
							listing,
							error: null
						});
						setLoading(false);
					}, (reason) => {
						if (abort.signal.aborted) return;
						setView({
							dir,
							listing: null,
							error: failureText(reason)
						});
						setLoading(false);
					});
				}, 90);
				return () => {
					window.clearTimeout(timer);
					abort.abort();
				};
			}, [
				open,
				dir,
				listDirectory
			]);
			const suggestions = (0, react.useMemo)(() => {
				if (view === null || view.listing === null || dir === null || pathKey(view.dir) !== pathKey(dir)) return [];
				const needle = prefix.toLowerCase();
				const showHidden = needle.startsWith(".");
				return view.listing.entries.filter((entry) => (showHidden || !entry.hidden) && entry.name.toLowerCase().startsWith(needle));
			}, [
				view,
				dir,
				prefix
			]);
			(0, react.useEffect)(() => {
				setHighlight(-1);
			}, [draft]);
			const currentListing = view !== null && dir !== null && pathKey(view.dir) === pathKey(dir) ? view.listing : null;
			const currentPath = currentListing?.path ?? null;
			const parentPath = currentListing !== null && currentListing.crumbs.length > 1 ? currentListing.crumbs[currentListing.crumbs.length - 2]?.path ?? null : null;
			const remember = (0, react.useCallback)((path) => {
				const next = [{
					path,
					at: Date.now()
				}, ...readJson(RECENT_KEY, []).filter((r) => pathKey(r.path) !== pathKey(path))].slice(0, MAX_RECENT_STORED);
				writeJson(RECENT_KEY, next);
				setRecents(next);
			}, []);
			const adopt = (0, react.useCallback)((path) => {
				remember(path);
				onOpen(path);
			}, [onOpen, remember]);
			const togglePin = (0, react.useCallback)((path) => {
				setPins((prev) => {
					const next = prev.some((p) => pathKey(p) === pathKey(path)) ? prev.filter((p) => pathKey(p) !== pathKey(path)) : [...prev, path];
					writeJson(PINS_KEY, next);
					return next;
				});
			}, []);
			const isPinned = (0, react.useCallback)((path) => pins.some((p) => pathKey(p) === pathKey(path)), [pins]);
			const goTo = (0, react.useCallback)((path) => {
				setError(null);
				setDraft(/[\\/]$/.test(path) ? path : path + sep);
				inputRef.current?.focus();
			}, [sep]);
			const commitDraft = (0, react.useCallback)(async () => {
				const typed = draft.replace(/^"+|"+$/g, "").trim();
				if (typed === "") return;
				setCommitting(true);
				setError(null);
				try {
					adopt((await listDirectory(typed)).path);
				} catch (reason) {
					setError(failureText(reason));
				} finally {
					setCommitting(false);
				}
			}, [
				draft,
				listDirectory,
				adopt
			]);
			const runNative = (0, react.useCallback)(async () => {
				setNativeBusy(true);
				setError(null);
				try {
					const picked = await pickNative();
					if (picked !== null) adopt(picked);
				} catch (reason) {
					setError(failureText(reason));
				} finally {
					setNativeBusy(false);
				}
			}, [pickNative, adopt]);
			const newFolderParent = currentPath ?? home;
			const confirmCreate = (0, react.useCallback)(async () => {
				if (folderDraft === null || newFolderParent === null) return;
				const name = folderDraft.trim();
				if (name === "") return;
				setCreating(true);
				setError(null);
				try {
					const created = await createDirectory(newFolderParent, name);
					cache.current.delete(pathKey(newFolderParent));
					setFolderDraft(null);
					goTo(created);
				} catch (reason) {
					setError(failureText(reason));
				} finally {
					setCreating(false);
				}
			}, [
				folderDraft,
				newFolderParent,
				createDirectory,
				goTo
			]);
			const recentRows = (0, react.useMemo)(() => {
				const byKey = /* @__PURE__ */ new Map();
				for (const item of snapshot.items) {
					if (item.markers !== void 0 && item.markers.length > 0) continue;
					const at = Date.parse(item.updatedAt);
					byKey.set(pathKey(item.path), {
						path: item.path,
						title: item.title,
						at: Number.isNaN(at) ? 0 : at
					});
				}
				for (const local of recents) {
					const key = pathKey(local.path);
					const existing = byKey.get(key);
					if (existing === void 0) byKey.set(key, {
						path: local.path,
						title: baseName(local.path),
						at: local.at
					});
					else if (local.at > existing.at) existing.at = local.at;
				}
				const pinnedKeys = new Set(pins.map(pathKey));
				return [...byKey.values()].filter((row) => !pinnedKeys.has(pathKey(row.path))).sort((a, b) => b.at - a.at).slice(0, MAX_RECENT_SHOWN);
			}, [
				snapshot,
				recents,
				pins
			]);
			const pinnedRows = (0, react.useMemo)(() => pins.map((path) => {
				return {
					path,
					title: snapshot.items.find((item) => pathKey(item.path) === pathKey(path))?.title ?? baseName(path)
				};
			}), [pins, snapshot]);
			const parentInert = busy || committing || nativeBusy;
			const browsing = dir !== null;
			const canOpen = draft.trim() !== "" && !parentInert;
			const onKeyDown = (event) => {
				if (event.nativeEvent.isComposing) return;
				if (event.key === "ArrowDown" && suggestions.length > 0) {
					event.preventDefault();
					setHighlight((i) => Math.min(suggestions.length - 1, i + 1));
				} else if (event.key === "ArrowUp" && suggestions.length > 0) {
					event.preventDefault();
					setHighlight((i) => Math.max(-1, i - 1));
				} else if (event.key === "Tab" && prefix !== "" && suggestions.length > 0) {
					event.preventDefault();
					const pick = suggestions[highlight >= 0 ? highlight : 0];
					if (pick !== void 0) goTo(pick.path);
				} else if (event.key === "Enter") {
					event.preventDefault();
					const pick = highlight >= 0 ? suggestions[highlight] : void 0;
					if (pick !== void 0) goTo(pick.path);
					else commitDraft();
				}
			};
			return /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Modal, {
				open,
				onClose: () => {
					if (!parentInert && folderDraft === null) onClose();
				},
				title: t("chooser.title"),
				className: clsx(WorkspaceChooser_module_css_default.dialog),
				headless: true,
				children: /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
					className: WorkspaceChooser_module_css_default.card,
					children: [
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: WorkspaceChooser_module_css_default.header,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h2", {
									className: WorkspaceChooser_module_css_default.title,
									children: t("chooser.title")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
									className: WorkspaceChooser_module_css_default.pathBox,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
										ref: inputRef,
										className: WorkspaceChooser_module_css_default.pathInput,
										value: draft,
										autoFocus: true,
										spellCheck: false,
										autoCapitalize: "off",
										autoCorrect: "off",
										"aria-label": t("chooser.pathLabel"),
										placeholder: t("chooser.pathPlaceholder"),
										disabled: parentInert,
										onChange: (event) => {
											setError(null);
											setDraft(event.target.value);
										},
										onKeyDown
									}), draft !== "" && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: WorkspaceChooser_module_css_default.clear,
										"aria-label": t("chooser.clear"),
										onClick: () => {
											setDraft("");
											setError(null);
											inputRef.current?.focus();
										},
										children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconCloseOutline16, { size: 14 })
									})]
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: WorkspaceChooser_module_css_default.shortcuts,
									children: shortcuts.map((shortcut) => /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
										type: "button",
										className: WorkspaceChooser_module_css_default.shortcut,
										disabled: parentInert,
										onClick: () => {
											goTo(shortcut.path);
										},
										children: t(`chooser.${shortcut.key}`)
									}, shortcut.key))
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: WorkspaceChooser_module_css_default.body,
							children: [
								!browsing && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)(react_jsx_runtime.Fragment, { children: [pinnedRows.length > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
									className: WorkspaceChooser_module_css_default.section,
									children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
										className: WorkspaceChooser_module_css_default.sectionTitle,
										children: t("chooser.pinned")
									}), pinnedRows.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: WorkspaceChooser_module_css_default.rowWrap,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
											type: "button",
											className: WorkspaceChooser_module_css_default.row,
											disabled: parentInert,
											onClick: () => {
												adopt(row.path);
											},
											title: row.path,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderClose16, {
												size: 16,
												className: WorkspaceChooser_module_css_default.rowIcon
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: WorkspaceChooser_module_css_default.rowText,
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: WorkspaceChooser_module_css_default.rowName,
													children: row.title
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
													className: WorkspaceChooser_module_css_default.rowPath,
													children: row.path
												})]
											})]
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: clsx(WorkspaceChooser_module_css_default.pin, WorkspaceChooser_module_css_default.pinOn),
											"aria-label": t("chooser.unpin"),
											"aria-pressed": true,
											onClick: () => {
												togglePin(row.path);
											},
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PinGlyph, { filled: true })
										})]
									}, row.path))]
								}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
									className: WorkspaceChooser_module_css_default.section,
									children: [
										/* @__PURE__ */ (0, react_jsx_runtime.jsx)("h3", {
											className: WorkspaceChooser_module_css_default.sectionTitle,
											children: t("chooser.recent")
										}),
										recentRows.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
											className: WorkspaceChooser_module_css_default.empty,
											children: t("chooser.empty")
										}),
										recentRows.map((row) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
											className: WorkspaceChooser_module_css_default.rowWrap,
											children: [/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
												type: "button",
												className: WorkspaceChooser_module_css_default.row,
												disabled: parentInert,
												onClick: () => {
													adopt(row.path);
												},
												title: row.path,
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderClose16, {
														size: 16,
														className: WorkspaceChooser_module_css_default.rowIcon
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
														className: WorkspaceChooser_module_css_default.rowText,
														children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: WorkspaceChooser_module_css_default.rowName,
															children: row.title
														}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: WorkspaceChooser_module_css_default.rowPath,
															children: row.path
														})]
													}),
													row.at > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(RelTime, {
														at: row.at,
														t
													})
												]
											}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
												type: "button",
												className: WorkspaceChooser_module_css_default.pin,
												"aria-label": t("chooser.pin"),
												"aria-pressed": false,
												onClick: () => {
													togglePin(row.path);
												},
												children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PinGlyph, { filled: false })
											})]
										}, row.path))
									]
								})] }),
								browsing && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("section", {
									className: WorkspaceChooser_module_css_default.section,
									children: [currentListing !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										className: WorkspaceChooser_module_css_default.crumbRow,
										children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
											className: WorkspaceChooser_module_css_default.crumbs,
											children: currentListing.crumbs.map((crumb, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
												className: WorkspaceChooser_module_css_default.crumbItem,
												children: [index > 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutline14, {
													size: 12,
													className: WorkspaceChooser_module_css_default.crumbChevron
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
													type: "button",
													className: WorkspaceChooser_module_css_default.crumb,
													disabled: parentInert,
													onClick: () => {
														goTo(crumb.path);
													},
													children: crumb.name
												})]
											}, crumb.path))
										}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
											type: "button",
											className: clsx(WorkspaceChooser_module_css_default.pin, isPinned(currentListing.path) && WorkspaceChooser_module_css_default.pinOn),
											"aria-label": t(isPinned(currentListing.path) ? "chooser.unpin" : "chooser.pin"),
											"aria-pressed": isPinned(currentListing.path),
											onClick: () => {
												togglePin(currentListing.path);
											},
											children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(PinGlyph, { filled: isPinned(currentListing.path) })
										})]
									}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
										role: "listbox",
										"aria-label": t("chooser.pathLabel"),
										className: WorkspaceChooser_module_css_default.list,
										children: [
											parentPath !== null && prefix === "" && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
												type: "button",
												className: WorkspaceChooser_module_css_default.row,
												disabled: parentInert,
												onClick: () => {
													goTo(parentPath);
												},
												children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderClose16, {
													size: 16,
													className: WorkspaceChooser_module_css_default.rowIcon
												}), /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("span", {
													className: WorkspaceChooser_module_css_default.rowText,
													children: [/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: WorkspaceChooser_module_css_default.rowName,
														children: ".."
													}), /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: WorkspaceChooser_module_css_default.rowPath,
														children: t("chooser.up")
													})]
												})]
											}),
											suggestions.map((entry, index) => /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("button", {
												type: "button",
												role: "option",
												"aria-selected": index === highlight,
												className: clsx(WorkspaceChooser_module_css_default.row, index === highlight && WorkspaceChooser_module_css_default.rowActive),
												disabled: parentInert,
												onMouseEnter: () => {
													setHighlight(index);
												},
												onClick: () => {
													goTo(entry.path);
												},
												title: entry.path,
												children: [
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconFolderClose16, {
														size: 16,
														className: WorkspaceChooser_module_css_default.rowIcon
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
														className: WorkspaceChooser_module_css_default.rowText,
														children: /* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", {
															className: WorkspaceChooser_module_css_default.rowName,
															children: entry.name
														})
													}),
													/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconChevronRightOutline14, {
														size: 12,
														className: WorkspaceChooser_module_css_default.crumbChevron
													})
												]
											}, entry.path)),
											loading && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: WorkspaceChooser_module_css_default.empty,
												children: t("chooser.loading")
											}),
											!loading && view !== null && view.error === null && suggestions.length === 0 && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: WorkspaceChooser_module_css_default.empty,
												children: t("chooser.noMatch")
											}),
											!loading && view !== null && view.error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: WorkspaceChooser_module_css_default.errorInline,
												children: view.error
											}),
											currentListing?.truncated === true && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("p", {
												className: WorkspaceChooser_module_css_default.empty,
												children: t("chooser.truncated")
											})
										]
									})]
								}),
								error !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("div", {
									className: WorkspaceChooser_module_css_default.error,
									role: "alert",
									children: error
								})
							]
						}),
						folderDraft !== null && /* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: WorkspaceChooser_module_css_default.newFolderRow,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("input", {
									className: WorkspaceChooser_module_css_default.newFolderInput,
									value: folderDraft,
									autoFocus: true,
									spellCheck: false,
									disabled: creating,
									"aria-label": t("chooser.folderName"),
									placeholder: t("chooser.folderName"),
									onChange: (event) => {
										setFolderDraft(event.target.value);
									},
									onKeyDown: (event) => {
										if (event.nativeEvent.isComposing) return;
										if (event.key === "Enter") {
											event.preventDefault();
											confirmCreate();
										}
										if (event.key === "Escape") {
											event.stopPropagation();
											setFolderDraft(null);
										}
									}
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "outline",
									size: "sm",
									disabled: creating,
									onClick: () => {
										setFolderDraft(null);
									},
									children: t("chooser.cancel")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "primary",
									size: "sm",
									disabled: creating || folderDraft.trim() === "" || newFolderParent === null,
									onClick: () => {
										confirmCreate();
									},
									children: t("chooser.create")
								})
							]
						}),
						/* @__PURE__ */ (0, react_jsx_runtime.jsxs)("div", {
							className: WorkspaceChooser_module_css_default.footer,
							children: [
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "outline",
									icon: /* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.IconPlusOutline16, { size: 14 }),
									disabled: parentInert || newFolderParent === null || folderDraft !== null,
									onClick: () => {
										setFolderDraft("");
										setError(null);
									},
									children: t("chooser.newFolder")
								}),
								showNative && /* @__PURE__ */ (0, react_jsx_runtime.jsx)("button", {
									type: "button",
									className: WorkspaceChooser_module_css_default.nativeLink,
									disabled: parentInert,
									onClick: () => {
										runNative();
									},
									children: t("chooser.native")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)("span", { className: WorkspaceChooser_module_css_default.gap }),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "outline",
									disabled: busy,
									onClick: onClose,
									children: t("chooser.cancel")
								}),
								/* @__PURE__ */ (0, react_jsx_runtime.jsx)(_deepseek_ai_dsh_client_ui_primitives.Button, {
									variant: "primary",
									disabled: !canOpen,
									onClick: () => {
										commitDraft();
									},
									children: t("chooser.open")
								})
							]
						})
					]
				})
			});
		}
		//#endregion
		//#region src/client/chooser-flow.ts
		/**
		* The Atelier workspace-chooser occupant: the same directory-flow hole the
		* Miller browser fills, with the recent / pinned / type-a-path chooser inside.
		* A confirmed folder is the picked path; dismissal is the cancellation; browse
		* failures stay inside the dialog, so the owner's `onError` arm is never driven.
		*/
		/**
		* Flow occupant adapting the owner's conversation onto the chooser dialog.
		* @param props - owner conversation plus the injected chooser face.
		* @returns the dialog element (renders nothing while closed).
		*/
		function ChooserDirectoryFlow(props) {
			return (0, react.createElement)(WorkspaceChooser, {
				open: props.open,
				busy: props.busy,
				listDirectory: props.listDirectory,
				createDirectory: props.createDirectory,
				pickNative: props.pickNative,
				workspaces: props.workspaces,
				t: props.t,
				onOpen: props.onPicked,
				onClose: props.onCancel
			});
		}
		//#endregion
		//#region src/client/index.ts
		/** Locale namespace owning the browser dialog's copy. */
		const LOCALE_NS = "directory-browser";
		/** Required services (cordis fiber inject): the slot registry, workspace UI service, and locale. */
		const inject = [
			"slots",
			"uiWorkspace",
			"locale"
		];
		/**
		* Client plugin body: register the dialog's dictionaries and the browse flow
		* into both directory-flow holes through `slots.inject()` because the
		* ui-workspace entries may activate later or replace their declarations.
		* @param ctx - client root context.
		*/
		function apply(ctx) {
			ctx.effect(() => {
				const disposers = [];
				const dictionaries = [["zh", {
					"browser.title": "选择工作区目录",
					"browser.home": "主目录",
					"browser.newFolder": "新建文件夹",
					"browser.folderName": "文件夹名称",
					"browser.createIn": "在\"{name}\"中新建文件夹",
					"browser.untitledFolder": "未命名文件夹",
					"browser.create": "创建",
					"browser.cancel": "取消",
					"browser.open": "打开",
					"browser.editPath": "编辑路径",
					"browser.loading": "加载中…",
					"browser.truncated": "文件夹过多，仅显示开头部分。",
					"browser.showHidden": "显示隐藏文件",
					"chooser.title": "选择工作区文件夹",
					"chooser.pathLabel": "文件夹路径",
					"chooser.pathPlaceholder": "输入或粘贴文件夹路径…",
					"chooser.recent": "最近使用",
					"chooser.pinned": "已固定",
					"chooser.empty": "还没有最近使用的工作区。请在上方输入路径，或使用快捷入口。",
					"chooser.desktop": "桌面",
					"chooser.documents": "文档",
					"chooser.onedrive": "OneDrive",
					"chooser.newFolder": "新建文件夹…",
					"chooser.folderName": "文件夹名称",
					"chooser.create": "创建",
					"chooser.cancel": "取消",
					"chooser.open": "打开",
					"chooser.native": "用 Windows 浏览…",
					"chooser.up": "上一级文件夹",
					"chooser.pin": "固定",
					"chooser.unpin": "取消固定",
					"chooser.clear": "清除",
					"chooser.noMatch": "没有匹配的文件夹。",
					"chooser.loading": "加载中…",
					"chooser.truncated": "文件夹过多，仅显示开头部分。",
					"chooser.time.now": "刚刚",
					"chooser.time.minutes": "{n} 分钟前",
					"chooser.time.hours": "{n} 小时前",
					"chooser.time.days": "{n} 天前",
					"chooser.time.months": "{n} 个月前",
					"chooser.time.years": "{n} 年前"
				}], ["en", {
					"browser.title": "Select Workspace Directory",
					"browser.home": "Home",
					"browser.newFolder": "New folder",
					"browser.folderName": "Folder name",
					"browser.createIn": "New folder in \"{name}\"",
					"browser.untitledFolder": "Untitled folder",
					"browser.create": "Create",
					"browser.cancel": "Cancel",
					"browser.open": "Open",
					"browser.editPath": "Edit path",
					"browser.loading": "Loading…",
					"browser.truncated": "Too many folders to list; only the beginning is shown.",
					"browser.showHidden": "Show hidden files",
					"chooser.title": "Choose a workspace folder",
					"chooser.pathLabel": "Folder path",
					"chooser.pathPlaceholder": "Type or paste a folder path…",
					"chooser.recent": "Recent",
					"chooser.pinned": "Pinned",
					"chooser.empty": "No recent workspaces yet. Type a path above or use a shortcut.",
					"chooser.desktop": "Desktop",
					"chooser.documents": "Documents",
					"chooser.onedrive": "OneDrive",
					"chooser.newFolder": "New folder…",
					"chooser.folderName": "Folder name",
					"chooser.create": "Create",
					"chooser.cancel": "Cancel",
					"chooser.open": "Open",
					"chooser.native": "Browse with Windows…",
					"chooser.up": "Parent folder",
					"chooser.pin": "Pin",
					"chooser.unpin": "Unpin",
					"chooser.clear": "Clear",
					"chooser.noMatch": "No matching folders.",
					"chooser.loading": "Loading…",
					"chooser.truncated": "Too many folders to list; only the beginning is shown.",
					"chooser.time.now": "just now",
					"chooser.time.minutes": "{n} min ago",
					"chooser.time.hours": "{n} h ago",
					"chooser.time.days": "{n} d ago",
					"chooser.time.months": "{n} mo ago",
					"chooser.time.years": "{n} y ago"
				}]];
				try {
					for (const [locale, dict] of dictionaries) disposers.push(ctx.locale.register(LOCALE_NS, locale, dict));
				} catch (error) {
					for (const dispose of disposers.reverse()) dispose();
					throw error;
				}
				return () => {
					for (const dispose of disposers) dispose();
				};
			}, "directory-picker-browse: dialog dictionaries");
			const injected = () => {
				let workspaces;
				try {
					workspaces = ctx.get("workspaces")?.list;
				} catch {
					workspaces = void 0;
				}
				return {
					listDirectory: (path, signal) => ctx.uiWorkspace.listDirectory(path, signal),
					createDirectory: (path, name) => ctx.uiWorkspace.createDirectory(path, name),
					pickNative: () => ctx.uiWorkspace.pickDirectory(),
					workspaces,
					t: ctx.locale.bind(LOCALE_NS)
				};
			};
			ctx.slots.inject("conversation.hero.workspace.directoryFlow", () => ctx.slots.inject("sidebar.workspaces.directoryFlow", function* () {
				yield ctx.slots.register({
					name: "conversation.hero.workspace.directoryFlow",
					inject: injected
				}, ChooserDirectoryFlow);
				yield ctx.slots.register({
					name: "sidebar.workspaces.directoryFlow",
					inject: injected
				}, ChooserDirectoryFlow);
			}));
		}
		//#endregion
		exports.apply = apply;
		exports.inject = inject;
		return module.exports;
	}
});

