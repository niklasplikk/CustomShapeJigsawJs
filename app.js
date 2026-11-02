// Puslespillgenerator — UI layer on top of engine.js (CustomShapeJigsawJs by proceduraljigsaw, MIT).
// The engine still reads its settings from the hidden #engine inputs; this file fills them in,
// runs generate() and draws the result on the preview stage.

const NS = "http://www.w3.org/2000/svg";
const STYLE_NOISE = { classic: 0.12, organic: 0.5, wild: 0.9 };
const SMOOTH_WORDS = ["Off", "Light", "Medium", "Strong"];
const padText = (v) => (v > 0 ? "+" : v < 0 ? "−" : "") + Math.abs(v).toFixed(1).replace(".0", "") + " mm";

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
    splits: [],             // points (mm) where the user asked to split a piece
    autoSplit: true,        // split pieces that end up much bigger than the rest
    borderSmooth: 2,        // smoothing of the outline traced from the photo (index into SMOOTH_MM)
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
    let want = (S.knob / 100) * S.piece, rmax = 0.15, rmin = 1.5, inFigure = false;
    // inside a figure split into several pieces, knobs follow the size of those pieces
    const mid = new DOMPoint((v1.x + v2.x) / 2, (v1.y + v2.y) / 2);
    for (const info of (window.multiInfo || [])) {
        if (info.path.isConnected && info.path.isPointInFill(mid)) {
            want = (S.knob / 100) * info.piece * 1.15; rmax = 0.17; rmin = 1.0; inFigure = true;
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
        // knobs on the cuts inside a figure sit near the middle of the cut
        entry.k = { t: (r / L) * (1 + c), m: 0.5 + b * (inFigure ? 0.15 : 0.6), flip: flip, a: a, d: d, e: e };
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
    const mmPerPx = S.imgW / IMG.bg.box.w;
    const d = smoothClosedPath(IMG.bg.d, SMOOTH_MM[S.borderSmooth] / mmPerPx, 0.05 / mmPerPx);
    return new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg" width="' + IMG.w + '" height="' + IMG.h +
        '" viewBox="0 0 ' + IMG.w + " " + IMG.h + '"><path d="' + d + '"/></svg>', "image/svg+xml").getElementsByTagName("svg")[0];
}

// Figures keep their outline as picked/drawn in dRaw (with w0Raw/h0Raw); d/w0/h0 is the smoothed
// version the engine cuts. w.width always means the width of the raw outline, so smoothing never
// changes the figure's size; the engine scales by engineW / w0 instead.
function applySmoothing(w) {
    if (!w.dRaw) { w.dRaw = w.d; w.w0Raw = w.w0; w.h0Raw = w.h0; w.solidRaw = w.solidity; }
    if (w.smooth === undefined) w.smooth = 1;
    if (w.pad === undefined) w.pad = 0;
    const level = SMOOTH_MM[w.smooth] || 0;
    if (!(w.width > 0)) return;
    const mmPerUnit = w.width / w.w0Raw;
    const key = w.smooth + ":" + w.pad + ":" + mmPerUnit.toFixed(4) + ":" + (w.anchor ? S.shape + S.imgW + ":" + S.piece : "");
    if (w.smoothKey !== key) {
        // all work happens in the raw outline's own units, with its box at (0, 0)
        let d = w.dRaw, edge = w.edge;
        if (w.pad) {
            const grown = w.anchor && IMG.url && imageMap() ? padFromPicture(w, mmPerUnit) : null;
            if (grown) { d = grown.d; edge = grown.edge; }
            else d = offsetOutlineMask(w.dRaw, w.pad / mmPerUnit, mmPerUnit / 0.25) || w.dRaw;
        } else if (w.edge0 !== undefined) {
            edge = w.edge0;
        }
        if (level) d = smoothClosedPath(d, level / mmPerUnit, 0.05 / mmPerUnit);
        const p = tmpPath(d), bb = p.getBBox();
        p.remove();
        const sh = normaliseWhimsy(d);
        w.d = sh.d; w.w0 = sh.w0; w.h0 = sh.h0; w.solidity = sh.solidity;
        w.edge = edge;
        // how far the centre moved from the raw outline's centre, in mm (growing against the
        // puzzle's edge is lopsided, for one)
        const dx = (bb.x + bb.width / 2 - w.w0Raw / 2) * mmPerUnit, dy = (bb.y + bb.height / 2 - w.h0Raw / 2) * mmPerUnit;
        const a = ((w.rot || 0) * Math.PI) / 180;
        w.ox = dx * Math.cos(a) - dy * Math.sin(a);
        w.oy = dx * Math.sin(a) + dy * Math.cos(a);
        w.smoothKey = key;
    }
    w.engineW = w.width * w.w0 / w.w0Raw;
}

