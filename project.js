// Saving and opening projects.
// A project is the picture plus every setting and edit; the cut lines are not stored, because the
// generator recreates them exactly from these (it is seeded). Two ways to keep one:
//  - a .jigsaw file (JSON with the picture embedded), saved and opened by the user
//  - an autosave in this browser (IndexedDB), offered back when the app is opened again

const PROJECT_VERSION = 1;
const STATE_KEYS = ["shape", "w", "h", "borderW", "imgW", "piece", "style", "knob", "seed", "showImage",
    "splits", "autoSplit", "borderSmooth", "edgeKnobs", "autoKnobs", "autoFigureKnobs"];
// what a figure needs to be rebuilt; everything else on it is worked out again
const FIGURE_KEYS = ["name", "dRaw", "w0Raw", "h0Raw", "solidRaw", "anchor", "edge", "edge0", "pieces", "smooth", "pad",
    "plugs", "x", "y", "width", "rot"];

let restoring = false;

function projectName() {
    if (IMG.name) return IMG.name.replace(/\.[^.]+$/, "");
    if (S.border && S.border.name) return S.border.name.replace(/\.[^.]+$/, "");
    return "jigsaw";
}

function projectState() {
    const state = {};
    STATE_KEYS.forEach((k) => { state[k] = S[k]; });
    return {
        app: "Jigsaw Workshop",
        version: PROJECT_VERSION,
        name: projectName(),
        savedAt: new Date().toISOString(),
        state: state,
        border: S.border ? { name: S.border.name, text: new XMLSerializer().serializeToString(S.border.svg) } : null,
        figures: whimsies.map((w) => {
            const f = {};
            FIGURE_KEYS.forEach((k) => { if (w[k] !== undefined) f[k] = w[k]; });
            if (!f.dRaw) { f.dRaw = w.d; f.w0Raw = w.w0; f.h0Raw = w.h0; f.solidRaw = w.solidity; }
            return f;
        }),
        photo: IMG.file ? { name: IMG.name, type: IMG.file.type || "image/png" } : null,
    };
}

function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
        const fr = new FileReader();
        fr.onload = () => resolve(fr.result);
        fr.onerror = () => reject(fr.error);
        fr.readAsDataURL(blob);
    });
}

async function saveProjectFile() {
    const p = projectState();
    if (p.photo) p.photo.data = await blobToDataURL(IMG.file);
    saveBlob(p.name + ".jigsaw", JSON.stringify(p), "application/json");
    projectStatus("Saved " + p.name + ".jigsaw");
}

async function openProjectFile(file) {
    try {
        let p = null;
        try { p = JSON.parse(await file.text()); } catch (e) { /* not JSON */ }
        if (!p || p.app !== "Jigsaw Workshop" || !p.state) throw new Error("this file isn't a Jigsaw Workshop project (.jigsaw).");
        let photo = null;
        if (p.photo && p.photo.data) {
            const blob = await (await fetch(p.photo.data)).blob();
            photo = new File([blob], p.photo.name, { type: p.photo.type });
        }
        await restoreProject(p, photo);
        projectStatus("Opened " + file.name);
    } catch (e) {
        alertInline("Couldn't open the project: " + (e.message || e));
    }
}

async function restoreProject(p, photoFile) {
    restoring = true;
    try {
        if (PICK.mode) endPick();
        // picture
        if (photoFile) {
            await loadImageFile(photoFile);
            IMG.file = photoFile;
        } else {
            if (IMG.url) URL.revokeObjectURL(IMG.url);
            Object.assign(IMG, { url: null, file: null, name: "", bg: null });
        }
        updateImageUI();
        // outline from an SVG file
        S.border = null;
        if (p.border && p.border.text) {
            const svg = new DOMParser().parseFromString(p.border.text, "image/svg+xml").getElementsByTagName("svg")[0];
            const nat = measureBorder(svg);
            S.border = { name: p.border.name, natW: nat.w, natH: nat.h, svg: svg };
            $("bordername").textContent = p.border.name;
            $("borderloaded").hidden = false;
            $("drop").classList.add("has");
        } else {
            $("borderloaded").hidden = true;
            $("drop").classList.remove("has");
        }
        // settings
        STATE_KEYS.forEach((k) => { if (p.state[k] !== undefined) S[k] = p.state[k]; });
        S.splits = S.splits || [];
        S.edgeKnobs = S.edgeKnobs || [];
        if (S.shape === "image" && !IMG.bg) S.shape = "rect";
        if (S.shape === "svg" && !S.border) S.shape = "rect";
        // figures
        whimsies = (p.figures || []).map((f) => Object.assign({}, f, {
            d: f.dRaw, w0: f.w0Raw, h0: f.h0Raw, solidity: f.solidRaw, smoothKey: null,
        }));
        selectedWhimsy = 0;
        syncControls();
        buildWhimsyCards();
        VIEW = null;
        regen(0);
    } finally {
        restoring = false;
    }
}

