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
- **Mostra as datas de cada vídeo** ao lado da duração: quando foi **enviado ao Studio** e
  quando foi **adicionado à coleção**. As duas separadas, porque um vídeo reaproveitado tem
  datas diferentes. Instância que não informa a data simplesmente não a exibe.
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

5. **Baixar planilha (.xlsx)** exporta o resultado em duas abas:

| Aba | Colunas |
|---|---|
| **Vídeos alocados** | Vídeo, Duração, Minutos, Enviado ao Studio, Adicionado à coleção, Onde está (item), Módulo, Tipo do item, Como foi inserido, Item publicado, ID da mídia |
| **Vídeos não alocados** | Vídeo, Duração, Minutos, Enviado ao Studio, Adicionado à coleção, ID da mídia |

A coluna *Minutos* é numérica e as duas de data são data de verdade (não texto), então dá para
somar, ordenar por período e montar tabela dinâmica direto no Excel. Cada aba fecha com uma
linha de TOTAL.

### As duas datas

O Studio guarda duas datas para cada vídeo, e elas respondem a perguntas diferentes:

| Coluna | O que é |
|---|---|
| **Enviado ao Studio** | quando a gravação entrou na biblioteca. É a identidade do vídeo: não muda se ele for reaproveitado. |
| **Adicionado à coleção** | quando esse vídeo foi posto **nesta** coleção. |

É por isso que elas aparecem separadas: um vídeo gravado em março pode entrar numa coleção em
agosto e em outra no semestre seguinte — com uma data só, o reaproveitamento some. Nas listas
do painel, quando as duas caem no mesmo dia (o caso comum) aparece só uma; quando divergem,
aparecem as duas: `enviado 15/03/2024 · na coleção 01/08/2024`.

> Nenhuma das duas é "quando o vídeo foi publicado numa página do Canvas" — isso o Studio não
> sabe. Instâncias que não informem alguma das datas deixam a coluna vazia; o resto não muda.
> Para ver de qual campo cada data saiu, use *Salvar diagnóstico* (`noStudio=` e `naColecao=`)
> ou o console do frame do Studio.

6. **Transcrição dos vídeos.** Cada vídeo das listas ganha um botão **📄** que baixa a
transcrição em `.txt` — o mesmo texto que o player entrega no menu ⋮ → **"Baixar histórico"**
(tradução de *Download Transcript*), já limpo e em frases, com título, duração e ID no cabeçalho.

E, acima das listas, **Baixar transcrições por módulo** traz um botão por módulo do curso:

```
PESQUISA                    📄 4
4 vídeos · 48min
```

Um clique baixa a transcrição de todos os vídeos daquele módulo, um `.txt` por vídeo, mostrando
o progresso no botão. Se algum falhar, os outros continuam e o painel diz quais não saíram.

> **Deixe a biblioteca do Studio carregar antes do primeiro download.** É nesse momento que a
> extensão capta como falar com a API do Studio. Sem isso, a consulta da legenda volta 401 —
> é a causa nº 1 de o botão não funcionar. Detalhes em `docs/transcricoes-studio.md`.

## Segurança / privacidade

- A extensão **lê apenas o número da coleção na URL** do frame do Studio.
- A URL do Studio inclui um parâmetro `lti_params` (um **JWT de login** com dados pessoais e uma
  chave de integração). A extensão **não usa nem armazena** esse token; ela apenas decodifica, **em
  memória**, os campos `lti_course_id`, `canvas_domain` e o nome do curso para exibir o mapeamento
  Studio ↔ Canvas. E-mail, user_id e oauth_key **nunca** são lidos nem gravados.
- A contagem de vídeos, as durações e as datas vêm de "escutar" a chamada de listagem que o
  próprio Studio já faz (endpoint `tiles`), autenticada pela **sua sessão** — **não** usa nem
  requer chave de API do Studio.
- Como essa listagem é **paginada**, para somar a coleção inteira a extensão **repete essa mesma
  chamada de leitura** (`GET`) para as páginas restantes, no próprio servidor do Studio e com a
  sua sessão. Teto de segurança: 50 páginas (1000 vídeos).
- A **análise dos módulos** lê, pela API do Canvas e com a sua sessão, a lista de módulos e o
  corpo dos itens que podem conter vídeo. Nesse conteúdo ela procura **apenas os identificadores
  dos vídeos do Studio** (`custom_arc_media_id`, `lti_launch_id` e `notorious_id`). O resto do
  conteúdo não é interpretado, guardado nem enviado.
- O acesso ao domínio do Canvas é uma **permissão opcional**, pedida na primeira análise. Se você
  negar, tudo o mais continua funcionando.
- A **transcrição** é baixada só quando você pede — no 📄 de um vídeo ou no botão de um módulo.
  A extensão pergunta ao Studio quais legendas aquele vídeo tem (`media/{id}/caption_files`) e
  baixa o arquivo, tudo com a **sua sessão**. Quem faz essa chamada é o frame do Studio, onde os
  cabeçalhos de sessão já estão: eles **nunca são gravados** nem saem da aba. O texto vai direto
  para o arquivo salvo e **não é armazenado**.
- **Nada vai para fora do navegador** e **nada é gravado em disco** (fora os arquivos que você
  manda baixar). O inventário da coleção e o resultado da análise ficam em
  `chrome.storage.session` — memória do navegador, apagada quando o Chrome fecha — para o painel
  não perder os dados a cada navegação.
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
│  ├─ net-hook.js         # lê a listagem do Studio: vídeos, durações, pagina tudo,
│  │                      #   e aprende a rota da transcrição para repeti-la por vídeo
│  ├─ canvas-scan.js      # varre os módulos e cruza os embeds com o acervo
│  ├─ xlsx.js            # gera a planilha (.xlsx é um ZIP de XMLs; sem biblioteca)
│  ├─ format.js           # formata segundos como "12h 37min"
│  └─ studio.js           # detecta o collection_id na URL e injeta o botão
├─ panel/
│  ├─ panel.html
│  └─ panel.js            # painel lateral: coleção, ações e análise
├─ docs/
│  ├─ canvas-api-extensao.md              # pesquisa de APIs e decisões de arquitetura
│  ├─ automacao-embed-studio-em-paginas.md # anatomia do embed do Studio (base da análise)
│  ├─ transcricoes-studio.md              # como o Studio entrega a transcrição (rotas e formato)
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
