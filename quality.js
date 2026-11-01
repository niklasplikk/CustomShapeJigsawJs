// Quality checks for laser cutting.
//  1. beforePaint(): runs on the engine's cell grid before edges are traced. Fills pockets no piece
//     reached and merges pieces that are too small or too thin into a neighbour.
//  2. checkCuts(): runs on the finished vector lines. Every knob must keep a clearance from every
//     other line; knobs that collide are flipped, moved or shrunk, and straightened as a last resort.
//     Anything that still crosses is reported and marked in the preview.

var cutReport = { merged: 0, filled: 0, fixed: 0, straightened: 0, crossings: [] };

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
            const thin = (2 * A) / (per.get(l) || 1) < minWidth;
            if ((A < minArea || thin) && A < vArea) { victim = l; vArea = A; }
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
    $("piececount").innerHTML = labels.size;
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
        const oldD = e.d, oldL = e.L;
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
