# Messungen

Protokoll der Messungen, mit denen Design-Parameter entschieden wurden — die
Langfassung zu den Tabellen, die als Kommentar an den Konstanten stehen. Ein
Eintrag hält fest, was gefragt war, wie gemessen wurde, was herauskam und was
daraufhin geschah. Auch dann, wenn nichts geschah: eine verworfene Änderung ist
ein Befund, und ohne Protokoll wird sie in einem halben Jahr erneut vorgeschlagen.

---

## 2026-09-24 — Kantenlöschanteil: helfen dichtere Bretter?

**Konstante:** `EDGE_DELETE_RATIO` in `src/run.js` (0.2)
**Werkzeug:** `tools/density.js`
**Ergebnis: unverändert bei 0.2.**

### Die Frage

Die Bretter sind kettenlastig: Reihen von Knoten mit nur zwei Nachbarn, auf
denen es keine Entscheidung gibt, weil ein Sender mit Reichweite 2 dort immer
dieselben fünf Knoten deckt. Interessant sind Verzweigungen.

`edgeDeleteRatio` dünnt die Delaunay-Triangulation nach dem Bau wieder aus.
Weniger löschen heißt mehr Kanten, höherer Grad, weniger Ketten. Ob das *besser*
ist, ist keine Geschmacksfrage, sondern die Frage, ob der Abstand zwischen einem
gierigen Bot und einem, der drei Züge vorausplant, mit der Dichte wächst. Dieser
Abstand ist der ganze Lohn fürs Vorausdenken. Bleibt er flach, ist ein dichteres
Brett nur ein anderes Brett.

### Methode

Drei Tabellen, weil die naheliegenden zwei die Frage nicht entscheiden. Dichte
fügt nicht nur Verzweigungen hinzu, sie vergrößert auch jeden Ball — und ein
Brett, das billiger zu decken ist, ist leichter, unabhängig von seiner Form. Ein
Abstand, der wächst, weil der Planer aufgehört hat zu sterben, ist kein Abstand,
der Vorausdenken belohnt.

1. **Brettform** — Grad, Ketten, Ballgröße. 300 Bretter je Stufe, Knotenzahlen
   und Gitter wie im Endlosmodus.
2. **Beide Bots mit dem ausgelieferten Depot.** 300 Partien je Bot und Stufe,
   gleiche Seeds für beide Bots.
3. **Beide Bots mit nach Ballgröße angeglichenem Depot**, so dass jede Dichte
   etwa gleich viele Sender pro Knoten kostet.

Tabelle 2 beantwortet die Frage wie gestellt. Tabelle 3 sagt, ob die Antwort von
der Form kommt oder nur von der Schwierigkeit.

Gemessen wurde gegen `lookaheadChoice`, nicht nur gegen `greedyChoice`.

### 1. Brettform

300 Bretter je Zeile. „In Ketten" zählt Grad-2-Knoten, deren Nachbarn *ebenfalls*
Grad 2 haben — die sitzen in einer Kette und nicht bloß neben einer Verzweigung.
„Ball" ist die mittlere Ballgröße unter der Sendermischung des Modus, also wie
viele Knoten ein Sender kauft.

| Löschanteil | Kanten/Brett | Ø-Grad | Grad 2 | in Ketten | Ball | Depotfaktor |
| --- | --- | --- | --- | --- | --- | --- |
| 0.00 | 74.8 | 3.53 | 23.0 % | 2.1 % | 8.45 | 0.824 |
| 0.05 | 71.5 | 3.37 | 27.1 % | 2.9 % | 8.14 | 0.855 |
| 0.10 | 67.7 | 3.19 | 32.5 % | 3.9 % | 7.76 | 0.897 |
| 0.15 | 64.0 | 3.02 | 38.8 % | 5.3 % | 7.38 | 0.944 |
| **0.20** | **60.2** | **2.84** | **46.3 %** | **7.5 %** | **6.96** | **1.000** |
| 0.30 | 52.9 | 2.50 | 63.9 % | 17.2 % | 6.06 | 1.149 |

Die Beschwerde ist damit beziffert und berechtigt: auf dem ausgelieferten Brett
hat fast jeder zweite Knoten Grad 2. Weniger löschen räumt die Ketten wirklich
weg — bei 0.10 halbiert sich der Kettenanteil, bei 0 ist er praktisch weg.

Die Ballgröße steigt dabei von 6.96 auf 8.45. Das ist der Störfaktor, den
Tabelle 3 herausrechnet.

### 2. Mit dem ausgelieferten Depot

300 Partien je Bot und Zeile, gleiche Seeds.

| Löschanteil | gierig Median | p90 | Mittel | SD | voraus Median | p90 | Mittel | SD | Abstand | Verhältnis | am Deckel |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0.00 | 7.5 | 20.0 | 11.14 | 8.05 | 105.0 | 200.0 | 110.68 | 72.82 | +97.5 | 9.94x | 26 % |
| 0.05 | 7.0 | 16.0 | 9.09 | 5.58 | 52.0 | 193.1 | 72.45 | 63.82 | +45.0 | 7.97x | 9 % |
| 0.10 | 7.0 | 12.0 | 7.14 | 3.54 | 28.0 | 81.2 | 39.03 | 34.53 | +21.0 | 5.46x | 1 % |
| 0.15 | 6.0 | 9.1 | 6.29 | 2.74 | 14.5 | 40.1 | 19.54 | 14.16 | +8.5 | 3.11x | 0 % |
| **0.20** | 5.0 | 7.0 | 5.16 | 2.08 | 9.0 | 21.0 | 11.45 | 7.14 | +4.0 | **2.22x** | 0 % |
| 0.30 | 3.0 | 6.0 | 3.72 | 1.50 | 6.0 | 8.0 | 6.22 | 1.82 | +3.0 | 1.67x | 0 % |

Das sieht spektakulär aus und ist eine Falle. Der Abstand explodiert, weil das
Brett billiger zu decken wird und der Planer schlicht aufhört zu sterben. Die
Spalte „am Deckel" sagt es: bei 0.00 stehen 26 % seiner Partien auf dem
200-Etappen-Deckel, die Zeile ist eine Untergrenze und keine Messung.

### 3. Mit nach Ballgröße angeglichenem Depot

Depotkurve mit dem Depotfaktor aus Tabelle 1 skaliert (`start` und `floor`), so
dass jede Dichte gleich viele Sender pro Knoten kostet. Keine Zeile steht mehr
am Deckel.

| Löschanteil | gierig Median | Mittel | voraus Median | Mittel | SD | Abstand | Verhältnis |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.00 | 5.0 | 4.89 | 10.0 | 10.23 | 3.75 | +5.0 | 2.09x |
| 0.05 | 5.0 | 5.06 | 9.0 | 10.18 | 6.91 | +4.0 | 2.01x |
| 0.10 | 5.0 | 5.09 | 9.0 | 9.99 | 4.86 | +4.0 | 1.96x |
| 0.15 | 5.0 | 5.07 | 9.0 | 12.98 | 8.61 | +4.0 | 2.56x |
| **0.20** | 5.0 | 5.16 | 9.0 | 11.45 | 7.14 | +4.0 | **2.22x** |
| 0.30 | 6.0 | 6.06 | 10.0 | 11.10 | 5.15 | +4.0 | 1.83x |

Nachgemessen mit zwei weiteren Startseeds, je 300 Partien je Bot und Zeile, weil
die 0.15-Zeile aus der Reihe fällt:

