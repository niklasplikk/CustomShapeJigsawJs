// Quality checks for laser cutting.
//  1. beforePaint(): runs on the engine's cell grid before edges are traced. Fills pockets no piece
//     reached and merges pieces that are too small or too thin into a neighbour.
//  2. checkCuts(): runs on the finished vector lines. Every knob must keep a clearance from every
//     other line; knobs that collide are flipped, moved or shrunk, and straightened as a last resort.
//     Anything that still crosses is reported and marked in the preview.

var cutReport = { merged: 0, filled: 0, fixed: 0, straightened: 0, crossings: [] };

// ------------------------------------------------------------------ 0. shaped pieces split in several
// A shaped piece normally becomes one piece: its inside is masked off and only its outline is cut.
// When it should be split into N pieces, its inside (minus a one-cell band along the outline, so
// nothing can grow across the outline) is opened up again and given N seeds of its own, placed
// by k-means so the pieces come out about equal. Normal knobs then appear between those pieces.
var multiLabels = new Set();
var multiCount = 0;
var multiInfo = [];      // [{path, piece}] used by gentab to size knobs inside split figures

function afterSeed(a) {
    multiLabels = new Set();
    multiCount = 0;
    multiInfo = [];
    const cell = parseFloat($("cell_scale").value);
    const R = a.rows, C = a.columns;
    let next = a.seedpoints.reduce((m, s) => Math.max(m, s.val), 0) + 1;
    whimsies.forEach((w, wi) => {
        const n = Math.max(1, Math.min(8, w.pieces || 1));
        if (n < 2) return;
        const path = document.getElementById("whimsy-" + wi);
        if (!path) return;
        const bb = path.getBBox();
        const r0 = Math.max(0, Math.floor(bb.y / cell) - 1), r1 = Math.min(R - 1, Math.ceil((bb.y + bb.height) / cell) + 1);
        const c0 = Math.max(0, Math.floor(bb.x / cell) - 1), c1 = Math.min(C - 1, Math.ceil((bb.x + bb.width) / cell) + 1);
        const nearOutline = (i, j) => {
            for (let di = -1; di <= 1; di++) for (let dj = -1; dj <= 1; dj++) {
                const ii = i + di, jj = j + dj;
                if (ii < 0 || jj < 0 || ii >= R || jj >= C || a.borderdistgrid[ii][jj]) return true;
            }
            return false;
        };
        const cells = [];
        for (let i = r0; i <= r1; i++) for (let j = c0; j <= c1; j++) {
            if (nearOutline(i, j)) continue;
            if (!path.isPointInFill(new DOMPoint(j * cell + cell / 2, i * cell + cell / 2))) continue;
            cells.push([i, j]);
        }
        if (cells.length < n * 6) return;
        cells.forEach(([i, j]) => { a.maskgrid[i][j] = 0; a.grid[i][j] = 0; });

        // k-means on the free cells; start from points spread out along the shape
        let cx = 0, cy = 0;
        cells.forEach(([i, j]) => { cx += j; cy += i; });
        cx /= cells.length; cy /= cells.length;
        const centres = [];
        let far = cells.reduce((b, p) => (Math.hypot(p[1] - cx, p[0] - cy) > Math.hypot(b[1] - cx, b[0] - cy) ? p : b), cells[0]);
        centres.push([far[0], far[1]]);
        while (centres.length < n) {
            let best = null, bd = -1;
            cells.forEach((p) => {
                const d = Math.min(...centres.map((c) => Math.hypot(p[0] - c[0], p[1] - c[1])));
                if (d > bd) { bd = d; best = p; }
            });
            centres.push([best[0], best[1]]);
        }
        for (let it = 0; it < 12; it++) {
            const sum = centres.map(() => [0, 0, 0]);
            cells.forEach((p) => {
                let k = 0, kd = Infinity;
                centres.forEach((c, ci) => { const d = (p[0] - c[0]) ** 2 + (p[1] - c[1]) ** 2; if (d < kd) { kd = d; k = ci; } });
                sum[k][0] += p[0]; sum[k][1] += p[1]; sum[k][2]++;
            });
            sum.forEach((s, ci) => { if (s[2]) centres[ci] = [s[0] / s[2], s[1] / s[2]]; });
        }
        centres.forEach((c) => {
            // snap the seed to the nearest free cell
            const p = cells.reduce((b, q) => ((q[0] - c[0]) ** 2 + (q[1] - c[1]) ** 2 < (b[0] - c[0]) ** 2 + (b[1] - c[1]) ** 2 ? q : b), cells[0]);
            const val = next++;
            a.grid[p[0]][p[1]] = val;
            a.seedpoints.push({ row: p[0], col: p[1], val: val });
            multiLabels.add(val);
        });
        multiCount++;
        multiInfo.push({ path: path, piece: Math.sqrt((cells.length * cell * cell) / n) });
    });
}

