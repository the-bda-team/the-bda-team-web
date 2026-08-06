"use strict";

// =====================================================================
// Config
// =====================================================================

const TYPE_NAMES = ["publications", "people", "events", "data"];
const TYPE_LABELS = { publications: "Publications", people: "People", events: "Events", data: "Data" };

// =====================================================================
// State
// =====================================================================

const state = {
  type: null,
  user: null,
};

// Small read-only fetch cache used only for cross-type lookups (id-ref
// pickers, referential-integrity checks on delete) — not an edit store,
// nothing here is ever mutated by the user.
const otherTypeCache = {};
async function fetchTypeEntries(type) {
  if (otherTypeCache[type]) return otherTypeCache[type];
  const res = await api(`/data?name=${encodeURIComponent(type)}`);
  if (!res.ok) throw new Error(`Failed to load ${type}: ${res.status}`);
  const json = await res.json();
  otherTypeCache[type] = json.content;
  return json.content;
}

// =====================================================================
// API + auth
// =====================================================================

function redirectToLogin(reason) {
  window.location.href = "/facilities.html?redirect_reason=" + encodeURIComponent(reason);
}

// =====================================================================
// DOM-as-state helpers
// =====================================================================

// Reads an entry's current data straight from its <details> element: the
// live draft if it's been opened, otherwise reconstructed from its
// pristine data-* attributes.
function entryDataFor(details) {
  const obj = {};
  for (const attr of details.attributes) {
    if (attr.name.startsWith("data-")) {
      obj[attr.name.slice(5)] = JSON.parse(attr.value);
    }
  }
  return obj;
}

function setEntryAttributes(details, entry) {
  // Clear any previous data-* attributes first (relevant on rebuild).
  [...details.attributes].forEach((attr) => {
    if (attr.name.startsWith("data-")) details.removeAttribute(attr.name);
  });
  for (const [key, value] of Object.entries(entry)) {
    details.setAttribute(`data-${key}`, JSON.stringify(value));
  }
}

// The full array to PUT: every entry currently in the list, in its
// current (edited or pristine) form, excluding anything marked deleted.
function composeEntriesFromDom() {
  const list = document.getElementById("entry-list");
  const entries = [];
  list.querySelectorAll(":scope > details.entry").forEach((details) => {
    if (details.classList.contains("entry-deleted")) return;
    entries.push(entryDataFor(details));
  });
  return entries;
}

// =====================================================================
// Rendering: page shell
// =====================================================================

// "summary is name (if exists) or else the title"
function summaryText(entry) {
  if (entry.name != null) return Array.isArray(entry.name) ? entry.name.join(" ") : String(entry.name);
  if (entry.title != null) return String(entry.title);
  return entry.id || "(untitled)";
}

function displayValue(entry, key) {
  const v = entry[key];
  if (v == null) return "";
  if (Array.isArray(v)) {
    if (v.length && Array.isArray(v[0])) return v.map((t) => t.join(" ")).join("; "); // author tuples
    return v.join(", ");
  }
  return String(v);
}

function searchableText(type, entry) {
  return Object.keys(entry)
    .map((k) => displayValue(entry, k))
    .join(" \u241f ")
    .toLowerCase();
}

let searchQuery = "";

function renderPage(entries, commit, sha) {
  const type = state.type;
  const content = document.getElementById("content");
  content.innerHTML = `
    <div class="toolbar">
      <input id="search" type="search" placeholder="Search ${TYPE_LABELS[type].toLowerCase()}…">
      <span class="count" id="count"></span>
      <button id="add-new" class="primary">+ Add new</button>
    </div>
    <div id="entry-list" class="entry-list" data-commit="${escapeAttr(commit)}" data-sha="${escapeAttr(sha)}"></div>
  `;
  document.getElementById("search").addEventListener("input", (e) => {
    searchQuery = e.target.value;
    applySearchFilter();
  });
  document.getElementById("add-new").addEventListener("click", () => addNewEntry());

  const list = document.getElementById("entry-list");
  const sorted = [...entries].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const entry of sorted) {
    list.appendChild(buildEntryDetails(entry, { isNew: false }));
  }

  applySearchFilter();
  updateFooter();
}

