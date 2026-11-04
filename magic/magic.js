// Jigsaw Workshop — Magic puzzle (shift and reveal).
//
// How the trick works (the same idea as the Magic Puzzle Company puzzles):
//  - The finished puzzle is a jigsaw with a road running across it, usually on a slant, so the sections
//    have stepped, slanted edges. In one place a short side road crosses it: a stack of slanted strips.
//  - To open it, everything below the road (section B) slides down a row or two. That opens a gap that
//    follows the road. The side-road strips (C, D, …) are lifted out and laid into that gap.
//  - Where the side road was there is now a slanted hole in the middle of the picture. The secret pieces
//    (the "final bag") fill it, and the picture tells a new story. The opened puzzle is a bit taller.
//  - Every seam follows the piece grid and has the same tooth, so the sections fit in both arrangements;
//    the picture lines up because every seam is painted with the road.

function $(id) { return document.getElementById(id); }
const LETTERS = "ABCDEFGHIJ";

const M = {
    W: 400, H: 300,             // closed puzzle, mm
    n: 3,                       // the road is cut into n parts; n - 1 of them are side-road strips
    bandRows: 2,                // how many rows section B slides down
    roadShape: "slant",         // straight | slant | wavy
    k: null,                    // hole column (null = choose from the picture)
    road: null,                 // road height at the hole, as a fraction of the height (null = from the picture)
    piece: 25,                  // mm
    knob: 13,                   // % of piece size
    seed: Math.floor(Math.random() * 9999),
    roadStyle: "plain",         // plain | picture
    secretText: "",
    styleText: "",
    showOpen: false,
    showCuts: true,
    showSections: true,
};

const PIC = {
    orig: null,        // canvas: the uploaded / painted picture, cropped to the closed puzzle
    main: null,        // canvas: the closed picture with the road painted in
    mainUrl: null,
    secret: null,      // canvas: picture for the secret pieces (hole box + bleed)
    secretUrl: null,
    pxPerMm: 6,
    auto: null,        // { k, s } chosen from the picture
};

// ------------------------------------------------------------------ layout
function clamp(v, a, b) { return Math.max(a, Math.min(b, v)); }

// The road's height in each grid column, relative. It repeats from part to part, so every side-road strip
// has the same shape and fits every slot along the road. "slant": inside each part the road runs down at a
// slant and steps back up where two parts meet, so the strips are slanted parallelograms; "wavy": a zigzag.
// A strip stays in one piece only if the road moves less than the slide (b rows) from column to column.
function roadProfile(shape, C, cpc, b, g) {
    const p = [];
    for (let c = 0; c < C; c++) {
        const i = c % cpc;
        if (shape === "slant" && b >= 2) p.push(Math.floor(((i + 0.5) * g) / cpc));
        else if (shape === "wavy" && b >= 2) p.push(Math.min(Math.min(i, cpc - 1 - i), g));
        else p.push(0);
    }
    return p;
}

// the road heights at the hole column that keep a row of puzzle above and below everything
function roadRange(prof, k, cpc, C, R, n, b, m) {
    let lo = 1, hi = R - 1;
    const ref = prof[k * cpc];
    for (let c = 0; c < C; c++) {
        const d = prof[c] - ref;
        lo = Math.max(lo, 1 - d); hi = Math.min(hi, R - 1 - d);
        if (c >= k * cpc && c < (k + 1) * cpc) { lo = Math.max(lo, 1 + m * b - d); hi = Math.min(hi, R - 1 - (n - 1 - m) * b - d); }
    }
    return [lo, hi];
}

function layout(forceK) {
    const n = clamp(M.n, 3, 6), b = clamp(M.bandRows, 1, 3);
    const cpc = Math.max(2, Math.round(M.W / n / M.piece));
    const C = n * cpc;
    const R = Math.max((n - 1) * b + 3, Math.round(M.H / M.piece));
    const cw = M.W / C, ch = M.H / R;
    const m = Math.floor((n - 1) / 2);                       // side-road strips above the road
    let k = forceK != null ? forceK : M.k != null ? M.k : PIC.auto ? PIC.auto.k : Math.floor((n - 1) / 2);
    k = clamp(k, 1, n - 2);
    // the steepest slant (up to about a third of the height) that still fits
    // as steep as fits: up to one row per column for slanted, a few rows high for wavy
    let g = b < 2 ? 0 : M.roadShape === "slant" ? Math.min(cpc * (b - 1), Math.round(0.45 * R)) : M.roadShape === "wavy" ? Math.min(cpc >> 1, 3) : 0;
    let prof, range;
    for (;;) {
        prof = roadProfile(g === 0 ? "straight" : M.roadShape, C, cpc, b, g);
        range = roadRange(prof, k, cpc, C, R, n, b, m);
        if (range[0] <= range[1] || g === 0) break;
        g--;
    }
    if (range[0] > range[1]) { prof = new Array(C).fill(0); range = roadRange(prof, k, cpc, C, R, n, b, m); }
    let s = M.road != null ? Math.round(M.road * R) : PIC.auto && forceK == null ? PIC.auto.s : Math.round(R * 0.55);
    s = clamp(s, range[0], range[1]);
    const K0 = k * cpc, K1 = (k + 1) * cpc, ref = prof[K0];
    const sAt = (c) => s + prof[c] - ref;                 // first row below the road, per column
    const qTop = (c) => sAt(c) - m * b;                   // top of the side-road stack (hole columns)
    let holeTop = Infinity, holeBot = -Infinity;
    for (let c = K0; c < K1; c++) { holeTop = Math.min(holeTop, qTop(c)); holeBot = Math.max(holeBot, qTop(c) + n * b); }
    const donorCols = [];
    for (let j = 0; j < n; j++) if (j !== k) donorCols.push(j);
    return {
        n, b, cpc, C, R, cw, ch, m, k, s, g, prof, sAt, qTop,
        sMin: range[0], sMax: range[1],
        K0, K1, holeTop, holeBot,
        donorCols,
        OH: M.H + b * ch,                     // opened height
        bleed: 0.4 * Math.min(cw, ch),        // picture margin around the secret pieces, for the knobs
    };
}

// which section a cell belongs to when the puzzle is closed: 0 = A above the road, 1 = B below, 2.. side-road strips
function sectionOf(L, c, r) {
    if (c >= L.K0 && c < L.K1) {
        const q = L.qTop(c);
        if (r >= q && r < q + (L.n - 1) * L.b) return 2 + Math.floor((r - q) / L.b);
    }
    return r < L.sAt(c) ? 0 : 1;
}
// cells of the hole, in opened coordinates
function inHole(L, c, r) { return c >= L.K0 && c < L.K1 && r >= L.qTop(c) && r < L.qTop(c) + L.n * L.b; }
function sectionCount(L) { return 2 + (L.n - 1); }
function sectionLetter(i) { return LETTERS[i]; }

// how far a section moves when the puzzle is opened; stage 0 closed, 1 B slid down, 2 strips moved
function offsetOf(L, i, stage) {
    if (i === 0 || stage === 0) return { x: 0, y: 0 };
    if (i === 1) return { x: 0, y: L.b * L.ch };
    if (stage < 2) return { x: 0, y: 0 };
    const t = i - 2, j = L.donorCols[t], dc = (j - L.k) * L.cpc;
    const rows = L.sAt(L.K0 + dc) - (L.qTop(L.K0) + t * L.b);
    return { x: dc * L.cw, y: rows * L.ch };
}