// ------------------------------------------------------------------ 1. small pieces
function beforePaint(a) {
    const R = a.rows, C = a.columns, g = a.grid, mask = a.maskgrid;
    const cell = parseFloat($("cell_scale").value);
    let maxLabel = 0;
    for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
        g[i][j] = Math.abs(g[i][j]);
        if (g[i][j] > maxLabel) maxLabel = g[i][j];
    }
    const D4 = [[1, 0], [-1, 0], [0, 1], [0, -1]];
    const free = (i, j) => i >= 0 && j >= 0 && i < R && j < C && !mask[i][j];

    // pockets that no piece grew into
    let filled = 0;
    const seen = Array.from({ length: R }, () => new Uint8Array(C));
    for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
        if (seen[i][j] || g[i][j] || mask[i][j]) continue;
        const comp = [[i, j]], adj = new Map();
        seen[i][j] = 1;
        for (let k = 0; k < comp.length; k++) {
            const [ci, cj] = comp[k];
            for (const [di, dj] of D4) {
                const ni = ci + di, nj = cj + dj;
                if (!free(ni, nj)) continue;
                if (g[ni][nj]) adj.set(g[ni][nj], (adj.get(g[ni][nj]) || 0) + 1);
                else if (!seen[ni][nj]) { seen[ni][nj] = 1; comp.push([ni, nj]); }
            }
        }
        let lab = 0, best = -1;
        adj.forEach((n, l) => { if (n > best) { best = n; lab = l; } });
        if (!lab) lab = ++maxLabel;
        comp.forEach(([ci, cj]) => { g[ci][cj] = lab; });
        filled++;
    }

    // merge pieces that are too small or too thin
    const nominal = Math.pow(S.piece / cell, 2);
    const minArea = 0.3 * nominal;
    const minWidth = 0.28 * S.piece / cell;   // 2·area / perimeter ≈ width of a long strip
    const stuck = new Set();
    let merged = 0;
    for (let iter = 0; iter < 300; iter++) {
        const area = new Map(), per = new Map(), shared = new Map();
        for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) {
            const l = g[i][j];
            if (!l || mask[i][j]) continue;
            area.set(l, (area.get(l) || 0) + 1);
            for (const [di, dj] of D4) {
                const ni = i + di, nj = j + dj;
                const nl = free(ni, nj) ? g[ni][nj] : 0;
                if (nl === l) continue;
                per.set(l, (per.get(l) || 0) + 1);
                if (nl) {
                    let m = shared.get(l);
                    if (!m) shared.set(l, m = new Map());
                    m.set(nl, (m.get(nl) || 0) + 1);
                }
            }
        }
        let victim = 0, vArea = Infinity;
        area.forEach((A, l) => {
            if (stuck.has(l)) return;
            const f = multiLabels.has(l) ? 0.4 : 1;   // pieces inside a split shape may be smaller
            const thin = (2 * A) / (per.get(l) || 1) < minWidth * f;
            if ((A < minArea * f || thin) && A < vArea) { victim = l; vArea = A; }
        });
        if (!victim) break;
        const nb = shared.get(victim);
        if (!nb) { stuck.add(victim); continue; }
        let target = 0, bestShared = -1;
        nb.forEach((n, l) => {
            if (n > bestShared || (n === bestShared && area.get(l) < area.get(target))) { bestShared = n; target = l; }
        });
        for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) if (g[i][j] === victim) g[i][j] = target;
        merged++;
    }

    const labels = new Set();
    for (let i = 0; i < R; i++) for (let j = 0; j < C; j++) if (g[i][j] && !mask[i][j]) labels.add(g[i][j]);
    // the engine adds one piece per shaped piece afterwards; split shapes are already counted
    $("piececount").innerHTML = labels.size - multiCount;
    cutReport = { merged: merged, filled: filled, fixed: 0, straightened: 0, crossings: [] };
}

