// Setor de Vídeo — Canvas Studio · painel lateral
// Mostra a coleção da aba atual e cruza o acervo do Studio com os módulos do curso,
// para saber quanto tempo de vídeo está realmente publicado nas páginas.
//
// Depende de ../src/format.js (sdvFormatDuration) e ../src/canvas-scan.js.

const content = document.getElementById("content");
let estado = {
  colecao: null, // resposta ao vivo do content script (quando o Studio está aberto)
  inventario: null, // { collectionId, videos, canvasDomain, canvasCourseId, ... }
  dominio: null,
  courseId: null,
  tabId: null,
  analise: null,
};

function esc(s) {
  return String(s).replace(/[&<>"]/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]
  ));
}

// --- APIs do Chrome em forma de promessa --------------------------------------
const abaAtiva = () =>
  new Promise((r) => chrome.tabs.query({ active: true, currentWindow: true }, (t) => r((t && t[0]) || null)));

const perguntarColecao = (tabId) =>
  new Promise((r) =>
    chrome.tabs.sendMessage(tabId, { type: "sdv-get-current" }, (resp) => {
      void chrome.runtime.lastError;
      r(resp || null);
    })
  );

const pedirInventario = (courseId, collectionId) =>
  new Promise((r) =>
    chrome.runtime.sendMessage(
      { type: "sdv-get-inventory", canvasCourseId: courseId, collectionId },
      (resp) => {
        void chrome.runtime.lastError;
        r((resp && resp.inventario) || null);
      }
    )
  );

const pedirAnalise = (courseId) =>
  new Promise((r) =>
    chrome.runtime.sendMessage({ type: "sdv-get-analysis", courseId }, (resp) => {
      void chrome.runtime.lastError;
      r((resp && resp.analise) || null);
    })
  );

function guardarAnalise() {
  if (!estado.analise || estado.analise.rodando || estado.analise.erro || !estado.courseId) return;
  try {
    chrome.runtime.sendMessage(
      {
        type: "sdv-analysis",
        data: Object.assign({}, estado.analise, {
          courseId: estado.courseId,
          collectionId: acervo().collectionId,
          studioDomain: estado.studioDomain,
          canvasDomain: estado.dominio,
        }),
      },
      () => void chrome.runtime.lastError
    );
  } catch {
    /* ignora */
  }
}

// Link para assistir ao vídeo. Usa o mesmo proxy de launch que o Canvas usa nos embeds
// (docs/automacao-embed-studio-em-paginas.md §2.3): quem assina a chamada LTI é o Canvas,
// no momento da abertura, então basta o media id — não precisa de token nem do id do tool.
function linkDoVideo(v) {
  const studio = estado.studioDomain || (estado.analise && estado.analise.studioDomain);
  const canvas = estado.dominio || (estado.analise && estado.analise.canvasDomain);
  const curso = estado.courseId;
  if (!studio || !canvas || !curso || !v || !v.ltiLaunchId) return null;
  const launch =
    `https://${studio}/lti/launch?custom_arc_launch_type=bare_embed` +
    `&custom_arc_media_id=${encodeURIComponent(v.ltiLaunchId)}&custom_arc_start_at=0`;
  return (
    `https://${canvas}/courses/${curso}/external_tools/retrieve` +
    `?display=borderless&url=${encodeURIComponent(launch)}`
  );
}

// O acervo pode vir de dois lugares. Com o Studio aberto na aba, a resposta ao vivo do
// content script é a fonte melhor (mais recente e sem depender de gravação); fora dele,
// vale o que ficou guardado na sessão.
function acervo() {
  const c = estado.colecao;
  if (c && Array.isArray(c.videos) && c.videos.length) {
    return { videos: c.videos, collectionId: c.id, aoVivo: true };
  }
  const inv = estado.inventario;
  if (inv && Array.isArray(inv.videos) && inv.videos.length) {
    return { videos: inv.videos, collectionId: inv.collectionId, aoVivo: false };
  }
  return { videos: [], collectionId: null, aoVivo: false };
}

// Injetada na página do Canvas: lê o link "Studio" da navegação do curso.
function acharLinkDoStudio() {
  const nav = document.querySelector("#section-tabs") || document;
  const links = Array.from(nav.querySelectorAll("a[href]"));
  const texto = (a) => (a.textContent || "").trim().toLowerCase();
  const alvo =
    links.find((a) => texto(a) === "studio") || links.find((a) => texto(a).includes("studio"));
  return alvo ? alvo.href : null;
}

// --- leitura da API do Canvas (sessão do usuário) -----------------------------
function proximoLink(cabecalho) {
  if (!cabecalho) return null;
  for (const parte of cabecalho.split(",")) {
    const m = parte.match(/<([^>]+)>\s*;\s*rel="?next"?/i);
    if (m) return m[1];
  }
  return null;
}

async function lerJson(res) {
  const texto = await res.text();
  // Algumas rotas do Canvas prefixam o JSON contra roubo de dados.
  return JSON.parse(texto.replace(/^while\(1\);\s*/, ""));
}

function urlBase() {
  return `https://${estado.dominio}`;
}

