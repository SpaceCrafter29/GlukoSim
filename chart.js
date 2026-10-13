/* Verlauf – eigenes Canvas-Diagramm, horizontal scrollbar (0–24 Uhr) */
(function (root) {
  'use strict';
  const FARBE = {
    rot: '#FF6B7A', mint: '#5BD6B0', amber: '#FFB547', lila: '#B79CFF',
    text: 'rgba(233,237,248,0.55)', raster: 'rgba(255,255,255,0.06)', rasterStark: 'rgba(255,255,255,0.14)'
  };
  const hhmm = m => String(Math.floor(m / 60) % 24).padStart(2, '0') + ':' + String(Math.round(m % 60)).padStart(2, '0');

  class Verlauf {
    constructor(host, opt) {
      this.opt = Object.assign({ hoehe: 230, spuren: 0, spurHoehe: 36 }, opt || {});
      this.host = host;
      host.classList.add('verlauf');
      host.innerHTML = '';
      this.scroller = document.createElement('div'); this.scroller.className = 'verlauf-scroller';
      this.inner = document.createElement('div'); this.inner.className = 'verlauf-inner';
      this.canvas = document.createElement('canvas'); this.canvas.className = 'verlauf-canvas';
      this.spuren = document.createElement('div'); this.spuren.className = 'verlauf-spuren';
      this.inner.append(this.canvas, this.spuren);
      this.scroller.append(this.inner);
      this.achseL = document.createElement('canvas'); this.achseL.className = 'verlauf-achse links';
      this.achseR = document.createElement('canvas'); this.achseR.className = 'verlauf-achse rechts';
      host.append(this.scroller, this.achseL, this.achseR);
      this.daten = { serien: [], insulin: [], ziel: [70, 140], marker: [] };
      this.kreuz = null;
      this.pxProStunde = 60;
      this.canvas.addEventListener('click', e => {
        const r = this.canvas.getBoundingClientRect();
        const t = Math.max(0, Math.min(1440, (e.clientX - r.left) / this.pxProMin));
        this.kreuz = Math.round(t);
        this.zeichne();
        this.onTap && this.onTap(this.kreuz);
      });
      this.ro = new ResizeObserver(() => this.layout());
      this.ro.observe(host);
    }

    get pxProMin() { return this.pxProStunde / 60; }

    zoomStufen() {
      const w = this.host.clientWidth || 360;
      return [Math.max(12, (w - 8) / 24), 40, 72];
    }

    setZoom(stufe, ankerZeit) {
      const stufen = this.zoomStufen();
      this.zoomIndex = Math.max(0, Math.min(stufen.length - 1, stufe));
      const vorher = ankerZeit != null ? ankerZeit : this.sichtMitte();
      this.pxProStunde = stufen[this.zoomIndex];
      this.layout();
      this.zeigeZeit(vorher, false);
    }

    sichtMitte() {
      return (this.scroller.scrollLeft + this.scroller.clientWidth / 2) / this.pxProMin;
    }

    zeigeZeit(t, sanft) {
      const x = t * this.pxProMin - this.scroller.clientWidth / 2;
      this.scroller.scrollTo({ left: Math.max(0, x), behavior: sanft ? 'smooth' : 'auto' });
    }

    layout() {
      if (this.zoomIndex == null) this.zoomIndex = 1;
      const stufen = this.zoomStufen();
      this.pxProStunde = stufen[this.zoomIndex];
      const breite = Math.round(1440 * this.pxProMin);
      const h = this.opt.hoehe;
      const dpr = Math.min(window.devicePixelRatio || 1, 3);
      this.inner.style.width = breite + 'px';
      this.spuren.style.height = (this.opt.spuren * this.opt.spurHoehe) + 'px';
      this.canvas.style.width = breite + 'px'; this.canvas.style.height = h + 'px';
      this.canvas.width = Math.round(breite * dpr); this.canvas.height = Math.round(h * dpr);
      for (const a of [this.achseL, this.achseR]) {
        a.style.height = h + 'px'; a.width = Math.round(40 * dpr); a.height = Math.round(h * dpr);
      }
      this.dpr = dpr;
      this.zeichne();
      this.onLayout && this.onLayout();
    }

    setSpuren(n) { this.opt.spuren = n; this.spuren.style.height = (n * this.opt.spurHoehe) + 'px'; }

    setDaten(d) { this.daten = Object.assign(this.daten, d); this.zeichne(); }

    skala() {
      let maxG = 180;
      for (const s of this.daten.serien) for (let i = 0; i < s.G.length; i += 5) if (s.G[i] > maxG) maxG = s.G[i];
      const yMax = Math.min(520, Math.ceil((maxG + 25) / 50) * 50);
      let maxI = 30;
      for (const s of this.daten.insulin) for (let i = 0; i < s.I.length; i += 5) if (s.I[i] > maxI) maxI = s.I[i];
      const iMax = Math.ceil((maxI * 1.15) / 20) * 20;
      const h = this.opt.hoehe, oben = 14, unten = 26;
      return {
        yMin: 40, yMax, iMax, oben, unten, h,
        y: g => oben + (1 - (g - 40) / (yMax - 40)) * (h - oben - unten),
        yi: i => oben + (1 - i / iMax) * (h - oben - unten)
      };
    }

    zeichne() {
      if (!this.dpr) return;
      const c = this.canvas.getContext('2d'), dpr = this.dpr, S = this.skala();
      const W = this.canvas.width / dpr, H = S.h, px = this.pxProMin;
      const [lo, hi] = this.daten.ziel;
      c.setTransform(dpr, 0, 0, dpr, 0, 0);
      c.clearRect(0, 0, W, H);

      // Zonen
      c.fillStyle = 'rgba(91,214,176,0.09)';
      c.fillRect(0, S.y(hi), W, S.y(lo) - S.y(hi));
      c.fillStyle = 'rgba(255,107,122,0.10)';
      c.fillRect(0, S.y(lo), W, S.y(40) - S.y(lo));
      if (S.yMax > 250) { c.fillStyle = 'rgba(255,181,71,0.05)'; c.fillRect(0, S.y(S.yMax), W, S.y(250) - S.y(S.yMax)); }

      // Stundenraster
      const schritt = this.pxProStunde >= 36 ? 1 : 3;
      c.font = '500 11px Rubik, system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'alphabetic';
      for (let h = 0; h <= 24; h++) {
        const x = Math.round(h * 60 * px) + 0.5;
        c.strokeStyle = h % 6 === 0 ? FARBE.rasterStark : FARBE.raster;
        c.lineWidth = 1;
        c.beginPath(); c.moveTo(x, S.oben); c.lineTo(x, H - S.unten); c.stroke();
        if (h % schritt === 0 && h < 24) {
          c.fillStyle = FARBE.text;
          c.fillText(String(h).padStart(2, '0') + ':00', Math.max(18, x), H - 8);
        }
      }
      // Grenzlinien
      c.setLineDash([3, 5]); c.lineWidth = 1;
      for (const [g, f] of [[lo, 'rgba(255,107,122,0.45)'], [hi, 'rgba(91,214,176,0.45)']]) {
        c.strokeStyle = f; c.beginPath(); c.moveTo(0, S.y(g) + 0.5); c.lineTo(W, S.y(g) + 0.5); c.stroke();
      }
      c.setLineDash([]);

      // Marker (Einträge)
      for (const m of this.daten.marker) {
        const x = m.t * px;
        c.strokeStyle = m.farbe || 'rgba(255,255,255,0.12)';
        c.lineWidth = m.breite ? 0 : 1;
        if (m.breite) {
          c.fillStyle = m.farbe; c.fillRect(x, S.oben, m.breite * px, H - S.oben - S.unten);
        } else { c.beginPath(); c.moveTo(x + 0.5, S.oben); c.lineTo(x + 0.5, H - S.unten); c.stroke(); }
      }

      // Insulin (Fläche + Linie, rechte Achse)
      for (const s of this.daten.insulin) {
        c.beginPath();
        c.moveTo(0, S.yi(0));
        for (let t = 0; t <= 1440; t += 2) c.lineTo(t * px, S.yi(s.I[t]));
        c.lineTo(1440 * px, S.yi(0)); c.closePath();
        c.fillStyle = s.fuellung || 'rgba(183,156,255,0.16)'; c.fill();
        c.beginPath();
        for (let t = 0; t <= 1440; t += 2) { const y = S.yi(s.I[t]); t ? c.lineTo(t * px, y) : c.moveTo(0, y); }
        c.strokeStyle = s.farbe || FARBE.lila; c.lineWidth = 1.5; c.stroke();
      }

      // Blutzucker-Serien
      const verlauf = () => {
        const gr = c.createLinearGradient(0, S.y(S.yMax), 0, S.y(40));
        const p = g => Math.max(0, Math.min(1, (S.y(g) - S.y(S.yMax)) / (S.y(40) - S.y(S.yMax))));
        gr.addColorStop(0, FARBE.rot);
        gr.addColorStop(p(Math.max(hi + 60, 250)), FARBE.amber);
        gr.addColorStop(p(hi + 8), FARBE.amber);
        gr.addColorStop(p(hi - 8), FARBE.mint);
        gr.addColorStop(p(lo + 6), FARBE.mint);
        gr.addColorStop(p(lo - 6), FARBE.rot);
        gr.addColorStop(1, FARBE.rot);
        return gr;
      };
      const pfad = G => { c.beginPath(); for (let t = 0; t <= 1440; t += 2) { const y = S.y(G[t]); t ? c.lineTo(t * px, y) : c.moveTo(0, y); } };
      for (const s of this.daten.serien) {
        c.lineJoin = 'round'; c.lineCap = 'round';
        if (s.gestrichelt) {
          pfad(s.G); c.setLineDash([7, 6]); c.lineWidth = 2.5; c.strokeStyle = s.farbe || '#E9EDF8'; c.stroke(); c.setLineDash([]);
          continue;
        }
        const strich = s.farbe || verlauf();
        pfad(s.G); c.lineWidth = 9; c.globalAlpha = 0.14; c.strokeStyle = strich; c.stroke(); c.globalAlpha = 1;
        pfad(s.G); c.lineWidth = 3; c.strokeStyle = strich; c.stroke();
      }

      // Spitzenmarke der Hauptserie
      const haupt = this.daten.serien.find(s => !s.gestrichelt);
      if (haupt && this.daten.spitzeZeigen !== false) {
        let mt = 0; for (let t = 0; t <= 1440; t++) if (haupt.G[t] > haupt.G[mt]) mt = t;
        const x = mt * px, y = S.y(haupt.G[mt]);
        c.fillStyle = '#E9EDF8'; c.beginPath(); c.arc(x, y, 3.5, 0, 7); c.fill();
      }

      // Fadenkreuz
      if (this.kreuz != null && haupt) {
        const t = this.kreuz, x = t * px + 0.5;
        c.strokeStyle = 'rgba(233,237,248,0.6)'; c.lineWidth = 1;
        c.beginPath(); c.moveTo(x, S.oben); c.lineTo(x, H - S.unten); c.stroke();
        for (const s of this.daten.serien) {
          const y = S.y(s.G[t]);
          c.fillStyle = '#151B30'; c.beginPath(); c.arc(x, y, 6, 0, 7); c.fill();
          c.fillStyle = s.farbe || '#E9EDF8'; c.beginPath(); c.arc(x, y, 4, 0, 7); c.fill();
        }
      }
      this.zeichneAchsen(S);
    }

    zeichneAchsen(S) {
      const dpr = this.dpr, [lo, hi] = this.daten.ziel;
      const L = this.achseL.getContext('2d');
      L.setTransform(dpr, 0, 0, dpr, 0, 0); L.clearRect(0, 0, 40, S.h);
      const g1 = L.createLinearGradient(0, 0, 40, 0);
      g1.addColorStop(0, 'rgba(21,27,48,0.95)'); g1.addColorStop(0.7, 'rgba(21,27,48,0.75)'); g1.addColorStop(1, 'rgba(21,27,48,0)');
      L.fillStyle = g1; L.fillRect(0, 0, 40, S.h);
      L.font = '500 11px Rubik, system-ui, sans-serif'; L.textAlign = 'left'; L.textBaseline = 'middle';
      const werte = new Set([lo, hi]);
      for (let g = 100; g < S.yMax; g += S.yMax > 300 ? 100 : 50) if (Math.abs(g - lo) > 18 && Math.abs(g - hi) > 18) werte.add(g);
      for (const g of werte) {
        L.fillStyle = g === lo ? 'rgba(255,107,122,0.9)' : g === hi ? 'rgba(91,214,176,0.9)' : FARBE.text;
        L.fillText(String(g), 6, S.y(g));
      }
      const R = this.achseR.getContext('2d');
      R.setTransform(dpr, 0, 0, dpr, 0, 0); R.clearRect(0, 0, 40, S.h);
      if (this.daten.insulin.length) {
        const g2 = R.createLinearGradient(40, 0, 0, 0);
        g2.addColorStop(0, 'rgba(21,27,48,0.95)'); g2.addColorStop(0.7, 'rgba(21,27,48,0.7)'); g2.addColorStop(1, 'rgba(21,27,48,0)');
        R.fillStyle = g2; R.fillRect(0, 0, 40, S.h);
        R.font = '500 11px Rubik, system-ui, sans-serif'; R.textAlign = 'right'; R.textBaseline = 'middle';
        R.fillStyle = 'rgba(183,156,255,0.85)';
        const st = S.iMax > 100 ? 50 : 20;
        for (let i = st; i < S.iMax; i += st) R.fillText(String(i), 34, S.yi(i));
      }
    }
  }
  root.Verlauf = Verlauf;
  root.hhmm = hhmm;
})(window);
