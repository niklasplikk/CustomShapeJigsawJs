// Knobs on the lines between ordinary pieces.
//  - Automatic: every piece gets at least one knob. Pieces next to a figure often end up with
//    only short or trimmed edges, which are cut straight, so nothing holds them in. Those get a
//    knob (smaller if needed) on their longest straight edge.
//  - By hand: S.edgeKnobs holds knobs the user placed, flipped or removed. Each is stored as a
//    point on the line (mm) plus which side the head points to, and applied to whatever line runs
//    through that point after the puzzle is made.

S.edgeKnobs = [];        // [{x, y, on, hx, hy, flipped}]
S.autoKnobs = true;          // knobs on short lines between ordinary pieces
S.autoFigureKnobs = false;   // knobs on figure outlines, only when asked for

// smallest knob radius that holds up in 3 mm plywood, and the last-resort size
const MIN_KNOB = 2.5, MIN_KNOB_LAST = 1.8;
function knobFits(L, min) { return Math.min((S.knob / 100) * S.piece, 0.2 * L) >= (min || 1.2); }

function edgeHeadDir(e) {
    const dl = { x: e.v2.x - e.v1.x, y: e.v2.y - e.v1.y }, L = Math.hypot(dl.x, dl.y) || 1;
    const n = { x: -dl.y / L, y: dl.x / L };
    const sg = e.k && e.k.flip ? -1 : 1;
    return { x: n.x * sg, y: n.y * sg };
}

// Gives edge e a knob whose head points along dir (or a random side), or makes it straight.
function setEdgeKnob(e, dir) {
    if (dir === null) {
        e.segs = null; e.k = null;
    } else {
        const want = (S.knob / 100) * S.piece, r = Math.min(want, 0.2 * e.L);
        if (r < 1.2) return false;
        const dl = { x: e.v2.x - e.v1.x, y: e.v2.y - e.v1.y }, n = { x: -dl.y, y: dl.x };
        const flip = dir ? n.x * dir.x + n.y * dir.y < 0 : random() > 0.5;
        e.k = { t: r / e.L, m: 0.5, flip: flip, a: 0, d: 0, e: 0 };
        e.segs = knobGeometry(e.v1, e.v2, e.k);
    }
    const oldD = e.orig || e.d;
    e.d = e.segs ? knobD(e.v1, e.segs) : straightD(e.v1, e.v2);
    e.orig = oldD;
    return [oldD, e.d];
}

function distToEdge(p, e) {
    const pl = edgePolyline(e);
    let best = Infinity;
    for (let k = 1; k < pl.length; k++) {
        best = Math.min(best, distPtSeg(p.x, p.y, { ax: pl[k - 1].x, ay: pl[k - 1].y, bx: pl[k].x, by: pl[k].y }));
    }
    return best;
}

function nearestEdge(p, maxD) {
    let bi = -1, bd = maxD;
    edgeLog.forEach((e, i) => { const d = distToEdge(p, e); if (d < bd) { bd = d; bi = i; } });
    return bi;
}

// piece label on either side of an edge, read from the engine's cell grid
function edgeSides(e) {
    const cell = parseFloat($("cell_scale").value), g = automata.grid;
    const dl = { x: e.v2.x - e.v1.x, y: e.v2.y - e.v1.y }, L = Math.hypot(dl.x, dl.y) || 1;
    const n = { x: -dl.y / L, y: dl.x / L }, off = 0.9 * cell;
    const at = (x, y) => {
        const r = Math.floor(y / cell), c = Math.floor(x / cell);
        return r >= 0 && c >= 0 && r < automata.rows && c < automata.columns ? Math.abs(g[r][c]) : 0;
    };
    const vote = (sg) => {
        const m = new Map();
        [0.3, 0.5, 0.7].forEach((f) => {
            const l = at(e.v1.x + dl.x * f + n.x * off * sg, e.v1.y + dl.y * f + n.y * off * sg);
            if (l) m.set(l, (m.get(l) || 0) + 1);
        });
        let best = 0, bn = 0;
        m.forEach((v, l) => { if (v > bn) { bn = v; best = l; } });
        return best;
    };
    return [vote(1), vote(-1)];
}