async function loadAndRender() {
  const content = document.getElementById("content");
  content.innerHTML = `<p class="muted">Loading ${TYPE_LABELS[state.type]}…</p>`;
  const res = await api(`/data?name=${encodeURIComponent(state.type)}`);
  if (res.status === 401) { redirectToLogin("Your session expired — please log in again"); return; }
  if (!res.ok) { content.innerHTML = `<p class="error">Failed to load ${TYPE_LABELS[state.type]}: ${res.status}</p>`; return; }
  const json = await res.json();
  renderPage(json.content, json.commit, json.sha);
}

function applySearchFilter() {
  const type = state.type;
  const q = searchQuery.trim().toLowerCase();
  const list = document.getElementById("entry-list");
  let shown = 0;
  list.querySelectorAll(":scope > details.entry").forEach((details) => {
    if (details.classList.contains("entry-new")) {
      shown++; // always show in-progress new entries
      return;
    }
    const matches = !q || searchableText(type, entryDataFor(details)).includes(q);
    details.style.display = matches ? "" : "none";
    if (matches) shown++;
  });
  document.getElementById("count").textContent = `${shown} ${shown === 1 ? "entry" : "entries"}`;
}

// =====================================================================
// Entry <details>: build shell, lazily build fields on first open
// =====================================================================

function buildEntryDetails(entry, { isNew }) {
  const details = document.createElement("details");
  details.className = "entry" + (isNew ? " entry-new" : "");
  setEntryAttributes(details, entry);

  const summary = document.createElement("summary");
  summary.innerHTML = `
    <span class="summary-main">${escapeHtml(summaryText(entry))}</span>
    <span class="summary-meta">${entry.category ? escapeHtml(entry.category) + " · " : ""}${escapeHtml(entry.id || "(no id yet)")}</span>
  `;
  details.appendChild(summary);

  const body = document.createElement("div");
  body.className = "entry-body";
  details.appendChild(body);

  if (isNew) {
    details.open = true;
    buildFieldsInto(details, body, { isNew: true });
  } else {
    details.addEventListener("toggle", () => {
      if (details.open && !details.dataset.built) buildFieldsInto(details, body, { isNew: false });
    });
  }

  return details;
}

// Builds (or rebuilds, e.g. on discard) the form inside `body`, using the
// entry's current data-* attributes as the starting values.
function buildFieldsInto(details, body, { isNew }) {
  details.dataset.built = "1";
  const draft = entryDataFor(details);

  const onChange = () => {
    if (!isNew) details.classList.add("entry-edited");
    updateFooter();
  };
  const onDelete = isNew
    ? () => { details.remove(); updateFooter(); }
    : () => toggleDeleteMarker(details);

  renderEntryForm(body, state.type, draft, { isNew, onChange, onDelete });
}

function resetEntryToOriginal(details) {
  // Discard: rebuild the form fresh from the pristine data-* attributes,
  details.classList.remove("entry-edited");
  const body = details.querySelector(".entry-body");
  buildFieldsInto(details, body, { isNew: false });
}

function toggleDeleteMarker(details) {
  if (details.classList.contains("entry-deleted")) {
    details.classList.remove("entry-deleted");
    refreshDeleteButton(details);
    updateFooter();
    return;
  }
  const id = entryDataFor(details).id;
  findReferences(state.type, id).then((refs) => {
    if (refs.length) {
      alert(
        `Can't delete "${id}" — it's still referenced by:\n\n` +
          refs.map((r) => `• ${TYPE_LABELS[r.type]} "${r.id}" (via "${r.field}")`).join("\n") +
          `\n\nRemove those references first.`
      );
      return;
    }
    details.classList.add("entry-deleted");
    refreshDeleteButton(details);
    updateFooter();
  });
}

function refreshDeleteButton(details) {
  const btn = details.querySelector('button[data-role="delete"]');
  if (btn) btn.textContent = details.classList.contains("entry-deleted") ? "Undo delete" : "Delete entry";
}

// =====================================================================
// Referential integrity
// =====================================================================

