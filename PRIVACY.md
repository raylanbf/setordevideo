# Política de Privacidade — Setor de Vídeo (Canvas Studio)

**Última atualização:** 20 de agosto de 2026

A extensão **"Setor de Vídeo — Canvas Studio"** foi desenvolvida com foco em privacidade.

## Dados coletados

A extensão **não coleta, não armazena e não transmite** nenhum dado pessoal ou de uso.
Nenhuma informação é enviada para o desenvolvedor nem para terceiros.

## Como funciona

- É executada nas páginas do **Canvas Studio** (domínio `instructuremedia.com`) e, quando o
  usuário autoriza, lê dados do curso no **Canvas** (domínio `instructure.com`).
- Lê o identificador (ID) da coleção que **já está presente na URL** da página e, da listagem
  que o próprio Studio carrega, o título e a duração de cada vídeo, para mostrar ao usuário
  quantos vídeos existem e quanto tempo somam.
- Para que a duração corresponda à coleção inteira (a listagem do Studio vem em páginas de 20
  vídeos), a extensão **repete a mesma consulta de leitura do Studio** para as páginas restantes,
  no próprio site do Studio e usando a sessão que o usuário já tem. São apenas leituras (`GET`).
- Na função **"Analisar módulos"**, a extensão consulta a API do Canvas — com a sessão do próprio
  usuário — para obter a lista de módulos do curso e o conteúdo dos itens que podem conter vídeo
  (páginas, tarefas, quizzes e discussões). Nesse conteúdo ela procura **apenas os identificadores
  dos vídeos do Canvas Studio** — o `custom_arc_media_id` do código de incorporação e o
  identificador da mídia presente nas URLs do Studio, usados para reconhecer o vídeo tanto quando
  ele é inserido pelo menu quanto quando é colado na página. Nenhuma outra informação do conteúdo
  é interpretada, exibida, guardada ou enviada.
- Nenhuma página é aberta, alterada, criada ou apagada. Todas as operações são de leitura.
- Toda a operação acontece **localmente, no navegador** do usuário. Nenhuma informação é enviada
  ao desenvolvedor, a servidores próprios ou a terceiros — as únicas requisições feitas são para
  o próprio Canvas e o próprio Canvas Studio da instituição do usuário.

## Armazenamento

- A extensão **não grava nada em disco** e não usa cookies próprios.
- A lista de vídeos da coleção (título, duração e identificador) é mantida em
  `chrome.storage.session`, que é **memória do navegador**: não é escrita em disco e é
  descartada quando o Chrome é fechado. Ela existe apenas para que o painel consiga comparar a
  coleção com os módulos depois que o usuário sai da página do Studio.

## Permissões e por que são usadas

- **sidePanel** — exibir o painel lateral, que é a interface da extensão.
- **activeTab** — identificar a coleção aberta na aba atual quando o usuário clica no ícone e,
  fora do Studio, localizar o link do Studio na página de curso que está aberta.
- **scripting** — ler o link "Studio" da navegação do curso no momento em que o usuário pede
  para abri-lo. Nenhuma outra informação da página é lida, e a página não é alterada.
- **storage** — manter a lista de vídeos da coleção em memória de sessão, como descrito acima.
- **clipboardWrite** — copiar o ID da coleção para a área de transferência quando o usuário
  clica no botão de copiar.
- **Acesso a `instructuremedia.com`** — necessário para a extensão funcionar dentro das páginas
  do Canvas Studio e para ler a listagem de vídeos da coleção (incluindo as páginas seguintes
  da lista, para somar a duração total).
- **Acesso a `instructure.com` (opcional)** — solicitado somente quando o usuário clica em
  "Analisar módulos", para ler os módulos e o conteúdo do curso em busca dos vídeos
  incorporados. Se o usuário negar, todo o restante da extensão continua funcionando.

## Contato

Dúvidas: **raylan.oficial@gmail.com**
