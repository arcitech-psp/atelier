# SPDX-License-Identifier: GPL-3.0-or-later
# Public derivative of the Atelier panel by ARCITECH.
"""Optional native IngeTrazo panel for Vitruvius.

Uses Atelier's authenticated HTTP RPC; secrets are never logged.
Connection, workspace and private home are configured in this panel's Settings.
The independently installed official IngeTrazo MCP server supplies geometry tools.
"""
from __future__ import annotations

import base64
import http.client
import json
import logging
import os
import re
import threading
import time
import urllib.parse
import uuid
from collections import Counter

from PySide6.QtCore import QBuffer, QByteArray, QIODevice, QObject, QSettings, Qt, QTimer, QUrl, Signal
from PySide6.QtGui import (QColor, QFont, QImage, QTextBlockFormat, QTextCharFormat, QTextCursor,
                           QTextDocument, QTextDocumentFragment, QTextImageFormat)
from PySide6.QtWidgets import (QCheckBox, QFileDialog, QFrame, QHBoxLayout, QLabel, QPlainTextEdit,
                               QPushButton, QSplitter, QTextBrowser, QVBoxLayout, QWidget, QFormLayout, QLineEdit, QSpinBox)

log = logging.getLogger("ingetrazo.plugins.atelier")

PRESET = "vitruvius"
TIME_ZONE = "UTC"

def panel_settings():
    """Separate settings namespace; a private INI path can be supplied for tests."""
    path = os.environ.get("ATELIER_PANEL_SETTINGS")
    return QSettings(path, QSettings.IniFormat) if path else QSettings("ARCITECH", "AtelierPublicPanel")

def default_home():
    return os.environ.get("DSH_HOME", os.path.join(os.path.expanduser("~"), "Documents", "Atelier", "home"))


BRONZE = "#d4955a"
INK = "#e8e4de"
MUTED = "#9a948c"
ERR = "#e58b7b"
OK = "#8fc79a"

POLL_ACTIVE_MS = 1500
POLL_IDLE_MS = 6000


# ---------------------------------------------------------------------------------------------- host client
class AtelierError(Exception):
    """kind: 'down' (host unreachable), 'auth' (sign-in refused), 'rpc' (the host answered with an error)."""

    def __init__(self, kind: str, message: str, code: str = "") -> None:
        super().__init__(message)
        self.kind = kind
        self.code = code


