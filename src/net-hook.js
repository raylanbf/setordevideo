// Setor de Vídeo — Canvas Studio · net-hook
// Roda no MUNDO PRINCIPAL da página (world: MAIN) para "escutar" as chamadas que o
// próprio Studio já faz (autenticadas pela sessão do usuário — NÃO usa chave de API).
// Não altera nenhuma resposta: apenas lê o total de vídeos e avisa o studio.js via postMessage.
(() => {
  "use strict";

  const HOST_RE = /instructuremedia\.com/;
  const PATH_RE = /media|collection/i;

  // Procura recursivamente um campo de total plausível no JSON da resposta.
  function findTotal(obj, depth = 0) {
    if (!obj || typeof obj !== "object" || depth > 5) return null;
    for (const k of ["total", "total_count", "totalCount", "count"]) {
      if (typeof obj[k] === "number") return obj[k];
    }
    if (obj.pagination && typeof obj.pagination.total === "number") return obj.pagination.total;
    for (const sub of ["meta", "pagination", "data"]) {
      if (obj[sub]) {
        const t = findTotal(obj[sub], depth + 1);
        if (t != null) return t;
      }
    }
    return null;
  }

  // Fallback: maior array de itens que parecem mídia (conta o que veio na resposta).
  function countMediaArray(obj, depth = 0) {
    if (!obj || typeof obj !== "object" || depth > 5) return 0;
    if (Array.isArray(obj)) {
      const looksMedia = obj.length > 0 && obj.every(
        (it) => it && typeof it === "object" &&
          ("title" in it || "media_id" in it || "media_source" in it || "duration" in it)
      );
      return looksMedia ? obj.length : 0;
    }
    let best = 0;
    for (const k of Object.keys(obj)) {
      const c = countMediaArray(obj[k], depth + 1);
      if (c > best) best = c;
    }
    return best;
  }

  function analyze(url, text) {
    try {
      if (!HOST_RE.test(url) || !PATH_RE.test(url)) return;
      const json = JSON.parse(text);
      const total = findTotal(json);
      const approx = countMediaArray(json);
      const count = total != null ? total : (approx || null);
      if (count == null) return;
      window.postMessage(
        { __sdv: true, type: "media-count", url, count, exact: total != null },
        "*"
      );
    } catch {
      /* resposta não-JSON ou sem o que precisamos: ignora */
    }
  }

  // --- intercepta fetch (sem alterar a resposta) ---
  const origFetch = window.fetch;
  if (typeof origFetch === "function") {
    window.fetch = function (...args) {
      return origFetch.apply(this, args).then((res) => {
        try {
          const url =
            (res && res.url) ||
            (typeof args[0] === "string" ? args[0] : args[0] && args[0].url) ||
            "";
          if (HOST_RE.test(url) && PATH_RE.test(url)) {
            res.clone().text().then((t) => analyze(url, t)).catch(() => {});
          }
        } catch {}
        return res;
      });
    };
  }

  // --- intercepta XMLHttpRequest (sem alterar a resposta) ---
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__sdvUrl = url;
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", function () {
      try {
        const url = this.__sdvUrl || this.responseURL || "";
        if (HOST_RE.test(url) && PATH_RE.test(url) && typeof this.responseText === "string") {
          analyze(url, this.responseText);
        }
      } catch {}
    });
    return origSend.apply(this, args);
  };
})();
