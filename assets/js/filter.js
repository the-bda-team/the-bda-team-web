const filterElement = document.querySelector(".filter input");
if (filterElement !== null) {
// IF FILTER FIELD PRESENT

// Settings
const historyNewStateThresholdMs = 1000;
const listAttributes = ["author", "editor", "keywords", "people", "publications", "versions"];

// Global variables

const filteredAllMessageElement = document.getElementById("filtered-all-message");
let lastHistoryChangeMs = new Date().getTime();

// Normalization

function normalize(value, protectCommata = false, protectQueryModifiers = false) {
  const regexBase = /[^\u{61}-\u{7a}\u{df}-\u{f6}\u{f8}-\u{ff}\u{100}-\u{17F}0-9\-,:+\s]/gu;
  const regexCommata = /[,]/g;
  const regexQueryModifiers = /[:+]/g;
  const regexWhitespace = /[\s]/g;
  
  let normalized = value.toLowerCase().normalize("NFD").replace(/[\u{300}-\u{36f}]/gu, "").replace(regexBase, "");
  if (!protectCommata) { normalized = normalized.replace(regexCommata, ""); }
  if (!protectQueryModifiers) {
    normalized = normalized.replace(regexQueryModifiers, "");
  } else {
    normalized = normalized.replace(/: /g, " ");
    normalized = normalized.replace(/:$/g, "");
  }
  normalized = normalized.replace(regexWhitespace, " ");

  return normalized;
}

for (const entryElement of Array.from(document.querySelectorAll(".entry"))) {
  const attributes = entryElement.dataset;
  for (const attribute in attributes) {
    if (listAttributes.includes(attribute)) {
      attributes[attribute] = normalize(attributes[attribute], protectCommata = true, protectQueryModifiers = false);
    } else {
      attributes[attribute] = normalize(attributes[attribute]);
    }
  }
  attributes['text'] = normalize(entryElement.textContent);
  attributes['fields'] = Object.keys(attributes).join(" ");
  attributes['links'] = Array.from(entryElement.querySelectorAll("a")).map(link => link.getAttribute("href")).join(" ");
}

// Init
if (!window.location.hash && filterElement.getAttribute("data-focus") === "true") { filterElement.focus(); }

function syncFilterElement() {
  const searchParams = new URL(document.location).searchParams;
  if (searchParams.has("q")) {
    const query = searchParams.get("q");
    if (query !== filterElement.value) {
      filterElement.value = query;
      filterEntries();
    }
  } else if (filterElement.value !== "") {
    filterElement.value = "";
    filterEntries();
  }
}
syncFilterElement();
window.addEventListener("popstate", syncFilterElement); // also update on back button

filterElement.addEventListener("input", filterEntries);

// History manipulation

function updateUrlQueryParameter(query) {
  const url = new URL(document.location.href);
  if (query.trim() === "") {
    if (!url.searchParams.has("q")) {
      return;
    } else {
      url.searchParams.delete("q");
    }
  } else {
    if (url.searchParams.has("q") && url.searchParams.get("q") === query) {
      return;
    } else {
      url.searchParams.set("q", query);
    }
  }

  const now = new Date().getTime();
  const msSinceLastHistoryChange = now - lastHistoryChangeMs;
  lastHistoryChangeMs = now;

  if (msSinceLastHistoryChange >= historyNewStateThresholdMs) {
    history.pushState({ query: query }, "", url);
  } else {
    history.replaceState({ query: query }, "", url);
  }
}

// Filtering

function elementMatchQuery(element, queryWords) {
  const attributes = element.dataset;
  for (let q = 0; q < queryWords.length; ++q) {
    let queryWord = queryWords[q].replace(/\+/g, " ");
    let found = false;

    const attributeSpecificatorPos = queryWord.indexOf(":");
    if (attributeSpecificatorPos >= 0) {
      let attribute = queryWord.substr(0, attributeSpecificatorPos);
      queryWord = queryWord.substr(attributeSpecificatorPos + 1);
      if (attributes.hasOwnProperty(attribute)) {
        const attributeValue = attributes[attribute];
        if (attributeValue.indexOf(queryWord) >= 0) {
          found = true;
        }
      }
    } else {
      for (let a in attributes) {
        const attributeValue = attributes[a];
        if (attributeValue.indexOf(queryWord) >= 0) {
          found = true;
          break;
        }
      }
    }
    if (!found) { return false; }
  }
  return true;
}

function filterThisElement(element, keep) {
  if (keep) {
    element.classList.remove("filtered-out");
    element.removeAttribute("aria-hidden");
  } else {
    element.classList.add("filtered-out");
    element.setAttribute("aria-hidden", "true");
  }
  return keep;
}

function filterEntriesMatchingQuery(queryWords) {
  if (queryWords.length === 0) {
    for (const element of Array.from(document.querySelectorAll(".filtered-out"))) {
      filterThisElement(element, true);
    }
  } else {
    let matchedCategories = 0;
    for (const entriesElement of Array.from(document.querySelectorAll(".entries"))) {
      let matches = 0;
      for (const entryElement of Array.from(entriesElement.querySelectorAll(".entry"))) {
        matches += filterThisElement(entryElement, elementMatchQuery(entryElement, queryWords));
      }
      if (entriesElement.hasAttribute("data-headings")) {
        filterThisElement(document.getElementById(entriesElement.getAttribute("data-headings")), matches > 0);
      }
      if (matches > 0) { matchedCategories += 1; }
    }

    if (matchedCategories === 0) {
      filteredAllMessageElement.removeAttribute("aria-hidden");
    } else {
      filteredAllMessageElement.setAttribute("aria-hidden", "true");
    }
  }
}

// Query handling

function filterEntries() {
  const query = filterElement.value;
  const queryWords = normalize(query, protectCommata = false, protectQueryModifiers = true).split(/\s+/);
  filterEntriesMatchingQuery(queryWords);
  updateUrlQueryParameter(query);
}

// END IF FILTER FIELD PRESENT
}

