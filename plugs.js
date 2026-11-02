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
    const sorted = plugs.map((pl) => ({ s: pl.u * T, out: pl.out })).sort((a, b) => a.s - b.s);
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
        if (!w || !w.plugs || !w.plugs.length) return;
        const res = outlineWithPlugs(s.d, w.plugs);
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
    const hit = w.plugs.findIndex((pl) => {
        const ds = Math.abs(pl.u - u) * T;
        return Math.min(ds, T - ds) < L / 2;
    });
    if (hit >= 0) {
        if (w.plugs[hit].out) w.plugs[hit].out = false;   // second click: point the other way
        else w.plugs.splice(hit, 1);                      // third click: remove
    } else {
        w.plugs.push({ u: u, out: true });
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