async function buscarUm(path) {
  const res = await fetch(urlBase() + path, {
    credentials: "include",
    headers: { Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return lerJson(res);
}

async function buscarLista(path) {
  const saida = [];
  let url = urlBase() + path;
  for (let i = 0; i < 40 && url; i++) {
    const res = await fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const parte = await lerJson(res);
    if (Array.isArray(parte)) saida.push(...parte);
    else saida.push(parte);
    url = proximoLink(res.headers.get("Link"));
  }
  return saida;
}

// --- blocos de tela -----------------------------------------------------------
function campo(rotulo, valor, classe = "") {
  return `<div class="field">
    <div class="label">${esc(rotulo)}</div>
    <div class="value ${classe}">${esc(valor)}</div>
  </div>`;
}

function linhaResumo(rotulo, numero, classe = "") {
  return `<div class="linha-resumo ${classe}">
    <span class="rot">${esc(rotulo)}</span><span class="num">${esc(numero)}</span>
  </div>`;
}

function textoDuracao(seg, completo = true) {
  const d = sdvFormatDuration(seg);
  if (!d) return "—";
  return completo ? d : `${d}+`;
}

function cartaoColecao() {
  const c = estado.colecao;
  const inv = estado.inventario;

  if (!c && !inv) {
    return `<div class="card">
      <h2>Coleção</h2>
      <p class="msg">Nenhuma coleção do Studio vista ainda nesta sessão.</p>
      <p class="hint">Abra o Studio do curso (botão abaixo) e deixe a biblioteca carregar —
      a extensão lê a lista e a duração de cada vídeo.</p>
    </div>`;
  }

  const id = c ? c.id : inv.collectionId;
  const total = c ? c.videoCount : inv.totalCount;
  const seg = c ? c.durationSec : (inv.videos || []).reduce((a, v) => a + (v.duration || 0), 0);
  const completo = c ? c.durationComplete : inv.complete;
  const curso = (c && c.courseName) || (inv && inv.courseName);
  const aoVivo = !!c;
  const dur = textoDuracao(seg, completo);
  const lendo = !seg && total == null;

  // Com a análise na tela, o cartão fica recolhido: o espaço é dos resultados.
  const aberto = !estado.analise;
  const resumo =
    `<span class="cid">Coleção ${esc(id)}</span>` +
    (total != null ? ` · ${esc(total)} vídeos` : "") +
    (dur !== "—" ? ` · ${esc(dur)}` : "") +
    (lendo ? ` · <span class="msg">lendo a biblioteca…</span>` : "");

  return `<details class="card" ${aberto ? "open" : ""}>
    <summary><span>${resumo}</span></summary>
    ${campo("ID da coleção (Studio)", id, "id")}
    ${total != null ? campo("Vídeos na coleção", total) : ""}
    ${campo("Duração total", dur, "dur")}
    ${curso ? campo("Disciplina", curso) : ""}
    ${!aoVivo ? `<p class="hint">Última coleção vista nesta sessão.</p>` : ""}
    ${
      lendo
        ? `<p class="hint">Esperando o Studio terminar de carregar a biblioteca. A duração
           aparece sozinha assim que a lista chegar.</p>`
        : !completo
        ? `<p class="hint">Soma parcial — veja o console do Studio para o motivo.</p>`
        : ""
    }
    <button class="acao secundaria" id="copiar" style="margin-top:8px">Copiar ID da coleção</button>
  </details>`;
}

function cartaoAcoes() {
  const temInventario = acervo().videos.length > 0;
  const temCurso = !!(estado.dominio && estado.courseId);
  return `<div class="card acoes">
    <button class="acao" id="abrir-studio" ${temCurso ? "" : "disabled"}>Abrir o Studio deste curso</button>
    <button class="acao ${temInventario && temCurso ? "" : "secundaria"}" id="analisar"
      ${temInventario && temCurso ? "" : "disabled"}>${
        estado.analise && estado.analise.resultado
          ? "Analisar módulos de novo"
          : "Analisar módulos do curso"
      }</button>
    ${
      // Com o resultado na tela as explicações saem de cena, para sobrar espaço.
      estado.analise && !estado.analise.rodando
        ? ""
        : !temCurso
        ? `<p class="hint">Abra uma página de um curso do Canvas para habilitar estas ações.</p>`
        : !temInventario
        ? `<p class="hint">Abra o Studio deste curso primeiro: a análise precisa saber quais
           vídeos existem e quanto dura cada um.</p>`
        : `<p class="hint">A análise lê as páginas, tarefas, quizzes e discussões dos módulos
           em segundo plano — nenhuma página é aberta na tela.</p>`
    }
  </div>`;
}

// Onde o vídeo aparece. Itens despublicados no Canvas ganham uma marca — eles contam
// como "usados" (o vídeo está lá), mas é bom você enxergar a diferença.
function ondeHtml(locais) {
  return (locais || [])
    .map((l) => {
      const nome = esc(l.titulo || l.tipo);
      const marca = l.publicado === false ? " <span class=\"sobra\">(não publicado)</span>" : "";
      return (
        (l.url
          ? `<a href="${esc(l.url)}" target="_blank" rel="noreferrer">${nome}</a>`
          : nome) + marca
      );
    })
    .join(" · ");
}

function listaVideos(videos, mostrarOnde, comTranscricao = false) {
  return `<ul class="videos">${videos
    .map((v) => {
      const dur = sdvFormatDuration(v.duration);
      const onde =
        mostrarOnde && v.locais ? `<div class="onde">${ondeHtml(v.locais)}</div>` : "";
      const link = linkDoVideo(v);
      const titulo = esc(v.title || "(sem título)");
      // Só os vídeos que estão nos módulos ganham o botão de transcrição.
      const baixar =
        comTranscricao && v.mediaId
          ? `<button class="tx" data-media="${esc(v.mediaId)}"
               title="Baixar a transcrição (o &quot;histórico&quot; do player)">📄</button>`
          : "";
      return `<li>
        <div class="vlinha">
          <div class="vt">${
            link
              ? `<a href="${esc(link)}" target="_blank" rel="noreferrer" title="Assistir no Studio">${titulo}</a>`
              : titulo
          }</div>
          ${baixar}
        </div>
        <div class="vd">${dur ? esc(dur) : "duração desconhecida"}</div>
        ${onde}
      </li>`;
    })
    .join("")}</ul>`;
}

// Vídeos achados nos módulos que não pertencem à coleção aberta. Mostramos o identificador
// e onde estão, para dar pistas de qual coleção abrir.
function listaFora(fora) {
  return `<ul class="videos">${fora
    .map(
      (f) => `<li>
        <div class="vt" style="font-family:ui-monospace,monospace;font-size:11px">${esc(f.mediaId)}</div>
        <div class="onde">${ondeHtml(f.locais)}</div>
      </li>`
    )
    .join("")}</ul>`;
}

function cartaoAnalise() {
  const a = estado.analise;
  if (!a) return "";
  if (a.rodando) {
    return `<div class="card">
      <h2>Analisando módulos</h2>
      <progress max="${a.total || 1}" value="${a.feito || 0}"></progress>
      <p class="hint">${esc(a.rotulo || "")} — ${a.feito || 0} de ${a.total || "?"} itens.</p>
    </div>`;
  }
  if (a.erro) {
    return `<div class="card"><h2>Análise dos módulos</h2>
      <p class="erro">${esc(a.erro)}</p></div>`;
  }

  const r = a.resultado;
  const totalVideos = r.usados.length + r.naoUsados.length;
  return `<div class="card">
    <h2>Análise dos módulos</h2>
    <div class="resumo">
      ${linhaResumo("Acervo da coleção", `${totalVideos} · ${textoDuracao(r.segTotal)}`)}
      ${linhaResumo(
        "Usados nos módulos",
        `${r.usados.length} · ${textoDuracao(r.segUsados)}`,
        "destaque"
      )}
      ${linhaResumo(
        "Sem uso nos módulos",
        `${r.naoUsados.length} · ${textoDuracao(r.segNaoUsados)}`,
        "sobra"
      )}
      ${r.fora.length ? linhaResumo("Nos módulos, de outra coleção", `${r.fora.length} vídeos`) : ""}
    </div>
    <p class="hint">"Usados" = o vídeo está dentro do conteúdo do item (página, tarefa, quiz ou
    discussão), esteja o módulo publicado ou não no Canvas.</p>
    <p class="hint">${
      a.at
        ? `Análise de ${new Date(a.at).toLocaleTimeString("pt-BR", {
            hour: "2-digit",
            minute: "2-digit",
          })}${a.collectionId ? `, cruzada com a coleção ${esc(a.collectionId)}` : ""}. `
        : ""
    }${a.itensVarridos} itens de ${a.modulos} módulos lidos.${
      r.porVia && (r.porVia.link || r.porVia.id)
        ? ` Dos publicados, ${r.porVia.embed} por "Adicionar item"` +
          (r.porVia.link ? `, ${r.porVia.link} colados na página` : "") +
          (r.porVia.id ? `, ${r.porVia.id} por outro formato` : "") +
          "."
        : ""
    }</p>

    ${
      // Transcrições de um módulo inteiro: o caso comum é querer tudo de uma unidade.
      modulosComVideos().length
        ? `<details><summary>Baixar transcrições por módulo</summary>
             <p class="hint">Baixa a transcrição de todos os vídeos daquele módulo, um arquivo
             .txt por vídeo.</p>
             <ul class="videos">${modulosComVideos()
               .map(
                 (m, i) => `<li>
                   <div class="vlinha">
                     <div class="vt">${esc(m.nome)}</div>
                     <button class="tx lote" data-modulo="${i}">📄 ${m.videos.length}</button>
                   </div>
                   <div class="vd">${m.videos.length} vídeo${m.videos.length === 1 ? "" : "s"} · ${esc(
                     textoDuracao(m.videos.reduce((a, v) => a + (v.duration || 0), 0))
                   )}</div>
                 </li>`
               )
               .join("")}</ul>
           </details>`
        : ""
    }
    ${
      r.usados.length
        ? `<details><summary>Ver os ${r.usados.length} publicados</summary>
             <p class="hint">📄 baixa a transcrição do vídeo (o "histórico" do menu ⋮ do player).</p>
             ${listaVideos(r.usados, true, true)}</details>`
        : ""
    }
    ${
      r.naoUsados.length
        ? `<details><summary>Ver os ${r.naoUsados.length} sem uso</summary>
             <p class="hint">📄 baixa a transcrição do vídeo (o "histórico" do menu ⋮ do player).</p>
             ${listaVideos(r.naoUsados, false, true)}</details>`
        : ""
    }
    ${
      r.fora.length
        ? `<details><summary>Ver os ${r.fora.length} de outra coleção</summary>
             <p class="hint">Estão nos módulos, mas não pertencem à coleção aberta — por isso
             não há duração para somar. Abra no Studio a coleção destes vídeos e rode a análise
             de novo para contabilizá-los.</p>
             ${listaFora(r.fora)}</details>`
        : ""
    }
    <button class="acao secundaria" id="baixar" style="margin-top:10px">Baixar planilha (.xlsx)</button>
    <p class="erro" id="aviso-tx" hidden></p>
    <button class="acao secundaria" id="diag" style="margin-top:6px">Salvar diagnóstico (.txt)</button>
    ${
      a.erros && a.erros.length
        ? `<details><summary>${a.erros.length} item(ns) não puderam ser lidos</summary>
             <ul class="videos">${a.erros.map((e) => `<li class="erro">${esc(e)}</li>`).join("")}</ul></details>`
        : ""
    }
  </div>`;
}

function desenhar() {
  content.innerHTML = cartaoColecao() + cartaoAcoes() + cartaoAnalise();

  const copiar = document.getElementById("copiar");
  if (copiar) {
    copiar.addEventListener("click", async () => {
      const id = estado.colecao ? estado.colecao.id : estado.inventario && estado.inventario.collectionId;
      if (!id) return;
      try {
        await navigator.clipboard.writeText(String(id));
        copiar.textContent = "✅ Copiado!";
        setTimeout(() => (copiar.textContent = "Copiar ID da coleção"), 1500);
      } catch {
        /* ignore */
      }
    });
  }

  const abrir = document.getElementById("abrir-studio");
  if (abrir) abrir.addEventListener("click", abrirStudio);

  const analisar = document.getElementById("analisar");
  if (analisar) analisar.addEventListener("click", aoClicarAnalisar);

  const baixar = document.getElementById("baixar");
  if (baixar) baixar.addEventListener("click", baixarPlanilha);

  const diag = document.getElementById("diag");
  if (diag) diag.addEventListener("click", salvarDiagnostico);

  for (const b of content.querySelectorAll("button.tx")) {
    b.addEventListener("click", () =>
      b.dataset.modulo != null
        ? baixarLoteDoModulo(Number(b.dataset.modulo), b)
        : baixarTranscricao(b.dataset.media, b)
    );
  }
}

// --- ações --------------------------------------------------------------------
async function abrirStudio() {
  const botao = document.getElementById("abrir-studio");
  if (!estado.tabId) return;
  botao.disabled = true;
  botao.textContent = "Procurando o Studio…";
  try {
    const saida = await chrome.scripting.executeScript({
      target: { tabId: estado.tabId },
      func: acharLinkDoStudio,
    });
    const destino = saida && saida[0] && saida[0].result;
    if (destino) {
      chrome.tabs.update(estado.tabId, { url: destino });
      botao.textContent = "Abrindo o Studio…";
      return;
    }
    botao.textContent = "Não achei o Studio na navegação";
  } catch {
    botao.textContent = "Sem acesso a esta aba — clique no ícone de novo";
  }
  setTimeout(() => {
    botao.disabled = false;
    botao.textContent = "Abrir o Studio deste curso";
  }, 2600);
}

// O pedido de permissão precisa sair direto do clique, sem `await` antes.
function aoClicarAnalisar() {
  const origem = `https://${estado.dominio}/*`;
  chrome.permissions.request({ origins: [origem] }, (concedida) => {
    if (!concedida) {
      estado.analise = {
        erro: "Sem permissão de acesso ao Canvas, não dá para ler os módulos. Clique de novo e escolha Permitir.",
      };
      desenhar();
      return;
    }
    analisar();
  });
}

async function analisar() {
  estado.analise = { rodando: true, feito: 0, total: 0, rotulo: "lendo os módulos" };
  desenhar();

  try {
    const varredura = await sdvVarrerModulos({
      courseId: estado.courseId,
      buscarLista,
      buscarUm,
      videos: acervo().videos, // permite achar o vídeo pelo identificador,
      // e não só pelo formato do embed (vídeo colado na página, por exemplo)
      aoProgredir: (feito, total, rotulo) => {
        estado.analise = { rodando: true, feito, total, rotulo };
        desenhar();
      },
    });
    const resultado = sdvCruzar(acervo().videos, varredura.ocorrencias);
    estado.analise = {
      resultado,
      erros: varredura.erros,
      itensVarridos: varredura.itensVarridos,
      modulos: varredura.modulos,
    };
  } catch (e) {
    estado.analise = { erro: String((e && e.message) || e) };
  }
  guardarAnalise(); // sobrevive à navegação: não se varre os módulos duas vezes
  desenhar();
}

// --- transcrição ("Baixar histórico" do player) --------------------------------
// A rota da legenda não é a mesma em toda instância do Studio, então não a chutamos:
// o net-hook aprende o formato na primeira vez que você usa "Baixar histórico" no
// player, e a partir daí o painel monta a chamada para os outros vídeos.

const pedirLegendaAoStudio = (tabId, video) =>
  new Promise((r) =>
    chrome.tabs.sendMessage(tabId, { type: "sdv-get-caption", video }, (resp) => {
      void chrome.runtime.lastError; // nenhum frame do Studio na aba: resp vem vazio
      r(resp || null);
    })
  );

const pedirReceitaLegenda = () =>
  new Promise((r) =>
    chrome.runtime.sendMessage({ type: "sdv-get-caption-endpoint" }, (resp) => {
      void chrome.runtime.lastError;
      r((resp && resp.receita) || null);
    })
  );

// Mesmo molde do net-hook (src/net-hook.js, urlDaLegenda). Vive nos dois lados porque o
// net-hook roda isolado no mundo principal da página e não compartilha código com o painel.
function montarUrlLegenda(template, video, captionFileId) {
  const valores = captionFileId
    ? { "{launch}": captionFileId, "{notorious}": captionFileId, "{mediaId}": captionFileId }
    : {
        "{launch}": video.ltiLaunchId || "",
        "{notorious}": video.notoriousId || "",
        "{mediaId}": video.mediaId || "",
      };
  let url = String(template || "");
  for (const [marca, valor] of Object.entries(valores)) {
    if (url.includes(marca)) {
      if (!valor) return null;
      url = url.split(marca).join(encodeURIComponent(valor));
    }
  }
  return url;
}

// --- diário de diagnóstico ----------------------------------------------------
// Cada tentativa fica registrada aqui e pode ser salva em .txt. É o que permite
// investigar sem depender de ler o console: o arquivo conta a história inteira.
// Só entram endereços, códigos de resposta e trechos do corpo — nunca cabeçalhos,
// que são o que carrega a sessão.
const diario = [];
function registrar(linha) {
  const marca = new Date().toLocaleTimeString("pt-BR");
  diario.push(`[${marca}] ${linha}`);
  console.info("[SDV painel]", linha);
}

function textoDoDiagnostico() {
  const a = acervo();
  const partes = [
    "Setor de Vídeo — diagnóstico da transcrição",
    `Gerado em: ${new Date().toLocaleString("pt-BR")}`,
    `Canvas: ${estado.dominio || "—"} | curso: ${estado.courseId || "—"}`,
    `Studio: ${estado.studioDomain || "—"} | coleção: ${a.collectionId || "—"}`,
    "",
    `Acervo conhecido: ${a.videos.length} vídeo(s)`,
    ...a.videos.map(
      (v) =>
        `  - ${v.title || "(sem título)"} | mediaId=${v.mediaId || "—"} | ` +
        `launch=${v.ltiLaunchId || "—"} | notorious=${v.notoriousId || "—"}`
    ),
    "",
    "Tentativas:",
    ...(diario.length ? diario : ["  (nenhuma ainda — clique num 📄 antes de salvar)"]),
  ];
  return partes.join("\n");
}

async function salvarDiagnostico() {
  const botao = document.getElementById("diag");
  try {
    // O mapa entra no relatório com a origem de cada id: é ela que diz qual chamada do
    // Studio entrega a legenda, e portanto se o download em lote é possível.
    const mapa = await pedirCaptionFiles();
    const linhas = Object.entries(mapa).map(([mediaId, v]) =>
      typeof v === "object"
        ? `  mediaId ${mediaId} -> ${v.id} (de: ${v.origem || "?"})`
        : `  mediaId ${mediaId} -> ${v}`
    );
    const extra = [
      "",
      `Arquivos de legenda conhecidos: ${linhas.length}`,
      ...(linhas.length ? linhas : ["  (nenhum)"]),
    ].join("\n");

    await baixarBlob(
      new Blob([textoDoDiagnostico() + extra], { type: "text/plain;charset=utf-8" }),
      "sdv-diagnostico-transcricao.txt"
    );
    if (botao) {
      botao.textContent = "✅ Diagnóstico salvo";
      setTimeout(() => (botao.textContent = "Salvar diagnóstico (.txt)"), 2500);
    }
  } catch {
    if (botao) botao.textContent = "Falha ao salvar";
  }
}

// --- achar o arquivo de legenda, pelo próprio painel --------------------------
// Espelha o que o net-hook faz dentro do frame do Studio (src/net-hook.js). Vive aqui
// também porque este é o caminho usado quando o frame não responde — e era justamente
// nele que a busca não acontecia.
function baseDaApi(template) {
  const m = String(template || "").match(/^(.*)\/caption_files\//);
  return m ? m[1] : null;
}

function idDeVideoDoAcervo(valor) {
  const alvo = String(valor);
  return acervo().videos.some(
    (v) => v.ltiLaunchId === alvo || v.notoriousId === alvo || String(v.mediaId) === alvo
  );
}

function acharIdDeCaptionFile(json) {
  const fortes = [];
  const fracos = [];
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
        if (/^[0-9a-f-]{8,}-\d+$/i.test(s) && !idDeVideoDoAcervo(s)) fortes.push(s);
        else if (pareceLegenda) fracos.push(s);
      }
      if (v && typeof v === "object") varrer(v, prof + 1);
    }
  })(json, 0);

  return fortes[0] || fracos[0] || null;
}