// Which other types have a field that references `type` (i.e. a property
// whose key literally equals `type`'s name).
function referencingTypes(type) {
  return TYPE_NAMES.filter((t) => t !== type && allFieldKeys(schemaFor(t)).includes(type));
}

async function findReferences(type, id) {
  const refs = [];
  for (const refType of referencingTypes(type)) {
    const entries = await fetchTypeEntries(refType);
    for (const entry of entries) {
      const list = entry[type];
      if (Array.isArray(list) && list.includes(id)) {
        refs.push({ type: refType, id: entry.id, field: type });
      }
    }
  }
  return refs;
}

// =====================================================================
// Rendering: entry form (built lazily, inline inside its <details>)
// =====================================================================

function blankEntry() {
  const schema = schemaFor(state.type);
  const entry = {};
  if (schema.properties.category && schema.properties.category.enum) {
    entry.category = schema.properties.category.enum[0];
  }
  return entry;
}

function addNewEntry() {
  const entry = blankEntry();
  const list = document.getElementById("entry-list");
  const details = buildEntryDetails(entry, { isNew: true });
  list.insertBefore(details, list.firstChild);
  details.scrollIntoView({ behavior: "smooth", block: "center" });
  updateFooter();
}

function renderEntryForm(container, type, draft, ctx) {
  const schema = schemaFor(type);

  function rebuild() {
    container.innerHTML = "";
    const keys = allFieldKeys(schema).sort((a, b) => (a === "id" ? -1 : b === "id" ? 1 : a.localeCompare(b)));
    const required = requiredFields(schema, draft);

    for (const key of keys) {
      if (!fieldVisible(schema, key, draft)) continue;
      const fs = fieldSchemaFor(schema, key);
      const kind = fieldKind(key, fs);
      const wrap = document.createElement("div");
      wrap.className = "field";
      const label = document.createElement("label");
      label.textContent = key + (required.has(key) ? " *" : "");
      wrap.appendChild(label);
      wrap.appendChild(
        renderFieldInput(key, fs, kind, draft, ctx.isNew, (value) => {
          if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
            delete draft[key];
          } else {
            draft[key] = value;
          }
          ctx.onChange();
          if (key === "category") rebuild();
        })
      );
      container.appendChild(wrap);
    }

    const errorBox = document.createElement("div");
    errorBox.className = "error field-errors";
    errorBox.hidden = true;
    container.appendChild(errorBox);

    const delBtn = document.createElement("button");
    delBtn.type = "button";
    delBtn.className = "danger";
    delBtn.dataset.role = "delete";
    delBtn.textContent = ctx.isNew ? "Remove" : "Delete entry";
    delBtn.addEventListener("click", ctx.onDelete);
    container.appendChild(delBtn);
  }

  rebuild();
}

