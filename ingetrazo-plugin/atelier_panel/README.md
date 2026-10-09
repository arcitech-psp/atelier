# Optional Atelier panel for IngeTrazo

This native PySide6 panel is a separate optional download, licensed GPL-3.0-or-later. It is a public derivative of ArciTech's Atelier panel and imports the independently installed IngeTrazo/PySide6 runtime. The full licence is in LICENSE. IngeTrazo itself and its official MCP executable are never included here. Atelier core has separate licence terms; this panel's GPL grant remains valid regardless of the core placeholder.

Copy at_atelier_panel.py into your own IngeTrazo user plugins folder and load it using IngeTrazo's normal extension mechanism. Existing installs may need their normal next start to discover a plugin. The Atelier (Vitruvius) panel has a Settings button. Configure Host, Port, Workspace and Atelier home. Defaults are the local IPv4 loopback host, port 3081 (the Atelier preview default), and an Atelier folder under your Documents. Atelier home is your Atelier home folder (by default the user-home folder inside Atelier, or ATELIER_HOME), where Atelier keeps .browser-launch-token. The panel reads the token locally and never logs the token or login cookie. If you start Atelier on another port (ATELIER_PORT), change the panel Port to match.

New chats use Vitruvius and Atelier's configured default model. There is no fixed model or remote endpoint. Enable IngeTrazo's official local AI bridge before opening a modelling chat. If the bridge is off, Vitruvius still provides design help and canvas plans and explains that live modelling is unavailable. The public connector uses only the separately installed official MCP server. No additional modelling helpers, datasets or generators are included.

Use the current intended drawing; create a new drawing for experiments. Ask: "Make a 4 by 5 m studio room with a desk and a bookshelf, then show me the plan." Concept geometry needs dimensions and clearance checks before further design decisions.

Attribution: Atelier panel by ArciTech, public derivative prepared in 2026. IngeTrazo by Marco Sumari Tellez and contributors; PySide6 by The Qt Company and contributors. Their own runtime terms apply independently. No IngeTrazo or Qt runtime is redistributed in this download.
