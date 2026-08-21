# Setor de Vídeo — Canvas Studio (extensão Chrome)

Extensão Chrome (Manifest V3, JS puro) com um **painel lateral** que responde três perguntas
sobre os vídeos de um curso no Canvas:

1. **Qual é o ID da coleção do Studio?** — sem abrir o "código-fonte do frame" para garimpar.
2. **Quantas horas de vídeo a coleção tem?** — somando a coleção inteira, não só a primeira tela.
3. **Quanto disso está de fato publicado?** — cruzando o acervo do Studio com os vídeos
   realmente embutidos nas páginas, tarefas, quizzes e discussões dos **módulos** do curso.

A terceira é a que revela o descompasso comum: a coleção tem 21 vídeos, mas só 18 estão nos
módulos — então o tempo publicado é menor que o tempo do acervo.

## O que ela faz

- **Painel lateral** (ícone da extensão): abre ao lado da página, sem tapar o conteúdo, e
  acompanha você enquanto navega pelo curso.
- Detecta a coleção quando você está na página do Studio dentro de um curso
  (frame `*.instructuremedia.com`) e lê o `collection_id` da **URL do frame**.
- Mostra um botão flutuante **🎬 Coleção: \<ID\> · N vídeos · Xh Ymin** dentro do Studio —
  clicou, copiou o ID.
- **Soma a duração de todos os vídeos da coleção**, inclusive os que ainda não apareceram na
  grade: a listagem do Studio é paginada (20 por página) e a extensão percorre as restantes.
  Enquanto a soma não cobre tudo, o número aparece com **`+`**.
- **Analisa os módulos do curso** e separa o acervo em três números: *usados nos módulos*,
  *sem uso* e *nos módulos, de outra coleção*.
- **Abre o Studio do curso** por um botão do painel, usando o link que já existe na navegação
  do curso — sem procurar no menu.

## Como instalar (modo desenvolvedor)

1. Abra `chrome://extensions` no Chrome.
2. Ative o **Modo do desenvolvedor** (canto superior direito).
3. Clique em **Carregar sem compactação**.
4. Selecione a pasta deste projeto (`setordevideo`, onde está o `manifest.json`).
5. Pronto. O ícone da extensão aparece na barra.

## Como usar

1. No Canvas, abra qualquer página do curso e clique no **ícone da extensão** — o painel abre
   à direita.
2. Clique em **Abrir o Studio deste curso**. Deixe a biblioteca carregar: é nesse momento que a
   extensão lê a lista de vídeos e a duração de cada um.
3. Volte para o curso e clique em **Analisar módulos do curso**. Na primeira vez o Chrome pede
   autorização para acessar o Canvas (veja *Segurança / privacidade*).
4. O painel mostra o resumo:

```
Acervo da coleção        21 · 5h 31min
Usados nos módulos       18 · 4h 12min   ← o tempo que está nas páginas
Sem uso nos módulos       3 · 1h 19min
```

Abrindo **Ver os 18 publicados**, cada vídeo traz o link do item onde aparece — e o
título do vídeo abre a gravação no Studio, para você conferir de qual se trata.

O resultado fica guardado na sessão: navegar pelo curso, abrir um vídeo ou uma página não
apaga a análise. Ela só é refeita quando você clica em **Analisar módulos de novo**, e some
quando o Chrome é fechado.

## Segurança / privacidade

- A extensão **lê apenas o número da coleção na URL** do frame do Studio.
- A URL do Studio inclui um parâmetro `lti_params` (um **JWT de login** com dados pessoais e uma
  chave de integração). A extensão **não usa nem armazena** esse token; ela apenas decodifica, **em
  memória**, os campos `lti_course_id`, `canvas_domain` e o nome do curso para exibir o mapeamento
  Studio ↔ Canvas. E-mail, user_id e oauth_key **nunca** são lidos nem gravados.
- A contagem de vídeos e as durações vêm de "escutar" a chamada de listagem que o próprio Studio
  já faz (endpoint `tiles`), autenticada pela **sua sessão** — **não** usa nem requer chave de
  API do Studio.
- Como essa listagem é **paginada**, para somar a coleção inteira a extensão **repete essa mesma
  chamada de leitura** (`GET`) para as páginas restantes, no próprio servidor do Studio e com a
  sua sessão. Teto de segurança: 50 páginas (1000 vídeos).
- A **análise dos módulos** lê, pela API do Canvas e com a sua sessão, a lista de módulos e o
  corpo dos itens que podem conter vídeo. Nesse conteúdo ela procura **apenas os identificadores
  dos vídeos do Studio** (`custom_arc_media_id`, `lti_launch_id` e `notorious_id`). O resto do
  conteúdo não é interpretado, guardado nem enviado.
- O acesso ao domínio do Canvas é uma **permissão opcional**, pedida na primeira análise. Se você
  negar, tudo o mais continua funcionando.