// ------------------------------------------------------------------ pieces
function mulberry32(a) {
    return function () {
        a |= 0; a = (a + 0x6d2b79f5) | 0;
        let t = Math.imul(a ^ (a >>> 15), 1 | a);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
}

// classic knob: flat shoulders, narrow neck, round head (same shape as the main workshop)
function knobGeometry(v1, v2, k) {
    const t = k.t, m = k.m, sg = k.flip ? -1 : 1;
    const P = (l, w) => ({ l: l, w: w * sg });
    const rel = [
        [P(0.2, k.a * 0.3), P(m - 1.6 * t, -0.05 * t), P(m - 1.1 * t, -0.05 * t)],
        [P(m - 0.55 * t, -0.05 * t), P(m - 0.25 * t, 0.7 * t), P(m - 0.6 * t, 0.9 * t)],
        [P(m - 1.3 * t, 1.3 * t), P(m - 0.8 * t, 2.35 * t + k.d * 0.2), P(m, 2.35 * t + k.d * 0.2)],
        [P(m + 0.8 * t, 2.35 * t + k.d * 0.2), P(m + 1.3 * t, 1.3 * t), P(m + 0.6 * t, 0.9 * t)],
        [P(m + 0.25 * t, 0.7 * t), P(m + 0.55 * t, -0.05 * t), P(m + 1.1 * t, -0.05 * t)],
        [P(m + 1.6 * t, -0.05 * t), P(0.8, k.e * 0.3), P(1, 0)],
    ];
    const dl = { x: v2.x - v1.x, y: v2.y - v1.y }, dw = { x: -dl.y, y: dl.x };
    const at = (p) => ({ x: v1.x + p.l * dl.x + p.w * dw.x, y: v1.y + p.l * dl.y + p.w * dw.y });
    return rel.map((seg) => seg.map(at));
}

const f3 = (p) => p.x.toFixed(3) + " " + p.y.toFixed(3);

// path for an edge, optionally shifted; kinds: line, knob (random, from e.k), seam (fixed knob pointing down / right)
function edgeD(e, ox, oy) {
    const sh = (p) => ({ x: p.x + (ox || 0), y: p.y + (oy || 0) });
    const v1 = sh(e.v1), v2 = sh(e.v2);
    if (e.kind === "line") return "M " + f3(v1) + " L " + f3(v2);
    const L = Math.hypot(v2.x - v1.x, v2.y - v1.y);
    const r = Math.min(e.r, 0.16 * L);
    if (r < 1.5) return "M " + f3(v1) + " L " + f3(v2);
    if (e.kind === "seam") {
        // a tooth that doesn't lock: the sections can slide apart and still sit in place, like the seams in the box
        const dl = { x: (v2.x - v1.x) / L, y: (v2.y - v1.y) / L }, dw = { x: -dl.y, y: dl.x };
        const at = (l, w) => ({ x: v1.x + l * L * dl.x + w * dw.x, y: v1.y + l * L * dl.y + w * dw.y });
        const a = 0.2, c = 0.05, d = r * 1.1;
        return "M " + [at(0, 0), at(0.5 - a, 0), at(0.5 - a + c, d), at(0.5 + a - c, d), at(0.5 + a, 0), at(1, 0)].map(f3).join(" L ");
    }
    const k = e.kind === "seam" ? { t: r / L, m: 0.5, flip: false, a: 0, d: 0, e: 0 } :
        { t: (r / L) * (1 + e.k.j), m: e.k.m, flip: e.k.flip, a: e.k.a, d: e.k.d, e: e.k.e };
    return "M " + f3(v1) + " " + knobGeometry(v1, v2, k).map((s) => "C " + s.map(f3).join(" ")).join(" ");
}

// A grid of cells cols c0..c1, rows r0..r1 (lattice units). cellSec(c, r) names the section of a cell.
// Returns the corner points and the edges, each edge knowing the sections on its two sides.
function gridModel(L, c0, c1, r0, r1, cellSec, rnd, hSeamBoundary) {
    const jit = 0.08, rad = (M.knob / 100) * Math.min(L.cw, L.ch);
    const inside = (c, r) => c >= c0 && c < c1 && r >= r0 && r < r1;
    const secAt = (c, r) => (inside(c, r) ? cellSec(c, r) : null);
    // a corner may only wobble when every edge meeting it is an ordinary edge inside one section
    const free = (c, r) => {
        if (c <= c0 || c >= c1 || r <= r0 || r >= r1) return false;
        const a = secAt(c - 1, r - 1), b = secAt(c, r - 1), d = secAt(c - 1, r), e = secAt(c, r);
        return a !== null && a === b && b === d && d === e;
    };
    const P = [];
    for (let r = r0; r <= r1; r++) {
        const row = [];
        for (let c = c0; c <= c1; c++) {
            let x = c * L.cw, y = r * L.ch;
            const jx = rnd(), jy = rnd();
            if (free(c, r)) { x += (jx - 0.5) * 2 * jit * L.cw; y += (jy - 0.5) * 2 * jit * L.ch; }
            row.push({ x, y });
        }
        P.push(row);
    }
    const pt = (c, r) => P[r - r0][c - c0];
    const knobParams = () => {
        const j = () => (rnd() - 0.5) * 0.08;
        return { j: j(), m: 0.5 + j(), flip: rnd() > 0.5, a: j(), d: j(), e: j() };
    };
    const edges = [];
    for (let r = r0; r <= r1; r++) for (let c = c0; c < c1; c++) {
        const up = secAt(c, r - 1), dn = secAt(c, r), kp = knobParams();
        if (up === null && dn === null) continue;
        const e = { v1: pt(c, r), v2: pt(c + 1, r), r: rad, secs: [up, dn].filter((x) => x !== null), h: true, row: r };
        if (up === null || dn === null) e.kind = hSeamBoundary ? "seam" : "line";
        else if (up === dn) { e.kind = "knob"; e.k = kp; }
        else e.kind = "seam";
        edges.push(e);
    }
    for (let c = c0; c <= c1; c++) for (let r = r0; r < r1; r++) {
        const lf = secAt(c - 1, r), rt = secAt(c, r), kp = knobParams();
        if (lf === null && rt === null) continue;
        const e = { v1: pt(c, r), v2: pt(c, r + 1), r: rad, secs: [lf, rt].filter((x) => x !== null), h: false };
        if (lf === null || rt === null || lf !== rt) e.kind = "line";
        else { e.kind = "knob"; e.k = kp; }
        edges.push(e);
    }
    let pieces = 0;
    for (let r = r0; r < r1; r++) for (let c = c0; c < c1; c++) if (secAt(c, r) !== null) pieces++;
    return { edges, pieces };
}

let MODEL = null;
function buildModel() {
    const L = layout();
    const board = gridModel(L, 0, L.C, 0, L.R, (c, r) => sectionOf(L, c, r), mulberry32(M.seed * 31 + 7));
    // the secret pieces, in opened coordinates; their top and bottom edges take the seam shape
    const secret = gridModel(L, L.K0, L.K1, L.holeTop, L.holeBot, (c, r) => (inHole(L, c, r) ? "S" : null),
        mulberry32(M.seed * 31 + 997), true);
    MODEL = { L, board, secret };
    return MODEL;
}

// rectangles (closed coordinates) covering a section, one per run of cells in a row
function sectionRects(L, i) {
    const rects = [];
    for (let r = 0; r < L.R; r++) {
        let c = 0;
        while (c < L.C) {
            if (sectionOf(L, c, r) !== i) { c++; continue; }
            const start = c;
            while (c < L.C && sectionOf(L, c, r) === i) c++;
            const last = rects[rects.length - 1];
            if (last && last.c0 === start && last.c1 === c && last.r1 === r) last.r1 = r + 1;
            else rects.push({ c0: start, c1: c, r0: r, r1: r + 1 });
        }
    }
    return rects.map((q) => ({ x: q.c0 * L.cw, y: q.r0 * L.ch, w: (q.c1 - q.c0) * L.cw, h: (q.r1 - q.r0) * L.ch }));
}

function sectionCentre(L, i) {
    let sx = 0, sy = 0, n = 0;
    for (let r = 0; r < L.R; r++) for (let c = 0; c < L.C; c++) if (sectionOf(L, c, r) === i) { sx += c + 0.5; sy += r + 0.5; n++; }
    let x = (sx / n) * L.cw, y = (sy / n) * L.ch;
    // A and B are notched; keep the letter out of the notch, in the middle of the part beside it
    if (i <= 1) {
        const c = i === 0 ? Math.round(L.C * 0.72) : Math.round(L.C * 0.28);
        x = (c + 0.5) * L.cw;
        y = i === 0 ? (L.sAt(c) / 2) * L.ch : ((L.sAt(c) + L.R) / 2) * L.ch;
    }
    return { x, y };
}

// rectangles (opened coordinates) covering the hole, one per grid column
function holeRects(L) {
    const out = [];
    for (let c = L.K0; c < L.K1; c++) out.push({ x: c * L.cw, y: L.qTop(c) * L.ch, w: L.cw, h: L.n * L.b * L.ch });
    return out;
}
function holeBox(L) { return { x: L.K0 * L.cw, y: L.holeTop * L.ch, w: L.cpc * L.cw, h: (L.holeBot - L.holeTop) * L.ch }; }

// ------------------------------------------------------------------ pictures
function canvasOf(w, h) { const c = document.createElement("canvas"); c.width = Math.max(1, Math.round(w)); c.height = Math.max(1, Math.round(h)); return c; }

function loadImage(src) {
    return new Promise((resolve, reject) => {
        const im = new Image();
        im.onload = () => resolve(im);
        im.onerror = () => reject(new Error("Couldn't read the picture."));
        im.src = src;
    });
}

// crop-to-fill an image onto a canvas of the given size
function coverCanvas(img, w, h) {
    const c = canvasOf(w, h), cx = c.getContext("2d");
    const iw = img.naturalWidth || img.width, ih = img.naturalHeight || img.height;
    const s = Math.max(w / iw, h / ih);
    cx.drawImage(img, (w - iw * s) / 2, (h - ih * s) / 2, iw * s, ih * s);
    return c;
}

async function setMainPicture(img) {
    PIC.mainImg = img;
    PIC.pxPerMm = Math.max(4, Math.min(3000 / M.W, (img.naturalWidth || img.width) / M.W));
    PIC.orig = coverCanvas(img, M.W * PIC.pxPerMm, M.H * PIC.pxPerMm);
    PIC.secret = null; PIC.secretUrl = null;
    chooseRoad();
    rebuildPictures();
}

// how busy each lattice cell of the picture is (sum of gradients)
function cellEnergy(L) {
    const sw = Math.min(480, PIC.orig.width), sh = Math.round(sw * PIC.orig.height / PIC.orig.width);
    const small = canvasOf(sw, sh);
    small.getContext("2d").drawImage(PIC.orig, 0, 0, sw, sh);
    const d = small.getContext("2d").getImageData(0, 0, sw, sh).data;
    const lum = (x, y) => { const i = (y * sw + x) * 4; return d[i] * 0.3 + d[i + 1] * 0.59 + d[i + 2] * 0.11; };
    const E = [];
    for (let r = 0; r < L.R; r++) { E.push(new Float32Array(L.C)); }
    for (let y = 1; y < sh - 1; y++) for (let x = 1; x < sw - 1; x++) {
        const g = Math.abs(lum(x + 1, y) - lum(x - 1, y)) + Math.abs(lum(x, y + 1) - lum(x, y - 1));
        const c = Math.min(L.C - 1, Math.floor((x / sw) * L.C)), r = Math.min(L.R - 1, Math.floor((y / sh) * L.R));
        E[r][c] += g;
    }
    return E;
}

// The road goes where the picture is calmest: along the road line, plus the crossroads.
function chooseRoad() {
    PIC.auto = null;
    if (!PIC.orig) return;
    const saveRoad = M.road;
    M.road = null;
    let best = null, E = null;
    for (let k = 1; k <= clamp(M.n, 3, 6) - 2; k++) {
        const L = layout(k);
        if (!E) E = cellEnergy(L);
        const ref = L.prof[L.K0];
        for (let s = L.sMin; s <= L.sMax; s++) {
            let e = 0;
            for (let c = 0; c < L.C; c++) {
                const sc = s + L.prof[c] - ref;
                for (let r = Math.max(0, sc - L.b); r < Math.min(L.R, sc + L.b); r++) e += E[r][c];
                if (c >= L.K0 && c < L.K1) for (let r = sc - L.m * L.b; r < sc + (L.n - 1 - L.m) * L.b; r++) e += E[r][c] * 1.5;
            }
            // a slight preference for the middle, where the hole looks best
            e *= 1 + 0.15 * Math.abs(k - (L.n - 1) / 2) + 0.2 * Math.abs(s / L.R - 0.55);
            if (!best || e < best.e) best = { e, k, s };
        }
    }
    M.road = saveRoad;
    PIC.auto = best;
}

// distance from every point of the picture to the nearest seam between sections (grid of res px per mm)
function seamDistance(L, res) {
    const w = Math.ceil(M.W * res), h = Math.ceil(M.H * res);
    const D = new Float32Array(w * h).fill(1e9);
    const seed = (x, y) => { if (x >= 0 && y >= 0 && x < w && y < h) D[y * w + x] = 0; };
    for (let r = 1; r < L.R; r++) for (let c = 0; c < L.C; c++) {
        if (sectionOf(L, c, r - 1) === sectionOf(L, c, r)) continue;
        const y = Math.round(r * L.ch * res);
        for (let x = Math.floor(c * L.cw * res); x <= Math.ceil((c + 1) * L.cw * res); x++) { seed(x, y); seed(x, y - 1); }
    }
    for (let c = 1; c < L.C; c++) for (let r = 0; r < L.R; r++) {
        if (sectionOf(L, c - 1, r) === sectionOf(L, c, r)) continue;
        const x = Math.round(c * L.cw * res);
        for (let y = Math.floor(r * L.ch * res); y <= Math.ceil((r + 1) * L.ch * res); y++) { seed(x, y); seed(x - 1, y); }
    }
    const S2 = Math.SQRT2;
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x; let v = D[i];
        if (x > 0) v = Math.min(v, D[i - 1] + 1);
        if (y > 0) { v = Math.min(v, D[i - w] + 1); if (x > 0) v = Math.min(v, D[i - w - 1] + S2); if (x < w - 1) v = Math.min(v, D[i - w + 1] + S2); }
        D[i] = v;
    }
    for (let y = h - 1; y >= 0; y--) for (let x = w - 1; x >= 0; x--) {
        const i = y * w + x; let v = D[i];
        if (x < w - 1) v = Math.min(v, D[i + 1] + 1);
        if (y < h - 1) { v = Math.min(v, D[i + w] + 1); if (x < w - 1) v = Math.min(v, D[i + w + 1] + S2); if (x > 0) v = Math.min(v, D[i + w - 1] + S2); }
        D[i] = v;
    }
    return { D, w, h, res };
}

