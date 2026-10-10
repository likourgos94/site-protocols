// Site Protocols: write site protocols on the iPhone and share them as PDF.
// Everything is stored on the phone (IndexedDB), so it works without signal.

// ---------- Fixed texts (German / English) ----------

const TYPES = {
  inspection: "Begehung / Site inspection",
  meeting: "Besprechung / Meeting",
  acceptance: "Abnahme / Acceptance",
  defect: "Mängelanzeige / Defect report",
};

const RESULTS = {
  "": "–",
  ok: "OK",
  defect: "Mangel / Defect",
};

// The three repeating parts of a protocol and their fields.
const LISTS = {
  attendees: {
    title: "Teilnehmer / Attendee",
    blank: () => ({ name: "", company: "", role: "" }),
    fields: [
      { key: "name", label: "Name", list: "people-names" },
      { key: "company", label: "Firma / Company" },
      { key: "role", label: "Funktion / Role" },
    ],
  },
  topics: {
    title: "Thema / Topic",
    blank: () => ({ title: "", result: "", note: "" }),
    fields: [
      { key: "title", label: "Thema / Topic", type: "textarea" },
      { key: "result", label: "Ergebnis / Result", type: "select", options: RESULTS },
      { key: "note", label: "Notiz / Note", type: "textarea" },
    ],
  },
  actions: {
    title: "Maßnahme / Action item",
    blank: () => ({ task: "", who: "", due: "" }),
    fields: [
      { key: "task", label: "Was / What", type: "textarea" },
      { key: "who", label: "Wer / Who", list: "people-names" },
      { key: "due", label: "Bis / Due", type: "date" },
    ],
  },
};

// ---------- Storage on the phone (IndexedDB) ----------

