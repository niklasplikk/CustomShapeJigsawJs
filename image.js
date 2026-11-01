// Image processing for the puzzle generator: background detection, magic-wand selection,
// mask clean-up and tracing a mask into a smooth outline. All work happens on a downscaled
// copy (max PROC_MAX px) of the photo; outlines are returned in original image pixels.

const PROC_MAX = 900;

const IMG = {
    url: null, name: "", w: 0, h: 0,   // original size
    pw: 0, ph: 0, k: 1,                // processing size, k = original px per processing px
    rgb: null,                         // Uint8ClampedArray RGBA, processing size
    bg: null,                          // {path, box} when the photo has a plain background
};

function loadImageFile(file) {
    return new Promise((resolve, reject) => {
        const url = URL.createObjectURL(file);
        const im = new Image();
        im.onload = () => {
            const k = Math.max(1, Math.max(im.naturalWidth, im.naturalHeight) / PROC_MAX);
            const pw = Math.round(im.naturalWidth / k), ph = Math.round(im.naturalHeight / k);
            const cv = document.createElement("canvas");
            cv.width = pw; cv.height = ph;
            const cx = cv.getContext("2d", { willReadFrequently: true });
            cx.drawImage(im, 0, 0, pw, ph);
            if (IMG.url) URL.revokeObjectURL(IMG.url);
            Object.assign(IMG, {
                url: url, name: file.name, w: im.naturalWidth, h: im.naturalHeight,
                pw: pw, ph: ph, k: im.naturalWidth / pw, rgb: cx.getImageData(0, 0, pw, ph).data, bg: null,
            });
            IMG.bg = detectBackground();
            resolve(IMG);
        };
        im.onerror = () => reject(new Error("Kunne ikke lese bildet."));
        im.src = url;
    });
}

// ------------------------------------------------------------------ helpers
function colAt(i) { const d = IMG.rgb; return [d[i * 4], d[i * 4 + 1], d[i * 4 + 2], d[i * 4 + 3]]; }
function cdist(a, b) { return Math.sqrt((a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2); }

// 4-connected flood fill over pixels where accept(i) is true, starting from the seed list
function flood(seeds, accept, W, H) {
    const out = new Uint8Array(W * H);
    const stack = new Int32Array(W * H);
    let sp = 0;
    seeds.forEach((i) => { if (!out[i] && accept(i)) { out[i] = 1; stack[sp++] = i; } });
    while (sp) {
        const i = stack[--sp], x = i % W;
        const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < W * (H - 1) ? i + W : -1];
        for (const n of nb) if (n >= 0 && !out[n] && accept(n)) { out[n] = 1; stack[sp++] = n; }
    }
    return out;
}

// chamfer distance (in px) from every pixel to the nearest pixel where src[i] === 1
function distanceTo(src, W, H) {
    const INF = 1e9, d = new Float32Array(W * H), D = 1.4142;
    for (let i = 0; i < W * H; i++) d[i] = src[i] ? 0 : INF;
    for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const i = y * W + x; let v = d[i];
        if (x > 0) v = Math.min(v, d[i - 1] + 1);
        if (y > 0) {
            v = Math.min(v, d[i - W] + 1);
            if (x > 0) v = Math.min(v, d[i - W - 1] + D);
            if (x < W - 1) v = Math.min(v, d[i - W + 1] + D);
        }
        d[i] = v;
    }
    for (let y = H - 1; y >= 0; y--) for (let x = W - 1; x >= 0; x--) {
        const i = y * W + x; let v = d[i];
        if (x < W - 1) v = Math.min(v, d[i + 1] + 1);
        if (y < H - 1) {
            v = Math.min(v, d[i + W] + 1);
            if (x < W - 1) v = Math.min(v, d[i + W + 1] + D);
            if (x > 0) v = Math.min(v, d[i + W - 1] + D);
        }
        d[i] = v;
    }
    return d;
}

function dilate(m, r, W, H) {
    const d = distanceTo(m, W, H), o = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) o[i] = d[i] <= r ? 1 : 0;
    return o;
}
function erode(m, r, W, H) {
    const inv = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) inv[i] = m[i] ? 0 : 1;
    // pixels outside the image count as background
    for (let x = 0; x < W; x++) { inv[x] = 1; inv[(H - 1) * W + x] = 1; }
    for (let y = 0; y < H; y++) { inv[y * W] = 1; inv[y * W + W - 1] = 1; }
    const d = distanceTo(inv, W, H), o = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) o[i] = m[i] && d[i] > r ? 1 : 0;
    return o;
}
function closeMask(m, r, W, H) { return r > 0 ? erode(dilate(m, r, W, H), r, W, H) : m; }

