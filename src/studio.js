// Setor de Vídeo — Canvas Studio
// Content script (mundo isolado) injetado no frame do Studio (*.instructuremedia.com).
// Lê o collection_id da URL do frame, mostra um botão para copiá-lo e exibe a
// quantidade de vídeos recebida do net-hook. Também responde ao popup, em tempo real,
// com a coleção atual desta aba (o popup não guarda nada — só mostra o estado de agora).
(() => {
  "use strict";

  const BTN_ID = "sdv-collection-btn";

  // A URL do frame do Studio costuma ser:
  //   /lti-app/media-picker/collections/courses/<ID>?lti_params=<JWT>
  const URL_PATTERNS = [
    /\/collections\/courses\/(\d+)/,
    /\/collections\/(\d+)/,
    /\/courses\/(\d+)\/collections/,
  ];

  // Contagem de vídeos da coleção atual (preenchida pelo net-hook).
  let lastCount = null;
  let lastExact = false;

  function extractCollectionId() {
    for (const re of URL_PATTERNS) {
      const m = location.pathname.match(re);
      if (m) return m[1];
    }
    return null;
  }

  function labelFor(id) {
    if (lastCount == null) return `🎬 Coleção: ${id}`;
    const n = lastExact ? `${lastCount}` : `${lastCount}+`;
    return `🎬 Coleção: ${id} · ${n} vídeo${lastCount === 1 ? "" : "s"}`;
  }

  // base64url -> string UTF-8 (para ler o payload do JWT em memória).
  function b64urlDecode(input) {
    const pad = input.length % 4 === 0 ? "" : "=".repeat(4 - (input.length % 4));
    const b64 = input.replace(/-/g, "+").replace(/_/g, "/") + pad;
    const bin = atob(b64);
    const bytes = Uint8Array.from(bin, (c) => c.charCodeAt(0));
    return new TextDecoder("utf-8").decode(bytes);
  }

  // Extrai SOMENTE o contexto do Canvas (curso/domínio) do lti_params.
  // Nunca lê nem guarda e-mail, user_id ou oauth_key. Tudo em memória.
  function extractCanvasContext() {
    try {
      const raw = new URLSearchParams(location.search).get("lti_params");
      if (!raw) return null;
      const payload = raw.split(".")[1];
      if (!payload) return null;
      const data = JSON.parse(b64urlDecode(payload));
      return {
        canvasCourseId: data.lti_course_id || null,
        canvasDomain: data.canvas_domain || null,
        courseName: data.lti_course_name || null,
      };
    } catch {
      return null; // parse nunca pode quebrar a página
    }
  }

  async function copyText(text) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // fallback p/ iframes sem permissão de clipboard (Permissions-Policy)
      try {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        ta.setAttribute("readonly", "");
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        ta.remove();
        return ok;
      } catch {
        return false;
      }
    }
  }

  function buildButton() {
    const btn = document.createElement("button");
    btn.id = BTN_ID;
    btn.type = "button";
    Object.assign(btn.style, {
      position: "fixed",
      bottom: "16px",
      right: "16px",
      zIndex: "2147483647",
      padding: "10px 14px",
      borderRadius: "10px",
      border: "none",
      background: "#1d3f72",
      color: "#fff",
      font: "600 13px/1.2 system-ui, Segoe UI, sans-serif",
      boxShadow: "0 4px 14px rgba(0,0,0,.28)",
      cursor: "pointer",
      letterSpacing: ".2px",
    });
    btn.addEventListener("mouseenter", () => (btn.style.background = "#27538f"));
    btn.addEventListener("mouseleave", () => (btn.style.background = "#1d3f72"));
    btn.addEventListener("click", onClick);
    return btn;
  }

  let resetTimer = null;

  async function onClick() {
    const btn = document.getElementById(BTN_ID);
    if (!btn) return;
    const id = btn.dataset.collectionId;
    if (!id) return;
    const ok = await copyText(id);
    btn.textContent = ok ? "✅ Copiado!" : `⚠️ Copie: ${id}`;
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => (btn.textContent = labelFor(id)), 1600);
  }

  function render() {
    const id = extractCollectionId();
    let btn = document.getElementById(BTN_ID);

    if (!id) {
      if (btn) btn.remove(); // saiu da view de coleção
      return;
    }

    const isNewCollection = !btn || btn.dataset.collectionId !== id;

    if (!btn) {
      btn = buildButton();
      (document.body || document.documentElement).appendChild(btn);
    }

    if (isNewCollection) {
      lastCount = null; // zera a contagem da coleção anterior
      lastExact = false;
      btn.dataset.collectionId = id;
    }
    btn.textContent = labelFor(id);
  }

  // Recebe a contagem de vídeos do net-hook (mesmo frame, mundo principal).
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.__sdv !== true || d.type !== "media-count") return;
    if (typeof d.count !== "number") return;

    // mantém o maior total exato visto; aproximado só preenche se não houver nada.
    if (d.exact) {
      lastCount = d.count;
      lastExact = true;
    } else if (lastCount == null) {
      lastCount = d.count;
      lastExact = false;
    }

    const btn = document.getElementById(BTN_ID);
    const id = btn?.dataset.collectionId;
    if (btn && id) btn.textContent = labelFor(id);
  });

  // O popup pergunta, ao abrir, qual a coleção desta aba AGORA.
  // Só respondemos se este frame estiver numa view de coleção — assim o popup
  // fica vazio quando o usuário não está no Studio.
  chrome.runtime?.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg || msg.type !== "sdv-get-current") return;
    const id = extractCollectionId();
    if (!id) return; // este frame não tem coleção: não responde
    const ctx = extractCanvasContext() || {};
    sendResponse({
      id,
      videoCount: lastCount,
      videoCountExact: lastExact,
      courseName: ctx.courseName || null,
      canvasCourseId: ctx.canvasCourseId || null,
      canvasDomain: ctx.canvasDomain || null,
    });
  });

  // A SPA do Studio troca de rota sem recarregar a página.
  // popstate cobre voltar/avançar; o polling leve cobre pushState/replaceState.
  function watchNavigation() {
    let last = location.href;
    const check = () => {
      if (location.href !== last) {
        last = location.href;
        render();
      }
    };
    window.addEventListener("popstate", check);
    setInterval(check, 700);
  }

  function start() {
    render();
    watchNavigation();
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
