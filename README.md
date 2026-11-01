#CustomShapeJigsawJs

This is a (pretty broken, but mostly functional) jigsaw generator with custom border support.
It relies on two linbraries from third parties, imagetracerjs and flatten (see respective files) and it also leverages the tab generator from the jigsaw generator by draradech (https://draradech.github.io/jigsaw/index.html)
Use online at https://proceduraljigsaw.github.io/CustomShapeJigsawJs/ and read the help there for more information

## Fork: Puslespillgenerator

A Norwegian UI on top of the original engine, for laser-cut wooden puzzles:

- Rectangle (with size presets) or your own SVG outline, sized in mm.
- Piece size, style (classic / organic / wild) and knob size; live preview on a plywood-coloured board.
- Classic knobs (narrow neck, round head) sized from the piece size; short edges stay straight.
- Shaped (whimsy) pieces: butterfly, fish, star, heart or your own SVG. Drag them in the preview; a lock check warns about shapes that would fall out.
- Optional photo shown under the puzzle in the preview only.
- Download: SVG in millimetres with 0.1 mm lines.
- Quality checks (`quality.js`): pieces that are too small or too thin are merged into a neighbour; every knob keeps 1 mm clearance from other lines (colliding knobs are flipped, moved, shrunk or straightened); edges that would cut through a shaped piece are trimmed where they meet its outline; any remaining crossing is marked in the preview.

Files: `engine.js` is the original generator (lightly patched), `app.js` is the new UI and knob shape, `quality.js` the cutting checks, `index.html` the page.