// Grows or shrinks a figure picked from the picture on the picture's own grid, so that it is
// clipped to the puzzle and fills narrow gaps to its edge just like when it was picked.
function padFromPicture(w, mmPerUnit) {
    const m = imageMap();
    const ox = w.anchor.cx - w.w0Raw / 2, oy = w.anchor.cy - w.h0Raw / 2;   // raw outline -> picture px
    const cv = document.createElement("canvas");
    cv.width = IMG.pw; cv.height = IMG.ph;
    const cx = cv.getContext("2d");
    cx.setTransform(1 / IMG.k, 0, 0, 1 / IMG.k, ox / IMG.k, oy / IMG.k);
    cx.fillStyle = "#000";
    cx.fill(new Path2D(w.dRaw));
    const data = cx.getImageData(0, 0, IMG.pw, IMG.ph).data;
    let mask = new Uint8Array(IMG.pw * IMG.ph);
    for (let i = 0; i < mask.length; i++) mask[i] = data[i * 4 + 3] > 127 ? 1 : 0;
    const r = Math.abs(w.pad) / (m.s * IMG.k);
    if (w.pad > 0) mask = dilate(mask, r, IMG.pw, IMG.ph); else mask = erode(mask, r, IMG.pw, IMG.ph);
    const c = clipToBoard(mask), o = maskToOutline(c.mask);
    if (!o) return null;
    const d = "M " + o.pts.map((q) => (q.x - ox).toFixed(2) + " " + (q.y - oy).toFixed(2)).join(" L ") + " Z";
    return { d: d, edge: c.edge };
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
    whimsies.forEach(applySmoothing);
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
            applyPlugs();
            checkCuts();
            mergeEdgeFigures();
            generated = true;
            renderStage();
        } catch (e) {
            console.error(e);
            $("warnings").innerHTML = '<p class="warn">Something went wrong while making the puzzle: ' + escapeHtml(String(e.message || e)) + "</p>";
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
    const wpaths = shapes.filter((s) => s.whimsy).map((s) => s.dCut || s.d);
    const stage = $("stage");
    const pad = Math.max(W, H) * 0.03;
    const base = { x: -pad, y: -pad, w: W + 2 * pad, h: H + 2 * pad };
    if (!BASE || Math.abs(BASE.w - base.w) > 1 || Math.abs(BASE.h - base.h) > 1) VIEW = null;   // new size: show all
    BASE = base;
    applyView();
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
    $("stat-pieces").textContent = pieces + (pieces === 1 ? " piece" : " pieces");
    $("stat-shaped").textContent = whimsies.length ? "· " + whimsies.length + (whimsies.length === 1 ? " figure" : " figures") : "";
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
        chk.textContent = n === 1 ? "1 crossing" : n + " crossings";
        warnList.unshift((n === 1 ? "Lines cross in one place" : "Lines cross in " + n + " places") + " (marked with a red ring). Try “New variant”, or move the figure a little.");
    } else {
        chk.className = "check ok";
        chk.textContent = "✓ No crossing lines";
    }
    const fixes = [];
    if (cutReport.merged) fixes.push(cutReport.merged + " small pieces merged");
    if (cutReport.fixed + cutReport.straightened) fixes.push((cutReport.fixed + cutReport.straightened) + " knobs adjusted");
    if (cutReport.splitAuto) fixes.push(cutReport.splitAuto + " oversized pieces split");
    if (cutReport.autoKnobs) fixes.push(cutReport.autoKnobs + " knobs added so every piece holds");
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

// ------------------------------------------------------------------ zoom and pan
let BASE = null;   // whole puzzle, in mm
let VIEW = null;   // current view box, or null to show the whole puzzle