// ------------------------------------------------------------------ 2. crossing lines
const CLEARANCE = 1.0;   // mm a knob must keep from any other line
const HASH = 2.5;        // spatial hash cell, mm

class SegHash {
    constructor() { this.cells = new Map(); this.byOwner = new Map(); }
    key(ix, iy) { return ix * 100003 + iy; }
    add(owner, ax, ay, bx, by) {
        const s = { ax: ax, ay: ay, bx: bx, by: by, owner: owner, dead: false };
        if (!this.byOwner.has(owner)) this.byOwner.set(owner, []);
        this.byOwner.get(owner).push(s);
        const x0 = Math.floor(Math.min(ax, bx) / HASH), x1 = Math.floor(Math.max(ax, bx) / HASH);
        const y0 = Math.floor(Math.min(ay, by) / HASH), y1 = Math.floor(Math.max(ay, by) / HASH);
        for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) {
            const k = this.key(ix, iy);
            let c = this.cells.get(k);
            if (!c) this.cells.set(k, c = []);
            c.push(s);
        }
    }
    addPolyline(owner, pts) { for (let i = 1; i < pts.length; i++) this.add(owner, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y); }
    removeOwner(owner) { (this.byOwner.get(owner) || []).forEach((s) => { s.dead = true; }); this.byOwner.set(owner, []); }
    near(x, y, r, fn) {
        const x0 = Math.floor((x - r) / HASH), x1 = Math.floor((x + r) / HASH);
        const y0 = Math.floor((y - r) / HASH), y1 = Math.floor((y + r) / HASH);
        for (let ix = x0; ix <= x1; ix++) for (let iy = y0; iy <= y1; iy++) {
            const c = this.cells.get(this.key(ix, iy));
            if (c) for (const s of c) if (!s.dead && fn(s) === false) return;
        }
    }
}

function distPtSeg(px, py, s) {
    const vx = s.bx - s.ax, vy = s.by - s.ay;
    const L2 = vx * vx + vy * vy;
    let t = L2 ? ((px - s.ax) * vx + (py - s.ay) * vy) / L2 : 0;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(px - (s.ax + t * vx), py - (s.ay + t * vy));
}

function segIntersect(p, q, s) {
    const rx = q.x - p.x, ry = q.y - p.y, sx = s.bx - s.ax, sy = s.by - s.ay;
    const den = rx * sy - ry * sx;
    if (Math.abs(den) < 1e-12) return null;
    const t = ((s.ax - p.x) * sy - (s.ay - p.y) * sx) / den;
    const u = ((s.ax - p.x) * ry - (s.ay - p.y) * rx) / den;
    if (t < 0 || t > 1 || u < 0 || u > 1) return null;
    return { x: p.x + t * rx, y: p.y + t * ry };
}

function bez(seg, t) {
    const [p0, p1, p2, p3] = seg, u = 1 - t;
    return {
        x: u * u * u * p0.x + 3 * u * u * t * p1.x + 3 * u * t * t * p2.x + t * t * t * p3.x,
        y: u * u * u * p0.y + 3 * u * u * t * p1.y + 3 * u * t * t * p2.y + t * t * t * p3.y,
    };
}