| Löschanteil | Seed 1 | Seed 1001 | Seed 2001 | Mittel |
| --- | --- | --- | --- | --- |
| 0.00 | 2.09x | 1.93x | 1.97x | 2.00 |
| 0.05 | 2.01x | 2.05x | 1.91x | 1.99 |
| 0.10 | 1.96x | 1.91x | 1.95x | 1.94 |
| 0.15 | 2.56x | 2.58x | 2.53x | 2.56 |
| **0.20** | 2.22x | 2.24x | 2.20x | **2.22** |
| 0.30 | 1.83x | 1.80x | 1.88x | 1.84 |

### Befund

**Der Abstand wächst nicht mit der Dichte.** Der Medianabstand ist über alle
Dichten und alle drei Seeds hinweg konstant +4 Etappen. Die dichteren Bretter
(0.00 bis 0.10) liegen im Verhältnis mit ~1.95x sogar *unter* dem heutigen 0.20
mit 2.22x. Weniger löschen kauft Verzweigungen, aber es kauft kein Vorausdenken.

Die Erklärung, warum die Ketten weniger schaden als vermutet: was eine Kette
kostet, ist nicht die Wahl, *wo* in ihr ein Sender steht — sondern *welchen*
Sender man für sie verbraucht und welchen man für die Verzweigung aufhebt. Diese
Entscheidung bleibt, egal wie wenige Ketten das Brett hat.

Damit gilt die Vorgabe der Fragestellung: Abstand flach, also bleibt 0.2.

### Nebenbefund, offen

Die 0.15-Zeile liegt reproduzierbar bei 2.53–2.58x, über alle drei Seeds. Das
ist kein Rauschen, aber auch kein Dichtetrend — ein einzelner Buckel zwischen
zwei niedrigeren Nachbarn. Auffällig ist die Streuung dort: SD 8.5–8.9 gegen
3.2–6.6 in allen anderen Zeilen, also ein schwerer Schwanz und keine breite
Verbesserung.

Verdacht: das Depot ist `Math.max(1, Math.round(nodeCount * ratio))`, und der
Angleichfaktor 0.944 schiebt die gerundete Depotgröße auf einzelnen Etappen um
genau einen Sender. Das wäre ein Artefakt der Angleichung und keine Eigenschaft
von 0.15.

Das verdient eine eigene Messung — sinnvoll wäre, die Depotgröße direkt statt
über die Kurve zu setzen und über ganze Sender zu sweepen. Als Argument für eine
Umstellung des Standards taugt es nicht.

### Reproduktion

```sh
node tools/density.js --runs=300 --boards=300 --seed=1
node tools/density.js --ratios=0,0.1,0.2 --runs=100   # schnellere Stichprobe
```

Tabelle 2 ist bei kleinen Löschanteilen teuer, weil der Planer dort hunderte
Etappen überlebt: die 0.00-Zeile allein braucht rund neun Minuten bei 300
Partien. Tabelle 1 und 3 laufen in Sekunden.

### Was blieb

- `src/run.js` — `EDGE_DELETE_RATIO` trägt die Messung im Kommentar; Wert
  unverändert 0.2. `edgeDeleteRatio` ist jetzt über die Config überschreibbar,
  damit ein Sweep ihn setzen kann; die Vorgabe ist dieselbe wie vorher, die
  Level-Sets bleiben byte-identisch.
- `tools/endless.js` — `STAGE_CAP` exportiert, damit ein Sweep ausweisen kann,
  wie viel seiner Tabelle auf dem Deckel steht.
- `tools/density.js` — neu.

---

## 2026-09-24 — Verstärker: belohnt ein Knoten mit Reichweite +1 das Vorausdenken?

**Mechanik:** neuer Knotentyp; ein Sender, der auf ihm steht, reicht einen
Schritt weiter. Sonst ein gewöhnlicher Knoten: muss versorgt werden, gibt Signal
weiter. Als Variante `bfsWithinAmplified` neben `bfsWithinBlocked`, bestehende
Läufe unverändert; `amplifierRatio` nur im Endlosmodus.
**Werkzeug:** `tools/amplifier.js`
**Ergebnis: nicht eingebaut.** Der Endlosmodus kennt weiterhin keine Verstärker.

### Die Frage

Ausdrücklich nicht, das Spiel schwerer zu machen. Die Schwierigkeit soll bleiben,
wo sie ist, und das Vorausplanen soll mehr einbringen. Gemessen wird das am
Abstand zwischen dem gierigen und dem planenden Bot: wächst das Verhältnis ihrer
Mittelwerte, während der Preis eines Knotens stillsteht, belohnt der Verstärker
das Vorausdenken. Bleibt es flach, ist er Zierde.

Weil ein Verstärker jedes Brett billiger zu decken macht, wird die
Sendermischung zugunsten kleinerer Reichweiten gekippt, bis die mittlere
Ballgröße wieder auf dem heutigen Wert von 6.96 steht. Erst dann ist der
Vergleich der Bot-Abstände aussagekräftig.

### Methode

Ein Knopf für die Mischung: `Gewicht(r) = Basis(r) · exp(−t · r)`, bei `t = 0`
die ausgelieferte 4/4/2. Monoton und einknöpfig, also per Bisektion auf eine
Zielballgröße lösbar — und die mildeste Form, die die Vorgabe erfüllt: die
Mischung zu kürzeren Reichweiten verschieben, nicht neu erfinden.

Die Ballgröße wird pro Kartenradius gemessen (Mittel über jeden Knoten jedes
Bretts, Verstärker mit ihrem Bonus). Die Ballgröße unter einer beliebigen
Mischung ist dann das gewichtete Mittel dieser drei Zahlen, also lösbar statt
messbar. Gemessen auf derselben Brettstichprobe wie `tools/density.js` — dieselbe
Seed-Arithmetik, dieselben 300 Bretter, keine undurchlässigen Knoten —, weil
deren 6.96 der Bezugswert ist und ein Bezugswert auf anderer Stichprobe keiner
wäre. Gespielt wird durch `run.js`, also mit den 5 % Blockaden des Modus.

Drei Anker, weil der naheliegende nicht hält:

- **A — mittlere Ballgröße 6.96**, der Anker aus der Vorgabe (Tabelle 2).
- **B — Mittelwert des gierigen Bots**, gehalten über dieselbe Mischung
  (Tabelle 4). Nötig, weil A die Schwierigkeit nicht stillhält.
- **C — Mittelwert des gierigen Bots**, gehalten über die Depotgröße bei
  unveränderter 4/4/2 (Tabelle 5). Nötig, weil B die Mischung platt walzt und
  *welchen* Sender man wofür aufhebt selbst ein Teil des Vorausdenkens ist.

Dazu ein Maßstab (Tabelle 6): dasselbe Brett ohne Verstärker, nur mit größerem
Depot. Er sagt, wieviel Verhältnis bloße Leichtigkeit kauft — was jede Zeile der
anderen Tabellen erst schlagen muss.

### 0. Ohne jede Angleichung

500 Partien je Bot, gleiche Seeds, ausgelieferte Mischung 4/4/2:

| Verstärkerdichte | gierig Mittel | voraus Mittel | Verhältnis |
| --- | --- | --- | --- |
| 0.00 | 5.36 | 11.60 | 2.16x |
| 0.15 | 16.75 | 132.28 | 7.90x |

Das ist die Falle aus der Messung oben und keine Antwort: bei einem Mittel von
132 gegen einen 200-Etappen-Deckel hat der Planer aufgehört zu sterben, die
Zeile ist eine Untergrenze. Deshalb die Angleichung.

### 1. Der Preis eines Knotens, und was ihn zurückholt