// Paint the road along every seam. Sections meet other sections when the puzzle opens, so every seam
// is painted the same way (an even road colour with a fine grain), and any two edges meet seamlessly.
// "plain": a path in a colour taken from the picture; "picture": the picture's own road colour, with a
// narrower blend (best after the road was painted into the picture with AI).
function paintRoad(L) {
    const k = PIC.pxPerMm, res = Math.min(3, k);
    const { D, w, h } = seamDistance(L, res);
    const fade = (M.roadStyle === "picture" ? 0.3 : 0.45) * Math.min(L.cw, L.ch) * res;
    // road colour: the median of the picture along the seams
    const small = canvasOf(w, h);
    small.getContext("2d").drawImage(PIC.orig, 0, 0, w, h);
    const sd = small.getContext("2d").getImageData(0, 0, w, h).data;
    const vals = [[], [], []];
    for (let i = 0; i < w * h; i += 3) if (D[i] < fade * 0.7) for (let q = 0; q < 3; q++) vals[q].push(sd[i * 4 + q]);
    const med = vals.map((v) => { v.sort((a, b) => a - b); return v.length ? v[v.length >> 1] : 160; });
    const grey = (med[0] + med[1] + med[2]) / 3;
    const base = M.roadStyle === "picture" ? med : med.map((v) => Math.min(235, (v * 0.55 + grey * 0.45) * 1.12 + 18));
    // where the road goes: soft along the seams, solid on the side-road strips
    const mask = canvasOf(w, h), mx = mask.getContext("2d"), md = mx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let a = Math.max(0, Math.min(1, 1.6 * (1 - D[i] / fade)));
        const c = Math.floor(x / res / L.cw), r = Math.floor(y / res / L.ch);
        if (sectionOf(L, Math.min(c, L.C - 1), Math.min(r, L.R - 1)) >= 2) a = 1;
        md.data[i * 4 + 3] = Math.round(a * 255);
    }
    mx.putImageData(md, 0, 0);
    // the road itself, at full size
    const W = PIC.orig.width, H = PIC.orig.height;
    const road = canvasOf(W, H), rx = road.getContext("2d"), rd = rx.createImageData(W, H), rnd = mulberry32(M.seed * 13 + 5);
    for (let i = 0; i < W * H; i++) {
        const g = (rnd() - 0.5) * 14 + (rnd() - 0.5) * 6;
        rd.data[i * 4] = base[0] + g; rd.data[i * 4 + 1] = base[1] + g; rd.data[i * 4 + 2] = base[2] + g * 0.9; rd.data[i * 4 + 3] = 255;
    }
    rx.putImageData(rd, 0, 0);
    rx.globalCompositeOperation = "destination-in";
    rx.imageSmoothingQuality = "high";
    rx.drawImage(mask, 0, 0, W, H);
    const out = canvasOf(W, H), ox = out.getContext("2d");
    ox.drawImage(PIC.orig, 0, 0);
    ox.drawImage(road, 0, 0);
    return out;
}

