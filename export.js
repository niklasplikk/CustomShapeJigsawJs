// Export of the cut lines as SVG, PDF or DXF. All three come from the same SVG the generator
// builds (svgstrsave, in millimetres). Paths are parsed into absolute line and cubic segments;
// PDF keeps the curves, DXF gets polylines with curves flattened to within FLAT_TOL mm.

const FLAT_TOL = 0.02;   // mm
const PT_PER_MM = 72 / 25.4;

// ------------------------------------------------------------------ path parsing
// Returns subpaths: [{start:{x,y}, segs:[{t:"L", p} | {t:"C", c1, c2, p}], closed}]
function parsePathD(d) {
    const tok = d.match(/[a-zA-Z]|-?(?:\d+\.?\d*|\.\d+)(?:e[-+]?\d+)?/g) || [];
    const subs = [];
    let i = 0, cmd = null, cur = { x: 0, y: 0 }, start = null, sub = null, lastC2 = null, lastQ = null;
    const num = () => parseFloat(tok[i++]);
    const isNum = () => i < tok.length && !/^[a-zA-Z]$/.test(tok[i]);
    while (i < tok.length) {
        if (/^[a-zA-Z]$/.test(tok[i])) cmd = tok[i++];
        else if (!cmd) { i++; continue; }
        const rel = cmd === cmd.toLowerCase(), C = cmd.toUpperCase();
        const P = (x, y) => (rel ? { x: cur.x + x, y: cur.y + y } : { x: x, y: y });
        if (C === "Z") {
            if (sub) { if (start && (cur.x !== start.x || cur.y !== start.y)) sub.segs.push({ t: "L", p: start }); sub.closed = true; cur = start; }
            lastC2 = lastQ = null;
            continue;
        }
        if (!isNum()) { i++; continue; }
        if (C === "M") {
            cur = P(num(), num()); start = cur;
            sub = { start: cur, segs: [], closed: false }; subs.push(sub);
            cmd = rel ? "l" : "L";   // further pairs are line-to
            lastC2 = lastQ = null;
            continue;
        }
        if (!sub) { sub = { start: cur, segs: [], closed: false }; subs.push(sub); start = cur; }
        if (C === "L") { cur = P(num(), num()); sub.segs.push({ t: "L", p: cur }); lastC2 = lastQ = null; }
        else if (C === "H") { const x = num(); cur = { x: rel ? cur.x + x : x, y: cur.y }; sub.segs.push({ t: "L", p: cur }); lastC2 = lastQ = null; }
        else if (C === "V") { const y = num(); cur = { x: cur.x, y: rel ? cur.y + y : y }; sub.segs.push({ t: "L", p: cur }); lastC2 = lastQ = null; }
        else if (C === "C") {
            const c1 = P(num(), num()), c2 = P(num(), num()), p = P(num(), num());
            sub.segs.push({ t: "C", c1: c1, c2: c2, p: p }); cur = p; lastC2 = c2; lastQ = null;
        } else if (C === "S") {
            const c1 = lastC2 ? { x: 2 * cur.x - lastC2.x, y: 2 * cur.y - lastC2.y } : cur;
            const c2 = P(num(), num()), p = P(num(), num());
            sub.segs.push({ t: "C", c1: c1, c2: c2, p: p }); cur = p; lastC2 = c2; lastQ = null;
        } else if (C === "Q" || C === "T") {
            const q = C === "Q" ? P(num(), num()) : (lastQ ? { x: 2 * cur.x - lastQ.x, y: 2 * cur.y - lastQ.y } : cur);
            const p = P(num(), num());
            sub.segs.push({ t: "C", c1: { x: cur.x + (2 / 3) * (q.x - cur.x), y: cur.y + (2 / 3) * (q.y - cur.y) },
                c2: { x: p.x + (2 / 3) * (q.x - p.x), y: p.y + (2 / 3) * (q.y - p.y) }, p: p });
            cur = p; lastQ = q; lastC2 = null;
        } else if (C === "A") {
            const rx = num(), ry = num(), rot = num(), large = num(), sweep = num(), p = P(num(), num());
            arcToCubics(cur, rx, ry, rot, large, sweep, p).forEach((s) => sub.segs.push(s));
            cur = p; lastC2 = lastQ = null;
        } else { i++; }
    }
    return subs.filter((s) => s.segs.length);
}