function sampleSegs(segs, n) {
    const pts = [segs[0][0]];
    segs.forEach((sg) => { for (let i = 1; i <= n; i++) pts.push(bez(sg, i / n)); });
    return pts;
}

function edgePolyline(e) { return e.segs ? sampleSegs(e.segs, 10) : [e.v1, e.v2]; }

function outlinePolylines() {
    const lines = [];
    if (window.lastShapes) {
        const holder = document.createElementNS(NS, "svg");
        holder.setAttribute("style", "position:absolute;left:-100000px;top:0");
        document.body.appendChild(holder);
        lastShapes.forEach((sh) => {
            sh.d.split(/(?=M)/).forEach((sub) => {
                if (!sub.trim()) return;
                const p = document.createElementNS(NS, "path");
                p.setAttribute("d", sub);
                holder.appendChild(p);
                const len = p.getTotalLength(), n = Math.max(8, Math.ceil(len / 0.5)), pts = [];
                for (let i = 0; i <= n; i++) { const q = p.getPointAtLength((len * i) / n); pts.push({ x: q.x, y: q.y }); }
                lines.push(pts);
            });
        });
        document.body.removeChild(holder);
    } else {
        const m = svgstr.match(/<rect x="0" y="0" width="([\d.]+)" height="([\d.]+)"/);
        if (m) {
            const w = +m[1], h = +m[2];
            lines.push([{ x: 0, y: 0 }, { x: w, y: 0 }, { x: w, y: h }, { x: 0, y: h }, { x: 0, y: 0 }]);
        }
    }
    return lines;
}

// An edge whose end touches neither the outline nor another edge leaves two pieces joined.
// That happens next to the outline of a figure split into pieces (its inside is kept one cell
// away from the outline). Such ends are extended straight on until they meet the outline.
function extendDangling(hash, changes) {
    const cell = parseFloat($("cell_scale").value);
    const key = (p) => Math.round(p.x / 0.4) + "," + Math.round(p.y / 0.4);
    const count = new Map();
    edgeLog.forEach((e) => [e.v1, e.v2].forEach((p) => {
        for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) {
            const k = (Math.round(p.x / 0.4) + dx) + "," + (Math.round(p.y / 0.4) + dy);
            count.set(k, (count.get(k) || 0) + 1);
        }
    }));
    const onOutline = (p) => {
        let hit = false;
        hash.near(p.x, p.y, 0.6, (s) => { if (distPtSeg(p.x, p.y, s) < 0.6) { hit = true; return false; } });
        return hit;
    };
    const reach = 5 * cell;
    edgeLog.forEach((e) => {
        let changed = false;
        const oldD = e.d, oldL = e.L;
        ["v1", "v2"].forEach((end) => {
            const p = e[end], q = end === "v1" ? e.v2 : e.v1;
            if ((count.get(key(p)) || 0) > 1 || onOutline(p)) return;
            const L = Math.hypot(p.x - q.x, p.y - q.y) || 1;
            const dir = { x: (p.x - q.x) / L, y: (p.y - q.y) / L };
            const far = { x: p.x + dir.x * reach, y: p.y + dir.y * reach };
            let best = null, bd = Infinity;
            hash.near((p.x + far.x) / 2, (p.y + far.y) / 2, reach / 2 + HASH, (s) => {
                const x = segIntersect(p, far, s);
                if (!x) return;
                const d = Math.hypot(x.x - p.x, x.y - p.y);
                if (d < bd) { bd = d; best = x; }
            });
            if (!best) {
                // no outline straight ahead: go to the nearest outline point instead
                hash.near(p.x, p.y, reach, (s) => {
                    const vx = s.bx - s.ax, vy = s.by - s.ay, L2 = vx * vx + vy * vy || 1;
                    const t = Math.max(0, Math.min(1, ((p.x - s.ax) * vx + (p.y - s.ay) * vy) / L2));
                    const c = { x: s.ax + t * vx, y: s.ay + t * vy }, d = Math.hypot(c.x - p.x, c.y - p.y);
                    if (d < bd && d < reach) { bd = d; best = c; }
                });
            }
            if (!best) return;
            e[end] = best;
            changed = true;
        });
        if (!changed) return;
        e.L = Math.hypot(e.v2.x - e.v1.x, e.v2.y - e.v1.y);
        if (e.k) {
            const k = Object.assign({}, e.k, { t: (e.k.t * oldL) / e.L });
            e.k = k; e.segs = knobGeometry(e.v1, e.v2, k);
        }
        e.d = e.segs ? knobD(e.v1, e.segs) : straightD(e.v1, e.v2);
        e.orig = oldD;
        changes.push([oldD, e.d]);
        cutReport.fixed++;
    });
}