300 Bretter je Stufe, Knotenzahlen wie im Endlosmodus. „Ball rN" ist die mittlere
Ballgröße eines Senders mit Radius N. Radius 4 kommt als Karte nicht vor und
steht nur für die Diagnose weiter unten.

| Dichte | Ball r1 | r2 | r3 | (r4) | Ball bei 4/4/2 | Tilt t | Mischung | **erreichte Ballgröße** |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0.00 | 3.84 | 7.62 | 11.91 | 16.55 | 6.96 | 0.000 | 40/40/20 | **6.963** |
| 0.03 | 3.96 | 7.76 | 12.06 | 16.71 | 7.10 | 0.062 | 42/39/19 | **6.963** |
| 0.06 | 4.07 | 7.88 | 12.20 | 16.85 | 7.22 | 0.117 | 44/39/17 | **6.963** |
| 0.09 | 4.17 | 8.00 | 12.32 | 16.97 | 7.33 | 0.167 | 45/38/16 | **6.963** |
| 0.12 | 4.29 | 8.13 | 12.47 | 17.13 | 7.46 | 0.229 | 47/38/15 | **6.963** |
| 0.15 | 4.41 | 8.27 | 12.61 | 17.28 | 7.60 | 0.292 | 49/37/14 | **6.963** |

Die Angleichung sitzt auf drei Nachkommastellen. Die Dichte 0 reproduziert den
Bezugswert 6.96 exakt, also misst dieselbe Stichprobe dasselbe wie damals.

### 2. Angleichung über die mittlere Ballgröße (Anker A)

500 Partien je Bot und Zeile, gleiche Seeds, gleiche Bretter. Der Planer steht in
keiner Zeile am Deckel. „Genutzter Ball" ist die mittlere Ballgröße der
*tatsächlich gesetzten* Sender, gierig/voraus.

| Dichte | Mischung | genutzter Ball g/v | gierig Median / Mittel | voraus Median / Mittel | voraus SD | Verhältnis | Züge abweichend |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.00 | 40/40/20 | 7.7 / 8.5 | 5.0 / 5.36 | 10.0 / 11.60 | 6.25 | 2.16x | 25.2 % |
| 0.03 | 42/39/19 | 7.8 / 8.9 | 5.0 / 5.64 | 12.0 / 14.77 | 9.85 | 2.62x | 24.5 % |
| 0.06 | 44/39/17 | 8.1 / 9.5 | 6.0 / 6.49 | 12.0 / 21.32 | 21.25 | 3.28x | 24.2 % |
| 0.09 | 45/38/16 | 8.5 / 10.0 | 7.0 / 7.33 | 19.0 / 31.33 | 30.74 | 4.27x | 24.7 % |
| 0.12 | 47/38/15 | 8.7 / 9.6 | 7.0 / 8.11 | 16.0 / 21.50 | 15.67 | 2.65x | 23.1 % |
| 0.15 | 49/37/14 | 8.8 / 9.5 | 8.0 / 8.28 | 15.0 / 19.14 | 12.13 | 2.31x | 22.7 % |

**Der Anker hält nicht.** Die Ballgröße steht auf 6.96, aber der gierige Bot
klettert von 5.36 auf 8.28 Etappen: der Modus ist am oberen Ende gut die Hälfte
leichter geworden. Die Spalte „genutzter Ball" sagt warum — kein Bot setzt auf
einen durchschnittlichen Knoten. Was er tatsächlich kauft, steigt von 7.7/8.5 auf
8.8/9.5, obwohl das Brettmittel stillsteht.

Das ist ein Befund über die Methode, nicht nur über den Verstärker: die
Angleichung über die mittlere Ballgröße setzt voraus, dass die Knoten
untereinander austauschbar sind. Sobald ein Knotentyp sich *aussuchen* lässt,
ist das Mittel über alle Knoten nicht mehr der Preis, den ein Spieler zahlt. Für
`edgeDeleteRatio` galt die Voraussetzung, hier gilt sie nicht.

Die Verhältnisse dieser Tabelle sind damit untereinander nicht vergleichbar. Der
Buckel bei 0.09 (4.27x) steht auf einer Zeile, die schon 37 % leichter ist als
ihre Bezugszeile, mit SD 30.7 — ein schwerer Schwanz, kein Lohn fürs Denken.

### 3. Wer stellt auf einen Verstärker?

Anteil der gesetzten Sender, die auf einem Verstärker landen, gegen den Anteil
der Verstärker unter den *freien* Knoten im selben Moment (nicht gegen die
Dichte: das Brett füllt sich im Lauf einer Etappe).

| Dichte | gierig setzt darauf | blind erwartet | Faktor | voraus setzt darauf | blind erwartet | Faktor |
| --- | --- | --- | --- | --- | --- | --- |
| 0.03 | 15.1 % | 2.0 % | 7.72x | 15.9 % | 1.9 % | 8.38x |
| 0.06 | 23.9 % | 3.7 % | 6.37x | 27.9 % | 4.2 % | 6.71x |
| 0.09 | 32.0 % | 6.2 % | 5.19x | 34.6 % | 5.9 % | 5.84x |
| 0.12 | 39.8 % | 9.0 % | 4.44x | 42.4 % | 8.8 % | 4.81x |
| 0.15 | 45.9 % | 11.8 % | 3.89x | 49.4 % | 11.8 % | 4.20x |

Auf dem zweiten Seed identisch (0.15: 46.1 % gegen 49.5 %).

**Beide Bots greifen fast gleich oft zum Verstärker.** Der gierige holt 93 bis
95 % dessen, was der planende holt, und beide liegen das Vier- bis Achtfache
über dem Zufall. Das ist die billige Probe aus der Fragestellung, und sie fällt
negativ aus: ein Verstärker ist kein Plan, er ist schlicht das bessere Feld, und
das sieht man ohne vorauszuschauen.

### 4. Schwierigkeit ehrlich festgehalten, über die Mischung (Anker B)

Die Mischung wird gekippt, bis der gierige Bot wieder bei 5.23 Etappen steht.
500 Partien je Bot, 300 je Bisektionsschritt.

| Dichte | Tilt t | Mischung | Ballgröße | gierig Mittel | voraus Mittel | Verhältnis | Züge abweichend |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.00 | 0.000 | 40/40/20 | 6.96 | 5.36 | 11.60 | 2.16x | 25.2 % |
| 0.03 | 0.330 | 51/36/13 | 6.40 | 5.50 | 9.29 | 1.69x | 22.0 % |
| 0.06 | 0.381 | 52/36/12 | 6.42 | 5.94 | 10.15 | 1.71x | 21.4 % |
| 0.09 | 0.381 | 52/36/12 | 6.53 | 6.47 | 11.69 | 1.81x | 21.6 % |
| 0.12 | 0.600 | 59/32/9 | 6.26 | 5.65 | 13.45 | 2.38x | 22.3 % |
| 0.15 | 0.600 | 59/32/9 | 6.39 | 6.47 | 17.49 | 2.70x | 22.8 % |

Der Pin ist grob: das Depot hält vier bis neun Sender, und keine Mischung
verschiebt es in weniger als ganzen Sendern. Die Zeilen landen bei 5.5 bis 6.5
statt bei 5.23, also eher zu leicht.

Auffällig ist, wonach sich das Verhältnis hier richtet — nicht nach der Dichte,
sondern nach der **Mischung**: 40/40/20 gibt 2.16x, 52/36/12 gibt 1.69–1.81x,
59/32/9 gibt 2.38–2.70x. Zwei Zeilen stehen bei exakt derselben Schwierigkeit
(gierig 6.47) und geben 1.81x gegen 2.70x — sie unterscheiden sich in der
Mischung. Der zweite Seed reproduziert die 0.15-Zeile auf 1 % genau (6.52 /
17.78 / 2.73x).