function rebuildPictures() {
    if (!PIC.orig) { PIC.main = null; PIC.mainUrl = null; return; }
    const L = layout();
    PIC.main = paintRoad(L);
    PIC.mainUrl = PIC.main.toDataURL("image/jpeg", 0.88);
    if (PIC.secretSrc) fitSecret(PIC.secretSrc, PIC.secretFromOpen);
}

// clip a canvas context to a section's cells, shifted
function clipRects(cx, rects, off, k) {
    cx.beginPath();
    for (const q of rects) cx.rect((q.x + off.x) * k, (q.y + off.y) * k, q.w * k, q.h * k);
    cx.clip();
}

// The picture at one stage of opening: 0 closed, 1 B slid down, 2 strips moved (hole empty), 3 secret in place.
// hole: null = transparent, or a fill colour.
function compositeAt(stage, hole) {
    const L = layout(), k = PIC.pxPerMm;
    const c = canvasOf(M.W * k, (stage === 0 ? M.H : L.OH) * k), cx = c.getContext("2d");
    for (let i = 0; i < sectionCount(L); i++) {
        const off = offsetOf(L, i, stage);
        cx.save(); clipRects(cx, sectionRects(L, i), off, k);
        cx.drawImage(PIC.main, off.x * k, off.y * k);
        cx.restore();
    }
    if (stage >= 2) {
        const hb = holeBox(L);
        cx.save(); clipRects(cx, holeRects(L), { x: 0, y: 0 }, k);
        if (stage === 3 && PIC.secret) cx.drawImage(PIC.secret, (hb.x - L.bleed) * k, (hb.y - L.bleed) * k);
        else if (hole) { cx.fillStyle = hole; cx.fillRect(0, 0, c.width, c.height); }
        cx.restore();
    }
    return c;
}

// The secret picture: the box around the hole plus a margin for the knobs that reach into the neighbours.
// fromOpen: the image is the whole opened puzzle (AI result or filled-in template); else just the hole.
function fitSecret(img, fromOpen) {
    PIC.secretSrc = img; PIC.secretFromOpen = !!fromOpen;
    const L = layout(), k = PIC.pxPerMm, bl = L.bleed * k, hb = holeBox(L);
    const hw = hb.w * k, hh = hb.h * k;
    const out = canvasOf(hw + 2 * bl, hh + 2 * bl), o = out.getContext("2d");
    if (fromOpen) {
        const full = coverCanvas(img, M.W * k, L.OH * k);
        o.drawImage(full, hb.x * k - bl, hb.y * k - bl, out.width, out.height, 0, 0, out.width, out.height);
    } else {
        o.drawImage(coverCanvas(img, hw, hh), bl, bl);
        // the margin: stretch the outermost pixels
        o.drawImage(out, bl, bl, hw, 1, bl, 0, hw, bl);
        o.drawImage(out, bl, bl + hh - 1, hw, 1, bl, bl + hh, hw, bl);
        o.drawImage(out, bl, 0, 1, out.height, 0, 0, bl, out.height);
        o.drawImage(out, bl + hw - 1, 0, 1, out.height, bl + hw, 0, bl, out.height);
    }
    PIC.secret = out;
    PIC.secretUrl = out.toDataURL("image/jpeg", 0.9);
}

// ------------------------------------------------------------------ prompts
function secretPrompt() {
    const what = M.secretText.trim() || "something surprising that changes the story of the picture";
    return "This is an illustration with an empty rectangular area in the middle. Paint the empty area so the illustration " +
        "continues seamlessly into it, in exactly the same art style, colours and lighting as the rest. Keep everything " +
        "outside the empty area unchanged. In the new area, show: " + what + "." +
        (M.styleText.trim() ? " Style: " + M.styleText.trim() + "." : "");
}

function mainPrompt() {
    const L = layout(), ratio = (M.W / M.H).toFixed(2), at = Math.round((L.s / L.R) * 100);
    return "A detailed, busy illustration for a jigsaw puzzle, aspect ratio " + ratio + ":1. " +
        (M.styleText.trim() || "Colourful storybook style with lots of little characters.") +
        " A wide, plain road (or a path, a river or a strip of meadow) runs across the whole picture" +
        (M.roadShape === "slant" ? ", sloping gently down from left to right," : M.roadShape === "wavy" ? ", gently winding," : "") +
        " about " + at + "% of the way down, with a short side road crossing it. Keep the road itself plain and even, with nothing on it.";
}

// ------------------------------------------------------------------ AI (OpenAI image API, the user's own key)
function apiKey() { try { return localStorage.getItem("jw-openai-key") || ""; } catch (e) { return ""; } }

function toBlob(canvas) { return new Promise((resolve) => canvas.toBlob(resolve, "image/png")); }

// fit a canvas into one of the API's sizes, keeping its aspect; returns the canvas and where it sits
function fitApi(src, sizesIn) {
    const sizes = sizesIn || [[1024, 1024], [1536, 1024], [1024, 1536]];
    const ar = src.width / src.height;
    const [w, h] = sizes.reduce((b, s) => (Math.abs(Math.log(s[0] / s[1] / ar)) < Math.abs(Math.log(b[0] / b[1] / ar)) ? s : b));
    const s = Math.min(w / src.width, h / src.height);
    const box = { x: (w - src.width * s) / 2, y: (h - src.height * s) / 2, w: src.width * s, h: src.height * s };
    const c = canvasOf(w, h);
    c.getContext("2d").drawImage(src, box.x, box.y, box.w, box.h);
    return { canvas: c, box: box, size: w + "x" + h };
}

async function aiFetch(path, body, json) {
    const headers = { Authorization: "Bearer " + apiKey() };
    if (json) headers["Content-Type"] = "application/json";
    let res;
    try {
        res = await fetch("https://api.openai.com/v1/images/" + path, { method: "POST", headers: headers, body: json ? JSON.stringify(body) : body });
    } catch (e) {
        throw new Error("Couldn't reach OpenAI. Check your internet connection.");
    }
    const j = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error((j.error && j.error.message) || "OpenAI answered " + res.status + ".");
        err.status = res.status;
        throw err;
    }
    const d = j.data && j.data[0];
    if (d && d.b64_json) return loadImage("data:image/png;base64," + d.b64_json);
    throw new Error("OpenAI didn't return a picture.");
}

