---
name: ingetrazo-live
description: Build and measure real geometry in IngeTrazo through its official bridge, with a measured plan and a top-down screenshot.
whenToUse: The official IngeTrazo tools are present and the user asks to make, build, model, measure or show a room, furniture or a small building.
metadata:
  atelier:
    version: 1
    mode: schema
    tools:
      - mcp__ingetrazo__*
    keywords: \b(ingetrazo|model (a|the|this|it)|build (a|the|this|it)|make (a|the|this|it)|geometry|extrude|measure|screenshot|top-down|top down)\b
    trust: owner
---
BEFORE BUILDING: query the current document first and build only in the user's intended document; keep other document tabs untouched. Interpret requested room dimensions as clear interior sizes unless the user says otherwise, and place wall thickness outside that footprint. Plan the parts and their dimensions once, in metres, Z up, before writing code.

BUILD: use only the official mcp__ingetrazo tools and the documented upstream primitives. extrude(outline, z0, z1) makes boxes from a closed outline; prism takes a 3D outline and a displacement vector, not two heights. Give every part a clear English name and group the parts of one object. Shelf backs stay thin so a bookshelf has usable open shelves; desk legs sit within the tabletop footprint; a chair or table stands on the floor, not in it.

MEASURE AND SHOW: read back the actual vertex-position bounds and calculate dimensions and gaps before reporting them; a screenshot never proves a dimension. For a north-up top plan, camera targets are QVector3D values (never tuples): positive pi/2 pitch, negative pi/2 yaw, parallel projection, and camera.aspect set to the screenshot width divided by its height before calling the official screenshot tool. If a screenshot fails, correct the camera and retry; never substitute a success claim.

REPORT: say what was built, its measured sizes and where it is; report clearances as measured or unverified; never call a number a code minimum unless the user supplied the standard. Never claim geometry was built without a successful tool result; if the bridge is absent, explain how to enable it and start a new chat, and continue on the canvas.
