// Setor de Vídeo — Canvas Studio · gerador de planilha .xlsx
// Sem biblioteca externa: um .xlsx é um ZIP com alguns XMLs dentro, e o projeto é JS puro
// sem bundler. Gravamos o ZIP sem compressão (método "store"), que o Excel aceita.
//
// Uso:
//   const blob = sdvGerarXlsx([
//     { nome: "Alocados", colunas: [{ titulo: "Vídeo", largura: 46 }, …], linhas: [[…], …] },
//   ]);
// Strings viram texto; números viram célula numérica (dá para somar no Excel).

// --- ZIP ---------------------------------------------------------------------
const SDV_CRC_TABELA = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

function sdvCrc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) c = SDV_CRC_TABELA[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  return (c ^ 0xffffffff) >>> 0;
}

const sdvU16 = (v) => new Uint8Array([v & 255, (v >>> 8) & 255]);
const sdvU32 = (v) =>
  new Uint8Array([v & 255, (v >>> 8) & 255, (v >>> 16) & 255, (v >>> 24) & 255]);

function sdvJuntar(pedacos) {
  let total = 0;
  for (const p of pedacos) total += p.length;
  const saida = new Uint8Array(total);
  let i = 0;
  for (const p of pedacos) {
    saida.set(p, i);
    i += p.length;
  }
  return saida;
}

// Monta um ZIP "store" a partir de [{ nome, texto }].
function sdvZip(arquivos) {
  const codificador = new TextEncoder();
  const locais = [];
  const central = [];
  let offset = 0;

  for (const arq of arquivos) {
    const nome = codificador.encode(arq.nome);
    const dados = codificador.encode(arq.texto);
    const crc = sdvCrc32(dados);

    // 0x0800 = nomes em UTF-8; método 0 = sem compressão; data/hora fixas (irrelevantes).
    const cabecalho = sdvJuntar([
      sdvU32(0x04034b50), sdvU16(20), sdvU16(0x0800), sdvU16(0),
      sdvU16(0), sdvU16(0),
      sdvU32(crc), sdvU32(dados.length), sdvU32(dados.length),
      sdvU16(nome.length), sdvU16(0), nome,
    ]);
    locais.push(cabecalho, dados);

    central.push(
      sdvJuntar([
        sdvU32(0x02014b50), sdvU16(20), sdvU16(20), sdvU16(0x0800), sdvU16(0),
        sdvU16(0), sdvU16(0),
        sdvU32(crc), sdvU32(dados.length), sdvU32(dados.length),
        sdvU16(nome.length), sdvU16(0), sdvU16(0), sdvU16(0), sdvU16(0),
        sdvU32(0), sdvU32(offset), nome,
      ])
    );
    offset += cabecalho.length + dados.length;
  }

  const dirCentral = sdvJuntar(central);
  const fim = sdvJuntar([
    sdvU32(0x06054b50), sdvU16(0), sdvU16(0),
    sdvU16(arquivos.length), sdvU16(arquivos.length),
    sdvU32(dirCentral.length), sdvU32(offset), sdvU16(0),
  ]);

  return sdvJuntar([sdvJuntar(locais), dirCentral, fim]);
}

