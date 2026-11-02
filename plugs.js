// Knobs the user places on a figure's outline, so the figure locks into the piece next to it
// (a T-rex's neck into the edge piece, say). A knob is stored on its figure as {u, out}: u is the
// position along the figure's outline (0..1, so it survives moving and resizing), out says
// whether the knob sticks out of the figure (true) or into it (false).

function knobRadius() { return (S.knob / 100) * S.piece; }
function plugSpan() { return 5.5 * knobRadius(); }   // length of outline a knob replaces, mm

function tmpPath(d) {
    let holder = document.getElementById("plugholder");
    if (!holder) {
        holder = document.createElementNS(NS, "svg");
        holder.id = "plugholder";
        holder.setAttribute("style", "position:absolute;left:-100000px;top:0");
        document.body.appendChild(holder);
    }
    const p = document.createElementNS(NS, "path");
    p.setAttribute("d", d);
    holder.appendChild(p);
    return p;
}

// Builds the outline with knobs. Returns {d, knobs: [{c, v1, v2}]}; d is unchanged without plugs.
function outlineWithPlugs(d, plugs) {
    const p = tmpPath(d);
    const T = p.getTotalLength(), L = plugSpan();
    const out = { d: d, knobs: [] };
    if (!plugs || !plugs.length || T < 3 * L) { p.remove(); return out; }
    const at = (s) => { const q = p.getPointAtLength(((s % T) + T) % T); return { x: q.x, y: q.y }; };
    const sorted = plugs.filter((pl) => !pl.off).map((pl) => ({ s: pl.u * T, out: pl.out })).sort((a, b) => a.s - b.s);
    if (!sorted.length) { p.remove(); return out; }
    // drop knobs that would overlap the one before
    const kept = [];
    sorted.forEach((k) => { if (!kept.length || k.s - kept[kept.length - 1].s > 1.1 * L) kept.push(k); });
    if (kept.length > 1 && kept[0].s + T - kept[kept.length - 1].s < 1.1 * L) kept.pop();

    const fmt = (q) => q.x.toFixed(3) + " " + q.y.toFixed(3);
    const step = 0.4;
    let str = "", first = null;
    kept.forEach((k, idx) => {
        const v1 = at(k.s - L / 2), v2 = at(k.s + L / 2);
        // which side is outside the figure?
        // test from the outline itself: on a curve the chord between v1 and v2 lies inside the figure
        const c = at(k.s);
        const dl = { x: v2.x - v1.x, y: v2.y - v1.y }, len = Math.hypot(dl.x, dl.y) || 1;
        const nrm = { x: -dl.y / len, y: dl.x / len };
        let inPos = 0, inNeg = 0;
        [0.6, 1.2, 2].forEach((e) => {
            if (p.isPointInFill(new DOMPoint(c.x + nrm.x * e, c.y + nrm.y * e))) inPos++;
            if (p.isPointInFill(new DOMPoint(c.x - nrm.x * e, c.y - nrm.y * e))) inNeg++;
        });
        const posIsInside = inPos > inNeg;
        // knobGeometry draws the head on the +w side unless flip is set
        const flip = k.out ? posIsInside : !posIsInside;
        const segs = knobGeometry(v1, v2, { t: knobRadius() / len, m: 0.5, flip: flip, a: 0, d: 0, e: 0 });
        out.knobs.push({ c: at(k.s), v1: v1, v2: v2 });
        if (!first) { first = v1; str = "M " + fmt(v1) + " "; }
        str += segs.map((sg) => "C " + fmt(sg[1]) + " " + fmt(sg[2]) + " " + fmt(sg[3])).join(" ") + " ";
        // outline on to the next knob
        const nextS = idx + 1 < kept.length ? kept[idx + 1].s : kept[0].s + T;
        for (let s = k.s + L / 2 + step; s < nextS - L / 2; s += step) str += "L " + fmt(at(s)) + " ";
    });
    p.remove();
    out.d = str + "Z";
    return out;
}

// Runs after the engine: puts the knobs into the figure outlines, in the cut file and in lastShapes.
function applyPlugs() {
    if (!window.lastShapes) return;
    lastShapes.forEach((s) => {
        if (!s.whimsy) return;
        const w = whimsies[s.wi];
        s.dBase = s.d;
        if (!w) return;
        s.autoPlugs = S.autoKnobs ? autoPlugsFor(s, w) : [];
        const all = (w.plugs || []).concat(s.autoPlugs);
        if (!all.length) return;
        const res = outlineWithPlugs(s.d, all);
        if (res.d === s.d) return;
        svgstr = svgstr.split('d="' + s.d + '"').join('d="' + res.d + '"');
        svgstrsave = svgstrsave.split('d="' + s.d + '"').join('d="' + res.d + '"');
        s.d = res.d;
        s.knobs = res.knobs;
    });
}