// puts every control in the panel in line with S
function syncControls() {
    const set = (id, v) => { const el = $(id); if (el) el.value = v; };
    set("rectW", S.w); set("rectH", S.h); set("imgW", S.imgW); set("borderW", S.borderW);
    set("pieceSize", S.piece); $("pieceOut").textContent = S.piece + " mm";
    set("knobSize", S.knob); $("knobOut").textContent = S.knob < 11 ? "Small" : S.knob < 15 ? "Regular" : "Large";
    set("borderSmooth", S.borderSmooth); $("borderSmoothOut").textContent = SMOOTH_WORDS[S.borderSmooth];
    $("photoToggle").checked = S.showImage !== false;
    $("autoKnobs").checked = S.autoKnobs !== false;
    $("autoFigureKnobs").checked = !!S.autoFigureKnobs;
    document.querySelectorAll("#styleSeg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === S.style));
    document.querySelectorAll("#shapeSeg button").forEach((b) => b.setAttribute("aria-pressed", b.dataset.v === S.shape));
    $("rectOpts").hidden = S.shape !== "rect";
    $("svgOpts").hidden = S.shape !== "svg";
    $("imgOpts").hidden = S.shape !== "image";
}

function projectStatus(text) {
    const el = $("projectStatus");
    if (el) el.textContent = text;
}

// ------------------------------------------------------------------ autosave in this browser
const DB_NAME = "jigsaw-workshop", DB_STORE = "projects";

function openDb() {
    return new Promise((resolve, reject) => {
        if (!window.indexedDB) return reject(new Error("no IndexedDB"));
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => req.result.createObjectStore(DB_STORE);
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
    });
}

async function dbPut(key, value) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, "readwrite");
        tx.objectStore(DB_STORE).put(value, key);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error); };
    });
}

async function dbGet(key) {
    const db = await openDb();
    return new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, "readonly");
        const req = tx.objectStore(DB_STORE).get(key);
        req.onsuccess = () => { db.close(); resolve(req.result); };
        req.onerror = () => { db.close(); reject(req.error); };
    });
}

let autosaveTimer = null;
function scheduleAutosave() {
    if (restoring) return;
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(async () => {
        try {
            const p = projectState();
            await dbPut("last", { project: p, photo: IMG.file || null });
            projectStatus("Saved in this browser " + new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }));
        } catch (e) {
            projectStatus("");   // private window or storage turned off: the Save button still works
        }
    }, 800);
}

async function offerLastProject() {
    let last = null;
    try { last = await dbGet("last"); } catch (e) { return; }
    if (!last || !last.project) return;
    const p = last.project, when = new Date(p.savedAt);
    const bar = $("resumeBar");
    $("resumeText").textContent = "Continue “" + p.name + "” from " +
        when.toLocaleDateString([], { day: "numeric", month: "short" }) + " " +
        when.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) + "?";
    bar.hidden = false;
    $("resumeYes").onclick = async () => {
        bar.hidden = true;
        await restoreProject(p, last.photo ? new File([last.photo], p.photo ? p.photo.name : "picture", { type: last.photo.type }) : null);
        projectStatus("Continued from your last session");
    };
    $("resumeNo").onclick = () => { bar.hidden = true; };
}

window.addEventListener("load", () => {
    $("saveProject").addEventListener("click", saveProjectFile);
    $("openProject").addEventListener("change", (e) => {
        const f = e.target.files[0];
        e.target.value = "";
        if (f) openProjectFile(f);
    });
    offerLastProject();
});
