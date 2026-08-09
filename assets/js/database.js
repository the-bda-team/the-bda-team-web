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
  let text = "NEW ENTRY";
  if (entry.name != null) {
    text = Array.isArray(entry.name) ? entry.name.join(" ") : String(entry.name);
  } else if (entry.title != null) {
    text = String(entry.title);
  } else if (entry.id != null) {
    text = entry.id;
  }

  if (entry.year != null) {
    text += ` (${entry.year})`;
  }

  return text;
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

function searchableText(entry) {
  return Object.keys(entry)
    .map((k) => displayValue(entry, k))
    .join(" \u241f ")
    .toLowerCase();
}

function renderPage(entries) {
  const listElement = document.getElementById("entry-list");

  function entrySort(a, b) {
    if (a.year && b.year && a.year !== b.year) { return b.year - a.year; }
    return a.id.localeCompare(b.id);
  }

  const sorted = [...entries].sort(entrySort);
  for (const entry of sorted) {
    listElement.appendChild(buildEntryElement(entry, { isNew: false }));
  }
  applySearchFilter();
  updateModificationCounters();
}

async function loadAndRender() {
  const res = await api(`/data?name=${encodeURIComponent(state.type)}`);
  if (res.status === 401) { renderError("Your session expired — please log in again"); return; }
  if (!res.ok) { renderError(`Failed to load ${state.type}: ${res.status}`); return; }
  const json = await res.json();
  state.commit = json.commit;
  state.sha = json.sha;
  renderPage(json.content);
}

function renderError(message, { url = null } = {}) {
  const errorElement = document.createElement("li");
  if (url) {
    const linkElement = document.createElement("a");
    linkElement.setAttribute("href", url);
    linkElement.setAttribute("target", "_blank");
    linkElement.textContent = message;
    errorElement.appendChild(linkElement);
  } else {
    errorElement.textContent = message;
  }

  const deleteButtonElement = document.createElement("button");
  deleteButtonElement.setAttribute("type", "button");
  deleteButtonElement.setAttribute("role", "delete");
  deleteButtonElement.textContent = "x";
  deleteButtonElement.addEventListener("click", () => {
    errorElement.remove();
  });
  errorElement.appendChild(deleteButtonElement);

  document.getElementById("errors").appendChild(errorElement);
}

function applySearchFilter(event) {
  const inputElement = event.target;
  const q = inputElement.value.trim().toLowerCase();
  const list = document.getElementById("entry-list");
  list.querySelectorAll(":scope > details.entry").forEach((entryElement) => {
    if (entryElement.classList.contains("entry-added")) {
      return; // always show new entries
    }
    const matches = !q || searchableText(entryDataFor(entryElement)).includes(q);
    entryElement.style.display = matches ? "" : "none";
  });
}

// =====================================================================
// Entry <details>: build shell, lazily build fields on first open
// =====================================================================

function buildEntryElement(entry, { isNew }) {
  const entryElement = document.createElement("details");
  entryElement.className = "entry" + (isNew ? " entry-added" : "");
  setEntryAttributes(entryElement, entry);

  const summary = document.createElement("summary");
  summary.textContent = summaryText(entry);
  entryElement.appendChild(summary);

  const body = document.createElement("div");
  body.className = "entry-body";
  entryElement.appendChild(body);

  if (isNew) {
    entryElement.open = true;
    buildFieldsInto(entryElement, body);
  } else {
    // lazy build
    entryElement.addEventListener("toggle", () => {
      if (entryElement.open && !entryElement.dataset.built) {
        buildFieldsInto(entryElement, body);
      }
    });
  }

  return entryElement;
}

// Builds (or rebuilds, e.g. on discard) the form inside `body`, using the
// entry's current data-* attributes as the starting values.
function buildFieldsInto(entryElement, body) {
  entryElement.dataset.built = "true";
  const draft = entryDataFor(entryElement);
  renderEntryForm(body, draft);
}

function resetEntryToOriginal(entryElement) {
  entryElement.classList.remove("entry-edited");
  const body = entryElement.querySelector(".entry-body");
  buildFieldsInto(entryElement, body, { isNew: false });
  updateModificationCounters();
}