function fillHoles(m, W, H) {
    const border = [];
    for (let x = 0; x < W; x++) border.push(x, (H - 1) * W + x);
    for (let y = 0; y < H; y++) border.push(y * W, y * W + W - 1);
    const outside = flood(border, (i) => !m[i], W, H);
    const o = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) o[i] = outside[i] ? 0 : 1;
    return o;
}

function largestComponent(m, W, H) {
    const lab = new Int32Array(W * H);
    let best = 0, bestSize = 0, n = 0;
    const stack = new Int32Array(W * H);
    for (let s = 0; s < W * H; s++) {
        if (!m[s] || lab[s]) continue;
        n++; let sp = 0, size = 0;
        lab[s] = n; stack[sp++] = s;
        while (sp) {
            const i = stack[--sp], x = i % W; size++;
            const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < W * (H - 1) ? i + W : -1];
            for (const q of nb) if (q >= 0 && m[q] && !lab[q]) { lab[q] = n; stack[sp++] = q; }
        }
        if (size > bestSize) { bestSize = size; best = n; }
    }
    const o = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) o[i] = lab[i] === best && best ? 1 : 0;
    return { mask: o, size: bestSize };
}

function maskArea(m) { let a = 0; for (let i = 0; i < m.length; i++) a += m[i]; return a; }

// ------------------------------------------------------------------ tracing
// Marching-squares perimeter of a single blob; returns pixel-corner points in processing px.
function traceMask(m, W, H) {
    const at = (x, y) => (x >= 0 && y >= 0 && x < W && y < H && m[y * W + x]) ? 1 : 0;
    let sx = -1, sy = -1;
    for (let i = 0; i < W * H; i++) if (m[i]) { sx = i % W; sy = (i / W) | 0; break; }
    if (sx < 0) return [];
    const pts = [];
    let x = sx, y = sy, dx = 0, dy = 0, pdx = 0, pdy = 0, guard = 0;
    do {
        const s = at(x - 1, y - 1) + 2 * at(x, y - 1) + 4 * at(x - 1, y) + 8 * at(x, y);
        switch (s) {
            case 1: case 5: case 13: dx = 0; dy = -1; break;
            case 8: case 10: case 11: dx = 0; dy = 1; break;
            case 4: case 12: case 14: dx = -1; dy = 0; break;
            case 2: case 3: case 7: dx = 1; dy = 0; break;
            case 6: if (pdx === 0 && pdy === -1) { dx = -1; dy = 0; } else { dx = 1; dy = 0; } break;
            case 9: if (pdx === 1 && pdy === 0) { dx = 0; dy = -1; } else { dx = 0; dy = 1; } break;
            default: dx = 1; dy = 0;
        }
        if (dx !== pdx || dy !== pdy || !pts.length) pts.push({ x: x, y: y });
        x += dx; y += dy; pdx = dx; pdy = dy;
    } while ((x !== sx || y !== sy) && ++guard < 4 * W * H);
    return pts;
}

function simplifyRDP(pts, eps) {
    if (pts.length < 4) return pts;
    const keep = new Uint8Array(pts.length);
    keep[0] = keep[pts.length - 1] = 1;
    const stack = [[0, pts.length - 1]];
    while (stack.length) {
        const [a, b] = stack.pop();
        let md = 0, mi = -1;
        const A = pts[a], B = pts[b], vx = B.x - A.x, vy = B.y - A.y, L = Math.hypot(vx, vy);
        for (let i = a + 1; i < b; i++) {
            // closed outlines start and end on the same point: use plain distance there
            const d = L < 1e-9 ? Math.hypot(pts[i].x - A.x, pts[i].y - A.y)
                : Math.abs((pts[i].x - A.x) * vy - (pts[i].y - A.y) * vx) / L;
            if (d > md) { md = d; mi = i; }
        }
        if (md > eps) { keep[mi] = 1; stack.push([a, mi], [mi, b]); }
    }
    return pts.filter((_, i) => keep[i]);
}

function chaikin(pts, iterations) {
    let p = pts;
    for (let it = 0; it < iterations; it++) {
        const q = [];
        for (let i = 0; i < p.length; i++) {
            const a = p[i], b = p[(i + 1) % p.length];
            q.push({ x: 0.75 * a.x + 0.25 * b.x, y: 0.75 * a.y + 0.25 * b.y });
            q.push({ x: 0.25 * a.x + 0.75 * b.x, y: 0.25 * a.y + 0.75 * b.y });
        }
        p = q;
    }
    return p;
}

