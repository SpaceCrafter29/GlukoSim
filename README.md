# GlukoSim – Blutzucker-Simulator (Bio-Projekt)

Web-App (PWA): Du planst einen Tag, und ein Algorithmus findet den Tagesablauf, bei dem der Blutzucker am ruhigsten bleibt –
für **Gesund**, **Diabetes Typ 1** und **Typ 2**.

## Ablauf
Jeden neuen Tag startet ein kurzer Assistent:
1. **Stoffwechsel** wählen: Gesund, Typ 1 oder Typ 2.
2. **Mahlzeiten** (Frühstück, Mittag, Abend) eintragen, z. B. „Nudeln 250 g, Tomatensoße 150 g“ –
   jeweils mit **Zeitraum** (frühestens–spätestens) oder **fester Uhrzeit**. Snacks trägt man nicht ein.
3. **Bewegung**: Spazieren, Joggen oder Radfahren, 10–60 min, plus wann man Zeit hat (Standard 15:00–20:30).

Danach klickt man sich durch die Schritte des Algorithmus (aktuelle Kurve + gestrichelt die vorige):
1. **Dein Plan** – alles in der Mitte der Zeiträume, ohne Optimierung
2. **Beste Uhrzeiten** – Mahlzeiten und Bewegung innerhalb der Zeiträume optimal verteilt
3. **Snack-Vorschlag** – z. B. den Saft nicht zum Frühstück, sondern später als Snack; bei Typ 1 ein Snack gegen Unterzucker beim Sport
4. **Kleine Ausnahme** – eine Mahlzeit knapp (max. 60 min) außerhalb des Zeitraums, wenn das spürbar hilft

Schritte 3 und 4 erscheinen nur, wenn sie wirklich etwas verbessern. Kein angezeigter Wert wird durch einen Schritt schlechter.
Die Symbole unter der Kurve lassen sich ziehen. Tabs: **Heute**, **Vergleich** (alle 3 Profile), **Einstellungen**.

Regeln des Algorithmus: mind. 1 h zwischen Mahlzeiten, Reihenfolge Frühstück → Mittag → Abend, kein Sport vor dem Frühstück,
kein intensiver Sport direkt nach dem Essen, ausgelagert werden nur typische Snacks (Obst, Saft, Süßes, Joghurt).
Typ 1 spritzt automatisch nach Faustregel (1 IE pro 10 g KH, 16 IE Langzeitinsulin) – abschaltbar in den Einstellungen.

## Das Modell in 5 Regeln
1. **Essen:** Kohlenhydrate gehen als Glukose ins Blut – schnell bei hohem GI, langsamer mit Fett und Ballaststoffen.
2. **Insulin:** Die Bauchspeicheldrüse schüttet es bei steigendem Blutzucker aus; Muskel- und Fettzellen nehmen dann Glukose auf.
   Gesund: schnell und passend · Typ 1: kein eigenes Insulin · Typ 2: Insulin wirkt schwächer (Insulinresistenz).
3. **Leber:** gibt Glukose ab, wenn wenig Insulin da ist, und bei Unterzucker (Glukagon).
4. **Sport:** Muskeln nehmen Glukose auch ohne Insulin auf (GLUT4).
5. **Niere:** scheidet ab ca. 180 mg/dl Zucker mit dem Urin aus.

Alle Parameter stehen oben in `sim.js`. Schulprojekt – keine medizinische Beratung.

## GitHub Pages
1. Alle Dateien ins Repository hochladen (Add file → Upload files → Commit).
2. Settings → Pages → Branch `main`, Ordner `/ (root)` → Save.
3. Nach 1–2 Minuten: `https://BENUTZERNAME.github.io/REPO/` → am Handy in Chrome → **App installieren**.

## Datenquellen
- **Nährwerte:** Tabelle `lebensmittel.csv` (56 Lebensmittel, Werte pro 100 g), getrennt vom Code.
  Quelle: Max Rubner-Institut (2025), *Bundeslebensmittelschlüssel (BLS) 4.0*, DOI 10.25826/Data20251217-134202-0, Lizenz CC BY 4.0, https://blsdb.de
  **Werte eintragen:** Lebensmittel auf blsdb.de suchen → Kohlenhydrate (verwertbar), Zucker, Ballaststoffe, Fett, Eiweiß, kcal pro 100 g übernehmen →
  in der Spalte `Naehrwert_Quelle` die BLS-Bezeichnung eintragen. In Excel als **„CSV UTF-8 (durch Trennzeichen getrennt)“** speichern, sonst gehen Umlaute kaputt.
- **Glykämischer Index:** Spalte `GI` in derselben Tabelle, Quelle pro Zeile in `GI_Quelle`: Atkinson, Foster-Powell & Brand-Miller (2008), *International Tables of Glycemic Index and Glycemic Load Values*, Diabetes Care 31:2281, Tabelle 1.
- **Aufnahme aus dem Darm (wann steigt es):** Zwei-Kammer-Modell (Magen → Dünndarm) nach Hovorka et al. (2004), Physiol Meas 25:905. Aufnahmerate ∝ t/τ² · e^(−t/τ), Maximum nach τ Minuten; τ hängt in GlukoSim von GI, Fett, Eiweiß und Ballaststoffen ab.
- **Grenzwerte:** Diagnosekriterien der DDG (nüchtern ≥ 126, oGTT 2 h ≥ 200 mg/dl).

Unbekannte Lebensmittel werden nicht erkannt – die Liste der bekannten Lebensmittel steht in der App unter den Mahlzeiten.

Nach Code-Änderungen in `sw.js` die Versionsnummer bei `CACHE` hochzählen.
