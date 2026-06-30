# Extensão Chrome + Canvas LMS (Instructure) — Pesquisa e Opções

> Documento de estudo. Objetivo: levantar **as APIs disponíveis** e **as opções de arquitetura**
> para uma extensão Chrome (Manifest V3, **JS puro**) que reaproveita a **sessão já logada** do
> usuário no Canvas. Nada é implementado ainda — aqui ficam as decisões em aberto.

Data da pesquisa: 2026-06-30

---

## 1. Decisões já tomadas

| Tema | Decisão |
|------|---------|
| Plataforma | Extensão **Chrome — Manifest V3** |
| Stack | **JavaScript puro** (sem bundler/framework, para o primeiro protótipo) |
| Autenticação | **Reusar a sessão atual** do usuário (cookies do navegador). Sem token manual, sem OAuth2. |
| Escopo de uso | "Preparado para tudo": ler dados, automatizar/lançar notas, melhorar a UI, gerenciar vídeos/mídia |

> **Pré-requisito de uso:** o usuário precisa já estar **logado** no Canvas em alguma aba
> (ou ter sessão válida no domínio). A extensão não faz login — ela aproveita a sessão existente.

---

## 2. A API do Canvas em resumo

- **REST API** — base: `https://<dominio-canvas>/api/v1/<recurso>`. Respostas em JSON.
- **GraphQL API** — `https://<dominio-canvas>/api/graphql` (consultas mais enxutas; opcional).
- **Domínio variável:** cada instituição tem o seu (`algo.instructure.com` ou domínio próprio).
  A extensão precisa **descobrir o domínio** a partir da aba ativa do Canvas (ver §5.3).
- **Paginação:** vem no header HTTP `Link` (`rel="next"`). Precisa seguir os links para
  coletar todas as páginas. Parâmetro `per_page` ajuda (máx. costuma ser 100).
- **Rate limit:** modelo "leaky bucket". Acompanhar headers `X-Rate-Limit-Remaining` /
  `X-Request-Cost`; em excesso retorna **403 (Forbidden) com `Rate Limit Exceeded`**.

---

## 3. Autenticação por SESSÃO (a abordagem escolhida) — como funciona

A ideia: a extensão chama as **mesmas rotas `/api/v1/...` que o próprio Canvas usa internamente**,
deixando o navegador anexar os cookies de sessão. Isso é o que scripts de Tampermonkey/Greasemonkey
para Canvas fazem.

### 3.1. Leitura (GET) — simples
- Basta a requisição carregar os cookies de sessão.
- Em **content script** rodando na página do Canvas: `fetch(url, { credentials: 'same-origin' })`.
- Em **service worker**: `fetch(url, { credentials: 'include' })`, **desde que** o domínio do
  Canvas esteja em `host_permissions` (aí os cookies são enviados e a requisição é tratada como same-site).

### 3.2. Escrita (POST / PUT / DELETE) — exige token CSRF ⚠️
O Canvas protege mutações com CSRF. Só o cookie de sessão **não basta**. É preciso:

1. Ler o cookie **`_csrf_token`** (não é HttpOnly → legível).
2. Fazer **URL-decode** do valor.
3. Enviar no header **`X-CSRF-Token: <valor-decodificado>`**.

```js
// dentro de um content script na página do Canvas:
const csrf = decodeURIComponent(
  document.cookie.split('; ').find(c => c.startsWith('_csrf_token=')).split('=')[1]
);
await fetch('/api/v1/courses/123/assignments', {
  method: 'POST',
  credentials: 'same-origin',
  headers: { 'Content-Type': 'application/json', 'X-CSRF-Token': csrf },
  body: JSON.stringify({ assignment: { name: 'Nova tarefa' } }),
});
```

No **service worker** o cookie é lido com a API `chrome.cookies.get` (requer permissão
`cookies` + host_permission), pois lá não existe `document.cookie`.

### 3.3. Vantagens x limitações desta abordagem

