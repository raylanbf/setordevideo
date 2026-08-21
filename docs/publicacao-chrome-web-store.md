# Kit de publicação — Chrome Web Store

Textos e requisitos para publicar a extensão **Setor de Vídeo — Canvas Studio**.
Copie e cole cada campo no painel do Chrome Web Store Developer Dashboard.

---

## 1. Conta e taxa

- Conta de desenvolvedor no [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
- **Taxa única de US$ 5** (uma vez por conta, não por extensão).

---

## 2. Aba "Store listing" (Listagem)

### Nome do produto
```
Setor de Vídeo — Canvas Studio
```

### Descrição curta (summary) — máx. 132 caracteres  *(já no manifest)*
```
Painel lateral do Canvas Studio: ID da coleção, duração total e quais vídeos estão nos módulos do curso.
```

### Descrição detalhada
```
Saiba quantas horas de vídeo o seu curso tem — e quanto disso está realmente publicado nas páginas.

Para quem gerencia vídeos no Canvas Studio, duas tarefas costumam ser manuais e demoradas: encontrar o ID de uma coleção (abrindo o código-fonte do frame e garimpando o número no HTML) e conferir, vídeo por vídeo, o que já foi publicado nos módulos do curso. Esta extensão automatiza as duas, num painel lateral.

O QUE ELA FAZ
• Painel lateral que abre ao lado da página, sem tapar o conteúdo do curso.
• Abre o Canvas Studio do curso por um botão, a partir de qualquer página daquele curso.
• Detecta automaticamente quando você está numa coleção do Canvas Studio e mostra o ID — clicou, copiou.
• Soma a duração de TODOS os vídeos da coleção (percorrendo todas as páginas da lista) e mostra o total em horas e minutos.
• Analisa os módulos do curso e informa quantos vídeos — e quantas horas — estão de fato publicados nas páginas, tarefas, quizzes e discussões, separando o que sobrou na coleção sem ser usado.
• Mostra em qual item do curso cada vídeo aparece, com link direto — e abre o vídeo no Studio para conferência.
• Exporta tudo em planilha Excel (.xlsx), com uma aba de vídeos alocados e outra de não alocados.

COMO USAR
1. Entre num curso no Canvas e clique no ícone da extensão: o painel abre à direita.
2. Clique em "Abrir o Studio deste curso" e deixe a biblioteca carregar.
3. Volte ao curso e clique em "Analisar módulos do curso".
4. O painel mostra quanto do acervo está nos módulos e o que sobrou.
5. Se quiser, baixe a planilha (.xlsx) com as duas listas.

PRIVACIDADE
• Funciona apenas nas páginas do Canvas Studio (instructuremedia.com).
• Não coleta, não armazena e não envia nenhum dado para fora do seu navegador — as únicas consultas feitas são ao próprio Canvas Studio, para ler a lista de vídeos da coleção.
• Usa a sua própria sessão já autenticada — não pede login, token nem chave de API.

Ideal para setores de produção de vídeo, equipes de EAD e administradores que trabalham com o Canvas Studio.
```

### Categoria
- Primária sugerida: **Fluxo de trabalho e planejamento** (Workflow & Planning)
- Alternativa: **Educação**

### Idioma
- **Português (Brasil)**

---

## 3. Imagens (assets)

| Item | Dimensão | Obrigatório? | Status |
|------|----------|--------------|--------|
| Ícone da loja | 128×128 PNG | ✅ Sim | ✔️ Temos (`icons/icon128.png`) |
| Screenshot | 1280×800 **ou** 640×400 (PNG/JPEG) | ✅ Sim (mín. 1, máx. 5) | ❌ Falta — precisa de print da extensão |
| Tile promocional pequeno | 440×280 PNG | ➖ Opcional | Pode gerar do ícone |
| Marquee promocional | 1400×560 PNG | ➖ Opcional | Pode gerar do ícone |

**Screenshots sugeridos:**
1. O botão "🎬 Coleção: … · N vídeos" aparecendo na página do Studio.
2. O painel lateral aberto, mostrando ID + vídeos + duração total.
3. O painel com o resultado da análise dos módulos (acervo x usados x sem uso).

---

## 4. Aba "Privacy practices" (Práticas de privacidade)

### Propósito único (single purpose)
```
Ajudar quem gerencia vídeos no Canvas Studio a dimensionar o acervo de vídeo de um curso: obter o ID da coleção, a quantidade de vídeos e a duração total, e comparar esse acervo com os vídeos efetivamente incorporados nos módulos do curso, para saber quanto tempo de vídeo está publicado e o que sobrou sem uso.
```

### Justificativa das permissões

**activeTab**
```
Quando o usuário clica no ícone da extensão, o painel lateral consulta apenas a aba ativa para identificar qual coleção do Canvas Studio está aberta e exibir o ID. Se a aba estiver numa página de curso do Canvas fora do Studio, a mesma permissão é usada para localizar o link do Studio daquele curso e abri-lo. Nenhuma outra aba é acessada.
```

**sidePanel**
```
Exibe o painel lateral, que é a interface principal da extensão: mostra os dados da coleção do Canvas Studio e o resultado da análise dos módulos ao lado da página do curso.
```

**storage**
```
Mantém em chrome.storage.session (memória do navegador, nunca em disco, descartada ao fechar o Chrome) a lista de vídeos da coleção — título, duração e identificador. É o que permite ao painel comparar a coleção com os módulos depois que o usuário sai da página do Studio. Nada é gravado em disco nem enviado a lugar nenhum.
```

**scripting**
```
Quando o usuário clica no ícone da extensão fora do Canvas Studio, a extensão lê da página de curso aberta apenas o endereço do link "Studio" que o próprio Canvas exibe na navegação do curso, para abrir o Studio naquela aba. A leitura acontece somente nesse clique, somente na aba ativa (permissão activeTab), não altera a página e nada é armazenado.
```

**downloads**
```
Salva no computador do usuário a planilha (.xlsx) com o resultado da análise, quando ele clica em "Baixar planilha". O arquivo é montado inteiramente no navegador, a partir de dados que já estão na tela; nada é enviado para servidores.
```

**clipboardWrite**
```
Permite copiar o ID da coleção para a área de transferência quando o usuário clica no botão de copiar.
```

**Acesso ao site (host permission: https://*.instructuremedia.com/*)**
```
A extensão é executada somente nas páginas do Canvas Studio (instructuremedia.com) para: (1) ler o ID da coleção que já está na URL da página e exibir um botão para copiá-lo; (2) ler a quantidade de vídeos e a duração de cada vídeo na listagem que o próprio Studio já carrega; e (3) como essa listagem é paginada (20 por página), repetir a mesma consulta de leitura (GET) ao próprio Studio para as páginas seguintes, de modo que a duração exibida seja a da coleção inteira. Todas as requisições são somente leitura, vão para o próprio Canvas Studio e usam a sessão que o usuário já tem. Nenhum dado é enviado para fora do navegador e nenhum outro site é acessado.
```

**Acesso opcional ao site do Canvas (optional host permission: https://*.instructure.com/*)**
```
Solicitado apenas quando o usuário clica em "Analisar módulos do curso". Com a sessão do próprio usuário, a extensão lê a lista de módulos do curso e o conteúdo dos itens que podem conter vídeo (páginas, tarefas, quizzes e discussões) para localizar os vídeos do Canvas Studio incorporados. A busca é apenas pelos identificadores dos vídeos do Canvas Studio — o parâmetro custom_arc_media_id do código de incorporação e o identificador da mídia presente nas URLs do Studio, para reconhecer o vídeo tanto quando ele é inserido pelo menu quanto quando é colado na página. Nenhuma outra informação do conteúdo é interpretada, exibida, armazenada ou enviada; nenhuma página é criada, alterada ou apagada. Se o usuário negar a permissão, o restante da extensão continua funcionando normalmente.
```

### Uso de código remoto (remote code)
- **Não.** Todo o código está incluído no pacote; nada é baixado ou executado remotamente.

### Coleta/uso de dados (data usage)
- **Não coleta nenhum tipo de dado** do usuário. Deixe todas as categorias desmarcadas.
- Marque as três certificações finais:
  - ✔️ Não vendo nem transfiro dados a terceiros (fora dos usos aprovados).
  - ✔️ Não uso nem transfiro dados para fins alheios ao propósito único.
  - ✔️ Não uso nem transfiro dados para avaliar solvência ou conceder empréstimos.

### URL da política de privacidade
```
https://github.com/raylanbf/setordevideo/blob/main/PRIVACY.md
```

### E-mail de contato do desenvolvedor
```
raylan.oficial@gmail.com
```

---

## 5. Aba "Distribution" (Distribuição)

- **Visibilidade:** Pública (ou "Não listada" se quiser link privado).
- **Distribuição:** Todas as regiões (ou selecione Brasil).
- **Preço:** Gratuito.

---

## 6. Pacote

- Suba o ZIP: `setordevideo-extensao.zip` (gerado com `manifest.json` na raiz e caminhos com `/`).