// Runs inside checkCuts, after edges are trimmed and before collisions are fixed.
function applyEdgeKnobs(changes) {
    edgeLog.forEach((e) => { e.manual = false; });
    // knobs placed by hand
    S.edgeKnobs.forEach((m) => {
        const i = nearestEdge(m, Math.max(2.5, S.piece * 0.08));
        if (i < 0) return;
        const e = edgeLog[i];
        const ch = setEdgeKnob(e, m.on ? { x: m.hx, y: m.hy } : null);
        if (ch) changes.push(ch);
        e.manual = true;
    });
    if (!S.autoKnobs) return;
    const sides = edgeLog.map(edgeSides);
    let added = 0;

    // straight lines between two pieces (short edges, edges trimmed at a figure) get a knob
    // whenever one of a size that holds up fits
    edgeLog.forEach((e, i) => {
        if (e.segs || e.manual || !sides[i][0] || !sides[i][1] || sides[i][0] === sides[i][1]) return;
        if (!knobFits(e.L, MIN_KNOB)) return;
        const ch = setEdgeKnob(e, undefined);
        if (ch) { changes.push(ch); e.autoKnob = true; added++; }
    });

    // and every piece gets at least one knob, if need be a smaller one
    const knobs = new Map();
    const add = (l) => { if (l) knobs.set(l, (knobs.get(l) || 0) + 1); };
    edgeLog.forEach((e, i) => { if (e.segs) { add(sides[i][0]); add(sides[i][1]); } });
    // knobs on figure outlines count for the pieces next to them
    const cell = parseFloat($("cell_scale").value);
    (window.lastShapes || []).forEach((s) => (s.knobs || []).forEach((kb) => {
        const dl = { x: kb.v2.x - kb.v1.x, y: kb.v2.y - kb.v1.y }, L = Math.hypot(dl.x, dl.y) || 1;
        [1, -1].forEach((sg) => {
            const x = kb.c.x - (dl.y / L) * 1.5 * cell * sg, y = kb.c.y + (dl.x / L) * 1.5 * cell * sg;
            const r = Math.floor(y / cell), c = Math.floor(x / cell);
            if (r >= 0 && c >= 0 && r < automata.rows && c < automata.columns) add(Math.abs(automata.grid[r][c]));
        });
    }));
    const labels = new Set();
    sides.forEach(([a, b]) => { if (a) labels.add(a); if (b) labels.add(b); });
    labels.forEach((l) => {
        if (knobs.get(l)) return;
        let best = -1, bl = 0;
        edgeLog.forEach((e, i) => {
            if (e.segs || e.manual || (sides[i][0] !== l && sides[i][1] !== l)) return;
            if (!sides[i][0] || !sides[i][1]) return;
            if (e.L > bl && knobFits(e.L, MIN_KNOB_LAST)) { bl = e.L; best = i; }
        });
        if (best < 0) return;
        const ch = setEdgeKnob(edgeLog[best], undefined);
        if (!ch) return;
        changes.push(ch);
        edgeLog[best].autoKnob = true;
        add(sides[best][0]); add(sides[best][1]);
        added++;
    });
    cutReport.autoKnobs = added;
}

// ------------------------------------------------------------------ knob tool
// One tool for all lines: a click on a figure's outline goes to that figure's knobs (plugs.js),
// a click on any other line adds, flips or removes the knob on that line.
function knobToolClick(pt) {
    const tol = Math.max(3, S.piece * 0.15);
    // nearest figure outline
    let fig = -1, fd = tol;
    (window.lastShapes || []).forEach((s) => {
        if (!s.whimsy) return;
        const p = tmpPath(s.dBase || s.d), T = p.getTotalLength();
        for (let u = 0; u < T; u += 0.6) {
            const q = p.getPointAtLength(u), d = Math.hypot(q.x - pt.x, q.y - pt.y);
            if (d < fd) { fd = d; fig = s.wi; }
        }
        p.remove();
    });
    const ei = nearestEdge(pt, tol);
    const ed = ei >= 0 ? distToEdge(pt, edgeLog[ei]) : Infinity;
    if (fig >= 0 && fd <= ed) {
        PICK.figure = fig;
        plugClick(pt);
        return;
    }
    if (ei < 0) { $("pickMsg").textContent = "Click right on a line between two pieces, or on a figure's outline."; return; }
    const e = edgeLog[ei];
    // the knob is remembered at the point on the line closest to the click
    const pl = edgePolyline(e);
    let on = pt, bd = Infinity;
    for (let k = 1; k < pl.length; k++) {
        const a = pl[k - 1], b = pl[k], vx = b.x - a.x, vy = b.y - a.y, L2 = vx * vx + vy * vy || 1e-12;
        const t = Math.max(0, Math.min(1, ((pt.x - a.x) * vx + (pt.y - a.y) * vy) / L2));
        const c = { x: a.x + t * vx, y: a.y + t * vy }, d = Math.hypot(c.x - pt.x, c.y - pt.y);
        if (d < bd) { bd = d; on = c; }
    }
    const mid = { x: (e.v1.x + e.v2.x) / 2, y: (e.v1.y + e.v2.y) / 2 };
    let m = S.edgeKnobs.find((k) => nearestEdge(k, Math.max(2.5, S.piece * 0.08)) === ei);
    if (!m) { m = { x: mid.x, y: mid.y }; S.edgeKnobs.push(m); }
    m.x = mid.x; m.y = mid.y;
    if (!e.segs) {
        if (!knobFits(e.L)) { $("pickMsg").textContent = "That line is too short for a knob."; S.edgeKnobs.splice(S.edgeKnobs.indexOf(m), 1); return; }
        const dl = { x: e.v2.x - e.v1.x, y: e.v2.y - e.v1.y };
        m.on = true; m.hx = -dl.y; m.hy = dl.x; m.flipped = false;          // add
    } else if (!m.flipped) {
        const h = edgeHeadDir(e);
        m.on = true; m.hx = -h.x; m.hy = -h.y; m.flipped = true;            // flip
    } else {
        m.on = false; m.flipped = false;                                     // remove
    }
    knobToolMessage();
    regen(0);
}

function knobToolMessage() {
    const n = S.edgeKnobs.filter((k) => k.on).length + whimsies.reduce((s, w) => s + (w.plugs || []).length, 0);
    $("pickMsg").textContent = "Click any line, or a figure's outline, to add a knob there. Click a knob to flip it, and once more to remove it." +
        (n ? " (" + n + (n === 1 ? " knob placed by hand)" : " knobs placed by hand)") : "");
}

function startKnobTool() {
    startPick("plug");
    knobToolMessage();
}