let rotaDeListaPainel = null; // molde que funcionou, reusado nos próximos vídeos

async function descobrirCaptionFile(video, base) {
  const ids = {
    "{mediaId}": video.mediaId || "",
    "{notorious}": video.notoriousId || "",
    "{launch}": video.ltiLaunchId || "",
  };
  const moldes = rotaDeListaPainel
    ? [rotaDeListaPainel]
    : [
        // O prefixo /media/{mediaId}/… existe nesta instância (vimos `annotation_sets` nela),
        // então é por aqui que a legenda tem mais chance de estar. Os detalhes do vídeo
        // entram na lista porque costumam trazer os arquivos de legenda embutidos.
        `${base}/media/{mediaId}/caption_files`,
        `${base}/media/{mediaId}`,
        `${base}/media/{mediaId}/captions`,
        `${base}/media/{notorious}/caption_files`,
        `${base}/media/{launch}/caption_files`,
        `${base}/caption_files?media_id={mediaId}`,
      ];

  for (const molde of moldes) {
    let url = molde;
    let completo = true;
    for (const [marca, valor] of Object.entries(ids)) {
      if (url.includes(marca)) {
        if (!valor) {
          completo = false;
          break;
        }
        url = url.split(marca).join(encodeURIComponent(valor));
      }
    }
    if (!completo) continue;

    try {
      const res = await fetch(url, { credentials: "include", headers: { Accept: "application/json" } });
      if (!res.ok) {
        registrar(`lista de legendas: ${res.status} em ${url}`);
        continue;
      }
      const corpo = await res.text();
      let json = null;
      try {
        json = JSON.parse(corpo);
      } catch {
        registrar(`lista de legendas: resposta não é JSON em ${url} :: ${corpo.slice(0, 200)}`);
        continue;
      }
      const id = acharIdDeCaptionFile(json);
      if (!id) {
        registrar(`lista de legendas: 200 em ${url}, sem id reconhecível :: ${corpo.slice(0, 400)}`);
        continue;
      }
      rotaDeListaPainel = molde;
      registrar(`rota da lista de legendas descoberta → ${molde}`);
      return id;
    } catch (err) {
      registrar(`lista de legendas: falha de rede em ${url} :: ${err && err.message}`);
    }
  }
  registrar("nenhuma das rotas de lista de legendas serviu.");
  return null;
}

