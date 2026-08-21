# Automação — incorporar vídeos do Studio em páginas do Canvas (pesquisa / spec)

> Documento de estudo. Objetivo: mapear **como o embed de um vídeo do Canvas Studio é montado**,
> **até onde conseguimos acessar esses vídeos** reusando a sessão logada, e **como uma extensão
> poderia inserir o vídeo numa página do Canvas automaticamente** — em especial integrando com a
> outra extensão (outro projeto) que já **cria páginas no Canvas a partir de conteúdo, mas hoje
> sem os vídeos** (que entram na mão).
>
> O embed em si não está implementado aqui — este doc é o plano para esse passo. O que já saiu
> do papel foi a **leitura da listagem `tiles`** (§4.1): a extensão hoje lê o `collection_id`,
> conta os vídeos e **soma a duração da coleção inteira, percorrendo todas as páginas**.

Data: 2026-07-02 (atualizado 2026-07-03, com resposta real do endpoint `tiles`) · Instância de
referência: **PUC Minas** (`pucminas.instructuremedia.com` / `pucminas.instructure.com`).

---

## 1. Contexto e meta

| Peça | Estado hoje |
|------|-------------|
| Extensão `setordevideo` (este projeto) | Lê `collection_id` da URL do frame do Studio, conta vídeos (via `net-hook`), mostra/copia. **Só leitura.** |
| Outra extensão (outro projeto) | Importa conteúdo e **cria páginas no Canvas** automaticamente — mas **sem os vídeos**; o vídeo é embutido manualmente depois. |
| Dor a resolver | Eliminar o passo manual de "abrir o editor → botão Studio → procurar o vídeo → incorporar". |

**Pergunta central deste doc:** dá para, a partir do conteúdo que a outra extensão já processa,
**gerar o embed do vídeo do Studio e gravá-lo na página** sem intervenção manual? **Resposta: sim,
é viável** — com as condições mapeadas abaixo.

---

## 2. Anatomia do embed do Studio (decodificado de um caso real)

Este é o HTML que o Canvas insere na página quando você incorpora um vídeo manualmente
(capturado na visão HTML do Rich Content Editor, curso `282082`, vídeo "03 Tendências"):

```html
<iframe class="lti-embed"
  style="width: 720px; height: 405px; display: inline-block;"
  title="03 Tendências"
  src="/courses/282082/external_tools/retrieve?display=borderless&url=https%3A%2F%2Fpucminas.instructuremedia.com%2Flti%2Flaunch%3Fcustom_arc_launch_type%3Dbare_embed%26custom_arc_media_id%3De348ffa5-1cb3-4c8b-9f26-db50f0aade22-260854%26custom_arc_show_rolling_transcript%3Dtrue%26custom_arc_start_at%3D0"
  width="720" height="405"
  allowfullscreen="allowfullscreen" webkitallowfullscreen="webkitallowfullscreen" mozallowfullscreen="mozallowfullscreen"
  allow="geolocation *; microphone *; camera *; midi *; encrypted-media *; autoplay *; clipboard-write *; display-capture *; fullscreen *"
  data-studio-resizable="true" data-studio-tray-enabled="true" data-studio-convertible-to-link="true">
</iframe>
```

### 2.1. O `src` decodificado

O `src` é um **proxy de launch LTI** do Canvas. Decodificando o parâmetro `url`:

```
/courses/{COURSE_ID}/external_tools/retrieve
    ?display=borderless
    &url=<LAUNCH_URL urlencoded>

LAUNCH_URL =
  https://{STUDIO_DOMAIN}/lti/launch
    ?custom_arc_launch_type=bare_embed
    &custom_arc_media_id={MEDIA_ID}
    &custom_arc_show_rolling_transcript=true
    &custom_arc_start_at=0
```

### 2.2. O que é variável x o que é fixo

