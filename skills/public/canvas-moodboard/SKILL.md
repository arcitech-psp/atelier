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

HONESTY: the canvas is schematic design help. Give dimensions as the user stated them or as assumptions you name; do not present a sketch as a checked plan.
