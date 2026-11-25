/* barcode.js – lettore di codici a barre EAN-13, EAN-8 e UPC-A in JavaScript puro, senza librerie esterne.
   Serve dove il browser non ha BarcodeDetector (Safari e tutti i browser su iPhone).
   Metodo: legge molte linee di scansione dell'immagine (anche inclinate), le trasforma in sequenze
   barra/spazio, confronta le larghezze con i modelli EAN e controlla la cifra di controllo.
   API: window.EANScanner.createDetector() -> { detect(video) } come BarcodeDetector,
        window.EANScanner.decodeImageData(imageData) -> stringa o null (per i test). */
(function (global) {
  'use strict';

  // larghezze (in moduli) delle cifre: spazio, barra, spazio, barra
  const L = [[3, 2, 1, 1], [2, 2, 2, 1], [2, 1, 2, 2], [1, 4, 1, 1], [1, 1, 3, 2], [1, 2, 3, 1], [1, 1, 1, 4], [1, 3, 1, 2], [1, 2, 1, 3], [3, 1, 1, 2]];
  const G = L.map((p) => p.slice().reverse());
  const PARITY = ['LLLLLL', 'LLGLGG', 'LLGGLG', 'LLGGGL', 'LGLLGG', 'LGGLLG', 'LGGGLL', 'LGLGLG', 'LGLGGL', 'LGGLGL'];
  const MAX_AVG = 0.48, MAX_IND = 0.7;

  function variance(counters, pattern) {
    let total = 0, plen = 0;
    for (let i = 0; i < counters.length; i++) { total += counters[i]; plen += pattern[i]; }
    if (total < plen) return Infinity;
    const unit = total / plen, maxInd = MAX_IND * unit;
    let tv = 0;
    for (let i = 0; i < counters.length; i++) {
      const d = Math.abs(counters[i] - pattern[i] * unit);
      if (d > maxInd) return Infinity;
      tv += d;
    }
    return tv / total;
  }

  // cifra più simile; kinds = 'LG' per la metà sinistra, 'R' per la destra
  function matchDigit(c, kinds) {
    let best = -1, bestKind = '', bestV = MAX_AVG;
    for (let d = 0; d < 10; d++) {
      if (kinds.indexOf('L') >= 0 || kinds === 'R') {
        const v = variance(c, L[d]); if (v < bestV) { bestV = v; best = d; bestKind = kinds === 'R' ? 'R' : 'L'; }
      }
      if (kinds.indexOf('G') >= 0) {
        const v = variance(c, G[d]); if (v < bestV) { bestV = v; best = d; bestKind = 'G'; }
      }
    }
    return best < 0 ? null : { d: best, kind: bestKind };
  }

  function checksumOk(s) {
    let sum = 0; const n = s.length;
    for (let i = 0; i < n - 1; i++) { const d = s.charCodeAt(n - 2 - i) - 48; sum += d * (i % 2 === 0 ? 3 : 1); }
    return ((10 - (sum % 10)) % 10) === s.charCodeAt(n - 1) - 48;
  }

  function guardOk(runs, pos, count, minQuiet) {
    let sum = 0;
    for (let k = 0; k < count; k++) sum += runs[pos + k];
    const m = sum / count;
    for (let k = 0; k < count; k++) if (Math.abs(runs[pos + k] - m) > 0.6 * m) return 0;
    return m;
  }

  // prova a leggere un codice partendo dalla barra runs[i] (inizio della guardia iniziale)
  function readFrom(runs, i) {
    const m = guardOk(runs, i, 3);
    if (!m) return null;
    // zona di silenzio prima del codice (o bordo dell'immagine)
    if (i >= 2 && runs[i - 1] < 4 * m) return null;
    if (i === 0) return null;
    const n = runs.length;
    // EAN-13: 3 + 24 + 5 + 24 + 3 = 59 run; EAN-8: 3 + 16 + 5 + 16 + 3 = 43 run
    for (const digitsPerHalf of [6, 4]) {
      const total = 3 + digitsPerHalf * 4 + 5 + digitsPerHalf * 4 + 3;
      if (i + total > n) continue;
      let pos = i + 3; const left = []; const kinds = [];
      let ok = true;
      for (let k = 0; k < digitsPerHalf && ok; k++, pos += 4) {
        const r = matchDigit(runs.slice(pos, pos + 4), digitsPerHalf === 6 ? 'LG' : 'L');
        if (!r) ok = false; else { left.push(r.d); kinds.push(r.kind); }
      }
      if (!ok) continue;
      if (!guardOk(runs, pos, 5)) continue;
      pos += 5;
      const right = [];
      for (let k = 0; k < digitsPerHalf && ok; k++, pos += 4) {
        const r = matchDigit(runs.slice(pos, pos + 4), 'R');
        if (!r) ok = false; else right.push(r.d);
      }
      if (!ok) continue;
      if (!guardOk(runs, pos, 3)) continue;
      let code;
      if (digitsPerHalf === 6) {
        const pat = kinds.join(''); const first = PARITY.indexOf(pat);
        if (first < 0) continue;
        code = String(first) + left.join('') + right.join('');
      } else code = left.join('') + right.join('');
      if (checksumOk(code)) return code;
    }
    return null;
  }

  // sequenza di run [bianco/nero alternati] -> codice, in entrambi i versi di lettura
  function decodeRuns(runs, firstBlack) {
    const tryDir = (rs, black0) => {
      // la prima barra nera può stare in posizione 0 o 1
      for (let i = black0 ? 0 : 1; i + 3 <= rs.length; i += 2) {
        const c = readFrom(rs, i); if (c) return c;
      }
      return null;
    };
    const a = tryDir(runs, firstBlack); if (a) return a;
    const rev = runs.slice().reverse();
    // dopo l'inversione il colore del primo run dipende dalla parità della lunghezza
    const revFirstBlack = (runs.length % 2 === 1) ? firstBlack : !firstBlack;
    return tryDir(rev, revFirstBlack);
  }

  // luminanza di una linea -> run (binarizzazione locale con minimo/massimo in una finestra)
  function lineToRuns(vals, win) {
    const n = vals.length;
    if (n < 100) return null;
    // leggero filtro passa-basso
    const s = new Float32Array(n);
    s[0] = vals[0]; s[n - 1] = vals[n - 1];
    for (let i = 1; i < n - 1; i++) s[i] = (vals[i - 1] + 2 * vals[i] + vals[i + 1]) / 4;
    // minimo e massimo in finestra scorrevole (code monotone)
    const half = win >> 1;
    const mn = new Float32Array(n), mx = new Float32Array(n);
    const qa = new Int32Array(n), qb = new Int32Array(n);
    let ah = 0, at = 0, bh = 0, bt = 0;
    for (let i = 0, j = 0; i < n; i++) {
      const hi = Math.min(n - 1, i + half);
      for (; j <= hi; j++) {
        while (at > ah && s[qa[at - 1]] >= s[j]) at--; qa[at++] = j;
        while (bt > bh && s[qb[bt - 1]] <= s[j]) bt--; qb[bt++] = j;
      }
      const lo = i - half;
      while (qa[ah] < lo) ah++;
      while (qb[bh] < lo) bh++;
      mn[i] = s[qa[ah]]; mx[i] = s[qb[bh]];
    }
    const runs = []; let cur = -1, len = 0, firstBlack = false;
    for (let i = 0; i < n; i++) {
      const contrast = mx[i] - mn[i];
      const black = contrast >= 28 && s[i] < (mx[i] + mn[i]) / 2 ? 1 : 0;
      if (cur < 0) { cur = black; len = 1; firstBlack = black === 1; }
      else if (black === cur) len++;
      else { runs.push(len); cur = black; len = 1; }
    }
    runs.push(len);
    return { runs, firstBlack };
  }

  function sampleLine(gray, w, h, px, py, ca, sa) {
    const D = Math.ceil(Math.sqrt(w * w + h * h));
    const out = []; let started = false;
    for (let t = -D; t <= D; t++) {
      const x = px + t * ca, y = py + t * sa;
      if (x < 0 || y < 0 || x >= w - 1 || y >= h - 1) { if (started) break; else continue; }
      started = true;
      const x0 = x | 0, y0 = y | 0, fx = x - x0, fy = y - y0, i = y0 * w + x0;
      out.push(gray[i] * (1 - fx) * (1 - fy) + gray[i + 1] * fx * (1 - fy) + gray[i + w] * (1 - fx) * fy + gray[i + w + 1] * fx * fy);
    }
    return out;
  }

  const ANGLE_GROUPS = [
    [0, 4, -4, 8, -8],
    [14, -14, 22, -22, 32, -32],
    [90, 85, 95, 80, 100],
    [45, -45, 60, -60, 120, -120]
  ];

  // restituisce { code: numero di linee che l'hanno letto }
  function scanGray(gray, w, h, groups) {
    const hits = {};
    const cx = w / 2, cy = h / 2;
    const step = Math.max(10, Math.round(h / 36));
    for (const gi of groups) {
      for (const deg of ANGLE_GROUPS[gi]) {
        const th = deg * Math.PI / 180, ca = Math.cos(th), sa = Math.sin(th);
        const span = (deg === 0 || Math.abs(deg) <= 8) ? 0.46 : 0.38;
        const lines = Math.floor((span * h * 2) / step);
        for (let k = 0; k <= lines; k++) {
          const o = -span * h + k * step;
          const vals = sampleLine(gray, w, h, cx - o * sa, cy + o * ca, ca, sa);
          for (const win of [31, 81]) {
            const r = lineToRuns(vals, win); if (!r) continue;
            const c = decodeRuns(r.runs, r.firstBlack);
            if (c) { hits[c] = (hits[c] || 0) + 1; break; }
          }
        }
      }
    }
    return hits;
  }

  function toGray(rgba, n) {
    const g = new Uint8Array(n);
    for (let i = 0, j = 0; i < n; i++, j += 4) g[i] = (rgba[j] * 77 + rgba[j + 1] * 151 + rgba[j + 2] * 28) >> 8;
    return g;
  }

  // per i test: legge un'immagine intera provando tutte le direzioni
  function decodeImageData(img) {
    const gray = toGray(img.data, img.width * img.height);
    const hits = scanGray(gray, img.width, img.height, [0, 1, 2, 3]);
    let best = null, bc = 0;
    for (const c in hits) if (hits[c] > bc) { best = c; bc = hits[c]; }
    return bc >= 2 ? best : null;   // come nel lettore dal vivo: serve la conferma di almeno due linee
  }

  // lettore con la stessa interfaccia di BarcodeDetector (detect(video) -> [{ rawValue }])
  function createDetector() {
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    let frame = 0; const seen = {};   // codice -> istante dell'ultima lettura isolata
    return {
      async detect(video) {
        const vw = video.videoWidth, vh = video.videoHeight;
        if (!vw || !vh) return [];
        const sc = Math.min(1, 1280 / vw);
        const w = Math.round(vw * sc), h = Math.round(vh * sc);
        if (canvas.width !== w || canvas.height !== h) { canvas.width = w; canvas.height = h; }
        ctx.drawImage(video, 0, 0, w, h);
        const img = ctx.getImageData(0, 0, w, h);
        const gray = toGray(img.data, w * h);
        // ogni fotogramma: direzioni principali + un gruppo di direzioni a rotazione
        const rot = [1, 2, 3][frame++ % 3];
        const hits = scanGray(gray, w, h, [0, rot]);
        const now = Date.now(); const out = [];
        for (const c in hits) {
          // conferma: due linee nello stesso fotogramma, oppure lo stesso codice in due fotogrammi vicini
          if (hits[c] >= 2 || (seen[c] && now - seen[c] < 2500)) out.push({ rawValue: c, format: c.length === 8 ? 'ean_8' : 'ean_13' });
          else seen[c] = now;
        }
        return out;
      }
    };
  }

  global.EANScanner = { createDetector, decodeImageData, _scanGray: scanGray, _decodeRuns: decodeRuns };
})(typeof window !== 'undefined' ? window : globalThis);