| Campo | Valor no exemplo | Fixo? | De onde tirar |
|-------|------------------|-------|---------------|
| `COURSE_ID` (curso Canvas) | `282082` | por curso | ✅ **já extraído** do JWT `lti_params` (`lti_course_id`) — ver [studio.js:48](../src/studio.js#L48); ou da URL da página `/courses/282082/...` |
| `STUDIO_DOMAIN` | `pucminas.instructuremedia.com` | por instância | ✅ host do frame do Studio (`location.host`) ou derivado de `canvas_domain` |
| `MEDIA_ID` (`custom_arc_media_id`) | `e348ffa5-1cb3-4c8b-9f26-db50f0aade22-260854` | por vídeo | ✅ **confirmado** = campo `lti_launch_id` de cada tile (§4.1) |
| `title` | `03 Tendências` | por vídeo | ✅ `data.title` (= `data.media.title`) na lista |
| `display=borderless` | — | fixo | constante |
| `custom_arc_launch_type=bare_embed` | — | fixo | constante |
| `custom_arc_show_rolling_transcript=true` | — | fixo | constante (ligar/desligar transcrição) |
| `custom_arc_start_at=0` | — | fixo | constante (segundo inicial) |
| dimensões `720 × 405` | — | ajustável | padrão 16:9 |
| `allow=…`, `data-studio-*`, `class`, `allowfullscreen` | — | fixo | atributos constantes |

### 2.3. Descoberta-chave: o HTML é estático e reutilizável 🔑

**Não há nenhum token assinado nem nada que expira dentro do HTML gravado.** O
`external_tools/retrieve` executa a launch LTI **no momento em que a página é aberta** — quem
assina é o Canvas, na hora da visualização, casando o `url` do launch com o **External Tool
(Studio)** já configurado no curso. Consequências:

- O bloco pode ser **gerado por texto** e **gravado como está**; ele "revive" sozinho a cada
  acesso, igual ao que o botão manual produz.
- Não precisa de chave da API do Studio para **montar** o embed — só do `MEDIA_ID`.
- O `retrieve` casa o tool **pelo domínio da URL** (`*.instructuremedia.com`), então **não é
  preciso saber o `external_tool_id`** — o Canvas resolve.

### 2.4. Formato do `MEDIA_ID` — **confirmado**

`e348ffa5-1cb3-4c8b-9f26-db50f0aade22-260854` = **UUID** (`e348ffa5-…-db50f0aade22`) **+ sufixo
numérico** (`-260854`, que é o `media.id`). A lista da coleção já devolve a **string composta
pronta** no campo `data.media.lti_launch_id` (ver §4.1) — não precisamos montar nada; é ler e usar.

---

## 3. Função de referência — montar o embed

Reproduz **exatamente** os atributos do caso real (só trocando as 3 variáveis):

```js
// Gera o <iframe> de embed do Studio, idêntico ao que o RCE produz manualmente.
function buildStudioEmbed({ courseId, studioDomain, mediaId, title = "", width = 720, height = 405 }) {
  const launch =
    `https://${studioDomain}/lti/launch` +
    `?custom_arc_launch_type=bare_embed` +
    `&custom_arc_media_id=${mediaId}` +
    `&custom_arc_show_rolling_transcript=true` +
    `&custom_arc_start_at=0`;

  const src =
    `/courses/${courseId}/external_tools/retrieve` +
    `?display=borderless&url=${encodeURIComponent(launch)}`;

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

  return (
    `<iframe class="lti-embed" ` +
    `style="width: ${width}px; height: ${height}px; display: inline-block;" ` +
    `title="${esc(title)}" ` +
    `src="${esc(src)}" ` +
    `width="${width}" height="${height}" ` +
    `allowfullscreen="allowfullscreen" webkitallowfullscreen="webkitallowfullscreen" mozallowfullscreen="mozallowfullscreen" ` +
    `allow="geolocation *; microphone *; camera *; midi *; encrypted-media *; autoplay *; clipboard-write *; display-capture *; fullscreen *" ` +
    `data-studio-resizable="true" data-studio-tray-enabled="true" data-studio-convertible-to-link="true">` +
    `</iframe>`
  );
}
```

> `esc(src)` transforma os `&` do `src` em `&amp;`, batendo com o HTML que o Canvas armazena.

---

## 4. Até onde conseguimos acessar os vídeos (fronteira de acesso)

Três níveis, do mais fácil (o que já usamos) ao que depende de terceiros:

### 4.1. Interceptar a sessão do Studio (SEM chave de API) — **o caminho recomendado**
O `net-hook` já escuta as chamadas que a SPA do Studio faz — ver
[net-hook.js:49-83](../src/net-hook.js#L49-L83). Quando você abre uma coleção, a SPA chama o
endpoint **`tiles`** (paginado), que devolve a lista de vídeos daquela coleção num JSON. Tudo que
aparece na grade do Studio está nesse JSON.

**Endpoint (observado na instância PUC Minas):**
```
GET .../tiles?page=1&per_page=20&sort_by=created_at&order=desc&filter[]=perspectives
```
Resposta: `{ tiles: [ { item_type, data: {…} }, … ], meta: {…} }`.

**Campos por vídeo — confirmados de uma resposta real** (`tiles[i].data`):

| O que precisamos | Campo | Valor no exemplo |
|------------------|-------|------------------|
| **`media_id` do embed** (`custom_arc_media_id`) | `data.media.lti_launch_id` | `e348ffa5-1cb3-4c8b-9f26-db50f0aade22-260854` |
| Título | `data.title` (= `data.media.title`) | `03 Tendências` |
| ID numérico da mídia | `data.media.id` | `260854` |
| Miniatura (capa) | `data.media.thumbnail_url` | `https://nv.instructuremedia.com/api/media/m-4fA1…/thumbnail?width=540&height=320` |
| Duração (segundos) | `data.media.duration` | `1005` |
| Tem legendas? | `data.has_captions` | `true` |
| `notorious_id` (id interno de mídia) | `data.media.notorious_id` | `m-4fA1ZYHU6PpDA51NxBbJxVJ6eEcDPDKP` |
| Coleção (id/nome/tipo) | `data.collection.{id,name,type}` | `586827` / "Ambiente teste - Raylan" / `course_wide` |

