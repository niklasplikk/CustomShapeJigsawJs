#CustomShapeJigsawJs

This is a (pretty broken, but mostly functional) jigsaw generator with custom border support.
It relies on two linbraries from third parties, imagetracerjs and flatten (see respective files) and it also leverages the tab generator from the jigsaw generator by draradech (https://draradech.github.io/jigsaw/index.html)
Use online at https://proceduraljigsaw.github.io/CustomShapeJigsawJs/ and read the help there for more information

## Fork: Puslespillgenerator

A Norwegian UI on top of the original engine, for laser-cut wooden puzzles, built around the puzzle's photo:

- **Photo first.** If the photo has a plain (white or single-colour) background, the motif's outline becomes the puzzle's shape. Otherwise choose a rectangle or load an SVG outline. The photo is shown under the puzzle in the preview only.
- **Figure pieces from the photo.** Click the parts of a figure (magic wand), or draw its outline by hand. The figure becomes its own piece, clipped to stay inside the puzzle, and follows the photo when the puzzle is resized. A figure can be split into several pieces that interlock with knobs.
- **Knobs on figures.** Click on a figure's outline to give it a knob into the neighbouring piece (or out of it), so narrow parts like a neck lock in place. Knobs are stored as a position along the outline, so they stay put when the figure is moved, resized or a new variant is made.
- Piece size, style (classic / organic / wild) and knob size; classic knobs (narrow neck, round head) sized from the piece size.
- Quality checks (`quality.js`): too small or too thin pieces are merged; knobs keep 1 mm clearance from other lines (flipped, moved, shrunk or straightened otherwise); cuts that would run through a figure are trimmed, and cuts that stop short of an outline are extended; any remaining crossing is marked in the preview.
- Download: SVG in millimetres with 0.1 mm lines.

Files: `engine.js` is the original generator (lightly patched, with hooks), `app.js` the UI and knob shape, `image.js` photo processing, `quality.js` the cutting checks, `plugs.js` the knobs on figures, `index.html` the page.