// gpt-image-1 needs a verified OpenAI organisation; without one, fall back to the DALL·E models
function needsFallback(e) {
    return e && (e.status === 403 || e.status === 404 || /verif|not have access|does not exist|model/i.test(e.message));
}

async function aiEdit(imageCanvas, prompt) {
    if (window.MAGIC_FAKE_AI) {
        const f = new FormData(); f.append("image", await toBlob(imageCanvas)); f.append("prompt", prompt);
        return window.MAGIC_FAKE_AI("edits", f, imageCanvas);
    }
    const fit = fitApi(imageCanvas);
    const form = new FormData();
    form.append("model", "gpt-image-1");
    form.append("prompt", prompt);
    form.append("size", fit.size);
    form.append("image", await toBlob(fit.canvas), "open.png");
    let img, used = fit;
    try {
        img = await aiFetch("edits", form);
    } catch (e) {
        if (!needsFallback(e)) throw e;
        // DALL·E 2: square only, prompt up to 1000 characters
        const sq = fitApi(imageCanvas, [[1024, 1024]]);
        const f2 = new FormData();
        f2.append("model", "dall-e-2");
        f2.append("prompt", prompt.slice(0, 990));
        f2.append("size", "1024x1024");
        f2.append("response_format", "b64_json");
        f2.append("image", await toBlob(sq.canvas), "open.png");
        img = await aiFetch("edits", f2);
        used = sq;
        aiNote("Used DALL·E 2, because gpt-image-1 isn't available on this OpenAI account (it needs a verified organisation).");
    }
    // back to the size of the picture we sent
    const back = canvasOf(imageCanvas.width, imageCanvas.height);
    const sx = img.width / used.canvas.width, sy = img.height / used.canvas.height;
    back.getContext("2d").drawImage(img, used.box.x * sx, used.box.y * sy, used.box.w * sx, used.box.h * sy, 0, 0, back.width, back.height);
    return back;
}

async function aiGenerate(prompt) {
    if (window.MAGIC_FAKE_AI) return window.MAGIC_FAKE_AI("generations", new FormData());
    const wide = M.W / M.H > 1.2, tall = M.W / M.H < 0.8;
    try {
        return await aiFetch("generations", { model: "gpt-image-1", prompt: prompt, size: wide ? "1536x1024" : tall ? "1024x1536" : "1024x1024" }, true);
    } catch (e) {
        if (!needsFallback(e)) throw e;
        aiNote("Used DALL·E 3, because gpt-image-1 isn't available on this OpenAI account (it needs a verified organisation).");
        return aiFetch("generations", { model: "dall-e-3", prompt: prompt.slice(0, 3900), size: wide ? "1792x1024" : tall ? "1024x1792" : "1024x1024", response_format: "b64_json" }, true);
    }
}

function aiNote(text) { const el = $("aiNote"); if (el) { el.textContent = text; el.hidden = false; } }

async function aiSecret() {
    const comp = compositeAt(2, null);                  // the hole transparent = to be painted
    fitSecret(await aiEdit(comp, secretPrompt()), true);
}

// Let the AI paint a real road where the road goes, so the seams disappear into it.
function roadPrompt() {
    return "This is an illustration with empty (transparent) areas: a band across the picture and a short crossing band. " +
        "Paint the empty areas as a plain, even, empty road (for example smooth cobblestones, a dirt path or a meadow path) " +
        "that fits naturally into the scene, in exactly the same art style, colours and lighting. Nothing may stand on the road. " +
        "Keep everything outside the empty areas unchanged.";
}
async function aiRoad() {
    const L = layout(), k = PIC.pxPerMm;
    const c = canvasOf(PIC.orig.width, PIC.orig.height), cx = c.getContext("2d");
    cx.drawImage(PIC.orig, 0, 0);
    const Y = (r) => Math.round(r * L.ch * k), X = (col) => Math.round(col * L.cw * k);
    for (let col = 0; col < L.C; col++) {
        cx.clearRect(X(col), Y(L.sAt(col) - 0.5 * L.b), X(col + 1) - X(col), Y(L.b));
        if (col >= L.K0 && col < L.K1) cx.clearRect(X(col), Y(L.qTop(col)), X(col + 1) - X(col), Y((L.n - 1) * L.b));
    }
    const out = await aiEdit(c, roadPrompt());
    // keep this layout: the road was painted for it
    M.k = L.k; M.road = L.s / L.R; M.roadStyle = "picture";
    PIC.orig = out;
    rebuildPictures();
}

async function aiMain() {
    await setMainPicture(await aiGenerate(mainPrompt()));
}

// ------------------------------------------------------------------ preview
let lastLayoutKey = "";
function render(animate) {
    const { L, board, secret } = buildModel();
    const stage = $("stage");
    const pad = 8, waitGap = 14;
    const hb = holeBox(L), holeW = hb.w, holeH = hb.h;
    const viewH = M.showOpen ? L.OH : M.H + waitGap + holeH;
    stage.setAttribute("viewBox", [-pad, -pad, M.W + 2 * pad, viewH + 2 * pad].join(" "));
    const stageNow = M.showOpen ? 3 : 0;
    const nSec = sectionCount(L);
    let defs = "", body = "";
    for (let i = 0; i < nSec; i++) {
        defs += '<clipPath id="clip' + i + '">' + sectionRects(L, i).map((q) => '<rect x="' + q.x + '" y="' + q.y + '" width="' + q.w + '" height="' + q.h + '"/>').join("") + "</clipPath>";
    }
    defs += '<clipPath id="clipS">' + holeRects(L).map((q) => '<rect x="' + q.x + '" y="' + q.y + '" width="' + q.w + '" height="' + q.h + '"/>').join("") + "</clipPath>";
    const edgesFor = (model, i) => model.edges.filter((e) => e.secs.indexOf(i) >= 0);
    const tint = ["#d8b98f", "#b58f63", "#e7a978", "#9fb5a0", "#c9a3c4", "#a9bfd6", "#e2c46e", "#c4b39a"];
    // sections
    for (let i = 0; i < nSec; i++) {
        const off = offsetOf(L, i, stageNow);
        // opening: B first, then the road tiles one by one; closing: all together
        const delay = !M.showOpen ? 0 : i === 1 ? 0 : i >= 2 ? 0.8 + (i - 2) * 0.35 : 0;
        let g = '<g class="region sec' + i + '" style="transform: translate(' + off.x + "px," + off.y + "px); transition-delay:" + delay + 's">';
        g += '<g clip-path="url(#clip' + i + ')">' + (PIC.mainUrl ?
            '<image href="' + PIC.mainUrl + '" width="' + M.W + '" height="' + M.H + '" preserveAspectRatio="none"/>' :
            '<rect class="blank" width="' + M.W + '" height="' + M.H + '" style="fill:' + tint[i % tint.length] + '"/>') + "</g>";
        const es = edgesFor(board, i);
        if (M.showCuts) g += '<g class="cuts">' + es.filter((e) => e.kind === "knob").map((e) => '<path d="' + edgeD(e) + '"/>').join("") + "</g>";
        g += '<g class="secline">' + es.filter((e) => e.kind !== "knob").map((e) => '<path d="' + edgeD(e) + '"/>').join("") + "</g>";
        if (M.showSections) {
            const cc = sectionCentre(L, i), small = i >= 2;
            g += '<text class="tag' + (small ? " small" : "") + '" x="' + cc.x + '" y="' + cc.y + '">' + sectionLetter(i) + "</text>";
        }
        body += g + "</g>";
    }
    // the secret pieces: waiting below the puzzle while it's closed, in the hole when it's open
    {
        const off = M.showOpen ? { x: 0, y: 0 } : { x: 0, y: M.H + waitGap - hb.y };
        const delay = M.showOpen ? 0.8 + (L.n - 1) * 0.35 + 0.3 : 0;
        let g = '<g class="region secret' + (M.showOpen ? "" : " waiting") + '" style="transform: translate(' + off.x + "px," + off.y + "px); transition-delay:" + delay + 's">';
        g += '<g clip-path="url(#clipS)">' + (PIC.secretUrl ?
            '<image href="' + PIC.secretUrl + '" x="' + (hb.x - L.bleed) + '" y="' + (hb.y - L.bleed) + '" width="' + (holeW + 2 * L.bleed) + '" height="' + (holeH + 2 * L.bleed) + '" preserveAspectRatio="none"/>' :
            '<rect class="blank secretblank" x="' + hb.x + '" y="' + hb.y + '" width="' + holeW + '" height="' + holeH + '"/>') + "</g>";
        if (M.showCuts) g += '<g class="cuts">' + secret.edges.filter((e) => e.kind === "knob").map((e) => '<path d="' + edgeD(e) + '"/>').join("") + "</g>";
        g += '<g class="secline">' + secret.edges.filter((e) => e.secs.length === 1).map((e) => '<path d="' + edgeD(e) + '"/>').join("") + "</g>";
        g += '<text class="tag star" x="' + (hb.x + holeW / 2) + '" y="' + (L.qTop(L.K0 + (L.cpc >> 1)) + L.n * L.b / 2) * L.ch + '">★</text>';
        body += g + "</g>";
    }
    // where the hole will be, and the outline of the opened puzzle
    stage.innerHTML = "<defs>" + defs + "</defs>" + body;
    stage.classList.toggle("nopic", !PIC.mainUrl);
    stage.classList.toggle("open", M.showOpen);

    const pieces = board.pieces;
    $("stat-size").textContent = Math.round(M.W) + " × " + Math.round(M.H) + " mm → opened " + Math.round(M.W) + " × " + Math.round(L.OH) + " mm";
    $("stat-pieces").textContent = pieces + " pieces + " + secret.pieces + " in the secret bag";
    $("download").disabled = false;
    $("printBtn").disabled = !PIC.main;
    $("sheetBtn").disabled = false;
    renderSteps(L);
    updateLayoutUI(L);
    updatePictureUI();
    // the secret picture was painted for a hole of another size or place
    const key = [L.n, L.b, L.k, L.s, L.cpc, L.R, M.W, M.H].join(",");
    if (lastLayoutKey && key !== lastLayoutKey && PIC.secret) $("secretStale").hidden = false;
    lastLayoutKey = key;
    scheduleSave();
}