// An edge that ends on a shaped piece or the border sometimes has its end snapped to the wrong
// side of a curve, so its straight part cuts through the shape. Cut it off where it first meets
// the outline instead.
function trimToOutline(hash, changes) {
    const onOutline = (p) => {
        let hit = false;
        hash.near(p.x, p.y, 1.5, (s) => { if (distPtSeg(p.x, p.y, s) < 1.5) { hit = true; return false; } });
        return hit;
    };
    const firstHit = (from, to) => {
        let best = null, bd = Infinity;
        const steps = Math.ceil(Math.hypot(to.x - from.x, to.y - from.y) / HASH) + 1;
        const seen = new Set();
        for (let k = 0; k <= steps; k++) {
            const cx = from.x + ((to.x - from.x) * k) / steps, cy = from.y + ((to.y - from.y) * k) / steps;
            hash.near(cx, cy, HASH, (s) => {
                if (seen.has(s)) return;
                seen.add(s);
                const x = segIntersect(from, to, s);
                if (!x) return;
                const dFrom = Math.hypot(x.x - from.x, x.y - from.y), dTo = Math.hypot(x.x - to.x, x.y - to.y);
                if (dTo < 1.2 || dFrom < 1.2) return;
                if (dFrom < bd) { bd = dFrom; best = x; }
            });
        }
        return best;
    };
    edgeLog.forEach((e) => {
        const end1 = onOutline(e.v1), end2 = onOutline(e.v2);
        if (end1 === end2) return;
        const inner = end2 ? e.v1 : e.v2, outer = end2 ? e.v2 : e.v1;
        const x = firstHit(inner, outer);
        if (!x) return;
        const oldD = e.orig || e.d, oldL = e.L;
        if (end2) e.v2 = x; else e.v1 = x;
        e.L = Math.hypot(e.v2.x - e.v1.x, e.v2.y - e.v1.y);
        if (e.k) {
            const k = Object.assign({}, e.k, { t: (e.k.t * oldL) / e.L, m: 0.5 });
            if (k.t * 1.7 > 0.38) { e.segs = null; e.k = null; }
            else { e.k = k; e.segs = knobGeometry(e.v1, e.v2, k); }
        }
        e.d = e.segs ? knobD(e.v1, e.segs) : straightD(e.v1, e.v2);
        e.orig = oldD;
        changes.push([oldD, e.d]);
        cutReport.fixed++;
    });
}

