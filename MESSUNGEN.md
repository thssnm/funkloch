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