function setOpen(open) {
    M.showOpen = open;
    document.querySelectorAll("#viewSeg button").forEach((b) => b.setAttribute("aria-pressed", (b.dataset.v === "open") === open));
    render();
}

// ------------------------------------------------------------------ the steps, in words
function stepTexts(L) {
    const tiles = [];
    for (let t = 0; t < L.n - 1; t++) tiles.push(sectionLetter(2 + t));
    const rows = L.b === 1 ? "one row" : L.b + " rows";
    return [
        "Finish the puzzle. It's in sections: A above the road, B below it, and " + tiles.join(", ") + " on the crossroads.",
        "Slide section B (everything below the road) down by " + rows + " of pieces. A gap opens along the road.",
        "Lift " + tiles.join(", ") + " off the crossroads and lay them into the gap, left to right, in that order.",
        "A hole has appeared where the crossroads was! Open the secret bag ★ and fill it.",
    ];
}

function renderSteps(L) {
    $("howSteps").innerHTML = stepTexts(L).map((t) => "<li>" + t + "</li>").join("");
}

// ------------------------------------------------------------------ export
// cut file: the closed puzzle, and the secret pieces beside it
function secretOrigin(L) { const hb = holeBox(L); return { x: M.W + 10 + L.bleed - hb.x, y: L.bleed - hb.y }; }

function cutPaths() {
    const { L, board, secret } = MODEL || buildModel();
    const out = ["M 0 0 H " + M.W + " V " + M.H + " H 0 Z"];
    board.edges.forEach((e) => { if (e.secs.length === 2) out.push(edgeD(e)); });
    const o = secretOrigin(L);
    secret.edges.forEach((e) => out.push(edgeD(e, o.x, o.y)));
    return { paths: out, W: M.W + 10 + holeBox(L).w + 2 * L.bleed, H: Math.max(M.H, holeBox(L).h + 2 * L.bleed) };
}

function cutSvg() {
    const c = cutPaths();
    return '<svg viewBox="0 0 ' + c.W.toFixed(3) + " " + c.H.toFixed(3) + '" width="' + c.W.toFixed(3) + 'mm" height="' + c.H.toFixed(3) + 'mm" version="1.1" xmlns="http://www.w3.org/2000/svg">' +
        c.paths.map((d) => '<path fill="none" stroke="black" stroke-width="0.1" d="' + d + '"/>').join("") + "</svg>";
}

function download(fmt) {
    window.svgstrsave = cutSvg();
    const base = "magic-puzzle-" + Math.round(M.W) + "x" + Math.round(M.H) + "mm";
    if (fmt === "pdf") saveBlob(base + ".pdf", buildPdf(), "application/pdf");
    else if (fmt === "dxf") saveBlob(base + ".dxf", buildDxf(), "application/dxf");
    else saveBlob(base + ".svg", '<?xml version="1.0" encoding="UTF-8"?>\n' + svgstrsave, "image/svg+xml");
}

// pictures to print on the wood before cutting, laid out exactly like the cut file
function printCanvas() {
    const L = layout(), k = PIC.pxPerMm, cp = cutPaths();
    const c = canvasOf(cp.W * k, cp.H * k), cx = c.getContext("2d");
    cx.fillStyle = "#fff"; cx.fillRect(0, 0, c.width, c.height);
    cx.drawImage(PIC.main, 0, 0);
    if (PIC.secret) cx.drawImage(PIC.secret, (M.W + 10) * k, 0);
    return c;
}
function downloadPrint() {
    printCanvas().toBlob((b) => saveBlob("magic-puzzle-print-" + Math.round(PIC.pxPerMm * 25.4) + "dpi.png", b, "image/png"), "image/png");
}

function downloadTemplate() {
    compositeAt(2, "#808080").toBlob((b) => saveBlob("magic-puzzle-secret-template.png", b, "image/png"), "image/png");
}