const SEM_ROTA =
  'Ainda não sei como o Studio entrega a transcrição. Abra um vídeo no Studio e use uma vez ' +
  'o ⋮ → "Baixar histórico": a extensão aprende o caminho e passa a baixar as outras sozinha.';

// Duas tentativas, nesta ordem: o frame do Studio aberto na aba (tem a sessão em memória)
// e, se não houver, a chamada direta com o molde aprendido.
const pedirCaptionFiles = () =>
  new Promise((r) =>
    chrome.runtime.sendMessage({ type: "sdv-get-caption-files" }, (resp) => {
      void chrome.runtime.lastError;
      r((resp && resp.mapa) || {});
    })
  );

const esquecerReceita = () =>
  new Promise((r) =>
    chrome.runtime.sendMessage({ type: "sdv-caption-forget" }, () => {
      void chrome.runtime.lastError;
      r();
    })
  );

// Erro que carrega o endereço tentado — sem ele não dá para saber se o molde aprendido
// está errado ou se é o vídeo que não tem legenda.
function erroComUrl(mensagem, url) {
  const e = new Error(mensagem);
  e.url = url || null;
  return e;
}

async function buscarTranscricao(video) {
  registrar(`--- "${video.title || video.mediaId}" ---`);

  if (estado.tabId != null) {
    const r = await pedirLegendaAoStudio(estado.tabId, video);
    registrar(
      r
        ? `frame do Studio respondeu: ok=${!!r.ok} erro=${r.erro || "—"}` +
            (r.diario ? `\n   ${r.diario}` : "")
        : "frame do Studio não respondeu (sigo pela chamada direta)"
    );
    if (r && r.ok && r.texto) return r.texto;
    if (r && r.erro && r.erro !== "ainda-nao-aprendido") {
      throw erroComUrl(r.erro, [r.url, r.diagnostico].filter(Boolean).join("\n"));
    }
  }

  const receita = await pedirReceitaLegenda();
  registrar(receita ? "molde recuperado da sessão" : "nenhum molde guardado");
  if (!receita) throw new Error(SEM_ROTA);
  if (receita.inutil) {
    throw erroComUrl(
      "O Studio entrega a transcrição por um endereço que identifica o arquivo de legenda, " +
        "não o vídeo. Com isso não dá para montar o endereço dos outros vídeos — só funcionaria " +
        "abrindo cada vídeo no player. É uma limitação do Studio, não um erro da extensão.",
      receita.template
    );
  }

  // O id do molde é de um vídeo ou do arquivo de legenda? Se for do arquivo, primeiro
  // perguntamos ao Studio qual é a legenda deste vídeo.
  const idsDoMolde = receita.ids || [];
  const precisaDeCaptionFile = idsDoMolde.length > 0 && !idsDoMolde.some(idDeVideoDoAcervo);
  registrar(
    `molde: ${receita.template}\nid do molde: ${idsDoMolde.join(", ") || "—"}\n` +
      `id deste vídeo: ${video.ltiLaunchId || video.mediaId || "—"}\n` +
      `o id do molde é de: ${precisaDeCaptionFile ? "ARQUIVO de legenda" : "VÍDEO"}`
  );

  let captionFileId = null;
  if (precisaDeCaptionFile) {
    // 1) O id do próprio molde. Ele veio de um download que funcionou de verdade, e o
    // sufixo diz a que vídeo pertence — é a fonte mais confiável que existe aqui.
    const doMolde = idsDoMolde.find((id) => String(id).endsWith(`-${video.mediaId}`));
    if (doMolde) {
      captionFileId = doMolde;
      registrar(`arquivo de legenda pelo molde aprendido: ${doMolde}`);
    }

    // 2) O que já foi visto passar nas respostas do Studio. Descartamos o que for
    // identificador de vídeo: isso é lixo colhido antes de o inventário chegar, e foi
    // exatamente o que fez o download tentar o id errado.
    if (!captionFileId) {
      const mapa = await pedirCaptionFiles();
      const entrada = mapa[String(video.mediaId)] || null;
      const guardado = entrada && typeof entrada === "object" ? entrada.id : entrada;
      const origem = entrada && typeof entrada === "object" ? entrada.origem : null;

      if (guardado && idDeVideoDoAcervo(guardado)) {
        registrar(`ignorando id guardado (é o identificador do vídeo, não da legenda): ${guardado}`);
      } else if (guardado) {
        captionFileId = guardado;
        registrar(`arquivo de legenda já conhecido: ${guardado}${origem ? ` (veio de: ${origem})` : ""}`);
      } else {
        registrar(`arquivo de legenda ainda não visto (mapa tem ${Object.keys(mapa).length} vídeo(s))`);
      }
    }

    if (!captionFileId) {
      const base = baseDaApi(receita.template);
      captionFileId = base ? await descobrirCaptionFile(video, base) : null;
    }
    if (!captionFileId) {
      throw erroComUrl(
        "Não consegui descobrir o arquivo de legenda deste vídeo: o Studio identifica a " +
          "transcrição por um id próprio e nenhuma das rotas conhecidas respondeu. " +
          'Use "Salvar diagnóstico" e me mande o arquivo.',
        receita.template
      );
    }
  }

  const url = montarUrlLegenda(receita.template, video, captionFileId);
  if (!url) throw new Error("Este vídeo não tem o identificador que a rota de legenda exige.");

  const res = await fetch(url, {
    credentials: "include",
    headers: { Accept: "text/vtt, text/plain, */*" },
  });
  registrar(`download: ${res.status} em ${url}`);
  if (!res.ok) {
    // Molde errado: apaga, para que o próximo "Baixar histórico" ensine o certo.
    if (res.status === 404 || res.status === 401 || res.status === 403) await esquecerReceita();
    throw erroComUrl(
      res.status === 401 || res.status === 403
        ? "O Studio recusou a chamada (sessão). Abra o Studio do curso e tente de novo."
        : `O Studio respondeu ${res.status}.`,
      url
    );
  }
  return res.text();
}

