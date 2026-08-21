// Setor de Vídeo — Canvas Studio · service worker
// Duas funções, só isso:
//   1. Fazer o clique no ícone abrir o painel lateral.
//   2. Guardar o inventário da coleção (vídeos + durações) que o studio.js captura, para
//      que o painel possa cruzá-lo com os módulos do curso mesmo depois que o usuário sair
//      da página do Studio.
//
// O inventário fica em `chrome.storage.session`: memória do navegador, NÃO vai para o disco
// e some quando o Chrome fecha. É o que permite manter a promessa de não gravar nada.

const CHAVE = "sdv-inventario";
const MAX_COLECOES = 8; // lembra as últimas coleções visitadas na sessão

chrome.runtime.onInstalled.addListener(() => {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
});
chrome.runtime.onStartup?.addListener(() => {
  chrome.sidePanel?.setPanelBehavior?.({ openPanelOnActionClick: true }).catch(() => {});
});

async function lerTudo() {
  try {
    const dados = await chrome.storage.session.get(CHAVE);
    return dados[CHAVE] || {};
  } catch {
    return {};
  }
}

async function guardarInventario(inv) {
  if (!inv || !inv.collectionId || !Array.isArray(inv.videos)) return;
  const tudo = await lerTudo();
  tudo[inv.collectionId] = {
    collectionId: inv.collectionId,
    canvasCourseId: inv.canvasCourseId || null,
    canvasDomain: inv.canvasDomain || null,
    courseName: inv.courseName || null,
    videos: inv.videos,
    totalCount: inv.totalCount ?? null,
    complete: !!inv.complete,
    at: Date.now(),
  };

  // Descarta as coleções mais antigas para não crescer sem limite.
  const chaves = Object.keys(tudo).sort((a, b) => (tudo[b].at || 0) - (tudo[a].at || 0));
  for (const k of chaves.slice(MAX_COLECOES)) delete tudo[k];

  try {
    await chrome.storage.session.set({ [CHAVE]: tudo });
  } catch {
    /* sessão sem storage: o painel simplesmente não terá o inventário */
    return;
  }

  // Avisa o painel DEPOIS de gravar. Sem isso ele só descobriria os dados na próxima
  // navegação: quando o Studio abre, a lista de vídeos leva alguns segundos para chegar,
  // e a essa altura o painel já tinha desenhado a tela sem duração.
  try {
    chrome.runtime.sendMessage(
      {
        type: "sdv-inventory-updated",
        collectionId: inv.collectionId,
        canvasCourseId: inv.canvasCourseId || null,
      },
      () => void chrome.runtime.lastError // painel fechado: ninguém para ouvir, tudo bem
    );
  } catch {
    /* ignora */
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || !msg.type) return;

  if (msg.type === "sdv-inventory") {
    guardarInventario(msg.data).then(() => sendResponse({ ok: true }));
    return true; // resposta assíncrona
  }

  if (msg.type === "sdv-get-inventory") {
    lerTudo().then((tudo) => {
      const lista = Object.values(tudo).sort((a, b) => (b.at || 0) - (a.at || 0));
      let alvo = null;

      if (msg.collectionId && tudo[msg.collectionId]) {
        alvo = tudo[msg.collectionId];
      } else if (msg.canvasCourseId) {
        // Curso conhecido: só serve o inventário DESSE curso. Devolver a coleção mais
        // recente aqui mostraria os dados de outra disciplina — e, pior, faria a análise
        // cruzar os módulos deste curso com o acervo do curso anterior.
        alvo =
          lista.find((i) => String(i.canvasCourseId) === String(msg.canvasCourseId)) || null;
      } else {
        alvo = lista[0] || null; // sem curso na aba: mostra a última vista
      }

      sendResponse({ inventario: alvo, quantas: lista.length });
    });
    return true;
  }
});