Anker B beantwortet die Frage also bei ehrlicher Schwierigkeit, aber mit einem
Störfaktor, den er selbst einführt. Dafür ist Tabelle 5 da.

### 5. Gegenprobe über das Depot (Anker C)

Mischung bleibt die ausgelieferte 4/4/2, stattdessen wird das Depot skaliert,
bis der gierige Bot wieder auf seinem Bezugswert steht. Damit ist der Verstärker
das einzige, was sich zwischen den Zeilen ändert. Seed 1, 500 Partien je Bot:

| Dichte | Depotfaktor | Ballgröße | genutzter Ball g/v | gierig Mittel | voraus Mittel | voraus SD | Verhältnis | Züge abweichend |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0.00 | 1.000 | 6.96 | 7.7 / 8.5 | 5.36 | 11.60 | 6.25 | 2.16x | 25.2 % |
| 0.03 | 0.953 | 7.10 | 8.1 / 9.4 | 5.77 | 15.88 | 16.70 | 2.75x | 24.1 % |
| 0.06 | 0.911 | 7.22 | 8.4 / 9.3 | 5.32 | 11.23 | 6.84 | 2.11x | 23.7 % |
| 0.09 | 0.846 | 7.33 | 8.8 / 9.5 | 4.81 | 9.40 | 5.61 | 1.95x | 22.4 % |
| 0.12 | 0.846 | 7.46 | 9.1 / 10.1 | 5.16 | 11.59 | 10.13 | 2.25x | 23.2 % |
| 0.15 | 0.823 | 7.60 | 9.3 / 10.0 | 5.09 | 9.68 | 4.38 | 1.90x | 22.1 % |

Hier hält der Pin: der gierige Bot bleibt zwischen 4.81 und 5.77 Etappen. Vier
Seeds, Verhältnis und Zuganteil nebeneinander (Seed 1001 mit 250 Partien je Bot,
die übrigen mit 500):

| Dichte | Seed 1 | Seed 1001 | Seed 2001 | Seed 3001 | **Mittel** | Züge abweichend (Mittel) |
| --- | --- | --- | --- | --- | --- | --- |
| 0.00 | 2.16x | 2.29x | 2.24x | 2.10x | **2.20** | 25.0 % |
| 0.03 | 2.75x | 2.01x | 2.47x | 2.39x | **2.41** | 24.4 % |
| 0.06 | 2.11x | 1.88x | 1.92x | 2.04x | **1.99** | 22.8 % |
| 0.09 | 1.95x | 1.97x | 2.20x | 1.93x | **2.01** | 22.4 % |
| 0.12 | 2.25x | 1.82x | 2.43x | 2.38x | **2.22** | 23.3 % |
| 0.15 | 1.90x | 1.79x | 1.92x | 1.88x | **1.87** | 22.2 % |

Das Verhältnis wächst nicht. Es steht bei 2.20 ohne Verstärker und bei 1.87 bei
der höchsten Dichte, und keine Zeile liegt belastbar über der Bezugszeile. Der
Medianabstand fällt von +4 auf +3 bis +4 Etappen.

Die beiden Zeilen, die aus der Reihe fallen (0.03 und 0.12), tragen in jedem
Seed dieselbe Signatur: eine SD von 10 bis 17 gegen 4 bis 7 in den übrigen, also
ein schwerer Schwanz aus wenigen sehr langen Partien. Das ist der bereits
protokollierte Rundungseffekt — `Math.round(nodeCount · ratio)` schiebt die
Depotgröße auf einzelnen Etappen um einen ganzen Sender — und kein Dichtetrend:
die Nachbarn links und rechts liegen beide niedriger.

Der Zuganteil ist die stabilste Zahl der ganzen Messung und fällt monoton von
25.0 % auf 22.2 %: **mit Verstärkern sind sich die beiden Bots einiger als
ohne.**

### 6. Maßstab: nur leichter, ohne Verstärker

Dasselbe Brett ohne Verstärker, Depot vergrößert, bis der gierige Bot die
angegebene Schwierigkeit erreicht. 500 Partien je Bot.

| Zielschwierigkeit | Depotfaktor | gierig Mittel | voraus Mittel | Verhältnis | Züge abweichend |
| --- | --- | --- | --- | --- | --- |
| 5.50 | 1.034 | 5.36 | 12.49 | 2.33x | 25.4 % |
| 5.90 | 1.042 | 5.93 | 13.27 | 2.24x | 25.3 % |
| 6.50 | 1.049 | 6.48 | 14.91 | 2.30x | 25.6 % |

Bloße Leichtigkeit kauft in diesem Bereich **kein** Verhältnis: es bleibt flach
bei 2.24–2.33x, der Zuganteil bei 25.4 %. Damit gibt es auch keinen Bonus, den
man den Verstärker-Zeilen noch gutschreiben müsste — die Zeilen der Tabellen 4
und 5, die etwas zu leicht geraten sind, sind dadurch nicht besser geworden.

### Befund

**Nein. Das Verhältnis wächst nicht, während die Ballgröße steht — es fällt.**
Bei ehrlich festgehaltener Schwierigkeit und unveränderter Mischung geht es über
vier Seeds von 2.20 auf 1.87 zurück, und der Anteil der Züge, in denen die
beiden Bots verschiedenes wollen, von 25.0 % auf 22.2 %. Der Verstärker wird
nicht eingebaut.

Warum es nicht funktioniert, in zwei Zahlen aus Tabelle 1 und 3:

1. **Der Bonus ist für jede Karte fast gleich viel wert.** Was ein Verstärker
   einem Sender mit Radius r bringt, ist `Ball(r+1) − Ball(r)`: 3.78 Knoten für
   Radius 1, 4.29 für Radius 2, 4.64 für Radius 3. Der lange Sender gewinnt
   knapp einen Knoten mehr als der kurze. „Den Dreier für den Verstärker
   aufheben" ist damit keine Entscheidung, sondern eine Nuance — und genau diese
   Zuteilung wäre das, was Vorausschauen belohnt hätte.
2. **Man muss nicht planen, um ihn zu nehmen.** Der gierige Bot setzt auf 45.9 %
   der Züge auf einen Verstärker, der planende auf 49.4 %. Ein Verstärker
   vergrößert den unmittelbaren Gewinn eines Zuges, und unmittelbaren Gewinn
   sieht der gierige Bot per Definition.

Zusammen ergibt das das Gegenteil der Absicht: der Verstärker macht den besten
Zug *offensichtlicher*. Er verengt die Auswahl, statt sie zu vertiefen — die
Bots weichen seltener voneinander ab —, und je weniger die beiden sich
unterscheiden, desto weniger ist Vorausdenken wert.

Ein Nebenbefund für künftige Messungen: **die Angleichung über die mittlere
Ballgröße hält nur, solange die Knoten austauschbar sind.** Sobald ein Knotentyp
gezielt angesteuert werden kann, liegt der Preis, den ein Spieler zahlt, über dem
Brettmittel — der Abstand zwischen genutztem Ball und Brettmittel wächst beim
gierigen Bot von 0.7 auf 1.8 Knoten je Sender —, und die Angleichung
unterkorrigiert. Sie gehört dann um einen zweiten Anker ergänzt, der am Ergebnis
festhält (Tabelle 5) statt am Brett.

Was die Messung *nicht* sagt: ob ein Verstärker als reine Abwechslung Spaß macht.
Sie sagt nur, dass er das Vorausdenken nicht belohnt — und das war die Vorgabe.

### Reproduktion