class AtelierClient:
    """Minimal, thread-safe client for the Atelier host. Never logs the token or the cookie."""

    def __init__(self) -> None:
        self.configure()
        self._cookie: str | None = None
        self._lock = threading.Lock()

    def configure(self):
        st = panel_settings()
        self.host = str(st.value("connection/host", ".".join(map(str, (127, 0, 0, 1)))))
        self.port = int(st.value("connection/port", 3081))
        self.workspace = str(st.value("connection/workspace", os.path.join(os.path.expanduser("~"), "Documents", "Atelier", "IngeTrazo")))
        self.home = str(st.value("connection/home", default_home()))
        self.origin = f"http://{self.host}:{self.port}"
        self._cookie = None

    def _conn(self, timeout: float = 20.0) -> http.client.HTTPConnection:
        return http.client.HTTPConnection(self.host, self.port, timeout=timeout)

    def login(self, force: bool = False) -> str:
        with self._lock:
            if self._cookie and not force:
                return self._cookie
            try:
                with open(os.path.join(self.home, ".browser-launch-token"), encoding="utf-8") as fh:
                    token = fh.read().strip()
            except OSError:
                raise AtelierError("auth", "Atelier's sign-in token was not found. Start Atelier once, then Retry.") from None
            conn = self._conn(10.0)
            try:
                conn.request("GET", "/?token=" + urllib.parse.quote(token, safe=""))
                resp = conn.getresponse()
                resp.read()
                set_cookie = resp.getheader("set-cookie")
            except OSError:
                raise AtelierError("down", f"Atelier isn't reachable at {self.host}:{self.port}. Start Atelier, then Retry.") from None
            finally:
                conn.close()
            if resp.status != 303 or not set_cookie:
                raise AtelierError("auth", "Atelier didn't accept the sign-in token (it changes when Atelier restarts). "
                                           "Retry signs in again.")
            self._cookie = set_cookie.split(";")[0]
            return self._cookie

    def rpc(self, method: str, args: dict, timeout: float = 30.0, _retry: bool = True):
        cookie = self.login()
        body = json.dumps({"type": "client-request", "rpcId": f"inge-{uuid.uuid4()}", "method": method,
                           "payload": {"args": args}}).encode("utf-8")
        conn = self._conn(timeout)
        try:
            conn.request("POST", f"/api/{method}", body=body, headers={
                "content-type": "application/json", "cookie": cookie, "origin": self.origin})
            resp = conn.getresponse()
            raw = resp.read()
        except OSError:
            raise AtelierError("down", f"Atelier isn't reachable at {self.host}:{self.port}. Start Atelier, then Retry.") from None
        finally:
            conn.close()
        if resp.status in (401, 403):
            if _retry:
                self.login(force=True)
                return self.rpc(method, args, timeout, _retry=False)
            raise AtelierError("auth", "Atelier refused the session sign-in. Retry signs in again.")
        try:
            data = json.loads(raw.decode("utf-8"))
        except ValueError:
            raise AtelierError("rpc", f"{method}: unexpected reply (HTTP {resp.status})") from None
        result = data.get("result") or {}
        if not result.get("ok"):
            err = result.get("error") or {}
            raise AtelierError("rpc", str(err.get("message") or f"{method} failed"), str(err.get("code") or ""))
        return result.get("value")

    # ---- calls --------------------------------------------------------------------------------------------
    def ensure_workspace(self) -> str:
        value = self.rpc("workspace/create", {"request": {"path": self.workspace}})
        return value["workspace"]["workspaceId"]

    def create_session(self, workspace_id: str) -> str:
        created = self.rpc("session/create", {"request": {"workspaceId": workspace_id, "agentPreset": PRESET}})
        sid = created["sessionId"]
        return sid

    def prompt(self, sid: str, request_id: str, content: list) -> None:
        self.rpc("session/prompt", {"request": {"sessionId": sid, "requestId": request_id, "mode": "queue",
                                                "content": content, "clientTimeZone": TIME_ZONE}}, timeout=60.0)

    def cancel(self, sid: str) -> None:
        self.rpc("session/cancel", {"request": {"sessionId": sid}})

    def cursor(self, sid: str) -> int:
        """The session log's last seq. session/page refuses a cut past the cursor and names it; that is the
        only exact unary read of it (session/follow is a websocket stream)."""
        try:
            self.rpc("session/page", {"request": {"address": {"kind": "session", "sessionId": sid},
                                                  "throughSeq": 10 ** 9, "maxMessages": 1}})
        except AtelierError as exc:
            m = re.search(r"past cursor (-?\d+)", str(exc))
            if m:
                return int(m.group(1))
            raise
        return 10 ** 9  # not expected

    def events_since(self, sid: str, last_seq: int, first_load: bool) -> tuple[int, list, bool]:
        cursor = self.cursor(sid)
        if cursor <= last_seq:
            return cursor, [], False
        address = {"kind": "session", "sessionId": sid}
        records: list = []
        before = None
        truncated = False
        for _ in range(40):
            req = {"address": address, "throughSeq": cursor, "maxMessages": 40 if first_load else 25}
            if before is not None:
                req["beforeSeq"] = before
            page = self.rpc("session/page", {"request": req})
            recs = page.get("records") or []
            if not recs:
                break
            records = recs + records
            first_seq = min(r["event"]["seq"] for r in recs)
            if first_load:
                truncated = bool(page.get("hasMore"))
                break
            if first_seq <= last_seq + 1 or not page.get("hasMore"):
                break
            before = first_seq
        events = [r["event"] for r in records if r.get("type") == "event" and r["event"]["seq"] > last_seq]
        events.sort(key=lambda e: e["seq"])
        return cursor, events, truncated

    def attachment(self, sid: str, attachment_id: str) -> bytes | None:
        value = self.rpc("session/attachment", {"request": {"sessionId": sid, "attachmentId": attachment_id}})
        data = (value or {}).get("data")
        return base64.b64decode(data) if data else None


# ---------------------------------------------------------------------------------------------- helpers
def _tool_label(name: str) -> str:
    n = str(name).split("__")[-1].lower()
    if n in ("todo_write", "plan"):
        return "Planning"
    if n in ("task", "agent", "spawn_agent") or "subagent" in n:
        return "Delegating"
    if any(k in n for k in ("screenshot", "capture", "frame", "look", "vision")):
        return "Looking"
    if any(k in n for k in ("query", "get_", "list", "read", "find", "inspect", "search", "check", "describe",
                            "grep", "glob", "recall", "knowledge")):
        return "Checking"
    if any(k in n for k in ("run_python", "build", "create", "add", "set_", "make", "write", "edit", "mutate",
                            "import", "place", "delete", "move", "recipe")):
        return "Building"
    return "Working"


def _error_line(text: str) -> str:
    """The line that says what went wrong: the exception line if there is one, never the "(changed: ...)" footer."""
    skip = ("(changed", "Traceback", "File ", "stderr:", "Error: stderr", "ROLLED BACK")
    lines = [ln.strip() for ln in str(text).splitlines() if ln.strip() and not ln.strip().startswith(skip)]
    for ln in reversed(lines):
        if re.search(r"[A-Za-z]*(Error|Exception):", ln):
            return ln[:200]
    return (lines[0] if lines else "")[:200]


def _short_tool(name: str) -> str:
    return str(name).split("__")[-1]


def _images_in(obj, out: list) -> list:
    """Every image attachment reference inside a tool result, in order."""
    if isinstance(obj, dict):
        if obj.get("type") == "image" and isinstance(obj.get("attachment"), dict):
            out.append(obj["attachment"])
        for v in obj.values():
            _images_in(v, out)
    elif isinstance(obj, list):
        for v in obj:
            _images_in(v, out)
    return out


