#CustomShapeJigsawJs

This is a (pretty broken, but mostly functional) jigsaw generator with custom border support.
It relies on two linbraries from third parties, imagetracerjs and flatten (see respective files) and it also leverages the tab generator from the jigsaw generator by draradech (https://draradech.github.io/jigsaw/index.html)
Use online at https://proceduraljigsaw.github.io/CustomShapeJigsawJs/ and read the help there for more information

## Fork: shaped (whimsy) pieces

This fork adds shaped pieces (butterfly, fish, star, heart or your own SVG outline) that the
Voronoi pieces grow around. Each shape is added to the border as a hole, so its outline is cut
exactly and the inside becomes one piece. Works with both rectangular and custom borders.

- Add a shape, set X/Y (centre, mm from top-left), width and rotation, or click in the preview after generating.
- "Locks well / weakly / will fall out" compares the shape's area to its convex hull: shapes need notches to stay in the puzzle.
- Own SVGs: the largest closed outline in the file is used; inner details are ignored.