function checkCuts() {
    const hash = new SegHash();
    outlinePolylines().forEach((pl) => hash.addPolyline("outline", pl));
    const changes = [];
    extendDangling(hash, changes);
    trimToOutline(hash, changes);
    edgeLog.forEach((e, i) => hash.addPolyline(i, edgePolyline(e)));

    const collides = (i) => {
        const e = edgeLog[i];
        if (!e.segs) return false;
        const pts = sampleSegs(e.segs.slice(1, 5), 14);   // neck and head only
        let hit = false;
        for (const p of pts) {
            hash.near(p.x, p.y, CLEARANCE, (s) => {
                if (s.owner !== i && distPtSeg(p.x, p.y, s) < CLEARANCE) { hit = true; return false; }
            });
            if (hit) return true;
        }
        return false;
    };

    edgeLog.forEach((e, i) => {
        if (!collides(i)) return;
        const k = e.k, oldD = e.d;
        const tries = [
            { flip: !k.flip }, { m: k.m + 0.12 }, { m: k.m - 0.12 },
            { flip: !k.flip, m: k.m + 0.12 }, { flip: !k.flip, m: k.m - 0.12 },
            { t: k.t * 0.8 }, { t: k.t * 0.8, flip: !k.flip },
            { t: k.t * 0.8, m: k.m + 0.15 }, { t: k.t * 0.8, m: k.m - 0.15 },
        ];
        let ok = false;
        for (const tr of tries) {
            const nk = Object.assign({}, k, tr);
            if (nk.m - 1.7 * nk.t < 0.12 || nk.m + 1.7 * nk.t > 0.88) continue;
            hash.removeOwner(i);
            e.segs = knobGeometry(e.v1, e.v2, nk);
            hash.addPolyline(i, edgePolyline(e));
            if (!collides(i)) { e.k = nk; ok = true; break; }
        }
        if (ok) {
            cutReport.fixed++;
        } else {
            hash.removeOwner(i);
            e.segs = null;
            hash.addPolyline(i, edgePolyline(e));
            cutReport.straightened++;
        }
        e.d = e.segs ? knobD(e.v1, e.segs) : straightD(e.v1, e.v2);
        changes.push([e.orig || oldD, e.d]);
        e.orig = e.orig || oldD;
    });

    // write the repaired edges back into both SVG strings (last change per edge wins)
    const final = new Map();
    changes.forEach(([o, n]) => final.set(o, n));
    final.forEach((n, o) => {
        svgstr = svgstr.split('d="' + o + '"').join('d="' + n + '"');
        svgstrsave = svgstrsave.split('d="' + o + '"').join('d="' + n + '"');
    });

    // anything that still truly crosses gets reported
    const found = [];
    const nearEnd = (p, e) => e && (Math.hypot(p.x - e.v1.x, p.y - e.v1.y) < 1.2 || Math.hypot(p.x - e.v2.x, p.y - e.v2.y) < 1.2);
    edgeLog.forEach((e, i) => {
        const pl = edgePolyline(e);
        for (let k = 1; k < pl.length; k++) {
            const p = pl[k - 1], q = pl[k];
            const r = Math.hypot(q.x - p.x, q.y - p.y) / 2 + 0.1;
            hash.near((p.x + q.x) / 2, (p.y + q.y) / 2, r, (s) => {
                if (s.owner === i) return;
                const x = segIntersect(p, q, s);
                if (!x || nearEnd(x, e) || (typeof s.owner === "number" && nearEnd(x, edgeLog[s.owner]))) return;
                if (!found.some((f) => Math.hypot(f.x - x.x, f.y - x.y) < 2)) found.push(x);
            });
        }
    });
    cutReport.crossings = found;
}

// ------------------------------------------------------------------ 3. figures on the outer edge
// A figure that reaches the outer edge sits a hair inside it (so the engine keeps them apart).
// In the cut file that would give two lines a fraction of a millimetre apart. Here the figure's
// outline is snapped onto the edge and the edge is left out where the figure already cuts it,
// so every line is cut once.
function samplePath(d, step) {
    const holder = document.createElementNS(NS, "svg");
    holder.setAttribute("style", "position:absolute;left:-100000px;top:0");
    document.body.appendChild(holder);
    const out = [];
    d.split(/(?=M)/).forEach((sub) => {
        if (!sub.trim()) return;
        const p = document.createElementNS(NS, "path");
        p.setAttribute("d", sub);
        holder.appendChild(p);
        const len = p.getTotalLength(), n = Math.max(8, Math.ceil(len / step)), pts = [];
        for (let i = 0; i < n; i++) { const q = p.getPointAtLength((len * i) / n); pts.push({ x: q.x, y: q.y }); }
        out.push(pts);
    });
    document.body.removeChild(holder);
    return out;
}

