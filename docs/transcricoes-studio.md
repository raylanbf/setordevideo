# Transcrições do Canvas Studio — como a extensão as obtém

Registro da investigação que levou ao download automático das transcrições ("Baixar histórico"
no menu ⋮ do player). Tudo aqui foi **observado na instância `pucminas.instructuremedia.com`**,
não documentado oficialmente pela Instructure — por isso o registro, e por isso a extensão
descobre boa parte em tempo de execução em vez de fixar valores no código.

> **"Baixar histórico" é tradução de "Download Transcript".** O tradutor pegou *transcript* no
> sentido de *histórico escolar*. Ao procurar endpoints ou código, busque por `transcript` e
> `caption` — nunca por `history`.

---

## 1. Resumo: são duas chamadas

```
1) GET /api/media_management/media/{media_id}/caption_files      → lista as legendas do vídeo
2) GET {url devolvida por (1)}                                   → baixa a transcrição
```

A primeira **exige os cabeçalhos de sessão da SPA**. A segunda funciona só com o cookie.
Essa assimetria é a chave de tudo (§3).

---

## 2. Anatomia das duas chamadas

### 2.1. Listar as legendas de um vídeo

```
GET https://<studio>/api/media_management/media/27547/caption_files
```

Resposta real (um vídeo, uma legenda):

```json
{"caption_files":[{
  "id": 5940,
  "url": "/api/media_management/caption_files/821cb4ea-d128-4bff-94dd-ecb0e8ca7c1b-27547",
  "srclang": "pt",
  "subtitle_format": "srt",
  "label": "Português",
  "status": "published",
  "created_at": "2020-03-02T18:38:40Z",
  "provider": "notorious",
  "is_empty": false,
  "number_of_errors": 0
}]}
```

**Use o campo `url`, nunca o `id`.** O `id` (`5940`) é a chave interna do registro e **não**
serve na rota de download — tentá-lo devolve `404`. Foi o último bug da investigação.

### 2.2. Baixar a transcrição

```
GET https://<studio>/api/media_management/caption_files/821cb4ea-…-27547
```

Apesar de `subtitle_format: "srt"`, a resposta é **JSON**:

```json
{"caption_file":{"sequences":[
  {"id":1,"text":"Olá seja bem vindo a essa aula da disciplina redes","start_time":4.89,"end_time":8.1},
  {"id":2,"text":"neurais e aprendizagem profunda.\nEssa vídeo aula","start_time":8.1,"end_time":11.63}
]}}
```

Os trechos **quebram frases no meio** e trazem `\n` internos. Para reproduzir o texto que o
player entrega: normalizar espaços de cada `text`, descartar repetições consecutivas, juntar
tudo com espaço e quebrar linha após `.`/`!`/`?`.

> **Validado:** a saída da extensão foi comparada, caractere a caractere, com o arquivo baixado
> pelo botão do player para o mesmo vídeo. **6873 caracteres, idênticos.**

### 2.3. O identificador do arquivo de legenda

Formato: `{uuid}-{media_id}` — por exemplo `821cb4ea-d128-4bff-94dd-ecb0e8ca7c1b-27547`.

**Parece um `lti_launch_id`, mas não é.** O `lti_launch_id` do mesmo vídeo é
`6770b53c-a35c-4538-a99a-c20f1baa90c8-27547`: mesmo sufixo (o `media_id`), **uuid diferente**.
O uuid da legenda é próprio do arquivo e **não pode ser derivado** do vídeo — só a chamada §2.1
o entrega. Confundir os dois custou várias rodadas de `404`.

O sufixo, porém, é útil: quando um id desses aparece em qualquer resposta, o `media_id` no final
diz a que vídeo pertence.

---

## 3. Por que a chamada precisa passar pelo frame do Studio

A API do Studio autentica por **cabeçalho**, não por cookie — o mesmo motivo pelo qual o
`net-hook` já reusava os cabeçalhos da SPA para paginar a coleção
([net-hook.js](../src/net-hook.js), cabeçalho do arquivo).

Chamada do painel da extensão (só cookie), por vídeo `260854`:

| Rota | Resposta |
|---|---|
| `/api/media_management/media/260854/caption_files` | **401** |
| `/api/media_management/media/260854` | **401** |
| `/api/media_management/media/260854/captions` | 404 |
| `/api/media_management/caption_files?media_id=260854` | 404 |

**401 ≠ 404**, e foi essa distinção que resolveu o caso: as duas primeiras rotas *existem* e
apenas recusaram a chamada não autenticada. As outras duas não existem.

