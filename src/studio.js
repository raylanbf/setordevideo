// Setor de Vídeo — Canvas Studio
// Content script (mundo isolado) injetado no frame do Studio (*.instructuremedia.com).
// Lê o collection_id da URL do frame, mostra um botão para copiá-lo e exibe a quantidade
// de vídeos e a DURAÇÃO TOTAL da coleção, recebidas do net-hook. Também responde ao popup,
// em tempo real, com a coleção atual desta aba (o popup não guarda nada — só mostra agora).
// A formatação de duração vem de src/format.js (sdvFormatDuration), carregado antes deste.
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

  // Estatísticas por coleção (preenchidas pelo net-hook): contagem + soma das durações.
  // Guardamos por id porque o net-hook acumula por coleção; `latestKey` é o fallback para
  // instâncias em que o id da URL do frame não é o mesmo de `data.collection.id`.
  const statsByCollection = new Map();
  let latestKey = null;
  let renderedId = null;

  // Pedidos de transcrição em voo, do painel para o net-hook (pedido -> {responder, timer}).
  const pedidosLegenda = new Map();
  let seqLegenda = 0;
  let receitaConhecida = false; // o net-hook já viu uma legenda passar neste frame?
  let apiPronta = false; // e já capturou os cabeçalhos de sessão da API do Studio?

  function resetStats() {
    statsByCollection.clear();
    latestKey = null;
  }

  function extractCollectionId() {
    for (const re of URL_PATTERNS) {
      const m = location.pathname.match(re);
      if (m) return m[1];
    }
    return null;
  }

  function currentStats() {
    const id = extractCollectionId();
    if (id && statsByCollection.has(id)) return statsByCollection.get(id);
    return latestKey != null ? statsByCollection.get(latestKey) || null : null;
  }

  function labelFor(id) {
    const s = currentStats();
    if (!s) return `🎬 Coleção: ${id}`;

    const parts = [];
    if (typeof s.count === "number") {
      const n = s.exact ? `${s.count}` : `${s.count}+`;
      parts.push(`${n} vídeo${s.count === 1 ? "" : "s"}`);
    }
    const dur = sdvFormatDuration(s.durationSec);
    // "+" enquanto ainda não vimos todos os vídeos (paginação em andamento ou incompleta).
    if (dur) parts.push(s.complete ? dur : `${dur}+`);

    return parts.length ? `🎬 Coleção: ${id} · ${parts.join(" · ")}` : `🎬 Coleção: ${id}`;
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
    // `busy` segura o texto de confirmação: nem o render nem a chegada de novas
    // páginas apagam o "Copiado!" antes da hora.
    btn.dataset.busy = "1";
    btn.textContent = ok ? "✅ Copiado!" : `⚠️ Copie: ${id}`;
    clearTimeout(resetTimer);
    resetTimer = setTimeout(() => {
      delete btn.dataset.busy;
      btn.textContent = labelFor(id);
    }, 1600);
  }

  function paintButton() {
    const btn = document.getElementById(BTN_ID);
    const id = btn && btn.dataset.collectionId;
    if (!btn || !id || btn.dataset.busy) return;
    const label = labelFor(id);
    if (btn.textContent !== label) btn.textContent = label;
  }

  function render() {
    const id = extractCollectionId();

    if (id !== renderedId) {
      resetStats(); // trocou de coleção: zera contagem e duração da anterior
      renderedId = id;
    }

    let btn = document.getElementById(BTN_ID);

    if (!id) {
      if (btn) btn.remove(); // saiu da view de coleção
      return;
    }

    if (!btn) {
      // Recria o botão caso a SPA tenha reescrito o body sem trocar de rota.
      btn = buildButton();
      (document.body || document.documentElement).appendChild(btn);
    }
    btn.dataset.collectionId = id;
    paintButton();
  }

  // Manda o inventário (vídeos + durações) para o service worker, que o guarda em
  // chrome.storage.session — assim o painel lateral consegue cruzar a coleção com os
  // módulos mesmo depois que o usuário sair da página do Studio.
  let envioAgendado = null;
  function enviarInventario(key) {
    clearTimeout(envioAgendado);
    envioAgendado = setTimeout(() => {
      const s = statsByCollection.get(key);
      if (!s || !s.videos || !s.videos.length) return;
      const ctx = extractCanvasContext() || {};
      try {
        chrome.runtime?.sendMessage(
          {
            type: "sdv-inventory",
            data: {
              collectionId: extractCollectionId() || key,
              canvasCourseId: ctx.canvasCourseId || null,
              canvasDomain: ctx.canvasDomain || null,
              studioDomain: location.host,
              courseName: ctx.courseName || null,
              videos: s.videos,
              totalCount: s.count,
              complete: s.complete,
            },
          },
          () => void chrome.runtime.lastError // service worker dormindo: sem problema
        );
      } catch {
        /* contexto da extensão invalidado (recarregou a extensão): ignora */
      }
    }, 400); // junta as atualizações de várias páginas num envio só
  }

  // Recebe do net-hook (mesmo frame, mundo principal) a contagem e a soma de durações.
  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.__sdv !== true) return;

    if (d.type === "collection-stats") {
      const key = d.collectionId || "unknown";
      statsByCollection.set(key, {
        count: typeof d.count === "number" ? d.count : null,
        exact: !!d.exact,
        durationSec: typeof d.durationSec === "number" ? d.durationSec : 0,
        durationItems: typeof d.durationItems === "number" ? d.durationItems : 0,
        videosSeen: typeof d.videosSeen === "number" ? d.videosSeen : 0,
        complete: !!d.complete,
        videos: Array.isArray(d.videos) ? d.videos : [],
      });
      latestKey = key;
      paintButton();
      enviarInventario(key);
      return;
    }

    // O net-hook aprendeu a rota da transcrição ("Baixar histórico"). Guardamos apenas o
    // FORMATO da URL — nunca os cabeçalhos de sessão, que ficam só na memória do frame.
    if (d.type === "caption-endpoint" && d.template) {
      receitaConhecida = true;
      try {
        chrome.runtime?.sendMessage(
          {
            type: "sdv-caption-endpoint",
            data: { template: d.template, ids: d.ids || [], studioDomain: location.host },
          },
          () => void chrome.runtime.lastError
        );

        // O id aprendido é a legenda de um vídeo específico — o sufixo diz de qual. Guardar
        // no mapa faz cada "Baixar histórico" somar um vídeo, em vez de substituir o anterior.
        const achados = (d.ids || [])
          .map((id) => {
            const m = String(id).match(/-(\d+)$/);
            return m ? { mediaId: m[1], id: String(id) } : null;
          })
          .filter(Boolean);
        if (achados.length) {
          chrome.runtime?.sendMessage(
            { type: "sdv-caption-files", data: { achados, origem: "molde aprendido" } },
            () => void chrome.runtime.lastError
          );
        }
      } catch {
        /* extensão recarregada: ignora */
      }
      return;
    }

    // Resposta a um pedido de transcrição feito pelo painel.
    if (d.type === "caption-response" && pedidosLegenda.has(d.pedido)) {
      const pendente = pedidosLegenda.get(d.pedido);
      pedidosLegenda.delete(d.pedido);
      clearTimeout(pendente.timer);
      pendente.responder({
        ok: !!d.ok,
        texto: d.texto || null,
        erro: d.erro || null,
        url: d.url || null,
        diagnostico: d.diagnostico || null,
        diario: d.diario || null, // o que o frame tentou, para o relatório do painel
      });
      return;
    }

    if (d.type === "caption-api-pronta") {
      apiPronta = true;
      return;
    }

    // Ids de arquivo de legenda vistos passando: guardamos por vídeo, para o painel poder
    // montar o download sem depender de descobrir a rota.
    if (d.type === "caption-files" && Array.isArray(d.achados) && d.achados.length) {
      try {
        chrome.runtime?.sendMessage(
          { type: "sdv-caption-files", data: { achados: d.achados, origem: d.origem || null } },
          () => void chrome.runtime.lastError
        );
      } catch {
        /* ignora */
      }
      return;
    }

    // O endereço da legenda existe, mas identifica o arquivo de legenda e não o vídeo.
    // Guardamos o diagnóstico para o painel poder explicar isso em vez de dizer só
    // "ainda não sei como o Studio entrega a transcrição".
    if (d.type === "caption-endpoint-inutil") {
      try {
        chrome.runtime?.sendMessage(
          {
            type: "sdv-caption-endpoint",
            data: {
              template: d.template,
              inutil: true,
              ids: d.ids || [],
              studioDomain: location.host,
            },
          },
          () => void chrome.runtime.lastError
        );
      } catch {
        /* ignora */
      }
      return;
    }

    // O formato aprendido se provou errado: apaga aqui e no armazenamento da sessão, para
    // que o próximo "Baixar histórico" possa ensinar o certo.
    if (d.type === "caption-forget") {
      receitaConhecida = false;
      try {
        chrome.runtime?.sendMessage({ type: "sdv-caption-forget" }, () => void chrome.runtime.lastError);
      } catch {
        /* ignora */
      }
      return;
    }

    // Transcrição montada no próprio navegador. Não ensina rota nenhuma — e não pode
    // apagar uma já aprendida, porque a SPA também transforma em Blob o que baixou da rede.
    if (d.type === "caption-blob") return;

    // Fallback de instâncias sem o endpoint `tiles`: só a contagem, e nunca por cima
    // de dados reais de duração já obtidos.
    if (d.type === "media-count" && typeof d.count === "number") {
      const cur = currentStats();
      if (cur && cur.durationSec > 0) return;
      const prev = statsByCollection.get("unknown");
      if (prev && prev.exact && !d.exact) return;
      statsByCollection.set("unknown", {
        count: d.count,
        exact: !!d.exact,
        durationSec: 0,
        durationItems: 0,
        videosSeen: 0,
        complete: false,
      });
      if (latestKey == null) latestKey = "unknown";
      paintButton();
    }
  });

  // O popup pergunta, ao abrir, qual a coleção desta aba AGORA.
  // Só respondemos se este frame estiver numa view de coleção — assim o popup
  // fica vazio quando o usuário não está no Studio.
  chrome.runtime?.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!msg) return;

    // O painel quer a transcrição de um vídeo. Quem busca é este frame: os cabeçalhos
    // de sessão do Studio vivem aqui e não precisam sair daqui.
    if (msg.type === "sdv-get-caption") {
      // Responde se souber a rota OU se tiver os cabeçalhos de sessão da API: são eles que
      // permitem consultar as legendas de um vídeo, e o painel não os tem.
      if (!receitaConhecida && !apiPronta) return;
      const pedido = ++seqLegenda;
      const timer = setTimeout(() => {
        pedidosLegenda.delete(pedido);
        sendResponse({ ok: false, erro: "o Studio demorou demais para responder" });
      }, 20000);
      pedidosLegenda.set(pedido, { responder: sendResponse, timer });
      window.postMessage({ __sdv: true, type: "caption-request", pedido, video: msg.video }, "*");
      return true; // resposta assíncrona
    }

    if (msg.type !== "sdv-get-current") return;
    const id = extractCollectionId();
    if (!id) return; // este frame não tem coleção: não responde
    const ctx = extractCanvasContext() || {};
    const s = currentStats();
    sendResponse({
      id,
      videoCount: s ? s.count : null,
      videoCountExact: s ? s.exact : false,
      durationSec: s ? s.durationSec : 0,
      durationComplete: s ? s.complete : false,
      videosSeen: s ? s.videosSeen : 0,
      // O acervo vai junto: com o Studio aberto o painel não precisa esperar o
      // service worker gravar nada para poder analisar os módulos.
      videos: s && Array.isArray(s.videos) ? s.videos : [],
      courseName: ctx.courseName || null,
      canvasCourseId: ctx.canvasCourseId || null,
      canvasDomain: ctx.canvasDomain || null,
      // Host do Studio: o painel monta com ele o link para abrir cada vídeo.
      studioDomain: location.host,
    });
  });

  // A SPA do Studio troca de rota sem recarregar a página.
  // popstate cobre voltar/avançar; o polling leve cobre pushState/replaceState e
  // também repõe o botão se a SPA reescrever a página.
  function watchNavigation() {
    window.addEventListener("popstate", render);
    setInterval(render, 700);
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