// VTT/SRT -> texto corrido. Tira numeração, marcações de tempo e as tags do VTT; a
// legenda rolante repete a mesma linha em blocos seguidos, então a deduplicamos em sequência.
// Algumas instâncias entregam a legenda como JSON (lista de trechos) em vez de VTT/SRT.
function transcricaoDeJson(texto) {
  let dados;
  try {
    dados = JSON.parse(texto);
  } catch {
    return null;
  }
  // Procura o array de trechos pela FORMA, não pelo nome do campo: o Studio usa
  // `caption_file.sequences`, mas outra instância pode chamar de outra coisa. O que
  // identifica a lista é ser um array de objetos com texto.
  const falaDe = (t) =>
    t && typeof t === "object" ? t.text ?? t.content ?? t.caption ?? t.body ?? null : null;

  let lista = null;
  (function varrer(o, prof) {
    if (lista || !o || typeof o !== "object" || prof > 6) return;
    if (Array.isArray(o)) {
      if (o.length && o.every((item) => falaDe(item) != null)) {
        lista = o;
        return;
      }
      for (const item of o) varrer(item, prof + 1);
      return;
    }
    for (const k of Object.keys(o)) varrer(o[k], prof + 1);
  })(dados, 0);

  if (!Array.isArray(lista)) return null;

  const falas = [];
  let anterior = null;
  for (const trecho of lista) {
    // Os trechos quebram a frase no meio e trazem quebras de linha internas: normalizar
    // aqui é o que devolve o texto corrido, igual ao que o player entrega.
    const fala = String(falaDe(trecho) || "").replace(/\s+/g, " ").trim();
    if (!fala || fala === anterior) continue;
    falas.push(fala);
    anterior = fala;
  }
  if (!falas.length) return null;
  return falas.join(" ").replace(/\s{2,}/g, " ").replace(/([.!?])\s+/g, "$1\n").trim();
}