O download (§2.2) é exceção: aceita cookie, porque é o endereço que o próprio navegador abre
quando o usuário clica no menu.

**Consequência de projeto:** a consulta roda no `net-hook`, dentro do frame do Studio, onde os
cabeçalhos da sessão já vivem em memória. Eles **nunca** são gravados nem enviados ao painel —
é o painel que pede, e o frame que executa.

---

## 4. Como está implementado

| Onde | Papel |
|---|---|
| [net-hook.js](../src/net-hook.js) | Captura os cabeçalhos de uma chamada autenticada da SPA (a listagem `tiles`). Consulta as legendas de um vídeo e baixa a transcrição. |
| [studio.js](../src/studio.js) | Ponte: recebe o pedido do painel e o encaminha ao `net-hook` via `postMessage`. Só responde se o frame tiver cabeçalhos ou molde. |
| [background.js](../src/background.js) | Guarda em `chrome.storage.session` o molde do endereço e o mapa `media_id → arquivo de legenda`. Nunca guarda cabeçalhos. |
| [panel.js](../panel/panel.js) | Botão 📄 por vídeo, download por módulo, conversão para texto e o relatório de diagnóstico. |

**Ordem de operação que importa:** os cabeçalhos só são capturados quando a listagem da coleção
passa pelo `net-hook`. Na prática, é preciso que a **grade do Studio tenha carregado** na aba
antes do primeiro download. Sem isso, a consulta volta 401.

### Caminhos de descoberta, em ordem

1. **Mapa da sessão** — `media_id → arquivo de legenda`, do que já passou.
2. **Molde aprendido** — se o usuário usou "Baixar histórico", o endereço observado serve para
   o vídeo cujo `media_id` é o sufixo do id.
3. **Consulta à API** (§2.1) — o caminho que funciona para todos e dispensa abrir vídeos.

O passo 3 testa algumas formas de rota e fica com a que responder; a que venceu está em §2.1.
A descoberta é feita uma vez e reusada.

---

## 5. Becos sem saída (não repita)

- **Derivar o id da legenda do `lti_launch_id`.** Uuid diferente (§2.3). Sempre `404`.
- **Usar o `id` numérico da listagem** (`5940`) na rota de download. Sempre `404`.
- **Chamar a API só com cookie**, do painel ou de um content script comum. Sempre `401` (§3).
- **Esperar VTT ou SRT.** O download vem em JSON, apesar de `subtitle_format: "srt"` (§2.2).
- **Procurar o id da legenda na listagem da coleção (`tiles`).** Ela traz apenas
  `has_captions`, `can_manage_captions` e `author.captioning_role_id` — nenhum identificador.
- **Decidir se um id é "de vídeo" antes de o inventário carregar.** Com `stats` vazio tudo
  parece desconhecido, e a extensão grava o id errado. Decida no momento do uso.

---

## 6. `has_captions`: o que a listagem da coleção entrega

A resposta `tiles` traz, por vídeo, `data.media.has_captions` — que diz **se existe legenda**,
mas não qual é. Serve para saber de antemão quais vídeos têm transcrição disponível (relatório
de acessibilidade), sem custo de rede adicional.

---

## 7. Diagnóstico

O painel tem **"Salvar diagnóstico (.txt)"**, abaixo de "Baixar planilha". O arquivo traz:

- o acervo com `media_id`, `lti_launch_id` e `notorious_id` de cada vídeo;
- cada tentativa, com endereço, código de resposta e um trecho do corpo;
- o que aconteceu **dentro do frame** (a consulta à API), que não aparece no console do painel;
- o mapa de arquivos de legenda conhecidos e de onde vieram.

Foi essa ferramenta que resolveu a investigação. Os prints do console mostravam um contexto por
vez — o painel e o frame do Studio são contextos separados, e o erro morava justamente na
fronteira entre eles. O relatório junta os dois numa mesma linha do tempo.

Para o log detalhado do `net-hook`, no console do frame do Studio:

```js
localStorage.setItem("sdv-debug", "1")
```

---

## 8. Se parar de funcionar

1. Salve o diagnóstico e veja o código de resposta.
2. **401** → os cabeçalhos não foram capturados: carregue a grade da coleção e tente de novo.
3. **404 na listagem** → a rota de §2.1 mudou. Abra a aba Network com um vídeo abrindo,
   filtre por `media_management` e veja a rota nova.
4. **200 mas sem transcrição** → o formato de §2.2 mudou; o diagnóstico traz um trecho do corpo.
