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
Mostra e copia o ID da coleção do Canvas Studio e a quantidade de vídeos, direto da página.
```

### Descrição detalhada
```
Descubra e copie o ID de uma coleção do Canvas Studio em um clique — sem precisar abrir o código-fonte da página.

Para quem gerencia vídeos no Canvas Studio, encontrar o ID de uma coleção costuma ser um processo manual e demorado: abrir o código-fonte do frame e garimpar o número no meio do HTML. Esta extensão automatiza isso.

O QUE ELA FAZ
• Detecta automaticamente quando você está numa coleção do Canvas Studio.
• Mostra um botão com o ID da coleção — clicou, copiou.
• Exibe a quantidade de vídeos da coleção.
• No ícone da extensão, mostra também a disciplina e o ID do curso no Canvas correspondente.

COMO USAR
1. Entre num curso no Canvas e abra o Studio pela navegação do curso.
2. O botão com o ID da coleção aparece na tela.
3. Clique para copiar. Pronto.

PRIVACIDADE
• Funciona apenas nas páginas do Canvas Studio (instructuremedia.com).
• Não coleta, não armazena e não envia nenhum dado para fora do seu navegador.
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
2. O popup da extensão aberto, mostrando ID + vídeos + disciplina.

---

## 4. Aba "Privacy practices" (Práticas de privacidade)

### Propósito único (single purpose)
```
Ajudar quem gerencia vídeos no Canvas Studio a obter rapidamente o ID de uma coleção (e a quantidade de vídeos) diretamente da página, copiando-o com um clique, sem precisar inspecionar o código-fonte.
```

### Justificativa das permissões

**activeTab**
```
Quando o usuário clica no ícone da extensão, o popup consulta apenas a aba ativa para identificar qual coleção do Canvas Studio está aberta e exibir o ID. Nenhuma outra aba é acessada.
```

**clipboardWrite**
```
Permite copiar o ID da coleção para a área de transferência quando o usuário clica no botão de copiar.
```

**Acesso ao site (host permission: https://*.instructuremedia.com/*)**
```
A extensão é executada somente nas páginas do Canvas Studio (instructuremedia.com) para: (1) ler o ID da coleção que já está na URL da página e exibir um botão para copiá-lo; e (2) ler a quantidade de vídeos da resposta que o próprio Studio já carrega. Nenhum dado é enviado para fora do navegador e nenhum outro site é acessado.
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
