/* Beispieltag für die Präsentation (Eingaben des Assistenten) */
(function (root) {
  'use strict';
  const L = root.Lebensmittel;
  function mahlzeit(art, text, von, bis, festZeit) {
    const z = L.parse(text).zutaten;
    return { id: 'demo-' + art, art, eingabe: text, quelle: 'Liste', zutaten: z, summe: L.summe(z), fest: festZeit != null, zeit: festZeit, von, bis };
  }
  function eingaben() {
    return {
      mahlzeiten: [
        mahlzeit('fruehstueck', 'Toast 80 g, Nutella 30 g, Orangensaft 250 ml', 390, 450),   // 6:30–7:30
        mahlzeit('mittag', 'Nudeln 250 g, Tomatensoße 150 g, Cola 330 ml', null, null, 795), // fest 13:15 (Mensa)
        mahlzeit('abend', 'Reis 250 g, Hähnchen 150 g, Apfel 150 g', 1080, 1170)            // 18:00–19:30
      ],
      bewegung: [
        { id: 'demo-b1', art: 'Radfahren', dauer: 30, intensitaet: 'mittel' },
        { id: 'demo-b2', art: 'Spazieren', dauer: 20, intensitaet: 'leicht' }
      ],
      sportZeitraum: [900, 1230]
    };
  }
  root.Demo = { eingaben };
})(window);
