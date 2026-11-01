// Puslespillgenerator — UI layer on top of engine.js (CustomShapeJigsawJs by proceduraljigsaw, MIT).
// The engine still reads its settings from the hidden #engine inputs; this file fills them in,
// runs generate() and draws the result on the preview stage.

const NS = "http://www.w3.org/2000/svg";
const STYLE_NOISE = { classic: 0.12, organic: 0.5, wild: 0.9 };
const S = {
    shape: "rect",          // "rect" | "image" (outline traced from the photo) | "svg"
    w: 300, h: 200,         // rectangle size, mm
    border: null,           // SVG outline: {name, natW, natH, svg}
    borderW: 200,           // wanted width of the SVG outline, mm
    imgW: 300,              // wanted width of the outline traced from the photo, mm
    piece: 30,              // approximate piece size, mm
    style: "classic",
    knob: 13,               // knob head radius, % of piece size
    seed: Math.floor(Math.random() * 9999),
    showImage: true,
};

let generated = false;

// ------------------------------------------------------------------ knobs
// Classic knob: flat shoulders, narrow neck, round head. Sized from the piece size
// rather than the edge length, so every piece gets the same, proper-sized knobs.
// Every edge is logged in edgeLog so quality.js can test it and redraw it if it
// collides with another line.
let edgeLog = [];

function knobGeometry(v1, v2, k) {
    // k: {t, m, flip, a, d, e}; returns absolute cubic segments [[p0,c1,c2,p3], ...]
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
    let prev = { x: v1.x, y: v1.y };
    return rel.map((seg) => { const abs = [prev].concat(seg.map(at)); prev = abs[3]; return abs; });
}

function knobD(v1, segs) {
    const f = (p) => p.x + " " + p.y;
    return "M " + f(v1) + " " + segs.map((s) => "C " + f(s[1]) + " " + f(s[2]) + " " + f(s[3])).join(" ") + " ";
}

function straightD(v1, v2) { return "M " + v1.x + " " + v1.y + " L " + v2.x + " " + v2.y + " "; }

function gentab(v1, v2, isnew) {
    const L = Math.hypot(v2.x - v1.x, v2.y - v1.y);
    let want = (S.knob / 100) * S.piece, rmax = 0.15, rmin = 1.5;
    // inside a figure split into several pieces, knobs follow the size of those pieces
    const mid = new DOMPoint((v1.x + v2.x) / 2, (v1.y + v2.y) / 2);
    for (const info of (window.multiInfo || [])) {
        if (info.path.isConnected && info.path.isPointInFill(mid)) {
            want = (S.knob / 100) * info.piece * 1.15; rmax = 0.17; rmin = 1.0;
            break;
        }
    }
    const r = Math.min(want, rmax * L);
    const entry = { v1: { x: v1.x, y: v1.y }, v2: { x: v2.x, y: v2.y }, L: L };
    // short edges get no knob rather than a tiny one that looks wrong and breaks
    if (r < 0.6 * want || r < rmin) {
        entry.d = straightD(v1, v2);
        entry.segs = null;
    } else {
        next(); // engine's jitter: flip, a..e
        entry.k = { t: (r / L) * (1 + c), m: 0.5 + b * 0.6, flip: flip, a: a, d: d, e: e };
        entry.segs = knobGeometry(v1, v2, entry.k);
        entry.d = knobD(v1, entry.segs);
    }
    edgeLog.push(entry);
    return entry.d;
}

// ------------------------------------------------------------------ engine sync
function cellSize() { return Math.max(0.6, Math.round((S.piece / 24) * 20) / 20); }

function rectBorderSvgFor(w, h) {
    return new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg" width="' + w + '" height="' + h +
        '"><path d="M 0 0 L ' + w + ' 0 L ' + w + ' ' + h + ' L 0 ' + h + ' Z"/></svg>', "image/svg+xml").getElementsByTagName("svg")[0];
}

function imageBorderSvg() {
    return new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg" width="' + IMG.w + '" height="' + IMG.h +
        '" viewBox="0 0 ' + IMG.w + " " + IMG.h + '"><path d="' + IMG.bg.d + '"/></svg>', "image/svg+xml").getElementsByTagName("svg")[0];
}

// Size of the puzzle outline in mm (before the engine's half-cell offset).
function boardSize() {
    if (S.shape === "image" && IMG.bg) return { w: S.imgW, h: S.imgW * IMG.bg.box.h / IMG.bg.box.w };
    if (S.shape === "svg" && S.border) return { w: S.borderW, h: S.borderW * S.border.natH / S.border.natW };
    return { w: S.w, h: S.h };
}

