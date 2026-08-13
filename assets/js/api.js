const WORKER = "https://worker.the-bda.team";
const API_TYPE_CACHE = {};

// =====================================================================
// API functions
// =====================================================================

async function loadType(type, { force = false } = {}) {
  if (force || !API_TYPE_CACHE[type]) {
    const res = await api(`/data?name=${encodeURIComponent(type)}`);
    if (!res.ok) throw new Error(`Failed to load ${type}: ${res.status}`);
    const json = await res.json();
    API_TYPE_CACHE[type] = {
      entries: json.content,
      commit: json.commit,
      sha: json.sha
    };
  }
  return API_TYPE_CACHE[type].entries;
}

async function saveType(type, entries) {
  const cached = API_TYPE_CACHE[type];
  const params = new URLSearchParams({
    name: type,
    baseCommit: cached.commit,
    baseSha: cached.sha,
  });
  const res = await api(`/data?${params.toString()}`, {
    method: "PUT",
    body: JSON.stringify(entries, null, 2),
  });
  if (!res.ok) {
    // We can't tell a stale-write conflict apart from any other failure —
    // the worker collapses everything into one 502. Refresh our copy of
    // the commit/sha either way so a retry has a chance of succeeding; the
    // user's unsaved edits are preserved by loadType() above.
    await loadType(type, { force: true });
    throw new Error(
      "Save failed. Someone else may have changed this data, or GitHub had a hiccup. " +
        "Your edits are still here — check nothing conflicts, then try Save again."
    );
  }
  const json = await res.json();
  await loadType(type, { force: true }); // refresh commit/sha for the next save
  return json;
}

async function uploadFile(directory, uploadType, id, file) {
  const form = new FormData();
  form.append("file", file);
  form.append("directory", directory);
  form.append("type", uploadType);
  form.append("id", id);
  return api("/file", { method: "PUT", body: form });
}

async function checkAuth() {
  try {
    const res = await api("/user");
    if (!res.ok) return null;
    return await res.json();
  } catch (err) {
    return null;
  }
}

// =====================================================================
// API helpers
// =====================================================================

async function api(path, opts = {}) {
  const res = await fetch(WORKER + path, { credentials: "include", ...opts });
  if (res.status === 401) {
    throw new Error("unauthorized");
  }
  return res;
}

