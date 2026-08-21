// Setor de Vídeo — Canvas Studio · varredura dos módulos
// Lógica pura, sem UI e sem rede própria: quem chama injeta as funções de busca.
// Assim dá para testar o cruzamento sem depender do Canvas.
//
// Um vídeo do Studio pode chegar à página de duas maneiras, e elas geram HTML diferente:
//
//   a) "Adicionar item → Studio" (embed LTI): o `src` do iframe carrega
//      `custom_arc_media_id={uuid}-{media_id}` — ver docs/automacao-embed-studio-em-paginas.md §2.
//   b) Copiar o vídeo no Studio e colar na página (Ctrl+C / Ctrl+V): vira uma URL do Studio,
//      que carrega o `notorious_id` da mídia (`m-…`).
//
// Por isso a detecção NÃO depende de um formato específico: para cada vídeo do acervo,
// procuramos qualquer identificador conhecido dele (lti_launch_id ou notorious_id) dentro do
// HTML. Como esses identificadores são longos e únicos, achar um é prova de que o vídeo está
// ali, seja qual for a marcação em volta.

// Tipos de item de módulo que têm corpo de texto onde cabe um vídeo.
const SDV_TIPOS_COM_CORPO = {
  Page: (curso, item) => ({
    path: `/api/v1/courses/${curso}/pages/${encodeURIComponent(item.page_url || "")}`,
    campo: "body",
  }),
  Assignment: (curso, item) => ({
    path: `/api/v1/courses/${curso}/assignments/${item.content_id}`,
    campo: "description",
  }),
  Quiz: (curso, item) => ({
    path: `/api/v1/courses/${curso}/quizzes/${item.content_id}`,
    campo: "description",
  }),
  Discussion: (curso, item) => ({
    path: `/api/v1/courses/${curso}/discussion_topics/${item.content_id}`,
    campo: "message",
  }),
};