// Maps photo pixels to puzzle mm: mm = px · s + o. With an outline traced from the photo the
// photo lines up exactly with it; otherwise the photo covers the board, centred.
function imageMap() {
    if (!IMG.url) return null;
    if (S.shape === "image" && IMG.bg) {
        const s = S.imgW / IMG.bg.box.w;
        return { s: s, ox: -IMG.bg.box.x * s, oy: -IMG.bg.box.y * s };
    }
    const b = boardSize();
    const s = Math.max(b.w / IMG.w, b.h / IMG.h);
    return { s: s, ox: (b.w - IMG.w * s) / 2, oy: (b.h - IMG.h * s) / 2 };
}

function syncEngine() {
    const cell = cellSize();
    const set = (id, v) => { $(id).value = v; };
    set("cell_scale", cell);
    set("gsize", Math.max(4, Math.round(S.piece / cell)));
    set("gnoise", STYLE_NOISE[S.style]);
    set("_seed", S.seed); set("seed", S.seed);
    set("tabjitter", 6);
    set("minedge", 0);
    set("pixelscell", 1);
    if (S.shape === "image" && IMG.bg) {
        customborder = { svgdata: imageBorderSvg() };
        set("cbsf", S.imgW / IMG.bg.box.w);
    } else if (S.shape === "svg" && S.border) {
        customborder = { svgdata: S.border.svg };
        set("cbsf", S.borderW / S.border.natW);
    } else {
        customborder = { svgdata: rectBorderSvgFor(S.w, S.h) };
        set("cbsf", 1);
    }
    // shapes picked from the photo follow the photo when the puzzle size changes
    const m = imageMap();
    whimsies.forEach((w) => {
        if (!w.anchor || !m) return;
        w.x = w.anchor.cx * m.s + m.ox;
        w.y = w.anchor.cy * m.s + m.oy;
        w.width = w.anchor.wpx * m.s;
    });
}

// ------------------------------------------------------------------ generate
let regenTimer = null;
function regen(delay) {
    clearTimeout(regenTimer);
    if (S.shape === "svg" && !S.border) { drawEmpty(); return; }
    $("busy").hidden = false;
    regenTimer = setTimeout(() => {
        try {
            syncEngine();
            edgeLog = [];
            generate();
            checkCuts();
            generated = true;
            renderStage();
        } catch (e) {
            console.error(e);
            $("warnings").innerHTML = '<p class="warn">Noe gikk galt under genereringen: ' + escapeHtml(String(e.message || e)) + "</p>";
        }
        $("busy").hidden = true;
    }, delay === undefined ? 250 : delay);
}

function escapeHtml(s) { return String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); }

// ------------------------------------------------------------------ stage
function half() { return parseFloat($("cell_scale").value) / 2; }

