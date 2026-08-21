// Setor de Vídeo — Canvas Studio · net-hook
// Roda no MUNDO PRINCIPAL da página (world: MAIN) para "escutar" as chamadas que o
// próprio Studio já faz (autenticadas pela sessão do usuário — NÃO usa chave de API).
// Não altera nenhuma resposta: apenas lê a lista de vídeos (contagem + duração) e avisa
// o studio.js via postMessage.
//
// A grade do Studio é paginada (endpoint `tiles`, 20 por página), então a soma das durações
// da página 1 não seria o total da coleção. Para dar o total REAL, ao ver a primeira resposta
// este script REPETE a mesma requisição para as páginas restantes — com o mesmo método e os
// MESMOS CABEÇALHOS que a SPA usou, porque o Studio autentica a chamada por header; uma
// requisição "limpa" volta 401 e a soma ficaria parcial.
//
// Diagnóstico: `localStorage.setItem("sdv-debug", "1")` no console do frame do Studio liga
// o log detalhado de cada página. Falhas sempre aparecem como aviso no console.
(() => {
  "use strict";

  const HOST_RE = /instructuremedia\.com/;
  const PATH_RE = /media|collection|tiles/i;
  const MAX_PAGES = 50; // teto de segurança: 50 x 20 = 1000 vídeos
  const LOG = "[SDV]";

  // Cabeçalhos que não se repassam numa nova requisição (o navegador os define).
  const SKIP_HEADERS = new Set([
    "host", "connection", "content-length", "cookie", "origin", "referer",
    "user-agent", "sec-fetch-mode", "sec-fetch-site", "sec-fetch-dest",
  ]);

  // Guarda a fetch original ANTES do patch: as chamadas de paginação usam esta
  // referência, para não reentrarem no próprio interceptador.
  const origFetch = window.fetch;

  let DEBUG = false;
  try {
    DEBUG = localStorage.getItem("sdv-debug") === "1";
  } catch {
    /* localStorage bloqueado no iframe: segue sem log detalhado */
  }
  const log = (...a) => DEBUG && console.debug(LOG, ...a);
  const warn = (...a) => console.warn(LOG, ...a);

  function absUrl(u) {
    try {
      return new URL(u, location.href).href;
    } catch {
      return String(u || "");
    }
  }

  function isInteresting(url) {
    return HOST_RE.test(url) && PATH_RE.test(url);
  }

  // Headers/objeto/array -> objeto simples, já sem os cabeçalhos que não se repassam.
  function headersToObject(h) {
    const out = {};
    if (!h) return out;
    const put = (k, v) => {
      if (k && !SKIP_HEADERS.has(String(k).toLowerCase())) out[k] = v;
    };
    try {
      if (typeof h.forEach === "function" && !Array.isArray(h)) {
        h.forEach((v, k) => put(k, v)); // Headers
      } else if (Array.isArray(h)) {
        for (const pair of h) if (pair && pair.length === 2) put(pair[0], pair[1]);
      } else {
        for (const k of Object.keys(h)) put(k, h[k]);
      }
    } catch {
      /* formato inesperado: melhor sem cabeçalhos do que quebrar */
    }
    return out;
  }

  // --- acumulador por listagem ------------------------------------------------
  // ids: mídias únicas já vistas (evita somar duas vezes quando a SPA repete uma página).
  // A chave é coleção + assinatura da listagem (a URL sem `page`), porque uma busca ou um
  // filtro dentro da coleção devolve OUTRO `total_count`: sem separar, a contagem filtrada
  // apareceria ao lado da duração da coleção inteira.
  const stats = new Map();

  function listSignature(url) {
    try {
      const u = new URL(url, location.href);
      u.searchParams.delete("page");
      return u.href;
    } catch {
      return String(url || "");
    }
  }

  function statsFor(key) {
    let s = stats.get(key);
    if (!s) {
      s = {
        ids: new Set(),
        videos: new Map(), // chave -> { mediaId, ltiLaunchId, title, duration }
        durationSec: 0,
        durationItems: 0,
        totalCount: null,
        lastPage: null,
      };
      stats.set(key, s);
    }
    return s;
  }

  // --- leitura da resposta `tiles` --------------------------------------------
  // Formato: { tiles: [ { data: { collection: {id}, media: { id, duration } } } ], meta: {…} }
  function readTiles(json) {
    if (!json || !Array.isArray(json.tiles)) return null;
    const meta = json.meta || {};
    const items = [];
    let collectionId = null;

    for (const tile of json.tiles) {
      const data = tile && tile.data;
      const media = data && data.media;
      if (!media) continue; // tiles que não são mídia (pastas etc.)
      if (collectionId == null && data.collection && data.collection.id != null) {
        collectionId = String(data.collection.id);
      }
      const key =
        media.id != null
          ? "id:" + media.id
          : media.notorious_id
          ? "n:" + media.notorious_id
          : media.lti_launch_id
          ? "l:" + media.lti_launch_id
          : null;
      items.push({
        key,
        duration: typeof media.duration === "number" ? media.duration : null,
        // `lti_launch_id` é o mesmo valor que aparece no embed da página do Canvas
        // (custom_arc_media_id) — é a chave do cruzamento com os módulos.
        ltiLaunchId: media.lti_launch_id || null,
        // `notorious_id` é o id interno da mídia; aparece nas URLs do Studio quando o vídeo
        // é colado na página (Ctrl+V) em vez de inserido pelo "Adicionar item → Studio".
        notoriousId: media.notorious_id || null,
        mediaId: media.id != null ? String(media.id) : null,
        title: data.title || media.title || null,
      });
    }

    const num = (v) => (typeof v === "number" ? v : null);
    return {
      collectionId,
      items,
      totalCount: num(meta.total_count),
      currentPage: num(meta.current_page),
      lastPage: num(meta.last_page),
      perPage: num(meta.per_page),
    };
  }

  // Quantas páginas percorrer. `last_page` é o normal; se a instância não mandar,
  // deduz de total_count / per_page (ou do tamanho da página recebida).
  function pageCount(parsed) {
    if (parsed.lastPage != null) return parsed.lastPage;
    const per = parsed.perPage || parsed.items.length;
    if (parsed.totalCount != null && per > 0) return Math.ceil(parsed.totalCount / per);
    return null;
  }

  function accumulate(parsed, signature) {
    const s = statsFor((parsed.collectionId || "unknown") + "|" + signature);
    for (const item of parsed.items) {
      if (item.key) {
        if (s.ids.has(item.key)) continue; // já contabilizado
        s.ids.add(item.key);
        s.videos.set(item.key, {
          mediaId: item.mediaId,
          ltiLaunchId: item.ltiLaunchId,
          notoriousId: item.notoriousId,
          title: item.title,
          duration: item.duration,
        });
      }
      if (typeof item.duration === "number" && item.duration > 0) {
        s.durationSec += item.duration;
        s.durationItems += 1;
      }
    }
    if (parsed.totalCount != null) s.totalCount = parsed.totalCount;
    if (parsed.lastPage != null) s.lastPage = parsed.lastPage;
    return s;
  }

  function emitStats(collectionId, s) {
    const seen = s.ids.size;
    window.postMessage(
      {
        __sdv: true,
        type: "collection-stats",
        collectionId: collectionId || null,
        count: s.totalCount != null ? s.totalCount : seen,
        exact: s.totalCount != null,
        durationSec: s.durationSec,
        durationItems: s.durationItems,
        videosSeen: seen,
        // completo = já vimos todas as mídias que a coleção diz ter
        complete: s.totalCount != null && seen >= s.totalCount,
        // Inventário: o painel cruza estes ids com os embeds das páginas do curso.
        videos: Array.from(s.videos.values()),
      },
      "*"
    );
  }

  // --- completar as páginas restantes -----------------------------------------
  const completing = new Set(); // assinaturas (URL sem `page`) já percorridas

  function pageUrl(url, page) {
    const u = new URL(url, location.href);
    u.searchParams.set("page", String(page));
    return u.href;
  }

  // `req` = método/cabeçalhos/credenciais capturados da requisição original da SPA.
  async function completeAllPages(url, parsed, req) {
    const total = pageCount(parsed);
    if (!total || total <= 1 || typeof origFetch !== "function") return;
    if (req && req.method && req.method.toUpperCase() !== "GET") return; // só repetimos leitura

    const signature = listSignature(url);
    if (completing.has(signature)) return; // já percorrido (ou em andamento)
    completing.add(signature);

    const limit = Math.min(total, MAX_PAGES);
    log("paginando", { url, paginas: total, limite: limit, currentPage: parsed.currentPage });

    let s = null;
    for (let page = 1; page <= limit; page++) {
      if (page === parsed.currentPage) continue; // esta já veio pela interceptação
      const target = pageUrl(url, page);
      try {
        const res = await origFetch.call(window, target, {
          method: "GET",
          // Mesmos cabeçalhos da SPA: é assim que o Studio reconhece a sessão.
          headers: Object.assign({ Accept: "application/json" }, (req && req.headers) || {}),
          credentials: (req && req.credentials) || "same-origin",
        });
        if (!res.ok) {
          warn(`página ${page} de ${limit} respondeu ${res.status}; a duração fica parcial.`, target);
          break;
        }
        const next = readTiles(await res.json());
        if (!next) {
          warn(`página ${page} veio sem a lista esperada; a duração fica parcial.`);
          break;
        }
        const key = (next.collectionId || parsed.collectionId || "unknown") + "|" + signature;
        const before = statsFor(key).ids.size;
        s = accumulate(next, signature);
        log(`página ${page}: +${s.ids.size - before} vídeos (total ${s.ids.size})`);
        if (s.ids.size === before) {
          // O servidor ignorou o parâmetro `page` (devolveu a mesma lista): parar aqui
          // evita repetir a mesma requisição até o teto sem ganhar nada.
          warn(`página ${page} não trouxe vídeos novos; parando. A duração fica parcial.`);
          break;
        }
        emitStats(next.collectionId || parsed.collectionId, s); // atualiza a UI a cada página
      } catch (err) {
        warn(`falha de rede na página ${page}; a duração fica parcial.`, err);
        break;
      }
    }

    if (s) {
      const faltam = s.totalCount != null ? s.totalCount - s.ids.size : null;
      console.info(
        `${LOG} coleção ${parsed.collectionId || "?"}: ${s.ids.size} vídeos somados` +
          (faltam ? ` (faltaram ${faltam})` : " (completo)") +
          `, ${Math.round(s.durationSec / 60)} min.`
      );
    }
  }

  // --- fallback genérico (instâncias/versões sem `tiles`): só a contagem -------
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

  function analyze(url, text, req) {
    try {
      const json = JSON.parse(text);

      const parsed = readTiles(json);
      if (parsed && parsed.items.length) {
        log("tiles interceptado", {
          url,
          itens: parsed.items.length,
          meta: {
            current_page: parsed.currentPage,
            last_page: parsed.lastPage,
            per_page: parsed.perPage,
            total_count: parsed.totalCount,
          },
        });
        emitStats(parsed.collectionId, accumulate(parsed, listSignature(url)));
        completeAllPages(url, parsed, req);
        return;
      }

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
  if (typeof origFetch === "function") {
    window.fetch = function (...args) {
      const [input, init] = args;
      return origFetch.apply(this, args).then((res) => {
        try {
          const raw =
            (res && res.url) ||
            (typeof input === "string" ? input : input && input.url) ||
            "";
          const url = absUrl(raw);
          if (isInteresting(url)) {
            // Captura como a SPA fez a chamada, para poder repeti-la nas outras páginas.
            const fromRequest = input && typeof input === "object" ? input : null;
            const req = {
              method: (init && init.method) || (fromRequest && fromRequest.method) || "GET",
              headers: headersToObject(
                (init && init.headers) || (fromRequest && fromRequest.headers)
              ),
              credentials:
                (init && init.credentials) || (fromRequest && fromRequest.credentials) || undefined,
            };
            res.clone().text().then((t) => analyze(url, t, req)).catch(() => {});
          }
        } catch {}
        return res;
      });
    };
  }

  // --- intercepta XMLHttpRequest (sem alterar a resposta) ---
  const origOpen = XMLHttpRequest.prototype.open;
  const origSend = XMLHttpRequest.prototype.send;
  const origSetHeader = XMLHttpRequest.prototype.setRequestHeader;

  XMLHttpRequest.prototype.open = function (method, url, ...rest) {
    this.__sdvUrl = absUrl(url); // absoluta: a SPA chama com caminho relativo
    this.__sdvMethod = method;
    this.__sdvHeaders = {};
    return origOpen.call(this, method, url, ...rest);
  };
  XMLHttpRequest.prototype.setRequestHeader = function (name, value) {
    try {
      if (name && !SKIP_HEADERS.has(String(name).toLowerCase())) {
        (this.__sdvHeaders = this.__sdvHeaders || {})[name] = value;
      }
    } catch {}
    return origSetHeader.call(this, name, value);
  };
  XMLHttpRequest.prototype.send = function (...args) {
    this.addEventListener("load", function () {
      try {
        const url = this.responseURL || this.__sdvUrl || "";
        if (isInteresting(url) && typeof this.responseText === "string") {
          analyze(url, this.responseText, {
            method: this.__sdvMethod || "GET",
            headers: this.__sdvHeaders || {},
            credentials: this.withCredentials ? "include" : "same-origin",
          });
        }
      } catch {}
    });
    return origSend.apply(this, args);
  };
})();
