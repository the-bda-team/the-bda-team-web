// Action element buttons

const actions = {
  "copy": (target) => {
    return navigator.clipboard.writeText(target.textContent);
  }
}

function actionFeedback(triggerElement, error = null) {
  const originalHTML = triggerElement.innerHTML;
  if (error === null) {
    // Replace icon with checkmark for a bit
    // Font Awesome Free v7.1.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.
    triggerElement.innerHTML = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 640'><path d='M530.8 134.1C545.1 144.5 548.3 164.5 537.9 178.8L281.9 530.8C276.4 538.4 267.9 543.1 258.5 543.9C249.1 544.7 240 541.2 233.4 534.6L105.4 406.6C92.9 394.1 92.9 373.8 105.4 361.3C117.9 348.8 138.2 348.8 150.7 361.3L252.2 462.8L486.2 141.1C496.6 126.8 516.6 123.6 530.9 134z'/></svg>";
  } else {
    console.error(error);
    // Replace icon with cross for a bit
    // Font Awesome Free v7.1.0 by @fontawesome - https://fontawesome.com License - https://fontawesome.com/license/free Copyright 2026 Fonticons, Inc.
    triggerElement.innerHTML = "<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 640 640'><path d='M320 576C178.6 576 64 461.4 64 320C64 178.6 178.6 64 320 64C461.4 64 576 178.6 576 320C576 461.4 461.4 576 320 576zM320 384C302.3 384 288 398.3 288 416C288 433.7 302.3 448 320 448C337.7 448 352 433.7 352 416C352 398.3 337.7 384 320 384zM320 192C301.8 192 287.3 207.5 288.6 225.7L296 329.7C296.9 342.3 307.4 352 319.9 352C332.5 352 342.9 342.3 343.8 329.7L351.2 225.7C352.5 207.5 338.1 192 319.8 192z'/></svg>";
  }
  setTimeout(() => triggerElement.innerHTML = originalHTML, 2000);
}

function action(event) {
  const triggerElement = event.target.closest("[data-action]");
  const action = triggerElement.getAttribute("data-action");
  const targetElement = document.getElementById(triggerElement.closest("[data-target]").getAttribute("data-target"));

  actions[action](targetElement).then(
    () => actionFeedback(triggerElement),
    (error) => actionFeedback(triggerElement, error)
  );
}

for (const actionElement of Array.from(document.querySelectorAll("[data-action]"))) {
  actionElement.addEventListener("click", action);
}

// Toggles

function toggle(event) {
  const triggerElement = event.target.closest("[aria-controls]");
  const targetElement = document.getElementById(triggerElement.getAttribute("aria-controls"));
  if (triggerElement.getAttribute("aria-expanded") === "true") {
    triggerElement.setAttribute("aria-expanded", "false");
    targetElement.setAttribute("aria-hidden", "true");
  } else {
    triggerElement.setAttribute("aria-expanded", "true");
    targetElement.setAttribute("aria-hidden", "false");
  }
}

for (const toggleElement of Array.from(document.querySelectorAll("[aria-controls]"))) {
  toggleElement.addEventListener("click", toggle);
}

