// Popup: mostra a coleção da ABA ATUAL (em tempo real). Não guarda nada.
// Se a aba ativa não estiver numa coleção do Studio, mostra o estado vazio.
const content = document.getElementById("content");

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]
  ));
}

function field(label, value, extraClass = "") {
  return `<div class="field">
    <div class="label">${esc(label)}</div>
    <div class="value ${extraClass}">${esc(value)}</div>
  </div>`;
}

function renderEmpty() {
  content.innerHTML = `
    <p class="empty">Você não está numa coleção do Studio.</p>
    <p class="hint">Abra um curso no Canvas, entre em <b>Studio</b> pela navegação do curso,
    e o ID da coleção aparece aqui (e num botão dentro da página do Studio).</p>`;
}

function renderData(d) {
  const countTxt =
    d.videoCount == null ? null : d.videoCountExact ? `${d.videoCount}` : `${d.videoCount}+`;
  content.innerHTML = `
    ${field("ID da coleção (Studio)", d.id, "id")}
    ${countTxt ? field("Vídeos na coleção", countTxt) : ""}
    ${d.courseName ? field("Disciplina", d.courseName) : ""}
    ${d.canvasCourseId ? field("Course ID (Canvas)", d.canvasCourseId) : ""}
    ${d.canvasDomain ? field("Domínio Canvas", d.canvasDomain) : ""}
    <button id="copy">Copiar ID da coleção</button>
    <div class="ts">✓ Coleção aberta nesta aba</div>`;

  document.getElementById("copy").addEventListener("click", async () => {
    try {
      await navigator.clipboard.writeText(d.id);
      const b = document.getElementById("copy");
      b.textContent = "✅ Copiado!";
      setTimeout(() => (b.textContent = "Copiar ID da coleção"), 1500);
    } catch {
      /* ignore */
    }
  });
}

// Pergunta à aba ativa qual a coleção atual. Sem resposta => vazio.
chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
  const tab = tabs && tabs[0];
  if (!tab || tab.id == null) {
    renderEmpty();
    return;
  }
  chrome.tabs.sendMessage(tab.id, { type: "sdv-get-current" }, (resp) => {
    if (chrome.runtime.lastError || !resp || !resp.id) renderEmpty();
    else renderData(resp);
  });
});
