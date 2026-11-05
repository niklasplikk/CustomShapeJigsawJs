// Jigsaw Workshop — Magic puzzle (shift and reveal).
//
// How the trick works (the same idea as the Magic Puzzle Company puzzles):
//  - The finished puzzle is a jigsaw with a road running across it, usually on a slant, so the sections
//    have long straight, slanted edges; the pieces along a seam are cut straight, like edge pieces. In one
//    place a short side road crosses it: a stack of slanted strips.
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
    n: 3,                       // the width is cut into n parts: B is n - 1 of them, C one; the hole is one part wide
    bandRows: 2,                // how many rows B and C drop when they move
    drop: null,                 // or the drop in mm, fitted to the picture
    slope: null,                // or the slant of A's edge in mm per part, fitted to the picture
    roadShape: "slant",         // straight | slant | wavy
    k: null,                    // hole column (null = choose from the picture)
    road: null,                 // road height at the hole, as a fraction of the height (null = from the picture)
    piece: 25,                  // mm
    knob: 13,                   // % of piece size
    seed: Math.floor(Math.random() * 9999),
    roadStyle: "outline",       // outline | road | none: how the seam under A is drawn into the picture
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

// Three sections, like the box: A on top, B bottom left, C bottom right. Everything is in mm, y down.
// The width is cut into n parts, each c wide. B is n - 1 parts wide, C one part.
// The road under A has the same shape in every part (g), but each part sits at its own height:
//   part 0 at g, part 1 (n - 1)·d higher, and every part after that d lower than the one before.
// Then, when C moves left by (n - 1) parts and B right by one part, both one slide (d) lower, they fit
// under A again, and in part 1 a hole opens: c wide and n·d high. The puzzle grows by d.
function layout() {
    const n = clamp(M.n, 3, 5), b = clamp(M.bandRows, 1, 3);
    const cpc = Math.max(2, Math.round(M.W / n / M.piece));
    const C = n * cpc, P = M.W / n, cw = P / cpc;
    const R = Math.max(3, Math.round(M.H / M.piece)), ch = M.H / R;
    const d = M.drop != null ? clamp(M.drop, 0.4 * ch, 3 * ch) : b * ch;
    const mrg = 0.8 * ch;
    const room = M.H - 2 * mrg - (n - 1) * d;
    let g = M.roadShape === "slant" ? Math.min(P * 0.55, room - 0.3 * ch) : M.roadShape === "wavy" ? Math.min(P * 0.25, room - 0.3 * ch, ch) : 0;
    if (M.slope != null && M.roadShape !== "wavy") g = Math.min(M.slope, room);
    g = Math.max(0, g);
    const peak = Math.max(1, Math.round(cpc / 2)) * cw;      // zigzag turns on a column line
    const gU = (u) => M.roadShape === "slant" ? (g * u) / P :
        M.roadShape === "wavy" ? (u <= peak ? (g * u) / peak : (g * (P - u)) / (P - peak)) : 0;
    const off = (j) => (j === 0 ? 0 : (n - j) * d);           // how much higher each part's road is
    const sMin = mrg + (n - 1) * d, sMax = M.H - mrg - g;
    let s0 = M.road != null ? M.road * M.H : PIC.auto ? PIC.auto.s : (sMin + sMax) / 2 + 0.15 * (sMax - sMin);
    s0 = sMax >= sMin ? clamp(s0, sMin, sMax) : (sMin + sMax) / 2;
    // the part a point belongs to; at a part edge, side -1 means the part on the left
    const partOf = (x, side) => clamp(side < 0 ? Math.ceil(x / P - 1e-9) - 1 : Math.floor(x / P + 1e-9), 0, n - 1);
    const road = (x, side) => { const j = partOf(x, side || 1); return s0 + gU(x - j * P) - off(j); };   // A's bottom edge
    const base = (x) => s0 + gU(x - partOf(x, 1) * P);         // the road shape at part-0 height
    return {
        n, b, cpc, C, R, cw, ch, P, d, g, s: s0, sMin, sMax, road, base, partOf,
        bx1: (n - 1) * P,                     // where B ends and C starts
        hx0: P, hx1: 2 * P,                   // the hole, opened
        OH: M.H + d,                          // opened height
        bleed: 0.4 * Math.min(cw, ch),        // picture margin around the secret pieces, for the knobs
    };
}

// The regions: each lies over an x range between a top and a bottom line. 0 = A, 1 = B, 2 = C,
// "S" = the hole (opened coordinates).
function regionOf(L, i) {
    if (i === 0) return { x0: 0, x1: M.W, top: () => 0, bot: (x, sd) => L.road(x, sd) };
    if (i === 1) return { x0: 0, x1: L.bx1, top: (x, sd) => L.road(x, sd), bot: () => M.H };
    if (i === 2) return { x0: L.bx1, x1: M.W, top: (x, sd) => L.road(x, sd), bot: () => M.H };
    return { x0: L.hx0, x1: L.hx1, top: (x, sd) => L.road(x, sd), bot: (x, sd) => L.road(x - L.P, sd) + L.d };
}
function regionTop(L, rg, x, side) { return rg.top(clamp(x, rg.x0, rg.x1), x <= rg.x0 ? 1 : x >= rg.x1 ? -1 : side); }
function regionBot(L, rg, x, side) { return rg.bot(clamp(x, rg.x0, rg.x1), x <= rg.x0 ? 1 : x >= rg.x1 ? -1 : side); }

function sectionAt(L, x, y) {
    if (y < L.road(x, 1)) return 0;
    return x < L.bx1 ? 1 : 2;
}
function sectionCount() { return 3; }
function sectionLetter(i) { return LETTERS[i]; }

