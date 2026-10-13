/* Optimierer (läuft lokal, ohne KI) + Texte für Erklärungen */
(function (root) {
  'use strict';
  const S = root.GlukoSim;
  const hhmm = m => String(Math.floor(((m % 1440) + 1440) % 1440 / 60)).padStart(2, '0') + ':' + String(Math.round(((m % 60) + 60) % 60)).padStart(2, '0');
  const klon = x => JSON.parse(JSON.stringify(x));
  const neueId = () => 'e' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const titel = e => e.typ === 'essen' ? (e.name || 'Mahlzeit') : e.typ === 'sport' ? (e.art || 'Sport') : (e.einheiten + ' IE ' + (e.art === 'lang' ? 'Langzeitinsulin' : 'schnelles Insulin'));

  // ---------- Realistische Essenszeiten ----------
  // Art der Mahlzeit aus dem Namen, sonst aus der Uhrzeit
  function mahlzeitArt(e) {
    if (e.mahlzeit && FENSTER[e.mahlzeit]) return e.mahlzeit;
    const n = (e.name || '').toLowerCase();
    if (/frühstück|fruehstueck|morgen|breakfast/.test(n)) return 'fruehstueck';
    if (/mittag|lunch|mensa/.test(n)) return 'mittag';
    if (/abend|dinner|nacht/.test(n)) return 'abend';
    if (/snack|pause|zwischen|nachmittag|kaffee|süß|cola|schok/.test(n)) return 'snack';
    const t = e.zeit;
    return t < 630 ? 'fruehstueck' : t >= 690 && t <= 870 ? 'mittag' : t >= 1050 ? 'abend' : 'snack';
  }
  const FENSTER = {
    fruehstueck: { von: 330, bis: 630, maxVerschiebung: 60 },   // 05:30–10:30
    mittag: { von: 660, bis: 870, maxVerschiebung: 60 },        // 11:00–14:30
    abend: { von: 1050, bis: 1290, maxVerschiebung: 60 },       // 17:30–21:30
    snack: { von: 360, bis: 1290, maxVerschiebung: 90 }         // 06:00–21:30
  };
  function zeitfenster(e) { return FENSTER[mahlzeitArt(e)]; }
  // Hauptmahlzeiten behalten ihre Reihenfolge (Frühstück < Mittag < Abend)
  const RANG = { fruehstueck: 0, mittag: 1, abend: 2 };
  function reihenfolgeOk(essen, e, t) {
    const r = RANG[mahlzeitArt(e)];
    if (r == null) return true;
    return essen.every(x => {
      if (x.id === e.id) return true;
      const rx = RANG[mahlzeitArt(x)];
      if (rx == null) return true;
      return rx < r ? x.zeit < t - 120 : rx > r ? x.zeit > t + 120 : true; // mind. 2 h Abstand zur nächsten Hauptmahlzeit
    });
  }

  // ---------- Tagesplaner: beste Uhrzeiten für flexible Einträge ----------
  const istFest = e => e.typ === 'insulin' || e.fest !== false;
  // Standard-Zeiträume für flexible Einträge (Beginn von–bis, in Minuten)
  const STANDARD_ZEITRAUM = {
    fruehstueck: [390, 570],   // 6:30–9:30
    mittag: [690, 840],        // 11:30–14:00
    abend: [1050, 1230],       // 17:30–20:30
    snack: [540, 1260],        // 9:00–21:00
    sport: [900, 1230]         // 15:00–20:30
  };
  const SPORT_ABSTAND = { leicht: 10, mittel: 30, intensiv: 60 };     // min nach Beginn einer Mahlzeit
  function zeitraum(e) {
    if (Array.isArray(e.zeitraum) && e.zeitraum.length === 2) return e.zeitraum;
    return e.typ === 'sport' ? STANDARD_ZEITRAUM.sport : STANDARD_ZEITRAUM[mahlzeitArt(e)];
  }

  // Ist Uhrzeit t für Eintrag e im Plan erlaubt?
  function erlaubt(plan, e, t) {
    const essen = plan.filter(x => x.typ === 'essen' && x.id !== e.id);
    const sport = plan.filter(x => x.typ === 'sport' && x.id !== e.id);
    const [von, bis] = zeitraum(e);
    if (t < von || t > bis) return false;
    if (e.typ === 'essen') {
      if (essen.some(x => Math.abs(x.zeit - t) < 60)) return false;                  // mind. 1 h zwischen Mahlzeiten
      if (!reihenfolgeOk(essen.concat([e]), e, t)) return false;
      const fr = essen.find(x => mahlzeitArt(x) === 'fruehstueck');
      if (mahlzeitArt(e) === 'snack' && fr && t < fr.zeit) return false;             // kein Snack vor dem Frühstück
      if (mahlzeitArt(e) === 'fruehstueck' && essen.some(x => mahlzeitArt(x) === 'snack' && x.zeit < t)) return false;
      if (mahlzeitArt(e) === 'fruehstueck' && sport.some(s => s.zeit < t)) return false;
      if (sport.some(s => t >= s.zeit && t < s.zeit + s.dauer)) return false;        // nicht während Sport essen
      if (sport.some(s => s.zeit >= t && s.zeit < t + (SPORT_ABSTAND[s.intensitaet] || 30))) return false; // Sport nicht direkt danach
      return true;
    }
    if (e.typ === 'sport') {
      if (t + e.dauer > 1320) return false;                                          // spätestens 22:00 fertig
      const fr = essen.find(x => mahlzeitArt(x) === 'fruehstueck');
      if (fr && t < fr.zeit) return false;                                           // kein Sport vor dem Frühstück
      const abst = SPORT_ABSTAND[e.intensitaet] || 30;
      if (essen.some(x => x.zeit >= t && x.zeit < t + e.dauer)) return false;        // keine Mahlzeit während Sport
      if (essen.some(x => t >= x.zeit && t < x.zeit + abst)) return false;           // nicht direkt nach dem Essen
      if (sport.some(s => t < s.zeit + s.dauer + 30 && s.zeit < t + e.dauer + 30)) return false;
      return true;
    }
    return true;
  }

  // Startzeit für einen neuen flexiblen Eintrag
  function startZeit(plan, e) {
    const [von, bis] = zeitraum(e);
    const anker = e.zeit != null && e.zeit >= von && e.zeit <= bis ? e.zeit : Math.round((von + bis) / 2 / 15) * 15;
    for (let d = 0; d <= 1440; d += 15) for (const t of [anker + d, anker - d])
      if (t >= 0 && t <= 1435 && erlaubt(plan, e, t)) return t;
    return anker;
  }

  function planeTag(eintraege, profil, opt) {
    const plan = klon(eintraege);
    const flex = plan.filter(e => (e.typ === 'essen' || e.typ === 'sport') && !istFest(e));
    const vorher = bewerte(eintraege, profil, opt);
    if (!flex.length) return { plan, vorher, nachher: vorher, aenderungen: [], keineFlexiblen: true };
    // Mahlzeiten-Insulin (Typ 1) wandert mit der Mahlzeit
    const bolusVon = {};
    for (const m of flex.filter(e => e.typ === 'essen'))
      bolusVon[m.id] = plan.filter(i => i.typ === 'insulin' && i.art !== 'lang' && i.zeit >= m.zeit - 45 && i.zeit <= m.zeit + 20 && !Object.values(bolusVon).flat().includes(i));
    const setze = (e, t) => { const d = t - e.zeit; e.zeit = t; for (const b of bolusVon[e.id] || []) b.zeit = Math.max(0, Math.min(1439, b.zeit + d)); };
    // Ungültige Startpositionen zuerst reparieren
    for (const e of flex) if (!erlaubt(plan, e, e.zeit)) setze(e, startZeit(plan, e));
    // Verschieben "kostet" etwas: ohne spürbaren Nutzen bleibt die Uhrzeit, wie sie ist
    const anker = Object.fromEntries(flex.map(e => [e.id, e.zeit]));
    const st0 = S.statistik(S.simuliere(plan, profil, opt), profil);
    // Kosten = Bewertung der Kurve + kleine Strafe fürs Verschieben; Inf, wenn ein angezeigter Wert schlechter wird
    const kosten = () => {
      const sim = S.simuliere(plan, profil, opt), st = S.statistik(sim, profil);
      if (st.max > st0.max || st.ueberMin > st0.ueberMin || st.unterMin > st0.unterMin) return Infinity;
      return S.bewertung(sim, profil) + 0.5 * st.ueberMin + flex.reduce((a, e) => a + 2 * Math.abs(e.zeit - anker[e.id]) / 60, 0);
    };
    const repariert = klon(plan);
    let best = kosten();
    const runde = (schritt, radius) => {
      for (const e of flex.slice().sort((a, b) => a.zeit - b.zeit)) {
        const alt = e.zeit;
        const von = radius ? alt - radius : 0, bis = radius ? alt + radius : 1440;
        let bestT = alt;
        for (let t = Math.ceil(von / schritt) * schritt; t <= bis; t += schritt) {
          if (t === alt || t < 0 || t > 1435 || !erlaubt(plan, e, t)) continue;
          setze(e, t);
          const k = kosten();
          if (k < best - 1e-6) { best = k; bestT = t; }
          setze(e, alt);
        }
        setze(e, bestT);
      }
    };
    runde(30, 0); runde(30, 0); runde(15, 60);
    let nachher = bewerte(plan, profil, opt);
    const d = { spitze: nachher.st.max - vorher.st.max, ueber: nachher.st.ueberMin - vorher.st.ueberMin, unter: nachher.st.unterMin - vorher.st.unterMin, ziel: nachher.st.zielProzent - vorher.st.zielProzent };
    const spuerbar = d.spitze <= -5 || d.ueber <= -10 || d.unter < 0 || d.ziel >= 2;
    let ergebnis = plan, keineVerbesserung = false;
    if (!spuerbar) { ergebnis = repariert; nachher = bewerte(ergebnis, profil, opt); keineVerbesserung = true; }
    const aenderungen = ergebnis.filter(e => flex.some(f => f.id === e.id))
      .map(e => ({ id: e.id, titel: titel(e), von: eintraege.find(x => x.id === e.id).zeit, nach: e.zeit, grund: grund(ergebnis, e) }))
      .filter(a => Math.abs(a.von - a.nach) >= 15);
    return { plan: ergebnis, vorher, nachher, aenderungen, keineVerbesserung };
  }

  // Kurze Begründung für eine geplante Uhrzeit
  function grund(plan, e) {
    const essen = plan.filter(x => x.typ === 'essen' && x.id !== e.id);
    if (e.typ === 'sport') {
      const m = essen.filter(x => x.zeit <= e.zeit && e.zeit - x.zeit <= 120 && x.summe && x.summe.kh >= 15).sort((a, b) => b.zeit - a.zeit)[0];
      return m ? 'Nach „' + titel(m) + '“: Die Muskeln verbrauchen die Glukose aus dieser Mahlzeit (GLUT4).'
        : 'Hier stört der Sport keine Mahlzeit und senkt den Blutzucker gleichmäßig.';
    }
    const s = plan.find(x => x.typ === 'sport' && x.zeit >= e.zeit && x.zeit - e.zeit <= 120);
    if (s) return 'Vor „' + titel(s) + '“: Beim Sport wird die Glukose aus der Mahlzeit direkt verbraucht.';
    const nah = essen.slice().sort((a, b) => Math.abs(a.zeit - e.zeit) - Math.abs(b.zeit - e.zeit))[0];
    if (nah && Math.abs(nah.zeit - e.zeit) >= 150) return 'Genug Abstand zu „' + titel(nah) + '“, damit sich die Anstiege nicht überlagern.';
    return 'Passt in den Tagesablauf, ohne dass sich Anstiege stark überlagern.';
  }

  // ---------- Vorschläge ----------
  function bewerte(plan, profil, opt) {
    const sim = S.simuliere(plan, profil, opt);
    return { sim, score: S.bewertung(sim, profil), st: S.statistik(sim, profil) };
  }

  // Beste Uhrzeit für einen neuen Eintrag (alle anderen bleiben, wo sie sind)
  function besteZeit(plan, e, profil, opt) {
    const [von, bis] = zeitraum(e), mitte = (von + bis) / 2;
    let best = null, bestK = Infinity;
    for (let t = Math.ceil(von / 15) * 15; t <= bis; t += 15) {
      if (!erlaubt(plan, e, t)) continue;
      const neu = plan.concat([Object.assign({}, e, { zeit: t })]);
      const sim = S.simuliere(neu, profil, opt), st = S.statistik(sim, profil);
      const k = S.bewertung(sim, profil) + 0.5 * st.ueberMin + 0.5 * Math.abs(t - mitte) / 60;
      if (k < bestK) { bestK = k; best = t; }
    }
    return best != null ? best : startZeit(plan, e);
  }


  // ================= Tagesplan in Schritten =================
  const ARTNAME = { fruehstueck: 'Frühstück', mittag: 'Mittagessen', abend: 'Abendessen', snack: 'Snack' };
  const r15 = t => Math.round(t / 15) * 15;
  const diffSt = (a, b) => ({ spitze: b.max - a.max, ueber: b.ueberMin - a.ueberMin, unter: b.unterMin - a.unterMin, ziel: b.zielProzent - a.zielProzent });
  const spuerbar = d => d.spitze <= -5 || d.ueber <= -10 || d.unter < 0 || d.ziel >= 2;
  const schlechter = d => d.spitze > 0 || d.ueber > 0 || d.unter > 0;

  // Eingaben des Assistenten -> Einträge mit Startzeiten (Mitte des Zeitraums, Sport um 17 Uhr)
  function baueEintraege(mahlzeiten, bewegung, sportZeitraum) {
    const [sv, sb] = sportZeitraum || [900, 1230];
    const plan = [];
    for (const m of mahlzeiten) plan.push({
      id: m.id, typ: 'essen', mahlzeit: m.art, name: ARTNAME[m.art], eingabe: m.eingabe, quelle: m.quelle,
      zutaten: klon(m.zutaten), summe: m.summe, fest: !!m.fest,
      zeitraum: m.fest ? undefined : [m.von, m.bis], zeit: m.fest ? m.zeit : r15((m.von + m.bis) / 2)
    });
    for (const m of plan) if (!m.fest && !erlaubt(plan, m, m.zeit)) m.zeit = startZeit(plan, m);
    for (const b of bewegung) {
      const s = { id: b.id, typ: 'sport', art: b.art, dauer: b.dauer, intensitaet: b.intensitaet, fest: false, zeitraum: [sv, Math.max(sv, sb - b.dauer)], zeit: r15((sv + sb - b.dauer) / 2) };
      if (!erlaubt(plan, s, s.zeit)) s.zeit = startZeit(plan, s);
      plan.push(s);
    }
    return plan;
  }

  const GETRAENK = /cola|saft|milch|limo|eistee|wasser|kakao|smoothie|schorle|tee|kaffee|fanta|sprite/i;
  const einheit = z => GETRAENK.test(z.name) ? 'ml' : 'g';
  function zutatenText(zutaten) { return zutaten.map(z => z.name + ' ' + z.gramm + ' ' + einheit(z)).join(', '); }
  // Auslagern lohnt nur bei süßen Beilagen (Saft, Cola, Obst, Süßes), nicht beim Hauptteil der Mahlzeit
  const SNACK = /banane|apfel|orange|mandarine|clementine|erdbeer|beere|traube|obst|saft|cola|limo|fanta|sprite|eistee|smoothie|schoko|riegel|gummi|keks|kuchen|muffin|joghurt|jogurt|skyr|eis\b|eiscreme|kakao|nüsse|nuss/i;
  function snackTauglich(z, m) {
    return SNACK.test(z.name) && z.kh <= 0.6 * m.summe.kh;
  }

  // Schritt 3: Snack-Vorschlag
  function snackVorschlag(plan, profil, opt) {
    const basis = bewerte(plan, profil, opt);
    let best = null;
    const versuch = (neu, info, strafe) => {
      const r = bewerte(neu, profil, opt), d = diffSt(basis.st, r.st);
      if (!spuerbar(d) || schlechter(d)) return;
      const gewinn = basis.score - r.score - (strafe || 0);
      if (!best || gewinn > best.gewinn) best = { plan: neu, gewinn, info };
    };
    // a) Einen Teil einer Mahlzeit später als Snack essen (Mahlzeit aufteilen)
    for (const m of plan.filter(e => e.typ === 'essen' && e.mahlzeit !== 'snack' && (e.zutaten || []).length >= 2)) {
      m.zutaten.forEach((z, i) => {
        if (z.kh < 10 || !snackTauglich(z, m)) return;
        for (let t = m.zeit + 90; t <= Math.min(1260, m.zeit + 360); t += 30) {
          const neu = klon(plan), mm = neu.find(x => x.id === m.id);
          mm.zutaten.splice(i, 1); mm.summe = root.Lebensmittel.summe(mm.zutaten); mm.eingabe = zutatenText(mm.zutaten);
          const snack = { id: neueId(), typ: 'essen', mahlzeit: 'snack', name: 'Snack', fest: true, zeit: t, zutaten: [klon(z)], summe: root.Lebensmittel.summe([z]), eingabe: zutatenText([z]), vorschlag: true };
          if (!erlaubt(neu, snack, t)) continue;
          neu.push(snack);
          versuch(neu, { art: 'teilen', zutat: z, mahlzeit: m.name, t });
        }
      });
    }
    // b) Snack gegen Unterzucker (z. B. Typ 1 beim Sport) – ohne Insulin dazu
    if (basis.st.unterMin > 0) {
      let tU = 0; for (let t = 0; t < basis.sim.G.length; t++) if (basis.sim.G[t] < 70) { tU = t; break; }
      for (const text of ['Banane 120 g', 'Apfel 150 g', 'Traubenzucker 16 g']) {
        const zt = root.Lebensmittel.parse(text).zutaten;
        for (let t = r15(tU - 90); t <= tU - 15; t += 15) {
          if (t < 360 || t > 1320) continue;
          if (plan.some(e => e.typ === 'essen' && Math.abs(e.zeit - t) < 45)) continue;
          if (plan.some(e => e.typ === 'sport' && t >= e.zeit && t < e.zeit + e.dauer)) continue;
          const neu = klon(plan);
          neu.push({ id: neueId(), typ: 'essen', mahlzeit: 'snack', name: 'Snack', fest: true, zeit: t, zutaten: klon(zt), summe: root.Lebensmittel.summe(zt), eingabe: text, ohneInsulin: true, vorschlag: true });
          versuch(neu, { art: 'unterzucker', text, t, tU });
        }
      }
    }
    if (!best) return null;
    const i = best.info;
    const sportDanach = best.plan.find(e => e.typ === 'sport' && e.zeit >= i.t && e.zeit - i.t <= 120);
    const text = i.art === 'teilen'
      ? '„' + i.zutat.name + '“ (' + i.zutat.gramm + ' ' + einheit(i.zutat) + ') nicht zum ' + i.mahlzeit + ' essen, sondern als Snack um ' + hhmm(i.t) + '. ' +
        (sportDanach ? 'Kurz vor dem ' + sportDanach.art + ' verbrauchen die Muskeln die Glukose direkt.' : 'So kommt weniger Glukose auf einmal ins Blut, die Spitze nach dem ' + i.mahlzeit + ' wird kleiner.')
      : 'Snack um ' + hhmm(i.t) + ': ' + i.text + ', ohne Insulin dazu. Ohne Snack fällt der Blutzucker um ' + hhmm(i.tU) + ' unter 70 mg/dl (Unterzucker).' +
        (profil === 'typ1' ? ' Bei Typ 1 lässt sich gespritztes Insulin beim Sport nicht drosseln.' : '');
    return { plan: best.plan, text, aenderungen: [{ titel: 'Snack', nach: i.t, text: i.art === 'teilen' ? zutatenText([i.zutat]) : i.text }] };
  }

  // Schritt 4: Eine Mahlzeit knapp außerhalb des Zeitraums
  function ausserhalbVorschlag(plan, profil, opt) {
    const basis = bewerte(plan, profil, opt);
    let best = null;
    for (const m of plan.filter(e => e.typ === 'essen' && !istFest(e) && e.zeitraum && !e.vorschlag)) {
      const [von, bis] = m.zeitraum;
      for (const d of [15, 30, 45, 60]) for (const t of [von - d, bis + d]) {
        if (t < 300 || t > 1320) continue;
        const neu = klon(plan), mm = neu.find(x => x.id === m.id);
        mm.zeitraum = [von - 60, bis + 60];
        if (!erlaubt(neu, mm, t)) continue;
        mm.zeit = t; mm.zeitraum = [von, bis]; mm.ausnahme = true;
        const r = bewerte(neu, profil, opt), dd = diffSt(basis.st, r.st);
        if (!spuerbar(dd) || schlechter(dd)) continue;
        const shift = Math.abs(t - m.zeit);
        if (shift > 90) continue;                               // nur kleine Änderungen
        const gewinn = basis.score - r.score - 2 * shift / 15;
        if (!best || gewinn > best.gewinn) best = { plan: neu, gewinn, m, t, d, frueher: t < von, von, bis, dd };
      }
    }
    if (!best) return null;
    const dd = best.dd, nutzen = dd.unter < 0 ? 'Das verhindert ' + (-dd.unter) + ' min Unterzucker.'
      : dd.spitze <= -5 ? 'Das senkt die höchste Spitze um ' + (-dd.spitze) + ' mg/dl.'
      : 'Dadurch ist der Blutzucker ' + (-dd.ueber) + ' min weniger lang zu hoch.';
    return {
      plan: best.plan,
      text: 'Wenn es geht: ' + best.m.name + ' um ' + hhmm(best.t) + ', also ' + best.d + ' min ' + (best.frueher ? 'früher' : 'später') + ' als dein Zeitraum (' + hhmm(best.von) + '–' + hhmm(best.bis) + '). ' + nutzen,
      aenderungen: [{ titel: best.m.name, von: best.m.zeit, nach: best.t }]
    };
  }

  // Alle Schritte berechnen
  function planeSchritte(mahlzeiten, bewegung, profil, opt, sportZeitraum) {
    const s0 = baueEintraege(mahlzeiten, bewegung, sportZeitraum);
    const schritte = [{ key: 'start', titel: 'Dein Plan', text: 'Alles in der Mitte deiner Zeiträume, noch ohne Optimierung.', plan: s0, aenderungen: [] }];
    const r = planeTag(s0, profil, opt);
    schritte.push({
      key: 'zeiten', titel: 'Beste Uhrzeiten',
      text: r.aenderungen.length ? 'Der Algorithmus verschiebt alles innerhalb deiner Zeiträume so, dass die Kurve am ruhigsten bleibt.' : 'Deine Uhrzeiten passen schon. Verschieben innerhalb der Zeiträume bringt nichts Spürbares.',
      plan: r.plan, aenderungen: r.aenderungen.map(a => ({ titel: a.titel, von: a.von, nach: a.nach, text: a.grund }))
    });
    const nicht = [];
    const sn = snackVorschlag(r.plan, profil, opt);
    if (sn) schritte.push(Object.assign({ key: 'snack', titel: 'Snack-Vorschlag' }, sn)); else nicht.push('Snack');
    const au = ausserhalbVorschlag(schritte[schritte.length - 1].plan, profil, opt);
    if (au) schritte.push(Object.assign({ key: 'ausserhalb', titel: 'Kleine Ausnahme' }, au)); else nicht.push('Ausnahme beim Zeitraum');
    schritte.nichtNoetig = nicht;
    return schritte;
  }

  // ---------- Texte ----------
  const PROFIL_TEXT = {
    gesund: 'Gesunder Stoffwechsel: Die Beta-Zellen der Bauchspeicheldrüse schütten automatisch passend Insulin aus.',
    typ1: 'Diabetes Typ 1: Die Beta-Zellen sind durch eine Autoimmunreaktion zerstört, es wird kein eigenes Insulin gebildet. Insulin muss gespritzt werden.',
    typ2: 'Diabetes Typ 2: Insulin wird gebildet, wirkt aber schwächer (Insulinresistenz). Die Ausschüttung ist verzögert und begrenzt.'
  };

  function mahlzeitVor(eintraege, t) {
    return eintraege.filter(e => e.typ === 'essen' && e.summe && e.zeit <= t && t - e.zeit <= 200)
      .sort((a, b) => b.summe.gl / (1 + (t - b.zeit) / 90) - a.summe.gl / (1 + (t - a.zeit) / 90))[0];
  }

  function erstesUnter(sim, grenze) { for (let t = 0; t < sim.G.length; t++) if (sim.G[t] < grenze) return t; return -1; }

  function lokaleErklaerung(eintraege, profil, sim, st) {
    const abs = [];
    const insulin = eintraege.filter(e => e.typ === 'insulin');
    if (profil === 'gesund') {
      abs.push('Bei einem **gesunden Stoffwechsel** messen die **Beta-Zellen** der Bauchspeicheldrüse den Blutzucker ständig. Steigt er, schütten sie sofort **Insulin** aus (hier bis ' + st.insulinMax + ' µU/ml). Muskel- und Fettzellen nehmen dann Glukose auf, die **Leber** speichert sie als **Glykogen**. Deshalb bleibt die Kurve zwischen ' + st.min + ' und ' + st.max + ' mg/dl.');
    } else if (profil === 'typ1') {
      if (!insulin.length) abs.push('Bei **Typ 1** bildet die Bauchspeicheldrüse kein Insulin. Ohne gespritztes Insulin kann die Glukose nicht in die Zellen, und die **Leber** gibt zusätzlich Zucker ab. Der Blutzucker bleibt deshalb den ganzen Tag hoch (Ø ' + st.mittel + ' mg/dl). Nur die **Niere** scheidet ab etwa 180 mg/dl Zucker mit dem Urin aus.');
      else abs.push('Bei **Typ 1** fehlen die **Beta-Zellen**. Das gespritzte **Langzeitinsulin** ersetzt die Grundausschüttung, das **schnelle Insulin** fängt die Mahlzeiten ab. Weil es unter die Haut gespritzt wird, wirkt es verzögert und lässt sich nicht automatisch an den Blutzucker anpassen.');
    } else {
      abs.push('Bei **Typ 2** reagieren die Zellen schwächer auf Insulin (**Insulinresistenz**). Die Bauchspeicheldrüse schüttet deshalb mehr Insulin aus (bis ' + st.insulinMax + ' µU/ml), trotzdem ist schon der Nüchternwert erhöht (' + Math.round(sim.G[0]) + ' mg/dl) und der Blutzucker sinkt nach dem Essen nur langsam.');
    }
    const m = mahlzeitVor(eintraege, st.maxT);
    if (m) {
      let s = 'Die höchste Spitze (' + st.max + ' mg/dl um ' + hhmm(st.maxT) + ') kommt von „' + titel(m) + '“ mit ' + Math.round(m.summe.kh) + ' g Kohlenhydraten und einem **glykämischen Index** von ' + m.summe.gi + '.';
      if (m.summe.gi >= 65) s += ' Ein hoher GI heißt: Die Stärke bzw. der Zucker wird im Darm schnell zu Glukose und gelangt rasch ins Blut.';
      else if (m.summe.fett + m.summe.ballaststoffe > 20) s += ' Fett und Ballaststoffe verlangsamen die Magenentleerung, deshalb steigt die Kurve eher flach an.';
      if (profil === 'typ1' && !insulin.some(i => i.art !== 'lang' && i.zeit >= m.zeit - 45 && i.zeit <= m.zeit + 20)) s += ' Für diese Mahlzeit wurde kein Insulin gespritzt.';
      abs.push(s);
    }
    const sp = eintraege.filter(e => e.typ === 'sport').sort((a, b) => a.zeit - b.zeit)[0];
    if (sp) {
      const vor = sim.G[sp.zeit], nach = sim.G[Math.min(1440, sp.zeit + sp.dauer)];
      let s = 'Beim ' + sp.art + ' um ' + hhmm(sp.zeit) + ' sinkt der Blutzucker von ' + Math.round(vor) + ' auf ' + Math.round(nach) + ' mg/dl: Arbeitende Muskeln bauen **GLUT4**-Transporter in die Zellmembran ein und nehmen Glukose auch ohne Insulin auf.';
      if (profil === 'gesund') s += ' Gleichzeitig sinkt die Insulinausschüttung und die Leber gibt Glukose ab, damit es keinen Unterzucker gibt.';
      if (profil === 'typ1') s += ' Das gespritzte Insulin wirkt dabei weiter, deshalb ist das Unterzucker-Risiko bei Typ 1 höher.';
      abs.push(s);
    }
    if (st.unterMin > 0) {
      const t = erstesUnter(sim, 70);
      abs.push('Ab ' + hhmm(t) + ' liegt der Wert unter 70 mg/dl (**Unterzucker**, insgesamt ' + st.unterMin + ' min). Das Gegenhormon **Glukagon** lässt die Leber Glykogen abbauen' + (profil === 'typ1' ? ', wirkt bei Typ 1 aber oft zu schwach.' : '.'));
    }
    return abs.join('\n\n');
  }

  function lokalerVergleich(ergebnisse) {
    const g = ergebnisse.gesund.st, t1 = ergebnisse.typ1.st, t2 = ergebnisse.typ2.st;
    return [
      '**Gesund:** Die Kurve bleibt flach (Spitze ' + g.max + ' mg/dl), weil die **Beta-Zellen** schnell und genau so viel Insulin ausschütten wie nötig.',
      ergebnisse.typ1.ohneInsulin
        ? '**Typ 1 ohne Insulin:** Die Kurve bleibt den ganzen Tag hoch (Spitze ' + t1.max + ' mg/dl, Ø ' + t1.mittel + '). Ohne Insulin kommt die Glukose nicht in die Zellen, nur die **Niere** scheidet ab ca. 180 mg/dl Zucker aus.'
        : '**Typ 1:** Mit gespritztem Insulin nach Faustregel erreicht die Kurve ' + t1.max + ' mg/dl. Gespritztes Insulin wirkt verzögert und reagiert nicht selbst auf den Blutzucker, deshalb schwankt die Kurve stärker' + (t1.unterMin ? ' und rutscht zeitweise in den Unterzucker.' : '.'),
      '**Typ 2:** Schon nüchtern erhöht, Spitze ' + t2.max + ' mg/dl und nur ' + t2.zielProzent + ' % der Zeit im Zielbereich. Die **Insulinresistenz** zwingt die Bauchspeicheldrüse zu mehr Insulin (bis ' + t2.insulinMax + ' statt ' + g.insulinMax + ' µU/ml), trotzdem wird die Glukose langsamer aus dem Blut geholt.',
      'Fazit: Derselbe Tag wirkt je nach Stoffwechsel völlig unterschiedlich, entscheidend ist, wie viel Insulin wann wirkt.'
    ].join('\n\n');
  }

  root.Optimierer = { zutatenText, neueId, klon, titel, hhmm, planeTag, planeSchritte, besteZeit, startZeit, erlaubt, istFest, mahlzeitArt, zeitraum, STANDARD_ZEITRAUM, ARTNAME };
  root.Texte = { lokaleErklaerung, lokalerVergleich, PROFIL_TEXT };
})(window);