| ✅ Vantagens | ⚠️ Limitações / riscos |
|--------------|------------------------|
| Zero configuração para o usuário (nada de colar token) | Depende de o usuário estar logado; sessão expira |
| Não armazena segredos | Mutações exigem manejo correto do CSRF |
| Usa exatamente as permissões que o usuário já tem | Cookies `SameSite`/3rd-party podem bloquear em certos cenários |
| Sem cadastro de Developer Key com o admin | Sujeito aos Termos de Uso da instituição (automações) |

---

## 4. Catálogo de endpoints por caso de uso

> Todos relativos a `https://<dominio>/api/v1`. `:id` = identificador.

### 4.1. Ler dados de cursos/alunos
| Ação | Método + rota |
|------|---------------|
| Meus cursos | `GET /courses` |
| Detalhe do curso | `GET /courses/:id` |
| Pessoas/matrículas do curso | `GET /courses/:id/users` · `GET /courses/:id/enrollments` |
| Usuário atual | `GET /users/self` |
| Perfil | `GET /users/:id/profile` |
| Tarefas do curso | `GET /courses/:id/assignments` |
| Submissões | `GET /courses/:id/assignments/:aid/submissions` |
| Notas/analytics | `GET /courses/:id/analytics/...` · Gradebook History |
| Módulos e itens | `GET /courses/:id/modules` · `.../modules/:mid/items` |

### 4.2. Automatizar tarefas / lançar notas (mutações → exigem CSRF)
| Ação | Método + rota |
|------|---------------|
| Criar tarefa | `POST /courses/:id/assignments` |
| Lançar/atualizar nota | `PUT /courses/:id/assignments/:aid/submissions/:uid` (`submission[posted_grade]`) |
| Notas em lote | `POST /courses/:id/assignments/:aid/submissions/update_grades` |
| Comentar submissão | `PUT .../submissions/:uid` (`comment[text_comment]`) |
| Postar anúncio | `POST /courses/:id/discussion_topics` (`is_announcement=true`) |
| Mensagem (inbox) | `POST /conversations` |
| Criar/editar página | `POST`/`PUT /courses/:id/pages` |

### 4.3. Melhorar a UI do Canvas (content script)
- Injetar botões/atalhos na própria página (`/courses/...`) e chamar a API same-origin.
- Ex.: botão "exportar notas CSV", atalho "abrir SpeedGrader filtrado", etc.
- Pode usar GraphQL para montar painéis com menos chamadas.

### 4.4. Gerenciar vídeos/mídia ("setor de vídeo")
| Ação | Rota / fluxo |
|------|--------------|
| Objetos de mídia do curso | `GET /courses/:id/media_objects` |
| Arquivos do curso | `GET /courses/:id/files` (filtrar `content_types[]=video`) |
| **Upload de arquivo** (3 passos) | 1) `POST /courses/:id/files` p/ obter URL de upload → 2) `POST` multipart no URL retornado → 3) confirmar redirect |
| Upload de mídia (Kaltura) | `GET /services/kaltura_session` + endpoints de media object |
| Legendas/captions | `POST /media_objects/:id/media_tracks` |

> Observação: o pipeline de vídeo do Canvas usa **Kaltura** por baixo; uploads grandes
> podem exigir o fluxo de `kaltura_session`. A confirmar conforme a instância.

### 4.5. Lista completa de famílias de recursos (referência)
Accounts · Analytics · Announcements · Assignments · Assignment Groups · Calendar Events ·
Collaborations · Conferences · Content Exports/Migrations · Conversations · Courses ·
Custom Gradebook Columns · Discussion Topics · Enrollments · External Tools (LTI) ·
Favorites · Feature Flags · **Files** · Grading Periods/Standards · Groups · **Media Objects** ·
Modules · Outcomes · Pages · Peer Reviews · Planner · Progress · Quizzes / New Quizzes ·
Rubrics · Sections · Submissions · Users  *(e dezenas de outros)*.

