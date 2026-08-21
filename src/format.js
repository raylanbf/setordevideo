// Setor de Vídeo — Canvas Studio · formatação de duração
// Carregado tanto no content script quanto no popup (ver manifest.json e popup.html).

// Segundos -> "12h 37min" / "45min" / "38s". Devolve null quando não há duração.
function sdvFormatDuration(totalSeconds) {
  const sec = Math.max(0, Math.round(Number(totalSeconds) || 0));
  if (sec === 0) return null;
  if (sec < 60) return `${sec}s`;

  let h = Math.floor(sec / 3600);
  let m = Math.round((sec - h * 3600) / 60);
  if (m === 60) {
    h += 1;
    m = 0;
  }

  if (h > 0) return m > 0 ? `${h}h ${m}min` : `${h}h`;
  return `${m}min`;
}

// Segundos -> "1:24:35" / "16:08". Formato de relógio, para a planilha.
function sdvFormatRelogio(totalSeconds) {
  const sec = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  const dois = (n) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${dois(m)}:${dois(s)}` : `${m}:${dois(s)}`;
}
