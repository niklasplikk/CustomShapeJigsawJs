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

Files: `engine.js` is the original generator (lightly patched), `app.js` is the new UI and knob shape, `index.html` is the page.