> **`lti_launch_id` = `{uuid}-{media.id}`** e é **exatamente** o `custom_arc_media_id` do embed
> (§2). Basta ler e injetar no molde (§3) — nada a montar.

**Paginação:** vem em `meta`:
```json
"meta": { "current_page": 1, "per_page": 20, "last_page": 1, "total_count": 1 }
```
Para pegar todos os vídeos: iterar `page = 1 … meta.last_page` (20 por página).

**⚠️ Campos sensíveis a IGNORAR** (não ler, não gravar — mesma postura do `lti_params`):
`data.media.author.email`, `data.media.pandata_tokens.{auth,resource}` e o
`data.pandata_tokens.*` (JWTs de sessão). Nada disso é necessário para o embed.

**Limite do método — resolvido:** a interceptação pura só enxerga o que a SPA de fato baixa
(20/página). Desde a v0.5.0 o `net-hook` **refaz a chamada `tiles` variando `page`** reusando a
sessão (leitura simples, sem CSRF) até `meta.last_page`, deduplicando por `media.id` — ver
[net-hook.js:130-156](../src/net-hook.js#L130-L156). É assim que a duração total sai correta em
coleções grandes; o mesmo laço já entrega `lti_launch_id` e `thumbnail_url` de **todos** os
vídeos, que é o que o embed (§3) precisa. Teto de segurança: 50 páginas.

### 4.2. Studio Public API (com chave) — hoje indisponível
`GET /api/public/v1/collections/{id}/media` e afins dão acesso oficial e completo (listar mídias,
metadados, legendas). Exige **token/chave da API do Studio** emitida pelo admin da instituição —
que **não temos**. Ver `docs/canvas-api-extensao.md` (§8, "Studio Public API"). Fica como plano B
caso o setor consiga a chave.

### 4.3. Canvas API (`/courses/:id/media_objects`) — **não serve** para o Studio
Esse endpoint lista mídia do **Kaltura/Canvas**, que é um pipeline **diferente** do Studio. Os
vídeos do Studio vivem em `instructuremedia.com`, não em `media_objects`. Não confundir.

**Conclusão da fronteira:** sem chave da API do Studio, o acesso viável é o **4.1 (interceptação de
sessão)** — e ele basta para pegar `media_id` + título + miniatura de tudo que estiver numa
coleção aberta.

---

## 5. Gravar o embed na página do Canvas (a parte "escrita")

Aqui a extensão deixa de só **ler** e passa a **gravar** — é a mudança de patamar.

### 5.1. Endpoint (Pages API do Canvas)
- **Editar página existente:** `PUT /api/v1/courses/:course_id/pages/:page_url`
- **Criar página nova:** `POST /api/v1/courses/:course_id/pages`
- Corpo: `wiki_page[body]` = HTML da página.

### 5.2. CSRF obrigatório em toda mutação ⚠️
Cookie de sessão **não basta**. É preciso (ver `docs/canvas-api-extensao.md` §3.2):
1. ler o cookie `_csrf_token` (não é HttpOnly → legível);
2. fazer `decodeURIComponent` no valor;
3. enviar no header `X-CSRF-Token`.

### 5.3. Anexar sem apagar o que já existe
Para **inserir** o vídeo (e não sobrescrever a página): `GET` do corpo atual → concatenar o
`<iframe>` → `PUT`.

```js
// Roda em content script na página do Canvas (same-origin → CSRF via document.cookie).
async function appendEmbedToPage({ courseId, pageUrl, embedHtml }) {
  const csrf = decodeURIComponent(
    document.cookie.split("; ").find((c) => c.startsWith("_csrf_token=")).split("=")[1]
  );

  // 1) corpo atual
  const cur = await fetch(`/api/v1/courses/${courseId}/pages/${pageUrl}`, {
    credentials: "same-origin", headers: { Accept: "application/json" },
  }).then((r) => r.json());

  // 2) grava com o vídeo anexado
  const res = await fetch(`/api/v1/courses/${courseId}/pages/${pageUrl}`, {
    method: "PUT",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json", "X-CSRF-Token": csrf },
    body: JSON.stringify({ wiki_page: { body: (cur.body || "") + embedHtml } }),
  });
  return res.ok;
}
```

> Para **criar** a página já com o vídeo, troque por `POST /api/v1/courses/:id/pages` com
> `wiki_page[title]` e `wiki_page[body]`. Se a outra extensão **já cria a página**, o mais limpo é
> ela **incluir o `embedHtml` no `body` na hora de criar** — sem PUT extra (ver §6).

### 5.4. Onde rodar a escrita
| Opção | Como | Observação |
|-------|------|------------|
| **Content script em `*.instructure.com`** (recomendado) | fetch **same-origin** + CSRF via `document.cookie` | precisa de uma aba do Canvas aberta; CSRF trivial |
| Service worker + `chrome.cookies` | fetch com `credentials: include` | exige permissão `cookies` e ler o CSRF via API; roda sem aba |

---

## 6. Arquitetura de integração com a outra extensão (a que cria páginas)

O elo que falta é **casar o vídeo certo com o conteúdo certo**. A outra extensão conhece o
**conteúdo** (títulos das páginas/aulas) mas **não** os `media_id`. Este projeto sabe extrair os
`media_id` da coleção. Duas formas de juntar:

### 6.1. Opção recomendada — compartilhar o "resolvedor" e o `buildStudioEmbed`
1. **Mapa da coleção:** ao abrir a coleção no Studio, capturar (via `net-hook`) o mapa
   `{ título_do_vídeo → media_id }` de todos os vídeos e disponibilizá-lo (ex.: `chrome.storage`
   ou mensagem entre extensões via `externally_connectable`).
2. **Na criação da página:** a outra extensão, para cada aula/vídeo, resolve `título → media_id`,
   chama `buildStudioEmbed({courseId, studioDomain, mediaId, title})` e **injeta o `<iframe>` no
   `body` da página que ela já está criando**. Zero passo manual.
3. **Casamento título↔vídeo:** se os títulos não baterem 1:1, prever um passo de conferência
   (dropdown "qual vídeo desta coleção?" por página) ou casar por um identificador comum, se houver.

### 6.2. Opção alternativa — tudo nesta extensão
Adicionar aqui um botão "inserir vídeo na página aberta" (fluxo §5.3). Mais simples de testar, mas
**não** resolve o caso em lote da outra extensão; serve como protótipo de validação.

### 6.3. Mudanças de manifest implicadas
- Adicionar `host_permissions: ["https://*.instructure.com/*"]` **em quem for gravar** (esta
  extensão, se for ela; ou confirmar que a outra já tem).
- Content script em `*.instructure.com` para o fetch same-origin + CSRF.
- Se a **outra** extensão já cria páginas, ela **já** tem essas permissões → o ideal é ela apenas
  **importar a lógica de embed** (§3) e o **mapa da coleção** (§6.1) — sem ampliar as permissões
  desta aqui, que continua só-leitura.

---

## 7. Requisitos, riscos e limites

- **Sessão logada** no Canvas e no Studio (a extensão não faz login; reaproveita a sessão).
- **CSRF** correto em toda escrita, senão: *"Can't verify CSRF token authenticity"*.
- **O vídeo precisa estar acessível ao curso.** A launch LTI só resolve se aquele `media_id`
  estiver compartilhado com o curso `282082` no Studio. Embutir um `media_id` de outro curso pode
  falhar na hora de exibir. **A confirmar** se basta o vídeo existir na conta ou se precisa estar
  na coleção do curso.
- **Paginação da lista** (§4.1): garantir que o `net-hook` viu todos os vídeos antes de montar o mapa.
- **`bare_embed` para todos?** Confirmar que todo vídeo aceita `custom_arc_launch_type=bare_embed`
  (vídeos com quiz/interativos podem ter outro tipo de launch).
- **Rate limit** do Canvas em lote grande (header `X-Rate-Limit-Remaining`) — throttle se criar
  muitas páginas de uma vez.
- **Web Store:** passar a **gravar** amplia o escopo de permissões → revisão mais rígida. Se a
  escrita ficar na outra extensão, este projeto não é afetado.
- **Termos de uso:** automação agindo com a **própria conta** do usuário logado é aceitável; evitar
  operações em massa que violem política da instituição.

---

## 8. Validação sugerida (ordem)

1. ~~Capturar 1 item da lista da coleção~~ → **feito**: campo `media_id` = `data.media.lti_launch_id`,
   endpoint `tiles`, formato confirmado (§4.1).
2. Rodar `buildStudioEmbed(...)` para 1 vídeo e comparar **string a string** com o embed manual
   deste doc (§2) — devem ficar idênticos (fora as 3 variáveis). *(Conferido no caso "03 Tendências":
   bate exatamente.)*
3. Num **curso de teste**, gravar esse `<iframe>` numa página via API (§5.3) e **abrir a página**:
   o vídeo tem que tocar igual ao embed manual.
4. Confirmar o comportamento de `media_id` de fora do curso (§7).
5. Só então integrar com a outra extensão (§6.1).

---

## 9. Perguntas em aberto (a confirmar)

- [x] ~~Nome/formato exato do campo `media_id` na lista da coleção~~ → **`data.media.lti_launch_id`** (§4.1).
- [x] ~~A lista da coleção é paginada?~~ → **sim**, endpoint `tiles`, **20/página**, total em `meta.last_page` (§4.1).
- [ ] `media_id` de outro curso funciona embutido, ou precisa estar na coleção do curso? (§7)
- [ ] Todos os vídeos aceitam `bare_embed`? (§7)
- [ ] A outra extensão já tem `host_permissions` de `*.instructure.com` e faz escrita com CSRF? (§6.3)
- [ ] Como casar `título do conteúdo ↔ vídeo` quando os nomes não batem 1:1? (§6.1)

---

## 10. Resumo executivo

- **Montar o embed:** ✅ resolvido — molde estático, sem token que expira; precisa só de
  `course_id` (temos), `studio_domain` (temos) e `media_id` (confirmado, §4.1).
- **Descobrir o `media_id`:** ✅ **resolvido** — campo `data.media.lti_launch_id` do endpoint
  `tiles` (§4.1), que o `net-hook` já intercepta. Bônus: `thumbnail_url`, `duration` e
  `has_captions` também vêm na mesma resposta.
- **Gravar na página:** ✅ viável via Pages API + CSRF; é a única parte "nova" de verdade.
- **Integração com a outra extensão:** melhor caminho = ela importa o `buildStudioEmbed` + o mapa
  `{título→media_id}` e embute o vídeo no `body` na hora de criar a página. Esta extensão pode
  seguir só-leitura.

**Veredito:** incluir os vídeos automaticamente é **factível** e o campo-chave está **confirmado**.
Restam só validações práticas: (1) `media_id` de fora do curso funciona? (§7); (2) testar a escrita
num curso de teste (§8). Nenhuma delas é bloqueio de arquitetura.
