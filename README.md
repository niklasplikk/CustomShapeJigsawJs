#CustomShapeJigsawJs

This is a (pretty broken, but mostly functional) jigsaw generator with custom border support.
It relies on two linbraries from third parties, imagetracerjs and flatten (see respective files) and it also leverages the tab generator from the jigsaw generator by draradech (https://draradech.github.io/jigsaw/index.html)
Use online at https://proceduraljigsaw.github.io/CustomShapeJigsawJs/ and read the help there for more information

## Fork: Jigsaw Workshop

A new UI on top of the original engine, for laser-cut wooden puzzles, built around the puzzle's photo:

- **Photo first.** If the photo has a plain (white or single-colour) background, the motif's outline becomes the puzzle's shape. Otherwise choose a rectangle or load an SVG outline. The photo is shown under the puzzle in the preview only.
- **Figure pieces from the photo.** Click the parts of a figure (magic wand), or draw its outline by hand. The figure becomes its own piece, clipped to stay inside the puzzle, and follows the photo when the puzzle is resized. A figure can be split into several pieces that interlock with knobs; the split uses straight cuts, each the shortest that gives pieces of about equal size, so cuts fall across narrow places.
- **Knobs where pieces need them.** Straight lines long enough for a sturdy knob (radius ≥ 2.5 mm) get one, pieces without any knob get a smaller one, and (if switched on; off by default) a figure's outline gets a knob where a piece shares a long, fairly straight stretch of it. Figure outlines are otherwise left smooth unless you add knobs to them. "Edit knobs" adds, flips or removes the knob on any line or outline by clicking it.
- **Piece sizes.** Small pieces are merged into a neighbour without building oversized ones; pieces much bigger (over 1.8× the normal area) or longer (over 2.3× the piece size) than the rest are split with a straight cut. "Split a piece" cuts any piece in two where you click (Undo takes the last split back).
- **Zoom.** Scroll or pinch on the preview to zoom around the pointer; drag to pan when zoomed (middle button or Space + drag while a tool is active).
- **Knobs on figures.** Click on a figure's outline to give it a knob into the neighbouring piece (or out of it), so narrow parts like a neck lock in place. Knobs are stored as a position along the outline, so they stay put when the figure is moved, resized or a new variant is made.
- **Edge.** Grow or shrink a figure's outline by −3 to +6 mm. Figures picked from the picture take their size and position from it (no size or rotation sliders); figures loaded from an SVG file keep size and rotation.
- **Smoothing.** Each figure has a smoothing setting (off, light, medium, strong; measured in mm), and so does the outline traced from the photo, to take the shake out of hand-drawn and traced lines before cutting.
- Piece size, style (classic / organic / wild) and knob size; classic knobs (narrow neck, round head) sized from the piece size.
- Quality checks (`quality.js`): too small or too thin pieces are merged; knobs keep 1 mm clearance from other lines (flipped, moved, shrunk or straightened otherwise); cuts that would run through a figure are trimmed, and cuts that stop short of an outline are extended; any remaining crossing is marked in the preview.
- **Projects.** "Save project" downloads a .jigsaw file (JSON with the picture embedded and every setting and edit); "Open project" loads one. The cut lines aren't stored: the generator is seeded, so it recreates them exactly. Work is also autosaved in the browser (IndexedDB), and the app offers to continue it when opened again.
- Download as SVG, PDF (vector, keeps curves; for Bambu Suite and print-driver lasers) or DXF (R12 polylines on layer CUT, curves flattened to 0.02 mm; for xTool, RDWorks and CAD). All in millimetres, every line cut once.

Files: `engine.js` is the original generator (lightly patched, with hooks), `app.js` the UI and knob shape, `image.js` photo processing, `quality.js` the cutting checks, `plugs.js` the knobs on figures, `edgeknobs.js` knobs on the lines between pieces, `export.js` PDF and DXF export, `project.js` saving and opening projects, `index.html` the page.

## Magic Puzzle (beta) — `magic/`

A puzzle with a twist, like the shift-and-reveal puzzles from the Magic Puzzle Company. The finished puzzle has a road running across it, slanted (or zigzag, or straight), so the sections have stepped, slanted edges: A above the road, B below it, and a crossroads made of slanted strips (C, D…). To open it:

1. Slide section B (everything below the road) down two rows.
2. Lift the strips off the crossroads and lay them into the slanted gap that opened along the road.
3. A slanted hole has appeared in the middle where the crossroads was; the secret pieces fill it. The opened puzzle is two rows taller.

- Seams follow lattice lines and use the same non-locking tooth everywhere, so sections slide apart and lock into either arrangement.
- The road is painted onto every seam that changes partners (a seamless tile), so the picture lines up both ways. Road style: plain path (any picture), the picture's own texture, or painted into the scene with AI. Road position and crossroads column are chosen from the calmest part of the picture, or by hand.
- Secret picture: painted by AI into the opened puzzle with the hole empty (own OpenAI key, kept in the browser; falls back to DALL·E without a verified organisation), via a template + prompt for ChatGPT, or uploaded.
- Downloads: cut file (SVG/PDF/DXF) with the finished puzzle and the secret pieces beside it, a matching picture for printing, and a four-panel instruction sheet.

The classic workshop as it was before this is kept on the `v1-classic` branch.