const db = {
  _open: null,
  open() {
    if (!this._open) {
      this._open = new Promise((resolve, reject) => {
        const req = indexedDB.open("site-protocols", 1);
        req.onupgradeneeded = () => {
          req.result.createObjectStore("protocols", { keyPath: "id" });
          req.result.createObjectStore("settings");
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => reject(req.error);
      });
    }
    return this._open;
  },
  async run(store, mode, action) {
    const conn = await this.open();
    return new Promise((resolve, reject) => {
      const tx = conn.transaction(store, mode);
      const req = action(tx.objectStore(store));
      tx.oncomplete = () => resolve(req.result);
      tx.onerror = () => reject(tx.error);
    });
  },
  allProtocols: () => db.run("protocols", "readonly", (s) => s.getAll()),
  putProtocol: (p) => db.run("protocols", "readwrite", (s) => s.put(p)),
  deleteProtocol: (id) => db.run("protocols", "readwrite", (s) => s.delete(id)),
  getSettings: () => db.run("settings", "readonly", (s) => s.get("main")),
  putSettings: (v) => db.run("settings", "readwrite", (s) => s.put(v, "main")),
};

function defaultSettings() {
  return {
    name: "",
    company: "",
    role: "Bauleitung / Site manager",
    projects: ["LAHLU01 Lahnau"],
    people: [], // everyone who was ever an attendee, for quick filling
  };
}

// ---------- Small helpers ----------

const $ = (sel) => document.querySelector(sel);

function el(tag, attrs = {}, text) {
  const node = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  if (text !== undefined) node.textContent = text;
  return node;
}

const pad = (n, len = 2) => String(n).padStart(len, "0");
const localDate = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const localTime = (d) => `${pad(d.getHours())}:${pad(d.getMinutes())}`;

// "2026-10-10" -> "10.10.2026"
function fmtDate(iso) {
  if (!iso) return "–";
  const [y, m, d] = iso.split("-");
  return `${d}.${m}.${y}`;
}

// "LAHLU01 Lahnau" -> "LAHLU01"
const projectCode = (project) => (project || "PROJ").trim().split(/\s+/)[0].toUpperCase();

// Next free number for this project and year, e.g. LAHLU01-2026-004
async function nextNumber(project, year, ownId) {
  const prefix = `${projectCode(project)}-${year}-`;
  let max = 0;
  for (const p of await db.allProtocols()) {
    if (p.id !== ownId && p.no && p.no.startsWith(prefix)) {
      max = Math.max(max, parseInt(p.no.slice(prefix.length), 10) || 0);
    }
  }
  return prefix + pad(max + 1, 3);
}

// ---------- App state ----------

let settings = defaultSettings();
let current = null; // the protocol open in the editor
let saveTimer = null;

// ---------- Views ----------

function show(view) {
  for (const v of ["list", "edit", "settings"]) $(`#view-${v}`).hidden = v !== view;
  $("#btn-back").hidden = view === "list";
  $("#btn-settings").hidden = view !== "list";
  $("#title").textContent =
    view === "edit" ? "Protokoll / Protocol" :
    view === "settings" ? "Einstellungen / Settings" :
    "Protokolle / Protocols";
  window.scrollTo(0, 0);
}

async function renderProtocolList() {
  const list = await db.allProtocols();
  list.sort((a, b) => (b.date + b.no).localeCompare(a.date + a.no));
  const ul = $("#protocol-list");
  ul.replaceChildren();
  $("#empty-hint").hidden = list.length > 0;
  for (const p of list) {
    const li = el("li");
    const top = el("div", { class: "row-between" });
    top.append(el("span", { class: "no" }, p.no));
    top.append(el("span", { class: "badge" + (p.status === "final" ? " final" : "") },
      p.status === "final" ? "PDF ✓" : "Entwurf / Draft"));
    li.append(top);
    li.append(el("div", { class: "meta" }, `${fmtDate(p.date)} · ${TYPES[p.type] || ""}`));
    if (p.location) li.append(el("div", { class: "meta" }, p.location));
    li.addEventListener("click", () => openEditor(p));
    ul.append(li);
  }
}

// ---------- Creating and editing a protocol ----------

async function newProtocol() {
  const now = new Date();
  const p = {
    id: crypto.randomUUID(),
    project: settings.projects[0] || "PROJ",
    type: "inspection",
    date: localDate(now),
    time: localTime(now),
    location: "",
    attendees: [{ name: settings.name, company: settings.company, role: settings.role }],
    topics: [LISTS.topics.blank()],
    actions: [],
    remarks: "",
    status: "draft",
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  p.no = await nextNumber(p.project, p.date.slice(0, 4), p.id);
  await db.putProtocol(p);
  openEditor(p);
}

function openEditor(p) {
  current = p;

  // Project list: settings + the protocol's own project (in case it was removed)
  const projects = [...new Set([...settings.projects, p.project])];
  $("#f-project").replaceChildren(...projects.map((name) => el("option", { value: name }, name)));

  $("#f-no").textContent = p.no;
  $("#f-saved").textContent = "";
  $("#f-project").value = p.project;
  $("#f-type").value = p.type;
  $("#f-date").value = p.date;
  $("#f-time").value = p.time;
  $("#f-location").value = p.location;
  $("#f-remarks").value = p.remarks;
  for (const kind of Object.keys(LISTS)) renderItems(kind);
  updatePeopleList();
  show("edit");
}

// Draws the attendee / topic / action item cards.
function renderItems(kind) {
  const cfg = LISTS[kind];
  const items = current[kind];
  const box = $(`#${kind}`);
  box.replaceChildren();

  items.forEach((item, i) => {
    const card = el("div", { class: "item" });
    const head = el("div", { class: "item-head" }, `${i + 1}. ${cfg.title}`);
    const remove = el("button", { class: "remove", type: "button" }, "Entfernen / Remove");
    remove.addEventListener("click", () => {
      items.splice(i, 1);
      renderItems(kind);
      save();
    });
    head.append(remove);
    card.append(head);

    for (const f of cfg.fields) {
      const label = el("label", {}, f.label);
      let input;
      if (f.type === "textarea") {
        input = el("textarea", { rows: 2 });
      } else if (f.type === "select") {
        input = el("select");
        for (const [value, text] of Object.entries(f.options)) input.append(el("option", { value }, text));
      } else {
        input = el("input", { type: f.type || "text" });
        if (f.list) input.setAttribute("list", f.list);
      }
      input.value = item[f.key] ?? "";
      const update = () => {
        item[f.key] = input.value;
        save();
        if (kind === "attendees" && f.key === "name") updatePeopleList();
      };
      input.addEventListener("input", update);
      input.addEventListener("change", update);
      if (kind === "attendees" && f.key === "name") {
        input.addEventListener("change", () => fillKnownPerson(item));
      }
      label.append(input);
      card.append(label);
    }
    box.append(card);
  });
}

// When a known name is picked, fill in company and role.
function fillKnownPerson(item) {
  const known = settings.people.find((x) => x.name.toLowerCase() === item.name.trim().toLowerCase());
  if (!known) return;
  let changed = false;
  if (!item.company) { item.company = known.company; changed = true; }
  if (!item.role) { item.role = known.role; changed = true; }
  if (changed) { renderItems("attendees"); save(); }
}

// Suggestions for name fields: saved people + this protocol's attendees.
function updatePeopleList() {
  const names = new Set(settings.people.map((x) => x.name));
  if (current) for (const a of current.attendees) if (a.name.trim()) names.add(a.name.trim());
  $("#people-names").replaceChildren(...[...names].sort().map((n) => el("option", { value: n })));
}

// Remember attendees for next time.
function rememberPeople(attendees) {
  for (const a of attendees) {
    const name = a.name.trim();
    if (!name) continue;
    const known = settings.people.find((x) => x.name.toLowerCase() === name.toLowerCase());
    if (known) Object.assign(known, { company: a.company || known.company, role: a.role || known.role });
    else settings.people.push({ name, company: a.company, role: a.role });
  }
}

// Saves shortly after the last keystroke.
function save() {
  clearTimeout(saveTimer);
  $("#f-saved").textContent = "…";
  saveTimer = setTimeout(saveNow, 400);
}

async function saveNow() {
  clearTimeout(saveTimer);
  if (!current) return;
  current.updatedAt = new Date().toISOString();
  await db.putProtocol(current);
  $("#f-saved").textContent = "Gespeichert / Saved ✓";
}

// The number depends on project and year, so update it while still a draft.
async function refreshNumber() {
  if (current.status === "final") return;
  current.no = await nextNumber(current.project, current.date.slice(0, 4), current.id);
  $("#f-no").textContent = current.no;
}

// ---------- PDF ----------

function buildPdf(p, s) {
  const { jsPDF } = window.jspdf;
  const doc = new jsPDF({ unit: "mm", format: "a4" });
  const M = 15;          // page margin
  const W = 180;         // usable width
  const BOTTOM = 280;    // where the page content ends
  const BRAND = [21, 94, 117];
  let y = M;

  const lineH = (size) => size * 0.3528 * 1.3; // font size in pt -> line height in mm
  const font = (size, style = "normal") => { doc.setFont("helvetica", style); doc.setFontSize(size); };
  const fits = (h) => { if (y + h > BOTTOM) { doc.addPage(); y = M; return false; } return true; };

  function paragraph(text, { size = 10, style = "normal", indent = 0, color = [0, 0, 0] } = {}) {
    font(size, style);
    doc.setTextColor(...color);
    const lh = lineH(size);
    for (const line of doc.splitTextToSize(text, W - indent)) {
      fits(lh);
      doc.text(line, M + indent, y + lh * 0.75);
      y += lh;
    }
    doc.setTextColor(0);
  }

  function heading(text) {
    fits(16);
    y += 3;
    font(12, "bold");
    doc.setTextColor(...BRAND);
    doc.text(text, M, y + 5);
    doc.setTextColor(0);
    y += 8;
  }

  // Simple table; the header row repeats on a new page.
  function table(cols, rows) {
    const size = 9.5, cellPad = 1.5, lh = lineH(size);
    const drawRow = (cells, isHeader) => {
      font(size, isHeader ? "bold" : "normal");
      const wrapped = cells.map((c, i) => doc.splitTextToSize(String(c || "–"), cols[i].w - 2 * cellPad));
      const h = Math.max(...wrapped.map((l) => l.length)) * lh + 2 * cellPad;
      if (!isHeader && !fits(h)) drawRow(cols.map((c) => c.title), true);
      font(size, isHeader ? "bold" : "normal");
      if (isHeader) { doc.setFillColor(232, 240, 243); doc.rect(M, y, W, h, "F"); }
      doc.setDrawColor(190);
      doc.setLineWidth(0.2);
      let x = M;
      wrapped.forEach((lines, i) => {
        lines.forEach((line, j) => doc.text(line, x + cellPad, y + cellPad + lh * (j + 0.75)));
        doc.rect(x, y, cols[i].w, h);
        x += cols[i].w;
      });
      y += h;
    };
    fits(20);
    drawRow(cols.map((c) => c.title), true);
    rows.forEach((r) => drawRow(r, false));
    y += 2;
  }

  // Title
  font(18, "bold");
  doc.setTextColor(...BRAND);
  doc.text("Protokoll / Protocol", M, y + 6);
  font(11, "bold");
  doc.setTextColor(0);
  doc.text(p.no, M + W, y + 6, { align: "right" });
  y += 10;
  doc.setDrawColor(...BRAND);
  doc.setLineWidth(0.6);
  doc.line(M, y, M + W, y);
  y += 4;

  // Info block, two columns
  const info = [
    ["Projekt / Project", p.project],
    ["Art / Type", TYPES[p.type]],
    ["Datum / Date", fmtDate(p.date)],
    ["Uhrzeit / Time", p.time || "–"],
    ["Ort / Location", p.location || "–"],
    ["Erstellt von / Prepared by", [s.name, s.company].filter(Boolean).join(", ") || "–"],
  ];
  for (let i = 0; i < info.length; i += 2) {
    let rowH = 0;
    [info[i], info[i + 1]].forEach(([label, value], col) => {
      const x = M + col * (W / 2);
      font(8);
      doc.setTextColor(110);
      doc.text(label, x, y + 3);
      font(10);
      doc.setTextColor(0);
      const lines = doc.splitTextToSize(String(value), W / 2 - 4);
      lines.forEach((line, j) => doc.text(line, x, y + 7.5 + j * lineH(10)));
      rowH = Math.max(rowH, 6 + lines.length * lineH(10));
    });
    y += rowH + 1;
  }

  // Attendees
  heading("Teilnehmer / Attendees");
  const people = p.attendees.filter((a) => a.name.trim());
  if (people.length) {
    table(
      [{ title: "Name", w: 60 }, { title: "Firma / Company", w: 60 }, { title: "Funktion / Role", w: 60 }],
      people.map((a) => [a.name, a.company, a.role]),
    );
  } else paragraph("–");

  // Topics and findings
  heading("Themen & Feststellungen / Topics & findings");
  const topics = p.topics.filter((t) => t.title.trim() || t.note.trim() || t.result);
  if (!topics.length) paragraph("–");
  topics.forEach((t, i) => {
    paragraph(`${i + 1}. ${t.title.trim() || "–"}`, { style: "bold" });
    if (t.result) {
      paragraph(`Ergebnis / Result: ${RESULTS[t.result]}`, {
        size: 9.5, style: "bold", indent: 5,
        color: t.result === "ok" ? [21, 128, 61] : [180, 35, 24],
      });
    }
    if (t.note.trim()) paragraph(t.note.trim(), { indent: 5 });
    y += 2;
  });

  // Action items
  heading("Maßnahmen / Action items");
  const actions = p.actions.filter((a) => a.task.trim());
  if (actions.length) {
    table(
      [
        { title: "Nr.", w: 12 },
        { title: "Maßnahme / Action", w: 98 },
        { title: "Wer / Who", w: 42 },
        { title: "Bis / Due", w: 28 },
      ],
      actions.map((a, i) => [String(i + 1), a.task, a.who, a.due ? fmtDate(a.due) : "–"]),
    );
  } else paragraph("Keine / None");

  // Remarks
  if (p.remarks.trim()) {
    heading("Bemerkungen / Remarks");
    paragraph(p.remarks.trim());
  }

  // Signature lines
  fits(32);
  y += 18;
  doc.setDrawColor(0);
  doc.setLineWidth(0.3);
  const sigW = 80;
  [[M, s.name], [M + W - sigW, ""]].forEach(([x, name]) => {
    doc.line(x, y, x + sigW, y);
    font(8);
    doc.setTextColor(110);
    doc.text("Unterschrift / Signature", x, y + 4);
    if (name) doc.text(name, x, y + 8);
  });
  doc.setTextColor(0);

  // Footer on every page
  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i);
    font(8);
    doc.setTextColor(120);
    doc.text(`${p.no} · ${p.project}`, M, 290);
    doc.text(`Seite / Page ${i}/${pages}`, M + W, 290, { align: "right" });
  }

  return doc.output("blob");
}