---

## 5. Arquitetura da extensão (MV3) — opções em aberto

### 5.1. Componentes
- **`manifest.json`** — MV3, `host_permissions`, `service_worker`, content scripts.
- **Service worker (background)** — orquestra chamadas à API, segue paginação, trata rate limit.
- **Content script** — injeta UI na página do Canvas e/ou faz fetch same-origin.
- **Popup / Side Panel** — interface da extensão (lista de cursos, ações, etc.).

### 5.2. **Decisão A — Onde fazer as chamadas à API?**
| Opção | Prós | Contras |
|-------|------|---------|
| **A1. Content script (same-origin)** | CSRF trivial (`document.cookie`); sem CORS; igual ao Canvas | Só funciona com uma aba do Canvas aberta/ativa |
| **A2. Service worker + `chrome.cookies`** | Roda sem aba aberta; centraliza lógica | Precisa permissão `cookies`; ler CSRF é mais trabalhoso |
| **A3. Híbrido** | Leitura no SW, mutações via content script | Mais código/coordenação |

### 5.3. **Decisão B — Como descobrir o domínio do Canvas?**
| Opção | Descrição |
|-------|-----------|
| **B1. Detecção dinâmica** | Pega o domínio da aba ativa do Canvas e usa permissões **opcionais** sob demanda |
| **B2. Lista fixa** | `host_permissions` com o(s) domínio(s) da instituição (ex.: `*.instructure.com`) |
| **B3. `<all_urls>`** | Funciona em qualquer instância, mas pede permissão ampla (revisão mais rígida na Web Store) |

### 5.4. **Decisão C — Formato da interface**
- **C1. Popup** (clique no ícone) — simples.
- **C2. Side Panel** (API `sidePanel`) — painel lateral persistente; bom p/ "setor de vídeo".
- **C3. UI injetada** na página via content script — integra com o fluxo do professor.

### 5.5. Esboço de `manifest.json` (ilustrativo, não final)
```jsonc
{
  "manifest_version": 3,
  "name": "Setor de Vídeo — Canvas",
  "version": "0.1.0",
  "permissions": ["storage", "cookies", "activeTab", "scripting"],
  "host_permissions": ["https://*.instructure.com/*"],   // ajustar p/ Decisão B
  "background": { "service_worker": "background.js" },
  "action": { "default_popup": "popup.html" },
  "content_scripts": [
    { "matches": ["https://*.instructure.com/*"], "js": ["content.js"] }
  ]
}
```

---

## 6. Riscos, limites e boas práticas
- **Termos de uso / política da API:** usar a sessão **do próprio usuário** agindo na própria
  conta é aceitável; automações em massa devem respeitar as regras da instituição.
- **Expiração de sessão:** detectar respostas **401** e orientar o usuário a relogar.
- **CSRF obrigatório** em toda mutação (§3.2) — falha → "Can't verify CSRF token authenticity".
- **Paginação** (header `Link`) e **rate limit** (`X-Rate-Limit-Remaining`) precisam de tratamento.
- **SameSite/cookies de terceiros:** garantir same-site via `host_permissions` (A2) ou rodar
  same-origin no content script (A1).
- **Permissões mínimas:** quanto menor o `host_permissions`, mais fácil a aprovação na Web Store.

---

## 7. Próximos passos sugeridos
1. **Fechar as Decisões A, B e C** (§5).
2. Escolher 1 caso de uso para o **MVP** (sugestão: listar cursos + listar vídeos/arquivos — só leitura).
3. Esqueleto do projeto: `manifest.json`, `background.js`, `content.js`, `popup.html/js`.
4. Implementar utilitário de fetch com paginação + leitura de CSRF.
5. Validar numa instância real do Canvas com o usuário logado.

---