// As duas formas do HTML em que um vídeo do Studio se apresenta.
// O `notorious_id` só é aceito dentro de uma URL do Studio, para não confundir com
// qualquer texto solto que por acaso comece com "m-".
const SDV_PADROES = [
  { via: "embed", re: /custom_arc_media_id(?:=|%3D|%253D)([A-Za-z0-9-]+)/gi },
  {
    via: "link",
    re: /instructuremedia\.com\/[^"'\s<>]*?\b(m-[A-Za-z0-9_-]{20,})\b/gi,
  },
];

// Devolve as duas leituras do HTML: a original e a percent-decodificada (o `src` do embed
// guarda a URL de launch codificada).
function sdvVariantes(html) {
  const textos = [String(html || "")];
  try {
    const decodificado = decodeURIComponent(textos[0]);
    if (decodificado !== textos[0]) textos.push(decodificado);
  } catch {
    /* HTML com % solto quebra o decode: basta o texto original */
  }
  return textos;
}

// Índice do acervo, para resolver um identificador achado na página até o vídeo.
function sdvIndexar(videos) {
  const porNotorious = new Map();
  const porLaunch = new Map();
  const conhecidos = new Set();
  for (const v of videos || []) {
    const mid = v.mediaId != null ? String(v.mediaId) : null;
    if (!mid) continue;
    conhecidos.add(mid);
    if (v.notoriousId) porNotorious.set(String(v.notoriousId), mid);
    if (v.ltiLaunchId) porLaunch.set(String(v.ltiLaunchId), mid);
  }
  return { porNotorious, porLaunch, conhecidos, videos: videos || [] };
}

// Acha os vídeos do Studio presentes num HTML.
// Devolve Map(chave -> via), onde chave é o `media_id` quando dá para resolver,
// ou "?:<identificador>" quando o vídeo não está no acervo carregado.
function sdvAcharVideos(html, indice) {
  const achados = new Map();
  if (!html) return achados;
  const textos = sdvVariantes(html);

  // 1) Padrões conhecidos de marcação.
  for (const texto of textos) {
    for (const { via, re } of SDV_PADROES) {
      re.lastIndex = 0;
      let m;
      while ((m = re.exec(texto)) !== null) {
        const valor = m[1];
        let chave = null;
        if (via === "embed") {
          const num = valor.match(/(\d+)$/); // sufixo numérico do lti_launch_id = media.id
          chave = num ? num[1] : null;
          if (!chave && indice) chave = indice.porLaunch.get(valor) || null;
        } else {
          chave = (indice && indice.porNotorious.get(valor)) || null;
        }
        achados.set(chave || `?:${valor}`, via);
      }
    }
  }

  // 2) Busca direta pelos identificadores do acervo — pega qualquer marcação que os
  //    padrões acima não previram (vídeo colado de um jeito diferente, por exemplo).
  if (indice) {
    for (const v of indice.videos) {
      const mid = v.mediaId != null ? String(v.mediaId) : null;
      if (!mid || achados.has(mid)) continue;
      const chaves = [v.ltiLaunchId, v.notoriousId].filter(Boolean).map(String);
      if (!chaves.length) continue;
      if (textos.some((t) => chaves.some((k) => t.includes(k)))) achados.set(mid, "id");
    }
  }

  return achados;
}

// Percorre os módulos do curso e devolve onde cada vídeo aparece.
//   buscarLista(path) -> array já paginado
//   buscarUm(path)    -> objeto
//   videos            -> acervo do Studio (para resolver e para a busca direta)
async function sdvVarrerModulos({ courseId, buscarLista, buscarUm, videos, aoProgredir }) {
  const indice = sdvIndexar(videos);
  const ocorrencias = new Map(); // chave -> [{ modulo, titulo, tipo, url, via }]
  const erros = [];
  const cache = new Map(); // path -> Map(chave -> via), evita reler item repetido

  let modulos = [];
  try {
    modulos = await buscarLista(`/api/v1/courses/${courseId}/modules?include[]=items&per_page=50`);
  } catch (e) {
    throw new Error(`Não consegui listar os módulos do curso (${e.message || e}).`);
  }

  // Junta os itens de todos os módulos. Quando o Canvas omite `items` (módulo grande),
  // busca os itens daquele módulo à parte.
  const pendentes = [];
  for (const modulo of modulos) {
    let itens = Array.isArray(modulo.items) ? modulo.items : null;
    if (!itens) {
      try {
        itens = await buscarLista(`/api/v1/courses/${courseId}/modules/${modulo.id}/items?per_page=100`);
      } catch (e) {
        erros.push(`Módulo "${modulo.name || modulo.id}": ${e.message || e}`);
        continue;
      }
    }
    for (const item of itens) {
      if (SDV_TIPOS_COM_CORPO[item.type]) pendentes.push({ modulo, item });
    }
  }

  let feito = 0;
  for (const { modulo, item } of pendentes) {
    const alvo = SDV_TIPOS_COM_CORPO[item.type](courseId, item);
    feito += 1;
    if (aoProgredir) aoProgredir(feito, pendentes.length, item.title || item.type);

    let achados = cache.get(alvo.path);
    if (!achados) {
      try {
        const corpo = await buscarUm(alvo.path);
        achados = sdvAcharVideos(corpo && corpo[alvo.campo], indice);
      } catch (e) {
        erros.push(`${item.type} "${item.title || item.content_id}": ${e.message || e}`);
        achados = new Map();
      }
      cache.set(alvo.path, achados);
    }

    for (const [chave, via] of achados) {
      const lista = ocorrencias.get(chave) || [];
      lista.push({
        modulo: modulo.name || null,
        titulo: item.title || null,
        tipo: item.type,
        url: item.html_url || null,
        via, // "embed" (Adicionar item), "link" (colado) ou "id" (achado pelo identificador)
        // Estado de publicação no Canvas — informativo. NÃO entra na conta: um vídeo
        // dentro de um módulo despublicado continua sendo um vídeo que está na página.
        publicado: modulo.published !== false && item.published !== false,
      });
      ocorrencias.set(chave, lista);
    }
  }

  return { ocorrencias, erros, itensVarridos: pendentes.length, modulos: modulos.length };
}

// Cruza o inventário da coleção com o que foi achado nos módulos.
function sdvCruzar(videos, ocorrencias) {
  const usados = [];
  const naoUsados = [];

  for (const video of videos || []) {
    const mid = video.mediaId != null ? String(video.mediaId) : null;
    const locais = mid ? ocorrencias.get(mid) : null;
    if (locais && locais.length) usados.push(Object.assign({}, video, { locais }));
    else naoUsados.push(video);
  }

  // Vídeos que aparecem nas páginas mas não estão nesta coleção (outra coleção, por exemplo).
  const naColecao = new Set((videos || []).map((v) => String(v.mediaId)));
  const fora = [];
  for (const [chave, locais] of ocorrencias) {
    if (!naColecao.has(chave)) fora.push({ mediaId: chave.replace(/^\?:/, ""), locais });
  }

  const somar = (lista) =>
    lista.reduce((a, v) => a + (typeof v.duration === "number" && v.duration > 0 ? v.duration : 0), 0);

  // Quantos vídeos foram achados por cada caminho — ajuda a explicar o resultado.
  const porVia = { embed: 0, link: 0, id: 0 };
  for (const v of usados) {
    const vias = new Set(v.locais.map((l) => l.via));
    if (vias.has("embed")) porVia.embed += 1;
    else if (vias.has("link")) porVia.link += 1;
    else porVia.id += 1;
  }

  return {
    usados,
    naoUsados,
    fora,
    porVia,
    segUsados: somar(usados),
    segNaoUsados: somar(naoUsados),
    segTotal: somar(videos || []),
  };
}