// the instruction sheet: four panels, like the ones in the box
function sheetCanvas() {
    const L = layout();
    const PW = 900, mmk = (PW - 80) / M.W, PH = Math.round(L.OH * mmk + 190);
    const c = canvasOf(PW * 2, PH * 2 + 120), cx = c.getContext("2d");
    cx.fillStyle = "#fbf8f2"; cx.fillRect(0, 0, c.width, c.height);
    cx.fillStyle = "#2a2320"; cx.font = "700 40px 'Bricolage Grotesque', sans-serif"; cx.textAlign = "center";
    cx.fillText("How to open the magic puzzle", c.width / 2, 72);
    const texts = stepTexts(L);
    const k0 = PIC.pxPerMm;
    for (let p = 0; p < 4; p++) {
        const ox = (p % 2) * PW, oy = 120 + Math.floor(p / 2) * PH;
        cx.strokeStyle = "#cbbfae"; cx.lineWidth = 2; cx.strokeRect(ox + 20, oy + 10, PW - 40, PH - 30);
        // caption
        cx.fillStyle = "#2a2320"; cx.font = "600 24px 'Instrument Sans', sans-serif"; cx.textAlign = "left";
        wrapText(cx, (p + 1) + ". " + texts[p], ox + 40, oy + 50, PW - 80, 30);
        const px = ox + 40, py = oy + 140;
        const stage = p === 0 ? 0 : p === 1 ? 1 : p === 2 ? 2 : 3;
        // picture
        if (PIC.main) {
            const comp = compositeAt(stage, stage === 2 ? "#2a2320" : null);
            cx.drawImage(comp, px, py, comp.width / k0 * mmk, comp.height / k0 * mmk);
        }
        // section outlines and letters
        cx.lineWidth = 3; cx.strokeStyle = "#7a2e8f";
        for (let i = 0; i < sectionCount(L); i++) {
            const off = offsetOf(L, i, Math.min(stage, 2));
            if (!PIC.main) { cx.fillStyle = ["#d8b98f", "#b58f63", "#e7a978", "#9fb5a0", "#c9a3c4", "#a9bfd6", "#e2c46e"][i % 7]; }
            for (const q of sectionRects(L, i)) {
                if (!PIC.main) cx.fillRect(px + (q.x + off.x) * mmk, py + (q.y + off.y) * mmk, q.w * mmk, q.h * mmk);
            }
            outlineSection(cx, L, i, px + off.x * mmk, py + off.y * mmk, mmk);
            const cc = sectionCentre(L, i);
            cx.font = (i >= 2 ? "700 26px" : "700 44px") + " 'Bricolage Grotesque', sans-serif"; cx.textAlign = "center"; cx.textBaseline = "middle";
            cx.lineWidth = 6; cx.strokeStyle = "rgba(255,255,255,.9)";
            cx.strokeText(sectionLetter(i), px + (cc.x + off.x) * mmk, py + (cc.y + off.y) * mmk);
            cx.fillStyle = "#7a2e8f"; cx.fillText(sectionLetter(i), px + (cc.x + off.x) * mmk, py + (cc.y + off.y) * mmk);
            cx.lineWidth = 3; cx.strokeStyle = "#7a2e8f"; cx.textBaseline = "alphabetic";
        }
        // arrows
        cx.strokeStyle = "#1f8fbf"; cx.fillStyle = "#1f8fbf"; cx.lineWidth = 5;
        if (p === 1) { const bc = sectionCentre(L, 1); arrow(cx, px + bc.x * mmk, py + (bc.y + L.ch * 0.6) * mmk, px + bc.x * mmk, py + (bc.y + L.ch * (0.6 + L.b * 1.2)) * mmk); }
        if (p === 2) for (let t = 0; t < L.n - 1; t++) {
            const from = sectionCentre(L, 2 + t), o = offsetOf(L, 2 + t, 2), to = { x: from.x + o.x, y: from.y + o.y };
            const dir = Math.sign(to.x - from.x), gap = L.cpc * L.cw * 0.28;
            arrow(cx, px + (from.x + dir * gap) * mmk, py + (from.y - L.ch * 0.15) * mmk, px + (to.x - dir * gap) * mmk, py + (to.y - L.ch * 0.15) * mmk, true);
        }
        if (p === 3) {
            cx.font = "700 60px 'Bricolage Grotesque', sans-serif"; cx.textAlign = "center"; cx.textBaseline = "middle";
            cx.fillStyle = "#f2c230"; cx.strokeStyle = "#2a2320"; cx.lineWidth = 4;
            const sx = px + (L.K0 + L.cpc / 2) * L.cw * mmk, sy = py + (L.qTop(L.K0 + (L.cpc >> 1)) + L.n * L.b / 2) * L.ch * mmk;
            if (!PIC.secret) { cx.strokeText("★", sx, sy); cx.fillText("★", sx, sy); }
            cx.textBaseline = "alphabetic";
        }
    }
    return c;
}

function wrapText(cx, text, x, y, maxW, lh) {
    const words = text.split(" ");
    let line = "";
    for (const w of words) {
        const t = line ? line + " " + w : w;
        if (cx.measureText(t).width > maxW && line) { cx.fillText(line, x, y); line = w; y += lh; }
        else line = t;
    }
    cx.fillText(line, x, y);
}

function arrow(cx, x1, y1, x2, y2, curved) {
    cx.beginPath(); cx.moveTo(x1, y1);
    let ax = x1, ay = y1;
    if (curved) { const mx = (x1 + x2) / 2, my = Math.min(y1, y2) - 30 - Math.abs(x2 - x1) * 0.12; cx.quadraticCurveTo(mx, my, x2, y2); ax = mx; ay = my; }
    else cx.lineTo(x2, y2);
    cx.stroke();
    const a = Math.atan2(y2 - ay, x2 - ax), s = 16;
    cx.beginPath(); cx.moveTo(x2, y2);
    cx.lineTo(x2 - s * Math.cos(a - 0.45), y2 - s * Math.sin(a - 0.45));
    cx.lineTo(x2 - s * Math.cos(a + 0.45), y2 - s * Math.sin(a + 0.45));
    cx.closePath(); cx.fill();
}

// trace the boundary of a section's cells (lattice edges with the section on one side only)
function outlineSection(cx, L, i, ox, oy, s) {
    cx.beginPath();
    for (let r = 0; r <= L.R; r++) for (let c = 0; c < L.C; c++) {
        const a = r > 0 ? sectionOf(L, c, r - 1) === i : false, b = r < L.R ? sectionOf(L, c, r) === i : false;
        if (a !== b) { cx.moveTo(ox + c * L.cw * s, oy + r * L.ch * s); cx.lineTo(ox + (c + 1) * L.cw * s, oy + r * L.ch * s); }
    }
    for (let c = 0; c <= L.C; c++) for (let r = 0; r < L.R; r++) {
        const a = c > 0 ? sectionOf(L, c - 1, r) === i : false, b = c < L.C ? sectionOf(L, c, r) === i : false;
        if (a !== b) { cx.moveTo(ox + c * L.cw * s, oy + r * L.ch * s); cx.lineTo(ox + c * L.cw * s, oy + (r + 1) * L.ch * s); }
    }
    cx.stroke();
}

function downloadSheet() {
    sheetCanvas().toBlob((b) => saveBlob("magic-puzzle-instructions.png", b, "image/png"), "image/png");
}

// ------------------------------------------------------------------ saving in this browser
const SAVE_KEYS = ["W", "H", "n", "bandRows", "roadShape", "k", "road", "roadStyle", "piece", "knob", "seed", "secretText", "styleText", "showCuts", "showSections"];
let saveTimer = null;
function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        try {
            const s = { v: 3 };
            SAVE_KEYS.forEach((k) => { s[k] = M[k]; });
            localStorage.setItem("jw-magic-settings", JSON.stringify(s));
        } catch (e) { /* storage blocked */ }
    }, 500);
}
function loadSaved() {
    try {
        const s = JSON.parse(localStorage.getItem("jw-magic-settings") || "null");
        if (!s) return;
        ["W", "H", "knob", "seed", "secretText", "styleText", "showCuts"].forEach((k) => { if (s[k] !== undefined) M[k] = s[k]; });
        if (s.v === 3) SAVE_KEYS.forEach((k) => { if (s[k] !== undefined) M[k] = s[k]; });
        M.n = clamp(M.n, 3, 6);
    } catch (e) { /* ignore */ }
}

// ------------------------------------------------------------------ UI
function busy(on, text) {
    $("busy").hidden = !on;
    if (text) $("busy").textContent = text;
}
function warn(msg) { $("warnings").innerHTML = msg ? '<p class="warn">' + msg.replace(/</g, "&lt;") + "</p>" : ""; }