// SVG arc to cubic Béziers (standard endpoint-to-centre conversion)
function arcToCubics(p0, rx, ry, phiDeg, fa, fs, p1) {
    if (!rx || !ry) return [{ t: "L", p: p1 }];
    rx = Math.abs(rx); ry = Math.abs(ry);
    const phi = (phiDeg * Math.PI) / 180, cs = Math.cos(phi), sn = Math.sin(phi);
    const dx = (p0.x - p1.x) / 2, dy = (p0.y - p1.y) / 2;
    const x1 = cs * dx + sn * dy, y1 = -sn * dx + cs * dy;
    let lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry);
    if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam); }
    const sgn = fa === fs ? -1 : 1;
    const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1;
    const co = sgn * Math.sqrt(Math.max(0, num / (rx * rx * y1 * y1 + ry * ry * x1 * x1)));
    const cxp = (co * rx * y1) / ry, cyp = (-co * ry * x1) / rx;
    const cx = cs * cxp - sn * cyp + (p0.x + p1.x) / 2, cy = sn * cxp + cs * cyp + (p0.y + p1.y) / 2;
    const ang = (ux, uy, vx, vy) => { const a = Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy); return a; };
    let t1 = ang(1, 0, (x1 - cxp) / rx, (y1 - cyp) / ry);
    let dt = ang((x1 - cxp) / rx, (y1 - cyp) / ry, (-x1 - cxp) / rx, (-y1 - cyp) / ry);
    if (!fs && dt > 0) dt -= 2 * Math.PI; else if (fs && dt < 0) dt += 2 * Math.PI;
    const n = Math.ceil(Math.abs(dt) / (Math.PI / 2)), h = dt / n, k = (4 / 3) * Math.tan(h / 4);
    const pt = (t) => ({ x: cx + rx * Math.cos(t) * cs - ry * Math.sin(t) * sn, y: cy + rx * Math.cos(t) * sn + ry * Math.sin(t) * cs });
    const dv = (t) => ({ x: -rx * Math.sin(t) * cs - ry * Math.cos(t) * sn, y: -rx * Math.sin(t) * sn + ry * Math.cos(t) * cs });
    const out = [];
    for (let j = 0; j < n; j++) {
        const a = t1 + j * h, b = a + h, pa = pt(a), pb = pt(b), da = dv(a), db = dv(b);
        out.push({ t: "C", c1: { x: pa.x + k * da.x, y: pa.y + k * da.y }, c2: { x: pb.x - k * db.x, y: pb.y - k * db.y }, p: j === n - 1 ? p1 : pb });
    }
    return out;
}

// All cut paths of the current puzzle, in mm, plus the sheet size.
function cutGeometry() {
    const doc = new DOMParser().parseFromString(svgstrsave.replace('"<rect', "<rect"), "image/svg+xml");
    const svg = doc.getElementsByTagName("svg")[0];
    const vb = (svg.getAttribute("viewBox") || "").split(/[\s,]+/).map(Number);
    const W = vb[2] || parseFloat(svg.getAttribute("width")), H = vb[3] || parseFloat(svg.getAttribute("height"));
    const subs = [];
    for (const p of svg.getElementsByTagName("path")) parsePathD(p.getAttribute("d") || "").forEach((s) => subs.push(s));
    for (const r of svg.getElementsByTagName("rect")) {
        const x = +r.getAttribute("x"), y = +r.getAttribute("y"), w = +r.getAttribute("width"), h = +r.getAttribute("height");
        subs.push(...parsePathD("M " + x + " " + y + " H " + (x + w) + " V " + (y + h) + " H " + x + " Z"));
    }
    return { W: W, H: H, subs: subs };
}