// mask (processing px) -> smooth closed outline in original px, plus its bounding box
function maskToOutline(m) {
    const W = IMG.pw, H = IMG.ph;
    let pts = traceMask(m, W, H);
    if (pts.length < 8) return null;
    // split long straight runs so smoothing keeps their shape, then simplify and round off
    pts = pts.concat([pts[0]]);
    pts = simplifyRDP(pts, 0.8).slice(0, -1);
    pts = chaikin(pts, 3);
    pts = simplifyRDP(pts.concat([pts[0]]), 0.2).slice(0, -1);
    pts = pts.map((p) => ({ x: p.x * IMG.k, y: p.y * IMG.k }));
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    pts.forEach((p) => { x0 = Math.min(x0, p.x); y0 = Math.min(y0, p.y); x1 = Math.max(x1, p.x); y1 = Math.max(y1, p.y); });
    const d = "M " + pts.map((p) => p.x.toFixed(1) + " " + p.y.toFixed(1)).join(" L ") + " Z";
    return { d: d, pts: pts, box: { x: x0, y: y0, w: x1 - x0, h: y1 - y0 } };
}

// ------------------------------------------------------------------ background
// A plain (white, single-colour) background around the motif becomes the puzzle outline.
function detectBackground() {
    const W = IMG.pw, H = IMG.ph;
    const corners = [[2, 2], [W - 3, 2], [2, H - 3], [W - 3, H - 3]].map(([x, y]) => colAt(y * W + x));
    const mean = [0, 1, 2].map((c) => corners.reduce((s, k) => s + k[c], 0) / 4);
    const transparent = corners.every((k) => k[3] < 20);
    if (!transparent && corners.some((k) => cdist(k, mean) > 30)) return null;
    const tol = 38;
    const isBg = transparent ? (i) => IMG.rgb[i * 4 + 3] < 40 : (i) => cdist(colAt(i), mean) < tol;
    const border = [];
    for (let x = 0; x < W; x++) border.push(x, (H - 1) * W + x);
    for (let y = 0; y < H; y++) border.push(y * W, y * W + W - 1);
    const bg = flood(border, isBg, W, H);
    const bgArea = maskArea(bg);
    if (bgArea < 0.05 * W * H || bgArea > 0.92 * W * H) return null;
    let fg = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) fg[i] = bg[i] ? 0 : 1;
    const big = largestComponent(fg, W, H);
    if (big.size < 0.8 * (W * H - bgArea)) return null;   // several separate motifs: no single outline
    fg = closeMask(fillHoles(big.mask, W, H), 2, W, H);
    const out = maskToOutline(fg);
    if (out) out.mask = fg;
    return out;
}

// ------------------------------------------------------------------ magic wand
// Selects the connected area of similar colour around a pixel (processing px).
function wandAt(px, py, tol) {
    const W = IMG.pw, H = IMG.ph;
    const x = Math.max(0, Math.min(W - 1, Math.round(px))), y = Math.max(0, Math.min(H - 1, Math.round(py)));
    const seed = colAt(y * W + x);
    return flood([y * W + x], (i) => cdist(colAt(i), seed) < tol, W, H);
}

// Turn the clicked regions into one solid figure: bridge the dark drawing lines between
// regions, fill holes, keep the biggest part and grow it to include the outer contour line.
function finishSelection(sel) {
    const W = IMG.pw, H = IMG.ph, big = Math.max(W, H);
    let m = closeMask(sel, Math.max(2, Math.round(big * 0.012)), W, H);
    m = fillHoles(m, W, H);
    m = largestComponent(m, W, H).mask;
    m = dilate(m, Math.max(1, Math.round(big * 0.004)), W, H);
    m = fillHoles(m, W, H);
    return m;
}

// coloured overlay of a mask for the preview, as a data URL
function maskOverlayURL(m, rgba) {
    const cv = document.createElement("canvas");
    cv.width = IMG.pw; cv.height = IMG.ph;
    const cx = cv.getContext("2d");
    const im = cx.createImageData(IMG.pw, IMG.ph);
    for (let i = 0; i < m.length; i++) if (m[i]) { im.data[i * 4] = rgba[0]; im.data[i * 4 + 1] = rgba[1]; im.data[i * 4 + 2] = rgba[2]; im.data[i * 4 + 3] = rgba[3]; }
    cx.putImageData(im, 0, 0);
    return cv.toDataURL();
}
