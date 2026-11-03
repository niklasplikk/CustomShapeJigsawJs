// Jigsaw Workshop — Magic puzzle (shift and reveal).
// The finished puzzle is a row of sections, each a small puzzle with straight outer edges. After it
// is done, the sections are rearranged ("opened") so a gap appears; a set of secret pieces fills the
// gap and the picture changes. The picture lines up across every seam in both arrangements because
// every section edge, and both edges of the secret area, blend into the same narrow seam strip.

function $(id) { return document.getElementById(id); }
const NS = "http://www.w3.org/2000/svg";
const LETTERS = "ABCDEFGH";

const M = {
    W: 400, H: 250,             // closed puzzle, mm
    n: 3,                       // sections
    gapRatio: 1,                // secret area width / section width
    piece: 30,                  // mm
    knob: 13,                   // % of piece size
    seed: Math.floor(Math.random() * 9999),
    open: [0, "G", 1, 2],       // open arrangement: section indexes and "G" for the secret area
    band: 6,                    // seam strip half-width, mm
    secretText: "",
    styleText: "",
    showOpen: false,
    showCuts: true,
};

const PIC = {
    main: null,        // canvas: the closed picture, board aspect
    secret: null,      // canvas: picture of the secret area
    strip: null,       // canvas: the seam strip (2 * band wide)
    sections: [],      // canvases: section pictures after seam blending
    pxPerMm: 6,
    stripX: null,      // where the strip was taken from (mm)
};

// ------------------------------------------------------------------ geometry
function secW() { return M.W / M.n; }
function gapW() { return secW() * M.gapRatio; }
function openWidth() { return M.W + gapW(); }

function defaultOpen(n) {
    // gap in the middle, the section that was left of the middle moves to the far left
    const order = [];
    for (let i = 0; i < n; i++) order.push(i);
    const mid = Math.floor(n / 2);
    order.splice(mid, 0, "G");
    if (n >= 3) { const t = order[0]; order[0] = order[mid + 1]; order[mid + 1] = t; }
    return order;
}