```sh
node tools/amplifier.js --runs=500 --boards=300 --diffruns=200 --pinruns=300
node tools/amplifier.js --tables=1                 # nur die Angleichung, Sekunden
node tools/amplifier.js --tables=5 --seed=2001     # die entscheidende Gegenprobe
node tools/amplifier.js --plain                    # ohne jede Angleichung (teuer)
```

Tabelle 2 ist die teuerste: bei angeglichener Mischung überlebt der Planer dort
lange, die 0.09-Zeile allein braucht rund sieben Minuten. Die Tabellen 4 und 5
laufen bei ehrlicher Schwierigkeit in ein bis zwei Minuten je Zeile, Tabelle 1 in
Sekunden. `--plain` ist bei hoher Dichte sehr teuer, weil der Planer dann
hunderte Etappen überlebt.

### Was blieb

Der Endlosmodus ist unverändert: `ENDLESS_RUN` kennt kein `amplifierRatio`, es
werden keine Verstärker ausgeteilt, und die Level-Sets bleiben byte-identisch.
Liegengeblieben ist nur, was die Messung reproduzierbar hält:

- `src/graph.js` — `amplifierNodes`, `bfsWithinAmplified`, `coverageAmplified`
  als dritte Variante neben den Blockade-Läufen. `bfsWithin` und
  `bfsWithinBlocked` sind unangetastet; auf einem Brett ohne Verstärker liefert
  der neue Lauf Knoten für Knoten dasselbe wie der blockadefeste.
- `src/run.js` — `amplifierRatio` wird wie `blockedRatio` gestreut (eigene
  Ziehung, beide Flaggen unabhängig, ein Knoten darf beide tragen), und `build()`
  wählt den passenden Lauf. Eine Config ohne das Feld rührt den Zufallsstrom
  nicht an, also bleibt das ausgelieferte Brett Bit für Bit dasselbe.
  `blockedDensity` heißt jetzt `drawDensity`, weil beide Flaggen sie benutzen.
- `tools/bot64.js` — liest das Brett durch denselben Lauf, den `run.js` dafür
  nähme.
- `tools/endless.js` — `quantile` exportiert.
- `tools/amplifier.js` — neu.

---

## 2026-09-24 — Punkte mal Etappe: ändert die Gewichtung das optimale Spiel?

**Regel:** Übrige Sender zählen mit der Etappennummer gewichtet. Score ist die
Summe über alle geräumten Etappen von `Rest × Etappennummer` statt der reinen
Summe der Reste.
**Werkzeug:** `tools/score.js`
**Ergebnis: umgesetzt.** Das optimale Spiel bleibt unverändert; die Zahlen
werden allerdings groß und laufen weit auseinander.

### Die Frage

Zwei Dinge waren vor der Umstellung zu klären. Erstens, ob die Gewichtung das
optimale Spiel verschiebt — wenn ja, ist sie eine Regeländerung und keine
Anzeige. Zweitens, in welche Größenordnung die neuen Zahlen fallen.

### Warum die Gewichtung keine Zugfolge ändern kann

Das steht vor jeder Messung fest und ist der Grund, warum die Messung überhaupt
so ausfallen musste: innerhalb der Etappe *s* ist jeder übrige Sender *s* wert —
derselbe positive Faktor für jede Entscheidung auf diesem Brett. Ein konstanter
Faktor ordnet keine Linien um. Und über Etappengrenzen hinweg lässt sich nichts
verschieben: `advance` teilt ein frisches Depot aus, übrige Sender wandern nicht
mit. Es gibt also keinen Zug, der einen Sender aus Etappe 3 nach Etappe 12 trägt,
wo er zwölfmal zählen würde.

Was sich unterscheiden *kann*, ist etwas, das es vorher schon gab: auf Punkte zu
spielen ist nicht dasselbe wie aufs Überleben zu spielen. Genau das misst der
Sweep — und er misst es damit für die alte Zählung gleich mit.

### Methode

Zwei Bots über dieselben Seeds, beide mit derselben Suchtiefe:

- **Überleben** — `lookaheadChoice`, der ausgelieferte Bot: maximiere, was am
  Ende des sichtbaren Horizonts leuchtet.
- **Punkte** — dieselbe Suche mit `frugal`: unter den Linien, die das Brett
  räumen, nimm die, die es mit weniger Sendern räumt. Nicht gesetzte Sender sind
  genau der Score. Das Brett muss trotzdem zuerst geräumt sein, ein nicht
  geräumtes zählt null.

Beide Scores werden aus `state.cleared` gelesen, das ohnehin `{stage, left}` je
geräumter Etappe führt — damit ist die neue Zählung messbar, bevor `run.js` sie
trägt, und die alte danach.

### 1. Beide Ziele über dieselben Seeds

500 Partien je Bot und Seed.

| Seed | Bot | Etappe Median / Mittel / SD | Punkte Median | p90 | p99 | max | Mittel | Rest je geräumter Etappe |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Überleben | 9.0 / 11.73 / 7.18 | 32.5 | 188.3 | 595.3 | 887 | 75.2 | 0.90 |
| 1 | Punkte | 9.0 / 11.73 / 7.18 | 39.0 | 206.5 | 650.7 | 1011 | 87.3 | 1.09 |
| 1001 | Überleben | 9.0 / 11.44 / 6.34 | 32.0 | 156.1 | 412.1 | 699 | 65.1 | 0.87 |
| 1001 | Punkte | 9.0 / 11.44 / 6.34 | 39.5 | 173.2 | 460.4 | 817 | 75.7 | 1.06 |

Die Etappenspalten sind nicht ähnlich, sie sind **identisch** — Median, Mittel
und Streuung auf jede Stelle. Paarweise nachgesehen, Seed für Seed:

| Vergleich | Punkte-Bot kommt weniger weit | kommt weiter | hat weniger Punkte | mittlerer Etappenunterschied |
| --- | --- | --- | --- | --- |
| 1000 Seeds | **0 %** | 0 % | 0 % | **0.000** |

In keiner einzigen von 1000 Partien endet der Punkte-Bot früher oder später als
der überlebende. Er spielt nicht riskanter, er kommt nicht weniger weit, und er
hat nie weniger Punkte.

### 2. Dieselben Partien, aber nicht dieselben Züge

| Seed | Züge | davon abweichend | Partien ohne jede Abweichung | erste Abweichung in Etappe |
| --- | --- | --- | --- | --- |
| 1 | 36 115 | 2.92 % | 11.6 % | 2.7 |
| 1001 | 35 078 | 2.82 % | 11.2 % | 2.8 |

Die beiden sind nicht derselbe Spieler: auf knapp 3 % der Züge wollen sie
Verschiedenes, und nur jede neunte Partie vergeht ohne eine einzige Abweichung.
Sie landen nur immer am selben Ende.

Der Grund ist die Bauart des Modus: jedes Brett und jedes Depot hängt allein an
`(seed, stage)`. Was innerhalb einer Etappe anders gespielt wird, kann die
nächste nicht erreichen. Ein Unterschied kann sich also nur auswirken, wenn er
kostet, dass eine Etappe überhaupt geräumt wird — und Sparsamkeit kostet das
nie, weil sie unter den räumenden Linien wählt. Geräumt ist geräumt.

### 3. Wo die Sender liegen bleiben

Rest je geräumter Etappe, nach Etappenblock. Die Frage war, ob der Punkte-Bot
seine Sender dort spart, wo sie am meisten wert sind, also spät.