// --- XML ---------------------------------------------------------------------
function sdvXmlEsc(valor) {
  return String(valor)
    // caracteres de controle não são válidos em XML 1.0 e quebrariam o arquivo
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function sdvColunaLetra(indice) {
  let n = indice + 1;
  let letra = "";
  while (n > 0) {
    const resto = (n - 1) % 26;
    letra = String.fromCharCode(65 + resto) + letra;
    n = Math.floor((n - 1) / 26);
  }
  return letra;
}

// Excel recusa alguns caracteres em nome de aba e corta em 31.
function sdvNomeDeAba(nome, indice) {
  const limpo = String(nome || `Planilha${indice + 1}`).replace(/[\\/*?:[\]]/g, "-");
  return limpo.slice(0, 31) || `Planilha${indice + 1}`;
}

function sdvCelula(ref, valor, negrito) {
  const estilo = negrito ? ' s="1"' : "";
  if (typeof valor === "number" && isFinite(valor)) {
    return `<c r="${ref}"${estilo}><v>${valor}</v></c>`;
  }
  if (valor == null || valor === "") return `<c r="${ref}"${estilo}/>`;
  return `<c r="${ref}"${estilo} t="inlineStr"><is><t xml:space="preserve">${sdvXmlEsc(valor)}</t></is></c>`;
}

function sdvFolha(aba) {
  const colunas = aba.colunas || [];
  const larguras = colunas.length
    ? `<cols>${colunas
        .map((c, i) => `<col min="${i + 1}" max="${i + 1}" width="${c.largura || 18}" customWidth="1"/>`)
        .join("")}</cols>`
    : "";

  const linhas = [];
  linhas.push(
    `<row r="1">${colunas
      .map((c, i) => sdvCelula(`${sdvColunaLetra(i)}1`, c.titulo, true))
      .join("")}</row>`
  );
  (aba.linhas || []).forEach((linha, l) => {
    const r = l + 2;
    linhas.push(
      `<row r="${r}">${linha
        .map((v, i) => sdvCelula(`${sdvColunaLetra(i)}${r}`, v, !!aba.negritoUltima && l === aba.linhas.length - 1))
        .join("")}</row>`
    );
  });

  return (
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
    `<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
    larguras +
    `<sheetData>${linhas.join("")}</sheetData></worksheet>`
  );
}

function sdvGerarXlsx(abas) {
  const lista = (abas || []).map((a, i) => Object.assign({}, a, { nome: sdvNomeDeAba(a.nome, i) }));
  const ns = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

  const arquivos = [
    {
      nome: "[Content_Types].xml",
      texto:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">` +
        `<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>` +
        `<Default Extension="xml" ContentType="application/xml"/>` +
        `<Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>` +
        lista
          .map(
            (_, i) =>
              `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`
          )
          .join("") +
        `<Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>` +
        `</Types>`,
    },
    {
      nome: "_rels/.rels",
      texto:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        `<Relationship Id="rId1" Type="${ns}/officeDocument" Target="xl/workbook.xml"/>` +
        `</Relationships>`,
    },
    {
      nome: "xl/workbook.xml",
      texto:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="${ns}">` +
        `<sheets>` +
        lista
          .map((a, i) => `<sheet name="${sdvXmlEsc(a.nome)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`)
          .join("") +
        `</sheets></workbook>`,
    },
    {
      nome: "xl/_rels/workbook.xml.rels",
      texto:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">` +
        lista
          .map(
            (_, i) =>
              `<Relationship Id="rId${i + 1}" Type="${ns}/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`
          )
          .join("") +
        `<Relationship Id="rId${lista.length + 1}" Type="${ns}/styles" Target="styles.xml"/>` +
        `</Relationships>`,
    },
    {
      nome: "xl/styles.xml",
      texto:
        `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>` +
        `<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">` +
        `<fonts count="2"><font><sz val="11"/><name val="Calibri"/></font>` +
        `<font><b/><sz val="11"/><name val="Calibri"/></font></fonts>` +
        `<fills count="2"><fill><patternFill patternType="none"/></fill>` +
        `<fill><patternFill patternType="gray125"/></fill></fills>` +
        `<borders count="1"><border/></borders>` +
        `<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>` +
        `<cellXfs count="2"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>` +
        `<xf numFmtId="0" fontId="1" fillId="0" borderId="0" xfId="0" applyFont="1"/></cellXfs>` +
        `</styleSheet>`,
    },
  ];

  lista.forEach((aba, i) => {
    arquivos.push({ nome: `xl/worksheets/sheet${i + 1}.xml`, texto: sdvFolha(aba) });
  });

  return new Blob([sdvZip(arquivos)], {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });
}
