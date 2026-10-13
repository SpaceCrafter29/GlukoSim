/* GlukoSim – vereinfachtes Blutzucker-Modell
 * Kein Medizinprodukt. Ein Schulmodell, das die wichtigsten Mechanismen zeigt:
 * Darm -> Blut, Insulin (Muskel/Fett nehmen Glukose auf), Leber (Speicher/Abgabe),
 * Glukagon bei Unterzucker, Sport (Muskel nimmt Glukose auch ohne Insulin auf),
 * Niere (Glukose im Urin ab ~180 mg/dl).
 */
(function (root) {
  'use strict';

  // ===================== Modellparameter (hier anpassen) =====================
  const PARAM = {
    mgdlProGramm: 5.6,      // Anstieg in mg/dl pro g Glukose-Äquivalent (bei 70 kg)
    referenzGewicht: 70,    // kg
    gehirn: 0.55,           // insulinunabhängiger Verbrauch (Gehirn, rote Blutkörperchen) mg/dl/min
    leberBasal: 1.1,        // Glukoseabgabe der Leber nüchtern, mg/dl/min
    leberMin: 0.15,         // minimale Leberabgabe bei viel Insulin (Faktor)
    leberMax: 1.6,          // maximale Leberabgabe bei fehlendem Insulin (Faktor)
    nierenSchwelle: 180,    // mg/dl, ab hier Glukose im Urin
    nierenRate: 0.012,      // 1/min
    insulinAbbau: 0.12,     // 1/min (Halbwertszeit ca. 6 min)
    insulinWirkTau: 30,     // min, Verzögerung Blut -> Gewebe
    ibRef: 10,              // µU/ml, Nüchtern-Insulin gesund
    gRef: 88,               // mg/dl, Nüchtern-Blutzucker gesund
    ieFaktor: 96,           // Langzeitinsulin: IE -> Insulin im Blut
    ieFaktorSchnell: 40,    // schnelles Insulin: IE -> Insulin im Blut
    schnellPeak: 55,        // min bis Wirkmaximum schnelles Insulin
    langSchwankung: 0,         // Langzeitinsulin: kleine Tagesschwankung
    sport: {                // Muskel-Glukoseaufnahme mg/dl/min (insulinunabhängig)
      leicht: 0.7, mittel: 1.5, intensiv: 2.4
    },
    sportEmpfindlich: { leicht: 0.25, mittel: 0.45, intensiv: 0.65 }, // + Insulinempfindlichkeit
    sportNachwirkung: 150,  // min, Abklingzeit der erhöhten Empfindlichkeit
    vorlauf: 720            // min Einschwingen vor 0:00 (nur Langzeitinsulin)
  };

  // Stoffwechsel-Profile
  const PROFILE = {
    gesund: {
      name: 'Gesund', farbe: '#5BD6B0', ziel: [70, 140],
      eigenesInsulin: true, betaFaktor: 1.0, phase1: 3.0, sensorLag: 3, insulinMax: 200,
      si: 6.25e-4, leberSi: 1.0, leberFaktor: 1.0,
      glukagon: 0.12, sportKomp: 0.8, sportSekretion: 0.6
    },
    typ1: {
      name: 'Typ 1', farbe: '#8FB4FF', ziel: [70, 180],
      eigenesInsulin: false, betaFaktor: 0, phase1: 0, sensorLag: 3,
      si: 6.25e-4, leberSi: 1.0, leberFaktor: 1.0,
      glukagon: 0.02, sportKomp: 0.35, sportSekretion: 1
    },
    typ2: {
      name: 'Typ 2', farbe: '#FFB547', ziel: [70, 180],
      eigenesInsulin: true, betaFaktor: 0.6, phase1: 0, sensorLag: 15, insulinMax: 55,
      si: 1.8e-4, leberSi: 0.35, leberFaktor: 1.2,
      glukagon: 0.08, sportKomp: 0.65, sportSekretion: 0.7
    }
  };

  const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
  const gamma2 = (x, th) => (x <= 0 ? 0 : (x / (th * th)) * Math.exp(-x / th)); // Fläche = 1

  // Summe einer Mahlzeit -> Aufnahmeparameter
  function mahlzeitKinetik(s, gewicht) {
    const kh = Math.max(0, s.kh || 0);
    const gi = clamp(s.gi || 0, 0, 110);
    const aequivalent = kh * (0.35 + 0.65 * gi / 100);         // g Glukose-Äquivalent
    const last = aequivalent * PARAM.mgdlProGramm * (PARAM.referenzGewicht / (gewicht || 70));
    const theta = clamp(
      18 + 40 * (1 - gi / 100) + 0.5 * (s.fett || 0) + 0.2 * (s.protein || 0) +
      1.0 * (s.ballaststoffe || 0) + 0.05 * kh, 18, 150);       // min bis Aufnahmemaximum
    return { last, theta };
  }

  // Typ 1: automatische Standard-Therapie (Faustregel)
  // 16 IE Langzeitinsulin um 22 Uhr + 1 IE schnelles Insulin pro 10 g Kohlenhydrate, 15 min vor dem Essen
  function standardTherapie(eintraege) {
    const r = [{ typ: 'insulin', art: 'lang', einheiten: 16, zeit: 1320, auto: true }];
    for (const e of eintraege) if (e.typ === 'essen' && e.summe && e.summe.kh >= 8 && !e.ohneInsulin)
      r.push({ typ: 'insulin', art: 'schnell', einheiten: Math.max(1, Math.round(e.summe.kh / 10)), zeit: Math.max(0, e.zeit - 15), auto: true, zu: e.id });
    return r;
  }

  function sportPhasen(eintraege) {
    return eintraege.filter(e => e.typ === 'sport').map(e => ({
      start: e.zeit, ende: e.zeit + (e.dauer || 30),
      rate: PARAM.sport[e.intensitaet] || PARAM.sport.mittel,
      empf: PARAM.sportEmpfindlich[e.intensitaet] || PARAM.sportEmpfindlich.mittel
    }));
  }

  /**
   * Simuliert einen Tag (0–1440 min, Schritt 1 min).
   * eintraege: [{typ:'essen', zeit, summe:{kh,gi,fett,protein,ballaststoffe}},
   *             {typ:'sport', zeit, dauer, intensitaet},
   *             {typ:'insulin', zeit, einheiten, art:'schnell'|'lang'}]
   */
  function simuliere(eintraege, profilKey, opt) {
    opt = opt || {};
    if (opt.autoInsulin && profilKey === 'typ1') eintraege = eintraege.concat(standardTherapie(eintraege));
    const P = PROFILE[profilKey] || PROFILE.gesund;
    const gewicht = opt.gewicht || 70;
    const essen = eintraege.filter(e => e.typ === 'essen' && e.summe)
      .map(e => Object.assign({ t0: e.zeit }, mahlzeitKinetik(e.summe, gewicht)));
    const sport = sportPhasen(eintraege);
    const nutzeInsulin = profilKey === 'typ1' || (profilKey === 'typ2' && opt.insulinBeiTyp2);
    const ins = nutzeInsulin ? eintraege.filter(e => e.typ === 'insulin') : [];
    const schnell = ins.filter(e => e.art !== 'lang');
    const lang = ins.filter(e => e.art === 'lang');
    const gewFaktor = 70 / gewicht;

    const k = PARAM.insulinAbbau;
    let G = P.eigenesInsulin ? (profilKey === 'typ2' ? 130 : PARAM.gRef) : 120;
    let I = P.eigenesInsulin ? PARAM.ibRef : 8;
    let Ie = I, Gs = G, Gprev = G;

    const N = 1441;
    const outG = new Float32Array(N), outI = new Float32Array(N);
    const fluss = { darm: new Float32Array(N), leber: new Float32Array(N), gewebe: new Float32Array(N), niere: new Float32Array(N) };

    for (let t = -PARAM.vorlauf; t < N; t++) {
      const tag = t >= 0;
      // --- Glukose aus dem Darm
      let ra = 0;
      if (tag) for (const m of essen) ra += m.last * gamma2(t - m.t0, m.theta);

      // --- Sport
      let uSport = 0, empf = 1, sportAktiv = 0;
      if (tag) for (const s of sport) {
        if (t >= s.start && t < s.ende) { uSport += s.rate * (G / 90); empf += s.empf; sportAktiv = 1; }
        else if (t >= s.ende) empf += s.empf * Math.exp(-(t - s.ende) / PARAM.sportNachwirkung);
      }

      // --- Insulin: eigene Ausschüttung (Beta-Zellen)
      let sek = 0;
      if (P.eigenesInsulin) {
        const x = Math.max(0, (Gs - 40) / (PARAM.gRef - 40));
        // Ausschüttung steigt mit dem Blutzucker, ist aber begrenzt (erschöpfte Beta-Zellen bei Typ 2)
        sek = k * Math.min(PARAM.ibRef * P.betaFaktor * x * x, P.insulinMax) + P.phase1 * Math.max(0, G - Gprev);
        if (sportAktiv) sek *= P.sportSekretion;
      }
      // --- gespritztes Insulin
      let exo = 0;
      for (const e of lang) {
        const tau = (((t - e.zeit) % 1440) + 1440) % 1440;
        exo += (e.einheiten || 0) * PARAM.ieFaktor / 1440 *
          (1 + PARAM.langSchwankung * Math.cos(2 * Math.PI * (tau - 600) / 1440)) * gewFaktor;
      }
      if (tag) for (const e of schnell)
        exo += (e.einheiten || 0) * PARAM.ieFaktorSchnell * gamma2(t - e.zeit, PARAM.schnellPeak) * gewFaktor;

      // --- Leber: Abgabe sinkt mit Insulin, steigt bei Unterzucker (Glukagon) und Sport
      const leber = PARAM.leberBasal * P.leberFaktor *
        clamp(PARAM.leberMax - 0.6 * P.leberSi * Ie / PARAM.ibRef, PARAM.leberMin, PARAM.leberMax) +
        P.glukagon * Math.max(0, 75 - G) +
        P.sportKomp * uSport * clamp((115 - G) / 30, 0, 1); // Leber gleicht Sport nur aus, wenn BZ nicht hoch ist

      // --- Verbrauch
      const gewebe = P.si * empf * Ie * G + uSport;          // Muskel/Fett (Insulin + Sport)
      const niere = PARAM.nierenRate * Math.max(0, G - PARAM.nierenSchwelle);

      Gprev = G;
      G = Math.max(20, G + ra + leber - PARAM.gehirn - gewebe - niere);
      I = Math.max(0, I + sek - k * I + exo);
      Ie += (I - Ie) / PARAM.insulinWirkTau;
      Gs += (G - Gs) / P.sensorLag;

      if (tag) {
        outG[t] = G; outI[t] = I;
        fluss.darm[t] = ra; fluss.leber[t] = leber; fluss.gewebe[t] = gewebe; fluss.niere[t] = niere;
      }
    }
    return { G: outG, I: outI, fluss, profil: profilKey };
  }

  function statistik(sim, profilKey) {
    const P = PROFILE[profilKey] || PROFILE.gesund;
    const [lo, hi] = P.ziel;
    let max = -1, maxT = 0, min = 1e9, minT = 0, sum = 0, inZiel = 0, unter = 0, ueber = 0, imax = 0, imaxT = 0;
    const G = sim.G;
    for (let t = 0; t < G.length; t++) {
      const g = G[t];
      if (g > max) { max = g; maxT = t; }
      if (g < min) { min = g; minT = t; }
      if (sim.I[t] > imax) { imax = sim.I[t]; imaxT = t; }
      sum += g;
      if (g < lo) unter++; else if (g > hi) ueber++; else inZiel++;
    }
    return {
      max: Math.round(max), maxT, min: Math.round(min), minT,
      mittel: Math.round(sum / G.length),
      zielProzent: Math.round(100 * inZiel / G.length),
      unterMin: unter, ueberMin: ueber, ziel: [lo, hi],
      insulinMax: Math.round(imax), insulinMaxT: imaxT
    };
  }

  // Bewertung für den Optimierer (kleiner = besser)
  function bewertung(sim, profilKey) {
    const hi = (PROFILE[profilKey] || PROFILE.gesund).ziel[1];
    let s = 0;
    for (const g of sim.G) s += Math.max(0, g - hi) / 5 + Math.max(0, g - (hi - 30)) / 30 + Math.max(0, 70 - g);
    return s;
  }

  // Lokale Peaks (für Erklärungen)
  function spitzen(sim, minHoehe) {
    const G = sim.G, res = [];
    for (let t = 15; t < G.length - 15; t++) {
      if (G[t] >= G[t - 15] && G[t] >= G[t + 15] && G[t] >= G[t - 1] && G[t] > G[t + 1]) {
        let basis = Math.min(...Array.from(G.slice(Math.max(0, t - 120), t)));
        if (G[t] - basis >= (minHoehe || 15)) res.push({ t, wert: Math.round(G[t]), anstieg: Math.round(G[t] - basis) });
      }
    }
    return res;
  }

  const api = { PARAM, PROFILE, simuliere, statistik, bewertung, spitzen, mahlzeitKinetik, standardTherapie };
  root.GlukoSim = api;
  if (typeof module !== 'undefined') module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
