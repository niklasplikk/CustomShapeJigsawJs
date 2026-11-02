#CustomShapeJigsawJs

This is a (pretty broken, but mostly functional) jigsaw generator with custom border support.
It relies on two linbraries from third parties, imagetracerjs and flatten (see respective files) and it also leverages the tab generator from the jigsaw generator by draradech (https://draradech.github.io/jigsaw/index.html)
Use online at https://proceduraljigsaw.github.io/CustomShapeJigsawJs/ and read the help there for more information

## Fork: Jigsaw Workshop

A new UI on top of the original engine, for laser-cut wooden puzzles, built around the puzzle's photo:

- **Photo first.** If the photo has a plain (white or single-colour) background, the motif's outline becomes the puzzle's shape. Otherwise choose a rectangle or load an SVG outline. The photo is shown under the puzzle in the preview only.
- **Figure pieces from the photo.** Click the parts of a figure (magic wand), or draw its outline by hand. The figure becomes its own piece, clipped to stay inside the puzzle, and follows the photo when the puzzle is resized. A figure can be split into several pieces that interlock with knobs; the split uses straight cuts, each the shortest that gives pieces of about equal size, so cuts fall across narrow places.
- **Knobs where pieces need them.** Straight lines long enough for a sturdy knob (radius ≥ 2.5 mm) get one, pieces without any knob get a smaller one, and (if switched on; off by default) a figure's outline gets a knob where a piece shares a long, fairly straight stretch of it. Figure outlines are otherwise left smooth unless you add knobs to them. "Edit knobs" adds, flips or removes the knob on any line or outline by clicking it.
- **Zoom.** Scroll or pinch on the preview to zoom around the pointer; drag to pan when zoomed (middle button or Space + drag while a tool is active).
- **Knobs on figures.** Click on a figure's outline to give it a knob into the neighbouring piece (or out of it), so narrow parts like a neck lock in place. Knobs are stored as a position along the outline, so they stay put when the figure is moved, resized or a new variant is made.
- **Edge.** Grow or shrink a figure's outline by −3 to +6 mm. Figures picked from the picture take their size and position from it (no size or rotation sliders); figures loaded from an SVG file keep size and rotation.
- **Smoothing.** Each figure has a smoothing setting (off, light, medium, strong; measured in mm), and so does the outline traced from the photo, to take the shake out of hand-drawn and traced lines before cutting.
- Piece size, style (classic / organic / wild) and knob size; classic knobs (narrow neck, round head) sized from the piece size.
- Quality checks (`quality.js`): too small or too thin pieces are merged; knobs keep 1 mm clearance from other lines (flipped, moved, shrunk or straightened otherwise); cuts that would run through a figure are trimmed, and cuts that stop short of an outline are extended; any remaining crossing is marked in the preview.
- Download as SVG, PDF (vector, keeps curves; for Bambu Suite and print-driver lasers) or DXF (R12 polylines on layer CUT, curves flattened to 0.02 mm; for xTool, RDWorks and CAD). All in millimetres, every line cut once.

Files: `engine.js` is the original generator (lightly patched, with hooks), `app.js` the UI and knob shape, `image.js` photo processing, `quality.js` the cutting checks, `plugs.js` the knobs on figures, `edgeknobs.js` knobs on the lines between pieces, `export.js` PDF and DXF export, `index.html` the page.
