/** Format Max's text for display with stutter + glitch styling */
export function formatMaxMessage(text) {
  let html = escapeHtml(text);

  html = html.replace(/\[GLITCH\]/gi, '<span class="glitch-word">[▓GLITCH▓]</span>');

  html = html.replace(
    /([A-Za-z])-((?:\1-)+)(\1\w*)/gi,
    (_, letter, _mid, word) =>
      `<span class="stutter">${letter}-${letter}-${word}</span>`
  );

  return html;
}

function escapeHtml(s) {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

export function appendMessage(container, role, html, className = "") {
  const el = document.createElement("p");
  el.className = `msg ${role} ${className}`.trim();
  if (role === "max") {
    el.innerHTML = html;
  } else {
    el.textContent = html;
  }
  container.appendChild(el);
  container.scrollTop = container.scrollHeight;
  return el;
}
