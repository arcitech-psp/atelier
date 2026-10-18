---
name: canvas-moodboard
description: Draw schematic plans and design diagrams on the editable canvas, and build colour and material moodboards, with optional generated images.
whenToUse: The user asks for a plan, a diagram, a layout sketch, a moodboard, a palette, or material and lighting ideas they can see.
metadata:
  atelier:
    version: 1
    mode: schema
    tools:
      - board_draw
      - moodboard_create
      - image_generate
    keywords: \b(canvas|board|plan|layout|diagram|sketch|moodboard|mood board|palette|swatch(es)?|materials?|textures?|lighting)\b
    trust: owner
---
CANVAS: board_draw puts an editable diagram on the canvas. For a plan, set `units: "m"` and give each room or zone a name and x, y, width and height in metres (origin at the south-west corner, x east, y north); Atelier scales it to the view with a scale bar and north arrow, so do not convert to pixels; for a process or comparison, give named steps and let the grid place them. Keep card text short; put the explanation in your reply. One board_draw per request; redraw rather than patch.

MOODBOARD: moodboard_create places colour swatches (name plus hex) and descriptive cards for materials, textures and lighting. It works without an image endpoint; say so when no images were generated. When an image endpoint is configured, image_generate makes one concept image per call from a short, concrete prompt (subject, material, light, view); label it as a concept image, never as a render of the real design.

PLANS OF NEW BUILDINGS: a new building is a NEW design, never a copy of an earlier project or a simple box. A multi-storey building gets a plan for every floor. Room sizes follow Neufert and Ching: a laundry, storage room, WC or corridor is never larger than the smallest bedroom; bedrooms at least 9 m2 (primary bedroom 12 m2, short side 2.7 m), living room at least 16 m2, kitchen at least 7 m2, bathroom at least 3.5 m2. Check every room area before board_draw.

PRESENTATION BOARDS: a presentation board is ONE tall vertical portrait panel, never landscape and never a multi-page series. It shows only finished renders of the actual model, with the building as the subject in its real context. Never put concept images, images from image_generate or viewport screenshots on a presentation board; they do not match the design and mislead people. If no finished render exists yet, do not make the board; say that renders are needed. The site plan panel explains itself: labelled streets and neighbours, the building highlighted, north arrow, scale bar and legend. A moodboard is not a presentation board.

STOP MEANS STOP: when the person stops the chat, stop drawing and generating at once and start nothing again until the person writes.

HONESTY: the canvas is schematic design help. Give dimensions as the user stated them or as assumptions you name; do not present a sketch as a checked plan.