## 8. Fontes
- [OAuth2 — Canvas REST API](https://www.canvas.instructure.com/doc/api/file.oauth.html)
- [Developer Keys — Canvas REST API](https://www.canvas.instructure.com/doc/api/file.developer_keys.html)
- [All API Resources — Canvas REST API](https://www.canvas.instructure.com/doc/api/all_resources.html)
- [Courses — Canvas REST API](https://www.canvas.instructure.com/doc/api/courses.html)
- [Submissions — Canvas REST API](https://canvas.iastate.edu/doc/api/submissions.html)
- [Instructure Developer Docs](https://developerdocs.instructure.com/services/canvas)
- [Changes to Cross-Origin Requests in Extension Content Scripts (Chromium)](https://www.chromium.org/Home/chromium-security/extension-content-script-fetches/)
- [Storage and cookies — Chrome for Developers](https://developer.chrome.com/docs/extensions/develop/concepts/storage-and-cookies)
- [Cookie-based Auth for Browser Extension (MV3) — Borys Melnyk](https://boryssey.medium.com/cookie-based-authentication-for-your-browser-extension-and-web-app-mv3-4837d7603f54)
- [Studio Public API](https://tw.instructuremedia.com/api/public/docs/)
- [Collection — Studio API Reference](https://developerdocs.instructure.com/services/studio/api-reference/collection)

---

## Anexo A — Canvas Studio: descobrir o `collection_id` automaticamente (MVP nº 1)

**Problema atual (manual):** para achar o ID da coleção do Studio, o setor abre o Studio dentro
do curso, clica com botão direito → "exibir código-fonte do frame" e garimpa o ID. Trabalhoso.

**Descoberta (caso real — PUC Minas):** o Studio é uma **SPA** carregada num **iframe** de
`pucminas.instructuremedia.com`. O HTML estático (view-source) **não** contém o ID — é só a
casca (`<div id="App"></div>` + `app.js`). O ID está **na URL do frame**:

```
https://pucminas.instructuremedia.com/lti-app/media-picker/collections/courses/548921?lti_params=<JWT>
                                                                              ^^^^^^
                                                                          collection_id
```

- `548921` = **ID da coleção do curso no Studio** (o "ID único" reutilizável que o setor procura).
- O parâmetro `lti_params` é um **JWT de launch LTI** (assinado ES512, validade ~1h). **A extensão
  NÃO precisa dele.** Ele carrega dados sensíveis (`lti_user_email`, `lti_user_id`,
  `canvas_user_uuid` e **`lti_oauth_key`**) → não logar, não persistir, não compartilhar.
- O payload do JWT também liga os dois mundos: `lti_course_id` = `239994` (course_id do **Canvas**),
  `canvas_domain` = `pucminas.instructure.com`, `account_id` = `14626`. Permite mapear
  **coleção Studio (548921) ↔ curso Canvas (239994)** automaticamente.

**Solução (extensão, SEM chave de API):** content script injetado no frame do Studio lê o ID
direto da URL e mostra/copia num botão.

```js
// studio.js — roda no frame pucminas.instructuremedia.com (all_frames: true)
function getCollectionId() {
  const m = location.pathname.match(/\/collections\/courses\/(\d+)/);
  return m ? m[1] : null;   // "548921"
}
```

```jsonc
// manifest.json (trecho)
"content_scripts": [{
  "matches": ["https://pucminas.instructuremedia.com/*"],
  "all_frames": true,        // entra no iframe do Studio embedado no Canvas
  "js": ["studio.js"]
}]
```

**Observações de implementação:**
- A SPA troca de rota **sem recarregar** → monitorar mudança de URL (interceptar
  `history.pushState` + evento `popstate`, ou `MutationObserver`) para atualizar o ID ao navegar.
- O botão deve entrar na barra de ações do Studio (ao lado de "Criar"/"Filtrar"), que fica
  **dentro do iframe** — por isso o script roda no frame, não na página do Canvas.
- O mapeamento `collection_id ↔ course_id` exige decodificar o payload do `lti_params`
  (base64url) **apenas em memória**; nunca gravar o JWT.