function renderStage() {
    const cell = parseFloat($("cell_scale").value);
    const W = automata.columns * cell, H = automata.rows * cell;
    const inner = svgstr.slice(svgstr.indexOf(">") + 1, svgstr.lastIndexOf("</svg>"));
    const shapes = window.lastShapes || [];
    const boardD = shapes.filter((s) => !s.whimsy).map((s) => s.d).join(" ");
    const wpaths = shapes.filter((s) => s.whimsy).map((s) => s.d);
    const stage = $("stage");
    const pad = Math.max(W, H) * 0.03;
    stage.setAttribute("viewBox", [-pad, -pad, W + 2 * pad, H + 2 * pad].join(" "));
    let html = '<defs><clipPath id="boardclip"><path clip-rule="evenodd" d="' + boardD + '"/></clipPath></defs>';
    html += '<path class="board" fill-rule="evenodd" d="' + boardD + '"/>';
    html += '<g id="photo"></g>';
    html += '<g class="whimsyfills">' + wpaths.map((d, i) => '<path data-i="' + i + '" class="wfill' + (i === selectedWhimsy ? " sel" : "") + '" d="' + d + '"/>').join("") + "</g>";
    html += '<g class="cuts">' + inner.replace(/^"/, "") + "</g>";
    html += '<g class="marks">' + cutReport.crossings.map((p) => '<circle cx="' + p.x + '" cy="' + p.y + '" r="' + (S.piece * 0.12) + '"/>').join("") + "</g>";
    html += '<g id="overlay"></g>';
    stage.innerHTML = html;
    stage.querySelectorAll(".cuts > :not(path):not(rect)").forEach((n) => n.remove());
    drawPhoto();
    drawOverlay();

    const bb = stage.querySelector(".board").getBBox();
    const pieces = parseInt($("piececount").textContent) || 0;
    $("stat-size").textContent = Math.round(bb.width) + " × " + Math.round(bb.height) + " mm";
    $("stat-pieces").textContent = pieces + (pieces === 1 ? " brikke" : " brikker");
    $("stat-shaped").textContent = whimsies.length ? "· " + whimsies.length + (whimsies.length === 1 ? " figur" : " figurer") : "";
    $("download").disabled = false;
    $("empty").hidden = true;
    stage.hidden = false;
    $("borderH").textContent = Math.round(boardSize().h);
    $("imgH").textContent = Math.round(boardSize().h);

    // shapes that lost their place (new outline) are spread out once the new board exists
    const autos = whimsies.filter((w) => w.auto);
    if (autos.length) {
        autos.forEach((w) => { w.x = null; w.y = null; });
        autos.forEach((w) => { const p = findFreeSpot(w.width); w.x = p.x; w.y = p.y; delete w.auto; });
        regen(0);
        return;
    }

    const warnList = $("whimsywarn").innerText.trim().split("\n").filter(Boolean).map((w) => w.replace(/^⚠\s*/, ""));
    const n = cutReport.crossings.length;
    const chk = $("stat-check");
    if (n) {
        chk.className = "check bad";
        chk.textContent = n === 1 ? "1 kryss" : n + " kryss";
        warnList.unshift((n === 1 ? "Ett sted" : n + " steder") + " krysser linjer hverandre (merket med rød ring). Prøv «Ny variant», eller flytt figuren litt.");
    } else {
        chk.className = "check ok";
        chk.textContent = "✓ Ingen kryssende linjer";
    }
    const fixes = [];
    if (cutReport.merged) fixes.push(cutReport.merged + " for små biter slått sammen");
    if (cutReport.fixed + cutReport.straightened) fixes.push((cutReport.fixed + cutReport.straightened) + " knotter justert");
    chk.title = fixes.join(", ");
    $("warnings").innerHTML = warnList.map((w) => '<p class="warn">' + escapeHtml(w) + "</p>").join("");
}

function drawPhoto() {
    const g = $("photo"), stage = $("stage");
    if (!g) return;
    g.innerHTML = "";
    const m = imageMap();
    const show = m && (S.showImage || PICK.mode);
    stage.classList.toggle("withphoto", !!show);
    if (!show) return;
    const img = document.createElementNS(NS, "image");
    img.setAttribute("href", IMG.url);
    img.setAttribute("x", m.ox + half()); img.setAttribute("y", m.oy + half());
    img.setAttribute("width", IMG.w * m.s); img.setAttribute("height", IMG.h * m.s);
    img.setAttribute("preserveAspectRatio", "none");
    if (!PICK.mode) img.setAttribute("clip-path", "url(#boardclip)");
    g.appendChild(img);
}

function drawEmpty() {
    $("stage").hidden = true;
    $("empty").hidden = false;
    $("download").disabled = true;
    $("stat-size").textContent = "–"; $("stat-pieces").textContent = ""; $("stat-shaped").textContent = ""; $("stat-check").textContent = "";
}

function stagePoint(evt) {
    const stage = $("stage");
    const pt = stage.createSVGPoint();
    pt.x = evt.clientX; pt.y = evt.clientY;
    return pt.matrixTransform(stage.getScreenCTM().inverse());
}

// stage point -> photo pixel (original resolution)
function stageToImage(p) {
    const m = imageMap();
    return { x: (p.x - half() - m.ox) / m.s, y: (p.y - half() - m.oy) / m.s };
}

// ------------------------------------------------------------------ picking shapes from the photo
// PICK.mode: null | "wand" (click regions of the photo) | "draw" (trace an outline by hand)
const PICK = { mode: null, op: "add", tol: 40, sel: null, outline: null, drawing: null };

function startPick(mode) {
    if (mode === "wand" && !IMG.url) return;
    PICK.mode = mode; PICK.op = "add"; PICK.sel = null; PICK.outline = null; PICK.drawing = null;
    $("pickbar").hidden = false;
    $("pickWand").hidden = mode !== "wand";
    $("pickMsg").textContent = mode === "wand"
        ? "Klikk på delene av figuren (kropp, hode, ører …). Bruk «Fjern» hvis noe kom med som ikke skulle det."
        : "Tegn rundt figuren med musa eller fingeren. Slipp for å lukke omrisset.";
    $("pickDone").hidden = mode !== "wand";
    $("pickDone").disabled = true;
    document.querySelectorAll("#pickOp button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === "add"));
    $("stage").classList.add("picking");
    document.querySelector(".preview").classList.add("picking-on");
    drawPhoto(); drawOverlay();
    $("pickbar").scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function endPick() {
    PICK.mode = null; PICK.sel = null; PICK.outline = null; PICK.drawing = null;
    $("pickbar").hidden = true;
    $("stage").classList.remove("picking");
    document.querySelector(".preview").classList.remove("picking-on");
    drawPhoto(); drawOverlay();
}

function drawOverlay() {
    const g = $("overlay");
    if (!g) return;
    g.innerHTML = "";
    const m = imageMap();
    if (PICK.mode === "wand" && PICK.sel && m) {
        const img = document.createElementNS(NS, "image");
        img.setAttribute("href", maskOverlayURL(PICK.sel, [255, 255, 255, 120]));
        img.setAttribute("x", m.ox + half()); img.setAttribute("y", m.oy + half());
        img.setAttribute("width", IMG.w * m.s); img.setAttribute("height", IMG.h * m.s);
        img.setAttribute("preserveAspectRatio", "none");
        g.appendChild(img);
        if (PICK.outline) {
            const p = document.createElementNS(NS, "path");
            p.setAttribute("d", PICK.outline.d);
            p.setAttribute("class", "pickline");
            p.setAttribute("transform", "translate(" + (m.ox + half()) + "," + (m.oy + half()) + ") scale(" + m.s + ")");
            g.appendChild(p);
        }
    }
    if (PICK.mode === "draw" && PICK.drawing && PICK.drawing.length > 1) {
        const p = document.createElementNS(NS, "path");
        p.setAttribute("d", "M " + PICK.drawing.map((q) => q.x + " " + q.y).join(" L "));
        p.setAttribute("class", "pickline");
        g.appendChild(p);
    }
}

function wandClick(evt) {
    const p = stageToImage(stagePoint(evt));
    if (p.x < 0 || p.y < 0 || p.x >= IMG.w || p.y >= IMG.h) return;
    const region = wandAt(p.x / IMG.k, p.y / IMG.k, PICK.tol);
    const n = IMG.pw * IMG.ph;
    if (!PICK.sel) PICK.sel = new Uint8Array(n);
    const sub = PICK.op === "sub" || evt.altKey;
    const r = sub ? dilate(region, 1, IMG.pw, IMG.ph) : region;
    for (let i = 0; i < n; i++) if (r[i]) PICK.sel[i] = sub ? 0 : 1;
    PICK.outline = maskArea(PICK.sel) > 30 ? maskToOutline(clipToBoard(finishSelection(PICK.sel))) : null;
    $("pickDone").disabled = !PICK.outline;
    drawOverlay();
}

// Keep a picked figure inside the puzzle, with a margin so the pieces around it aren't slivers.
function clipToBoard(m) {
    const mp = imageMap(), W = IMG.pw, H = IMG.ph;
    const margin = (S.piece * 0.12) / mp.s / IMG.k;    // mm -> processing px
    let inner;
    if (S.shape === "image" && IMG.bg && IMG.bg.mask) {
        inner = erode(IMG.bg.mask, margin, W, H);
    } else {
        const b = boardSize();
        const x0 = ((0 - mp.ox) / mp.s) / IMG.k + margin, x1 = ((b.w - mp.ox) / mp.s) / IMG.k - margin;
        const y0 = ((0 - mp.oy) / mp.s) / IMG.k + margin, y1 = ((b.h - mp.oy) / mp.s) / IMG.k - margin;
        inner = new Uint8Array(W * H);
        for (let y = Math.max(0, Math.ceil(y0)); y < Math.min(H, y1); y++)
            for (let x = Math.max(0, Math.ceil(x0)); x < Math.min(W, x1); x++) inner[y * W + x] = 1;
    }
    const o = new Uint8Array(W * H);
    for (let i = 0; i < W * H; i++) o[i] = m[i] && inner[i] ? 1 : 0;
    return largestComponent(o, W, H).mask;
}

function finishWand() {
    if (!PICK.outline) return;
    addImageWhimsy(PICK.outline.d, PICK.outline.box);
    endPick();
}

function finishDraw() {
    let pts = PICK.drawing || [];
    if (pts.length < 8) { endPick(); return; }
    pts = simplifyRDP(pts, 0.3);
    pts = chaikin(pts, 2);
    const m = imageMap();
    if (m) {
        // keep it tied to the photo, like a picked shape
        const px = pts.map((q) => stageToImage(q));
        const d = "M " + px.map((q) => q.x.toFixed(1) + " " + q.y.toFixed(1)).join(" L ") + " Z";
        const xs = px.map((q) => q.x), ys = px.map((q) => q.y);
        const box = { x: Math.min(...xs), y: Math.min(...ys) };
        box.w = Math.max(...xs) - box.x; box.h = Math.max(...ys) - box.y;
        addImageWhimsy(d, box);
    } else {
        const h = half();
        const mm = pts.map((q) => ({ x: q.x - h, y: q.y - h }));
        const d = "M " + mm.map((q) => q.x.toFixed(2) + " " + q.y.toFixed(2)).join(" L ") + " Z";
        const xs = mm.map((q) => q.x), ys = mm.map((q) => q.y);
        const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
        const shape = normaliseWhimsy(d);
        whimsies.push({ name: nextName(), d: shape.d, w0: shape.w0, h0: shape.h0, solidity: shape.solidity,
            x: (x0 + x1) / 2, y: (y0 + y1) / 2, width: x1 - x0, rot: 0, pieces: 1 });
        selectedWhimsy = whimsies.length - 1;
        buildWhimsyCards();
        regen(0);
    }
    endPick();
}

function nextName() {
    let n = whimsies.length + 1;
    while (whimsies.some((w) => w.name === "Figur " + n)) n++;
    return "Figur " + n;
}

function addImageWhimsy(d, box) {
    const shape = normaliseWhimsy(d);
    const areaMm = (() => { const m = imageMap(); return box.w * box.h * m.s * m.s * 0.6; })();
    const suggested = Math.max(1, Math.min(4, Math.round(areaMm / (S.piece * S.piece * 1.6))));
    whimsies.push({
        name: nextName(), d: shape.d, w0: shape.w0, h0: shape.h0, solidity: shape.solidity,
        anchor: { cx: box.x + box.w / 2, cy: box.y + box.h / 2, wpx: box.w },
        x: 0, y: 0, width: 0, rot: 0, pieces: suggested,
    });
    selectedWhimsy = whimsies.length - 1;
    buildWhimsyCards();
    regen(0);
}

// pointer handling on the stage: pick, draw or drag shaped pieces
(function setupStage() {
    let drag = null;
    document.addEventListener("pointerdown", (evt) => {
        const stage = $("stage");
        if (!stage.contains(evt.target)) return;
        if (PICK.mode === "wand") { wandClick(evt); evt.preventDefault(); return; }
        if (PICK.mode === "draw") {
            PICK.drawing = [stagePoint(evt)];
            stage.setPointerCapture(evt.pointerId);
            evt.preventDefault();
            return;
        }
        const t = evt.target;
        if (!t.classList || !t.classList.contains("wfill")) return;
        const i = parseInt(t.dataset.i);
        selectWhimsy(i);
        drag = { i: i, el: t, p0: stagePoint(evt) };
        t.setPointerCapture(evt.pointerId);
        stage.classList.add("dragging");
        evt.preventDefault();
    });
    document.addEventListener("pointermove", (evt) => {
        if (PICK.mode === "draw" && PICK.drawing) {
            const p = stagePoint(evt), last = PICK.drawing[PICK.drawing.length - 1];
            if (Math.hypot(p.x - last.x, p.y - last.y) > S.piece * 0.02) { PICK.drawing.push(p); drawOverlay(); }
            return;
        }
        if (!drag) return;
        const p = stagePoint(evt);
        drag.dx = p.x - drag.p0.x; drag.dy = p.y - drag.p0.y;
        drag.el.setAttribute("transform", "translate(" + drag.dx + "," + drag.dy + ")");
    });
    const end = () => {
        if (PICK.mode === "draw" && PICK.drawing) { finishDraw(); return; }
        if (!drag) return;
        $("stage").classList.remove("dragging");
        if (drag.dx || drag.dy) {
            const w = whimsies[drag.i];
            w.x += drag.dx; w.y += drag.dy;
            if (w.anchor) delete w.anchor;      // moved away from where it sits in the photo
            buildWhimsyCards();
            regen(0);
        }
        drag = null;
    };
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
    document.addEventListener("keydown", (e) => { if (e.key === "Escape" && PICK.mode) endPick(); });
})();

// ------------------------------------------------------------------ shaped pieces
function thumbSvg(shape, cls) {
    const p = Math.max(shape.w0, shape.h0) * 0.06;
    return '<svg class="' + (cls || "thumb") + '" viewBox="' + (-p) + " " + (-p) + " " + (shape.w0 + 2 * p) + " " + (shape.h0 + 2 * p) +
        '" aria-hidden="true"><path vector-effect="non-scaling-stroke" d="' + shape.d + '"/></svg>';
}

function lockInfo(s) {
    if (s < 0.85) return { cls: "good", txt: "Låser godt" };
    if (s < 0.92) return { cls: "weak", txt: "Låser svakt" };
    return { cls: "bad", txt: "Faller ut" };
}

function findFreeSpot(width) {
    if (!generated || !$("stage").querySelector(".board")) return { x: null, y: null };
    const board = $("stage").querySelector(".board");
    const bb = board.getBBox();
    const h = half();
    const inside = (x, y) => board.isPointInFill(new DOMPoint(x, y));
    let best = null, bestScore = -1;
    for (let gy = 1; gy <= 6; gy++) for (let gx = 1; gx <= 6; gx++) {
        const x = bb.x + (bb.width * gx) / 7, y = bb.y + (bb.height * gy) / 7, r = width * 0.55;
        if (![[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]].every(([dx, dy]) => inside(x + dx, y + dy))) continue;
        let score = 1e9;
        whimsies.forEach((w) => { if (w.x !== null) score = Math.min(score, Math.hypot(w.x + h - x, w.y + h - y)); });
        score = Math.min(score, 1e8) - 0.001 * Math.hypot(x - bb.x - bb.width / 2, y - bb.y - bb.height / 2);
        if (score > bestScore) { bestScore = score; best = { x: x - h, y: y - h }; }
    }
    return best || { x: null, y: null };
}

function addWhimsyShape(name, shape) {
    const width = Math.round(Math.max(30, Math.min(60, S.piece * 1.6)));
    const spot = findFreeSpot(width);
    whimsies.push({ name: name, d: shape.d, w0: shape.w0, h0: shape.h0, solidity: shape.solidity,
        x: spot.x, y: spot.y, width: width, rot: 0, pieces: 1 });
    selectedWhimsy = whimsies.length - 1;
    buildWhimsyCards();
    regen(0);
}

function selectWhimsy(i) {
    selectedWhimsy = i;
    document.querySelectorAll(".wcard").forEach((c, k) => c.classList.toggle("sel", k === i));
    document.querySelectorAll("#stage .wfill").forEach((p) => p.classList.toggle("sel", parseInt(p.dataset.i) === i));
}

// engine calls this after placing shapes; only rebuild when the list itself changed,
// so a slider being dragged is never replaced under the pointer
function renderWhimsyList() {
    if (document.querySelectorAll(".wcard").length !== whimsies.length) buildWhimsyCards();
}

function buildWhimsyCards() {
    const list = $("wlist");
    list.innerHTML = "";
    whimsies.forEach((w, i) => {
        const lock = lockInfo(w.solidity);
        const width = Math.round(w.width || 0), n = w.pieces || 1;
        const card = document.createElement("div");
        card.className = "wcard" + (i === selectedWhimsy ? " sel" : "");
        card.innerHTML =
            '<div class="whead">' + thumbSvg(w, "wthumb") +
            '<div class="wname"><strong>' + escapeHtml(w.name) + "</strong><span>" +
            '<span class="chip ' + lock.cls + '">' + lock.txt + "</span>" +
            (w.anchor ? ' <span class="chip anchor">· følger bildet</span>' : "") + "</span></div>" +
            '<button class="icon" type="button" aria-label="Fjern ' + escapeHtml(w.name) + '" title="Fjern">✕</button></div>' +
            '<div class="row"><span>Biter</span><div class="stepper">' +
            '<button type="button" class="btn small" data-d="-1" aria-label="Færre biter">−</button>' +
            "<output>" + n + "</output>" +
            '<button type="button" class="btn small" data-d="1" aria-label="Flere biter">+</button></div><span></span></div>' +
            '<label class="row"><span>Størrelse</span><input type="range" min="15" max="400" step="1" value="' + width + '" id="wsize' + i + '"><output>' + width + " mm</output></label>" +
            '<label class="row"><span>Rotasjon</span><input type="range" min="-180" max="180" step="5" value="' + w.rot + '" id="wrot' + i + '"><output>' + w.rot + "°</output></label>";
        card.addEventListener("pointerdown", () => selectWhimsy(i));
        card.querySelector(".icon").addEventListener("click", () => {
            whimsies.splice(i, 1);
            selectedWhimsy = Math.max(0, Math.min(selectedWhimsy, whimsies.length - 1));
            buildWhimsyCards();
            regen(0);
        });
        card.querySelectorAll(".stepper button").forEach((b) => b.addEventListener("click", () => {
            w.pieces = Math.max(1, Math.min(6, (w.pieces || 1) + parseInt(b.dataset.d)));
            card.querySelector(".stepper output").textContent = w.pieces;
            regen(0);
        }));
        const size = card.querySelector("#wsize" + i), rot = card.querySelector("#wrot" + i);
        const detach = () => { if (w.anchor) { delete w.anchor; const c = card.querySelector(".chip.anchor"); if (c) c.remove(); } };
        size.addEventListener("input", () => { detach(); w.width = +size.value; size.nextElementSibling.textContent = size.value + " mm"; regen(); });
        rot.addEventListener("input", () => { detach(); w.rot = +rot.value; rot.nextElementSibling.textContent = rot.value + "°"; regen(); });
        list.appendChild(card);
    });
    $("whint").hidden = !whimsies.length;
}

// ------------------------------------------------------------------ outlines from files
function measureBorder(svgEl) {
    const clone = document.importNode(svgEl, true);
    clone.setAttribute("style", "position:absolute;left:-10000px;top:0");
    document.body.appendChild(clone);
    flatten(clone, false, true);
    const paths = clone.getElementsByTagName("path");
    if (!paths.length) { document.body.removeChild(clone); throw new Error("Fant ingen lukket form i filen."); }
    const vt = paths[0].getCTM();
    const holder = document.createElementNS(NS, "svg");
    holder.setAttribute("style", "position:absolute;left:-10000px;top:0");
    document.body.appendChild(holder);
    const g = document.createElementNS(NS, "g");
    for (const p of paths) {
        const np = document.createElementNS(NS, "path");
        np.setAttribute("d", p.getAttribute("d"));
        g.appendChild(np);
    }
    holder.appendChild(g);
    g.setAttribute("transform", "matrix(" + [vt.a, vt.b, vt.c, vt.d, vt.e, vt.f].join(",") + ")");
    flatten(holder, false, true);
    const bb = g.getBBox();
    document.body.removeChild(clone);
    document.body.removeChild(holder);
    return { w: bb.width, h: bb.height };
}

function loadBorderText(text, name) {
    try {
        const svg = new DOMParser().parseFromString(text, "image/svg+xml").getElementsByTagName("svg")[0];
        if (!svg) throw new Error("Filen ser ikke ut til å være en SVG.");
        const nat = measureBorder(svg);
        if (!(nat.w > 0 && nat.h > 0)) throw new Error("Fant ingen form med størrelse i filen.");
        S.border = { name: name, natW: nat.w, natH: nat.h, svg: svg };
        S.borderW = Math.round(nat.w >= 80 && nat.w <= 600 ? nat.w : 200);
        whimsies.forEach((w) => { if (!w.anchor) { w.x = null; w.y = null; w.auto = true; } });
        $("bordername").textContent = name;
        $("borderW").value = S.borderW;
        $("borderloaded").hidden = false;
        $("drop").classList.add("has");
        regen(0);
    } catch (e) {
        alertInline("Kunne ikke bruke formen: " + e.message);
    }
}

function alertInline(msg) {
    $("warnings").innerHTML = '<p class="warn">' + escapeHtml(msg) + "</p>";
}

function readFile(file, cb) {
    const fr = new FileReader();
    fr.onload = () => cb(fr.result);
    fr.readAsText(file);
}

// ------------------------------------------------------------------ download
function savesvg() {
    const pieces = parseInt($("piececount").textContent) || 0;
    const size = $("stat-size").textContent.replace(/\s/g, "").replace("×", "x");
    const out = svgstrsave.replace(/stroke-width="0?\.5"/g, 'stroke-width="0.1"').replace(/stroke-width:0\.5/g, "stroke-width:0.1").replace('"<rect', "<rect");
    save("puslespill-" + pieces + "-brikker-" + size + ".svg", '<?xml version="1.0" encoding="UTF-8"?>\n' + out);
}

// ------------------------------------------------------------------ wiring
function seg(groupId, onPick) {
    const g = $(groupId);
    g.querySelectorAll("button").forEach((b) => b.addEventListener("click", () => {
        if (b.disabled) return;
        g.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
        onPick(b.dataset.v);
    }));
}

function setShape(v) {
    S.shape = v;
    document.querySelectorAll("#shapeSeg button").forEach((x) => x.setAttribute("aria-pressed", x.dataset.v === v));
    $("rectOpts").hidden = v !== "rect";
    $("svgOpts").hidden = v !== "svg";
    $("imgOpts").hidden = v !== "image";
    whimsies.forEach((w) => { if (!w.anchor) { w.x = null; w.y = null; w.auto = true; } });
    regen(0);
}

function updateImageUI() {
    const has = !!IMG.url;
    $("photoLoaded").hidden = !has;
    $("photoPick").hidden = has;
    $("photoName").textContent = IMG.name;
    const imgBtn = document.querySelector('#shapeSeg button[data-v="image"]');
    imgBtn.disabled = !(has && IMG.bg);
    imgBtn.title = has && !IMG.bg ? "Fant ingen ensfarget bakgrunn rundt motivet i bildet" : "";
    $("pickFromImage").disabled = !has;
    $("pickHint").hidden = has;
}

function initUI() {
    seg("shapeSeg", setShape);
    seg("styleSeg", (v) => { S.style = v; regen(0); });
    seg("pickOp", (v) => { PICK.op = v; });

    const num = (id, key) => $(id).addEventListener("input", () => {
        const v = parseFloat($(id).value);
        if (v >= 20 && v <= 2000) { S[key] = v; regen(400); }
    });
    num("rectW", "w"); num("rectH", "h"); num("borderW", "borderW"); num("imgW", "imgW");

    document.querySelectorAll("[data-preset]").forEach((b) => b.addEventListener("click", () => {
        const [w, h] = b.dataset.preset.split("x").map(Number);
        S.w = w; S.h = h; $("rectW").value = w; $("rectH").value = h; regen(0);
    }));

    const pieceIn = $("pieceSize");
    pieceIn.addEventListener("input", () => { S.piece = +pieceIn.value; $("pieceOut").textContent = pieceIn.value + " mm"; regen(); });
    const knobIn = $("knobSize");
    const knobWord = (v) => v < 11 ? "Små" : v < 15 ? "Vanlige" : "Store";
    knobIn.addEventListener("input", () => { S.knob = +knobIn.value; $("knobOut").textContent = knobWord(S.knob); regen(); });
    $("knobOut").textContent = knobWord(S.knob);

    $("variant").addEventListener("click", () => { S.seed = Math.floor(Math.random() * 9999); regen(0); });

    // SVG outline: file picker + drag and drop
    $("borderFile").addEventListener("change", (e) => {
        const f = e.target.files[0]; if (!f) return;
        readFile(f, (t) => loadBorderText(t, f.name));
        e.target.value = "";
    });
    const drop = $("drop");
    ["dragenter", "dragover"].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add("over"); }));
    ["dragleave", "drop"].forEach((ev) => drop.addEventListener(ev, () => drop.classList.remove("over")));
    drop.addEventListener("drop", (e) => {
        e.preventDefault();
        const f = e.dataTransfer.files[0];
        if (f) readFile(f, (t) => loadBorderText(t, f.name));
    });

    // photo
    $("photoFile").addEventListener("change", async (e) => {
        const f = e.target.files[0]; if (!f) return;
        e.target.value = "";
        $("busy").hidden = false;
        try {
            await loadImageFile(f);
        } catch (err) {
            alertInline(err.message);
            $("busy").hidden = true;
            return;
        }
        S.showImage = true;
        $("photoToggle").checked = true;
        whimsies = whimsies.filter((w) => !w.anchor);   // shapes from an earlier photo no longer fit
        buildWhimsyCards();
        updateImageUI();
        if (IMG.bg) {
            setShape("image");
        } else {
            if (S.shape === "rect") {
                S.h = Math.round(S.w * IMG.h / IMG.w);
                $("rectH").value = S.h;
            }
            regen(0);
        }
    });
    $("photoToggle").addEventListener("change", (e) => { S.showImage = e.target.checked; if (generated) drawPhoto(); });
    $("photoRemove").addEventListener("click", () => {
        if (IMG.url) URL.revokeObjectURL(IMG.url);
        IMG.url = null; IMG.bg = null;
        whimsies.forEach((w) => { delete w.anchor; });
        updateImageUI();
        buildWhimsyCards();
        if (S.shape === "image") setShape("rect"); else regen(0);
    });

    // shaped pieces
    $("pickFromImage").addEventListener("click", () => startPick("wand"));
    $("drawShape").addEventListener("click", () => startPick("draw"));
    $("pickCancel").addEventListener("click", endPick);
    $("pickDone").addEventListener("click", finishWand);
    $("pickTol").addEventListener("input", (e) => { PICK.tol = +e.target.value; });
    $("whimsySvg").addEventListener("change", (e) => {
        const f = e.target.files[0]; if (!f) return;
        readFile(f, (t) => {
            try { addWhimsyShape(f.name.replace(/\.svg$/i, ""), whimsyFromSvgText(t)); }
            catch (err) { alertInline("Kunne ikke bruke " + f.name + ": " + err); }
        });
        e.target.value = "";
    });

    $("download").addEventListener("click", savesvg);
    updateImageUI();
    regen(0);
}

window.addEventListener("load", initUI);