// Opens the iPhone share sheet (Mail, WhatsApp, Save to Files...).
async function sharePdf(blob, fileName) {
  const file = new File([blob], fileName, { type: "application/pdf" });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    try {
      await navigator.share({ files: [file] });
      return;
    } catch (e) {
      if (e.name === "AbortError") return; // user closed the share sheet
    }
  }
  // Fallback (e.g. on a computer): download the file.
  const a = el("a", { href: URL.createObjectURL(blob), download: fileName });
  document.body.append(a);
  a.click();
  a.remove();
}

async function createPdf() {
  clearTimeout(saveTimer);
  current.status = "final";
  current.pdfCreatedAt = new Date().toISOString();
  rememberPeople(current.attendees);

  let blob;
  try {
    blob = buildPdf(current, settings);
  } catch (e) {
    alert("PDF Fehler / PDF error: " + e.message);
    return;
  }
  // The share sheet must open right after the tap, so start it before saving.
  const sharing = sharePdf(blob, `${current.no}.pdf`);
  await Promise.all([saveNow(), db.putSettings(settings)]);
  await sharing;
}

// ---------- Settings ----------

function openSettings() {
  $("#s-name").value = settings.name;
  $("#s-company").value = settings.company;
  $("#s-role").value = settings.role;
  $("#s-projects").value = settings.projects.join("\n");
  show("settings");
}

