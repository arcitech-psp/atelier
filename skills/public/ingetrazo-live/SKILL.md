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

HELPERS (in scope for run_python; metres, Z up, angles in radians; each helper creates and adds one named group):
- extrude([(x,y), ...], z0, z1, name="Post", color=(r,g,b,1.0)) - a plan outline lifted from z0 to z1. A box (post, beam, tread, slab) is a four-point extrude; never build it face by face.
- revolve([(radius,z), ...], name="Column", color=..., segments=32, closed=False) - a profile turned around the Z axis, bottom to top; use it for round columns, posts and rails.
- prism([(x,y,z), ...], (dx,dy,dz), holes=[[...]], name=..., color=...) - a flat polygon swept along a vector (slabs, sloped or tilted parts).
- wall((x,y), (x,y), height=3, thickness=0.2, openings=[(offset, sill, width, height)]) - grows to the LEFT of a->b; sill 0 = door, sill > 0 = window.
- house(width=6, depth=4, wall_height=3, roof="gable"|"hip"|"flat", origin=(0,0), name="House") - a whole simple house.
- Colour or glass for a whole group: g.material = {"color": (r,g,b), "opacity": 0.35}. Do not touch scene.materials.
- Move a group: for v in list(g.mesh.vertices): g.mesh.move_vertex(v, QVector3D(dx,dy,dz)).
- Bounds: read [v.position for v in g.mesh.vertices] and print min/max x, y, z; QVector3D uses .x() .y() .z().
- Camera: viewport.camera.target = QVector3D(...); .distance, .yaw, .pitch; then viewport.update().
Each call is ONE undo step: an exception rolls it back completely. Variables persist between calls; do not redefine them. Do not explore the API with dir() or inspect; write the code and read the error. Build a simple object completely in one call; build big ones in a few steps. The person figure called "Engineer" is the 1.70 m scale figure: leave it alone and do not count it as the model.