function renderFieldInput(key, fs, kind, entry, isNew, setValue) {
  const value = entry[key];

  switch (kind) {
    case "select": {
      const sel = document.createElement("select");
      if (!fs.enum.includes(value)) {
        const blank = document.createElement("option");
        blank.value = "";
        blank.textContent = "—";
        sel.appendChild(blank);
      }
      for (const opt of fs.enum) {
        const o = document.createElement("option");
        o.value = opt;
        o.textContent = opt;
        if (opt === value) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener("change", () => setValue(sel.value || undefined));
      return sel;
    }
    case "number": {
      const input = document.createElement("input");
      input.type = "number";
      if (fs.minimum != null) input.min = fs.minimum;
      if (fs.maximum != null) input.max = fs.maximum;
      input.value = value != null ? value : "";
      input.addEventListener("input", () => setValue(input.value === "" ? undefined : Number(input.value)));
      return input;
    }
    case "url":
    case "email":
    case "text": {
      const useTextarea = key === "description" || key === "annote";
      const input = document.createElement(useTextarea ? "textarea" : "input");
      if (!useTextarea) input.type = kind === "text" ? "text" : kind;
      input.value = value != null ? value : "";
      if (key === "id" && !isNew) input.readOnly = true; // ids are immutable once created
      input.addEventListener("input", () => setValue(input.value || undefined));
      return input;
    }
    case "tags":
      return renderTagsInput(value ? [...value] : [], setValue);
    case "idrefs":
      return renderIdRefsInput(key, value ? [...value] : [], setValue);
    case "nametuple":
      return renderNameTuple(value ? [...value] : ["", ""], setValue);
    case "tuplelist":
      return renderTupleList(value ? value.map((v) => [...v]) : [], setValue);
    case "objectlist":
      return renderObjectList(fs.items, value ? value.map((v) => ({ ...v })) : [], setValue);
    default: {
      const input = document.createElement("input");
      input.type = "text";
      input.value = value != null ? value : "";
      input.addEventListener("input", () => setValue(input.value || undefined));
      return input;
    }
  }
}

function renderTagsInput(values, setValue) {
  const wrap = document.createElement("div");
  wrap.className = "chip-input";
  const chips = document.createElement("div");
  chips.className = "chips";
  const input = document.createElement("input");
  input.type = "text";
  input.placeholder = "Type and press Enter";

  function redraw() {
    chips.innerHTML = "";
    values.forEach((v, i) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = v;
      const x = document.createElement("button");
      x.type = "button";
      x.textContent = "×";
      x.addEventListener("click", () => { values.splice(i, 1); setValue([...values]); redraw(); });
      chip.appendChild(x);
      chips.appendChild(chip);
    });
  }
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && input.value.trim()) {
      e.preventDefault();
      values.push(input.value.trim());
      setValue([...values]);
      input.value = "";
      redraw();
    }
  });
  redraw();
  wrap.appendChild(chips);
  wrap.appendChild(input);
  return wrap;
}

function renderIdRefsInput(targetType, values, setValue) {
  const wrap = document.createElement("div");
  wrap.className = "chip-input";
  const chips = document.createElement("div");
  chips.className = "chips";
  const row = document.createElement("div");
  row.className = "idref-row";
  const select = document.createElement("select");
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.textContent = "Add";

  function redraw() {
    chips.innerHTML = "";
    values.forEach((v, i) => {
      const chip = document.createElement("span");
      chip.className = "chip";
      chip.textContent = v;
      const x = document.createElement("button");
      x.type = "button";
      x.textContent = "×";
      x.addEventListener("click", () => { values.splice(i, 1); setValue([...values]); redraw(); });
      chip.appendChild(x);
      chips.appendChild(chip);
    });
  }
  redraw();
  wrap.appendChild(chips);

  select.innerHTML = `<option value="">Loading…</option>`;
  const sameType = targetType === state.type;
  const idsPromise = sameType
    ? Promise.resolve(composeEntriesFromDom().map((e) => e.id))
    : fetchTypeEntries(targetType).then((entries) => entries.map((e) => e.id));
  idsPromise.then((ids) => {
    const available = ids.filter((id) => id && !values.includes(id));
    select.innerHTML = available.length
      ? `<option value="">Select ${targetType}…</option>` + available.map((id) => `<option value="${escapeAttr(id)}">${escapeHtml(id)}</option>`).join("")
      : `<option value="">No ${targetType} available</option>`;
  });
  addBtn.addEventListener("click", () => {
    if (select.value) {
      values.push(select.value);
      setValue([...values]);
      const opt = select.querySelector(`option[value="${CSS.escape(select.value)}"]`);
      if (opt) opt.remove();
      select.value = "";
      redraw();
    }
  });
  row.appendChild(select);
  row.appendChild(addBtn);
  wrap.appendChild(row);
  return wrap;
}

function renderNameTuple(pair, setValue) {
  const wrap = document.createElement("div");
  wrap.className = "tuple-row";
  const first = document.createElement("input");
  first.placeholder = "First name";
  first.value = pair[0] || "";
  const last = document.createElement("input");
  last.placeholder = "Last name";
  last.value = pair[1] || "";
  function update() { setValue([first.value, last.value]); }
  first.addEventListener("input", update);
  last.addEventListener("input", update);
  wrap.appendChild(first);
  wrap.appendChild(last);
  return wrap;
}