function mergeEdgeFigures() {
    if (!window.lastShapes) return;
    const figs = lastShapes.map((s, i) => ({ s: s, i: i })).filter((o) => o.s.whimsy);
    const borders = lastShapes.filter((s) => !s.whimsy);
    if (!figs.length || !borders.length) return;
    const cell = parseFloat($("cell_scale").value);
    const D = cell + 0.3, STEP = 0.3;

    // index of all border points/segments
    const bHash = new SegHash();
    const borderPolys = borders.map((b) => ({ d: b.d, polys: samplePath(b.d, STEP) }));
    borderPolys.forEach((b) => b.polys.forEach((pl) => hashClosed(bHash, "b", pl)));

    const fHash = new SegHash();
    const figPolys = [];
    figs.forEach((f) => {
        const polys = samplePath(f.s.d, STEP);
        const touches = polys.some((pl) => pl.some((p) => nearest(bHash, p, D)));
        if (!touches) return;
        polys.forEach((pl) => hashClosed(fHash, "f", pl));
        figPolys.push({ d: f.s.d, polys: polys, i: f.i });
    });
    if (!figPolys.length) return;

    const replace = (o, n) => {
        svgstr = svgstr.split('d="' + o + '"').join('d="' + n + '"');
        svgstrsave = svgstrsave.split('d="' + o + '"').join('d="' + n + '"');
    };
    const fmt = (p) => p.x.toFixed(3) + " " + p.y.toFixed(3);

    // figures: points close to the edge move onto it
    figPolys.forEach((f) => {
        const d = f.polys.map((pl) => "M " + pl.map((p) => { const c = nearest(bHash, p, D); return fmt(c ? c.pt : p); }).join(" L ") + " Z").join(" ");
        replace(f.d, d);
        lastShapes[f.i].dCut = d;
    });

    // border: drop the stretches a figure already cuts, keep the rest as open lines
    borderPolys.forEach((b) => {
        let changed = false;
        const parts = [];
        b.polys.forEach((pl) => {
            const covered = pl.map((p) => !!nearest(fHash, p, D));
            if (!covered.some(Boolean)) { parts.push("M " + pl.map(fmt).join(" L ") + " Z"); return; }
            changed = true;
            const n = pl.length;
            let s0 = covered.findIndex((c) => c);           // start right after a covered stretch
            while (covered[(s0 + 1) % n]) s0 = (s0 + 1) % n;
            let run = [pl[s0]];
            for (let k = 1; k <= n; k++) {
                const idx = (s0 + k) % n;
                if (covered[idx]) {
                    if (run.length > 1) { run.push(pl[idx]); parts.push("M " + run.map(fmt).join(" L ")); }
                    run = [pl[idx]];
                } else {
                    run.push(pl[idx]);
                }
            }
            if (run.length > 1) parts.push("M " + run.map(fmt).join(" L "));
        });
        if (changed) replace(b.d, parts.join(" "));
    });
}

function hashClosed(hash, owner, pl) {
    for (let k = 0; k < pl.length; k++) {
        const a = pl[k], b = pl[(k + 1) % pl.length];
        hash.add(owner, a.x, a.y, b.x, b.y);
    }
}

// nearest point on any segment in the hash within r, or null
function nearest(hash, p, r) {
    let best = null, bd = r;
    hash.near(p.x, p.y, r, (s) => {
        const vx = s.bx - s.ax, vy = s.by - s.ay, L2 = vx * vx + vy * vy || 1e-12;
        const t = Math.max(0, Math.min(1, ((p.x - s.ax) * vx + (p.y - s.ay) * vy) / L2));
        const c = { x: s.ax + t * vx, y: s.ay + t * vy }, d = Math.hypot(c.x - p.x, c.y - p.y);
        if (d < bd) { bd = d; best = { pt: c, d: d }; }
    });
    return best;
}
