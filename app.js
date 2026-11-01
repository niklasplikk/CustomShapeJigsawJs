// Puslespillgenerator — UI layer on top of engine.js (CustomShapeJigsawJs by proceduraljigsaw, MIT).
// The engine still reads its settings from the hidden #engine inputs; this file fills them in,
// runs generate() and draws the result on the preview stage.

const NS = "http://www.w3.org/2000/svg";
const STYLE_NOISE = { classic: 0.12, organic: 0.5, wild: 0.9 };
const SHAPE_NAMES = { butterfly: "Sommerfugl", fish: "Fisk", star: "Stjerne", heart: "Hjerte" };

const S = {
    shape: "rect",          // "rect" | "custom"
    w: 300, h: 200,         // rectangle size, mm
    border: null,           // {name, natW, natH}
    borderW: 200,           // wanted width of custom shape, mm
    piece: 30,              // approximate piece size, mm
    style: "classic",
    knob: 13,               // knob head radius, % of piece size
    seed: Math.floor(Math.random() * 9999),
    image: null,            // object URL of preview photo
    showImage: true,
};

let generated = false;

// ------------------------------------------------------------------ knobs
// Classic knob: flat shoulders, narrow neck, round head. Sized from the piece size
// rather than the edge length, so every piece gets the same, proper-sized knobs.
function gentab(v1, v2, isnew) {
    const L = Math.hypot(v2.x - v1.x, v2.y - v1.y);
    const want = (S.knob / 100) * S.piece;
    const r = Math.min(want, 0.15 * L);
    const start = isnew ? "M " + v1.x + " " + v1.y + " " : "";
    // short edges get no knob rather than a tiny one that looks wrong and breaks
    if (r < 0.6 * want || r < 1.5) return start + "L " + v2.x + " " + v2.y + " ";
    next(); // engine's jitter: flip, a..e
    const t = (r / L) * (1 + c);      // head size varies a little
    const m = 0.5 + b * 0.6;          // knob centre slides a little along the edge
    const P = (l, w) => ({ l: l, w: w * (flip ? -1 : 1) });
    const pts = [
        // shoulder
        [P(0.2, a * 0.3), P(m - 1.6 * t, -0.05 * t), P(m - 1.1 * t, -0.05 * t)],
        // into the neck
        [P(m - 0.55 * t, -0.05 * t), P(m - 0.25 * t, 0.7 * t), P(m - 0.6 * t, 0.9 * t)],
        // left half of the head
        [P(m - 1.3 * t, 1.3 * t), P(m - 0.8 * t, 2.35 * t + d * 0.2), P(m, 2.35 * t + d * 0.2)],
        // right half of the head
        [P(m + 0.8 * t, 2.35 * t + d * 0.2), P(m + 1.3 * t, 1.3 * t), P(m + 0.6 * t, 0.9 * t)],
        // out of the neck
        [P(m + 0.25 * t, 0.7 * t), P(m + 0.55 * t, -0.05 * t), P(m + 1.1 * t, -0.05 * t)],
        // shoulder
        [P(m + 1.6 * t, -0.05 * t), P(0.8, e * 0.3), P(1, 0)],
    ];
    let str = start;
    const dl = { x: v2.x - v1.x, y: v2.y - v1.y }, dw = { x: -dl.y, y: dl.x };
    const at = (p) => (v1.x + p.l * dl.x + p.w * dw.x) + " " + (v1.y + p.l * dl.y + p.w * dw.y);
    pts.forEach((seg) => { str += "C " + seg.map(at).join(" ") + " "; });
    return str;
}

// ------------------------------------------------------------------ engine sync
function cellSize() { return Math.max(0.6, Math.round((S.piece / 24) * 20) / 20); }

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
    if (S.shape === "rect") {
        customborder = {};
        set("ncols", Math.max(10, Math.round(S.w / cell)));
        set("nrows", Math.max(10, Math.round(S.h / cell)));
    } else {
        customborder = { svgdata: S.border.svg };
        set("cbsf", S.borderW / S.border.natW);
    }
}