function readSettingsForm() {
  settings.name = $("#s-name").value.trim();
  settings.company = $("#s-company").value.trim();
  settings.role = $("#s-role").value.trim();
  settings.projects = $("#s-projects").value.split("\n").map((x) => x.trim()).filter(Boolean);
  db.putSettings(settings);
}

// ---------- Start ----------

async function init() {
  settings = Object.assign(defaultSettings(), (await db.getSettings()) || {});

  $("#f-type").replaceChildren(...Object.entries(TYPES).map(([v, t]) => el("option", { value: v }, t)));

  // Simple fields of the editor
  const simple = { "#f-type": "type", "#f-time": "time", "#f-location": "location", "#f-remarks": "remarks" };
  for (const [sel, key] of Object.entries(simple)) {
    $(sel).addEventListener("input", () => { current[key] = $(sel).value; save(); });
  }
  $("#f-project").addEventListener("change", async () => {
    current.project = $("#f-project").value;
    await refreshNumber();
    save();
  });
  $("#f-date").addEventListener("change", async () => {
    const yearChanged = current.date.slice(0, 4) !== $("#f-date").value.slice(0, 4);
    current.date = $("#f-date").value;
    if (yearChanged) await refreshNumber();
    save();
  });

  for (const btn of document.querySelectorAll("[data-add]")) {
    btn.addEventListener("click", () => {
      const kind = btn.dataset.add;
      current[kind].push(LISTS[kind].blank());
      renderItems(kind);
      save();
      const cards = $(`#${kind}`).querySelectorAll(".item");
      cards[cards.length - 1].querySelector("input, textarea").focus();
    });
  }

  $("#btn-new").addEventListener("click", newProtocol);
  $("#btn-pdf").addEventListener("click", createPdf);
  $("#btn-settings").addEventListener("click", openSettings);
  $("#btn-delete").addEventListener("click", async () => {
    if (!confirm(`${current.no} löschen? / Delete?`)) return;
    clearTimeout(saveTimer);
    await db.deleteProtocol(current.id);
    current = null;
    await renderProtocolList();
    show("list");
  });
  $("#btn-back").addEventListener("click", async () => {
    if (current) await saveNow();
    current = null;
    await renderProtocolList();
    show("list");
  });
  for (const id of ["#s-name", "#s-company", "#s-role", "#s-projects"]) {
    $(id).addEventListener("input", readSettingsForm);
  }

  // Save immediately when the app goes to the background.
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden" && current) saveNow();
  });

  await renderProtocolList();
  show("list");

  // Ask the phone to keep our data, and make the app work offline.
  if (navigator.storage && navigator.storage.persist) navigator.storage.persist();
  if ("serviceWorker" in navigator) navigator.serviceWorker.register("/sw.js");
}

init();