function transcricaoEmTexto(bruto) {
  const cru = String(bruto || "").trim();
  if (cru.startsWith("{") || cru.startsWith("[")) {
    const doJson = transcricaoDeJson(cru);
    if (doJson) return doJson;
  }

  const saida = [];
  let anterior = null;
  for (const linhaBruta of String(bruto || "").replace(/\r/g, "").split("\n")) {
    let linha = linhaBruta.trim();
    if (!linha) continue;
    if (/^WEBVTT/i.test(linha)) continue;
    if (/^(NOTE|STYLE|REGION)\b/i.test(linha)) continue;
    if (/^\d+$/.test(linha)) continue; // numeração do bloco no SRT
    if (linha.includes("-->")) continue; // marcação de tempo
    linha = linha.replace(/<[^>]+>/g, "").trim(); // tags de realce do VTT
    if (!linha || linha === anterior) continue;
    saida.push(linha);
    anterior = linha;
  }
  // Uma frase por linha lê melhor num .txt do que um parágrafo único.
  return saida.join(" ").replace(/\s{2,}/g, " ").replace(/([.!?])\s+/g, "$1\n").trim();
}

// Busca, converte e grava a transcrição de um vídeo. Compartilhada pelo botão de cada
// vídeo e pelo download em lote de um módulo.
async function gravarTranscricao(video) {
  const bruto = await buscarTranscricao(video);
  const texto = transcricaoEmTexto(bruto);
  if (!texto) throw new Error("A transcrição veio vazia — o vídeo pode não ter legenda.");

  const cabecalho =
    `${video.title || "(sem título)"}\n` +
    `Duração: ${sdvFormatRelogio(video.duration)}\n` +
    `ID da mídia: ${video.mediaId}\n` +
    "".padEnd(60, "-") + "\n\n";

  await baixarBlob(
    new Blob([cabecalho + texto], { type: "text/plain;charset=utf-8" }),
    `transcricao-${slug(video.title || video.mediaId)}.txt`
  );
}