// ------------------------------------------------------------------ generate
let regenTimer = null;
function regen(delay) {
    clearTimeout(regenTimer);
    if (S.shape === "custom" && !S.border) { drawEmpty(); return; }
    $("busy").hidden = false;
    regenTimer = setTimeout(() => {
        try {
            syncEngine();
            generate();
            generated = true;
            renderStage();
        } catch (e) {
            console.error(e);
            $("warnings").innerHTML = '<p class="warn">Noe gikk galt under genereringen: ' + escapeHtml(String(e.message || e)) + "</p>";
        }
        $("busy").hidden = true;
    }, delay === undefined ? 250 : delay);
}

function escapeHtml(s) { return s.replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" })[c]); }

// ------------------------------------------------------------------ stage
function renderStage() {
    const cell = parseFloat($("cell_scale").value);
    const W = automata.columns * cell, H = automata.rows * cell;
    const inner = svgstr.slice(svgstr.indexOf(">") + 1, svgstr.lastIndexOf("</svg>"));
    let boardD;
    const wpaths = [];
    if (window.lastShapes) {
        boardD = lastShapes.filter((s) => !s.whimsy).map((s) => s.d).join(" ");
        lastShapes.filter((s) => s.whimsy).forEach((s) => wpaths.push(s.d));
    } else {
        const m = inner.match(/<rect x="0" y="0" width="([\d.]+)" height="([\d.]+)"/);
        const rw = m ? m[1] : W, rh = m ? m[2] : H;
        boardD = "M 0 0 H " + rw + " V " + rh + " H 0 Z";
    }
    const stage = $("stage");
    const pad = Math.max(W, H) * 0.03;
    stage.setAttribute("viewBox", [-pad, -pad, W + 2 * pad, H + 2 * pad].join(" "));
    let html = '<defs><clipPath id="boardclip"><path clip-rule="evenodd" d="' + boardD + '"/></clipPath></defs>';
    html += '<path class="board" fill-rule="evenodd" d="' + boardD + '"/>';
    html += '<g id="photo"></g>';
    html += '<g class="whimsyfills">' + wpaths.map((d, i) => '<path data-i="' + i + '" class="wfill' + (i === selectedWhimsy ? " sel" : "") + '" d="' + d + '"/>').join("") + "</g>";
    html += '<g class="cuts">' + inner.replace(/^"/, "") + "</g>";
    stage.innerHTML = html;
    stage.querySelectorAll(".cuts > :not(path):not(rect)").forEach((n) => n.remove());

    // photo underlay, clipped to the board
    const bb = stage.querySelector(".board").getBBox();
    if (S.image && S.showImage) {
        const img = document.createElementNS(NS, "image");
        img.setAttribute("href", S.image);
        img.setAttribute("x", bb.x); img.setAttribute("y", bb.y);
        img.setAttribute("width", bb.width); img.setAttribute("height", bb.height);
        img.setAttribute("preserveAspectRatio", "xMidYMid slice");
        img.setAttribute("clip-path", "url(#boardclip)");
        $("photo").appendChild(img);
        stage.classList.add("withphoto");
    } else {
        stage.classList.remove("withphoto");
    }

    // stats
    const pieces = parseInt($("piececount").textContent) || 0;
    $("stat-size").textContent = Math.round(bb.width) + " × " + Math.round(bb.height) + " mm";
    $("stat-pieces").textContent = pieces + (pieces === 1 ? " brikke" : " brikker");
    $("stat-shaped").textContent = whimsies.length ? "· " + whimsies.length + " spesial" : "";
    $("download").disabled = false;
    $("empty").hidden = true;
    stage.hidden = false;
    if (S.shape === "custom" && S.border) $("borderH").textContent = Math.round(bb.height);

    // shapes that lost their place (new outline) are spread out once the new board exists
    const autos = whimsies.filter((w) => w.auto);
    if (autos.length) {
        autos.forEach((w) => { w.x = null; w.y = null; });
        autos.forEach((w) => { const p = findFreeSpot(w.width); w.x = p.x; w.y = p.y; delete w.auto; });
        regen(0);
        return;
    }

    const warns = $("whimsywarn").innerText.trim();
    $("warnings").innerHTML = warns ? warns.split("\n").map((w) => '<p class="warn">' + escapeHtml(w.replace(/^⚠\s*/, "")) + "</p>").join("") : "";
}

function drawEmpty() {
    $("stage").hidden = true;
    $("empty").hidden = false;
    $("download").disabled = true;
    $("stat-size").textContent = "–"; $("stat-pieces").textContent = ""; $("stat-shaped").textContent = "";
}

// drag shaped pieces around on the stage
(function setupDrag() {
    let drag = null;
    const stage = () => $("stage");
    const toSvg = (evt) => {
        const pt = stage().createSVGPoint();
        pt.x = evt.clientX; pt.y = evt.clientY;
        return pt.matrixTransform(stage().getScreenCTM().inverse());
    };
    document.addEventListener("pointerdown", (evt) => {
        const t = evt.target;
        if (!t.classList || !t.classList.contains("wfill")) return;
        const i = parseInt(t.dataset.i);
        selectWhimsy(i);
        drag = { i: i, el: t, p0: toSvg(evt), id: evt.pointerId };
        t.setPointerCapture(evt.pointerId);
        stage().classList.add("dragging");
        evt.preventDefault();
    });
    document.addEventListener("pointermove", (evt) => {
        if (!drag) return;
        const p = toSvg(evt);
        drag.dx = p.x - drag.p0.x; drag.dy = p.y - drag.p0.y;
        drag.el.setAttribute("transform", "translate(" + drag.dx + "," + drag.dy + ")");
    });
    const end = () => {
        if (!drag) return;
        stage().classList.remove("dragging");
        if (drag.dx || drag.dy) {
            const w = whimsies[drag.i];
            w.x += drag.dx; w.y += drag.dy;
            regen(0);
        }
        drag = null;
    };
    document.addEventListener("pointerup", end);
    document.addEventListener("pointercancel", end);
})();

// ------------------------------------------------------------------ shaped pieces
function thumbSvg(shape, cls) {
    return '<svg class="' + (cls || "thumb") + '" viewBox="' + (-3) + " " + (-3) + " " + (shape.w0 + 6) + " " + (shape.h0 + 6) +
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
    const cell = parseFloat($("cell_scale").value);
    const inside = (x, y) => board.isPointInFill(new DOMPoint(x, y));
    let best = null, bestScore = -1;
    for (let gy = 1; gy <= 6; gy++) for (let gx = 1; gx <= 6; gx++) {
        const x = bb.x + (bb.width * gx) / 7, y = bb.y + (bb.height * gy) / 7, r = width * 0.55;
        if (![[0, 0], [r, 0], [-r, 0], [0, r], [0, -r]].every(([dx, dy]) => inside(x + dx, y + dy))) continue;
        let score = 1e9;
        whimsies.forEach((w) => { if (w.x !== null) score = Math.min(score, Math.hypot(w.x + cell / 2 - x, w.y + cell / 2 - y)); });
        score = Math.min(score, 1e8) - 0.001 * Math.hypot(x - bb.x - bb.width / 2, y - bb.y - bb.height / 2);
        if (score > bestScore) { bestScore = score; best = { x: x - cell / 2, y: y - cell / 2 }; }
    }
    return best || { x: null, y: null };
}

function addWhimsyShape(name, shape) {
    const width = Math.round(Math.max(30, Math.min(60, S.piece * 1.6)));
    const spot = findFreeSpot(width);
    whimsies.push({ name: name, d: shape.d, w0: shape.w0, h0: shape.h0, solidity: shape.solidity,
        x: spot.x, y: spot.y, width: width, rot: 0 });
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
        const card = document.createElement("div");
        card.className = "wcard" + (i === selectedWhimsy ? " sel" : "");
        card.innerHTML =
            '<div class="whead">' + thumbSvg(w, "wthumb") +
            '<div class="wname"><strong>' + escapeHtml(w.name) + '</strong><span class="chip ' + lock.cls + '">' + lock.txt + "</span></div>" +
            '<button class="icon" type="button" aria-label="Fjern ' + escapeHtml(w.name) + '" title="Fjern">✕</button></div>' +
            '<label class="row"><span>Størrelse</span><input type="range" min="15" max="150" step="1" value="' + w.width + '" id="wsize' + i + '"><output>' + w.width + " mm</output></label>" +
            '<label class="row"><span>Rotasjon</span><input type="range" min="-180" max="180" step="5" value="' + w.rot + '" id="wrot' + i + '"><output>' + w.rot + "°</output></label>";
        card.addEventListener("pointerdown", () => selectWhimsy(i));
        card.querySelector("button").addEventListener("click", () => {
            whimsies.splice(i, 1);
            selectedWhimsy = Math.max(0, Math.min(selectedWhimsy, whimsies.length - 1));
            buildWhimsyCards();
            regen(0);
        });
        const size = card.querySelector("#wsize" + i), rot = card.querySelector("#wrot" + i);
        size.addEventListener("input", () => { w.width = +size.value; size.nextElementSibling.textContent = size.value + " mm"; regen(); });
        rot.addEventListener("input", () => { w.rot = +rot.value; rot.nextElementSibling.textContent = rot.value + "°"; regen(); });
        list.appendChild(card);
    });
    $("whint").hidden = !whimsies.length;
}