def _group_size(g) -> str | None:
    try:
        m = getattr(g, "xform", None)
        xs, ys, zs = [], [], []
        for v in g.mesh.vertices:
            p = v.position
            if m is not None and hasattr(m, "map"):
                p = m.map(p)
            xs.append(p.x()); ys.append(p.y()); zs.append(p.z())
        if not xs:
            return None
        return f"{max(xs) - min(xs):.2f} x {max(ys) - min(ys):.2f} x {max(zs) - min(zs):.2f} m"
    except Exception:
        return None


def describe_selection(scene) -> str:
    sel = list(getattr(scene, "selection", None) or ())
    if not sel:
        return "(IngeTrazo selection: nothing is selected.)"
    groups, others = [], Counter()
    for ent in sel:
        if hasattr(ent, "mesh") and hasattr(ent, "name"):
            groups.append(ent)
        else:
            others[type(ent).__name__] += 1
    parts = []
    for g in groups[:12]:
        size = _group_size(g)
        parts.append(f'"{g.name}"' + (f" ({size}, W x D x H)" if size else ""))
    if len(groups) > 12:
        parts.append(f"{len(groups) - 12} more groups")
    for kind, n in others.most_common():
        parts.append(f"{n} {kind.lower()}{'s' if n != 1 else ''}")
    return "(IngeTrazo selection: " + "; ".join(parts) + ".)"


class _Hub(QObject):
    """Carries worker results to the UI thread (queued: the hub lives in the UI thread)."""
    done = Signal(object)


class PromptEdit(QPlainTextEdit):
    submitted = Signal()

    def keyPressEvent(self, event) -> None:  # noqa: N802 (Qt)
        if event.key() in (Qt.Key_Return, Qt.Key_Enter) and not (event.modifiers() & Qt.ShiftModifier):
            self.submitted.emit()
            return
        super().keyPressEvent(event)


def _spaced(widget: QWidget, size: float = 7.5, bold: bool = True, spacing: float = 1.6) -> QWidget:
    f = QFont(widget.font())
    f.setPointSizeF(size)
    f.setBold(bold)
    f.setCapitalization(QFont.AllUppercase)
    f.setLetterSpacing(QFont.AbsoluteSpacing, spacing)
    widget.setFont(f)
    return widget


STYLE = f"""
#AtelierPanel {{ background: #1e1d1b; }}
#AtelierPanel QLabel {{ color: {INK}; }}
#AtelierPanel QTextBrowser {{ background: #242321; color: {INK}; border: 1px solid #35322e; border-radius: 4px;
    selection-background-color: #6b4a2c; }}
#AtelierPanel QPlainTextEdit {{ background: #262523; color: {INK}; border: 1px solid #3a3631; border-radius: 4px;
    padding: 4px; selection-background-color: #6b4a2c; }}
#AtelierPanel QPlainTextEdit:focus {{ border-color: {BRONZE}; }}
#AtelierPanel QPushButton {{ background: #2c2a27; color: {INK}; border: 1px solid #403b35; border-radius: 3px;
    padding: 3px 9px; }}
#AtelierPanel QPushButton:hover {{ border-color: {BRONZE}; }}
#AtelierPanel QPushButton:disabled {{ color: #6d6862; border-color: #33302c; }}
#AtelierPanel QPushButton#atSend {{ background: {BRONZE}; color: #1e1d1b; border: none; font-weight: 600; }}
#AtelierPanel QPushButton#atSend:disabled {{ background: #5a4632; color: #8d8277; }}
#AtelierPanel QPushButton#atStop {{ color: {ERR}; }}
#AtelierPanel QCheckBox {{ color: {INK}; }}
#AtelierPanel QCheckBox::indicator:checked {{ background: {BRONZE}; border: 1px solid {BRONZE}; border-radius: 2px; }}
#AtelierPanel QCheckBox::indicator:unchecked {{ background: #2c2a27; border: 1px solid #4a453e; border-radius: 2px; }}
#AtelierPanel QFrame#atBanner {{ background: #33261d; border: 1px solid #7d5534; border-radius: 4px; }}
#AtelierPanel QFrame#atRule {{ background: {BRONZE}; max-height: 1px; min-height: 1px; border: none; }}
#AtelierPanel QSplitter::handle {{ background: #1e1d1b; }}
"""