| Seed | Bot | Etappe 1-3 | 4-6 | 7-10 | ab 11 |
| --- | --- | --- | --- | --- | --- |
| 1 | Überleben | 0.99 | 0.87 | 0.88 | 0.84 |
| 1 | Punkte | 1.32 | 1.06 | 1.01 | 0.95 |
| 1001 | Überleben | 0.94 | 0.87 | 0.88 | 0.77 |
| 1001 | Punkte | 1.27 | 1.05 | 1.00 | 0.87 |

**Nein, umgekehrt.** Der Punkte-Bot spart am meisten in den frühen Etappen
(+0.33 Sender je Brett) und am wenigsten in den späten (+0.10). Das ist keine
Eigenheit des Bots, sondern der Depotkurve: der Depotanteil startet bei 0.24 und
fällt gegen 0.15, also ist auf den frühen Brettern Luft und auf den späten
keine. Die Gewichtung belohnt damit ausgerechnet die Sender am höchsten, die am
schwersten zu sparen sind — was den Score in den späten Etappen weniger
beeinflussbar macht, nicht mehr.

### 4. Die Größenordnung

| Seed | Bot | Zählung | Median | p90 | p99 | max | Mittel | SD |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Überleben | alt | 8.0 | 19.0 | 32.0 | 39 | 9.6 | 6.5 |
| 1 | Überleben | **neu** | 32.5 | 188.3 | 595.3 | 887 | 75.2 | 114.3 |
| 1 | Punkte | alt | 10.0 | 21.0 | 36.0 | 42 | 11.7 | 7.1 |
| 1 | Punkte | **neu** | 39.0 | 206.5 | 650.7 | 1011 | 87.3 | 127.6 |
| 1001 | Überleben | alt | 7.0 | 16.0 | 26.0 | 33 | 9.1 | 5.4 |
| 1001 | Überleben | **neu** | 32.0 | 156.1 | 412.1 | 699 | 65.1 | 83.5 |
| 1001 | Punkte | alt | 9.0 | 19.0 | 30.0 | 39 | 11.0 | 6.0 |
| 1001 | Punkte | **neu** | 39.5 | 173.2 | 460.4 | 817 | 75.7 | 94.8 |

**Die Zahlen laufen auseinander.** Der Median liegt bei 32 bis 40 und damit noch
im Lesbaren, aber das p90 steht bei 156 bis 207, das p99 bei 412 bis 651, und
die besten Partien erreichen 700 bis 1011. Die Streuung ist größer als der
Mittelwert (SD 84–128 gegen Mittel 65–87). Die alte Zählung blieb überall
zweistellig, mit einem Maximum von 42.

Der Grund ist die Form der Summe. Bei ungefähr konstantem Rest *r* je Etappe ist
der neue Score

```
r · (1 + 2 + … + n) = r · n(n+1)/2
```

also **quadratisch in der Streak**, wo der alte linear war. Gerechnet: r = 1.09,
n = 11.73 ergibt 81 — gemessen wurden 87. Doppelt so weit zu kommen vervierfacht
damit die Punkte, und der lange Schwanz der Streak-Verteilung (SD 7.18 bei Mittel
11.73) wird beim Quadrieren zu einem sehr langen Schwanz der Punkteverteilung.

Das ist ehrlich zu benennen, weil es die Begründung berührt: die Gewichtung
während der Partie **entfernt das quadratische Wachstum nicht, sie halbiert es.**
Am Ende zu multiplizieren gäbe `n · r · n = r · n²`, die Gewichtung während der
Partie gibt `r · n²/2` — dieselbe Ordnung, der halbe Betrag. Was die Gewichtung
tatsächlich repariert, ist zweierlei, und beides bleibt richtig:

- **Keine Annullierung.** `Etappe × Punkte` macht aus null Punkten null, egal wie
  weit jemand kam. Bei der Gewichtung während der Partie kostet eine Etappe ohne
  Rest nur ihren eigenen Beitrag.
- **Keine rückwirkende Aufwertung.** Am Ende zu multiplizieren würde einen in
  Etappe 1 gesparten Sender mit der zuletzt erreichten Etappe bezahlen. Jetzt
  zählt jede Etappe mit dem, was sie war, als sie gespielt wurde.

### Befund

**Die Umstellung ändert das optimale Spiel nicht.** Über 1000 Partien erreicht
ein Bot, der auf den neuen Score optimiert, exakt dieselbe Etappe wie einer, der
aufs Überleben optimiert — in jedem einzelnen Seed. Er tut es mit anderen Zügen
(2.9 % Abweichung) und mit mehr Punkten (+16 % im Mittel, +20 % im Median), aber
ohne jedes Risiko: Sparsamkeit
wählt unter den Linien, die das Brett ohnehin räumen, und ein Unterschied
innerhalb einer Etappe kann die nächste nicht erreichen, weil die aus
`(seed, stage)` gezogen wird.

Der Unterschied zwischen „auf Überleben spielen" und „auf Punkte spielen" ist
damit real, aber er ist nicht neu: er bestand unter der alten Zählung genauso,
nur weniger deutlich sichtbar. Die Gewichtung vergrößert ihn nicht, sie
vergrößert nur die Zahl, die er erzeugt.

Offen bleibt die Lesbarkeit. Ein p99 von 600 und ein Maximum von 1011 sind keine
Zahl mehr, die man im Kopf vergleicht, und der quadratische Zusammenhang macht
Bestwerte zwischen zwei Spielern schwerer einzuordnen als die Etappe selbst.
Das ist eine Anzeigefrage und keine Regelfrage — sie wurde hier nicht
entschieden.

### Reproduktion

```sh
node tools/score.js --runs=500 --seed=1
node tools/score.js --runs=500 --seed=1001
node tools/score.js --runs=50            # schnelle Stichprobe, wenige Sekunden
```

Rund zwei Minuten je Seed: beide Bots, dazu ein dritter Durchgang, der die
Abweichung auf der Linie des überlebenden Bots zählt.

### Was blieb

- `src/run.js` — `build()` addiert `depot.length * base.stage` statt
  `depot.length`; die Begründung steht am Ort der Rechnung, samt dem Nachweis,
  dass die Gewichtung keine Zugfolge ändern kann.
- `test/run.test.js` — zwei neue Prüfungen: Etappe 2 trägt ihre Reste doppelt
  bei, und der Endstand ist über mehrere Seeds die Summe `Rest × Etappe` aus dem
  `cleared`-Protokoll.
- `tools/bot64.js` — `lookaheadChoice` nimmt `frugal`, den zweiten Zielbegriff.
- `tools/score.js` — neu.
- **Nicht angefasst:** der Bestwert im `localStorage` (`sendernetz.endlos.best`)
  ist eine nackte Zahl auf der alten Skala. Ein zurückkehrender Spieler
  überbietet seinen alten Rekord damit in der ersten brauchbaren Partie. Wer das
  nicht will, muss den Schlüssel versionieren — hier nicht entschieden.

*(Nachgetragen: der Bestwert ist inzwischen versioniert, siehe den nächsten
Eintrag.)*

---

## 2026-09-24 — Nachtrag zur Punktegewichtung: Teiler und alte Bestwerte

**Werkzeug:** `tools/score.js --divisors=…`
**Ergebnis:** **Teiler 2, ausschließlich in der Anzeige.** Die
Bestwert-Migration ist umgesetzt.
**Überholt:** der Teiler ist wieder draußen, siehe den nächsten Eintrag. Die
Messung selbst gilt unverändert — was nicht mehr gilt, ist die Entscheidung,
die daraus gezogen wurde.

### Teil 1: Bringt ein fester Teiler die Zahlen ins Lesbare?

#### Die Frage