// Os módulos do curso e os vídeos de cada um. Um vídeo que aparece em dois módulos entra
// nos dois; dentro de um módulo ele entra uma vez só.
function modulosComVideos() {
  const r = estado.analise && estado.analise.resultado;
  if (!r) return [];
  const porModulo = new Map();
  for (const video of r.usados) {
    for (const nome of new Set((video.locais || []).map((l) => l.modulo || "(sem módulo)"))) {
      if (!porModulo.has(nome)) porModulo.set(nome, []);
      const lista = porModulo.get(nome);
      if (!lista.some((v) => String(v.mediaId) === String(video.mediaId))) lista.push(video);
    }
  }
  return [...porModulo.entries()].map(([nome, videos]) => ({ nome, videos }));
}

async function baixarLoteDoModulo(indice, botao) {
  const modulo = modulosComVideos()[indice];
  if (!modulo) return;

  const rotulo = botao.textContent;
  botao.disabled = true;
  mostrarAvisoTranscricao("");
  registrar(`=== lote do módulo "${modulo.nome}" (${modulo.videos.length} vídeo(s)) ===`);

  const falhas = [];
  for (let i = 0; i < modulo.videos.length; i++) {
    const video = modulo.videos[i];
    botao.textContent = `Baixando ${i + 1} de ${modulo.videos.length}…`;
    try {
      await gravarTranscricao(video);
    } catch (e) {
      falhas.push(`${video.title || video.mediaId}: ${(e && e.message) || e}`);
    }
    // Uma pausa curta entre downloads: o Chrome bloqueia rajadas de gravação.
    if (i < modulo.videos.length - 1) await new Promise((r) => setTimeout(r, 400));
  }

  const ok = modulo.videos.length - falhas.length;
  botao.textContent = falhas.length ? `${ok} de ${modulo.videos.length} baixados` : `✅ ${ok} baixados`;
  if (falhas.length) mostrarAvisoTranscricao(`Não deu para baixar: ${falhas.join(" · ")}`);
  setTimeout(() => {
    botao.textContent = rotulo;
    botao.disabled = false;
  }, 4000);
}

async function baixarTranscricao(mediaId, botao) {
  const r = estado.analise && estado.analise.resultado;
  // Os dois grupos: o botão existe nas duas listas, e a transcrição de um vídeo não depende
  // de ele estar num módulo. Procurar só em `usados` fazia o clique não fazer nada.
  const video =
    r && [...r.usados, ...r.naoUsados].find((v) => String(v.mediaId) === String(mediaId));
  if (!video) return;

  const original = botao.textContent;
  botao.disabled = true;
  botao.textContent = "…";
  mostrarAvisoTranscricao(""); // o erro anterior não vale mais para esta tentativa

  try {
    await gravarTranscricao(video);
    botao.textContent = "✅";
    setTimeout(() => {
      botao.textContent = original;
      botao.disabled = false;
    }, 2000);
  } catch (e) {
    const mensagem = String((e && e.message) || e);
    botao.textContent = "⚠️";
    botao.disabled = false;
    botao.title = mensagem;
    mostrarAvisoTranscricao(mensagem, e && e.url);
    setTimeout(() => (botao.textContent = original), 3000);
  }
}

// Um aviso só, no rodapé do cartão da análise — a mensagem que explica como ensinar a
// rota à extensão é longa demais para caber num tooltip.
function mostrarAvisoTranscricao(texto, url) {
  const caixa = document.getElementById("aviso-tx");
  if (!caixa) return;
  caixa.textContent = "";
  caixa.hidden = !texto;
  if (!texto) return;

  caixa.append(texto);
  // O endereço tentado é a informação que resolve o diagnóstico: mostra se o molde
  // aprendido está errado ou se é o vídeo que não tem legenda.
  if (url) {
    const linha = document.createElement("span");
    linha.className = "url-tentada";
    linha.textContent = url; // pode trazer o endereço e, abaixo, a comparação dos ids
    caixa.append(document.createElement("br"), "Endereço tentado:", document.createElement("br"), linha);
  }
}

// --- exportação para Excel ----------------------------------------------------
const unicos = (lista) => Array.from(new Set(lista.filter(Boolean)));
const minutos = (seg) => Math.round(((Number(seg) || 0) / 60) * 10) / 10;

const ROTULO_VIA = { embed: "Adicionar item", link: "Colado na página", id: "Outro formato" };

function situacaoPublicado(locais) {
  const estados = (locais || []).map((l) => l.publicado !== false);
  if (!estados.length) return "";
  if (estados.every(Boolean)) return "Sim";
  if (estados.every((e) => !e)) return "Não";
  return "Parcial";
}

function abasDaPlanilha(r) {
  const alocados = r.usados.map((v) => [
    v.title || "(sem título)",
    sdvFormatRelogio(v.duration),
    minutos(v.duration),
    unicos((v.locais || []).map((l) => l.titulo || l.tipo)).join(" | "),
    unicos((v.locais || []).map((l) => l.modulo)).join(" | "),
    unicos((v.locais || []).map((l) => l.tipo)).join(" | "),
    unicos((v.locais || []).map((l) => ROTULO_VIA[l.via] || l.via)).join(" | "),
    situacaoPublicado(v.locais),
    v.mediaId || "",
  ]);
  alocados.push([
    `TOTAL — ${r.usados.length} vídeo${r.usados.length === 1 ? "" : "s"}`,
    sdvFormatRelogio(r.segUsados),
    minutos(r.segUsados),
    "", "", "", "", "", "",
  ]);

  const naoAlocados = r.naoUsados.map((v) => [
    v.title || "(sem título)",
    sdvFormatRelogio(v.duration),
    minutos(v.duration),
    v.mediaId || "",
  ]);
  naoAlocados.push([
    `TOTAL — ${r.naoUsados.length} vídeo${r.naoUsados.length === 1 ? "" : "s"}`,
    sdvFormatRelogio(r.segNaoUsados),
    minutos(r.segNaoUsados),
    "",
  ]);

  return [
    {
      nome: "Vídeos alocados",
      negritoUltima: true,
      colunas: [
        { titulo: "Vídeo", largura: 46 },
        { titulo: "Duração", largura: 11 },
        { titulo: "Minutos", largura: 10 },
        { titulo: "Onde está (item)", largura: 40 },
        { titulo: "Módulo", largura: 30 },
        { titulo: "Tipo do item", largura: 14 },
        { titulo: "Como foi inserido", largura: 20 },
        { titulo: "Item publicado", largura: 14 },
        { titulo: "ID da mídia", largura: 14 },
      ],
      linhas: alocados,
    },
    {
      nome: "Vídeos não alocados",
      negritoUltima: true,
      colunas: [
        { titulo: "Vídeo", largura: 46 },
        { titulo: "Duração", largura: 11 },
        { titulo: "Minutos", largura: 10 },
        { titulo: "ID da mídia", largura: 14 },
      ],
      linhas: naoAlocados,
    },
  ];
}