function applyView() {
    if (!BASE) return;
    const v = VIEW || BASE;
    $("stage").setAttribute("viewBox", [v.x, v.y, v.w, v.h].join(" "));
    const z = BASE.w / v.w;
    $("zoomLevel").textContent = Math.round(z * 100) + "%";
    $("stage").classList.toggle("zoomed", !!VIEW);
}

function clampView(v) {
    const minW = BASE.w / 25;
    if (v.w >= BASE.w * 0.999) return null;
    if (v.w < minW) { const k = minW / v.w; v = { x: v.x - (v.w * (k - 1)) / 2, y: v.y - (v.h * (k - 1)) / 2, w: minW, h: v.h * k }; }
    // keep part of the puzzle in view
    v.x = Math.max(BASE.x - v.w * 0.5, Math.min(BASE.x + BASE.w - v.w * 0.5, v.x));
    v.y = Math.max(BASE.y - v.h * 0.5, Math.min(BASE.y + BASE.h - v.h * 0.5, v.y));
    return v;
}

// zoom by factor (>1 = in) keeping point p (mm) where it is on screen
function zoomAt(p, factor) {
    if (!BASE) return;
    const v = VIEW || { x: BASE.x, y: BASE.y, w: BASE.w, h: BASE.h };
    const w = v.w / factor, h = v.h / factor;
    VIEW = clampView({ x: p.x - ((p.x - v.x) * w) / v.w, y: p.y - ((p.y - v.y) * h) / v.h, w: w, h: h });
    applyView();
}

function zoomCenter(factor) {
    const v = VIEW || BASE;
    if (v) zoomAt({ x: v.x + v.w / 2, y: v.y + v.h / 2 }, factor);
}

function zoomFit() { VIEW = null; applyView(); }

(function setupZoom() {
    let pan = null, space = false;
    const pointers = new Map();
    let pinch = null;
    const svgPerPx = () => 1 / $("stage").getScreenCTM().a;

    window.addEventListener("keydown", (e) => {
        if (e.code === "Space" && !/INPUT|TEXTAREA|SELECT|BUTTON/.test(document.activeElement.tagName)) { space = true; e.preventDefault(); }
    });
    window.addEventListener("keyup", (e) => { if (e.code === "Space") space = false; });

    window.addEventListener("load", () => {
        const wrap = document.querySelector(".stagewrap");
        wrap.addEventListener("wheel", (e) => {
            if ($("stage").hidden) return;
            e.preventDefault();
            const k = e.ctrlKey ? 0.012 : 0.0018;           // pinch on a trackpad comes as ctrl+wheel
            const dy = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
            zoomAt(stagePoint(e), Math.exp(-dy * k));
        }, { passive: false });

        wrap.addEventListener("pointerdown", (e) => {
            pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pointers.size === 2) {
                // two fingers: pinch to zoom and pan; stop whatever one finger started
                const [a, b] = [...pointers.values()];
                pinch = { d: Math.hypot(a.x - b.x, a.y - b.y), mid: { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 } };
                if (PICK.drawing) PICK.drawing = null;
                pan = null;
                e.stopPropagation(); e.preventDefault();
                return;
            }
            const onFigure = e.target.classList && e.target.classList.contains("wfill");
            const wantPan = e.button === 1 || space || (!PICK.mode && VIEW && !onFigure);
            if (!wantPan || $("stage").hidden) return;
            pan = { x: e.clientX, y: e.clientY, v: Object.assign({}, VIEW || BASE), k: svgPerPx() };
            $("stage").classList.add("panning");
            e.stopPropagation(); e.preventDefault();
        });
        window.addEventListener("pointermove", (e) => {
            if (pointers.has(e.pointerId)) pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
            if (pinch && pointers.size === 2) {
                const [a, b] = [...pointers.values()];
                const d = Math.hypot(a.x - b.x, a.y - b.y), mid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
                const k = svgPerPx();
                if (VIEW || d / pinch.d > 1) {
                    const v = VIEW || Object.assign({}, BASE);
                    v.x -= (mid.x - pinch.mid.x) * k; v.y -= (mid.y - pinch.mid.y) * k;
                    VIEW = clampView(v); applyView();
                }
                zoomAt(stagePoint({ clientX: mid.x, clientY: mid.y }), d / pinch.d);
                pinch = { d: d, mid: mid };
                return;
            }
            if (!pan) return;
            VIEW = clampView({ x: pan.v.x - (e.clientX - pan.x) * pan.k, y: pan.v.y - (e.clientY - pan.y) * pan.k, w: pan.v.w, h: pan.v.h });
            applyView();
        });
        const up = (e) => {
            pointers.delete(e.pointerId);
            if (pointers.size < 2) pinch = null;
            if (pan) { pan = null; $("stage").classList.remove("panning"); }
        };
        window.addEventListener("pointerup", up);
        window.addEventListener("pointercancel", up);

        $("zoomIn").addEventListener("click", () => zoomCenter(1.5));
        $("zoomOut").addEventListener("click", () => zoomCenter(1 / 1.5));
        $("zoomFit").addEventListener("click", zoomFit);
    });
})();

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
//            | "plug" (place knobs on the outline of figure PICK.figure) | "split" (split pieces)
const PICK = { mode: null, op: "add", tol: 40, sel: null, outline: null, drawing: null, figure: -1 };