Der neue Score läuft weit: p99 bei 412 bis 651, Maximum bei 1011. Ob eine
Division durch einen festen Teiler das in einen vergleichbaren Bereich bringt,
ohne die Ordnung zu ändern. Bedingungen: der Median bleibt zweistellig, das p99
wird nicht vierstellig.

#### Was eine Division kosten kann, und was nicht

Die Ordnung ist sicher. Eine Division durch eine positive Konstante kann zwei
Partien nicht vertauschen, bei keinem Teiler. Was das anschließende Runden auf
eine ganze Zahl kann, ist **binden**: zwei Partien, die vorher auseinanderlagen,
zeigen dieselbe Zahl. Vertauschen kann es nie, weil Runden monoton ist.

Zwei Kosten sind also zu messen, und beide stehen in der Tabelle: wie viele
Paare neu gebunden werden, und wie oft eine Partie, die tatsächlich gepunktet
hat, am Ende **0** anzeigt — der einzige Zusammenbruch, den ein Spieler als
Fehler lesen würde.

#### Methode

Drei Spielstärken, weil die beiden Bedingungen an verschiedenen Enden hängen.
Der gierige Bot ist die Untergrenze, der Punkte-Bot die Obergrenze, und
dazwischen steht der planende — der Spieler, gegen den dieses Projekt nach
Konvention kalibriert. 500 Partien je Stufe und Seed, gerundet mit
`Math.round`.

#### Die Zahlen

Jede Zelle: gierig / voraus / Punkte.

**Seed 1**

| Teiler | Median | p90 | p99 | max | Median ≥ 10 (voraus) | p99 < 1000 | neue Bindungen | punktende Partien auf 0 (gierig) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 6.0 / 32.5 / 39.0 | 17 / 188 / 207 | 31 / 595 / 651 | 65 / 887 / **1011** | ja | ja | 0.00 % | 0.0 % |
| **2** | 3.0 / **16.5** / 20.0 | 9 / 95 / 103 | 16 / 298 / 325 | 33 / 444 / 506 | **ja** | ja | **1.08 %** | **0.0 %** |
| 3 | 2.0 / 11.0 / 13.0 | 6 / 63 / 69 | 10 / 198 / 217 | 22 / 296 / 337 | ja | ja | 2.15 % | 6.8 % |
| 4 | 2.0 / 8.0 / 10.0 | 4 / 47 / 52 | 8 / 149 / 163 | 16 / 222 / 253 | NEIN | ja | 3.15 % | 6.8 % |
| 5 | 1.0 / 6.5 / 8.0 | 3 / 37 / 41 | 6 / 119 / 130 | 13 / 177 / 202 | NEIN | ja | 4.25 % | 14.8 % |
| 10 | 1.0 / 3.0 / 4.0 | 2 / 19 / 21 | 3 / 60 / 65 | 7 / 89 / 101 | NEIN | ja | 8.89 % | 30.8 % |

**Seed 1001**

| Teiler | Median | p90 | p99 | max | Median ≥ 10 (voraus) | p99 < 1000 | neue Bindungen | punktende Partien auf 0 (gierig) |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 6.0 / 32.0 / 39.5 | 17 / 156 / 173 | 32 / 412 / 460 | 59 / 699 / 817 | ja | ja | 0.00 % | 0.0 % |
| **2** | 3.0 / **16.0** / 20.0 | 9 / 78 / 87 | 16 / 206 / 230 | 30 / 350 / 409 | **ja** | ja | **1.13 %** | **0.0 %** |
| 3 | 2.0 / 11.0 / 13.0 | 6 / 52 / 58 | 11 / 137 / 153 | 20 / 233 / 272 | ja | ja | 2.26 % | 8.4 % |
| 4 | 2.0 / 8.0 / 10.0 | 4 / 39 / 43 | 8 / 103 / 115 | 15 / 175 / 204 | NEIN | ja | 3.43 % | 8.4 % |
| 5 | 1.0 / 6.0 / 8.0 | 3 / 31 / 35 | 6 / 82 / 92 | 12 / 140 / 163 | NEIN | ja | 4.49 % | 17.0 % |
| 10 | 1.0 / 3.0 / 4.0 | 2 / 16 / 17 | 3 / 41 / 46 | 6 / 70 / 82 | NEIN | ja | 9.52 % | 34.4 % |

#### Zwei Korrekturen an der Fragestellung

**Das p99 war nie vierstellig.** Schon ungeteilt steht es bei 412 bis 651. Was
vierstellig wird, ist das *Maximum* der besten Partie, und nur beim stärksten
Bot auf einem der beiden Seeds (1011). Teiler 2 drückt auch das auf 409 bis 506.
Die Bedingung „p99 < 1000" ist damit für jeden Teiler erfüllt und bindet nicht;
die einzige bindende Bedingung ist der zweistellige Median.

**Der zweistellige Median kann nur für den Referenzspieler gelten.** Der gierige
Bot hat schon ungeteilt einen Median von 6, also einstellig ohne jeden Teiler.
Wer die Bedingung wörtlich auf alle Spieler anwendet, kann nicht dividieren —
und auch nicht nicht-dividieren. Geprüft ist sie deshalb am planenden Bot, dem
Spieler, gegen den dieses Projekt kalibriert.

#### Befund

**Teiler 2 ist die Empfehlung.** Er ist der einzige, der beide Bedingungen mit
Luft erfüllt und dabei nichts kaputtmacht:

- Median 16.0 bis 16.5 beim Referenzspieler, also zweistellig mit Abstand zur
  Grenze — Teiler 3 landet bei 11.0 und 4 schon bei 8.0.
- Maximum 350 bis 506 statt 699 bis 1011: alles dreistellig.
- **Keine** punktende Partie zeigt 0 an, auf keiner Spielstärke. Ab Teiler 3
  verschwinden 7 bis 8 % der punktenden Partien des schwachen Spielers auf Null,
  ab Teiler 5 sind es 15 bis 17 %.
- 1.1 % neu gebundene Paare, gegen 2.2 % bei Teiler 3 und 9 % bei Teiler 10.

Teiler 3 bliebe formal innerhalb der Bedingungen (Median 11), kostet aber die
doppelten Bindungen und den Nullzusammenbruch bei schwachen Spielern. Ab
Teiler 4 fällt der Median unter die Grenze.

Was auch Teiler 2 nicht behebt: die Verteilung bleibt quadratisch in der Streak
und damit schief — p90 zu Median ist 5- bis 6-fach, egal welcher Teiler. Ein
Teiler verschiebt die Größenordnung, er macht die Verteilung nicht symmetrisch.

*(Diese Entscheidung ist zurückgenommen — siehe den nächsten Eintrag. Was hier
über die Trennung von Rechnung und Anzeige steht, hat sich dabei bewährt und
gilt weiter: genau weil der Teiler nur in der Anzeige saß, kostete das
Zurücknehmen keine Migration.)*

**Eingeführt, ausschließlich in der Anzeige.** `run.js` rechnet, speichert und
vergleicht weiter ungeteilt; `index.html` teilt erst auf dem Weg in den Text.
Das ist keine Kosmetik an der Umsetzung, sondern die Bedingung, unter der sie
nichts kostet:

- Der gespeicherte Bestwert bleibt ungeteilt mit `scale: 2`. Die Skala hängt
  damit am Wert und nicht an der Darstellung, und ein anderer Teiler später
  migriert keinen einzigen Rekord — keiner hat ihn je gesehen.
- Der Rekordvergleich (`state.score <= best`) läuft auf den ungeteilten Zahlen.
  Sonst könnten zwei Läufe, die das Runden gerade zusammenlegt, sich
  gegenseitig nicht mehr überbieten.