// ------------------------------------------------------------------ PDF
function buildPdf() {
    const g = cutGeometry();
    const f = (v) => (Math.round(v * 1000) / 1000).toString();
    const X = (p) => f(p.x * PT_PER_MM), Y = (p) => f((g.H - p.y) * PT_PER_MM);
    let cs = "0 0 0 RG " + f(0.1 * PT_PER_MM) + " w 1 J 1 j\n";
    g.subs.forEach((s) => {
        cs += X(s.start) + " " + Y(s.start) + " m\n";
        s.segs.forEach((sg) => {
            cs += sg.t === "L" ? X(sg.p) + " " + Y(sg.p) + " l\n"
                : X(sg.c1) + " " + Y(sg.c1) + " " + X(sg.c2) + " " + Y(sg.c2) + " " + X(sg.p) + " " + Y(sg.p) + " c\n";
        });
        cs += s.closed ? "h S\n" : "S\n";
    });
    const pw = f(g.W * PT_PER_MM), ph = f(g.H * PT_PER_MM);
    const objs = [
        "<< /Type /Catalog /Pages 2 0 R >>",
        "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 " + pw + " " + ph + "] /Contents 4 0 R /Resources << >> >>",
        "<< /Length " + cs.length + " >>\nstream\n" + cs + "endstream",
        "<< /Title (Jigsaw Workshop cut lines) /Producer (Jigsaw Workshop) >>",
    ];
    let out = "%PDF-1.4\n", offs = [];
    objs.forEach((o, k) => { offs.push(out.length); out += (k + 1) + " 0 obj\n" + o + "\nendobj\n"; });
    const xref = out.length;
    out += "xref\n0 " + (objs.length + 1) + "\n0000000000 65535 f \n" + offs.map((o) => String(o).padStart(10, "0") + " 00000 n \n").join("");
    out += "trailer\n<< /Size " + (objs.length + 1) + " /Root 1 0 R /Info 5 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
    return out;
}

// ------------------------------------------------------------------ DXF (R12, polylines, mm)
function flattenCubic(p0, c1, c2, p3, out, depth) {
    // flat enough when the control points are within FLAT_TOL of the chord
    const dx = p3.x - p0.x, dy = p3.y - p0.y, L = Math.hypot(dx, dy) || 1e-9;
    const d1 = Math.abs((c1.x - p0.x) * dy - (c1.y - p0.y) * dx) / L;
    const d2 = Math.abs((c2.x - p0.x) * dy - (c2.y - p0.y) * dx) / L;
    if ((d1 + d2) * 0.75 <= FLAT_TOL || depth > 16) { out.push(p3); return; }
    const m = (a, b) => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });
    const a = m(p0, c1), b = m(c1, c2), c = m(c2, p3), ab = m(a, b), bc = m(b, c), mid = m(ab, bc);
    flattenCubic(p0, a, ab, mid, out, depth + 1);
    flattenCubic(mid, bc, c, p3, out, depth + 1);
}

function buildDxf() {
    const g = cutGeometry();
    const f = (v) => (Math.round(v * 10000) / 10000).toString();
    const L = ["0", "SECTION", "2", "HEADER", "9", "$ACADVER", "1", "AC1009", "9", "$INSUNITS", "70", "4",
        "9", "$EXTMIN", "10", "0", "20", "0", "9", "$EXTMAX", "10", f(g.W), "20", f(g.H), "0", "ENDSEC",
        "0", "SECTION", "2", "TABLES", "0", "TABLE", "2", "LAYER", "70", "1",
        "0", "LAYER", "2", "CUT", "70", "0", "62", "1", "6", "CONTINUOUS", "0", "ENDTAB", "0", "ENDSEC",
        "0", "SECTION", "2", "ENTITIES"];
    g.subs.forEach((s) => {
        const pts = [s.start];
        let cur = s.start;
        s.segs.forEach((sg) => {
            if (sg.t === "L") pts.push(sg.p); else flattenCubic(cur, sg.c1, sg.c2, sg.p, pts, 0);
            cur = sg.p;
        });
        let closed = s.closed;
        if (closed && pts.length > 1) {
            const a = pts[0], b = pts[pts.length - 1];
            if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) pts.pop();
        }
        L.push("0", "POLYLINE", "8", "CUT", "66", "1", "70", closed ? "1" : "0");
        pts.forEach((p) => L.push("0", "VERTEX", "8", "CUT", "10", f(p.x), "20", f(g.H - p.y)));
        L.push("0", "SEQEND", "8", "CUT");
    });
    L.push("0", "ENDSEC", "0", "EOF");
    return L.join("\r\n") + "\r\n";
}

// ------------------------------------------------------------------ download
function saveBlob(filename, data, type) {
    const blob = new Blob([data], { type: type });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
}

function exportName(ext) {
    const pieces = parseInt($("piececount").textContent) || 0;
    const size = $("stat-size").textContent.replace(/\s/g, "").replace("×", "x");
    return "jigsaw-" + pieces + "-pieces-" + size + "." + ext;
}

function downloadCut(fmt) {
    if (fmt === "pdf") return saveBlob(exportName("pdf"), buildPdf(), "application/pdf");
    if (fmt === "dxf") return saveBlob(exportName("dxf"), buildDxf(), "application/dxf");
    return savesvg();
}
