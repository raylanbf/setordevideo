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
      ${temInventario && temCurso ? "" : "disabled"}>Analisar módulos do curso</button>
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

function listaVideos(videos, mostrarOnde) {
  return `<ul class="videos">${videos
    .map((v) => {
      const dur = sdvFormatDuration(v.duration);
      const onde =
        mostrarOnde && v.locais ? `<div class="onde">${ondeHtml(v.locais)}</div>` : "";
      return `<li>
        <div class="vt">${esc(v.title || "(sem título)")}</div>
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
    <p class="hint">${a.itensVarridos} itens de ${a.modulos} módulos lidos.${
      r.porVia && (r.porVia.link || r.porVia.id)
        ? ` Dos publicados, ${r.porVia.embed} por "Adicionar item"` +
          (r.porVia.link ? `, ${r.porVia.link} colados na página` : "") +
          (r.porVia.id ? `, ${r.porVia.id} por outro formato` : "") +
          "."
        : ""
    }</p>

    ${
      r.usados.length
        ? `<details><summary>Ver os ${r.usados.length} publicados</summary>
             ${listaVideos(r.usados, true)}</details>`
        : ""
    }
    ${
      r.naoUsados.length
        ? `<details><summary>Ver os ${r.naoUsados.length} sem uso</summary>
             ${listaVideos(r.naoUsados, false)}</details>`
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
  desenhar();
}

// --- carga --------------------------------------------------------------------
async function carregar() {
  const aba = await abaAtiva();
  estado.tabId = aba && aba.id != null ? aba.id : null;
  estado.colecao = null;
  estado.dominio = null;
  estado.courseId = null;

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