- Die Ergebniszeile des Tagesbretts zeigt denselben geteilten Wert wie die
  Karte. Ein geteiltes Ergebnis und der Bildschirm, von dem es stammt, dürfen
  sich nicht widersprechen.

### Teil 2: Bestwerte mit Skalenkennzeichen

Der Bestwert unter `funkloch.endlos.best` war eine nackte Zahl. Nach der
Umstellung stünde dort ein Wert der alten, flachen Skala, und die Seite hätte
ihn als Rekord angezeigt, als wäre er vergleichbar — einmal, bis ihn die erste
brauchbare Partie überbietet.

Umgesetzt, wie gefordert:

- Ein gespeicherter Bestwert **ohne** Skalenkennzeichen wird beim Laden
  verworfen statt angezeigt.
- Neue Einträge schreiben `{ score, scale: 2 }`. `SCORE_SCALE` steht in
  `index.html` mit einer Liste dessen, was jeder Wert bedeutet hat: kein Feld
  war die flache Summe, 2 ist die nach Etappe gewichtete.
- Angezeigt wird nur, was **exakt** passt. Ein älteres, ein unmarkiertes und
  auch ein *neueres* Kennzeichen — ein Browser, der auf einen alten Stand
  zurückgesetzt wurde — führen alle zum Verwurf.

Verworfen und nicht umgerechnet, und das ist die eigentliche Entscheidung: aus
der Gesamtsumme lässt sich nicht zurückrechnen, aus welchen Etappen sie kam, und
ohne das gibt es keinen Umrechnungsfaktor. Dieselbe Ziffernfolge bedeutet auf
der gewichteten Skala eine deutlich kürzere Partie als auf der flachen. Ein
Bestwert kostet eine Partie, um ihn neu zu setzen; ein still falsch angezeigter
Rekord bleibt falsch, solange er steht.

### Reproduktion

```sh
node tools/score.js --runs=500 --seed=1
node tools/score.js --runs=500 --seed=1001
node tools/score.js --runs=500 --divisors=1,2,3    # nur die engere Auswahl
npm run smoke                                      # prüft den Verwurf mit
```

### Was blieb

- `tools/score.js` — Tabelle 6 (Teiler) mit den beiden Kostenspalten, dazu der
  gierige Bot als Untergrenze der Spielstärke.
- `index.html` — `SCORE_SCALE`, `readBest` verlangt die passende Skala,
  `writeBest` schreibt sie mit.
- `index.html` — `SCORE_DIVISOR = 2` und ein `shown()`, durch das jede Punktzahl
  läuft, bevor sie Text wird: HUD, Endkarte, Bestwert und die Ergebniszeile des
  Tagesbretts. Sonst nichts — Rechnung, Speicher und Vergleich bleiben
  ungeteilt.
- `tools/ui-smoke.js` — die gespeicherte Form ist jetzt `{score, scale}`, und
  drei neue Prüfungen: ein Bestwert ohne Kennzeichen, einer von einer älteren
  und einer von einer fremderen Skala werden alle verworfen statt angezeigt.
  Der Teiler steht dort absichtlich ein zweites Mal: ein Test, der die Konstante
  der Seite importiert, gäbe ihr recht, wie falsch sie auch wäre.
- **Nicht angefasst:** `src/run.js`. Der Teiler ist Anzeige, keine Regel — die
  Messungen oben und alle Werkzeuge rechnen weiter mit der ungeteilten Zahl.

---

## 2026-09-24 — Teiler wieder raus: kleine Zuwächse müssen lesbar sein

**Werkzeug:** keins; das Argument steht am Bildschirm, nicht in der Verteilung.
**Ergebnis: Teiler entfernt.** Angezeigt wird der Rohwert — übrige Sender mal
Etappennummer, aufsummiert. `SCORE_SCALE` steht auf 1, Bestwerte mit `scale: 2`
werden verworfen.

### Der Grund

Die Halbierung macht kleine Zuwächse unlesbar. Ein in Etappe 3 gesparter Sender
bringt 3 Punkte und muss auch als 3 erscheinen, sonst ist der Zusammenhang
zwischen Etappe und Wert nicht erkennbar — und dieser Zusammenhang ist genau
das, wofür die Gewichtung überhaupt eingeführt wurde. Große Zahlen sind das
kleinere Problem.

Der Eintrag davor hat die Verteilung gemessen und die Lesbarkeit der
*Größenordnung* optimiert. Er hat dabei übersehen, dass die Lesbarkeit des
*Zuwachses* die wichtigere ist: eine Punktzahl wird selten mit einer fremden
verglichen, aber bei jedem geräumten Brett wächst sie vor den Augen des
Spielers, und dieser Moment ist es, an dem die Regel erklärt wird oder nicht.

### Was die Halbierung am Zuwachs anrichtet

Nicht nur, dass der Zuwachs halb so groß erscheint — er ist bei ungeraden
Etappennummern **nicht einmal konstant**. Angezeigt wird `round(S/2)`, also
hängt der sichtbare Sprung davon ab, ob die laufende Summe gerade ist:

| laufende Summe S | +1 Sender in Etappe 3 | angezeigt vorher → nachher | sichtbarer Zuwachs |
| --- | --- | --- | --- |
| 10 | 13 | 5 → 7 | **+2** |
| 11 | 14 | 6 → 7 | **+1** |

Derselbe Handgriff auf demselben Brett, zwei verschiedene Belohnungen. In
Etappe 1 ist es am schärfsten: ein gesparter Sender zeigt dort abwechselnd +1
und **+0**, ist also in der Hälfte der Fälle unsichtbar.

Das ist kein Rundungsdetail, sondern der Zusammenbruch der Aussage, die die
Gewichtung machen soll: „ein Sender hier ist so viel wert wie die Etappennummer".

### Was es kostet

Die Zahlen aus dem vorigen Eintrag gelten unverändert und werden bewusst in Kauf
genommen: p99 bei 412 bis 651, Maximum bei 1011, Streuung größer als der
Mittelwert. Der Score bleibt quadratisch in der Streak. Wer zwei Läufe
vergleichen will, vergleicht große Zahlen — wer einen Lauf *versteht*, sieht
jetzt jeden Sender mit seinem Etappenwert eintreffen.

### Was blieb

- `index.html` — `SCORE_DIVISOR` und `shown()` sind weg; HUD, Endkarte,
  Bestwert und die Ergebniszeile des Tagesbretts zeigen `state.score`.
  `SCORE_SCALE = 1`; die Liste am Feld führt jetzt drei Stände: kein Feld war
  die flache Summe, 2 die halbiert angezeigte, 1 die gewichtete wie gezählt.
- Bestwerte mit `scale: 2` werden verworfen. Die Zahl darunter lag ungeteilt im
  Speicher und würde die Rechnung überstehen — aber nicht das Lesen: wer diese
  Fassung mit „best 3" verlassen hat, käme auf „best 6" für denselben Lauf
  zurück. Ein Rekord, der sich von selbst ändert, ist schlechter als einer, der
  neu gespielt werden muss.
- `tools/ui-smoke.js` — Erwartungen wieder auf den Rohwert, gespeicherte Form
  `{score, scale: 1}`, und die Verwurfsprüfung deckt jetzt ohne Kennzeichen,
  `scale: 2` und eine fremde Skala ab.
- **Nicht angefasst:** `src/run.js` und die Werkzeuge. Sie haben nie geteilt —
  deshalb hat dieses Zurücknehmen nichts gekostet außer der Anzeige. Das ist der
  Teil der vorigen Entscheidung, der sich bewährt hat.