function toggleDelete(entryElement) {
  if (entryElement.classList.contains("entry-added")) {
    entryElement.remove();
    updateModificationCounters();
    return;
  }

  const deleteButtonElement = entryElement.querySelector("[data-role='delete']");
  if (entryElement.classList.contains("entry-deleted")) {
    entryElement.classList.remove("entry-deleted");
    deleteButtonElement.textContent = "Delete";
    updateModificationCounters();
  } else {
    const id = entryDataFor(entryElement).id;
    findReferences(state.type, id).then((refs) => {
      if (refs.length) {
        renderError(
          `Can't delete "${id}" — it's still referenced by:\n\n` +
            refs.map((r) => `• ${TYPE_LABELS[r.type]} "${r.id}" (via "${r.field}")`).join("\n") +
            `\n\nRemove those references first.`
        );
        return;
      }
      resetEntryToOriginal(entryElement);
      entryElement.classList.add("entry-deleted");
      deleteButtonElement.textContent = "Undo delete";
      updateModificationCounters();
    });
  }
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
  const entryElement = buildEntryElement(entry, { isNew: true });
  list.insertBefore(entryElement, list.firstChild);
  entryElement.scrollIntoView({ behavior: "smooth", block: "center" });
  updateModificationCounters();
}

function renderEntryForm(container, draft) {
  const schema = schemaFor(state.type);
  const entryElement = container.closest(".entry");
  const isAdded = entryElement.classList.contains("entry-added");

  function keySort(a, b) {
    if (a === "id") { return -1; }
    if (b === "id") { return 1; }
    if (a === "category") { return -1; }
    if (b === "category") { return 1; }
    return a.localeCompare(b);
  }

  function rebuild() {
    container.innerHTML = "";
    const keys = allFieldKeys(schema).sort(keySort);
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
        renderFieldInput(key, fs, kind, draft, isAdded, (value) => {
          if (value === undefined || value === null || value === "" || (Array.isArray(value) && value.length === 0)) {
            delete draft[key];
          } else {
            draft[key] = value;
          }
          if (!isAdded) {
            entryElement.classList.add("entry-edited");
            updateModificationCounters();
          }
          if (key === "category") rebuild();
        })
      );
      container.appendChild(wrap);
    }

    const buttonsElement = document.createElement("div");
    buttonsElement.classList.add("buttons");

    if (!isAdded) {
      const resetButtonElement = document.createElement("button");
      resetButtonElement.type = "button";
      resetButtonElement.setAttribute("data-role", "reset");
      resetButtonElement.textContent = "Reset entry";
      resetButtonElement.addEventListener("click", () => {
        resetEntryToOriginal(entryElement);
      });
      buttonsElement.appendChild(resetButtonElement);
    }

    const deleteButtonElement = document.createElement("button");
    deleteButtonElement.type = "button";
    deleteButtonElement.setAttribute("data-role", "delete");
    deleteButtonElement.textContent = "Delete entry";
    deleteButtonElement.addEventListener("click", () => {
      toggleDelete(entryElement);
    });
    buttonsElement.appendChild(deleteButtonElement);

    container.appendChild(buttonsElement);
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
      if (key === "id" && !isNew) {
        input.readOnly = true;
        input.setAttribute("title", "IDs are immutable once created");
      }
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
      const buttonElement = document.createElement("button");
      buttonElement.type = "button";
      buttonElement.textContent = "×";
      buttonElement.addEventListener("click", () => { values.splice(i, 1); setValue([...values]); redraw(); });
      chip.appendChild(buttonElement);
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
      const buttonElement = document.createElement("button");
      buttonElement.type = "button";
      buttonElement.textContent = "×";
      buttonElement.addEventListener("click", () => { values.splice(i, 1); setValue([...values]); redraw(); });
      chip.appendChild(buttonElement);
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
      const buttonElement = document.createElement("button");
      buttonElement.type = "button";
      buttonElement.textContent = "Remove";
      function update() { values[i] = [first.value, last.value]; setValue([...values]); }
      first.addEventListener("input", update);
      last.addEventListener("input", update);
      buttonElement.addEventListener("click", () => { values.splice(i, 1); setValue([...values]); redraw(); });
      row.appendChild(first);
      row.appendChild(last);
      row.appendChild(buttonElement);
      rows.appendChild(row);
    });
  }
  redraw();
  const buttonElement = document.createElement("button");
  buttonElement.type = "button";
  buttonElement.textContent = "Add person";
  buttonElement.addEventListener("click", () => { values.push(["", ""]); setValue([...values]); redraw(); });
  wrap.appendChild(rows);
  wrap.appendChild(buttonElement);
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
      const buttonElement = document.createElement("button");
      buttonElement.type = "button";
      buttonElement.textContent = "Remove";
      buttonElement.addEventListener("click", () => { values.splice(i, 1); setValue([...values]); redraw(); });
      row.appendChild(buttonElement);
      rows.appendChild(row);
    });
  }
  redraw();
  const buttonElement = document.createElement("button");
  buttonElement.type = "button";
  buttonElement.textContent = "Add";
  buttonElement.addEventListener("click", () => { values.push({}); setValue([...values]); redraw(); });
  wrap.appendChild(rows);
  wrap.appendChild(buttonElement);
  return wrap;
}

