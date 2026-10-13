/* Lebensmittel – Erkennung und Umrechnung.
 * Die DATEN stehen nicht hier, sondern in lebensmittel.csv (in Excel bearbeitbar):
 *   Nährwerte pro 100 g  -> Bundeslebensmittelschlüssel (BLS) 4.0, Max Rubner-Institut 2025, CC BY 4.0
 *   Glykämischer Index   -> Atkinson, Foster-Powell & Brand-Miller (2008), Diabetes Care 31:2281, Tabelle 1
 * Diese Datei liest die Tabelle ein, erkennt Lebensmittel im Text und rechnet auf die Menge um. */
(function (root) {
  'use strict';
  let DB = [];          // [{ name, begriffe, kh, zucker, ballaststoffe, fett, protein, kcal, gi, quelle, giQuelle }]
  const STUECK = {};    // typisches Gewicht pro Stück/Scheibe in g

  const zahl = s => { const n = parseFloat(String(s || '').replace(',', '.')); return isFinite(n) ? n : 0; };

  // CSV (Trennzeichen ;, Dezimalkomma) -> Datenbank
  function ausText(csv) {
    const zeilen = String(csv).replace(/^\uFEFF/, '').split(/\r?\n/).filter(z => z.trim());
    const kopf = zeilen.shift().split(';').map(k => k.trim());
    const sp = name => kopf.indexOf(name);
    DB = []; for (const k in STUECK) delete STUECK[k];
    for (const z of zeilen) {
      const f = z.split(';');
      const e = {
        name: f[sp('Name')].trim(), begriffe: f[sp('Suchbegriffe')].split('|').map(b => b.trim()).filter(Boolean),
        kh: zahl(f[sp('Kohlenhydrate_g')]), zucker: zahl(f[sp('Zucker_g')]), ballaststoffe: zahl(f[sp('Ballaststoffe_g')]),
        fett: zahl(f[sp('Fett_g')]), protein: zahl(f[sp('Eiweiss_g')]), kcal: zahl(f[sp('kcal')]), gi: zahl(f[sp('GI')]),
        quelle: (f[sp('Naehrwert_Quelle')] || '').trim(), giQuelle: (f[sp('GI_Quelle')] || '').trim()
      };
      if (!e.name) continue;
      if (!e.begriffe.length) e.begriffe = [e.name.toLowerCase()];
      const st = zahl(f[sp('Stueckgewicht_g')]);
      if (st > 0) STUECK[e.name] = st;
      DB.push(e);
    }
    api.DB = DB;
    return DB.length;
  }

  // Im Browser: Tabelle laden (eingebettet in der Vorschau, sonst als Datei)
  async function laden() {
    const eingebettet = typeof document !== 'undefined' && document.getElementById('lebensmittel-csv');
    if (eingebettet) return ausText(eingebettet.textContent);
    const res = await fetch('lebensmittel.csv', { cache: 'no-cache' });
    if (!res.ok) throw new Error('lebensmittel.csv konnte nicht geladen werden (' + res.status + ')');
    return ausText(await res.text());
  }

  const norm = s => s.toLowerCase().replace(/ß/g, 'ss').replace(/[äöü]/g, c => ({ 'ä': 'ae', 'ö': 'oe', 'ü': 'ue' })[c]).trim();

  function finde(text) {
    const t = ' ' + norm(text) + ' ';
    let best = null, bestLen = 0;
    for (const e of DB) for (const b of e.begriffe) {
      const nb = norm(b);
      const re = new RegExp('(^|[^a-z])' + nb.replace(/[-]/g, '\\-') + '(n|s|e|en)?([^a-z]|$)');
      if (re.test(t) && nb.length > bestLen) { best = e; bestLen = nb.length; }
    }
    return best;
  }

  // Suche für das Suchfeld: beste Treffer zuerst, kleine Tippfehler sind erlaubt ("Nudlen" -> Nudeln)
  function abstand(a, b) {
    const d = Array.from({ length: b.length + 1 }, (_, j) => j);
    for (let i = 1; i <= a.length; i++) {
      let vor = d[0]; d[0] = i;
      for (let j = 1; j <= b.length; j++) { const t = d[j]; d[j] = Math.min(d[j] + 1, d[j - 1] + 1, vor + (a[i - 1] === b[j - 1] ? 0 : 1)); vor = t; }
    }
    return d[b.length];
  }
  function suche(text, max) {
    const q = norm(text || '').replace(/\s+/g, ' ');
    if (!q) return [];
    const treffer = [];
    DB.forEach((e, nr) => {
      let best = 99;
      const kandidaten = [norm(e.name)].concat(e.begriffe.map(norm));
      kandidaten.forEach((k, i) => {
        const woerter = k.split(/[\s()\-]+/).filter(Boolean);
        let s = 99;
        if (k.startsWith(q)) s = i === 0 ? 0 : 1;
        else if (woerter.some(w => w.startsWith(q))) s = 2;
        else if (q.length >= 3 && k.includes(q)) s = 3;
        else if (q.length >= 3 && woerter.concat(k).some(w => abstand(q, w.slice(0, q.length)) <= (q.length >= 6 ? 2 : 1))) s = 4;
        best = Math.min(best, s);
      });
      if (best < 99) treffer.push({ e, s: best, nr });
    });
    treffer.sort((a, b) => a.s - b.s || a.nr - b.nr);
    // Tippfehler-Treffer nur zeigen, wenn es keine echten Treffer gibt
    const echt = treffer.filter(t => t.s < 4);
    return (echt.length ? echt : treffer).slice(0, max || 6).map(t => t.e);
  }

  const GETRAENK = /cola|saft|milch|limo|eistee|wasser|kakao|smoothie|schorle|tee|kaffee|fanta|sprite/i;
  const eintrag = name => DB.find(e => e.name === name) || null;
  const einheit = name => GETRAENK.test(name) ? 'ml' : 'g';
  const stueck = name => STUECK[name] || 0;
  // Startmenge beim Hinzufügen: 1 Stück, ein Glas (250 ml) oder 100 g
  const startMenge = name => stueck(name) || (einheit(name) === 'ml' ? 250 : 100);

  // Ein Lebensmittel aus der Tabelle + Menge -> Zutat mit umgerechneten Nährwerten
  function zutat(nameOderEintrag, gramm) {
    const e = typeof nameOderEintrag === 'string' ? eintrag(nameOderEintrag) : nameOderEintrag;
    if (!e) return null;
    const f = gramm / 100, r1 = x => Math.round(x * f * 10) / 10;
    return {
      name: e.name, gramm: Math.round(gramm), kh: r1(e.kh), zucker: r1(e.zucker),
      ballaststoffe: r1(e.ballaststoffe), fett: r1(e.fett), protein: r1(e.protein),
      kcal: Math.round(e.kcal * f), gi: e.gi
    };
  }

  // "Nudeln 250 g, Tomatensoße 150g + Cola 330 ml" -> Zutatenliste (für den Beispieltag und Snack-Vorschläge)
  function parse(text) {
    const teile = text.split(/,|\+|;|\n|\bund\b|\bmit\b/i).map(s => s.trim()).filter(Boolean);
    const zutaten = [], unbekannt = [];
    for (const teil of teile) {
      const m = teil.match(/(\d+(?:[.,]\d+)?)\s*(kg|g|gramm|ml|l|liter|stück|stk|scheiben?)?(?![a-zäöü])/i);
      const name = teil.replace(/(\d+(?:[.,]\d+)?)\s*(kg|g|gramm|ml|l|liter|stück|stk|scheiben?)?(?![a-zäöü])/i, '').trim();
      const e = finde(name || teil);
      if (!e) { unbekannt.push(teil); continue; }
      let gramm = STUECK[e.name] || 100;
      if (m) {
        const n = parseFloat(m[1].replace(',', '.'));
        const u = (m[2] || '').toLowerCase();
        if (u === 'kg' || u === 'l' || u === 'liter') gramm = n * 1000;
        else if (u === 'g' || u === 'gramm' || u === 'ml') gramm = n;
        else if (u || n <= 10) gramm = n * (STUECK[e.name] || 100); // "2 Eier", "3 Scheiben Toast"
        else gramm = n;
      }
      zutaten.push(zutat(e, gramm));
    }
    return { zutaten, unbekannt };
  }

  // Summe einer Zutatenliste; GI als KH-gewichteter Mittelwert, GL = glykämische Last
  function summe(zutaten) {
    const s = { kh: 0, zucker: 0, ballaststoffe: 0, fett: 0, protein: 0, kcal: 0, gi: 0, gl: 0, gramm: 0 };
    for (const z of zutaten || []) {
      for (const k of ['kh', 'zucker', 'ballaststoffe', 'fett', 'protein', 'kcal', 'gramm']) s[k] += Number(z[k]) || 0;
      s.gl += (Number(z.kh) || 0) * (Number(z.gi) || 0) / 100;
    }
    s.gi = s.kh > 0 ? Math.round(100 * s.gl / s.kh) : 0;
    for (const k of ['kh', 'zucker', 'ballaststoffe', 'fett', 'protein', 'gl']) s[k] = Math.round(s[k] * 10) / 10;
    s.kcal = Math.round(s.kcal); s.gramm = Math.round(s.gramm);
    return s;
  }

  const api = { DB, parse, finde, suche, zutat, eintrag, einheit, stueck, startMenge, summe, laden, ausText };
  root.Lebensmittel = api;
  if (typeof module !== 'undefined' && typeof require === 'function' && typeof document === 'undefined') {
    try { const fs = require('fs'), path = require('path'); ausText(fs.readFileSync(path.join(__dirname, 'lebensmittel.csv'), 'utf8')); } catch (e) { /* ohne Tabelle */ }
  }
})(typeof window !== 'undefined' ? window : globalThis);