function renderTupleList(values, setValue) {
  const wrap = document.createElement("div");
  wrap.className = "list-editor";
  const rows = document.createElement("div");

  function redraw() {
    rows.innerHTML = "";
    values.forEach((pair, i) => {
      const row = document.createElement("div");
      row.className = "tuple-row removable";
      const first = document.createElement("input");
      first.placeholder = "First name";
      first.value = pair[0] || "";
      const last = document.createElement("input");
      last.placeholder = "Last name";
      last.value = pair[1] || "";
      const rm = document.createElement("button");
      rm.type = "button";
      rm.textContent = "Remove";
      function update() { values[i] = [first.value, last.value]; setValue([...values]); }
      first.addEventListener("input", update);
      last.addEventListener("input", update);
      rm.addEventListener("click", () => { values.splice(i, 1); setValue([...values]); redraw(); });
      row.appendChild(first);
      row.appendChild(last);
      row.appendChild(rm);
      rows.appendChild(row);
    });
  }
  redraw();
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.textContent = "+ Add person";
  addBtn.addEventListener("click", () => { values.push(["", ""]); setValue([...values]); redraw(); });
  wrap.appendChild(rows);
  wrap.appendChild(addBtn);
  return wrap;
}

function renderObjectList(itemSchema, values, setValue) {
  const props = Object.keys(itemSchema.properties || {});
  const required = new Set(itemSchema.required || []);
  const wrap = document.createElement("div");
  wrap.className = "list-editor";
  const rows = document.createElement("div");

  function redraw() {
    rows.innerHTML = "";
    values.forEach((obj, i) => {
      const row = document.createElement("div");
      row.className = "object-row removable";
      for (const p of props) {
        const input = document.createElement("input");
        input.placeholder = p + (required.has(p) ? " *" : "");
        input.value = obj[p] || "";
        input.addEventListener("input", () => {
          if (input.value) obj[p] = input.value; else delete obj[p];
          setValue([...values]);
        });
        row.appendChild(input);
      }
      const rm = document.createElement("button");
      rm.type = "button";
      rm.textContent = "Remove";
      rm.addEventListener("click", () => { values.splice(i, 1); setValue([...values]); redraw(); });
      row.appendChild(rm);
      rows.appendChild(row);
    });
  }
  redraw();
  const addBtn = document.createElement("button");
  addBtn.type = "button";
  addBtn.textContent = "+ Add";
  addBtn.addEventListener("click", () => { values.push({}); setValue([...values]); redraw(); });
  wrap.appendChild(rows);
  wrap.appendChild(addBtn);
  return wrap;
}

// =====================================================================
// Validation
// =====================================================================

function validateEntry(type, entry, isNew, allCurrentEntries) {
  const schema = schemaFor(type);
  const errors = [];
  const required = requiredFields(schema, entry);
  for (const key of required) {
    const v = entry[key];
    const missing = v == null || v === "" || (Array.isArray(v) && v.length === 0);
    if (missing) errors.push(`"${key}" is required`);
  }
  for (const key of allFieldKeys(schema)) {
    if (!(key in entry)) continue;
    const fs = fieldSchemaFor(schema, key);
    if (fs.type === "string" && typeof entry[key] === "string" && !stringMatchesSchema(fs, entry[key])) {
      errors.push(`"${key}" doesn't match the required format`);
    }
  }
  if (isNew) {
    if (allCurrentEntries.filter((e) => e !== entry).some((e) => e.id === entry.id)) {
      errors.push(`id "${entry.id}" already exists in ${type}`);
    }
  }
  return errors;
}

// =====================================================================
// Sticky footer + batch save
// =====================================================================

