---
---
const SCHEMAS = {
  base: {% include schemas/base.json %},
  publications: {% include schemas/publications.json %},
  people: {% include schemas/people.json %},
  events: {% include schemas/events.json %},
  data: {% include schemas/data.json %}
};

// =====================================================================
// Schema resolution (resolves $ref into _includes/schemas/base.json)
// =====================================================================

const resolvedSchemaCache = {};

function resolveRefs(node) {
  if (Array.isArray(node)) return node.map(resolveRefs);
  if (node && typeof node === "object") {
    if (typeof node.$ref === "string") {
      const m = node.$ref.match(/^_includes\/schemas\/base\.json#\/\$defs\/(.+)$/);
      if (m && SCHEMAS.base.$defs[m[1]]) return resolveRefs(SCHEMAS.base.$defs[m[1]]);
      return node; // unresolved ref; leave as-is rather than fail the whole page
    }
    const out = {};
    for (const [k, v] of Object.entries(node)) out[k] = resolveRefs(v);
    return out;
  }
  return node;
}

function schemaFor(type) {
  if (!resolvedSchemaCache[type]) {
    const def = SCHEMAS[type].items.$ref.substring(8); // remove prefix "#/$defs/"
    resolvedSchemaCache[type] = resolveRefs(SCHEMAS[type].$defs[def]);
  }
  return resolvedSchemaCache[type];
}

// Every property key that can appear on an entry of this type: the base
// properties plus anything introduced by allOf/if/then (publications'
// category-specific fields).
function allFieldKeys(schema) {
  const keys = new Set(Object.keys(schema.properties || {}));
  for (const clause of schema.allOf || []) {
    for (const k of Object.keys((clause.then && clause.then.properties) || {})) keys.add(k);
  }
  return [...keys];
}

function fieldSchemaFor(schema, key) {
  if (schema.properties && schema.properties[key]) return schema.properties[key];
  for (const clause of schema.allOf || []) {
    if (clause.then && clause.then.properties && clause.then.properties[key]) {
      return clause.then.properties[key];
    }
  }
  return null;
}

function ifClauseMatches(ifSchema, entry) {
  if (!ifSchema || !ifSchema.properties) return false;
  return Object.entries(ifSchema.properties).every(([k, sub]) => entry[k] === sub.const);
}

// Whether a field should be shown/editable for this entry right now (base
// fields: always; conditional fields: only when their category matches).
function fieldVisible(schema, key, entry) {
  if (schema.properties && schema.properties[key]) return true;
  for (const clause of schema.allOf || []) {
    if (ifClauseMatches(clause.if, entry)) {
      if (clause.then && clause.then.properties && clause.then.properties[key]) {
        return true;
      }
    }
  }
  return false;
}

// Required fields for this entry right now: base required + whatever the
// matching allOf/if/then clause(s) add for the current category.
function requiredFields(schema, entry) {
  const req = new Set(schema.required || []);
  for (const clause of schema.allOf || []) {
    if (ifClauseMatches(clause.if, entry) && clause.then && clause.then.required) {
      for (const r of clause.then.required) req.add(r);
    }
  }
  return req;
}

function isPersonNameSchema(s) {
  return !!s && s.type === "array" && s.items && s.items.type === "string" && s.minItems === 2 && s.maxItems === 2;
}

// Infers how a field should be rendered/edited purely from its resolved
// schema fragment and its key. Keeping this schema-driven (rather than a
// hand-written per-type field list) means it stays correct automatically
// if _includes/schemas/*.json gains or changes fields.
function fieldKind(key, fs) {
  if (fs.enum) return "select";
  if (fs.type === "integer") return "number";
  if (fs.type === "string") {
    if (fs.format === "uri") return "url";
    if (fs.format === "email") return "email";
    return "text";
  }
  if (fs.type === "array") {
    if (isPersonNameSchema(fs)) return "nametuple";
    const items = fs.items || {};
    // A property whose key exactly matches one of the four data type names
    // is a reference to that type's entries by id (per the team's naming
    // convention — not something expressible in JSON Schema itself).
    if (TYPE_NAMES.includes(key)) return "idrefs";
    if (isPersonNameSchema(items)) return "tuplelist";
    if (items.type === "object") return "objectlist";
    return "tags";
  }
  return "text";
}

// Validates a scalar string value against pattern/oneOf/misused-format
// constraints on its field schema. Returns true if OK.
function stringMatchesSchema(fs, value) {
  if (fs.pattern && !new RegExp(fs.pattern).test(value)) return false;
  if (fs.oneOf) {
    return fs.oneOf.some((sub) => !sub.pattern || new RegExp(sub.pattern).test(value));
  }
  if (fs.format && fs.format !== "uri" && fs.format !== "email") {
    // Some fields (e.g. issn) misuse "format" to hold a regex string.
    try {
      if (!new RegExp(fs.format).test(value)) return false;
    } catch (e) {
      /* not actually a regex; ignore */
    }
  }
  return true;
}

