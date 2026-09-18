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
  // Legendas/transcrição ("Baixar histórico" no menu ⋮ do player — tradução de
  // "Download Transcript"). Não sabemos de antemão a rota de cada instância, então
  // reconhecemos pelo nome e APRENDEMOS o formato na primeira vez que ela passa.
  const CAPTION_RE = /caption|transcript|subtitle|legend|\.vtt|\.srt|\/tracks?\b/i;
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

  // --- datas do vídeo ---------------------------------------------------------
  // São DUAS datas diferentes, e confundi-las daria um catálogo errado:
  //
  //   • a da MÍDIA  (`tile.data.media`) — quando o vídeo entrou no Studio, ou seja, quando
  //     foi enviado/gravado pela ferramenta. É a que não muda mais.
  //   • a do TILE   (`tile.data`)       — quando ESSA mídia foi posta NESTA coleção. Um vídeo
  //     de março pode entrar numa coleção em agosto, e ser reaproveitado em outra depois.
  //
  // Nenhuma das duas é "quando o vídeo foi publicado numa página do Canvas": isso o Studio
  // não sabe, quem sabe é o Canvas (e só de forma aproximada — ver README).
  //
  // Que o campo existe é certo: a grade é pedida com `sort_by=created_at` (ver
  // docs/automacao-embed-studio-em-paginas.md §4.1), e um servidor não ordena pelo que não
  // tem. O que não se sabe é COMO ele se chama aqui — por isso procuramos os nomes plausíveis
  // em cada uma das duas fontes, separadamente, em vez de fixar um.
  const CAMPOS_DA_MIDIA = ["published_at", "created_at", "uploaded_at", "publish_at", "recorded_at"];
  const CAMPOS_DO_TILE = ["added_at", "inserted_at", "attached_at", "created_at"];

  const camposDeDataVistos = new Set();

  // ISO cru (a formatação fica no painel, no fuso do usuário) ou null.
  function primeiraData(fonte, campos, rotulo) {
    if (!fonte || typeof fonte !== "object") return null;
    for (const campo of campos) {
      const valor = fonte[campo];
      if (typeof valor !== "string") continue; // epoch numérico seria ambíguo (s ou ms)
      const t = new Date(valor);
      const ano = t.getFullYear();
      // Sanidade: o que não vira data plausível é outro campo com nome parecido.
      if (isNaN(t.getTime()) || ano < 2000 || ano > 2100) continue;
      // Dizer de onde veio cada data é o que permite responder, sem adivinhar, se o que está
      // no catálogo é a entrada no Studio ou a entrada na coleção.
      const marca = `${rotulo}:${campo}`;
      if (!camposDeDataVistos.has(marca)) {
        camposDeDataVistos.add(marca);
        console.info(`${LOG} data ${rotulo} lida do campo "${campo}".`);
      }
      return t.toISOString();
    }
    return null;
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
        // Quando a instância informa: a data em que o vídeo entrou no Studio…
        createdAt: primeiraData(media, CAMPOS_DA_MIDIA, "do vídeo no Studio"),
        // …e a data em que ele foi posto nesta coleção, que pode ser bem outra.
        addedAt: primeiraData(data, CAMPOS_DO_TILE, "de entrada na coleção"),
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
          createdAt: item.createdAt,
          addedAt: item.addedAt,
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

      // Qualquer resposta pode carregar o id da legenda de um vídeo: vale olhar todas.
      garimparCaptionFiles(url, json);

      const parsed = readTiles(json);
      if (parsed && parsed.items.length) {
        guardarHeadersDaApi(req); // é uma chamada autenticada da SPA: guarde como sabe falar
        diagnosticarCaptions(json);
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

  // --- legendas / transcrição ("Baixar histórico") ------------------------------
  // A rota muda de instância para instância, então não a chutamos: quando o usuário
  // clica em "Baixar histórico" uma vez, guardamos o FORMATO da chamada (com o id do
  // vídeo trocado por um marcador) e passamos a montá-la para os outros vídeos.
  //
  // A receita fica só em MEMÓRIA deste frame. Os cabeçalhos de sessão NUNCA saem daqui
  // nem são gravados — quem repete a chamada é este script, dentro do frame do Studio,
  // igualzinho ao que já acontece na paginação da coleção.
  let receitaLegenda = null;

  // Troca os identificadores da mídia por marcadores, para servir a qualquer vídeo.
  // O id numérico só vira marcador se nenhum id "forte" apareceu: um número solto na URL
  // pode ser cache-busting, e trocá-lo por engano geraria um molde quebrado.
  function generalizarUrl(url) {
    const ids = [];
    // "?1789171707968" é só cache-busting: não identifica nada e não deve entrar no molde.
    let t = String(url).replace(/[?&]\d{8,}$/, "");

    t = t.replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-\d+/gi, (m) => {
      ids.push(m);
      return "{launch}";
    });
    if (!ids.length) {
      t = t.replace(/m-[A-Za-z0-9_-]{20,}/g, (m) => {
        ids.push(m);
        return "{notorious}";
      });
    }
    if (!ids.length) {
      t = t.replace(/(^|[/=])(\d{4,})(?=[/?&#]|$)/g, (m, antes, num) => {
        ids.push(num);
        return antes + "{mediaId}";
      });
    }
    return { template: t, ids };
  }

  // O id que aparece no endereço é mesmo de um VÍDEO da coleção? Se não for, ele identifica
  // outra coisa (o arquivo de legenda, por exemplo) e trocá-lo pelo id de outro vídeo só
  // pode dar 404 — é exatamente esse o caso que precisamos detectar em vez de insistir.
  function idDeVideoConhecido(valor) {
    const alvo = String(valor);
    for (const s of stats.values()) {
      for (const v of s.videos.values()) {
        if (v.ltiLaunchId === alvo || v.notoriousId === alvo || String(v.mediaId) === alvo) {
          return true;
        }
      }
    }
    return false;
  }

  // Assinatura de legenda de verdade. Cobre os três formatos que o Studio pode devolver:
  // VTT (cabeçalho WEBVTT), SRT (marcação de tempo completa) e JSON (lista de trechos com
  // tempo e texto). Só "-->" não bastaria — apareceria em qualquer HTML com uma seta escrita.
  function pareceLegenda(texto) {
    const t = String(texto || "").trim();
    if (!t) return false;
    if (/^\s*WEBVTT/i.test(t)) return true;
    if (/\d{2}:\d{2}[:.,]\d{2,3}\s*-->\s*\d{2}:\d{2}/.test(t)) return true;
    if (
      /^\s*[[{]/.test(t) &&
      /"(text|content|caption|body)"\s*:/i.test(t) &&
      /"(start|start_time|startTime|begin|from|offset)"\s*:/i.test(t)
    ) {
      return true;
    }
    // O "Baixar histórico" do Studio entrega a transcrição já pronta: texto corrido, sem
    // marcação nenhuma. Então texto que não é HTML nem JSON, e tem corpo, também conta —
    // exigir VTT aqui fazia a extensão recusar justamente a resposta certa.
    if (!/^[[{<]/.test(t) && t.length > 40) return true;
    return false;
  }

  function aprenderLegenda(url, req, amostra) {
    const { template, ids } = generalizarUrl(url);
    if (!/\{(launch|notorious|mediaId)\}/.test(template)) {
      // Sem nenhum id na URL não dá para generalizar para os outros vídeos — mas ainda
      // avisamos, porque a URL crua serve de pista para estender a detecção.
      warn("legenda encontrada, mas sem id na URL (não dá para repetir):", url);
      return;
    }

    // O id do endereço precisa ser o de um vídeo. Se identifica o arquivo de legenda,
    // o molde não serve para mais ninguém e insistir nele só geraria 404 em série.
    // Se o id é de um vídeo ou do arquivo de legenda, decidimos só na hora de USAR: aqui a
    // listagem da coleção pode ainda não ter chegado a este frame (o usuário costuma clicar
    // em "Baixar histórico" dentro do player, antes de abrir a grade), e nesse instante todo
    // id pareceria desconhecido.
    log("transcrição: ids vistos no endereço", ids);
    receitaLegenda = {
      template,
      headers: (req && req.headers) || {},
      credentials: (req && req.credentials) || "same-origin",
      ids, // avaliados na hora do uso, quando o inventário já chegou
    };
    console.info(`${LOG} transcrição: formato aprendido → ${template}`);
    window.postMessage(
      {
        __sdv: true,
        type: "caption-endpoint",
        template,
        ids, // o painel decide com eles se o id é do vídeo ou do arquivo de legenda
        amostra: String(amostra || "").slice(0, 160),
      },
      "*"
    );
  }

  // Diagnóstico, uma vez por sessão: a listagem da coleção já traz algum identificador de
  // legenda? Se trouxer, é por ali que se monta o endereço de cada vídeo sem ter de abrir
  // um a um — e some a necessidade de aprender a rota pelo clique.
  let jaDiagnosticou = false;
  function diagnosticarCaptions(json) {
    if (jaDiagnosticou) return;
    jaDiagnosticou = true;
    const achados = [];
    (function varrer(obj, caminho, prof) {
      if (!obj || typeof obj !== "object" || prof > 6 || achados.length >= 20) return;
      for (const k of Object.keys(obj)) {
        const v = obj[k];
        const p = caminho ? `${caminho}.${k}` : k;
        if (/caption|transcript|subtitle/i.test(k)) {
          achados.push(`${p} = ${v && typeof v === "object" ? JSON.stringify(v).slice(0, 160) : v}`);
        }
        if (v && typeof v === "object") varrer(v, p, prof + 1);
      }
    })(json, "", 0);
    console.info(
      `${LOG} campos de legenda na listagem da coleção:`,
      achados.length ? achados : "nenhum — a listagem não diz nada sobre legendas"
    );
  }

  // Descarta um formato que se provou errado, para que o próximo "Baixar histórico" possa
  // ensinar o certo. Sem isso, um aprendizado ruim trava a função até fechar o Chrome.
  function esquecerLegenda(motivo) {
    if (!receitaLegenda) return;
    warn(
      `transcrição: descartei o formato aprendido (${motivo}). ` +
        'Use "Baixar histórico" no player de novo para eu reaprender.'
    );
    receitaLegenda = null;
    window.postMessage({ __sdv: true, type: "caption-forget" }, "*");
  }

  // Observa qualquer resposta que cheire a legenda, venha de onde vier.
  function observarLegenda(url, texto, req) {
    if (receitaLegenda) return; // já sabemos o formato
    if (!CAPTION_RE.test(url) && !pareceLegenda(texto)) return;
    if (!pareceLegenda(texto)) {
      // Visível sem ligar o modo de diagnóstico: é a pista de que o endereço foi achado
      // mas o formato da resposta é outro — exatamente o que precisamos saber para ajustar.
      console.info(
        `${LOG} transcrição: endereço parece de legenda, mas o conteúdo não foi reconhecido.`,
        { url, inicio: String(texto || "").slice(0, 200) }
      );
      return;
    }
    aprenderLegenda(url, req, texto);
  }

  // --- achar o arquivo de legenda de cada vídeo ---------------------------------
  // O endereço aprendido aponta para um ARQUIVO de legenda, cujo id não está no inventário.
  // Para servir os outros vídeos precisamos, antes, perguntar ao Studio quais legendas cada
  // vídeo tem. A rota disso não é documentada aqui, então testamos as formas usuais a partir
  // da base que já conhecemos e ficamos com a que responder — o próprio Studio confirma qual
  // é a certa, em vez de fixarmos um palpite no código.
  const captionFilePorVideo = new Map(); // mediaId -> id do arquivo de legenda
  let rotaDeLista = null; // molde da rota que funcionou, para reusar nos próximos vídeos

  // Diário do pedido em curso. Vai junto com a resposta ao painel, que o grava no arquivo de
  // diagnóstico: sem isso o que acontece aqui dentro do frame fica invisível.
  let diarioPedido = [];
  function anotar(linha) {
    diarioPedido.push(linha);
    console.info(`${LOG} ${linha}`);
  }

  // Cabeçalhos de uma chamada autenticada da SPA (os mesmos que a paginação da coleção já
  // reusa). A API do Studio autentica por cabeçalho: sem eles a rota existe mas responde
  // 401. O download do arquivo pronto aceita só o cookie — a API, não.
  let headersDaApi = null;

  function guardarHeadersDaApi(req) {
    if (headersDaApi) return;
    const h = (req && req.headers) || null;
    if (!h || !Object.keys(h).length) return;
    headersDaApi = h;
    console.info(`${LOG} cabeçalhos de sessão da API capturados (${Object.keys(h).length}).`);
    window.postMessage({ __sdv: true, type: "caption-api-pronta" }, "*");
  }

  function baseDaApi(template) {
    const m = String(template || "").match(/^(.*)\/caption_files\//);
    return m ? m[1] : null;
  }

  // A base da API deste Studio. Sai do molde quando há um; senão, do próprio host — o 401
  // (e não 404) nas rotas /api/media_management/… confirma que é esse o caminho.
  function baseProvavel() {
    return (
      baseDaApi(receitaLegenda && receitaLegenda.template) ||
      `${location.origin}/api/media_management`
    );
  }

  function candidatasDeLista(base, video) {
    const ids = {
      "{mediaId}": video.mediaId || "",
      "{launch}": video.ltiLaunchId || "",
      "{notorious}": video.notoriousId || "",
    };
    const moldes = rotaDeLista
      ? [rotaDeLista] // já sabemos qual funciona: não testamos as outras de novo
      : [
          `${base}/media/{mediaId}/caption_files`,
          `${base}/media/{notorious}/caption_files`,
          `${base}/media/{launch}/caption_files`,
          `${base}/caption_files?media_id={mediaId}`,
        ];
    const saida = [];
    for (const molde of moldes) {
      let url = molde;
      let completo = true;
      for (const [marca, valor] of Object.entries(ids)) {
        if (url.includes(marca)) {
          if (!valor) { completo = false; break; }
          url = url.split(marca).join(encodeURIComponent(valor));
        }
      }
      if (completo) saida.push({ molde, url });
    }
    return saida;
  }

  // Extrai o id do arquivo de legenda de uma resposta de listagem, sem depender do formato
  // exato: procuramos ids no mesmo padrão do que já vimos funcionar no download.
  // Se a resposta já traz o endereço do arquivo, usá-lo é melhor do que extrair um id e
  // remontar a URL: elimina o palpite sobre qual campo é o identificador certo.
  function acharUrlDeCaption(json) {
    let achada = null;
    (function varrer(o, prof) {
      if (achada || !o || typeof o !== "object" || prof > 6) return;
      if (Array.isArray(o)) {
        for (const item of o) varrer(item, prof + 1);
        return;
      }
      for (const k of Object.keys(o)) {
        const v = o[k];
        if (typeof v === "string" && /caption_files\/[^/\s"]+/.test(v)) {
          achada = v;
          return;
        }
        if (v && typeof v === "object") varrer(v, prof + 1);
      }
    })(json, 0);
    return achada;
  }

  function acharIdDeCaptionFile(json) {
    const fortes = []; // mesmo formato do id que o download usou: {uuid}-{media_id}
    const fracos = []; // id de um objeto que parece legenda, em outro formato
    const PISTAS = ["url", "language", "locale", "srclang", "kind", "status", "media_id"];

    (function varrer(o, prof) {
      if (!o || typeof o !== "object" || prof > 5) return;
      if (Array.isArray(o)) {
        for (const item of o) varrer(item, prof + 1);
        return;
      }
      const pareceLegenda = PISTAS.some((k) => k in o);
      for (const k of Object.keys(o)) {
        const v = o[k];
        if ((k === "id" || /caption_file_id$/i.test(k)) && (typeof v === "string" || typeof v === "number")) {
          const s = String(v);
          if (/^[0-9a-f-]{8,}-\d+$/i.test(s) && !idDeVideoConhecido(s)) fortes.push(s);
          else if (pareceLegenda) fracos.push(s);
        }
        if (v && typeof v === "object") varrer(v, prof + 1);
      }
    })(json, 0);

    return fortes[0] || fracos[0] || null;
  }

  async function descobrirCaptionFile(video) {
    const chave = String(video.mediaId || video.ltiLaunchId || "");
    if (captionFilePorVideo.has(chave)) return captionFilePorVideo.get(chave);

    const base = baseProvavel();
    if (!headersDaApi) {
      console.info(
        `${LOG} legenda: ainda não capturei os cabeçalhos da API do Studio — abra a grade da ` +
          "coleção uma vez para que a listagem passe por aqui."
      );
    }

    for (const { molde, url } of candidatasDeLista(base, video)) {
      try {
        // Os cabeçalhos da SPA são obrigatórios aqui: é a API, não o arquivo pronto.
        const res = await origFetch.call(window, url, {
          method: "GET",
          headers: Object.assign(
            { Accept: "application/json" },
            headersDaApi || (receitaLegenda && receitaLegenda.headers) || {}
          ),
          credentials: "include",
        });
        if (!res.ok) {
          // Visível sem ligar o diagnóstico: são no máximo quatro linhas, e são elas que
          // dizem qual rota existe nesta instância do Studio.
          anotar(`lista: ${res.status} em ${url}`);
          continue;
        }
        const corpo = await res.text();
        let json = null;
        try {
          json = JSON.parse(corpo);
        } catch {
          anotar(`lista: resposta não é JSON em ${url} :: ${corpo.slice(0, 150)}`);
          continue;
        }
        // O corpo vai para o diário mesmo quando dá certo: é ele que mostra qual campo é o
        // identificador de verdade, e foi a falta disso que fez o download tentar o id errado.
        anotar(`lista: 200 em ${url} :: ${corpo.slice(0, 500)}`);

        const urlDireta = acharUrlDeCaption(json);
        const id = acharIdDeCaptionFile(json);
        if (!urlDireta && !id) {
          anotar("lista: respondeu, mas não achei endereço nem id de legenda.");
          continue;
        }
        if (!rotaDeLista) {
          rotaDeLista = molde;
          anotar(`rota da lista descoberta → ${molde}`);
        }
        const escolhido = { id: id || null, url: urlDireta ? absUrl(urlDireta) : null };
        anotar(`lista: escolhido id=${escolhido.id || "—"} url=${escolhido.url || "—"}`);
        captionFilePorVideo.set(chave, escolhido);
        return escolhido;
      } catch (err) {
        anotar(`lista: falha de rede em ${url} :: ${err && err.message}`);
      }
    }
    anotar("nenhuma das rotas de lista serviu.");
    return null;
  }

  // `captionFileId` chega preenchido quando o endereço aprendido aponta para o arquivo de
  // legenda: aí o marcador do molde vale por ele, e não pelo identificador do vídeo.
  // O id do arquivo de legenda é `{uuid próprio}-{media_id}`: o uuid não se deriva do vídeo,
  // mas o SUFIXO é o media id. Então, quando um id desses passa em qualquer resposta do
  // Studio, sabemos exatamente a que vídeo pertence — e a chamada onde ele apareceu é a rota
  // que o entrega. É assim que descobrimos a rota sem precisar adivinhá-la.
  const RE_CAPTION_FILE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}-(\d+)$/i;

  function temInventario() {
    for (const s of stats.values()) if (s.videos.size) return true;
    return false;
  }

  function garimparCaptionFiles(url, json) {
    // Sem o inventário carregado não dá para separar o id da legenda do id do vídeo: tudo
    // pareceria "desconhecido". Garimpar aqui gravaria o id errado — foi o que aconteceu.
    if (!temInventario()) return;

    const achados = [];
    (function varrer(o, prof) {
      if (!o || typeof o !== "object" || prof > 6 || achados.length >= 30) return;
      for (const k of Object.keys(o)) {
        const v = o[k];
        if (typeof v === "string") {
          const m = v.match(RE_CAPTION_FILE);
          // Tem o formato e não é o identificador de nenhum vídeo: é arquivo de legenda.
          if (m && !idDeVideoConhecido(v)) achados.push({ campo: k, id: v, mediaId: m[1] });
        } else if (v && typeof v === "object") {
          varrer(v, prof + 1);
        }
      }
    })(json, 0);

    if (!achados.length) return;
    // Mesmo formato usado pela consulta à listagem: { id, url }.
    for (const a of achados) {
      if (!captionFilePorVideo.has(a.mediaId)) {
        captionFilePorVideo.set(a.mediaId, { id: a.id, url: null });
      }
    }
    console.info(`${LOG} legenda: ${achados.length} id(s) encontrados em ${url}`, achados);
    window.postMessage(
      {
        __sdv: true,
        type: "caption-files",
        origem: url,
        achados: achados.map((a) => ({ mediaId: a.mediaId, id: a.id })),
      },
      "*"
    );
  }

  function urlDaLegenda(video, captionFileId) {
    if (!receitaLegenda || !video) return null;
    const valores = captionFileId
      ? { "{launch}": captionFileId, "{notorious}": captionFileId, "{mediaId}": captionFileId }
      : {
          "{launch}": video.ltiLaunchId || "",
          "{notorious}": video.notoriousId || "",
          "{mediaId}": video.mediaId || "",
        };
    let url = receitaLegenda.template;
    for (const [marca, valor] of Object.entries(valores)) {
      if (url.includes(marca)) {
        if (!valor) return null; // falta o id que esta rota exige
        url = url.split(marca).join(encodeURIComponent(valor));
      }
    }
    return url;
  }

  // O painel pede a transcrição de um vídeo; quem busca é este frame, que tem a sessão.
  async function atenderPedidoLegenda(pedido, video) {
    diarioPedido = []; // cada pedido conta a sua própria história
    const responder = (resposta) =>
      window.postMessage(
        Object.assign(
          { __sdv: true, type: "caption-response", pedido, diario: diarioPedido.join("\n   ") },
          resposta
        ),
        "*"
      );

    anotar(
      `pedido: "${video && video.title}" mediaId=${video && video.mediaId} | ` +
        `cabeçalhos da API: ${headersDaApi ? "sim" : "NÃO"} | molde: ${receitaLegenda ? "sim" : "não"}`
    );

    // Basta ter os cabeçalhos da API: com eles dá para consultar a legenda de um vídeo e
    // montar o download, mesmo sem ninguém ter usado "Baixar histórico" antes.
    if (!receitaLegenda && !headersDaApi) {
      responder({ ok: false, erro: "ainda-nao-aprendido" });
      return;
    }

    // Agora sim: o id do endereço aprendido é de um vídeo ou do arquivo de legenda? Só o
    // inventário responde, e a esta altura ele já chegou.
    const ids = (receitaLegenda && receitaLegenda.ids) || [];
    // Sem molde, assumimos o caminho por arquivo de legenda: é o que o 401 das rotas
    // /api/media_management/... confirma existir nesta instância.
    const precisaDeCaptionFile = ids.length === 0 || !ids.some(idDeVideoConhecido);
    console.info(
      `${LOG} transcrição: o id do endereço aprendido é de ` +
        (precisaDeCaptionFile ? "ARQUIVO de legenda (vou procurar o do vídeo pedido)" : "VÍDEO"),
      ids
    );

    let captionFileId = null;
    if (precisaDeCaptionFile) {
      // O id do molde já é o arquivo de legenda de um vídeo: o sufixo diz de qual.
      for (const id of ids) {
        const m = String(id).match(/-(\d+)$/);
        if (m && !captionFilePorVideo.has(m[1])) {
          captionFilePorVideo.set(m[1], { id: String(id), url: null });
        }
      }
      captionFileId = await descobrirCaptionFile(video);
      if (!captionFileId) {
        responder({
          ok: false,
          erro:
            "Não consegui descobrir o arquivo de legenda deste vídeo. O Studio identifica a " +
            "transcrição por um id próprio, e não achei a rota que lista as legendas de um vídeo.",
        });
        return;
      }
    }

    // Preferimos o endereço que a própria listagem entregou; só montamos um quando ela não
    // veio com nenhum.
    const alvo = captionFileId
      ? captionFileId.url ||
        `${baseProvavel()}/caption_files/${encodeURIComponent(captionFileId.id)}`
      : urlDaLegenda(video, null);
    if (alvo) anotar(`download: ${alvo}`);
    if (!alvo) {
      responder({ ok: false, erro: "Este vídeo não tem o identificador que a rota de legenda exige." });
      return;
    }
    // O endereço original trazia um número solto na query. Tratei como cache-busting, mas
    // pode ser exigido — então, se a chamada limpa falhar, repetimos com ele.
    const tentativas = alvo.includes("?") ? [alvo] : [alvo, `${alvo}?${Date.now()}`];

    try {
      let res = null;
      for (const tentativa of tentativas) {
        res = await origFetch.call(window, tentativa, {
          method: "GET",
          headers: Object.assign(
            { Accept: "text/plain, text/vtt, */*" },
            (receitaLegenda && receitaLegenda.headers) || headersDaApi || {}
          ),
          credentials: "include",
        });
        if (res.ok) break;
        log(`transcrição: ${res.status} em ${tentativa}`);
      }
      if (!res.ok) {
        // Formato errado (aprendido de um link que não era a legenda, ou com o id trocado
        // errado): esquecemos, senão a extensão repetiria o mesmo erro para sempre. Mas se o
        // id do arquivo veio da rota de lista, o molde está certo e a falha é só deste vídeo.
        if (!captionFileId && (res.status === 404 || res.status === 401 || res.status === 403)) {
          esquecerLegenda(`o servidor respondeu ${res.status}`);
        }
        // Os dois ids lado a lado dizem na hora se o molde está errado ou se é o vídeo que
        // não tem aquela legenda — sem isso o 404 não explica nada.
        responder({
          ok: false,
          erro: `o Studio respondeu ${res.status}`,
          url: alvo,
          diagnostico:
            `id no molde: ${ids.join(", ") || "—"} | ` +
            `id deste vídeo: ${video.ltiLaunchId || video.mediaId || "—"} | ` +
            `arquivo de legenda: ${
              captionFileId ? captionFileId.id || captionFileId.url : "não consultado"
            }`,
        });
        return;
      }
      const texto = await res.text();
      if (!pareceLegenda(texto)) {
        esquecerLegenda("a resposta não era uma legenda");
        responder({ ok: false, erro: "o endereço respondeu, mas não com uma legenda", url: alvo });
        return;
      }
      responder({ ok: true, texto, url: alvo });
    } catch (err) {
      responder({ ok: false, erro: `falha de rede (${(err && err.message) || err})` });
    }
  }

  // Um download pode ser só um link: o navegador busca o arquivo sozinho, sem passar por
  // fetch nem XHR, e nesse caso nenhum interceptador acima veria a chamada. Então também
  // olhamos o clique — o endereço está no próprio link.
  function espiarClique(ev) {
    if (receitaLegenda) return;
    const alvo = ev.target;
    const a = alvo && alvo.closest && alvo.closest("a[href]");
    if (!a || !CAPTION_RE.test(a.href)) return;
    // Sem corpo para conferir aqui: aprendemos o formato e validamos no primeiro uso.
    console.info(`${LOG} transcrição: link de download visto no clique →`, a.href);
    aprenderLegenda(a.href, { headers: {}, credentials: "include" }, "");
  }
  document.addEventListener("click", espiarClique, true);

  // Alguns menus abrem o download em outra janela em vez de usar um link.
  const origOpen2 = window.open;
  if (typeof origOpen2 === "function") {
    window.open = function (url, ...resto) {
      try {
        if (!receitaLegenda && url && CAPTION_RE.test(String(url))) {
          console.info(`${LOG} transcrição: download aberto em nova janela →`, String(url));
          aprenderLegenda(absUrl(url), { headers: {}, credentials: "include" }, "");
        }
      } catch {}
      return origOpen2.apply(this, [url, ...resto]);
    };
  }

  window.addEventListener("message", (event) => {
    if (event.source !== window) return;
    const d = event.data;
    if (!d || d.__sdv !== true) return;
    if (d.type === "caption-request") atenderPedidoLegenda(d.pedido, d.video);
    if (d.type === "caption-probe") {
      window.postMessage(
        { __sdv: true, type: "caption-probe-reply", pedido: d.pedido, pronto: !!receitaLegenda },
        "*"
      );
    }
  });

  // Caso o Studio monte o arquivo no próprio navegador (Blob) em vez de baixá-lo de uma
  // rota: aqui não há requisição para aprender, mas o texto passa por aqui — então pelo
  // menos avisamos, para o diagnóstico não ficar cego.
  const origCreateObjectURL = URL.createObjectURL;
  if (typeof origCreateObjectURL === "function") {
    URL.createObjectURL = function (obj) {
      const url = origCreateObjectURL.apply(this, arguments);
      try {
        if (obj instanceof Blob && obj.size > 0 && obj.size < 8e6) {
          obj.text().then((t) => {
            if (!pareceLegenda(t)) return;
            console.info(
              `${LOG} transcrição gerada no próprio navegador (Blob de ${obj.size} bytes) — ` +
                "não há rota para repetir; o download em lote não vai funcionar nesta instância."
            );
            window.postMessage(
              { __sdv: true, type: "caption-blob", texto: t.slice(0, 400), bytes: obj.size },
              "*"
            );
          }).catch(() => {});
        }
      } catch {
        /* Blob exótico: ignora */
      }
      return url;
    };
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
          const legenda = !receitaLegenda && CAPTION_RE.test(url);
          if (isInteresting(url) || legenda) {
            // Captura como a SPA fez a chamada, para poder repeti-la nas outras páginas
            // (e, no caso da legenda, nos outros vídeos).
            const fromRequest = input && typeof input === "object" ? input : null;
            const req = {
              method: (init && init.method) || (fromRequest && fromRequest.method) || "GET",
              headers: headersToObject(
                (init && init.headers) || (fromRequest && fromRequest.headers)
              ),
              credentials:
                (init && init.credentials) || (fromRequest && fromRequest.credentials) || undefined,
            };
            res
              .clone()
              .text()
              .then((t) => {
                observarLegenda(url, t, req);
                if (isInteresting(url)) analyze(url, t, req);
              })
              .catch(() => {});
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
        const legenda = !receitaLegenda && CAPTION_RE.test(url);
        if ((isInteresting(url) || legenda) && typeof this.responseText === "string") {
          const req = {
            method: this.__sdvMethod || "GET",
            headers: this.__sdvHeaders || {},
            credentials: this.withCredentials ? "include" : "same-origin",
          };
          observarLegenda(url, this.responseText, req);
          if (isInteresting(url)) analyze(url, this.responseText, req);
        }
      } catch {}
    });
    return origSend.apply(this, args);
  };
})();