function updateFooter() {
  const list = document.getElementById("entry-list");
  if (!list) return;
  const edited = list.querySelectorAll(".entry-edited:not(.entry-deleted)").length;
  const created = list.querySelectorAll(".entry-new:not(.entry-deleted)").length;
  const deleted = list.querySelectorAll(".entry-deleted").length;
  const footer = document.getElementById("footer");

  if (edited + created + deleted === 0) {
    footer.hidden = true;
    footer.innerHTML = "";
    return;
  }

  const parts = [];
  if (edited) parts.push(`${edited} edited`);
  if (created) parts.push(`${created} new`);
  if (deleted) parts.push(`${deleted} deleted`);

  footer.hidden = false;
  footer.innerHTML = `
    <span>${parts.join(" · ")}</span>
    <div class="footer-error" id="footer-error" hidden></div>
    <button id="discard-btn">Discard all</button>
    <button id="save-btn" class="primary">Save</button>
  `;
  document.getElementById("discard-btn").addEventListener("click", discardAll);
  document.getElementById("save-btn").addEventListener("click", saveAll);
}

function discardAll() {
  if (!confirm("Discard all unsaved changes?")) return;
  const list = document.getElementById("entry-list");
  list.querySelectorAll(".entry-new").forEach((el) => el.remove());
  list.querySelectorAll(".entry-edited").forEach((details) => resetEntryToOriginal(details));
  list.querySelectorAll(".entry-deleted").forEach((details) => {
    details.classList.remove("entry-deleted");
    refreshDeleteButton(details);
  });
  updateFooter();
}

async function saveAll() {
  const type = state.type;
  const list = document.getElementById("entry-list");
  const errorBox = document.getElementById("footer-error");

  const current = composeEntriesFromDom();
  const toValidate = [];
  list.querySelectorAll(".entry-edited:not(.entry-deleted)").forEach((d) => toValidate.push({ entry: entryDataFor(d), isNew: false }));
  list.querySelectorAll(".entry-new:not(.entry-deleted)").forEach((d) => toValidate.push({ entry: entryDataFor(d), isNew: true }));

  const allErrors = [];
  for (const { entry, isNew } of toValidate) {
    const errs = validateEntry(type, entry, isNew, current);
    if (errs.length) allErrors.push(`${entry.id || "(new entry)"}: ${errs.join(", ")}`);
  }
  if (allErrors.length) {
    errorBox.hidden = false;
    errorBox.textContent = "Fix before saving — " + allErrors.join(" · ");
    return;
  }

  const saveBtn = document.getElementById("save-btn");
  saveBtn.disabled = true;
  saveBtn.textContent = "Saving…";

  const params = new URLSearchParams({
    name: type,
    baseCommit: list.dataset.commit,
    baseSha: list.dataset.sha,
  });
  try {
    const res = await api(`/data?${params.toString()}`, {
      method: "PUT",
      body: JSON.stringify(current, null, 2),
    });
    if (res.status === 401) { redirectToLogin("Your session expired — please log in again"); return; }
    if (res.status === 409) {
      errorBox.hidden = false;
      errorBox.textContent = "Someone else changed this data. Reloading the latest version — please redo your edits.";
      await loadAndRender();
      return;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `Save failed (${res.status})`);
    }
    await loadAndRender(); // fresh state from the server; also clears all local edit markers
  } catch (err) {
    errorBox.hidden = false;
    errorBox.textContent = err.message;
    saveBtn.disabled = false;
    saveBtn.textContent = "Save";
  }
}

// =====================================================================
// Utilities
// =====================================================================

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
function escapeAttr(s) {
  return escapeHtml(s);
}

// =====================================================================
// Init
// =====================================================================

window.addEventListener("beforeunload", (e) => {
  const list = document.getElementById("entry-list");
  if (list && list.querySelector(".entry-edited, .entry-new, .entry-deleted")) {
    e.preventDefault();
    e.returnValue = "";
  }
});

async function init() {
  const type = new URLSearchParams(location.search).get("type");
  if (!TYPE_NAMES.includes(type)) {
    document.getElementById("content").innerHTML =
      `<p class="error">Missing or unknown "type" parameter. Valid values: ${TYPE_NAMES.join(", ")}.</p>`;
    return;
  }
  state.type = type;

  const user = await checkAuth();
  if (!user) {
    redirectToLogin("You need to log in first");
    return;
  }
  const headline = document.querySelector("h1");
  headline.textContent = headline.textContent + ` — ${TYPE_LABELS[state.type]}`;
  await loadAndRender();
}

init();