// =====================================================================
// Validation
// =====================================================================

function validateEntry(type, entry, isNew, allCurrentEntries) {
  const schema = schemaFor(type);
  let errors = 0;
  const required = requiredFields(schema, entry);
  for (const key of required) {
    const v = entry[key];
    const missing = v == null || v === "" || (Array.isArray(v) && v.length === 0);
    if (missing) {
      errors += 1;
      renderError(`${entry.id}: "${key}" is required`);
    }
  }
  for (const key of allFieldKeys(schema)) {
    if (!(key in entry)) continue;
    const fs = fieldSchemaFor(schema, key);
    if (fs.type === "string" && typeof entry[key] === "string" && !stringMatchesSchema(fs, entry[key])) {
      errors += 1;
      renderError(`${entry.id}: "${key}" doesn't match the required format`);
    }
  }
  if (isNew) {
    if (allCurrentEntries.filter((e) => e !== entry).some((e) => e.id === entry.id)) {
      errors += 1;
      renderError(`${entry.id}: already exists in ${type}`);
    }
  }
  return errors;
}

// =====================================================================
// Sticky footer + batch save
// =====================================================================

function updateModificationCounters() {
  const list = document.getElementById("entry-list");
  for (let countType of ["edited", "added", "deleted"]) {
    const count = list.querySelectorAll(".entry-" + countType).length;
    for (let counterElement of Array.from(document.querySelectorAll(`[data-counter='${countType}']`))) {
      counterElement.textContent = count;
    }
  }
}

async function saveAll() {
  const type = state.type;
  const list = document.getElementById("entry-list");

  const current = composeEntriesFromDom();
  const toValidate = [];
  list.querySelectorAll(".entry-edited").forEach((d) => toValidate.push({ entry: entryDataFor(d), isNew: false }));
  list.querySelectorAll(".entry-added").forEach((d) => toValidate.push({ entry: entryDataFor(d), isNew: true }));

  let errors = 0;
  for (const { entry, isNew } of toValidate) {
    errors += validateEntry(type, entry, isNew, current);
  }
  if (errors > 0) {
    renderError("Errors need to be fixed before saving");
    return;
  }

  const saveButtonElement = document.getElementById("save-button");
  saveButtonElement.disabled = true;
  saveButtonElement.textContent = "Saving…";

  const params = new URLSearchParams({
    name: type,
    baseCommit: state.commit,
    baseSha: state.sha,
  });
  try {
    const res = await api(`/data?${params.toString()}`, {
      method: "PUT",
      body: JSON.stringify(current, null, 2),
    });
    if (res.status === 401) {
      renderError("Your session expired — log in on another tab");
      return;
    }
    if (res.status === 405) {
      const pullUrl = await res.text();
      renderError("Merge conflict", pullUrl);
      await loadAndRender();
      return;
    }
    if (!res.ok) {
      const text = await res.text().catch(() => "");
      throw new Error(text || `Save failed (${res.status})`);
    }
    await loadAndRender(); // fresh state from the server; also clears all local edit markers
  } catch (error) {
    renderError(`Error: ${error.message}`);
    saveButtonElement.disabled = false;
    saveButtonElement.textContent = "Save";
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
  if (list && list.querySelector(".entry-edited, .entry-added, .entry-deleted")) {
    e.preventDefault();
    e.returnValue = "";
  }
});

async function init() {
  const type = new URLSearchParams(location.search).get("type");
  if (!TYPE_NAMES.includes(type)) {
    window.location.href = "/facilities.html#edit-bda-database";
    return;
  }
  state.type = type;

  const user = await checkAuth();
  if (!user) {
    window.location.href = "/facilities.html#edit-bda-database?redirect_reason=" + encodeURIComponent("Not logged in");
    return;
  }
  const headline = document.querySelector("h1");
  headline.textContent = headline.textContent + ` — ${TYPE_LABELS[state.type]}`;
  await loadAndRender();
}

init();