// Texto -> peda\u00e7o seguro de nome de arquivo (sem acento, sem espa\u00e7o, sem barra).
function slug(texto, max = 48) {
  const limpo = String(texto || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^A-Za-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase();
  if (limpo.length <= max) return limpo || "sem-nome";
  // Corta no \u00faltimo h\u00edfen antes do limite: nome truncado no meio da palavra fica ileg\u00edvel.
  const cortado = limpo.slice(0, max);
  const ultimo = cortado.lastIndexOf("-");
  return (ultimo > max * 0.6 ? cortado.slice(0, ultimo) : cortado) || "sem-nome";
}

// Entrega o arquivo ao usu\u00e1rio. Usa chrome.downloads quando h\u00e1 permiss\u00e3o; numa p\u00e1gina de
// extens\u00e3o a \u00e2ncora comum tamb\u00e9m resolve.
async function baixarBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  try {
    if (chrome.downloads && chrome.downloads.download) {
      await chrome.downloads.download({ url, filename });
    } else {
      const a = document.createElement("a");
      a.href = url;
      a.download = filename;
      a.click();
    }
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  }
}

function nomeDoArquivo() {
  const curso =
    (estado.colecao && estado.colecao.courseName) ||
    (estado.inventario && estado.inventario.courseName) ||
    estado.courseId ||
    "curso";
  const hoje = new Date().toISOString().slice(0, 10);
  return `videos-${slug(curso)}-${hoje}.xlsx`;
}

async function baixarPlanilha() {
  const botao = document.getElementById("baixar");
  const r = estado.analise && estado.analise.resultado;
  if (!r) return;

  try {
    await baixarBlob(sdvGerarXlsx(abasDaPlanilha(r)), nomeDoArquivo());
    if (botao) {
      botao.textContent = "✅ Planilha baixada";
      setTimeout(() => (botao.textContent = "Baixar planilha (.xlsx)"), 2500);
    }
  } catch (e) {
    if (botao) botao.textContent = "Falha ao gerar a planilha";
  }
}

// --- carga --------------------------------------------------------------------
async function carregar() {
  const aba = await abaAtiva();
  estado.tabId = aba && aba.id != null ? aba.id : null;
  estado.colecao = null;
  estado.dominio = null;
  estado.courseId = null;
  estado.studioDomain = null;

  const url = (aba && aba.url) || "";
  const m = url.match(/^https:\/\/([^/]+)\/courses\/(\d+)/);
  if (m) {
    estado.dominio = m[1];
    estado.courseId = m[2];
  }

  if (estado.tabId != null) {
    const resp = await perguntarColecao(estado.tabId);
    if (resp && resp.id) {
      estado.colecao = resp;
      if (!estado.dominio && resp.canvasDomain) estado.dominio = resp.canvasDomain;
      if (!estado.courseId && resp.canvasCourseId) estado.courseId = String(resp.canvasCourseId);
      if (resp.studioDomain) estado.studioDomain = resp.studioDomain;
    }
  }

  // Passa também a coleção aberta: se o `lti_course_id` do Studio não casar com o curso da
  // URL, o acervo ainda é encontrado pela coleção.
  estado.inventario = await pedirInventario(
    estado.courseId,
    estado.colecao ? estado.colecao.id : undefined
  );
  if (estado.inventario) {
    if (!estado.dominio && estado.inventario.canvasDomain) estado.dominio = estado.inventario.canvasDomain;
    if (!estado.courseId && estado.inventario.canvasCourseId) {
      estado.courseId = String(estado.inventario.canvasCourseId);
    }
    if (!estado.studioDomain && estado.inventario.studioDomain) {
      estado.studioDomain = estado.inventario.studioDomain;
    }
  }

  // Recupera a análise já feita deste curso: trocar de página não pode obrigar a varrer
  // os módulos de novo.
  if (!estado.analise && estado.courseId) {
    const guardada = await pedirAnalise(estado.courseId);
    if (guardada) estado.analise = guardada;
  }

  desenhar();
}

// Recarrega quando o contexto muda. `onActivated` cobre a troca de aba; `onUpdated` cobre a
// navegação DENTRO da mesma aba — é o caso de trocar de disciplina pelo menu do Canvas, que
// antes deixava o painel exibindo os dados do curso anterior.
let recargaAgendada = null;
function recarregar() {
  clearTimeout(recargaAgendada);
  recargaAgendada = setTimeout(() => {
    estado.analise = null; // resultado da análise pertence ao curso anterior
    carregar();
  }, 150);
}

// Redesenha sem descartar a análise já feita — usado quando o Studio termina de carregar
// e o inventário chega, o que acontece depois que a página já parou de navegar.
let cargaAgendada = null;
function atualizarDados() {
  clearTimeout(cargaAgendada);
  cargaAgendada = setTimeout(carregar, 150);
}

chrome.runtime.onMessage.addListener((msg) => {
  if (msg && msg.type === "sdv-inventory-updated") atualizarDados();
});

document.getElementById("recarregar").addEventListener("click", recarregar);
chrome.tabs.onActivated.addListener(recarregar);
chrome.tabs.onUpdated.addListener((_tabId, info, tab) => {
  if (!tab || !tab.active) return;
  if (!info.url && info.status !== "complete") return;
  recarregar();
});

carregar();