// ------------------------------------------------------------------ custom outline
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
        whimsies.forEach((w) => { w.x = null; w.y = null; w.auto = true; });
        $("bordername").textContent = name;
        $("borderW").value = S.borderW;
        $("borderH").textContent = Math.round(S.borderW * nat.h / nat.w);
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
        g.querySelectorAll("button").forEach((x) => x.setAttribute("aria-pressed", x === b));
        onPick(b.dataset.v);
    }));
}

function initUI() {
    seg("shapeSeg", (v) => {
        S.shape = v;
        $("rectOpts").hidden = v !== "rect";
        $("customOpts").hidden = v !== "custom";
        whimsies.forEach((w) => { w.x = null; w.y = null; w.auto = true; });
        regen(0);
    });
    seg("styleSeg", (v) => { S.style = v; regen(0); });

    const num = (id, key) => $(id).addEventListener("input", () => {
        const v = parseFloat($(id).value);
        if (v >= 20 && v <= 2000) { S[key] = v; regen(400); }
    });
    num("rectW", "w"); num("rectH", "h"); num("borderW", "borderW");

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

    // custom outline: file picker + drag and drop
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
    $("photoFile").addEventListener("change", (e) => {
        const f = e.target.files[0]; if (!f) return;
        if (S.image) URL.revokeObjectURL(S.image);
        S.image = URL.createObjectURL(f);
        S.showImage = true;
        $("photoName").textContent = f.name;
        $("photoLoaded").hidden = false;
        $("photoToggle").checked = true;
        e.target.value = "";
        if (generated) renderStage();
    });
    $("photoToggle").addEventListener("change", (e) => { S.showImage = e.target.checked; if (generated) renderStage(); });
    $("photoRemove").addEventListener("click", () => {
        if (S.image) URL.revokeObjectURL(S.image);
        S.image = null; $("photoLoaded").hidden = true;
        if (generated) renderStage();
    });

    // shaped-piece gallery
    const gal = $("gallery");
    Object.keys(SHAPE_NAMES).forEach((k) => {
        const shape = normaliseWhimsy(BUILTIN_WHIMSIES[k]);
        const b = document.createElement("button");
        b.type = "button"; b.className = "gitem";
        b.innerHTML = thumbSvg(shape) + "<span>" + SHAPE_NAMES[k] + "</span>";
        b.addEventListener("click", () => addWhimsyShape(SHAPE_NAMES[k], shape));
        gal.appendChild(b);
    });
    const own = document.createElement("label");
    own.className = "gitem own";
    own.innerHTML = '<svg class="thumb" viewBox="0 0 24 24" aria-hidden="true"><path d="M12 5v14M5 12h14"/></svg><span>Egen SVG</span><input type="file" accept=".svg,image/svg+xml" hidden>';
    own.querySelector("input").addEventListener("change", (e) => {
        const f = e.target.files[0]; if (!f) return;
        readFile(f, (t) => {
            try { addWhimsyShape(f.name.replace(/\.svg$/i, ""), whimsyFromSvgText(t)); }
            catch (err) { alertInline("Kunne ikke bruke " + f.name + ": " + err); }
        });
        e.target.value = "";
    });
    gal.appendChild(own);

    $("download").addEventListener("click", savesvg);
    regen(0);
}

window.addEventListener("load", initUI);