// Click on the stage while placing knobs: add a knob, flip it, or remove it.
function plugClick(pt) {
    const wi = PICK.figure;
    const w = whimsies[wi];
    const shape = (window.lastShapes || []).find((s) => s.whimsy && s.wi === wi);
    if (!w || !shape) return;
    const p = tmpPath(shape.dBase || shape.d);
    const T = p.getTotalLength();
    let best = 0, bd = Infinity;
    for (let s = 0; s < T; s += 0.4) {
        const q = p.getPointAtLength(s), d = Math.hypot(q.x - pt.x, q.y - pt.y);
        if (d < bd) { bd = d; best = s; }
    }
    p.remove();
    if (bd > Math.max(4, S.piece * 0.25)) {
        $("pickMsg").textContent = "Click closer to the edge of " + w.name + ".";
        return;
    }
    w.plugs = w.plugs || [];
    const L = plugSpan(), u = best / T;
    const near = (pl) => { const ds = Math.abs(pl.u - u) * T; return Math.min(ds, T - ds) < L / 2; };
    const hit = w.plugs.findIndex(near);
    const auto = (shape.autoPlugs || []).find(near);
    if (hit >= 0) {
        const pl = w.plugs[hit];
        if (pl.off) { pl.off = false; pl.out = true; }   // removed knob: put it back
        else if (pl.out === pl.firstOut) pl.out = !pl.out;  // second click: point the other way
        else pl.off = true;                               // third click: remove (also keeps automatic knobs away)
    } else if (auto) {
        // an automatic knob: the first click flips it, and from then on it is the user's
        w.plugs.push({ u: auto.u, out: !auto.out, firstOut: auto.out });
    } else {
        w.plugs.push({ u: u, out: true, firstOut: true });
    }
    plugMessage();
    buildWhimsyCards();
    regen(0);
}

function plugMessage() {
    const w = whimsies[PICK.figure];
    const n = (w && w.plugs || []).length;
    $("pickMsg").textContent = "Click the edge of " + (w ? w.name : "the figure") +
        " where it should lock in. Click a knob to flip it, and once more to remove it." +
        (n ? " (" + n + (n === 1 ? " knob)" : " knobs)") : "");
}

function startPlugs(i) {
    selectWhimsy(i);
    startPick("plug");
    PICK.figure = i;
    plugMessage();
}

// Automatic knobs on a figure's outline: where one piece shares a long, fairly straight stretch
// of outline with the figure, put a knob in the middle of it, so that piece locks into the figure.
function autoPlugsFor(s, w) {
    if (typeof automata === "undefined" || !automata) return [];
    const cell = parseFloat($("cell_scale").value), L = plugSpan();
    const p = tmpPath(s.d), T = p.getTotalLength();
    if (T < 3 * L) { p.remove(); return []; }
    const step = 1;
    const n = Math.floor(T / step);
    const at = (u) => { const q = p.getPointAtLength(((u % T) + T) % T); return { x: q.x, y: q.y }; };
    const label = (x, y) => {
        const r = Math.floor(y / cell), c = Math.floor(x / cell);
        return r >= 0 && c >= 0 && r < automata.rows && c < automata.columns ? Math.abs(automata.grid[r][c]) : 0;
    };
    // piece just outside the outline at every mm
    const lab = new Array(n);
    for (let k = 0; k < n; k++) {
        const a = at(k * step - 0.5), b = at(k * step + 0.5), c = at(k * step);
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1, nx = -(b.y - a.y) / len, ny = (b.x - a.x) / len;
        const off = 1.6 * cell;
        const inPos = p.isPointInFill(new DOMPoint(c.x + nx * 0.6, c.y + ny * 0.6));
        const sg = inPos ? -1 : 1;
        lab[k] = label(c.x + nx * off * sg, c.y + ny * off * sg);
    }
    // runs of the same piece (wrapping around the outline)
    let startK = lab.findIndex((l, k) => l !== lab[(k - 1 + n) % n]);
    if (startK < 0) startK = 0;
    const runs = [];
    let k0 = startK;
    for (let j = 1; j <= n; j++) {
        const k = (startK + j) % n;
        if (j === n || lab[k] !== lab[k0]) { runs.push({ k0: k0, len: ((k - k0 + n) % n || n) * step, label: lab[k0] }); k0 = k; }
    }
    const taken = (w.plugs || []).map((pl) => pl.u * T);
    const ends = [];
    edgeLog.forEach((e) => { ends.push(e.v1, e.v2); });
    const out = [];
    runs.forEach((r) => {
        if (!r.label || multiLabels.has(r.label) || r.len < 1.6 * L) return;
        const s0 = r.k0 * step, s1 = s0 + r.len;
        if (taken.some((t) => { const tt = t < s0 ? t + T : t; return tt >= s0 - L / 2 && tt <= s1 + L / 2; })) return;
        // straightest spot in the run, away from its ends
        let best = null, bs = 0;
        for (let c = s0 + L / 2 + 2; c <= s1 - L / 2 - 2; c += 1) {
            // keep clear of places where other lines meet the outline (also lines inside a split figure)
            const pc = at(c), clear = L / 2 + 1.5;
            if (ends.some((q) => Math.hypot(q.x - pc.x, q.y - pc.y) < clear)) continue;
            const a = at(c - L / 2), b = at(c + L / 2), straight = Math.hypot(b.x - a.x, b.y - a.y) / L;
            const score = straight - 0.002 * Math.abs(c - (s0 + s1) / 2);
            if (straight > 0.86 && score > bs) { bs = score; best = c; }
        }
        if (best === null) return;
        out.push({ u: (((best % T) + T) % T) / T, out: random() > 0.5, auto: true });
    });
    p.remove();
    return out;
}