# ---------------------------------------------------------------------------------------------- panel
class AtelierPanel(QWidget):
    def __init__(self, app, parent=None) -> None:
        super().__init__(parent)
        self._app = app
        self.setObjectName("AtelierPanel")
        self.setAttribute(Qt.WA_StyledBackground, True)
        self.setStyleSheet(STYLE)
        self._client = AtelierClient()
        self._hub = _Hub(self)
        self._hub.done.connect(self._on_done, Qt.QueuedConnection)
        st = panel_settings()
        self._sid: str | None = str(st.value("atelier/session_id", "") or "") or None
        self._ws: str | None = str(st.value("atelier/workspace_id", "") or "") or None
        self._last_seq = -1
        self._gen = 0                    # bumps on New chat so stale poll results are dropped
        self._poll_busy = False
        self._loaded = False             # the first (history) load of this session happened
        self._running = False
        self._turn_t0: float | None = None
        self._phase = "Idle"
        self._open_calls: dict[str, str] = {}
        self._local_ids: set[str] = set()
        self._pending_send = False      # a prompt was accepted and waits for its turn to start
        self._sending = False           # the prompt HTTP call is in flight
        self._paused = False             # banner shown: polling waits for Retry (or the quiet auto-retry)
        self._photo: tuple[str, str, str] | None = None   # (base64, mediaType, name)
        self._img_n = 0
        self._build_ui()
        self._use_sel.setChecked(str(st.value("atelier/use_selection", "0")) == "1")

        self._poll_timer = QTimer(self)
        self._poll_timer.setSingleShot(True)
        self._poll_timer.timeout.connect(self._poll)
        self._tick = QTimer(self)
        self._tick.setInterval(500)
        self._tick.timeout.connect(self._update_status)
        self._tick.start()
        self._retry_timer = QTimer(self)
        self._retry_timer.setInterval(20000)
        self._retry_timer.timeout.connect(self._quiet_retry)

        if self._sid:
            self._note("Reopening your last Atelier chat…")
            self._schedule(200)
        else:
            self._intro()
        self._update_status()

    # ---- UI ------------------------------------------------------------------------------------------------
    def _build_ui(self) -> None:
        root = QVBoxLayout(self)
        root.setContentsMargins(6, 6, 6, 4)
        root.setSpacing(5)

        head = QHBoxLayout()
        title = _spaced(QLabel("Atelier"), 9.0, True, 2.4)
        title.setStyleSheet(f"color: {BRONZE};")
        head.addWidget(title)
        who = _spaced(QLabel("· Vitruvius"), 7.5, False, 1.4)
        who.setStyleSheet(f"color: {MUTED};")
        head.addWidget(who)
        head.addStretch(1)
        self._new = QPushButton("New chat")
        self._new.setToolTip("Start a fresh Vitruvius chat (the old one stays in Atelier)")
        self._new.clicked.connect(self._on_new_chat)
        head.addWidget(self._new)
        root.addLayout(head)
        self._settings_button = QPushButton("Settings")
        self._settings_box = QWidget()
        form = QFormLayout(self._settings_box)
        self._host_field = QLineEdit(self._client.host)
        self._port_field = QSpinBox()
        self._port_field.setRange(1, 65535)
        self._port_field.setValue(self._client.port)
        self._workspace_field = QLineEdit(self._client.workspace)
        self._home_field = QLineEdit(self._client.home)
        for label, field in [("Host", self._host_field), ("Port", self._port_field), ("Workspace", self._workspace_field), ("Atelier home", self._home_field)]:
            form.addRow(label, field)
        save = QPushButton("Save connection")
        save.clicked.connect(self._save_connection)
        form.addRow(save)
        self._settings_box.hide()
        self._settings_button.clicked.connect(lambda: self._settings_box.setVisible(not self._settings_box.isVisible()))
        root.addWidget(self._settings_button)
        root.addWidget(self._settings_box)
        rule = QFrame()
        rule.setObjectName("atRule")
        root.addWidget(rule)

        self._banner = QFrame()
        self._banner.setObjectName("atBanner")
        bl = QHBoxLayout(self._banner)
        bl.setContentsMargins(8, 5, 6, 5)
        self._banner_text = QLabel("")
        self._banner_text.setWordWrap(True)
        self._banner_text.setStyleSheet(f"color: {INK};")
        bl.addWidget(self._banner_text, 1)
        self._retry = QPushButton("Retry")
        self._retry.clicked.connect(self._on_retry)
        bl.addWidget(self._retry, 0, Qt.AlignTop)
        self._banner.hide()
        root.addWidget(self._banner)

        self._view = QTextBrowser()
        self._view.setOpenExternalLinks(False)
        self._view.setOpenLinks(False)
        self._view.document().setDocumentMargin(8)
        self._view.setMinimumHeight(120)
        self._view.document().setDefaultStyleSheet(
            f"code {{ background-color: #2e2c29; color: #f0d9bf; }} pre {{ background-color: #2e2c29; }}"
            f" a {{ color: {BRONZE}; }}")

        bottom = QWidget()
        bv = QVBoxLayout(bottom)
        bv.setContentsMargins(0, 0, 0, 0)
        bv.setSpacing(4)
        status_row = QHBoxLayout()
        self._status = _spaced(QLabel("Idle"), 7.5, True, 1.6)
        status_row.addWidget(self._status, 1)
        self._stop = QPushButton("Stop")
        self._stop.setObjectName("atStop")
        self._stop.setToolTip("Stop Vitruvius's current turn")
        self._stop.clicked.connect(self._on_stop)
        status_row.addWidget(self._stop)
        bv.addLayout(status_row)

        chip_row = QHBoxLayout()
        self._chip = QLabel("")
        self._chip.setStyleSheet(f"color: {BRONZE};")
        chip_row.addWidget(self._chip, 1)
        self._chip_x = QPushButton("✕")
        self._chip_x.setFixedWidth(26)
        self._chip_x.setToolTip("Remove the photo")
        self._chip_x.clicked.connect(self._clear_photo)
        chip_row.addWidget(self._chip_x)
        bv.addLayout(chip_row)

        self._input = PromptEdit()
        self._input.setPlaceholderText("Ask Vitruvius — e.g. a 6 x 4 m studio with a gable roof\n"
                                       "Enter sends · Shift+Enter: new line")
        self._input.submitted.connect(self._on_send)
        bv.addWidget(self._input, 1)

        row = QHBoxLayout()
        self._photo_btn = QPushButton("Photo…")
        self._photo_btn.setToolTip("Attach a photo or sketch for Vitruvius to work from")
        self._photo_btn.clicked.connect(self._on_photo)
        row.addWidget(self._photo_btn)
        self._use_sel = QCheckBox("Use selection")
        self._use_sel.setToolTip("Add a short line naming the selected objects and their sizes to your message")
        self._use_sel.toggled.connect(lambda on: panel_settings().setValue("atelier/use_selection", "1" if on else "0"))
        row.addWidget(self._use_sel)
        row.addStretch(1)
        self._send = QPushButton("Send")
        self._send.setObjectName("atSend")
        self._send.clicked.connect(self._on_send)
        row.addWidget(self._send)
        bv.addLayout(row)

        split = QSplitter(Qt.Vertical)
        split.setChildrenCollapsible(False)
        split.addWidget(self._view)
        split.addWidget(bottom)
        split.setStretchFactor(0, 4)
        split.setStretchFactor(1, 1)
        line = self._input.fontMetrics().lineSpacing()
        split.setSizes([420, 5 * line + 90])
        root.addWidget(split, 1)
        self._clear_photo()

    def _save_connection(self):
        if self._sending or self._running or self._pending_send:
            self._note("Stop the current turn before changing connection settings.", ERR)
            return
        st = panel_settings()
        for key, value in [("host", self._host_field.text().strip()), ("port", self._port_field.value()), ("workspace", self._workspace_field.text().strip()), ("home", self._home_field.text().strip())]:
            st.setValue("connection/" + key, value)
        self._forget_session()
        self._ws = None
        st.remove("atelier/workspace_id")
        self._client.configure()
        self._settings_box.hide()
        self._note("Connection settings saved. New chats use Vitruvius and the host's default model.")

    def focus_input(self) -> None:
        self._input.setFocus(Qt.ShortcutFocusReason)

    # ---- chat document ---------------------------------------------------------------------------------------
    def _at_bottom(self) -> bool:
        sb = self._view.verticalScrollBar()
        return sb.value() >= sb.maximum() - 24

    def _scroll_end(self, stick: bool) -> None:
        if stick:
            sb = self._view.verticalScrollBar()
            sb.setValue(sb.maximum())

    def _cursor_new_block(self, top: float = 2.0, left: float = 0.0, bg: str | None = None) -> QTextCursor:
        doc = self._view.document()
        cur = QTextCursor(doc)
        cur.movePosition(QTextCursor.End)
        bf = QTextBlockFormat()
        bf.setTopMargin(top)
        bf.setBottomMargin(1)
        bf.setLeftMargin(left)
        if bg:
            bf.setBackground(QColor(bg))
        if doc.isEmpty():
            cur.setBlockFormat(bf)
        else:
            cur.insertBlock(bf, QTextCharFormat())
        return cur

    def _label(self, text: str, color: str) -> None:
        cur = self._cursor_new_block(top=10)
        cf = QTextCharFormat()
        cf.setForeground(QColor(color))
        cf.setFontWeight(QFont.Bold)
        cf.setFontPointSize(7.5)
        cf.setFontCapitalization(QFont.AllUppercase)
        cf.setFontLetterSpacingType(QFont.AbsoluteSpacing)
        cf.setFontLetterSpacing(1.8)
        cur.insertText(text, cf)

    def _markdown(self, text: str, left: float = 0.0) -> None:
        cur = self._cursor_new_block(top=1, left=left)
        try:
            frag = QTextDocumentFragment.fromMarkdown(text)
        except Exception:
            frag = QTextDocumentFragment.fromPlainText(text)
        cur.insertFragment(frag)

    def _line(self, text: str, color: str = MUTED, size: float = 8.0, italic: bool = False, left: float = 0.0) -> None:
        cur = self._cursor_new_block(top=1, left=left)
        cf = QTextCharFormat()
        cf.setForeground(QColor(color))
        cf.setFontPointSize(size)
        cf.setFontItalic(italic)
        cur.insertText(text, cf)

    def _image(self, data: bytes, title: str = "") -> None:
        img = QImage()
        if not img.loadFromData(QByteArray(data)):
            self._line("▸ (an image the panel could not read)")
            return
        width = max(140, min(320, self._view.viewport().width() - 40))
        if img.width() > width:
            img = img.scaledToWidth(width, Qt.SmoothTransformation)
        self._img_n += 1
        name = f"atelier-img://{self._img_n}"
        self._view.document().addResource(QTextDocument.ImageResource, QUrl(name), img)
        cur = self._cursor_new_block(top=3, left=0)
        fmt = QTextImageFormat()
        fmt.setName(name)
        fmt.setWidth(img.width())
        fmt.setHeight(img.height())
        if title:
            fmt.setToolTip(title)
        cur.insertImage(fmt)

    def _note(self, text: str, color: str = MUTED) -> None:
        stick = self._at_bottom()
        self._line(text, color, 8.0, italic=True)
        self._scroll_end(stick)

    def _intro(self) -> None:
        self._line("New chat with Vitruvius, Atelier's design assistant. It works on this drawing through the "
                   "IngeTrazo bridge; replies, tool steps and screenshots appear here.", MUTED, 8.5, italic=True)

    # ---- status ------------------------------------------------------------------------------------------------
    def _update_status(self) -> None:
        if self._sending:
            phase, color = "Sending", BRONZE
        elif self._pending_send and not self._running:
            phase, color = "Queued", BRONZE
        elif self._running:
            phase, color = self._phase, BRONZE
        else:
            phase, color = "Idle", MUTED
        text = phase
        if self._running and self._turn_t0:
            text += f"  ·  {int(max(0, time.time() - self._turn_t0))} s"
        self._status.setText(("●  " if self._running or self._pending_send else "○  ") + text)
        self._status.setStyleSheet(f"color: {color};")
        self._stop.setEnabled(bool(self._sid) and (self._running or self._pending_send))
        self._send.setEnabled(not self._sending)

    # ---- worker plumbing ---------------------------------------------------------------------------------------
    def _run(self, tag: str, fn, *args, **extra) -> None:
        gen = self._gen

        def work() -> None:
            try:
                res, err = fn(*args), None
            except AtelierError as exc:
                res, err = None, exc
            except Exception as exc:  # never let a worker exception reach Qt
                log.exception("atelier panel worker (%s)", tag)
                res, err = None, AtelierError("rpc", f"{type(exc).__name__}: {exc}")
            self._hub.done.emit({"tag": tag, "gen": gen, "res": res, "err": err, **extra})

        threading.Thread(target=work, name=f"atelier-{tag}", daemon=True).start()

    def _on_done(self, msg: dict) -> None:
        try:
            handler = getattr(self, "_done_" + msg["tag"])
            handler(msg)
        except Exception:
            log.exception("atelier panel: result handler failed")

    def _show_banner(self, err: AtelierError) -> None:
        self._banner_text.setText(str(err))
        self._banner.show()
        self._paused = True
        if not self._retry_timer.isActive():
            self._retry_timer.start()

    def _hide_banner(self) -> None:
        self._banner.hide()
        self._paused = False
        self._retry_timer.stop()

    def _on_retry(self) -> None:
        self._client._cookie = None
        self._hide_banner()
        self._schedule(0)

    def _quiet_retry(self) -> None:
        if self._paused and not self._poll_busy and self._sid:
            self._poll(quiet=True)

    # ---- polling -----------------------------------------------------------------------------------------------
    def _schedule(self, ms: int | None = None) -> None:
        if not self._sid:
            return
        if ms is None:
            ms = POLL_ACTIVE_MS if (self._running or self._pending_send) else POLL_IDLE_MS
        self._poll_timer.start(ms)

    def _poll(self, quiet: bool = False) -> None:
        if not self._sid or self._poll_busy or (self._paused and not quiet):
            return
        self._poll_busy = True
        self._run("poll", self._client.events_since, self._sid, self._last_seq, not self._loaded,
                  sid=self._sid, first=not self._loaded)

    def _done_poll(self, msg: dict) -> None:
        self._poll_busy = False
        if msg["gen"] != self._gen or msg["sid"] != self._sid:
            self._schedule()
            return
        err = msg["err"]
        if err is not None:
            if err.kind == "rpc" and err.code == "session-not-found":
                self._note("That chat is no longer available in Atelier — starting fresh.")
                self._forget_session()
                return
            if err.kind in ("down", "auth"):
                self._show_banner(err)
            else:
                self._note(f"Couldn't read the chat: {err}", ERR)
            self._schedule(POLL_IDLE_MS)
            return
        if self._paused:
            self._hide_banner()
        cursor, events, truncated = msg["res"]
        if msg["first"]:
            self._view.clear()
            self._img_n = 0
            if truncated:
                self._line("Earlier messages are in Atelier.", MUTED, 8.0, italic=True)
            self._loaded = True
        if events:
            images = self._collect_images(events)
            if images:
                # Fetch screenshots off the UI thread, then render the batch in order.
                self._poll_busy = True
                self._run("images", self._fetch_images, self._sid, images, sid=self._sid, cursor=cursor,
                          events=events)
                return
            self._render(events, {})
        self._last_seq = max(self._last_seq, cursor)
        self._update_status()
        self._schedule()

    def _collect_images(self, events: list) -> list:
        ids = []
        for ev in events:
            if ev.get("type") == "tool/result":
                for att in _images_in(ev.get("data"), []):
                    if att.get("attachmentId"):
                        ids.append(att["attachmentId"])
        return ids

    def _fetch_images(self, sid: str, ids: list) -> dict:
        out = {}
        for aid in ids[-6:]:  # a long history shows its latest screenshots
            try:
                out[aid] = self._client.attachment(sid, aid)
            except AtelierError as exc:
                if exc.kind != "rpc":
                    raise
        return out

    def _done_images(self, msg: dict) -> None:
        self._poll_busy = False
        if msg["gen"] != self._gen or msg["sid"] != self._sid:
            self._schedule()
            return
        self._render(msg["events"], msg["res"] or {})
        self._last_seq = max(self._last_seq, msg["cursor"])
        self._update_status()
        self._schedule()

    # ---- rendering ---------------------------------------------------------------------------------------------
    def _render(self, events: list, images: dict) -> None:
        stick = self._at_bottom()
        for ev in events:
            t = ev.get("type")
            d = ev.get("data") or {}
            if t == "turn/start":
                self._running = True
                self._pending_send = False
                self._turn_t0 = (ev.get("time") or time.time() * 1000) / 1000.0
                self._phase = "Thinking"
            elif t == "turn/end":
                reason = (d.get("reason") or {})
                kind = reason.get("kind")
                end_t = (ev.get("time") or time.time() * 1000) / 1000.0
                dur = f" · {int(max(0, end_t - self._turn_t0))} s" if self._turn_t0 else ""
                if kind == "aborted":
                    self._line("■ Stopped" + dur, MUTED, 8.0, italic=True)
                elif kind == "error":
                    m = str((reason.get("error") or {}).get("message") or "the turn failed")
                    self._line("✕ " + m.splitlines()[0][:240], ERR, 8.0)
                elif kind == "max-tokens":
                    self._line("▸ Reply hit its length limit" + dur, MUTED, 8.0, italic=True)
                elif kind in ("blocked", "interrupted"):
                    self._line(f"▸ Turn {kind}" + dur, MUTED, 8.0, italic=True)
                else:
                    self._line("✓ Done" + dur, OK, 8.0)
                self._running = False
                self._open_calls.clear()
                self._phase = "Idle"
            elif t == "step/start":
                self._phase = "Thinking"
            elif t == "user/message":
                src = d.get("source") or {}
                if src.get("kind") != "user":
                    continue
                if src.get("rpcId") in self._local_ids:
                    continue  # already echoed when sent
                self._render_user(d.get("content") or [])
            elif t == "assistant/message":
                msg = d.get("message") or {}
                texts = [c.get("text", "") for c in msg.get("content") or [] if c.get("type") == "text"]
                text = "\n\n".join(x for x in texts if x and x.strip())
                if text.strip():
                    self._label("Vitruvius", BRONZE)
                    self._markdown(text.strip())
            elif t == "tool/call":
                name = d.get("name") or "tool"
                label = _tool_label(name)
                self._open_calls[str(d.get("callId"))] = label
                self._phase = label
                self._line(f"▸ {label}…  {_short_tool(name)}", MUTED, 8.0, left=6)
            elif t == "tool/result":
                msg = d.get("message") or {}
                for part in msg.get("content") or []:
                    if part.get("type") != "tool-result":
                        continue
                    self._open_calls.pop(str(part.get("toolCallId")), None)
                    if part.get("isError"):
                        first = ""
                        for c in part.get("content") or []:
                            if c.get("type") == "text" and c.get("text"):
                                first = _error_line(c["text"])
                                break
                        self._line("  ✕ " + (first or "the tool reported an error"), ERR, 7.5, left=6)
                for att in _images_in(d, []):
                    data = images.get(att.get("attachmentId"))
                    if data:
                        self._image(data, "Screenshot from the tool")
                self._phase = next(iter(self._open_calls.values()), "Thinking")
        self._scroll_end(stick)

    def _render_user(self, content: list, extra: str = "") -> None:
        self._label("You", MUTED)
        texts = []
        for c in content:
            if c.get("type") == "text":
                texts.append(c.get("text", ""))
            elif c.get("type") == "image":
                texts.append(f"[photo: {c.get('name') or 'image'}]")
        body = "\n".join(t for t in texts if t)
        self._line(body.strip() or "(empty)", INK, 9.0)
        if extra:
            self._line(extra, MUTED, 7.5, italic=True)

    # ---- actions -----------------------------------------------------------------------------------------------
    def _on_send(self) -> None:
        text = self._input.toPlainText().strip()
        if not text and not self._photo:
            return
        if self._sending:
            return
        sel_line = ""
        if self._use_sel.isChecked():
            try:
                sel_line = describe_selection(self._app.scene)
            except Exception:
                sel_line = ""
        full = text + (("\n\n" + sel_line) if sel_line else "")
        content = []
        if full:
            content.append({"type": "text", "text": full})
        photo_name = ""
        if self._photo:
            b64, mt, name = self._photo
            content.append({"type": "image", "mediaType": mt, "data": b64, "name": name})
            photo_name = name
        request_id = f"inge-{uuid.uuid4()}"
        self._local_ids.add(request_id)
        stick = True
        shown = list(content)
        if photo_name:
            shown = [c if c.get("type") != "image" else {"type": "image", "name": photo_name} for c in content]
        if sel_line:
            shown = [{"type": "text", "text": text}] + [c for c in shown if c.get("type") == "image"]
        self._render_user(shown, sel_line)
        self._scroll_end(stick)
        self._input.clear()
        self._clear_photo()
        self._pending_send = True
        self._sending = True
        self._update_status()
        self._run("send", self._send_work, self._sid, self._ws, request_id, content, typed=text)

    def _send_work(self, sid, ws, request_id, content):
        if not sid:
            ws = ws or self._client.ensure_workspace()
            sid = self._client.create_session(ws)
        self._client.prompt(sid, request_id, content)
        return sid, ws

    def _done_send(self, msg: dict) -> None:
        err = msg["err"]
        if msg["gen"] != self._gen:
            return
        self._sending = False
        if err is not None:
            self._pending_send = False
            if not self._input.toPlainText().strip():
                self._input.setPlainText(msg.get("typed") or "")
            if err.kind in ("down", "auth"):
                self._show_banner(err)
                self._note("Not sent — Atelier isn't available. Your message is back in the box.", ERR)
            else:
                self._note(f"Not sent: {err}. Your message is back in the box.", ERR)
            self._update_status()
            return
        sid, ws = msg["res"]
        st = panel_settings()
        if ws and ws != self._ws:
            self._ws = ws
            st.setValue("atelier/workspace_id", ws)
        if sid != self._sid:
            self._sid = sid
            self._loaded = True       # a brand-new chat: everything is new
            self._last_seq = -1
            st.setValue("atelier/session_id", sid)
        if self._paused:
            self._hide_banner()
        self._update_status()
        self._schedule(400)

    def _on_stop(self) -> None:
        if not self._sid:
            return
        self._stop.setEnabled(False)
        self._run("stop", self._client.cancel, self._sid)

    def _done_stop(self, msg: dict) -> None:
        err = msg["err"]
        if err is not None:
            if err.kind in ("down", "auth"):
                self._show_banner(err)
            else:
                self._note(f"Couldn't stop: {err}", ERR)
        self._pending_send = False
        self._update_status()
        self._schedule(300)

    def _forget_session(self) -> None:
        self._gen += 1
        self._sid = None
        self._last_seq = -1
        self._loaded = False
        self._running = False
        self._pending_send = False
        self._sending = False
        self._turn_t0 = None
        self._open_calls.clear()
        self._local_ids.clear()
        self._poll_busy = False
        self._poll_timer.stop()
        panel_settings().remove("atelier/session_id")
        self._update_status()

    def _on_new_chat(self) -> None:
        self._forget_session()
        self._hide_banner()
        self._view.clear()
        self._img_n = 0
        self._intro()
        self.focus_input()

    def _on_photo(self) -> None:
        path, _ = QFileDialog.getOpenFileName(self, "Attach a photo", "",
                                              "Images (*.png *.jpg *.jpeg *.webp *.gif *.bmp)")
        if not path:
            return
        img = QImage(path)
        if img.isNull():
            self._note("That file isn't an image the panel can read.", ERR)
            return
        if max(img.width(), img.height()) > 1600:
            img = img.scaled(1600, 1600, Qt.KeepAspectRatio, Qt.SmoothTransformation)
        buf = QBuffer()
        buf.open(QIODevice.WriteOnly)
        img.save(buf, "JPEG", 88)
        b64 = base64.b64encode(bytes(buf.data())).decode("ascii")
        self._photo = (b64, "image/jpeg", os.path.basename(path))
        self._chip.setText("Photo: " + os.path.basename(path))
        self._chip.show()
        self._chip_x.show()

    def _clear_photo(self) -> None:
        self._photo = None
        self._chip.setText("")
        self._chip.hide()
        self._chip_x.hide()

    # ---- test hook -----------------------------------------------------------------------------------------------
    def send_text(self, text: str) -> None:
        """Type ``text`` into the composer and send it, exactly like pressing Enter."""
        self._input.setPlainText(text)
        self._on_send()


def setup(app) -> None:
    if os.environ.get("INGETRAZO_AT_ATELIER_PANEL", "1") == "0":
        return
    try:
        panel = AtelierPanel(app)
        dock = app.add_panel("Atelier", panel, name="atelier-public")
        app.window._atelier_public_panel = panel

        def summon() -> None:
            app.show_panel(dock)
            panel.focus_input()

        app.add_menu_action("Atelier (Vitruvius)", summon, "",
                            "Open the Atelier panel: chat with Vitruvius, who models in this drawing.")
    except Exception:
        log.exception("atelier panel: setup failed (IngeTrazo continues without it)")