function updatePictureUI() {
    $("secretBox").hidden = !PIC.main;
    $("mainDone").hidden = !PIC.main;
    $("hasKey").textContent = apiKey() ? "Key saved in this browser" : "No key yet";
    $("aiMain").disabled = !apiKey();
    $("aiSecret").disabled = !apiKey() || !PIC.main;
    $("aiRoad").disabled = !apiKey() || !PIC.main;
    document.querySelectorAll("#roadSeg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === M.roadStyle));
    $("secretDone").hidden = !PIC.secret;
}

function updateLayoutUI(L) {
    const road = $("mRoad");
    road.min = L.sMin; road.max = L.sMax; road.value = L.s;
    $("mRoadOut").textContent = M.road == null ? (PIC.auto ? "Auto" : "Row " + L.s) : "Row " + L.s;
    const sel = $("mK");
    const want = (M.k == null ? "auto" : String(L.k));
    let html = '<option value="auto">Auto' + (PIC.auto ? " (column " + (L.k + 1) + ")" : "") + "</option>";
    for (let j = 1; j <= L.n - 2; j++) html += '<option value="' + j + '">Column ' + (j + 1) + " of " + L.n + "</option>";
    sel.innerHTML = html; sel.value = want;
    document.querySelectorAll("#shapeSeg button").forEach((b) => {
        b.setAttribute("aria-pressed", b.dataset.v === M.roadShape);
        b.disabled = false;
    });
    $("shapeNote").hidden = !(M.roadShape !== "straight" && L.g === 0);
    $("holeOut").textContent = Math.round(L.cpc * L.cw) + " × " + Math.round(L.n * L.b * L.ch) + " mm";
    $("mB").value = L.b;
}

function syncInputs() {
    $("mW").value = M.W; $("mH").value = M.H; $("mN").value = M.n; $("mB").value = M.bandRows;
    $("mPiece").value = M.piece; $("mPieceOut").textContent = M.piece + " mm";
    $("secretText").value = M.secretText; $("styleText").value = M.styleText;
    $("showCuts").checked = M.showCuts; $("showSections").checked = M.showSections;
}

function relayout() {
    rebuildPictures();
    render();
}

function init() {
    loadSaved();
    syncInputs();
    const num = (id, key, min, max) => $(id).addEventListener("input", () => {
        const v = parseFloat($(id).value);
        if (v >= min && v <= max) {
            M[key] = v;
            if (PIC.mainImg) { const sec = PIC.secretSrc, fo = PIC.secretFromOpen; setMainPicture(PIC.mainImg); if (sec) fitSecret(sec, fo); }
            relayout();
        }
    });
    num("mW", "W", 100, 2000);
    num("mH", "H", 100, 2000);
    $("mN").addEventListener("change", () => { M.n = parseInt($("mN").value); M.k = null; chooseRoad(); relayout(); });
    $("mB").addEventListener("change", () => { M.bandRows = parseInt($("mB").value); chooseRoad(); relayout(); });
    $("mK").addEventListener("change", () => { const v = $("mK").value; M.k = v === "auto" ? null : parseInt(v); relayout(); });
    $("mRoad").addEventListener("input", () => { const L = layout(); M.road = parseInt($("mRoad").value) / L.R; relayout(); });
    document.querySelectorAll("#shapeSeg button").forEach((b) => b.addEventListener("click", () => { M.roadShape = b.dataset.v; M.road = null; chooseRoad(); relayout(); }));
    $("roadAuto").addEventListener("click", () => { M.road = null; M.k = null; relayout(); });
    $("mPiece").addEventListener("input", () => { M.piece = +$("mPiece").value; $("mPieceOut").textContent = M.piece + " mm"; chooseRoad(); relayout(); });
    document.querySelectorAll("#roadSeg button").forEach((b) => b.addEventListener("click", () => { M.roadStyle = b.dataset.v; relayout(); }));
    $("aiRoad").addEventListener("click", async () => {
        busy(true, "Painting the road… (this can take a minute)");
        try { await aiRoad(); warn(""); render(); }
        catch (err) { warn("The image service failed: " + err.message); }
        busy(false);
    });
    $("variant").addEventListener("click", () => { M.seed = Math.floor(Math.random() * 9999); render(); });
    $("showCuts").addEventListener("change", (e) => { M.showCuts = e.target.checked; render(); });
    $("showSections").addEventListener("change", (e) => { M.showSections = e.target.checked; render(); });
    document.querySelectorAll("#viewSeg button").forEach((b) => b.addEventListener("click", () => setOpen(b.dataset.v === "open")));
    $("secretText").addEventListener("input", (e) => { M.secretText = e.target.value; scheduleSave(); });
    $("styleText").addEventListener("input", (e) => { M.styleText = e.target.value; scheduleSave(); });

    $("mainFile").addEventListener("change", async (e) => {
        const f = e.target.files[0]; e.target.value = "";
        if (!f) return;
        try {
            const img = await loadImage(URL.createObjectURL(f));
            M.road = null; M.k = null;
            await setMainPicture(img);
            warn(""); lastLayoutKey = ""; render();
        } catch (err) { warn(err.message); }
    });
    $("secretFile").addEventListener("change", async (e) => {
        const f = e.target.files[0]; e.target.value = "";
        if (!f) return;
        try {
            const img = await loadImage(URL.createObjectURL(f));
            // a whole opened picture (from the template) or just the secret area
            const L = layout(), ar = img.naturalWidth / img.naturalHeight;
            const openAr = M.W / L.OH, holeAr = (L.cpc * L.cw) / (L.n * L.b * L.ch);
            fitSecret(img, Math.abs(Math.log(ar / openAr)) < Math.abs(Math.log(ar / holeAr)));
            $("secretStale").hidden = true;
            warn(""); setOpen(true);
        } catch (err) { warn(err.message); }
    });
    $("templateBtn").addEventListener("click", downloadTemplate);
    $("copyPrompt").addEventListener("click", async () => {
        const t = secretPrompt();
        try { await navigator.clipboard.writeText(t); $("copyPrompt").textContent = "Copied"; setTimeout(() => { $("copyPrompt").textContent = "Copy prompt"; }, 1500); }
        catch (e) { $("promptText").hidden = false; $("promptText").value = t; $("promptText").select(); }
    });
    $("copyMainPrompt").addEventListener("click", async () => {
        const t = mainPrompt();
        try { await navigator.clipboard.writeText(t); $("copyMainPrompt").textContent = "Copied"; setTimeout(() => { $("copyMainPrompt").textContent = "Copy a prompt for it"; }, 1500); }
        catch (e) { $("mainPromptText").hidden = false; $("mainPromptText").value = t; $("mainPromptText").select(); }
    });
    $("saveKey").addEventListener("click", () => {
        try { localStorage.setItem("jw-openai-key", $("apiKey").value.trim()); } catch (e) { /* storage blocked */ }
        $("apiKey").value = ""; updatePictureUI();
    });
    $("forgetKey").addEventListener("click", () => { try { localStorage.removeItem("jw-openai-key"); } catch (e) { /* */ } updatePictureUI(); });
    $("aiSecret").addEventListener("click", async () => {
        busy(true, "Painting the secret area… (this can take a minute)");
        try { await aiSecret(); $("secretStale").hidden = true; warn(""); setOpen(true); }
        catch (err) { warn("The image service failed: " + err.message); }
        busy(false);
    });
    $("aiMain").addEventListener("click", async () => {
        busy(true, "Painting the picture… (this can take a minute)");
        try { M.road = null; M.k = null; await aiMain(); warn(""); lastLayoutKey = ""; render(); }
        catch (err) { warn("The image service failed: " + err.message); }
        busy(false);
    });
    let fmt = "svg";
    document.querySelectorAll("#formatSeg button").forEach((b) => b.addEventListener("click", () => {
        fmt = b.dataset.v;
        document.querySelectorAll("#formatSeg button").forEach((x) => x.setAttribute("aria-pressed", x === b));
        $("download").textContent = "Download " + fmt.toUpperCase() + " for laser";
    }));
    $("download").addEventListener("click", () => download(fmt));
    $("printBtn").addEventListener("click", downloadPrint);
    $("sheetBtn").addEventListener("click", downloadSheet);
    render();
}

window.addEventListener("load", init);
