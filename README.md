# Setor de Vídeo — Canvas Studio (extensão Chrome)

Extensão Chrome (Manifest V3, JS puro) que **revela e copia o ID da coleção do Canvas Studio**
direto da página, eliminando o processo manual de abrir o "código-fonte do frame" e garimpar o ID.

## O que ela faz

- Detecta automaticamente quando você está na página do Studio dentro de um curso
  (frame `*.instructuremedia.com`).
- Lê o `collection_id` direto da **URL do frame**
  (`/lti-app/media-picker/collections/courses/<ID>`).
- Mostra um botão flutuante **🎬 Coleção: \<ID\> · N vídeos** — clicou, copiou.
- O **popup** (ícone da extensão) mostra, **em tempo real**, a coleção da aba atual: ID,
  quantidade de vídeos, disciplina e `course_id` do Canvas. Se você não estiver numa coleção
  do Studio, o popup fica vazio (nunca mostra ID antigo).

## Como instalar (modo desenvolvedor)

1. Abra `chrome://extensions` no Chrome.
2. Ative o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação**.
4. Selecione a pasta deste projeto (`setordevideo`, onde está o `manifest.json`).
5. Pronto. O ícone da extensão aparece na barra.

## Como usar

1. No Canvas, entre num curso e clique em **Studio** na navegação do curso.
2. Quando a biblioteca do Studio carregar, o botão **🎬 Coleção: \<ID\>** aparece no canto
   inferior direito. Clique para copiar o ID.
3. Opcional: clique no ícone da extensão para ver o ID, a disciplina e o `course_id` do Canvas.

## Segurança / privacidade

- A extensão **lê apenas o número da coleção na URL** do frame.
- A URL do Studio inclui um parâmetro `lti_params` (um **JWT de login** com dados pessoais e uma
  chave de integração). A extensão **não usa nem armazena** esse token; ela apenas decodifica, **em
  memória**, os campos `lti_course_id`, `canvas_domain` e o nome do curso para exibir o mapeamento
  Studio ↔ Canvas. E-mail, user_id e oauth_key **nunca** são lidos nem gravados.
- Nada é enviado para fora do navegador e **nada é gravado em disco**: o popup lê a coleção da
  aba atual em tempo real e não persiste nada.
- A contagem de vídeos vem de "escutar" a chamada que o próprio Studio já faz, autenticada pela
  **sua sessão** (você logado) — **não** usa nem requer chave de API do Studio.

## Estrutura

```
setordevideo/
├─ manifest.json          # MV3, content scripts no frame do Studio
├─ icons/                 # ícones da extensão (16/32/48/128 px)
├─ src/
│  ├─ net-hook.js         # escuta a chamada interna do Studio (conta vídeos)
│  └─ studio.js           # detecta o collection_id na URL e injeta o botão
├─ popup/
│  ├─ popup.html
│  └─ popup.js            # mostra a última coleção capturada
├─ docs/
│  ├─ canvas-api-extensao.md              # pesquisa de APIs e decisões de arquitetura
│  └─ automacao-embed-studio-em-paginas.md # como incorporar vídeos do Studio em páginas (spec)
└─ README.md
```

## Domínio

Configurada para `https://*.instructuremedia.com/*` (cobre `pucminas.instructuremedia.com` e
qualquer outra instância). Ajuste em `manifest.json` se precisar restringir.

## Próximos passos / customização

- **Ancorar o botão ao lado de "Criar"/"Filtrar"** (dentro da barra do Studio) em vez de flutuante:
  basta o `outerHTML` dessa barra (botão direito → Inspecionar) para usar o seletor exato.
- Listar os vídeos da coleção exige a **chave da API do Studio** (Studio Public API:
  `GET /collections/{id}/media`) — ainda não disponível. Ver `docs/canvas-api-extensao.md`.