- **Nada vai para fora do navegador** e **nada é gravado em disco**. O inventário da coleção e o
  resultado da análise ficam em `chrome.storage.session` — memória do navegador, apagada quando o
  Chrome fecha — para o painel não perder os dados a cada navegação.
- O link "assistir no Studio" de cada vídeo usa o mesmo proxy de launch que o Canvas já usa nos
  embeds (`external_tools/retrieve`): quem assina a chamada é o Canvas, na hora da abertura.
  Nenhum token é gerado ou guardado pela extensão.

## Se a duração aparecer com `+` (soma incompleta)

O `+` significa que a extensão não conseguiu ler todas as páginas da coleção — o número mostrado
é só do que ela viu. O motivo fica no **console do frame do Studio**:

1. Botão direito na página do Studio → **Inspecionar** → aba **Console**.
2. No seletor de contexto (topo do console), escolha o frame `instructuremedia.com`.
3. Procure as linhas `[SDV]`. Uma linha `coleção <id>: N vídeos somados (completo)` indica sucesso;
   um aviso diz o que travou (`respondeu 401`, `não trouxe vídeos novos`, `falha de rede`).

Para o log detalhado de cada página, rode no console desse frame e recarregue:

```js
localStorage.setItem("sdv-debug", "1")
```

## Estrutura

```
setordevideo/
├─ manifest.json          # MV3: painel lateral, content scripts, permissões
├─ icons/                 # ícones da extensão (16/32/48/128 px)
├─ src/
│  ├─ background.js       # service worker: abre o painel, guarda acervo e análise na sessão
│  ├─ net-hook.js         # lê a listagem do Studio: vídeos, durações, pagina tudo
│  ├─ canvas-scan.js      # varre os módulos e cruza os embeds com o acervo
│  ├─ format.js           # formata segundos como "12h 37min"
│  └─ studio.js           # detecta o collection_id na URL e injeta o botão
├─ panel/
│  ├─ panel.html
│  └─ panel.js            # painel lateral: coleção, ações e análise
├─ docs/
│  ├─ canvas-api-extensao.md              # pesquisa de APIs e decisões de arquitetura
│  ├─ automacao-embed-studio-em-paginas.md # anatomia do embed do Studio (base da análise)
│  └─ publicacao-chrome-web-store.md      # textos e requisitos da loja
└─ README.md
```

## Como a análise casa os dois lados

Um vídeo do Studio pode chegar à página por caminhos diferentes, e cada um grava um HTML
diferente:

| Como foi inserido | O que fica na página | Como é detectado |
|---|---|---|
| **Adicionar item → Studio** | iframe LTI com `custom_arc_media_id={uuid}-{media_id}` | padrão `embed` |
| **Copiar e colar o vídeo** (Ctrl+C / Ctrl+V) | URL do Studio contendo o `notorious_id` (`m-…`) | padrão `link` |
| Qualquer outra marcação | seja lá o que for, contendo um dos ids do vídeo | busca direta pelo identificador |

Por isso a detecção **não depende do formato**: além dos dois padrões conhecidos, a extensão
procura no HTML os identificadores (`lti_launch_id` e `notorious_id`) de cada vídeo do acervo.
Como são strings longas e únicas, achar uma é prova de que o vídeo está ali. O painel informa
por qual caminho cada vídeo foi encontrado, para você saber o que está sendo lido.

Os dois identificadores vêm prontos na listagem da coleção — o cruzamento é comparação direta
de ids, sem adivinhação. Detalhes em `docs/automacao-embed-studio-em-paginas.md` (§2 e §4.1).

> **Limite honesto:** se um vídeo for inserido de um jeito que não deixe nenhum desses
> identificadores no HTML da página, ele aparecerá como "sobrando". Se você vir um vídeo que
> sabe estar publicado na lista dos que sobraram, o HTML daquela página revela o formato — e a
> detecção pode ser estendida.

## Domínio

Configurada para `https://*.instructuremedia.com/*` (cobre `pucminas.instructuremedia.com` e
qualquer outra instância) e, como permissão opcional, `https://*.instructure.com/*`.

## Próximos passos / customização

- **Ancorar o botão ao lado de "Criar"/"Filtrar"** (dentro da barra do Studio) em vez de
  flutuante: basta o `outerHTML` dessa barra para usar o seletor exato.
- **Inserir o vídeo na página automaticamente**: a listagem já entrega `lti_launch_id`,
  `title` e `thumbnail_url` de todos os vídeos, e o molde do embed está mapeado.
  Ver `docs/automacao-embed-studio-em-paginas.md` (§3).

> **"Usados" não é o mesmo que "publicado no Canvas".** A conta é sobre o vídeo estar dentro do
> conteúdo do item — se o módulo está publicado ou não é outra coisa, mostrada apenas como marca
> ao lado do item.