function startPick(mode) {
    if (mode === "wand" && !IMG.url) return;
    PICK.mode = mode; PICK.op = "add"; PICK.sel = null; PICK.outline = null; PICK.drawing = null;
    $("pickbar").hidden = false;
    $("pickWand").hidden = mode !== "wand";
    $("pickMsg").textContent = mode === "wand"
        ? "Click the parts of the figure (body, head, ears …). Use “Remove” if something got in that shouldn't."
        : "Draw around the figure with your mouse or finger. Let go to close the outline.";
    $("pickDone").hidden = mode === "draw";
    $("pickDone").disabled = mode !== "plug" && mode !== "split";
    $("pickDone").textContent = mode === "plug" || mode === "split" ? "Done" : "Make figure piece";
    $("pickCancel").hidden = mode === "plug" || mode === "split";
    $("pickUndo").hidden = mode !== "split";
    if (mode === "split") splitMessage();
    document.querySelectorAll("#pickOp button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === "add"));
    $("stage").classList.add(mode === "plug" || mode === "split" ? "plugging" : "picking");
    document.querySelector(".preview").classList.add("picking-on");
    drawPhoto(); drawOverlay();
    $("pickbar").scrollIntoView({ block: "nearest", behavior: "smooth" });
}

function endPick() {
    PICK.mode = null; PICK.sel = null; PICK.outline = null; PICK.drawing = null;
    $("pickbar").hidden = true;
    $("stage").classList.remove("picking", "plugging");
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
    PICK.outline = null;
    if (maskArea(PICK.sel) > 30) {
        const c = clipToBoard(finishSelection(PICK.sel));
        PICK.outline = maskToOutline(c.mask);
        if (PICK.outline) PICK.outline.edge = c.edge;
    }
    $("pickDone").disabled = !PICK.outline;
    drawOverlay();
}

// Keep a picked figure inside the puzzle. Where it comes close to the outer edge, the narrow gap
// between them is added to the figure, so the figure reaches the edge instead of leaving thin
// pieces behind it. The figure stays a hair (under one grid cell) inside the edge so the engine
// sees it as a separate shape; mergeEdgeFigures() lines the two up again in the cut file.
function clipToBoard(m) {
    const mp = imageMap(), W = IMG.pw, H = IMG.ph, N = W * H;
    const pxPerMm = 1 / (mp.s * IMG.k);
    let board;
    if (S.shape === "image" && IMG.bg && IMG.bg.mask) {
        board = IMG.bg.mask;
    } else {
        const b = boardSize();
        const x0 = ((0 - mp.ox) / mp.s) / IMG.k, x1 = ((b.w - mp.ox) / mp.s) / IMG.k;
        const y0 = ((0 - mp.oy) / mp.s) / IMG.k, y1 = ((b.h - mp.oy) / mp.s) / IMG.k;
        board = new Uint8Array(N);
        for (let y = Math.max(0, Math.ceil(y0)); y < Math.min(H, y1); y++)
            for (let x = Math.max(0, Math.ceil(x0)); x < Math.min(W, x1); x++) board[y * W + x] = 1;
    }
    const eps = Math.max(1, 0.6 * cellSize() * pxPerMm);
    const gap = 0.25 * S.piece * pxPerMm;
    const outside = new Uint8Array(N), f = new Uint8Array(N), both = new Uint8Array(N);
    for (let i = 0; i < N; i++) { outside[i] = board[i] ? 0 : 1; f[i] = m[i] && board[i] ? 1 : 0; both[i] = f[i] || outside[i]; }
    const near = dilate(outside, gap, W, H);
    const closed = closeMask(both, gap / 2, W, H);
    for (let i = 0; i < N; i++) if (!f[i] && closed[i] && board[i] && near[i]) f[i] = 1;
    // small pockets shut in between the figure and the edge would become loose bits: fill them
    const minPocket = Math.pow(0.6 * S.piece * pxPerMm, 2);
    const lab = new Int32Array(N), stack = new Int32Array(N);
    let nl = 0;
    for (let st = 0; st < N; st++) {
        if (lab[st] || f[st] || !board[st]) continue;
        nl++; let sp = 0; const comp = [];
        lab[st] = nl; stack[sp++] = st;
        while (sp) {
            const i = stack[--sp], x = i % W; comp.push(i);
            const nb = [x > 0 ? i - 1 : -1, x < W - 1 ? i + 1 : -1, i >= W ? i - W : -1, i < N - W ? i + W : -1];
            for (const q of nb) if (q >= 0 && !lab[q] && !f[q] && board[q]) { lab[q] = nl; stack[sp++] = q; }
        }
        if (comp.length < minPocket) comp.forEach((i) => { f[i] = 1; });
    }
    const inner = erode(board, eps, W, H);
    for (let i = 0; i < N; i++) f[i] = f[i] && inner[i] ? 1 : 0;
    const out = largestComponent(f, W, H).mask;
    const band = dilate(outside, eps + 2, W, H);
    let edge = false;
    for (let i = 0; i < N && !edge; i++) if (out[i] && band[i]) edge = true;
    return { mask: out, edge: edge };
}

function finishWand() {
    if (!PICK.outline) return;
    addImageWhimsy(PICK.outline.d, PICK.outline.box, PICK.outline.edge);
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
        // rasterise the drawing so it gets the same edge handling as a picked figure
        const px = pts.map((q) => stageToImage(q));
        const cv = document.createElement("canvas");
        cv.width = IMG.pw; cv.height = IMG.ph;
        const cx = cv.getContext("2d");
        cx.beginPath();
        px.forEach((q, k) => (k ? cx.lineTo(q.x / IMG.k, q.y / IMG.k) : cx.moveTo(q.x / IMG.k, q.y / IMG.k)));
        cx.closePath(); cx.fillStyle = "#000"; cx.fill();
        const data = cx.getImageData(0, 0, IMG.pw, IMG.ph).data, mask = new Uint8Array(IMG.pw * IMG.ph);
        for (let k = 0; k < mask.length; k++) mask[k] = data[k * 4 + 3] > 127 ? 1 : 0;
        const c = clipToBoard(mask), o = maskToOutline(c.mask);
        if (o) { addImageWhimsy(o.d, o.box, c.edge); whimsies[whimsies.length - 1].smooth = 2; buildWhimsyCards(); }
    } else {
        const h = half();
        const mm = pts.map((q) => ({ x: q.x - h, y: q.y - h }));
        const d = "M " + mm.map((q) => q.x.toFixed(2) + " " + q.y.toFixed(2)).join(" L ") + " Z";
        const xs = mm.map((q) => q.x), ys = mm.map((q) => q.y);
        const x0 = Math.min(...xs), x1 = Math.max(...xs), y0 = Math.min(...ys), y1 = Math.max(...ys);
        const shape = normaliseWhimsy(d);
        whimsies.push({ name: nextName(), d: shape.d, w0: shape.w0, h0: shape.h0, solidity: shape.solidity,
            x: (x0 + x1) / 2, y: (y0 + y1) / 2, width: x1 - x0, rot: 0, pieces: 1, smooth: 2 });
        selectedWhimsy = whimsies.length - 1;
        buildWhimsyCards();
        regen(0);
    }
    endPick();
}