// the outline of a region as a polygon (lines are straight between column lines)
function regionPolygon(L, i) {
    const rg = regionOf(L, i), xs = [];
    for (let c = 0; c <= L.C; c++) { const x = c * L.cw; if (x >= rg.x0 - 1e-6 && x <= rg.x1 + 1e-6) xs.push(x); }
    const pts = [];
    xs.forEach((x, idx) => { if (idx > 0) pts.push({ x, y: regionTop(L, rg, x, -1) }); if (idx < xs.length - 1) pts.push({ x, y: regionTop(L, rg, x, 1) }); });
    for (let idx = xs.length - 1; idx >= 0; idx--) {
        const x = xs[idx];
        if (idx < xs.length - 1) pts.push({ x, y: regionBot(L, rg, x, 1) });
        if (idx > 0) pts.push({ x, y: regionBot(L, rg, x, -1) });
    }
    return pts;
}
function polyPath(pts, ox, oy, s) {
    return pts.map((p, i) => (i ? "L " : "M ") + ((p.x + (ox || 0)) * (s || 1)).toFixed(3) + " " + ((p.y + (oy || 0)) * (s || 1)).toFixed(3)).join(" ") + " Z";
}

// Where a section is at each stage of opening, as in the box's instructions:
// 0 finished, 1 B slid away, 2 C slid to where B was, 3 B put where C was (the hole is there), 4 secret pieces in.
function awayY(L) { return M.H * 0.42; }
function offsetOf(L, i, stage) {
    if (i === 0 || stage === 0) return { x: 0, y: 0 };
    if (i === 1) return stage <= 2 ? { x: -L.P * 0.15, y: awayY(L) } : { x: L.P, y: L.d };
    return stage >= 2 ? { x: -(L.n - 1) * L.P, y: L.d } : { x: 0, y: 0 };
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

// path for an edge, optionally shifted. kinds:
//  line  - straight
//  knob  - an ordinary jigsaw knob (random shape from e.k)
//  seam  - a seam between sections: straight along the road, with one small tooth per column that points
//          straight down, so sections lift apart and slide, and drop into place in either arrangement
function edgeD(e, ox, oy) {
    const sh = (p) => ({ x: p.x + (ox || 0), y: p.y + (oy || 0) });
    const v1 = sh(e.v1), v2 = sh(e.v2);
    if (e.kind === "line") return "M " + f3(v1) + " L " + f3(v2);
    const L = Math.hypot(v2.x - v1.x, v2.y - v1.y);
    if (e.kind === "seam") {
        const at = (l, w) => ({ x: v1.x + l * (v2.x - v1.x), y: v1.y + l * (v2.y - v1.y) + w });
        const a = 0.2, c = 0.05, h = e.r * 1.1;
        return "M " + [at(0, 0), at(0.5 - a, 0), at(0.5 - a + c, h), at(0.5 + a - c, h), at(0.5 + a, 0), at(1, 0)].map(f3).join(" L ");
    }
    const r = Math.min(e.r, 0.16 * L);
    if (r < 1.5) return "M " + f3(v1) + " L " + f3(v2);
    const k = { t: (r / L) * (1 + e.k.j), m: e.k.m, flip: e.k.flip, a: e.k.a, d: e.k.d, e: e.k.e };
    return "M " + f3(v1) + " " + knobGeometry(v1, v2, k).map((s) => "C " + s.map(f3).join(" ")).join(" ");
}

// Cut regions into pieces. Columns follow the grid; inside a column, a region is cut across only on grid
// rows that are far enough from its top and bottom lines, so pieces along a seam keep one straight side
// (like edge pieces) instead of becoming slivers. regions: list of region ids; label(x, y) names the
// region at a point. Returns the edges, each knowing the regions on its two sides, and the piece count.
function cutRegions(L, ids, label, rnd, outline) {
    const rad = (M.knob / 100) * Math.min(L.cw, L.ch), gap = 0.42 * L.ch;
    const knob = () => { const j = () => (rnd() - 0.5) * 0.08; return { j: j(), m: 0.5 + j(), flip: rnd() > 0.5, a: j(), d: j(), e: j() }; };
    const edges = [];
    const cuts = {};                  // cuts[id][c] = rows (y) where column c of the region is cut across
    let pieces = 0;
    for (const id of ids) {
        const rg = regionOf(L, id);
        cuts[id] = {};
        for (let c = 0; c < L.C; c++) {
            const xa = c * L.cw, xb = (c + 1) * L.cw;
            if (xa < rg.x0 - 1e-6 || xb > rg.x1 + 1e-6) continue;
            const tA = regionTop(L, rg, xa, 1), tB = regionTop(L, rg, xb, -1), bA = regionBot(L, rg, xa, 1), bB = regionBot(L, rg, xb, -1);
            const ys = [];
            for (let r = 1; r < L.R + 2; r++) {
                const y = r * L.ch;
                if (y - Math.max(tA, tB) >= gap && Math.min(bA, bB) - y >= gap) ys.push(y);
            }
            cuts[id][c] = ys;
            pieces += ys.length + 1;
            ys.forEach((y) => edges.push({ v1: { x: xa, y }, v2: { x: xb, y }, kind: "knob", k: knob(), r: rad, secs: [id] }));
            // the region's top line in this column: a seam if another region is above, else the outline
            const above = label(xa + L.cw / 2, (tA + tB) / 2 - 0.01);
            const below = label(xa + L.cw / 2, (bA + bB) / 2 + 0.01);
            if (above === null) edges.push({ v1: { x: xa, y: tA }, v2: { x: xb, y: tB }, kind: outline.hSeam ? "seam" : "line", r: rad, secs: [id], outline: true });
            else if (above !== id) edges.push({ v1: { x: xa, y: tA }, v2: { x: xb, y: tB }, kind: "seam", r: rad, secs: [above, id] });
            if (below === null) edges.push({ v1: { x: xa, y: bA }, v2: { x: xb, y: bB }, kind: outline.hSeam ? "seam" : "line", r: rad, secs: [id], outline: true });
        }
    }
    // column lines: walk down each one, cutting it into runs with the same region on both sides
    const step = 0.05;
    for (let c = 0; c <= L.C; c++) {
        const x = c * L.cw;
        let y = 0, cur = null, start = 0;
        // run ends land exactly on a region line
        const cand = [0, M.H, L.OH];
        for (const id of ids) { const rg = regionOf(L, id); if (x >= rg.x0 - 1e-6 && x <= rg.x1 + 1e-6) for (const sd of [-1, 1]) cand.push(regionTop(L, rg, x, sd), regionBot(L, rg, x, sd)); }
        const snap = (v) => { let best = v; for (const c2 of cand) if (Math.abs(c2 - v) < 0.12 && Math.abs(c2 - v) < Math.abs(best - v) + 1e-9) best = c2; return best; };
        const flush = (yEnd0) => {
            const yEnd = snap(yEnd0);
            if (!cur || yEnd - start < 1e-3) return;
            const [lf, rt] = cur;
            if (lf !== null && lf === rt) {
                // inside one region: split at the cuts on either side, a knob on each long enough bit
                const ys = [start, ...(cuts[lf][c - 1] || []), ...(cuts[lf][c] || []), yEnd].filter((v) => v >= start - 1e-6 && v <= yEnd + 1e-6).sort((a, b) => a - b);
                const rg = regionOf(L, lf), kr = Math.min(rad, 0.16 * L.ch), hx = 2.5 * kr, hy = 1.45 * kr;
                // a knob only where its head stays clear of the region's slanted top and bottom lines
                const fits = (ym) => [x - hx, x + hx].every((xx) => xx < rg.x0 || xx > rg.x1 ||
                    (ym - hy >= regionTop(L, rg, xx, xx < x ? -1 : 1) && ym + hy <= regionBot(L, rg, xx, xx < x ? -1 : 1)));
                for (let q = 1; q < ys.length; q++) {
                    const y0 = ys[q - 1], y1 = ys[q];
                    if (y1 - y0 < 1e-3) continue;
                    const kp = knob();
                    let mm = null;
                    if (y1 - y0 >= 0.6 * L.ch) for (const t of [0.5, 0.42, 0.58, 0.35, 0.65]) { if (fits(y0 + t * (y1 - y0))) { mm = t; break; } }
                    if (mm !== null) kp.m = mm + (kp.m - 0.5) * 0.3;
                    edges.push({ v1: { x, y: y0 }, v2: { x, y: y1 }, kind: mm !== null ? "knob" : "line", k: kp, r: rad, secs: [lf] });
                }
            } else if (lf !== null || rt !== null) {
                edges.push({ v1: { x, y: start }, v2: { x, y: yEnd }, kind: "line", r: rad, secs: [lf, rt].filter((v) => v !== null), outline: lf === null || rt === null });
            }
        };
        const yMax = Math.max(M.H, L.OH);
        for (y = 0; y <= yMax + step / 2; y += step) {
            const yy = Math.min(y + step / 2, yMax);
            const lf = c > 0 ? label(x - 1e-4, yy) : null, rt = c < L.C ? label(x + 1e-4, yy) : null;
            if (!cur || cur[0] !== lf || cur[1] !== rt) { flush(y); cur = [lf, rt]; start = snap(y); }
        }
        flush(yMax);
    }
    return { edges, pieces };
}

let MODEL = null;
function buildModel() {
    const L = layout();
    const ids = [0, 1, 2];
    const board = cutRegions(L, ids, (x, y) => (x < 0 || x > M.W || y < 0 || y >= M.H ? null : sectionAt(L, x, y)), mulberry32(M.seed * 31 + 7), {});
    // the secret pieces, in opened coordinates; their top and bottom take the seam teeth
    const S = regionOf(L, "S");
    const secret = cutRegions(L, ["S"], (x, y) => (x > L.hx0 && x < L.hx1 && y >= S.top(x, 1) && y < S.bot(x, 1) ? "S" : null),
        mulberry32(M.seed * 31 + 997), { hSeam: true });
    MODEL = { L, board, secret };
    return MODEL;
}

function sectionCentre(L, i) {
    if (i === 0) { const x = M.W * 0.7; return { x, y: L.road(x, 1) * 0.45 }; }
    const x = i === 1 ? L.bx1 * 0.3 : (L.bx1 + M.W) / 2;
    return { x, y: (L.road(x, 1) + M.H) / 2 };
}

function holePolygon(L) { return regionPolygon(L, "S"); }
function holeBox(L) {
    const pts = holePolygon(L), ys = pts.map((p) => p.y);
    return { x: L.hx0, y: Math.min(...ys), w: L.P, h: Math.max(...ys) - Math.min(...ys) };
}

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
    M.drop = null; M.slope = null;
    chooseRoad();
    fitToPicture(false);
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

// Fit A's edge to a stepped line that is already in the picture (a fence, a wall foot): try heights,
// drops and slants, and keep the one whose line runs along the strongest horizontal edges.
// Sets M.road, M.drop and M.slope and returns true when a clear line was found.
function fitToPicture(force) {
    if (!PIC.orig || M.roadShape === "wavy") return false;
    const L0 = layout(), n = L0.n, P = L0.P, ch = L0.ch, mrg = 0.8 * ch;
    const gw = Math.round(M.W), gh = Math.round(M.H);
    const sm = canvasOf(gw, gh); sm.getContext("2d").drawImage(PIC.orig, 0, 0, gw, gh);
    const px = sm.getContext("2d").getImageData(0, 0, gw, gh).data;
    // colour just below minus just above each point, averaged over 3 mm: a real line in the picture gives the
    // same difference all along it, a busy picture averages out
    const DV = [new Float32Array(gw * gh), new Float32Array(gw * gh), new Float32Array(gw * gh)];
    for (let y = 3; y < gh - 3; y++) for (let x = 0; x < gw; x++) {
        const i = y * gw + x;
        for (let q = 0; q < 3; q++) {
            const a = px[(i - gw) * 4 + q] + px[(i - 2 * gw) * 4 + q] + px[(i - 3 * gw) * 4 + q];
            const b = px[i * 4 + q] + px[(i + gw) * 4 + q] + px[(i + 2 * gw) * 4 + q];
            DV[q][i] = (b - a) / 3;
        }
    }
    const xs = [];
    for (let j = 0; j < n; j++) for (let u = 4; u < P - 4; u += 2) xs.push({ j, u, x: Math.round(j * P + u) });
    // and what lies just above and just below the line should look alike in every part, because the parts
    // swap partners when the puzzle opens (otherwise a fence can end up on the wrong side in one part)
    const BAND = 6;
    const score = (s0, d, g) => {
        const sum = [], up = [], dn = [];
        for (let j = 0; j < n; j++) { sum.push([0, 0, 0, 0]); up.push([0, 0, 0]); dn.push([0, 0, 0]); }
        for (const q of xs) {
            const y = Math.round(s0 + (g * q.u) / P - (q.j === 0 ? 0 : (n - q.j) * d));
            if (y < BAND + 1 || y >= gh - BAND - 1) return -1;
            const i = y * gw + q.x, t = sum[q.j];
            t[0] += DV[0][i]; t[1] += DV[1][i]; t[2] += DV[2][i]; t[3]++;
            const ia = (i - BAND * gw) * 4, ib = (i + BAND * gw) * 4;
            for (let c = 0; c < 3; c++) { up[q.j][c] += px[ia + c]; dn[q.j][c] += px[ib + c]; }
        }
        // every part of the line must be clear, so the weakest part counts double
        const m = sum.map((t) => Math.hypot(t[0], t[1], t[2]) / t[3]);
        let e = (m.reduce((a, b) => a + b, 0) + Math.min(...m)) / (n + 1);
        const spread = (arr) => {
            let worst = 0;
            for (let a1 = 0; a1 < n; a1++) for (let a2 = a1 + 1; a2 < n; a2++) {
                const c1 = arr[a1].map((v) => v / sum[a1][3]), c2 = arr[a2].map((v) => v / sum[a2][3]);
                worst = Math.max(worst, Math.hypot(c1[0] - c2[0], c1[1] - c2[1], c1[2] - c2[2]));
            }
            return worst;
        };
        return e - 0.25 * (spread(up) + spread(dn));
    };
    const gMax = M.roadShape === "slant" ? P * 0.9 : 0;
    let best = null; const all = [];
    const search = (d0, d1, dd, g0, g1, dg, ds, sLo, sHi) => {
        for (let d = d0; d <= d1; d += dd) for (let g = g0; g <= g1; g += dg) {
            const lo = Math.max(sLo != null ? sLo : -1e9, mrg + (n - 1) * d), hi = Math.min(sHi != null ? sHi : 1e9, M.H - mrg - g);
            for (let s0 = lo; s0 <= hi; s0 += ds) {
                const e = score(s0, d, g);
                if (e < 0) continue;
                all.push(e);
                if (!best || e > best.e) best = { e, s0, d, g };
            }
        }
    };
    search(0.6 * ch, 2.4 * ch, 2, 0, gMax, gMax ? 3 : 1, 2);
    if (!best) return false;
    const b0 = best;
    search(b0.d - 2, b0.d + 2, 0.5, Math.max(0, b0.g - 3), b0.g + 3, gMax ? 1 : 1, 0.5, b0.s0 - 2, b0.s0 + 2);
    all.sort((a, b) => a - b);
    const median = all[all.length >> 1];
    // a clear line scores well above 20; busy pictures without one stay below 10
    if (best.e < (force ? 12 : 18) || best.e < median * 1.5) return false;
    M.road = best.s0 / M.H; M.drop = best.d; M.slope = M.roadShape === "slant" ? best.g : null;
    return true;
}

// The road goes where the picture is calmest.
function chooseRoad() {
    PIC.auto = null;
    if (!PIC.orig) return;
    const saveRoad = M.road;
    M.road = null;
    const L0 = layout(), E = cellEnergy(L0);
    let best = null;
    const steps = Math.max(1, Math.round((L0.sMax - L0.sMin) / (L0.ch / 3)));
    for (let q = 0; q <= steps; q++) {
        const s0 = L0.sMin + ((L0.sMax - L0.sMin) * q) / steps;
        M.road = s0 / M.H;
        const L = layout();
        let e = 0;
        for (let c = 0; c < L.C; c++) {
            const y = L.road((c + 0.5) * L.cw, 1);
            for (let r = Math.max(0, Math.floor((y - L.d * 0.6) / L.ch)); r < Math.min(L.R, Math.ceil((y + L.d * 0.6) / L.ch)); r++) e += E[r][c];
        }
        e *= 1 + 0.25 * Math.abs((s0 - L.sMin) / Math.max(1, L.sMax - L.sMin) - 0.6);
        if (!best || e < best.e) best = { e, s: s0 };
    }
    M.road = saveRoad;
    PIC.auto = best;
}

// distance from every point of the picture to the nearest seam between sections (grid of res px per mm)
function seamDistance(L, res) {
    const w = Math.ceil(M.W * res), h = Math.ceil(M.H * res);
    const D = new Float32Array(w * h).fill(1e9);
    const lab = new Int8Array(w * h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) lab[y * w + x] = sectionAt(L, (x + 0.5) / res, (y + 0.5) / res);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        // only A's edge changes partners when the puzzle opens (B and C keep their own picture)
        const diff = (j) => lab[j] !== lab[i] && (lab[j] === 0 || lab[i] === 0);
        if ((x < w - 1 && diff(i + 1)) || (y < h - 1 && diff(i + w)) || (x > 0 && diff(i - 1)) || (y > 0 && diff(i - w))) D[i] = 0;
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
    return { D, w, h, res, lab };
}

// Paint the road along every seam. Sections meet other sections when the puzzle opens, so every seam
// is painted the same way (an even road colour with a fine grain), and any two edges meet seamlessly.
// "plain": a path in a colour taken from the picture; "picture": the picture's own road colour, with a
// narrower blend (best after the road was painted into the picture with AI).
function paintRoad(L) {
    const k = PIC.pxPerMm, res = Math.min(3, k);
    if (M.roadStyle !== "road") {
        // the picture as it is, with (by default) an outline along A's edge, like the ink lines in the art
        const W0 = PIC.orig.width, H0 = PIC.orig.height, out = canvasOf(W0, H0), ox = out.getContext("2d");
        ox.drawImage(PIC.orig, 0, 0);
        if (M.roadStyle === "outline") {
            const pts = [];
            for (let c = 0; c <= L.C; c++) { const x = c * L.cw; if (c > 0) pts.push({ x, y: L.road(x, -1) }); if (c < L.C) pts.push({ x, y: L.road(x, 1) }); }
            const line = () => { ox.beginPath(); pts.forEach((p, i) => (i ? ox.lineTo : ox.moveTo).call(ox, p.x * k, p.y * k)); };
            ox.lineJoin = "round"; ox.lineCap = "round";
            ox.strokeStyle = "rgba(20,14,10,0.25)"; ox.lineWidth = 2.6 * k; line(); ox.stroke();
            ox.strokeStyle = "rgba(25,18,12,0.9)"; ox.lineWidth = 1.1 * k; line(); ox.stroke();
        }
        wrapEdges(L, out);
        return out;
    }
    const { D, w, h, lab } = seamDistance(L, res);
    const fade = 0.45 * Math.min(L.cw, L.ch) * res;
    // road colour: the median of the picture along the seams
    const small = canvasOf(w, h);
    small.getContext("2d").drawImage(PIC.orig, 0, 0, w, h);
    const sd = small.getContext("2d").getImageData(0, 0, w, h).data;
    const vals = [[], [], []];
    for (let i = 0; i < w * h; i += 3) if (D[i] < fade * 0.7) for (let q = 0; q < 3; q++) vals[q].push(sd[i * 4 + q]);
    const med = vals.map((v) => { v.sort((a, b) => a - b); return v.length ? v[v.length >> 1] : 160; });
    const grey = (med[0] + med[1] + med[2]) / 3;
    const base = med.map((v) => Math.min(235, (v * 0.55 + grey * 0.45) * 1.12 + 18));
    // where the road goes: soft along the seams, solid on the side-road strips
    const mask = canvasOf(w, h), mx = mask.getContext("2d"), md = mx.createImageData(w, h);
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
        const i = y * w + x;
        let a = Math.max(0, Math.min(1, 1.6 * (1 - D[i] / fade)));
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
    wrapEdges(L, out);
    return out;
}

// When the puzzle opens, C's right edge (the puzzle's right edge) comes to lie against B's left edge
// (the left edge). Below the road, blend both edges into their mirrored average so they meet seamlessly.
function wrapEdges(L, canvas) {
    const k = PIC.pxPerMm, W = canvas.width, H = canvas.height, fw = Math.max(4, Math.round(0.6 * L.cw * k));
    const cx = canvas.getContext("2d"), id = cx.getImageData(0, 0, W, H), p = id.data;
    const top = Math.floor(Math.min(L.road(0, 1), L.road(M.W, -1)) * k - fw);
    for (let y = Math.max(0, top); y < H; y++) {
        // fade in below the road, so A's edges stay untouched
        const yl = y / k, edgeL = L.road(0.5, 1), edgeR = L.road(M.W - 0.5, -1);
        for (let t = 0; t < fw; t++) {
            const a = 1 - t / fw;
            const iL = (y * W + t) * 4, iR = (y * W + (W - 1 - t)) * 4;
            const wl = clamp((yl - edgeL) / (0.4 * L.ch), 0, 1), wr = clamp((yl - edgeR) / (0.4 * L.ch), 0, 1);
            const ww = Math.min(wl, wr) * a;
            for (let q = 0; q < 3; q++) {
                const m = (p[iL + q] + p[iR + q]) / 2;
                p[iL + q] = p[iL + q] + (m - p[iL + q]) * ww;
                p[iR + q] = p[iR + q] + (m - p[iR + q]) * ww;
            }
        }
    }
    cx.putImageData(id, 0, 0);
}

function rebuildPictures() {
    if (!PIC.orig) { PIC.main = null; PIC.mainUrl = null; return; }
    const L = layout();
    PIC.main = paintRoad(L);
    PIC.mainUrl = PIC.main.toDataURL("image/jpeg", 0.88);
    if (PIC.secretSrc) fitSecret(PIC.secretSrc, PIC.secretFromOpen);
}

// clip a canvas context to a polygon, shifted
function clipPoly(cx, pts, off, k) {
    cx.beginPath();
    pts.forEach((p, i) => (i ? cx.lineTo : cx.moveTo).call(cx, (p.x + off.x) * k, (p.y + off.y) * k));
    cx.closePath();
    cx.clip();
}

// The picture at one stage of opening: 0 closed, 1 B slid down, 2 strips moved (hole empty), 3 secret in place.
// hole: null = transparent, or a fill colour.
function compositeAt(stage, hole) {
    const L = layout(), k = PIC.pxPerMm;
    const c = canvasOf(M.W * k, (stage === 0 ? M.H : stage <= 2 ? M.H + awayY(L) : L.OH) * k), cx = c.getContext("2d");
    for (let i = 0; i < sectionCount(L); i++) {
        const off = offsetOf(L, i, stage);
        cx.save(); clipPoly(cx, regionPolygon(L, i), off, k);
        cx.drawImage(PIC.main, off.x * k, off.y * k);
        cx.restore();
    }
    if (stage >= 3) {
        const hb = holeBox(L);
        cx.save(); clipPoly(cx, holePolygon(L), { x: 0, y: 0 }, k);
        if (stage === 4 && PIC.secret) cx.drawImage(PIC.secret, (hb.x - L.bleed) * k, (hb.y - L.bleed) * k);
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
    const L = layout(), ratio = (M.W / M.H).toFixed(2), pct = (y) => Math.round((y / M.H) * 100);
    const names = L.n === 3 ? ["left third", "middle third", "right third"] : null;
    const parts = [];
    for (let j = 0; j < L.n; j++) {
        const x0 = j * L.P + 0.01, x1 = (j + 1) * L.P - 0.01;
        const where = names ? "in the " + names[j] : "in part " + (j + 1) + " of " + L.n + " (from the left)";
        const y0 = pct(L.road(x0, 1)), y1 = pct(L.road(x1, -1));
        parts.push(where + (Math.abs(y1 - y0) < 2 ? " at " + y0 + "%" : " from " + y0 + "% down to " + y1 + "%"));
    }
    const shape = M.roadShape === "slant" ? "slopes down from left to right" : M.roadShape === "wavy" ? "zigzags" : "runs level";
    return "A detailed, busy illustration for a jigsaw puzzle, aspect ratio " + ratio + ":1. " +
        (M.styleText.trim() || "Colourful storybook style with lots of little characters.") +
        " A long, clear line runs across the whole picture in " + L.n + " steps, like a staircase seen from the side: " +
        "for example the foot of a long wall or a row of houses, a fence, a market counter or a riverbank. In each step it " + shape +
        ", then it jumps to a new height at the next step. Measured from the top of the picture, the line is " + parts.join(", ") + ". " +
        "The scene is busy on both sides of the line, but nothing crosses it: people, animals and objects end at the line or stand clear of it, " +
        "and the strip just below the line looks alike all the way along. The far left and far right edges of the lower part of the picture show the same kind of ground.";
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
    const comp = compositeAt(3, null);                  // the hole transparent = to be painted
    fitSecret(await aiEdit(comp, secretPrompt()), true);
}

// Let the AI repaint a narrow band along the seam under A, so the seam follows a line in the scene.
function roadPrompt() {
    return "This is an illustration with an empty (transparent) band running across it in steps. Repaint the band so the " +
        "picture continues naturally, in exactly the same art style, colours and lighting, and so that a clear line runs " +
        "exactly along the middle of the band: for example the foot of a wall or a row of houses, a fence, a counter, a kerb " +
        "or a riverbank. The scene can stay busy on both sides, but nothing may cross that line: people, animals and objects " +
        "end at it or stand clear of it, and the strip just below the line looks alike all the way along. " +
        "Keep everything outside the band unchanged.";
}
async function aiRoad() {
    const L = layout(), k = PIC.pxPerMm;
    const c = canvasOf(PIC.orig.width, PIC.orig.height), cx = c.getContext("2d");
    cx.drawImage(PIC.orig, 0, 0);
    // clear the road: a band along the line under A
    const id = cx.getImageData(0, 0, c.width, c.height);
    for (let y = 0; y < c.height; y++) for (let x = 0; x < c.width; x++) {
        const mx = (x + 0.5) / k, my = (y + 0.5) / k, sc = sectionAt(L, mx, my);
        if (Math.abs(my - L.road(mx, 1)) < L.ch * 0.45) id.data[(y * c.width + x) * 4 + 3] = 0;
    }
    cx.putImageData(id, 0, 0);
    const out = await aiEdit(c, roadPrompt());
    // keep this layout: the road was painted for it
    M.road = L.s / M.H;
    PIC.orig = out;
    rebuildPictures();
}

async function aiMain() {
    await setMainPicture(await aiGenerate(mainPrompt()));
}

// ------------------------------------------------------------------ preview
let lastLayoutKey = "";
let STAGE = 0, stageTimers = [];
function secretOffset(L, stage) {
    const hb = holeBox(L);
    return stage >= 4 ? { x: 0, y: 0 } : { x: 0, y: M.H + 14 + (stage >= 1 && stage <= 2 ? awayY(L) : 0) - hb.y };
}
function viewHeight(L, stage) {
    const hb = holeBox(L);
    if (stage >= 4) return L.OH;
    return (stage >= 1 && stage <= 2 ? M.H + awayY(L) : stage === 3 ? L.OH : M.H) + 14 + hb.h;
}

function render() {
    const { L, board, secret } = buildModel();
    const stage = $("stage");
    const pad = 8;
    const hb = holeBox(L), holeW = hb.w, holeH = hb.h;
    stage.setAttribute("viewBox", [-pad - L.P * 0.15, -pad, M.W + 2 * pad + L.P * 0.15, Math.max(viewHeight(L, 0), viewHeight(L, 2), viewHeight(L, 4)) + 2 * pad].join(" "));
    let defs = "", body = "";
    for (let i = 0; i < 3; i++) defs += '<clipPath id="clip' + i + '"><path d="' + polyPath(regionPolygon(L, i)) + '"/></clipPath>';
    defs += '<clipPath id="clipS"><path d="' + polyPath(holePolygon(L)) + '"/></clipPath>';
    const edgesFor = (model, i) => model.edges.filter((e) => e.secs.indexOf(i) >= 0);
    const tint = ["#d8b98f", "#e7a978", "#9fb5a0"];
    for (let i = 0; i < 3; i++) {
        const off = offsetOf(L, i, STAGE);
        let g = '<g class="region sec' + i + '" data-sec="' + i + '" style="transform: translate(' + off.x + "px," + off.y + 'px)">';
        g += '<g clip-path="url(#clip' + i + ')">' + (PIC.mainUrl ?
            '<image href="' + PIC.mainUrl + '" width="' + M.W + '" height="' + M.H + '" preserveAspectRatio="none"/>' :
            '<rect class="blank" width="' + M.W + '" height="' + M.H + '" style="fill:' + tint[i] + '"/>') + "</g>";
        const es = edgesFor(board, i);
        if (M.showCuts) g += '<g class="cuts">' + es.filter((e) => e.secs.length === 1 && !e.outline).map((e) => '<path d="' + edgeD(e) + '"/>').join("") + "</g>";
        g += '<g class="secline">' + es.filter((e) => e.secs.length === 2 || e.outline).map((e) => '<path d="' + edgeD(e) + '"/>').join("") + "</g>";
        if (M.showSections) { const cc = sectionCentre(L, i); g += '<text class="tag" x="' + cc.x + '" y="' + cc.y + '">' + sectionLetter(i) + "</text>"; }
        body += g + "</g>";
    }
    // the secret pieces: waiting below the puzzle until the hole is there
    {
        const off = secretOffset(L, STAGE);
        let g = '<g class="region secret' + (STAGE >= 4 ? "" : " waiting") + '" data-sec="S" style="transform: translate(' + off.x + "px," + off.y + 'px)">';
        g += '<g clip-path="url(#clipS)">' + (PIC.secretUrl ?
            '<image href="' + PIC.secretUrl + '" x="' + (hb.x - L.bleed) + '" y="' + (hb.y - L.bleed) + '" width="' + (holeW + 2 * L.bleed) + '" height="' + (holeH + 2 * L.bleed) + '" preserveAspectRatio="none"/>' :
            '<rect class="blank secretblank" x="' + hb.x + '" y="' + hb.y + '" width="' + holeW + '" height="' + holeH + '"/>') + "</g>";
        if (M.showCuts) g += '<g class="cuts">' + secret.edges.filter((e) => !e.outline).map((e) => '<path d="' + edgeD(e) + '"/>').join("") + "</g>";
        g += '<g class="secline">' + secret.edges.filter((e) => e.outline).map((e) => '<path d="' + edgeD(e) + '"/>').join("") + "</g>";
        g += '<text class="tag star" x="' + (hb.x + holeW / 2) + '" y="' + (hb.y + holeH / 2) + '">★</text>';
        body += g + "</g>";
    }
    stage.innerHTML = "<defs>" + defs + "</defs>" + body;
    stage.classList.toggle("nopic", !PIC.mainUrl);
    stage.classList.toggle("open", STAGE >= 4);

    $("stat-size").textContent = Math.round(M.W) + " × " + Math.round(M.H) + " mm → opened " + Math.round(M.W) + " × " + Math.round(L.OH) + " mm";
    $("stat-pieces").textContent = board.pieces + " pieces in 3 sections + " + secret.pieces + " in the secret bag";
    $("download").disabled = false;
    $("printBtn").disabled = !PIC.main;
    $("sheetBtn").disabled = false;
    renderSteps(L);
    updateLayoutUI(L);
    updatePictureUI();
    // the secret picture was painted for a hole of another size or place
    const key = [L.n, L.b, Math.round(L.s), L.g.toFixed(1), L.cpc, L.R, M.W, M.H, M.roadShape].join(",");
    if (lastLayoutKey && key !== lastLayoutKey && PIC.secret) $("secretStale").hidden = false;
    lastLayoutKey = key;
    scheduleSave();
}

// move the sections to a stage without rebuilding them, so the move animates
function showStage(st) {
    STAGE = st;
    const L = layout();
    document.querySelectorAll("#stage .region").forEach((g) => {
        const sec = g.dataset.sec, off = sec === "S" ? secretOffset(L, st) : offsetOf(L, +sec, st);
        g.style.transform = "translate(" + off.x + "px," + off.y + "px)";
        if (sec === "S") g.classList.toggle("waiting", st < 4);
    });
    $("stage").classList.toggle("open", st >= 4);
}

function setOpen(open) {
    M.showOpen = open;
    document.querySelectorAll("#viewSeg button").forEach((b) => b.setAttribute("aria-pressed", (b.dataset.v === "open") === open));
    stageTimers.forEach(clearTimeout); stageTimers = [];
    if (!open) { showStage(0); return; }
    // play it like the instructions: B away, C over, B back in, then the secret pieces
    if (STAGE === 4) { showStage(4); return; }
    [1, 2, 3, 4].forEach((st, i) => stageTimers.push(setTimeout(() => showStage(st), i * 950)));
}

// ------------------------------------------------------------------ the steps, in words
function stepTexts(L) {
    const drop = M.drop != null ? Math.round(L.d) + " mm" : L.b === 1 ? "a row" : L.b + " rows";
    return [
        "Finish the puzzle: three sections, A on top, B bottom left and C bottom right. Then carefully slide section B away from the puzzle.",
        "Slide section C to where B used to be. It drops " + drop + " lower along A's edge.",
        "Now put B where C used to be, also " + drop + " lower. A hole has magically appeared in the puzzle!",
        "Open the secret bag ★ and fill the hole to finish the puzzle.",
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
    board.edges.forEach((e) => { if (!e.outline) out.push(edgeD(e)); });
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
    compositeAt(3, "#808080").toBlob((b) => saveBlob("magic-puzzle-secret-template.png", b, "image/png"), "image/png");
}

// the instruction sheet: four panels, like the ones in the box
function sheetCanvas() {
    const L = layout();
    const PW = 900, mmk = (PW - 80) / (M.W + L.P * 0.15), PH = Math.round((M.H + awayY(L)) * mmk + 190);
    const c = canvasOf(PW * 2, PH * 2 + 120), cx = c.getContext("2d");
    cx.fillStyle = "#fbf8f2"; cx.fillRect(0, 0, c.width, c.height);
    cx.fillStyle = "#2a2320"; cx.font = "700 40px 'Bricolage Grotesque', sans-serif"; cx.textAlign = "center";
    cx.fillText("How to open the magic puzzle", c.width / 2, 72);
    const texts = stepTexts(L), k0 = PIC.pxPerMm, colors = ["#c9a6d6", "#e7a978", "#9fb5a0"];
    for (let p = 0; p < 4; p++) {
        const ox = (p % 2) * PW, oy = 120 + Math.floor(p / 2) * PH, stage = p + 1;
        cx.strokeStyle = "#cbbfae"; cx.lineWidth = 2; cx.strokeRect(ox + 20, oy + 10, PW - 40, PH - 30);
        cx.fillStyle = "#2a2320"; cx.font = "600 24px 'Instrument Sans', sans-serif"; cx.textAlign = "left";
        wrapText(cx, (p + 1) + ". " + texts[p], ox + 40, oy + 50, PW - 80, 30);
        const px = ox + 40 + L.P * 0.15 * mmk, py = oy + 140;
        if (PIC.main) {
            const comp = compositeAt(stage, stage === 3 ? "#2a2320" : null);
            cx.save(); cx.beginPath(); cx.rect(ox + 22, oy + 12, PW - 44, PH - 34); cx.clip();
            cx.drawImage(comp, px, py, comp.width / k0 * mmk, comp.height / k0 * mmk);
            cx.restore();
        } else if (stage === 3) {
            cx.fillStyle = "#2a2320"; cx.fill(new Path2D(polyPath(holePolygon(L), px / mmk, py / mmk, mmk)));
        }
        for (let i = 0; i < 3; i++) {
            const off = offsetOf(L, i, stage);
            const poly = new Path2D(polyPath(regionPolygon(L, i), off.x, off.y, mmk));
            cx.save(); cx.translate(px, py);
            if (!PIC.main) { cx.fillStyle = colors[i]; cx.fill(poly); }
            cx.lineWidth = 3; cx.strokeStyle = "#5b2a6e"; cx.stroke(poly);
            cx.restore();
            const cc = sectionCentre(L, i), tx = px + (cc.x + off.x) * mmk, ty = py + (cc.y + off.y) * mmk;
            cx.font = "700 48px 'Bricolage Grotesque', sans-serif"; cx.textAlign = "center"; cx.textBaseline = "middle";
            cx.lineWidth = 6; cx.strokeStyle = "rgba(255,255,255,.9)"; cx.strokeText(sectionLetter(i), tx, ty);
            cx.fillStyle = "#5b2a6e"; cx.fillText(sectionLetter(i), tx, ty);
            cx.textBaseline = "alphabetic";
        }
        // arrows for the move in this step
        cx.strokeStyle = "#1f8fbf"; cx.fillStyle = "#1f8fbf"; cx.lineWidth = 6;
        const moveArrow = (i, from, to) => {
            const cc = sectionCentre(L, i), a = offsetOf(L, i, from), b = offsetOf(L, i, to);
            arrow(cx, px + (cc.x + a.x) * mmk, py + (cc.y + a.y - L.ch * 0.8) * mmk, px + (cc.x + b.x) * mmk, py + (cc.y + b.y - L.ch * 0.8) * mmk, true);
        };
        if (p === 0) moveArrow(1, 0, 1);
        if (p === 1) moveArrow(2, 1, 2);
        if (p === 2) moveArrow(1, 2, 3);
        if (p === 3 && !PIC.secret) {
            const hb = holeBox(L);
            cx.font = "700 60px 'Bricolage Grotesque', sans-serif"; cx.textAlign = "center"; cx.textBaseline = "middle";
            cx.fillStyle = "#f2c230"; cx.strokeStyle = "#2a2320"; cx.lineWidth = 4;
            const sx = px + (hb.x + hb.w / 2) * mmk, sy = py + (hb.y + hb.h / 2) * mmk;
            cx.strokeText("★", sx, sy); cx.fillText("★", sx, sy);
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

function downloadSheet() {
    sheetCanvas().toBlob((b) => saveBlob("magic-puzzle-instructions.png", b, "image/png"), "image/png");
}

// ------------------------------------------------------------------ saving in this browser
const SAVE_KEYS = ["W", "H", "n", "bandRows", "drop", "slope", "roadShape", "road", "roadStyle", "piece", "knob", "seed", "secretText", "styleText", "showCuts", "showSections"];
let saveTimer = null;
function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        try {
            const s = { v: 5 };
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
        if (s.v === 5) SAVE_KEYS.forEach((k) => { if (s[k] !== undefined) M[k] = s[k]; });
        if (["outline", "road", "none"].indexOf(M.roadStyle) < 0) M.roadStyle = "outline";
        M.n = clamp(M.n, 3, 5);
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
    road.min = Math.floor(L.sMin); road.max = Math.ceil(L.sMax); road.value = Math.round(L.s);
    $("mRoadOut").textContent = (M.road == null && PIC.auto ? "Auto · " : "") + Math.round(L.s) + " mm";
    document.querySelectorAll("#shapeSeg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === M.roadShape));
    $("holeOut").textContent = Math.round(L.P) + " × " + Math.round(L.n * L.d) + " mm";
    const fitOpt = $("mB").querySelector('option[value="fit"]');
    if (M.drop != null) {
        const t = Math.round(L.d) + " mm (fitted)";
        if (fitOpt) fitOpt.textContent = t; else $("mB").insertAdjacentHTML("beforeend", '<option value="fit">' + t + "</option>");
        $("mB").value = "fit";
    } else { if (fitOpt) fitOpt.remove(); $("mB").value = L.b; }
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
    $("mN").addEventListener("change", () => { M.n = parseInt($("mN").value); chooseRoad(); relayout(); });
    $("mB").addEventListener("change", () => {
        if ($("mB").value === "fit") return;
        M.bandRows = parseInt($("mB").value); M.drop = null; M.road = null; relayout();
    });
    $("mRoad").addEventListener("input", () => { const L = layout(); M.road = parseInt($("mRoad").value) / M.H; relayout(); });
    document.querySelectorAll("#shapeSeg button").forEach((b) => b.addEventListener("click", () => { M.roadShape = b.dataset.v; M.road = null; M.slope = null; chooseRoad(); relayout(); }));
    $("roadAuto").addEventListener("click", () => {
        const f = fitToPicture(true);
        if (!f) { M.road = null; chooseRoad(); }
        warn(f ? "" : "Couldn't find a clear stepped line in the picture, so the seam goes where the picture is calmest.");
        relayout();
    });
    $("mPiece").addEventListener("input", () => { M.piece = +$("mPiece").value; $("mPieceOut").textContent = M.piece + " mm"; chooseRoad(); relayout(); });
    document.querySelectorAll("#roadSeg button").forEach((b) => b.addEventListener("click", () => { M.roadStyle = b.dataset.v; relayout(); }));
    $("aiRoad").addEventListener("click", async () => {
        busy(true, "Painting along the seam… (this can take a minute)");
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
            M.road = null;
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
            const openAr = M.W / L.OH, holeAr = L.P / (L.n * L.d);
            fitSecret(img, Math.abs(Math.log(ar / openAr)) < Math.abs(Math.log(ar / holeAr)));
            $("secretStale").hidden = true;
            warn(""); render(); setOpen(true);
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
        try { await aiSecret(); $("secretStale").hidden = true; warn(""); render(); setOpen(true); }
        catch (err) { warn("The image service failed: " + err.message); }
        busy(false);
    });
    $("aiMain").addEventListener("click", async () => {
        busy(true, "Painting the picture… (this can take a minute)");
        try { M.road = null; await aiMain(); warn(""); lastLayoutKey = ""; render(); }
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