function closedX(i) { return i * secW(); }
function openX(item) {
    let x = 0;
    for (const it of M.open) {
        if (it === item) return x;
        x += it === "G" ? gapW() : secW();
    }
    return 0;
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

function edgePath(v1, v2, rnd) {
    const L = Math.hypot(v2.x - v1.x, v2.y - v1.y);
    const r = Math.min((M.knob / 100) * M.piece, 0.16 * L);
    const f = (p) => p.x.toFixed(3) + " " + p.y.toFixed(3);
    if (r < 1.5) return "M " + f(v1) + " L " + f(v2);
    const j = () => (rnd() - 0.5) * 0.08;
    const segs = knobGeometry(v1, v2, { t: (r / L) * (1 + j()), m: 0.5 + j(), flip: rnd() > 0.5, a: j(), d: j(), e: j() });
    return "M " + f(v1) + " " + segs.map((s) => "C " + s.map(f).join(" ")).join(" ");
}

// A rectangle w x h cut into a grid of pieces with knobs. Returns interior cut paths (outline excluded).
function regionCuts(w, h, seed) {
    const rnd = mulberry32(seed);
    const cols = Math.max(1, Math.round(w / M.piece)), rows = Math.max(1, Math.round(h / M.piece));
    const cw = w / cols, ch = h / rows, jit = 0.08;
    // grid corners, jittered inside, fixed on the outline
    const P = [];
    for (let r = 0; r <= rows; r++) {
        P.push([]);
        for (let c = 0; c <= cols; c++) {
            let x = c * cw, y = r * ch;
            if (c > 0 && c < cols) x += (rnd() - 0.5) * 2 * jit * cw;
            if (r > 0 && r < rows) y += (rnd() - 0.5) * 2 * jit * ch;
            P[r].push({ x: x, y: y });
        }
    }
    const paths = [];
    for (let r = 1; r < rows; r++) for (let c = 0; c < cols; c++) paths.push(edgePath(P[r][c], P[r][c + 1], rnd));
    for (let c = 1; c < cols; c++) for (let r = 0; r < rows; r++) paths.push(edgePath(P[r][c], P[r + 1][c], rnd));
    return { paths: paths, pieces: rows * cols, rows: rows, cols: cols };
}

let CUTS = { sections: [], secret: null };
function buildCuts() {
    CUTS.sections = [];
    for (let i = 0; i < M.n; i++) CUTS.sections.push(regionCuts(secW(), M.H, M.seed * 31 + i * 7 + 1));
    CUTS.secret = regionCuts(gapW(), M.H, M.seed * 31 + 997);
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

async function setMainPicture(img, keepSecret) {
    // working resolution: the picture's own, but at least 4 px per mm and at most 3600 px wide
    PIC.mainImg = img;
    PIC.pxPerMm = Math.max(4, Math.min(3600 / M.W, (img.naturalWidth || img.width) / M.W));
    PIC.main = coverCanvas(img, M.W * PIC.pxPerMm, M.H * PIC.pxPerMm);
    if (!keepSecret) { PIC.secret = null; PIC.secretBlended = null; }
    rebuildPictures();
}

// The calmest vertical strip in the picture becomes the seam strip.
function chooseStrip() {
    const k = PIC.pxPerMm, bw = Math.round(2 * M.band * k);
    const w = PIC.main.width, h = PIC.main.height;
    const small = canvasOf(Math.min(400, w), Math.round(Math.min(400, w) * h / w));
    small.getContext("2d").drawImage(PIC.main, 0, 0, small.width, small.height);
    const d = small.getContext("2d").getImageData(0, 0, small.width, small.height).data;
    const sw = small.width, sh = small.height, sc = sw / w;
    const energy = new Float32Array(sw);
    for (let x = 1; x < sw - 1; x++) for (let y = 1; y < sh - 1; y++) {
        const i = (y * sw + x) * 4, lum = (j) => d[j] * 0.3 + d[j + 1] * 0.59 + d[j + 2] * 0.11;
        energy[x] += Math.abs(lum(i + 4) - lum(i - 4)) + Math.abs(lum(i + sw * 4) - lum(i - sw * 4));
    }
    const half = Math.max(1, Math.round((bw / 2) * sc));
    let best = -1, bestE = Infinity;
    for (let x = half + 1; x < sw - half - 1; x++) {
        let e = 0;
        for (let q = x - half; q <= x + half; q++) e += energy[q];
        if (e < bestE) { bestE = e; best = x; }
    }
    const cx = Math.round(best / sc);
    PIC.stripX = cx / k;
    const strip = canvasOf(bw, h);
    strip.getContext("2d").drawImage(PIC.main, cx - bw / 2, 0, bw, h, 0, 0, bw, h);
    PIC.strip = strip;
}

// Blend the seam strip into both side edges of a picture: its left edge gets the strip's right
// half, its right edge the strip's left half, so any two pieces of picture meet seamlessly.
function blendEdges(src) {
    const c = canvasOf(src.width, src.height), cx = c.getContext("2d");
    cx.drawImage(src, 0, 0);
    const bw = PIC.strip.width, half = bw / 2, h = c.height;
    const fade = Math.max(2, Math.round(half));
    // left edge: strip right half, fading out over the band
    for (let x = 0; x < fade; x++) {
        cx.globalAlpha = 1 - x / fade;
        cx.drawImage(PIC.strip, half + Math.min(x, half - 1), 0, 1, h, x, 0, 1, h);
    }
    // right edge: strip left half
    for (let x = 0; x < fade; x++) {
        cx.globalAlpha = 1 - x / fade;
        cx.drawImage(PIC.strip, Math.max(0, half - 1 - x), 0, 1, h, c.width - 1 - x, 0, 1, h);
    }
    cx.globalAlpha = 1;
    return c;
}

function rebuildPictures() {
    if (!PIC.main) return;
    chooseStrip();
    const k = PIC.pxPerMm, sw = secW() * k;
    PIC.sections = [];
    for (let i = 0; i < M.n; i++) {
        const s = canvasOf(sw, PIC.main.height);
        s.getContext("2d").drawImage(PIC.main, i * sw, 0, sw, PIC.main.height, 0, 0, sw, PIC.main.height);
        PIC.sections.push(blendEdges(s));
    }
    if (PIC.secret) PIC.secretBlended = blendEdges(fitSecret(PIC.secret));
}

function fitSecret(img) {
    return coverCanvas(img, gapW() * PIC.pxPerMm, M.H * PIC.pxPerMm);
}

// The open arrangement as one picture, with the secret area left empty (transparent) or filled.
function openComposite(withSecret, fill) {
    const k = PIC.pxPerMm, c = canvasOf(openWidth() * k, M.H * k), cx = c.getContext("2d");
    for (const it of M.open) {
        const x = openX(it) * k;
        if (it === "G") {
            if (withSecret && PIC.secretBlended) cx.drawImage(PIC.secretBlended, x, 0);
            else if (fill) { cx.fillStyle = fill; cx.fillRect(x, 0, gapW() * k, c.height); }
        } else {
            cx.drawImage(PIC.sections[it], x, 0);
        }
    }
    return c;
}

function closedComposite() {
    const k = PIC.pxPerMm, c = canvasOf(M.W * k, M.H * k), cx = c.getContext("2d");
    PIC.sections.forEach((s, i) => cx.drawImage(s, closedX(i) * k, 0));
    return c;
}

// cut the secret area out of a filled-in open picture
function takeSecretFrom(img) {
    const k = PIC.pxPerMm, full = coverCanvas(img, openWidth() * k, M.H * k);
    const g = canvasOf(gapW() * k, M.H * k);
    g.getContext("2d").drawImage(full, openX("G") * k, 0, g.width, g.height, 0, 0, g.width, g.height);
    PIC.secret = g;
    PIC.secretBlended = blendEdges(g);
}

// ------------------------------------------------------------------ prompts
function secretPrompt() {
    const what = M.secretText.trim() || "something surprising that changes the story of the picture";
    return "This is an illustration with an empty grey area. Paint the grey area so the illustration continues seamlessly " +
        "into it, in exactly the same art style, colours and lighting as the rest. Keep everything outside the grey area " +
        "unchanged. In the new area, show: " + what + "." + (M.styleText.trim() ? " Style: " + M.styleText.trim() + "." : "");
}

function mainPrompt() {
    const ratio = (M.W / M.H).toFixed(2);
    return "A wide, detailed illustration for a jigsaw puzzle, aspect ratio " + ratio + ":1. " +
        (M.styleText.trim() || "Colourful storybook style.") + " The scene is laid out as " + M.n +
        " parts side by side, each with its own little story. Keep the sky and the ground simple where the parts meet, " +
        "with the horizon at the same height across the whole picture.";
}

// ------------------------------------------------------------------ AI (OpenAI image API, the user's own key)
function apiKey() { try { return localStorage.getItem("jw-openai-key") || ""; } catch (e) { return ""; } }

function toBlob(canvas) { return new Promise((resolve) => canvas.toBlob(resolve, "image/png")); }

// fit a canvas into one of the API's sizes, keeping its aspect; returns the canvas and where it sits
function fitApi(src) {
    const sizes = [[1024, 1024], [1536, 1024], [1024, 1536]];
    const ar = src.width / src.height;
    const [w, h] = sizes.reduce((b, s) => (Math.abs(Math.log(s[0] / s[1] / ar)) < Math.abs(Math.log(b[0] / b[1] / ar)) ? s : b));
    const s = Math.min(w / src.width, h / src.height);
    const box = { x: (w - src.width * s) / 2, y: (h - src.height * s) / 2, w: src.width * s, h: src.height * s };
    const c = canvasOf(w, h);
    c.getContext("2d").drawImage(src, box.x, box.y, box.w, box.h);
    return { canvas: c, box: box, size: w + "x" + h };
}

async function aiRequest(path, form) {
    if (window.MAGIC_FAKE_AI) return window.MAGIC_FAKE_AI(path, form);
    const res = await fetch("https://api.openai.com/v1/images/" + path, {
        method: "POST", headers: { Authorization: "Bearer " + apiKey() }, body: form,
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error((j.error && j.error.message) || "The image service answered " + res.status + ".");
    const b64 = j.data && j.data[0] && j.data[0].b64_json;
    if (!b64) throw new Error("The image service didn't return a picture.");
    return loadImage("data:image/png;base64," + b64);
}

async function aiSecret() {
    const comp = openComposite(false, null);               // gap transparent = to be painted
    const fit = fitApi(comp);
    // everything outside the puzzle in the API canvas may be painted too; we crop it away
    const form = new FormData();
    form.append("model", "gpt-image-1");
    form.append("prompt", secretPrompt());
    form.append("size", fit.size);
    form.append("image", await toBlob(fit.canvas), "open.png");
    const img = await aiRequest("edits", form);
    const back = canvasOf(comp.width, comp.height);
    back.getContext("2d").drawImage(img, fit.box.x * img.width / fit.canvas.width, fit.box.y * img.height / fit.canvas.height,
        fit.box.w * img.width / fit.canvas.width, fit.box.h * img.height / fit.canvas.height, 0, 0, back.width, back.height);
    takeSecretFrom(back);
}

async function aiMain() {
    const form = new FormData();
    form.append("model", "gpt-image-1");
    form.append("prompt", mainPrompt());
    form.append("size", M.W / M.H > 1.2 ? "1536x1024" : M.W / M.H < 0.8 ? "1024x1536" : "1024x1024");
    // generations take JSON, not a form
    let img;
    if (window.MAGIC_FAKE_AI) img = await window.MAGIC_FAKE_AI("generations", form);
    else {
        const res = await fetch("https://api.openai.com/v1/images/generations", {
            method: "POST",
            headers: { Authorization: "Bearer " + apiKey(), "Content-Type": "application/json" },
            body: JSON.stringify({ model: "gpt-image-1", prompt: mainPrompt(), size: form.get("size") }),
        });
        const j = await res.json().catch(() => ({}));
        if (!res.ok) throw new Error((j.error && j.error.message) || "The image service answered " + res.status + ".");
        img = await loadImage("data:image/png;base64," + j.data[0].b64_json);
    }
    await setMainPicture(img);
}

// ------------------------------------------------------------------ preview
function render() {
    buildCuts();
    const stage = $("stage");
    const k = PIC.pxPerMm;
    const OW = openWidth(), pad = 8;
    const secretRow = M.H + 18;                    // where the secret pieces wait while the puzzle is closed
    const totalH = M.showOpen ? M.H : M.H + 18 + M.H;
    stage.setAttribute("viewBox", [-pad, -pad, OW + 2 * pad, totalH + 2 * pad].join(" "));
    let html = '<defs><clipPath id="clipSec"><rect width="' + secW() + '" height="' + M.H + '"/></clipPath>' +
        '<clipPath id="clipGap"><rect width="' + gapW() + '" height="' + M.H + '"/></clipPath></defs>';
    const group = (i, x, y, w, img, cuts, label, cls) => {
        let g = '<g class="region ' + cls + '" style="transform: translate(' + x + 'px,' + y + 'px)">';
        g += img ? '<image href="' + img + '" width="' + w + '" height="' + M.H + '" preserveAspectRatio="none"/>' :
            '<rect class="blank" width="' + w + '" height="' + M.H + '"/>';
        if (M.showCuts) g += '<g class="cuts">' + cuts.paths.map((d) => '<path d="' + d + '"/>').join("") + "</g>";
        g += '<rect class="outline" width="' + w + '" height="' + M.H + '"/>';
        g += '<text class="tag" x="' + (w / 2) + '" y="' + (M.H / 2) + '">' + label + "</text>";
        return g + "</g>";
    };
    const imgs = PIC.sections.map((c) => c.toDataURL("image/jpeg", 0.85));
    for (let i = 0; i < M.n; i++) {
        const x = M.showOpen ? openX(i) : closedX(i);
        html += group(i, x, 0, secW(), imgs[i], CUTS.sections[i], LETTERS[i], "sec");
    }
    const gx = M.showOpen ? openX("G") : (OW - gapW()) / 2, gy = M.showOpen ? 0 : secretRow;
    html += group("G", gx, gy, gapW(), PIC.secretBlended ? PIC.secretBlended.toDataURL("image/jpeg", 0.85) : null, CUTS.secret, "★", "gap" + (M.showOpen ? "" : " waiting"));
    stage.innerHTML = html;
    stage.classList.toggle("nopic", !PIC.main);

    const pieces = CUTS.sections.reduce((s, c) => s + c.pieces, 0);
    $("stat-size").textContent = Math.round(M.W) + " × " + Math.round(M.H) + " mm → " + Math.round(OW) + " × " + Math.round(M.H) + " mm";
    $("stat-pieces").textContent = pieces + " pieces + " + CUTS.secret.pieces + " secret";
    $("download").disabled = false;
    $("printBtn").disabled = !PIC.main;
    renderOrder();
    updatePictureUI();
    scheduleSave();
}

function setOpen(open) {
    M.showOpen = open;
    document.querySelectorAll("#viewSeg button").forEach((b) => b.setAttribute("aria-pressed", (b.dataset.v === "open") === open));
    render();
}

// ------------------------------------------------------------------ open arrangement editor
function renderOrder() {
    const box = $("order");
    box.innerHTML = "";
    M.open.forEach((it, idx) => {
        const tile = document.createElement("div");
        tile.className = "tile" + (it === "G" ? " gap" : "");
        tile.innerHTML = '<button type="button" class="mv" aria-label="Move left"' + (idx === 0 ? " disabled" : "") + ">‹</button>" +
            "<span>" + (it === "G" ? "★" : LETTERS[it]) + "</span>" +
            '<button type="button" class="mv" aria-label="Move right"' + (idx === M.open.length - 1 ? " disabled" : "") + ">›</button>";
        const [l, r] = tile.querySelectorAll("button");
        l.onclick = () => { const o = M.open; [o[idx - 1], o[idx]] = [o[idx], o[idx - 1]]; afterArrangementChange(); };
        r.onclick = () => { const o = M.open; [o[idx + 1], o[idx]] = [o[idx], o[idx + 1]]; afterArrangementChange(); };
        box.appendChild(tile);
    });
    $("closedOrder").textContent = LETTERS.slice(0, M.n).split("").join(" ");
}

function afterArrangementChange() {
    // the secret picture was painted for the old neighbours
    if (PIC.secret) $("secretStale").hidden = false;
    rebuildPictures();
    render();
}

// ------------------------------------------------------------------ export
function cutSvg() {
    // closed board: outline, straight seams once, all pieces; secret pieces in their own frame beside it
    const gx = M.W + 10;
    let p = [];
    p.push('<rect x="0" y="0" width="' + M.W + '" height="' + M.H + '"/>');
    for (let i = 1; i < M.n; i++) p.push('<path d="M ' + closedX(i) + " 0 L " + closedX(i) + " " + M.H + '"/>');
    CUTS.sections.forEach((c, i) => p.push('<g transform="translate(' + closedX(i) + ' 0)">' + c.paths.map((d) => '<path d="' + d + '"/>').join("") + "</g>"));
    p.push('<rect x="' + gx + '" y="0" width="' + gapW() + '" height="' + M.H + '"/>');
    p.push('<g transform="translate(' + gx + ' 0)">' + CUTS.secret.paths.map((d) => '<path d="' + d + '"/>').join("") + "</g>");
    const W = gx + gapW();
    return '<svg viewBox="0 0 ' + W + " " + M.H + '" width="' + W + 'mm" height="' + M.H + 'mm" version="1.1" xmlns="http://www.w3.org/2000/svg">' +
        '<g fill="none" stroke="black" stroke-width="0.1">' + p.join("") + "</g></svg>";
}

// export.js works on the global svgstrsave; it reads transforms only through parsePathD, so flatten them first
function flatCutSvg() {
    const doc = new DOMParser().parseFromString(cutSvg(), "image/svg+xml");
    const out = [];
    doc.querySelectorAll("rect").forEach((r) => {
        const x = +r.getAttribute("x"), y = +r.getAttribute("y"), w = +r.getAttribute("width"), h = +r.getAttribute("height");
        out.push("M " + x + " " + y + " H " + (x + w) + " V " + (y + h) + " H " + x + " Z");
    });
    doc.querySelectorAll("path").forEach((pth) => {
        const g = pth.parentNode, m = g.getAttribute && g.getAttribute("transform");
        const dx = m ? parseFloat(m.match(/translate\(([-\d.]+)/)[1]) : 0;
        const d = pth.getAttribute("d");
        out.push(dx ? parsePathD(d).map((sp) => "M " + (sp.start.x + dx) + " " + sp.start.y + " " + sp.segs.map((s) => s.t === "L" ? "L " + (s.p.x + dx) + " " + s.p.y :
            "C " + [s.c1, s.c2, s.p].map((q) => (q.x + dx) + " " + q.y).join(" ")).join(" ") + (sp.closed ? " Z" : "")).join(" ") : d);
    });
    const W = M.W + 10 + gapW();
    return '<svg viewBox="0 0 ' + W + " " + M.H + '" width="' + W + 'mm" height="' + M.H + 'mm" version="1.1" xmlns="http://www.w3.org/2000/svg">' +
        out.map((d) => '<path fill="none" stroke="black" stroke-width="0.1" d="' + d + '"/>').join("") + "</svg>";
}

function download(fmt) {
    window.svgstrsave = flatCutSvg();
    const base = "magic-puzzle-" + Math.round(M.W) + "x" + Math.round(M.H) + "mm";
    if (fmt === "pdf") saveBlob(base + ".pdf", buildPdf(), "application/pdf");
    else if (fmt === "dxf") saveBlob(base + ".dxf", buildDxf(), "application/dxf");
    else saveBlob(base + ".svg", '<?xml version="1.0" encoding="UTF-8"?>\n' + svgstrsave, "image/svg+xml");
}

// pictures to print on the wood before cutting, laid out exactly like the cut file
function downloadPrint() {
    const k = PIC.pxPerMm, gx = M.W + 10;
    const c = canvasOf((gx + gapW()) * k, M.H * k), cx = c.getContext("2d");
    cx.fillStyle = "#fff"; cx.fillRect(0, 0, c.width, c.height);
    cx.drawImage(closedComposite(), 0, 0);
    if (PIC.secretBlended) cx.drawImage(PIC.secretBlended, gx * k, 0);
    c.toBlob((b) => saveBlob("magic-puzzle-print-" + Math.round(k * 25.4) + "dpi.png", b, "image/png"), "image/png");
}

function downloadTemplate() {
    const c = openComposite(false, "#808080");
    c.toBlob((b) => saveBlob("magic-puzzle-secret-template.png", b, "image/png"), "image/png");
}

// ------------------------------------------------------------------ saving in this browser
let saveTimer = null;
function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
        try {
            const s = Object.assign({}, M);
            localStorage.setItem("jw-magic-settings", JSON.stringify(s));
        } catch (e) { /* storage blocked */ }
    }, 500);
}
function loadSaved() {
    try {
        const s = JSON.parse(localStorage.getItem("jw-magic-settings") || "null");
        if (s && s.n) Object.assign(M, s, { showOpen: false });
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
    $("secretDone").hidden = !PIC.secretBlended;
}

function syncInputs() {
    $("mW").value = M.W; $("mH").value = M.H; $("mN").value = M.n;
    $("mGap").value = M.gapRatio; $("mGapOut").textContent = Math.round(gapW()) + " mm";
    $("mPiece").value = M.piece; $("mPieceOut").textContent = M.piece + " mm";
    $("secretText").value = M.secretText; $("styleText").value = M.styleText;
    $("showCuts").checked = M.showCuts;
}

function init() {
    loadSaved();
    syncInputs();
    const num = (id, key, min, max, after) => $(id).addEventListener("input", () => {
        const v = parseFloat($(id).value);
        if (v >= min && v <= max) { M[key] = v; if (after) after(); rebuildPictures(); render(); }
    });
    num("mW", "W", 60, 2000, () => { if (PIC.mainImg) setMainPicture(PIC.mainImg, true); });
    num("mH", "H", 60, 2000, () => { if (PIC.mainImg) setMainPicture(PIC.mainImg, true); });
    $("mN").addEventListener("change", () => {
        M.n = parseInt($("mN").value); M.open = defaultOpen(M.n); PIC.secret = null; PIC.secretBlended = null;
        if (PIC.mainImg) setMainPicture(PIC.mainImg);
        render();
    });
    $("mGap").addEventListener("input", () => { M.gapRatio = +$("mGap").value; $("mGapOut").textContent = Math.round(gapW()) + " mm"; if (PIC.secret) PIC.secretBlended = blendEdges(fitSecret(PIC.secret)); render(); });
    $("mPiece").addEventListener("input", () => { M.piece = +$("mPiece").value; $("mPieceOut").textContent = M.piece + " mm"; render(); });
    $("variant").addEventListener("click", () => { M.seed = Math.floor(Math.random() * 9999); render(); });
    $("showCuts").addEventListener("change", (e) => { M.showCuts = e.target.checked; render(); });
    document.querySelectorAll("#viewSeg button").forEach((b) => b.addEventListener("click", () => setOpen(b.dataset.v === "open")));
    $("resetOrder").addEventListener("click", () => { M.open = defaultOpen(M.n); afterArrangementChange(); });
    $("secretText").addEventListener("input", (e) => { M.secretText = e.target.value; scheduleSave(); });
    $("styleText").addEventListener("input", (e) => { M.styleText = e.target.value; scheduleSave(); });

    $("mainFile").addEventListener("change", async (e) => {
        const f = e.target.files[0]; e.target.value = "";
        if (!f) return;
        try {
            const img = await loadImage(URL.createObjectURL(f));
            await setMainPicture(img);
            warn(""); render();
        } catch (err) { warn(err.message); }
    });
    $("secretFile").addEventListener("change", async (e) => {
        const f = e.target.files[0]; e.target.value = "";
        if (!f) return;
        try {
            const img = await loadImage(URL.createObjectURL(f));
            // a whole open picture (from the template) or just the secret area
            const ar = img.naturalWidth / img.naturalHeight, openAr = openWidth() / M.H;
            if (Math.abs(Math.log(ar / openAr)) < Math.abs(Math.log(ar / (gapW() / M.H)))) takeSecretFrom(img);
            else { PIC.secret = fitSecret(img); PIC.secretBlended = blendEdges(PIC.secret); }
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
        catch (e) { $("promptText").hidden = false; $("promptText").value = t; $("promptText").select(); }
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
        try { await aiMain(); warn(""); render(); }
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
    if (!M.open || M.open.length !== M.n + 1) M.open = defaultOpen(M.n);
    render();
}

window.addEventListener("load", init);