function splitMessage() {
    const n = S.splits.length;
    $("pickMsg").textContent = "Click a piece to split it in two. Click one of the halves to split it further." +
        (n ? " (" + n + (n === 1 ? " split)" : " splits)") : "");
    $("pickUndo").disabled = !n;
}

function nextName() {
    let n = whimsies.length + 1;
    while (whimsies.some((w) => w.name === "Figure " + n)) n++;
    return "Figure " + n;
}

function addImageWhimsy(d, box, edge) {
    const shape = normaliseWhimsy(d);
    const areaMm = (() => { const m = imageMap(); return box.w * box.h * m.s * m.s * 0.6; })();
    const suggested = Math.max(1, Math.min(4, Math.round(areaMm / (S.piece * S.piece * 1.6))));
    whimsies.push({
        name: nextName(), d: shape.d, w0: shape.w0, h0: shape.h0, solidity: shape.solidity,
        anchor: { cx: box.x + box.w / 2, cy: box.y + box.h / 2, wpx: box.w },
        edge: !!edge, edge0: !!edge,
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
        if (PICK.mode === "plug") { knobToolClick(stagePoint(evt)); evt.preventDefault(); return; }
        if (PICK.mode === "split") {
            const p = stagePoint(evt);
            S.splits.push({ x: p.x, y: p.y });
            splitMessage();
            regen(0);
            evt.preventDefault();
            return;
        }
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
    if (s < 0.85) return { cls: "good", txt: "Locks well" };
    if (s < 0.92) return { cls: "weak", txt: "Locks weakly" };
    return { cls: "bad", txt: "Falls out" };
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
    if (PICK.mode === "plug" && PICK.figure !== i) { PICK.figure = i; plugMessage(); }
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
            (w.anchor ? ' <span class="chip anchor">· follows picture</span>' : "") + "</span></div>" +
            '<button class="icon" type="button" aria-label="Remove ' + escapeHtml(w.name) + '" title="Remove">✕</button></div>' +
            '<div class="row"><span>Pieces</span><div class="stepper">' +
            '<button type="button" class="btn small" data-d="-1" aria-label="Fewer pieces">−</button>' +
            "<output>" + n + "</output>" +
            '<button type="button" class="btn small" data-d="1" aria-label="More pieces">+</button></div><span></span></div>' +
            '<div class="row"><span>Knobs</span><button type="button" class="btn small plugbtn">' +
            ((w.plugs || []).length ? (w.plugs.length + " · edit") : "Add") + "</button><span></span></div>" +
            '<label class="row"><span>Smoothing</span><input type="range" min="0" max="3" step="1" value="' + (w.smooth === undefined ? 1 : w.smooth) + '" id="wsmooth' + i + '"><output>' + SMOOTH_WORDS[w.smooth === undefined ? 1 : w.smooth] + "</output></label>" +
            '<label class="row"><span>Edge</span><input type="range" min="-3" max="6" step="0.5" value="' + (w.pad || 0) + '" id="wpad' + i + '"><output>' + padText(w.pad || 0) + "</output></label>" +
            (w.anchor ? "" :
            '<label class="row"><span>Size</span><input type="range" min="15" max="400" step="1" value="' + width + '" id="wsize' + i + '"><output>' + width + " mm</output></label>" +
            '<label class="row"><span>Rotation</span><input type="range" min="-180" max="180" step="5" value="' + w.rot + '" id="wrot' + i + '"><output>' + w.rot + "°</output></label>");
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
        card.querySelector(".plugbtn").addEventListener("click", () => { selectWhimsy(i); startKnobTool(); });
        const sm = card.querySelector("#wsmooth" + i);
        sm.addEventListener("input", () => { w.smooth = +sm.value; sm.nextElementSibling.textContent = SMOOTH_WORDS[w.smooth]; regen(); });
        const pad = card.querySelector("#wpad" + i);
        pad.addEventListener("input", () => { w.pad = +pad.value; pad.nextElementSibling.textContent = padText(w.pad); regen(); });
        const size = card.querySelector("#wsize" + i), rot = card.querySelector("#wrot" + i);
        const detach = () => {};
        if (size) size.addEventListener("input", () => { detach(); w.width = +size.value; size.nextElementSibling.textContent = size.value + " mm"; regen(); });
        if (rot) rot.addEventListener("input", () => { detach(); w.rot = +rot.value; rot.nextElementSibling.textContent = rot.value + "°"; regen(); });
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
    if (!paths.length) { document.body.removeChild(clone); throw new Error("No closed shape found in the file."); }
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
        if (!svg) throw new Error("The file doesn't look like an SVG.");
        const nat = measureBorder(svg);
        if (!(nat.w > 0 && nat.h > 0)) throw new Error("No shape with a size found in the file.");
        S.border = { name: name, natW: nat.w, natH: nat.h, svg: svg };
        S.borderW = Math.round(nat.w >= 80 && nat.w <= 600 ? nat.w : 200);
        whimsies.forEach((w) => { if (!w.anchor) { w.x = null; w.y = null; w.auto = true; } });
        $("bordername").textContent = name;
        $("borderW").value = S.borderW;
        $("borderloaded").hidden = false;
        $("drop").classList.add("has");
        regen(0);
    } catch (e) {
        alertInline("Couldn't use the shape: " + e.message);
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
    save("jigsaw-" + pieces + "-pieces-" + size + ".svg", '<?xml version="1.0" encoding="UTF-8"?>\n' + out);
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
    imgBtn.title = has && !IMG.bg ? "No plain background found around the motif in the picture" : "";
    $("pickFromImage").disabled = !has;
    $("pickHint").hidden = has;
}

function initUI() {
    seg("shapeSeg", setShape);
    seg("styleSeg", (v) => { S.style = v; regen(0); });
    $("borderSmooth").addEventListener("input", (e) => { S.borderSmooth = +e.target.value; $("borderSmoothOut").textContent = SMOOTH_WORDS[S.borderSmooth]; regen(); });
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
    const knobWord = (v) => v < 11 ? "Small" : v < 15 ? "Regular" : "Large";
    knobIn.addEventListener("input", () => { S.knob = +knobIn.value; $("knobOut").textContent = knobWord(S.knob); regen(); });
    $("knobOut").textContent = knobWord(S.knob);

    $("variant").addEventListener("click", () => { S.seed = Math.floor(Math.random() * 9999); regen(0); });
    $("autoKnobs").addEventListener("change", (e) => { S.autoKnobs = e.target.checked; regen(0); });
    $("autoFigureKnobs").addEventListener("change", (e) => { S.autoFigureKnobs = e.target.checked; regen(0); });
    $("knobTool").addEventListener("click", () => { if (generated) startKnobTool(); });

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
    $("pickDone").addEventListener("click", () => (PICK.mode === "plug" || PICK.mode === "split" ? endPick() : finishWand()));
    $("pickUndo").addEventListener("click", () => { if (S.splits.length) { S.splits.pop(); splitMessage(); regen(0); } });
    $("splitTool").addEventListener("click", () => { if (generated) startPick("split"); });
    $("pickTol").addEventListener("input", (e) => { PICK.tol = +e.target.value; });
    $("whimsySvg").addEventListener("change", (e) => {
        const f = e.target.files[0]; if (!f) return;
        readFile(f, (t) => {
            try { addWhimsyShape(f.name.replace(/\.svg$/i, ""), whimsyFromSvgText(t)); }
            catch (err) { alertInline("Couldn't use " + f.name + ": " + err); }
        });
        e.target.value = "";
    });

    const FORMAT_HINTS = {
        svg: "For LightBurn, xTool Creative Space, Glowforge and most laser software.",
        pdf: "For Bambu Suite (Bambu Lab R1 and H2D), and lasers you print to from Illustrator or CorelDRAW.",
        dxf: "For xTool Creative Space, RDWorks/LaserWorks, CAD programs and laser cutting services. Curves become fine polylines.",
    };
    let format = "svg";
    try { format = localStorage.getItem("jw-format") || "svg"; } catch (e) { /* storage blocked */ }
    const showFormat = () => {
        document.querySelectorAll("#formatSeg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === format));
        $("formatHint").textContent = FORMAT_HINTS[format];
        $("download").textContent = "Download " + format.toUpperCase() + " for laser";
    };
    seg("formatSeg", (v) => { format = v; try { localStorage.setItem("jw-format", v); } catch (e) { /* storage blocked */ } showFormat(); });
    showFormat();
    $("download").addEventListener("click", () => downloadCut(format));
    updateImageUI();
    regen(0);
}

window.addEventListener("load", initUI);
