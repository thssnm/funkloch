# Messungen

Protokoll der Messungen, mit denen Design-Parameter entschieden wurden — die
Langfassung zu den Tabellen, die als Kommentar an den Konstanten stehen. Ein
Eintrag hält fest, was gefragt war, wie gemessen wurde, was herauskam und was
daraufhin geschah. Auch dann, wenn nichts geschah: eine verworfene Änderung ist
ein Befund, und ohne Protokoll wird sie in einem halben Jahr erneut vorgeschlagen.

**Zur Zählung:** Bis 2026-10-12 zählten die Werkzeuge das *erreichte* Level —
das, in dem eine Partie endete. Seitdem zählen sie, wie das Spiel, das letzte
*geschaffte*. Jede Tabelle, die davon betroffen ist, trägt den Vermerk direkt
darunter, siehe den letzten Eintrag.

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
2. **Beide Bots mit den ausgelieferten Sendern.** 300 Partien je Bot und Stufe,
   gleiche Seeds für beide Bots.
3. **Beide Bots mit nach Ballgröße angeglichener Senderzahl**, so dass jede
   Dichte etwa gleich viele Sender pro Knoten kostet.

Tabelle 2 beantwortet die Frage wie gestellt. Tabelle 3 sagt, ob die Antwort von
der Form kommt oder nur von der Schwierigkeit.

Gemessen wurde gegen `lookaheadChoice`, nicht nur gegen `greedyChoice`.

### 1. Brettform

300 Bretter je Zeile. „In Ketten" zählt Grad-2-Knoten, deren Nachbarn *ebenfalls*
Grad 2 haben — die sitzen in einer Kette und nicht bloß neben einer Verzweigung.
„Ball" ist die mittlere Ballgröße unter der Sendermischung des Modus, also wie
viele Knoten ein Sender kauft.

| Löschanteil | Kanten/Brett | Ø-Grad | Grad 2 | in Ketten | Ball | Senderfaktor |
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

### 2. Mit den ausgelieferten Sendern

300 Partien je Bot und Zeile, gleiche Seeds.

| Löschanteil | gierig Median | p90 | Mittel | SD | voraus Median | p90 | Mittel | SD | Abstand | Verhältnis | am Deckel |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0.00 | 7.5 | 20.0 | 11.14 | 8.05 | 105.0 | 200.0 | 110.68 | 72.82 | +97.5 | 9.94x | 26 % |
| 0.05 | 7.0 | 16.0 | 9.09 | 5.58 | 52.0 | 193.1 | 72.45 | 63.82 | +45.0 | 7.97x | 9 % |
| 0.10 | 7.0 | 12.0 | 7.14 | 3.54 | 28.0 | 81.2 | 39.03 | 34.53 | +21.0 | 5.46x | 1 % |
| 0.15 | 6.0 | 9.1 | 6.29 | 2.74 | 14.5 | 40.1 | 19.54 | 14.16 | +8.5 | 3.11x | 0 % |
| **0.20** | 5.0 | 7.0 | 5.16 | 2.08 | 9.0 | 21.0 | 11.45 | 7.14 | +4.0 | **2.22x** | 0 % |
| 0.30 | 3.0 | 6.0 | 3.72 | 1.50 | 6.0 | 8.0 | 6.22 | 1.82 | +3.0 | 1.67x | 0 % |

*Gezählt: erreichtes Level (= geschaffte + 1), wie die Werkzeuge bis
2026-10-12 zählten. Heute zählen sie geschaffte Level: Mediane, Mittel und
Quantile liegen dann genau 1 tiefer, SD und Abstand bleiben — aber die
Verhältnisse verschieben sich ungleichmäßig, weil 1 von beiden Mitteln abgeht
und nicht von ihrem Quotienten. Beispiel aus `blockedRatio`: 5.23 / 11.73 =
2.24x erreicht sind 4.23 / 10.73 = 2.54x geschafft. Eine wiederholte Messung
liefert also andere Zahlen, ohne dass sich am Spiel etwas geändert hat.*

Das sieht spektakulär aus und ist eine Falle. Der Abstand explodiert, weil das
Brett billiger zu decken wird und der Planer schlicht aufhört zu sterben. Die
Spalte „am Deckel" sagt es: bei 0.00 stehen 26 % seiner Partien auf dem
200-Level-Deckel, die Zeile ist eine Untergrenze und keine Messung.

### 3. Mit nach Ballgröße angeglichener Senderzahl

Senderkurve mit dem Senderfaktor aus Tabelle 1 skaliert (`start` und `floor`),
so dass jede Dichte gleich viele Sender pro Knoten kostet. Keine Zeile steht
mehr am Deckel.

| Löschanteil | gierig Median | Mittel | voraus Median | Mittel | SD | Abstand | Verhältnis |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.00 | 5.0 | 4.89 | 10.0 | 10.23 | 3.75 | +5.0 | 2.09x |
| 0.05 | 5.0 | 5.06 | 9.0 | 10.18 | 6.91 | +4.0 | 2.01x |
| 0.10 | 5.0 | 5.09 | 9.0 | 9.99 | 4.86 | +4.0 | 1.96x |
| 0.15 | 5.0 | 5.07 | 9.0 | 12.98 | 8.61 | +4.0 | 2.56x |
| **0.20** | 5.0 | 5.16 | 9.0 | 11.45 | 7.14 | +4.0 | **2.22x** |
| 0.30 | 6.0 | 6.06 | 10.0 | 11.10 | 5.15 | +4.0 | 1.83x |

*Gezählt: erreichtes Level (= geschaffte + 1), Stand vor 2026-10-12. Geschafft
gezählt liegen Mediane und Mittel genau 1 tiefer, SD und Abstand bleiben, die
Verhältnisse steigen ungleichmäßig — 5.23 / 11.73 = 2.24x erreicht sind
4.23 / 10.73 = 2.54x geschafft. Eine Wiederholung liefert andere Zahlen, ohne
dass sich am Spiel etwas geändert hat.*

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

*Verhältnisse erreichter Level (= geschaffte + 1), Stand vor 2026-10-12. Auf
geschaffte Level umgezählt verschieben sie sich ungleichmäßig nach oben — wie
2.24x erreicht zu 2.54x geschafft wird (5.23 / 11.73 gegen 4.23 / 10.73). Eine
Wiederholung liefert andere Zahlen, ohne dass sich am Spiel etwas geändert hat;
verglichen werden darf nur innerhalb derselben Zählung.*

### Befund

**Der Abstand wächst nicht mit der Dichte.** Der Medianabstand ist über alle
Dichten und alle drei Seeds hinweg konstant +4 Level. Die dichteren Bretter
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

Verdacht: die Senderzahl ist `Math.max(1, Math.round(nodeCount * ratio))`, und
der Angleichfaktor 0.944 schiebt sie auf einzelnen Leveln um genau einen Sender.
Das wäre ein Artefakt der Angleichung und keine Eigenschaft von 0.15.

Das verdient eine eigene Messung — sinnvoll wäre, die Senderzahl direkt statt
über die Kurve zu setzen und über ganze Sender zu sweepen. Als Argument für eine
Umstellung des Standards taugt es nicht.

### Reproduktion

```sh
node tools/density.js --runs=300 --boards=300 --seed=1
node tools/density.js --ratios=0,0.1,0.2 --runs=100   # schnellere Stichprobe
```

Tabelle 2 ist bei kleinen Löschanteilen teuer, weil der Planer dort hunderte
Level überlebt: die 0.00-Zeile allein braucht rund neun Minuten bei 300
Partien. Tabelle 1 und 3 laufen in Sekunden.

### Was blieb

- `src/run.js` — `EDGE_DELETE_RATIO` trägt die Messung im Kommentar; Wert
  unverändert 0.2. `edgeDeleteRatio` ist jetzt über die Config überschreibbar,
  damit ein Sweep ihn setzen kann; die Vorgabe ist dieselbe wie vorher, die
  Level-Sets bleiben byte-identisch.
- `tools/endless.js` — `LEVEL_CAP` (damals `STAGE_CAP`) exportiert, damit ein
  Sweep ausweisen kann, wie viel seiner Tabelle auf dem Deckel steht.
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
- **C — Mittelwert des gierigen Bots**, gehalten über die Senderzahl bei
  unveränderter 4/4/2 (Tabelle 5). Nötig, weil B die Mischung platt walzt und
  *welchen* Sender man wofür aufhebt selbst ein Teil des Vorausdenkens ist.

Dazu ein Maßstab (Tabelle 6): dasselbe Brett ohne Verstärker, nur mit mehr
Sendern. Er sagt, wieviel Verhältnis bloße Leichtigkeit kauft — was jede Zeile
der anderen Tabellen erst schlagen muss.

### 0. Ohne jede Angleichung

500 Partien je Bot, gleiche Seeds, ausgelieferte Mischung 4/4/2:

| Verstärkerdichte | gierig Mittel | voraus Mittel | Verhältnis |
| --- | --- | --- | --- |
| 0.00 | 5.36 | 11.60 | 2.16x |
| 0.15 | 16.75 | 132.28 | 7.90x |

*Gezählt: erreichtes Level (= geschaffte + 1), Stand vor 2026-10-12. Geschafft
gezählt liegen die Mittel genau 1 tiefer, die Verhältnisse steigen
ungleichmäßig — 5.23 / 11.73 = 2.24x erreicht sind 4.23 / 10.73 = 2.54x
geschafft. Eine Wiederholung liefert andere Zahlen, ohne dass sich am Spiel
etwas geändert hat.*

Das ist die Falle aus der Messung oben und keine Antwort: bei einem Mittel von
132 gegen einen 200-Level-Deckel hat der Planer aufgehört zu sterben, die
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

*Gezählt: erreichtes Level (= geschaffte + 1), Stand vor 2026-10-12. Geschafft
gezählt liegen Mediane und Mittel genau 1 tiefer, SD und Zuganteil bleiben, die
Verhältnisse steigen ungleichmäßig — 5.23 / 11.73 = 2.24x erreicht sind
4.23 / 10.73 = 2.54x geschafft. Eine Wiederholung liefert andere Zahlen, ohne
dass sich am Spiel etwas geändert hat.*

**Der Anker hält nicht.** Die Ballgröße steht auf 6.96, aber der gierige Bot
klettert von 5.36 auf 8.28 erreichte Level: der Modus ist am oberen Ende gut die
Hälfte leichter geworden. Die Spalte „genutzter Ball" sagt warum — kein Bot setzt
auf einen durchschnittlichen Knoten. Was er tatsächlich kauft, steigt von 7.7/8.5
auf 8.8/9.5, obwohl das Brettmittel stillsteht.

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
Dichte: das Brett füllt sich im Lauf eines Levels).

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

Die Mischung wird gekippt, bis der gierige Bot wieder bei 5.23 erreichten
Leveln steht. 500 Partien je Bot, 300 je Bisektionsschritt.

| Dichte | Tilt t | Mischung | Ballgröße | gierig Mittel | voraus Mittel | Verhältnis | Züge abweichend |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 0.00 | 0.000 | 40/40/20 | 6.96 | 5.36 | 11.60 | 2.16x | 25.2 % |
| 0.03 | 0.330 | 51/36/13 | 6.40 | 5.50 | 9.29 | 1.69x | 22.0 % |
| 0.06 | 0.381 | 52/36/12 | 6.42 | 5.94 | 10.15 | 1.71x | 21.4 % |
| 0.09 | 0.381 | 52/36/12 | 6.53 | 6.47 | 11.69 | 1.81x | 21.6 % |
| 0.12 | 0.600 | 59/32/9 | 6.26 | 5.65 | 13.45 | 2.38x | 22.3 % |
| 0.15 | 0.600 | 59/32/9 | 6.39 | 6.47 | 17.49 | 2.70x | 22.8 % |

*Gezählt: erreichtes Level (= geschaffte + 1), Stand vor 2026-10-12 — auch das
Ziel 5.23, auf das gepinnt wurde. Geschafft gezählt liegen die Mittel genau 1
tiefer, die Verhältnisse steigen ungleichmäßig — 5.23 / 11.73 = 2.24x erreicht
sind 4.23 / 10.73 = 2.54x geschafft. Eine Wiederholung mit dem heutigen
Werkzeug pinnt auf ein anderes Ziel und liefert andere Zahlen, ohne dass sich
am Spiel etwas geändert hat.*

Der Pin ist grob: ein Level teilt vier bis neun Sender aus, und keine Mischung
verschiebt das in weniger als ganzen Sendern. Die Zeilen landen bei 5.5 bis 6.5
statt bei 5.23, also eher zu leicht.

Auffällig ist, wonach sich das Verhältnis hier richtet — nicht nach der Dichte,
sondern nach der **Mischung**: 40/40/20 gibt 2.16x, 52/36/12 gibt 1.69–1.81x,
59/32/9 gibt 2.38–2.70x. Zwei Zeilen stehen bei exakt derselben Schwierigkeit
(gierig 6.47) und geben 1.81x gegen 2.70x — sie unterscheiden sich in der
Mischung. Der zweite Seed reproduziert die 0.15-Zeile auf 1 % genau (6.52 /
17.78 / 2.73x).

Anker B beantwortet die Frage also bei ehrlicher Schwierigkeit, aber mit einem
Störfaktor, den er selbst einführt. Dafür ist Tabelle 5 da.

### 5. Gegenprobe über die Senderzahl (Anker C)

Mischung bleibt die ausgelieferte 4/4/2, stattdessen wird die Senderzahl
skaliert, bis der gierige Bot wieder auf seinem Bezugswert steht. Damit ist der
Verstärker das einzige, was sich zwischen den Zeilen ändert. Seed 1, 500 Partien
je Bot:

| Dichte | Senderfaktor | Ballgröße | genutzter Ball g/v | gierig Mittel | voraus Mittel | voraus SD | Verhältnis | Züge abweichend |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 0.00 | 1.000 | 6.96 | 7.7 / 8.5 | 5.36 | 11.60 | 6.25 | 2.16x | 25.2 % |
| 0.03 | 0.953 | 7.10 | 8.1 / 9.4 | 5.77 | 15.88 | 16.70 | 2.75x | 24.1 % |
| 0.06 | 0.911 | 7.22 | 8.4 / 9.3 | 5.32 | 11.23 | 6.84 | 2.11x | 23.7 % |
| 0.09 | 0.846 | 7.33 | 8.8 / 9.5 | 4.81 | 9.40 | 5.61 | 1.95x | 22.4 % |
| 0.12 | 0.846 | 7.46 | 9.1 / 10.1 | 5.16 | 11.59 | 10.13 | 2.25x | 23.2 % |
| 0.15 | 0.823 | 7.60 | 9.3 / 10.0 | 5.09 | 9.68 | 4.38 | 1.90x | 22.1 % |

*Gezählt: erreichtes Level (= geschaffte + 1), Stand vor 2026-10-12. Geschafft
gezählt liegen die Mittel genau 1 tiefer, SD und Zuganteil bleiben, die
Verhältnisse steigen ungleichmäßig — 5.23 / 11.73 = 2.24x erreicht sind
4.23 / 10.73 = 2.54x geschafft. Eine Wiederholung liefert andere Zahlen, ohne
dass sich am Spiel etwas geändert hat.*

Hier hält der Pin: der gierige Bot bleibt zwischen 4.81 und 5.77 erreichten
Leveln. Vier Seeds, Verhältnis und Zuganteil nebeneinander (Seed 1001 mit 250
Partien je Bot, die übrigen mit 500):

| Dichte | Seed 1 | Seed 1001 | Seed 2001 | Seed 3001 | **Mittel** | Züge abweichend (Mittel) |
| --- | --- | --- | --- | --- | --- | --- |
| 0.00 | 2.16x | 2.29x | 2.24x | 2.10x | **2.20** | 25.0 % |
| 0.03 | 2.75x | 2.01x | 2.47x | 2.39x | **2.41** | 24.4 % |
| 0.06 | 2.11x | 1.88x | 1.92x | 2.04x | **1.99** | 22.8 % |
| 0.09 | 1.95x | 1.97x | 2.20x | 1.93x | **2.01** | 22.4 % |
| 0.12 | 2.25x | 1.82x | 2.43x | 2.38x | **2.22** | 23.3 % |
| 0.15 | 1.90x | 1.79x | 1.92x | 1.88x | **1.87** | 22.2 % |

*Verhältnisse erreichter Level (= geschaffte + 1), Stand vor 2026-10-12. Auf
geschaffte Level umgezählt verschieben sie sich ungleichmäßig nach oben — wie
2.24x erreicht zu 2.54x geschafft wird (5.23 / 11.73 gegen 4.23 / 10.73). Der
Zuganteil bleibt. Eine Wiederholung liefert andere Verhältnisse, ohne dass sich
am Spiel etwas geändert hat.*

Das Verhältnis wächst nicht. Es steht bei 2.20 ohne Verstärker und bei 1.87 bei
der höchsten Dichte, und keine Zeile liegt belastbar über der Bezugszeile. Der
Medianabstand fällt von +4 auf +3 bis +4 Level.

Die beiden Zeilen, die aus der Reihe fallen (0.03 und 0.12), tragen in jedem
Seed dieselbe Signatur: eine SD von 10 bis 17 gegen 4 bis 7 in den übrigen, also
ein schwerer Schwanz aus wenigen sehr langen Partien. Das ist der bereits
protokollierte Rundungseffekt — `Math.round(nodeCount · ratio)` schiebt die
Senderzahl auf einzelnen Leveln um einen ganzen Sender — und kein Dichtetrend:
die Nachbarn links und rechts liegen beide niedriger.

Der Zuganteil ist die stabilste Zahl der ganzen Messung und fällt monoton von
25.0 % auf 22.2 %: **mit Verstärkern sind sich die beiden Bots einiger als
ohne.**

### 6. Maßstab: nur leichter, ohne Verstärker

Dasselbe Brett ohne Verstärker, mehr Sender, bis der gierige Bot die
angegebene Schwierigkeit erreicht. 500 Partien je Bot.

| Zielschwierigkeit | Senderfaktor | gierig Mittel | voraus Mittel | Verhältnis | Züge abweichend |
| --- | --- | --- | --- | --- | --- |
| 5.50 | 1.034 | 5.36 | 12.49 | 2.33x | 25.4 % |
| 5.90 | 1.042 | 5.93 | 13.27 | 2.24x | 25.3 % |
| 6.50 | 1.049 | 6.48 | 14.91 | 2.30x | 25.6 % |

*Gezählt: erreichtes Level (= geschaffte + 1), Stand vor 2026-10-12, auch die
Zielschwierigkeit. Geschafft gezählt liegen Ziele und Mittel genau 1 tiefer, die
Verhältnisse steigen ungleichmäßig — 5.23 / 11.73 = 2.24x erreicht sind
4.23 / 10.73 = 2.54x geschafft. Eine Wiederholung liefert andere Zahlen, ohne
dass sich am Spiel etwas geändert hat.*

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
hunderte Level überlebt.

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

## 2026-09-24 — Punkte mal Level: ändert die Gewichtung das optimale Spiel?

**Regel:** Übrige Sender zählen mit der Levelnummer gewichtet. Score ist die
Summe über alle geräumten Level von `Rest × Levelnummer` statt der reinen
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
so ausfallen musste: innerhalb von Level *s* ist jeder übrige Sender *s* wert —
derselbe positive Faktor für jede Entscheidung auf diesem Brett. Ein konstanter
Faktor ordnet keine Linien um. Und über Levelgrenzen hinweg lässt sich nichts
verschieben: `advance` teilt frische Sender aus, übrige Sender wandern nicht
mit. Es gibt also keinen Zug, der einen Sender aus Level 3 nach Level 12 trägt,
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

Beide Scores werden aus `state.cleared` gelesen, das ohnehin `{level, left}` je
geräumtem Level führt (damals `{stage, left}`) — damit ist die neue Zählung
messbar, bevor `run.js` sie trägt, und die alte danach.

### 1. Beide Ziele über dieselben Seeds

500 Partien je Bot und Seed.

| Seed | Bot | Level Median / Mittel / SD | Punkte Median | p90 | p99 | max | Mittel | Rest je geräumtem Level |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | Überleben | 9.0 / 11.73 / 7.18 | 32.5 | 188.3 | 595.3 | 887 | 75.2 | 0.90 |
| 1 | Punkte | 9.0 / 11.73 / 7.18 | 39.0 | 206.5 | 650.7 | 1011 | 87.3 | 1.09 |
| 1001 | Überleben | 9.0 / 11.44 / 6.34 | 32.0 | 156.1 | 412.1 | 699 | 65.1 | 0.87 |
| 1001 | Punkte | 9.0 / 11.44 / 6.34 | 39.5 | 173.2 | 460.4 | 817 | 75.7 | 1.06 |

*Die Levelspalte zählt das erreichte Level (= geschaffte + 1), Stand vor
2026-10-12; geschafft gezählt liegen Median und Mittel genau 1 tiefer, die SD
bleibt. Punkte und Rest hängen nicht an der Zählung. Wo Verhältnisse zweier
Bots gebildet werden, verschieben sie sich ungleichmäßig — 5.23 / 11.73 = 2.24x
erreicht sind 4.23 / 10.73 = 2.54x geschafft. Eine Wiederholung liefert andere
Zahlen, ohne dass sich am Spiel etwas geändert hat.*

Die Levelspalten sind nicht ähnlich, sie sind **identisch** — Median, Mittel
und Streuung auf jede Stelle. Paarweise nachgesehen, Seed für Seed:

| Vergleich | Punkte-Bot kommt weniger weit | kommt weiter | hat weniger Punkte | mittlerer Levelunterschied |
| --- | --- | --- | --- | --- |
| 1000 Seeds | **0 %** | 0 % | 0 % | **0.000** |

In keiner einzigen von 1000 Partien endet der Punkte-Bot früher oder später als
der überlebende. Er spielt nicht riskanter, er kommt nicht weniger weit, und er
hat nie weniger Punkte.

### 2. Dieselben Partien, aber nicht dieselben Züge

| Seed | Züge | davon abweichend | Partien ohne jede Abweichung | erste Abweichung in Level |
| --- | --- | --- | --- | --- |
| 1 | 36 115 | 2.92 % | 11.6 % | 2.7 |
| 1001 | 35 078 | 2.82 % | 11.2 % | 2.8 |

Die beiden sind nicht derselbe Spieler: auf knapp 3 % der Züge wollen sie
Verschiedenes, und nur jede neunte Partie vergeht ohne eine einzige Abweichung.
Sie landen nur immer am selben Ende.

Der Grund ist die Bauart des Modus: jedes Brett und jede Senderhand hängt allein
an `(seed, level)`. Was innerhalb eines Levels anders gespielt wird, kann das
nächste nicht erreichen. Ein Unterschied kann sich also nur auswirken, wenn er
kostet, dass ein Level überhaupt geräumt wird — und Sparsamkeit kostet das
nie, weil sie unter den räumenden Linien wählt. Geräumt ist geräumt.

### 3. Wo die Sender liegen bleiben

Rest je geräumtem Level, nach Levelblock. Die Frage war, ob der Punkte-Bot
seine Sender dort spart, wo sie am meisten wert sind, also spät.

| Seed | Bot | Level 1-3 | 4-6 | 7-10 | ab 11 |
| --- | --- | --- | --- | --- | --- |
| 1 | Überleben | 0.99 | 0.87 | 0.88 | 0.84 |
| 1 | Punkte | 1.32 | 1.06 | 1.01 | 0.95 |
| 1001 | Überleben | 0.94 | 0.87 | 0.88 | 0.77 |
| 1001 | Punkte | 1.27 | 1.05 | 1.00 | 0.87 |

**Nein, umgekehrt.** Der Punkte-Bot spart am meisten in den frühen Leveln
(+0.33 Sender je Brett) und am wenigsten in den späten (+0.10). Das ist keine
Eigenheit des Bots, sondern der Senderkurve: der Senderanteil startet bei 0.24
und fällt gegen 0.15, also ist auf den frühen Brettern Luft und auf den späten
keine. Die Gewichtung belohnt damit ausgerechnet die Sender am höchsten, die am
schwersten zu sparen sind — was den Score in den späten Leveln weniger
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

Der Grund ist die Form der Summe. Bei ungefähr konstantem Rest *r* je Level ist
der neue Score

```
r · (1 + 2 + … + n) = r · n(n+1)/2
```

also **quadratisch in der Streak**, wo der alte linear war. Gerechnet: r = 1.09,
n = 11.73 ergibt 81 — gemessen wurden 87. Doppelt so weit zu kommen vervierfacht
damit die Punkte, und der lange Schwanz der Streak-Verteilung (SD 7.18 bei Mittel
11.73) wird beim Quadrieren zu einem sehr langen Schwanz der Punkteverteilung.

*n = 11.73 ist hier das mittlere erreichte Level (= geschaffte + 1), Stand vor
2026-10-12; summiert werden eigentlich nur die geschafften Level. Die Rechnung
ist als Größenordnung gemeint und nicht nachgerechnet; die gemessenen Punkte
hängen nicht an der Zählung.*

Das ist ehrlich zu benennen, weil es die Begründung berührt: die Gewichtung
während der Partie **entfernt das quadratische Wachstum nicht, sie halbiert es.**
Am Ende zu multiplizieren gäbe `n · r · n = r · n²`, die Gewichtung während der
Partie gibt `r · n²/2` — dieselbe Ordnung, der halbe Betrag. Was die Gewichtung
tatsächlich repariert, ist zweierlei, und beides bleibt richtig:

- **Keine Annullierung.** `Level × Punkte` macht aus null Punkten null, egal wie
  weit jemand kam. Bei der Gewichtung während der Partie kostet ein Level ohne
  Rest nur seinen eigenen Beitrag.
- **Keine rückwirkende Aufwertung.** Am Ende zu multiplizieren würde einen in
  Level 1 gesparten Sender mit dem zuletzt erreichten Level bezahlen. Jetzt
  zählt jedes Level mit dem, was es war, als es gespielt wurde.

### Befund

**Die Umstellung ändert das optimale Spiel nicht.** Über 1000 Partien erreicht
ein Bot, der auf den neuen Score optimiert, exakt dasselbe Level wie einer, der
aufs Überleben optimiert — in jedem einzelnen Seed. Er tut es mit anderen Zügen
(2.9 % Abweichung) und mit mehr Punkten (+16 % im Mittel, +20 % im Median), aber
ohne jedes Risiko: Sparsamkeit
wählt unter den Linien, die das Brett ohnehin räumen, und ein Unterschied
innerhalb eines Levels kann das nächste nicht erreichen, weil das aus
`(seed, level)` gezogen wird.

Der Unterschied zwischen „auf Überleben spielen" und „auf Punkte spielen" ist
damit real, aber er ist nicht neu: er bestand unter der alten Zählung genauso,
nur weniger deutlich sichtbar. Die Gewichtung vergrößert ihn nicht, sie
vergrößert nur die Zahl, die er erzeugt.

Offen bleibt die Lesbarkeit. Ein p99 von 600 und ein Maximum von 1011 sind keine
Zahl mehr, die man im Kopf vergleicht, und der quadratische Zusammenhang macht
Bestwerte zwischen zwei Spielern schwerer einzuordnen als das Level selbst.
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

- `src/run.js` — `build()` addiert `senders.length * base.level` statt
  `senders.length` (damals `depot.length * base.stage`); die Begründung steht am
  Ort der Rechnung, samt dem Nachweis, dass die Gewichtung keine Zugfolge ändern
  kann.
- `test/run.test.js` — zwei neue Prüfungen: Level 2 trägt seine Reste doppelt
  bei, und der Endstand ist über mehrere Seeds die Summe `Rest × Level` aus dem
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
  war die flache Summe, 2 ist die nach Level gewichtete.
- Angezeigt wird nur, was **exakt** passt. Ein älteres, ein unmarkiertes und
  auch ein *neueres* Kennzeichen — ein Browser, der auf einen alten Stand
  zurückgesetzt wurde — führen alle zum Verwurf.

Verworfen und nicht umgerechnet, und das ist die eigentliche Entscheidung: aus
der Gesamtsumme lässt sich nicht zurückrechnen, aus welchen Leveln sie kam, und
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
Levelnummer, aufsummiert. `SCORE_SCALE` steht auf 1, Bestwerte mit `scale: 2`
werden verworfen.

### Der Grund

Die Halbierung macht kleine Zuwächse unlesbar. Ein in Level 3 gesparter Sender
bringt 3 Punkte und muss auch als 3 erscheinen, sonst ist der Zusammenhang
zwischen Level und Wert nicht erkennbar — und dieser Zusammenhang ist genau
das, wofür die Gewichtung überhaupt eingeführt wurde. Große Zahlen sind das
kleinere Problem.

Der Eintrag davor hat die Verteilung gemessen und die Lesbarkeit der
*Größenordnung* optimiert. Er hat dabei übersehen, dass die Lesbarkeit des
*Zuwachses* die wichtigere ist: eine Punktzahl wird selten mit einer fremden
verglichen, aber bei jedem geräumten Brett wächst sie vor den Augen des
Spielers, und dieser Moment ist es, an dem die Regel erklärt wird oder nicht.

### Was die Halbierung am Zuwachs anrichtet

Nicht nur, dass der Zuwachs halb so groß erscheint — er ist bei ungeraden
Levelnummern **nicht einmal konstant**. Angezeigt wird `round(S/2)`, also
hängt der sichtbare Sprung davon ab, ob die laufende Summe gerade ist:

| laufende Summe S | +1 Sender in Level 3 | angezeigt vorher → nachher | sichtbarer Zuwachs |
| --- | --- | --- | --- |
| 10 | 13 | 5 → 7 | **+2** |
| 11 | 14 | 6 → 7 | **+1** |

Derselbe Handgriff auf demselben Brett, zwei verschiedene Belohnungen. In
Level 1 ist es am schärfsten: ein gesparter Sender zeigt dort abwechselnd +1
und **+0**, ist also in der Hälfte der Fälle unsichtbar.

Das ist kein Rundungsdetail, sondern der Zusammenbruch der Aussage, die die
Gewichtung machen soll: „ein Sender hier ist so viel wert wie die Levelnummer".

### Was es kostet

Die Zahlen aus dem vorigen Eintrag gelten unverändert und werden bewusst in Kauf
genommen: p99 bei 412 bis 651, Maximum bei 1011, Streuung größer als der
Mittelwert. Der Score bleibt quadratisch in der Streak. Wer zwei Läufe
vergleichen will, vergleicht große Zahlen — wer einen Lauf *versteht*, sieht
jetzt jeden Sender mit seinem Levelwert eintreffen.

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

---

## 2026-10-12 — Level statt Etappe, gezählt wird das geschaffte

**Werkzeug:** keins; eine Umbenennung und eine Zählweise, kein Parameter.
**Ergebnis:** Die Werkzeuge zählen jetzt wie das Spiel. **Keine Tabelle in
dieser Datei wurde neu gerechnet** — betroffene tragen stattdessen einen Vermerk
direkt darunter.

### Was sich geändert hat

- **Etappe heißt Level, Depot heißt Sender** — auf der Seite, im Code
  (`state.level`, `levelSpec`, `senderRatio`, `senderCurve`, `fillSenders`,
  `LEVEL_CAP`, Status `levelCleared`) und hier. Im Rätselmodus (`game.js`,
  `levels/*.json`) war „level" schon belegt: dort ist es ein gespeichertes
  Rätsel, im Lauf eine Zahl. `render.js` sagt deshalb `board`. Die Level-Dateien
  sind nach `npm run levels` byte-identisch.
- **Gezählt wird das letzte geschaffte Level.** Wer in Level 10 scheitert, hat 9
  geschafft. Das gilt für die Endkarte und die Ergebniszeile des Tagesbretts;
  die laufende Anzeige zeigt weiter das Level, das gerade gespielt wird. Einen
  gespeicherten Level-Bestwert gibt es nicht — der Bestwert ist seit der
  Punktegewichtung nur `{score, scale}` —, also musste nichts verworfen werden.
- **Die Werkzeuge zählen mit.** `playEndless` in `tools/endless.js` gibt als
  `streak` jetzt `state.cleared.length` zurück statt `state.stage`; ebenso
  `tools/score.js` und `tools/amplifier.js`. `tools/bot.js` war schon richtig:
  seine Tabellen nennen Siegquoten und das Level, *in dem* verloren wurde, und
  beides hängt nicht an der Zählung.

### Was das für die Tabellen heißt

Mittelwerte, Mediane und Quantile fallen um genau 1, die SD und alle Abstände
bleiben. **Die Verhältnisse zwischen den Bots verschieben sich aber
ungleichmäßig**, weil die 1 von beiden Mitteln abgeht und nicht vom Quotienten:
`blockedRatio` 0.05 misst 5.23 / 11.73 = **2.24x** erreicht und
4.23 / 10.73 = **2.54x** geschafft — dieselben Partien. Je kleiner der gierige
Mittelwert, desto stärker der Sprung.

Eine wiederholte Messung liefert also andere Zahlen, ohne dass sich am Spiel
etwas geändert hat. Verglichen werden darf nur innerhalb derselben Zählung.
Wer eine alte Tabelle neu misst, setzt die neue darunter und lässt die alte mit
ihrem Vermerk stehen.

Nicht betroffen und ohne Vermerk: Ballgrößen, Siegquoten, Zuganteile, Punkte,
Teiler, und Tabellen, deren Levelspalte eine Levelnummer ist (Levelblöcke,
„erste Abweichung in Level").

---

## 2026-10-12 — Level 1 als Einstiegsbrett

**Konstante:** `ENDLESS_RUN.firstLevel` in `src/run.js` (neu)
**Werkzeug:** `tools/onboarding.js` (neu), `tools/endless.js --daily` (neu)
**Ergebnis: 9 Knoten, 6 Sender, ersetzt das bisherige Level 1.** Die Kurve ab
Level 2 bleibt unverändert, Bit für Bit.

Alle Zahlen dieses Eintrags zählen **geschaffte** Level.

### Die Frage

Das Spiel erklärt sich nicht: beim ersten Start ein Graph, drei Kacheln, zwei
Zahlen, und nichts sagt, dass Antippen etwas tut oder dass der Vorrat endlich
ist. Der Hilfetext unter dem Brett wird nicht gelesen. Statt eines Tutorials
soll Level 1 die Regel vermitteln, indem man es gewinnt — und dafür darf es
praktisch nicht zu verlieren sein.

Die Latte ist der gierige Bot: ein Mensch beim ersten Kontakt spielt schlechter
als gierig. Scheitert gierig auf dem Einstiegsbrett überhaupt, ist es zu eng.
Ziel: Scheiterquote null. Danach darf sich der Rest nicht verschieben — der
Planer soll weiter bei einem geschafften Median um 8 landen, der Bot-Abstand
bei rund +4 bleiben, und das Tagesbrett darf nicht auseinanderlaufen.

### Ausgangslage

`tools/endless.js --runs=1000` und `--runs=365 --daily`, die Kurve vor der
Änderung (Level 1: 18 Knoten, 4 Sender):

| Seeds | gierig Median / Mittel | voraus Median / Mittel / SD | Abstand | Verhältnis | gierig endet in Level 1 |
| --- | --- | --- | --- | --- | --- |
| 1–1000 | 4 / 4.15 | 8 / 10.68 / 7.06 | +4 | 2.57x | 3.1 % |
| 1001–2000 | 4 / 4.25 | 8 / 10.70 / 6.65 | +4 | 2.52x | 3.5 % |
| 365 Tagesbretter ab 2026-01-01 | 4 / 4.09 | 9 / 10.76 / 6.55 | +5 | 2.63x | 2.2 % |

Heute verliert also gut jede dreißigste gierige Partie schon auf dem ersten
Brett. Die Tagesbretter liegen im Median eins höher und im Abstand bei +5, im
Mittel aber gleichauf (10.76 gegen 10.68) — der Median sitzt dort auf einer
Stufe, das ist kein Auseinanderlaufen.

### 1. Das Einstiegsbrett allein

Level 1 allein gespielt, dieselben Seeds für alle Bots. „Zufällig" tippt einen
beliebigen freien Knoten an (eigener `mulberry32`-Strom) — kein Maßstab, aber
ein Stellvertreter für jemanden, der noch nicht hinsieht, und damit ein Maß für
den Spielraum. „Nötig" ist, wie viele Sender gierig verbraucht hat.

Erste Runde, 1000 Seeds:

| Knoten | Sender | gierig scheitert | voraus scheitert | zufällig scheitert | gierig nötig Mittel / max |
| --- | --- | --- | --- | --- | --- |
| 8 | 2 | 8.0 % | 0.0 % | 69.1 % | 1.79 / 2 |
| 8 | 3 | 0.0 % | 0.0 % | 8.8 % | 1.63 / 3 |
| 9 | 2 | 34.3 % | 27.0 % | 85.4 % | 1.79 / 2 |
| 9 | 3 | 0.0 % | 0.0 % | 21.9 % | 1.82 / 3 |
| 10 | 2 | 41.3 % | 22.1 % | 92.1 % | 1.88 / 2 |
| 10 | 3 | 0.2 % | 0.0 % | 41.6 % | 1.98 / 3 |

Ab 4 Sendern scheitert gierig auf keiner Größe. Weil null bei 1000 Seeds nur
„unter etwa 0.3 %" heißt, die engere Auswahl mit 5000:

| Knoten | Sender | gierig scheitert | voraus scheitert | zufällig scheitert | gierig nötig Mittel / max | gierig übrig Mittel |
| --- | --- | --- | --- | --- | --- | --- |
| 8 | 4 | 0.0 % | 0.0 % | 2.0 % | 1.63 / 3 | 2.37 |
| 8 | 5 | 0.0 % | 0.0 % | 0.5 % | 1.78 / 4 | 3.22 |
| 8 | 6 | 0.0 % | 0.0 % | 0.0 % | 1.72 / 4 | 4.28 |
| 9 | 4 | 0.0 % | 0.0 % | 7.1 % | 1.84 / 3 | 2.16 |
| 9 | 5 | 0.0 % | 0.0 % | 2.7 % | 2.01 / 4 | 2.99 |
| **9** | **6** | **0.0 %** | **0.0 %** | **0.3 %** | **1.98 / 4** | **4.02** |
| 10 | 4 | 0.0 % | 0.0 % | 17.9 % | 1.99 / 4 | 2.01 |
| 10 | 5 | 0.0 % | 0.0 % | 9.6 % | 2.15 / 4 | 2.85 |
| 10 | 6 | 0.0 % | 0.0 % | 2.7 % | 2.14 / 4 | 3.86 |

**9 Knoten, 6 Sender.** Gierig scheitert in 5000 Seeds nie, braucht im Mittel
2 Sender und höchstens 4 — behält also auch auf seinem schlechtesten Brett zwei
übrig. Selbst blindes Antippen verliert nur in 0.3 % der Partien. Mit 5 Sendern
wären es 2.7 %, mit 10 Knoten ebenfalls. 8 Knoten wären noch sicherer, aber
kaum noch ein Graph; 9 lässt dem Brett eine Form.

Bei 5 % Blockadedichte rundet ein Brett mit 9 Knoten auf null Achtecke. Das
Einstiegsbrett erklärt damit genau eine Regel.

### 2. Was es mit der Kurve dahinter macht

Ganze Partien, beide Bots, `tools/onboarding.js --full`. Zwei Arten, das Brett
einzubauen:

- **ersetzt** — das Einstiegsbrett tritt an die Stelle von Level 1. Ab Level 2
  ist jedes Brett das, was die Kurve vorher ausgeteilt hat, Bit für Bit, weil
  Level *i* allein aus `seed + i · 7919` gezogen wird.
- **vorn** — das Einstiegsbrett wird vorangestellt, das bisherige Level 1
  (18/4) wird Level 2, die ganze Kurve rückt um eins nach hinten. Sanfterer
  zweiter Schritt, aber jede Partie ein Level länger; `tau` und `floor` sind
  die Stellschrauben, um das ab Level 3 zurückzunehmen.

Knoten/Sender je Level:

| Variante | L1 | L2 | L3 | L4 | L5 | L6 | L7 | L8 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| heute | 18/4 | 22/5 | 26/5 | 30/6 | 34/6 | 38/7 | 42/7 | 46/8 |
| ersetzt | 9/6 | 22/5 | 26/5 | 30/6 | 34/6 | 38/7 | 42/7 | 46/8 |
| vorn | 9/6 | 18/4 | 22/5 | 26/5 | 30/6 | 34/6 | 38/7 | 42/7 |
| vorn, tau 3 | 9/6 | 18/4 | 22/5 | 26/5 | 30/5 | 34/6 | 38/6 | 42/7 |
| vorn, floor 0.14 | 9/6 | 18/4 | 22/5 | 26/5 | 30/6 | 34/6 | 38/6 | 42/7 |

1000 Partien je Bot und Variante, Seeds 1–1000:

| Variante | gierig Median / Mittel / SD | gierig endet in L1 | voraus p10 / Median / p90 | voraus Mittel / SD | Abstand | Verhältnis | voraus häufigstes Ende |
| --- | --- | --- | --- | --- | --- | --- | --- |
| heute | 4 / 4.15 / 2.04 | 3.1 % | 5 / 8 / 20 | 10.68 / 7.06 | +4 | 2.57x | 29 % |
| **ersetzt** | **4 / 4.30 / 1.92** | **0.0 %** | **5 / 8 / 20** | **10.68 / 7.06** | **+4** | **2.49x** | **29 %** |
| vorn | 5 / 5.23 / 2.22 | 0.0 % | 6 / 9 / 22 | 11.92 / 6.97 | +4 | 2.28x | 28 % |
| vorn, tau 3 | 4 / 4.35 / 1.48 | 0.0 % | 4 / 7 / 13 | 8.53 / 5.11 | +3 | 1.96x | 22 % |
| vorn, tau 2.5 | 4 / 4.35 / 1.48 | 0.0 % | 4 / 7 / 13 | 8.53 / 5.11 | +3 | 1.96x | 22 % |
| vorn, floor 0.14 | 5 / 4.94 / 1.72 | 0.0 % | 6 / 7 / 14 | 8.62 / 3.68 | +2 | 1.74x | 24 % |

Gegenprobe auf zweitem Seed-Bereich und auf dem Tagesbrett:

| Seeds | Variante | gierig Mittel | voraus Median / Mittel / SD | Abstand | Verhältnis | gierig endet in L1 |
| --- | --- | --- | --- | --- | --- | --- |
| 1001–2000 | heute | 4.25 | 8 / 10.70 / 6.65 | +4 | 2.52x | 3.5 % |
| 1001–2000 | **ersetzt** | 4.40 | 8 / 10.70 / 6.65 | +4 | 2.43x | 0.0 % |
| 365 Tage | heute | 4.09 | 9 / 10.76 / 6.55 | +5 | 2.63x | 2.2 % |
| 365 Tage | **ersetzt** | 4.16 | 9 / 10.76 / 6.55 | +5 | 2.58x | 0.0 % |

### Befund

**„Ersetzt" trifft alle Vorgaben, ohne dass die Kurve angefasst werden muss.**
Der Planer ist auf beiden Seed-Bereichen und auf den Tagesbrettern *identisch*
mit vorher — Median, Mittel, SD, p10, p90 —, weil er auf dem alten Level 1
nie gescheitert ist und ab Level 2 dieselben Bretter kommen. Der gierige Bot
gewinnt die 2 bis 3.5 % Partien zurück, die bisher auf dem ersten Brett
endeten, sonst nichts. Abstand +4 (Tagesbrett +5, wie vorher), Verhältnis
2.49x statt 2.57x — es sinkt nur, weil der gierige Mittelwert um diese
geretteten Partien steigt. Die ersten Level werden nicht zu großzügig, also
gibt es nichts nachzuziehen.

Ein Nebeneffekt, der bleibt: **alle bisherigen Kalibrierungen gelten weiter.**
`blockedRatio`, `EDGE_DELETE_RATIO` und die Senderkurve wurden auf Brettern ab
18 Knoten gemessen; die Bretter ab Level 2 sind dieselben.

**„Vorn" ist der sanftere Einstieg und lässt sich nicht sauber zurücknehmen.**
Ohne Korrektur wird jede Partie ein Level länger (Median 9, Mittel 11.92) —
genau der zu großzügige Einstieg, vor dem die Fragestellung warnt. Die
Korrektur ab Level 3 scheitert an der Rundung: die Senderzahl ist ganzzahlig,
`tau` 3 und 2.5 teilen auf allen 14 Leveln dieselben Zahlen aus, und schon die
erste Stufe, die überhaupt etwas ändert, schießt über — Median 7, Abstand +3,
Verhältnis 1.96x. Der Abstand ist das, was Vorausdenken belohnt; ihn für einen
sanfteren zweiten Schritt herzugeben, wäre der falsche Tausch. Ein `floor` von
0.14 ist noch schlechter (+2, 1.74x).

**Was „ersetzt" kostet:** den Schritt von 9 auf 22 Knoten. In Level 2 endet
gierig in 4.2 % der Partien, das alte erste Brett verlangte 3.1 % — von einem
Neuling, dem bis dahin nichts gezeigt worden war. Wer Level 2 erreicht, hat die
Regel jetzt bereits einmal gewonnen.

### Punkte

Die Länge der Partien ändert sich nicht, die Punkte schon: Level 1 lässt im
Mittel rund vier Sender übrig, jeder einen Punkt wert. `tools/endless.js
--runs=1000`, Punkte-Median gierig 6 → 10, voraus 32 → 36, p90 voraus 185 →
186. Alte Bestwerte sind damit um etwa vier Punkte leichter zu schlagen. Das
ist keine Skalenänderung wie beim Teiler — dieselbe Zahl bedeutet fast
dasselbe —, und `SCORE_SCALE` bleibt deshalb auf 1. Hier nicht entschieden;
wer alte Rekorde verwerfen will, hebt `SCORE_SCALE`.

*(Nachgetragen: Level 1 zählt inzwischen nicht mehr zum Score, siehe den
nächsten Eintrag.)*

### Reproduktion

```sh
node tools/endless.js --runs=1000                     # Kurve wie ausgeliefert
node tools/endless.js --runs=365 --daily              # dieselbe auf Tagesbrettern
node tools/onboarding.js --runs=5000 --nodes=8,9,10 --senders=4,5,6
node tools/onboarding.js --runs=1000 --full='heute;ersetzt;vorn'
node tools/onboarding.js --runs=1000 --full='vorn,tau=3;vorn,floor=0.14'
node tools/onboarding.js --runs=365 --daily --full='heute;ersetzt'
```

`--full` braucht rund 100 Sekunden je Variante und 1000 Partien, fast alles für
den Planer. Die Brettgrößen-Tabelle läuft in Sekunden.

### Was blieb

- `src/run.js` — `ENDLESS_RUN.firstLevel = { nodes: 9, senders: 6 }` mit dieser
  Messung im Kommentar. `levelSpec` liefert jetzt auch `senders`, und ein
  `firstLevel` wird dort für Level 1 eingesetzt; ohne das Feld ist alles wie
  vorher. Der Mischer von `dailySeed` ist unverändert.
- `index.html` — der gespeicherte Tagesversuch trägt `rules: 2`. Ein Versuch
  ohne Kennzeichen wurde auf dem alten Level 1 gespielt; seine Züge würden auf
  dem neuen Brett Knoten nennen, die es nicht gibt, und wird deshalb verworfen
  statt nachgespielt. Am Tag der Auslieferung bekommt dadurch, wer schon
  gespielt hat, einen zweiten Versuch.
- `tools/onboarding.js` — neu. `tools/endless.js` — `--daily` und ein
  `seedOf`-Parameter an `measure`. Gefunden beim Messen: die übliche
  Argumentzerlegung `split('=')` schneidet `--full=vorn,tau=3` am zweiten `=`
  ab; `onboarding.js` trennt deshalb am ersten.
- `test/run.test.js` — das Einstiegsbrett ist 9/6 ohne Achteck, Level 2 ist mit
  und ohne es dasselbe Brett, und gierig verliert es auf 300 Seeds nie. Die
  Kurventests laufen gegen die Kurve ohne Einstiegsbrett.
- `tools/ui-smoke.js` — das erste Brett hat 9 Knoten, 6 Sender und kein
  Achteck; die Achteckprüfungen laufen jetzt auf dem Brett, auf dem die
  gespielte Partie endet; ein Tagesversuch ohne Regelkennzeichen wird nicht
  nachgespielt.

---

## 2026-10-12 — Level 1 zählt nicht, Ergebniszeile in Ziffern

**Konstanten:** `ENDLESS_RUN.firstLevel.scores` in `src/run.js` (`false`, neu);
das Format in `src/share.js`
**Werkzeug:** `tools/onboarding.js --points` (neu), `tools/share-forms.js` (neu)
**Ergebnis:** Level 1 bringt keine Punkte mehr, zählt aber weiter als geschafft.
Die Ergebniszeile zeigt je Level ab Level 2 eine Ziffer — die übrigen Sender —,
in Fünfergruppen, dazu `×` für das gescheiterte Level.

### 1. Wie viel Level 1 zum Score beitrug

Das Einstiegsbrett ist absichtlich großzügig; seine Reste sind Punkte, für die
niemand etwas geleistet hat. `tools/onboarding.js --points --runs=1000`, Seeds
1–1000, Anteil der Punkte aus Level 1 am Endstand, solange Level 1 zählte (wie in
0.2.0 ausgeliefert):

| Bot | Punkte aus L1 Mittel | Anteil Median | Anteil Median im unteren Quartil (nach Endstand) | Anteil p75 | Anteil gesamt |
| --- | --- | --- | --- | --- | --- |
| voraus | 4.01 | 10.6 % | 27.8 % | 20.0 % | 5.2 % |
| gierig | 4.01 | 40.0 % | 100.0 % | 66.7 % | 34.6 % |

Spürbar, und am stärksten dort, wo am wenigsten gespielt wurde: das untere
Viertel der gierigen Partien besteht vollständig aus Punkten von Level 1 — es
sind die Partien, die in Level 2 enden.

Verteilung des Endstands, jede Zählung als eigene Config gespielt, nicht
nachgerechnet:

| Bot | Zählung | p10 | p25 | Median | p90 | p99 | max | Mittel | SD | null Punkte |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| voraus | Level 1 zählt (0.2.0) | 13 | 19 | 36 | 186.2 | 595 | 1036 | 77.0 | 112.6 | 0.0 % |
| voraus | **Level 1 zählt nicht** | **9** | **16** | **31.5** | **183.1** | **591** | **1032** | **73.0** | **112.6** | **0.6 %** |
| voraus | vor dem Einstiegsbrett | 10 | 17 | 32 | 185 | 592 | 1032 | 74.0 | 112.6 | 0.2 % |
| gierig | Level 1 zählt (0.2.0) | 4 | 6 | 10 | 21 | 35 | 69 | 11.6 | 7.4 | 0.0 % |
| gierig | **Level 1 zählt nicht** | **0** | **2** | **6** | **17** | **30** | **65** | **7.6** | **7.4** | **15.9 %** |
| gierig | vor dem Einstiegsbrett | 1 | 3 | 6 | 18 | 31 | 65 | 8.2 | 7.5 | 8.9 % |

Ab Level 2 werden die Level gewichtet wie bisher: ein in Level 3 gesparter
Sender bleibt 3 wert. „Zählt nicht" landet damit fast genau auf der Verteilung
von vor dem Einstiegsbrett — der Unterschied ist, was das alte 18-Knoten-Level 1
gezahlt hat. Bestwerte aus der Zeit vor 0.2.0 sind wieder vergleichbar.

Der Preis steht in der letzten Spalte: jede sechste schwach gespielte Partie
endet mit null Punkten, obwohl sie Level 1 gewonnen hat. Die Statuszeile nach
Level 1 sagt deshalb nicht mehr „4 Sender übrig", was nach Punkten klingt, die
nicht kommen, sondern „Ab jetzt bringt jeder übrige Sender Punkte" — die
Punkteregel genau in dem Moment, bevor sie zum ersten Mal gilt.

**Entschieden:** Level 1 zählt nicht zum Score, fällt aus der Ergebniszeile und
bleibt in „N Level geschafft".

### 2. Die Ergebniszeile

Die Blockzeile aus 0.2.0 war mehrdeutig: ein Level war eine Gruppe von `■`, und
in proportionaler Schrift verschwindet der Abstand zwischen den Gruppen — drei
Blöcke konnten ein Level mit drei Resten sein oder drei Level mit je einem. Und
sie bestand überwiegend aus `·`, weil meist null bis zwei Sender übrig bleiben.

Kriterium: eindeutig lesbar ohne Levelnummern, auch wenn die Abstände
kollabieren, und so abwechslungsreich, dass zwei Partien verschieden aussehen.

#### Wie viel übrig bleibt

`tools/share-forms.js --days=365`, Tagesbretter ab 2026-01-01, Planer, Rest je
geschafftem Level:

| Level | 0 | 1 | 2 | 3 | 4+ | n | max |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | 0.0 % | 0.0 % | 0.3 % | 18.6 % | 81.1 % | 365 | 5 |
| 2+ | 38.5 % | 38.3 % | 19.2 % | 3.8 % | 0.2 % | 3561 | 4 |
| 2–5 | 31.8 % | 43.6 % | 21.9 % | 2.7 % | 0.0 % | 1436 | 3 |
| 6–10 | 43.1 % | 33.8 % | 17.9 % | 4.7 % | 0.4 % | 1099 | 4 |
| 11+ | 42.9 % | 35.7 % | 16.9 % | 4.4 % | 0.2 % | 1026 | 4 |

#### Kandidaten im Rendertest

Jeder Kandidat in drei Schriften (system-ui, Georgia, monospace) bei
`letter-spacing: -1px` gesetzt, also mit kollabierten Abständen
(`tools/share-forms.js --render=…`):

- **Eckige Zeichen fallen durch.** `■■■■` verschmilzt zu einem Balken, gleich
  hohe Balken `▃▃` zu einem breiten. Die Level sind nicht mehr zählbar.
- **Kreise halten** (`●○`): zwei Kreise berühren sich höchstens in einem Punkt.
- **Füllstände `◔◑` fallen durch**: sie kamen aus einer Ersatzschrift ohne
  Umriss, nur als Keil.
- **Emoji fallen durch**: farbige Kreise erschienen als leere Kästchen — die
  Umgebung hatte keine Emoji-Schrift. Genau das „nicht überall darstellbar".
- **Ziffern halten** in jeder Schrift; sie verschmelzen nie.
- **Umkreiste Ziffern** `①②` halten, kamen aber aus einer anderen Schrift als
  `○`, sichtbar größer. Nicht überall gleich.

Übrig blieben zwei: **A**, ein Zeichen pro Level in drei Stufen — `●`
komfortabel, `○` knapp, `×` gescheitert —, und **B**, die Restzahl als Ziffer.

Die Schwelle für A liegt bei **mindestens einem übrigen Sender**: „knapp" heißt
dann wörtlich, mit dem letzten Sender geschafft. Ab Level 2 teilt sie 38.5 % zu
61.5 %, nahe an halb und halb, und ein Zeichen trägt so am meisten Information
(0.96 Bit). Bei einer Schwelle von 2 kippt es auf 77 % zu 23 % (0.78 Bit), und
lange Partien bestehen fast nur aus `○`.

#### Abwechslung

365 Tagesbretter. „Zwei Tage gleich" ist die Wahrscheinlichkeit, dass zwei
zufällige Tage dieselbe Zeile zeigen. „Erste 6" vergleicht nur die ersten sechs
gezeigten Level — so lang ist eine kurze Partie, und kurze Partien sind die
häufigsten.

| Format | ganz: verschieden | zwei Tage gleich | erste 6: verschieden | zwei Tage gleich |
| --- | --- | --- | --- | --- |
| Blöcke (0.2.0) | 348 | 0.31 % | 286 | 0.45 % |
| A, ≥1 | 251 | 0.86 % | 48 | 4.84 % |
| A, ≥1, ab L2 | 251 | 0.86 % | 94 | 1.99 % |
| A, ≥2, ab L2 | 231 | 1.32 % | 69 | 5.40 % |
| B | 348 | 0.31 % | 286 | 0.45 % |
| **B, ab L2 (ausgeliefert)** | **337** | **0.34 %** | **284** | **0.45 %** |

**Entschieden: B.** Bei kurzen Partien gewinnt B deutlich an Abwechslung — 286
gegen 48 verschiedene Muster, mit Level 1 in der Zeile verglichen, und 284 gegen
94 so, wie es ausgeliefert wird, ohne Level 1. Bei A ist das erste Zeichen
fast immer `●` (Level 1 lässt in 99.7 % der Partien mindestens zwei übrig);
ohne Level 1 wird A besser, bleibt aber bei einem Drittel von B.

Emoji sind raus, weil sie im Rendertest als leere Kästchen erschienen.

So sieht 2026-10-06 aus, gespielt vom Planer:

```
funkloch 06.10. — 15 Level geschafft, 77 Punkte
22100 11011
0110×
funkloch.vercel.app
```

Die Leerzeichen gruppieren nur zu fünft, als Hilfe beim Abzählen; kollabieren
sie, ändert sich nichts.

#### Nie zwei Ziffern

Eine zweistellige Zahl bräche die Regel „ein Zeichen pro Level". Sie kann nicht
vorkommen: ab Level 2 teilt die Kurve höchstens 9 Sender aus (erstmals in
Level 10, geprüft bis Level 500), und ein Brett zu räumen braucht mindestens
einen, also bleiben höchstens 8. Level 1 teilt 6 aus und steht nicht in der
Zeile. Gemessen kam ab Level 2 höchstens 4 vor (365 Tagesbretter, Planer; 300
Partien je Bot ebenso). `test/share.test.js` hält die Kurve bei höchstens 10
ausgeteilten Sendern; ändert sie sich, schlägt der Test an. Für den Fall, dass
es doch je passiert, setzt `share.js` ein einzelnes `+`.

### Bestwerte

0.2.0 ist ausgeliefert, und solange es lief, zählte Level 1 mit. Bestwerte aus
diesen Tagen sind um etwa vier Punkte zu hoch und lassen sich von älteren und
neueren nicht unterscheiden — alle tragen `scale: 1`. `SCORE_SCALE` ist nicht
angehoben: das würde auch die Bestwerte von vor 0.2.0 verwerfen, die wieder
genau vergleichbar sind. Hier nicht entschieden.

### Reproduktion

```sh
node tools/onboarding.js --points --runs=1000      # rund 5 Minuten
node tools/share-forms.js --days=365               # rund 35 Sekunden
node tools/share-forms.js --render=formen.png      # Rendertest, braucht playwright
```

### Was blieb

- `src/run.js` — `firstLevel: { nodes: 9, senders: 6, scores: false }` und
  `levelScores(config, level)`, das `build()` und die Seite fragen. Ohne
  `scores: false`, und im festen Lauf ohne Einstiegsbrett, zählt jedes Level
  wie bisher.
- `src/share.js` — Ziffern statt Blöcken, Fünfergruppen, zwei je Zeile;
  Level 1 fällt heraus, wenn es nicht zählt; `TEN_OR_MORE` als Sicherung. Die
  Zeilenform mit Levelnummern ist entfernt.
- `index.html` — die Statuszeile nach Level 1 erklärt die Punkte statt die
  Reste zu zählen.
- `tools/onboarding.js --points`, `tools/share-forms.js` — neu.
- `test/run.test.js`, `test/share.test.js`, `tools/ui-smoke.js` — Level 1
  bringt 0 Punkte und zählt als geschafft; die Zeile ist Ziffern ab Level 2 in
  Fünfergruppen; die Kurve teilt nie mehr als 10 Sender aus; der Smoke-Test
  prüft Punkte und Statuszeile nach Level 1.

*(Nachgetragen: die Ergebniszeile ist inzwischen eine Kreisrampe, siehe den
nächsten Eintrag. Die Ziffern bleiben als `form: 'digits'` erhalten.)*

---

## 2026-10-12 — Ergebniszeile als Kreisrampe

**Konstante:** `RAMP` in `src/share.js` (`·`, `○`, `●`)
**Werkzeug:** `tools/share-forms.js` (Kandidaten C ergänzt)
**Ergebnis:** Die Ergebniszeile zeigt je Level ab Level 2 ein Zeichen auf einer
Rampe von leer nach voll — `·` kein Sender übrig, `○` einer, `●` zwei oder mehr
—, in Fünfergruppen, dazu `×` für das gescheiterte Level. Die Ziffern (B)
bleiben als `form: 'digits'` im Code, falls sich die Entscheidung umkehrt. Die
Kopfzeile schreibt den Namen als `funkl○ch`, mit dem Ring der Wortmarke.

### Die Frage

Variante C: eine Kreisrampe, ein Zeichen pro Level, der Rest wird mitgeführt
statt in „knapp/komfortabel" eingeteilt wie bei A. Vorgeschlagen war eine
vierstufige Rampe `· ○ ◉ ●` für 0, 1, 2, 3+; `◉` war der Wackelkandidat, und
falls kein viertes Zeichen hält, die dreistufige Fassung `· ○ ●` mit Deckelung
bei zwei. Erwartung: C liegt nahe an B, weil es fast dieselbe Information trägt.

### Rendertest

Wie bei A und B, drei Schriften (system-ui, Georgia, monospace) bei
`letter-spacing: -1px`, dazu jedes Zeichen einzeln gefragt, aus welcher Schrift
Chromium es zeichnet:

| Zeichen | gezeichnet aus |
| --- | --- |
| `·` `×` | Noto Sans |
| `○` `●` | Liberation Serif |
| `◉` `◎` `⊙` | DejaVu Sans |
| `⦿` | Adwaita Mono |

**Kein viertes Zeichen hält.** `◉`, `◎` und `⊙` kommen aus einer anderen
Schriftfamilie als `○` und `●` und sind deutlich größer: die dritte Stufe wirkt
voller als die vierte, die Rampe kippt, und ohne Legende liest man `◉` als „mehr
als voll". `⦿` kommt aus einer dritten Schrift und ist zu klein. Die vierstufige
Fassung fällt damit aus. Die dreistufige hält in allen drei Schriften: `·`, `○`,
`●` bleiben einzeln zählbar, auch wenn die Abstände kollabieren.

### Abwechslung

`tools/share-forms.js --days=365`, dieselben 365 Tagesbretter ab 2026-01-01,
Planer, dieselbe Tabelle wie im vorigen Eintrag, alle Formate ohne Level 1:

| Format | ganz: verschieden | zwei Tage gleich | **erste 6: verschieden** | **zwei Tage gleich** |
| --- | --- | --- | --- | --- |
| A `●○×`, Schwelle 1 | 251 | 0.86 % | **94** | **1.99 %** |
| B Ziffern | 337 | 0.34 % | **284** | **0.45 %** |
| C vierstufig `·○◉●` (nur Vergleich) | 337 | 0.34 % | 284 | 0.45 % |
| **C dreistufig `·○●` (ausgeliefert)** | **334** | **0.34 %** | **275** | **0.47 %** |

Die Erwartung trifft zu. Die vierstufige Rampe hätte auf diesen 365 Tagen genau
so viele Muster ergeben wie B; mehr als vier übrige Sender kommen ab Level 2 nie
vor. Die Deckelung bei zwei kostet nur 9 von 284 Mustern bei
kurzen Partien, weil drei oder mehr übrige Sender nur in 4 % der Level vorkommen
(Tabelle „Wie viel übrig bleibt" im vorigen Eintrag).

### Dieselben Partien, B und C

Vom Planer gespielt:

```
funkl○ch 05.10. — 6 Level geschafft, 11 Punkte     funkl○ch 05.10. — 6 Level geschafft, 11 Punkte
01200 ×                                             ·○●·· ×

funkl○ch 06.10. — 15 Level geschafft, 77 Punkte    funkl○ch 06.10. — 15 Level geschafft, 77 Punkte
22100 11011                                         ●●○·· ○○·○○
0110×                                               ·○○·×

funkl○ch 21.11. — 32 Level geschafft, 251 Punkte   funkl○ch 21.11. — 32 Level geschafft, 251 Punkte
12201 01100                                         ○●●·○ ·○○··
10011 01001                                         ○··○○ ·○··○
00121 00010                                         ··○●○ ···○·
0×                                                  ·×
```

(Links B, rechts C; jeweils mit `funkloch.vercel.app` als letzter Zeile.)

### Befund

**C wird ausgeliefert, dreistufig `· ○ ●` mit Deckelung bei zwei.** Die
Deckelung kostet nur 9 von 284 Mustern bei kurzen Partien, weil drei oder mehr
übrige Sender nur in 4 % der Level vorkommen. Dafür liest sich die Zeile als
Bild statt als Zahlenfolge, und bei langen Partien ist der Unterschied am
größten: dreißig Ziffern sind eine Zahl, die man abliest, dreißig Kreise ein
Verlauf, den man sieht.

Die vierstufige Fassung fällt aus, weil kein viertes Zeichen in allen drei
Schriften aus derselben Schriftfamilie kommt wie `○` und `●`, und die Rampe
sonst kippt.

### Doppelbedeutung von `○`

Mit der Kopfzeile `funkl○ch` steht `○` im Text in zwei Rollen: in der Kopfzeile
der Ring der Wortmarke, in der Zeile darunter ein übriger Sender. **Bewusst in
Kauf genommen**, weil der Kontext eindeutig ist — das eine steht mitten in
einem Wort, das andere in einer Reihe von Zeichen ohne Buchstaben.

### Reproduktion

```sh
node tools/share-forms.js --days=365               # Abwechslung, rund 35 Sekunden
node tools/share-forms.js --render=formen.png      # Rendertest, braucht playwright
```

Welche Schrift ein Zeichen zeichnet, steht nicht im Werkzeug; geprüft mit
`CSS.getPlatformFontsForNode` über das DevTools-Protokoll in Chromium.

### Was blieb

- `src/share.js` — `RAMP` und `form: 'ramp'` als Vorgabe; `form: 'digits'` mit
  `TEN_OR_MORE` bleibt. `GAME_NAME = 'funkl○ch'` für die Kopfzeile.
- `tools/share-forms.js` — die Rampen und die Ersatzkandidaten für `◉` im
  Rendertest, die Rampen in der Abwechslungstabelle, die Kopfzeile im
  Rendertest.
- `test/share.test.js`, `tools/ui-smoke.js` — die Zeile ist die Rampe ab
  Level 2 in Fünfergruppen, gedeckelt bei zwei; die Ziffernform hat ihre
  eigenen Prüfungen behalten; die Kopfzeile beginnt mit `funkl○ch`.

---

## 2026-10-12 — Tagesbrett wechselt um Mitternacht in Berlin

**Konstante:** `DAILY_TIME_ZONE = 'Europe/Berlin'` in `src/run.js` (neu; vorher
UTC)
**Werkzeug:** keins; geprüft mit Unit- und Smoke-Tests
**Ergebnis:** Das Tagesbrett wechselt um Mitternacht deutscher Zeit statt um
Mitternacht UTC, also um 0 Uhr statt um 2 Uhr (Sommer) bzw. 1 Uhr (Winter). Alle
spielen weiter gleichzeitig dasselbe Brett.

### Begründung

Entscheidend ist nicht, dass die Zeitzone neutral ist, sondern dass sie **für
alle dieselbe** ist. Das Tagesbrett ist nur etwas wert, wenn alle im selben
Moment dasselbe Brett spielen und Ergebnisse vergleichen können. Gerätelokale
Zeit wäre falsch: Spieler in anderen Zeitzonen hätten ein anderes Brett —
Neuseeland das von morgen, während Kalifornien noch auf dem von gestern sitzt —,
und Ergebnisse wären nicht mehr vergleichbar.

UTC erfüllte das, legte den Wechsel aber auf zwei Uhr nachts in Deutschland, wo
gespielt wird. Berlin legt ihn auf die Mitternacht, die die Spieler tatsächlich
haben; alle anderen wechseln weiter im selben Augenblick, nur nicht um ihre
eigene Mitternacht.

**Echte Zeitzone, kein fester Versatz.** Berlin ist im Winter UTC+1 und im
Sommer UTC+2. Ein fester Versatz von zwei Stunden legte den Wechsel fünf Monate
im Jahr auf ein Uhr nachts. `boardDay`, `dailySeed` und `msUntilNextDay` fragen
deshalb `Intl.DateTimeFormat` mit `timeZone: 'Europe/Berlin'`; die Mitternacht
des nächsten Tages wird als Instant gesucht, indem der in diesem Moment gültige
Versatz nachgeschlagen wird — zweimal, weil der erste Versuch auf der anderen
Seite einer Umstellung liegen kann. Berlin stellt um zwei bzw. drei Uhr um, nie
um Mitternacht; jedes Datum hat genau eine.

**Der Countdown benutzt dieselbe Uhr.** `msUntilNextDay` und `boardDay` lesen
dieselbe Wanduhr; ein Test läuft über 400 Tage in Sieben-Stunden-Schritten und
prüft, dass das Datum genau dort wechselt, wo der Countdown endet, und eine
Millisekunde vorher noch nicht.

### Die Umstellungstage

| Datum | Tag beginnt (UTC) | Tag endet (UTC) | Länge |
| --- | --- | --- | --- |
| 2026-03-29 (Sommerzeit beginnt) | 2026-03-28 23:00 | 2026-03-29 22:00 | **23 h** |
| 2026-06-01 | 2026-05-31 22:00 | 2026-06-01 22:00 | 24 h |
| 2026-10-25 (Sommerzeit endet) | 2026-10-24 22:00 | 2026-10-25 23:00 | **25 h** |

Der Countdown zählt um die Umstellung herum ohne Sprung: um 03:00 MESZ am
29. März stehen 21 Stunden aus, um das erste 02:30 am 25. Oktober 22½, um das
zweite 21½. An einem 25-Stunden-Tag zeigt die Endkarte bis zu „24:59:59".

### Welches Brett ein Datum hat

Der Seed hängt am **Datum**, nicht am Augenblick: die Tageszahl seit
1970-01-01 durch den murmur3-Mischer, wie bisher. Damit hat jedes Datum das
Brett, das es immer hatte — die Umstellung verschiebt, *wann* ein Brett kommt,
nicht, *welches* zu einem Datum gehört. Um 12:00 UTC sind sich beide Uhren über
das Datum einig; über 20 000 Tage (1888 bis 2134, jeder dritte) liefern alter
und neuer Code dort dasselbe Datum und denselben Seed. Die Tagesbrett-Messungen
in diesem Protokoll (`--daily`, ab 2026-01-01 um 12:00 UTC) bleiben dadurch
gültig.

### Ein zusätzlicher Versuch?

Der gespeicherte Tagesversuch hängt an der Datumszeichenkette. **Ein
zusätzlicher Versuch am selben Brett entsteht nicht.** Brett und Eintrag hängen
am selben Datum, also passt ein Eintrag immer zu dem Brett, auf dem er gespielt
wurde; und das Berliner Datum liegt nie hinter dem UTC-Datum, ein alter Eintrag
ist also entweder von heute oder von einem früheren Brett.

Was in der Nacht der Auslieferung geschieht, zwischen Mitternacht in Berlin und
Mitternacht UTC (0–2 Uhr im Sommer, 0–1 Uhr im Winter):

- Das Brett des nächsten Tages ist bis zu zwei Stunden früher da.
- Ein in diesem Fenster *unfertiger* Versuch am Brett des Vortags wird
  abgebrochen — er wäre mit dem alten Code um zwei Uhr ebenso abgelaufen.

Einmalig und harmlos. `DAILY_RULES` bleibt auf 2: die Züge eines Eintrags passen
weiter zu dem Brett seines Datums.

### Was blieb

- `src/run.js` — `DAILY_TIME_ZONE`, `boardDay` (statt `utcDay`), `dailySeed`
  und `msUntilNextDay` über `Intl.DateTimeFormat`, mit der Begründung im
  Kommentar.
- `index.html` — `boardDay` statt `utcDay`; `startDaily` liest die Uhr einmal
  für Datum und Brett, damit beide nicht auf verschiedene Seiten von Mitternacht
  fallen.
- `test/run.test.js` — Datum und Wechsel auf Berliner Mitternacht, im Sommer
  und im Winter; Countdown und Datumswechsel fallen zusammen; der 23- und der
  25-Stunden-Tag; jedes Datum behält seinen alten Seed.
- `tools/ui-smoke.js` — ein zweiter Browser in der Zeitzone Pacific/Auckland
  bekommt am selben Berliner Tag dasselbe Brett; um 23:59:59 Berliner Zeit
  noch das Brett vom 24., um 00:00:01 schon das vom 25., um 23:30 UTC ebenfalls;
  der Countdown zählt auf Berliner Mitternacht.

---

## 2026-10-12 — Die Rest-Grafik fliegt raus

**Konstante:** keine mehr; `RAMP`, `FAILED`, `TEN_OR_MORE`, `GROUP` und
`levelMarks` sind aus `src/share.js` entfernt
**Ergebnis:** Die Zeile mit einem Zeichen pro Level für die übrigen Sender
(Ziffern B, Kreisrampe C, davor die Blöcke aus 0.2.0) wird aus dem geteilten
Ergebnis entfernt. **Ausgeliefert wird die Kopfzeile allein**, ohne Grafik,
gefolgt von der Adresse des Spiels.

### Warum sie gescheitert ist

Die Grafik ist nicht deutbar. Übrige Sender sind ab Level 2 in **38.5 %** der
Level null (Tabelle „Wie viel übrig bleibt" oben), die Zeile besteht also
überwiegend aus Punkten, und ohne Kenntnis der Regeln bedeutet sie dem
Betrachter nichts: wer nicht weiß, dass ein Brett mit einer Handvoll Sender
gespielt wird und Reste etwas über das Spiel sagen, sieht in `·○●··` ein
Muster ohne Inhalt.

Die Abwechslungsmessung der beiden vorigen Einträge hat das nicht erfasst. Sie
belegte **statistische Unterscheidbarkeit, nicht Lesbarkeit**: 275 von 365
kurzen Partien sehen verschieden aus, aber verschieden aussehen heißt nicht,
etwas zu sagen. Ebenso prüfte der Rendertest nur, ob die Zeichen zählbar
bleiben, nicht, ob jemand weiß, was er da zählt.

**Regel für künftige Kandidaten:** Eine Grafik im geteilten Ergebnis muss ohne
Kenntnis der Spielregeln deutbar sein, sonst ist sie Dekoration. Abwechslung
und Rendertest bleiben notwendige Kriterien, sind aber nicht hinreichend.

### Zwei Fassungen an denselben Partien

Dieselben drei Tagesbretter wie im Eintrag zur Kreisrampe, vom Planer gespielt.
Die Levelleiste setzt ein gleiches Zeichen pro geschafftem Level, Level 1
eingeschlossen, damit sie mit der Zahl in der Kopfzeile übereinstimmt, und `×`
für das gescheiterte, in Fünfergruppen:

```
Nur Kopfzeile                                       Kopfzeile + Levelleiste

funkl○ch 05.10. — 6 Level geschafft, 11 Punkte      funkl○ch 05.10. — 6 Level geschafft, 11 Punkte
funkloch.thssn.dev                                  ●●●●● ●×
                                                    funkloch.thssn.dev

funkl○ch 06.10. — 15 Level geschafft, 77 Punkte     funkl○ch 06.10. — 15 Level geschafft, 77 Punkte
funkloch.thssn.dev                                  ●●●●● ●●●●●
                                                    ●●●●● ×
                                                    funkloch.thssn.dev

funkl○ch 21.11. — 32 Level geschafft, 251 Punkte    funkl○ch 21.11. — 32 Level geschafft, 251 Punkte
funkloch.thssn.dev                                  ●●●●● ●●●●●
                                                    ●●●●● ●●●●●
                                                    ●●●●● ●●●●●
                                                    ●●×
                                                    funkloch.thssn.dev
```

Die Levelleiste wiederholt die Zahl der Kopfzeile als Länge; deutbar ist sie
ohne Regelkenntnis („so weit gekommen, hier gescheitert"), sie trägt aber keine
Information, die die Kopfzeile nicht schon hat.

### Befund

**Die Kopfzeile allein wird ausgeliefert.** Die Levelleiste wiederholt nur die
Zahl aus der Kopfzeile und kostet bei langen Partien mehrere Zeilen — bei
32 Level fünf —, trägt also nichts bei.

### Kein Material für eine Teilgrafik

Das Spiel hat für eine Teilgrafik kein Material. Es gibt keinen Lösungsweg,
den man zeigen könnte, und die einzige Größe, die pro Level variiert — die
übrigen Sender —, ist in 38.5 % der Fälle null.

**Das ist eine Eigenschaft des Spiels, keine der gewählten Zeichen**, und
schließt weitere Versuche in dieser Richtung aus. Blöcke, Ziffern und
Kreisrampe sind an derselben Stelle gescheitert; ein vierter Zeichensatz würde
es auch. Erst wenn das Spiel selbst eine deutbare Größe pro Level bekommt, ist
die Frage wieder offen.

### Was blieb

- `src/share.js` — nur noch Kopfzeile und `GAME_URL`. `form: 'digits'` und die
  Rampe (`form: 'ramp'`, die ausgelieferte Kreisform) sind als tote Varianten
  entfernt, mit ihnen `RAMP`, `FAILED`, `TEN_OR_MORE`, `GROUP`,
  `GROUPS_PER_LINE` und `levelMarks`. Die Messungen dazu bleiben in diesem
  Protokoll, `tools/share-forms.js` reproduziert sie weiter.
- `test/share.test.js` — prüft Kopfzeile und Adresse, nichts dazwischen; die
  Prüfungen der Zeichen und die Wache gegen zweistellige Reste (nur für die
  Ziffernform da) sind entfernt.
- `tools/ui-smoke.js` — der geteilte Text hat genau zwei Zeilen.
- `README.md` — das Beispiel zeigt die Kopfzeile allein.

---

## 2026-11-10 — Das Plateau: warum ab Level 12 jedes Level gleich ist

**Konstanten:** `ENDLESS_RUN.levelNodes`, `ENDLESS_RUN.senderCurve`,
`ENDLESS_RUN.composition` in `src/run.js`; neu `DAILY_RUN`
**Werkzeug:** `tools/plateau.js` (neu)
**Ergebnis:** Ab Level 12 ist jedes Level gleich gebaut, und die
Scheiterquote ist dort konstant. **Der Planer taugt als Maßstab nicht mehr**
(siehe Befund). Von den zwei vorgeschlagenen Varianten taugt keine so, wie
vorgeschlagen; die Stellschraube, die funktioniert, ist die Zusammensetzung der
Hand. **Eingebaut fürs Tagesbrett** (`DAILY_RUN`): Level 7 mit 8 Sendern, ab
Level 12 alle 3 Level eine kleinere Hand, Ende nach Level 25. Das freie Spiel
bleibt vorerst, wie es war.

### Die Frage

Ein guter menschlicher Spieler erreicht regelmäßig Level 50 bis 60, und ab
etwa Level 20 fühlt sich jedes Level gleich an. Der Planer liegt im Median bei
8 und taugt damit nicht als Maßstab für gute Spieler. Verdacht: Der Vorrat
läuft asymptotisch auf 0,15 aus und die Brettgröße ist bei 60 gedeckelt, also
ändert sich ab einem Punkt nichts mehr. Ist die Scheiterquote dort konstant,
ist die Partie ab dort ein reiner Zufallsprozess ohne Steigerung.

Ziel: Ein guter Spieler landet bei 20 bis 25 Leveln statt bei 60, ohne dass
der Einstieg härter wird.

### Methode

**Level sind unabhängig.** Level i eines Laufs wird allein aus
`seed + i · 7919` gezogen und teilt eine frische Hand aus. Ob ein Spieler es
übersteht, hängt also von nichts ab, was vorher geschah. Die Scheiterquote von
Level L lässt sich darum messen, indem man Level L allein spielt, über viele
Seeds, auf genau den Brettern, die ein Lauf dort austeilen würde. Die
Laufverteilung ergibt sich als Produkt der Überlebensraten. So kann auch ein
Bot, der nie über Level 8 hinauskommt, sagen, wie Level 50 ist.

`--check` bestätigt beides: 478 von 478 einzeln gebauten Leveln sind Bit für
Bit die eines echten Laufs, und die Bitset-Fassungen von gierig und Planer
weichen auf 2018 Zügen in keinem von `tools/bot64.js` ab. Die Bitset-Fassung
gibt es, weil `bot64.js` bei 64 Knoten endet und Variante 2 darüber hinaus
will.

Vier Spieler, von schwach bis perfekt:

| Spieler  | was er weiß und tut |
|----------|---------------------|
| gierig   | die meisten neuen Knoten jetzt |
| Planer   | `lookaheadChoice`: drei Züge über die Karte in der Hand und die zwei gezeigten — der Bot, gegen den bisher jede Kalibrierung gemacht wurde |
| Rollout  | was ein Mensch weiß: die Karte in der Hand, die zwei gezeigten und welche Karten noch übrig sind, aber nicht in welcher Reihenfolge. Die Zusammensetzung der Hand folgt allein aus ihrer Größe (9 Sender sind immer 3×r1, 4×r2, 2×r3), und die Zahl steht auf dem Bildschirm. Jeder Kandidat wird danach beurteilt, wie oft gieriges Weiterspielen das Brett über 24 Mischungen des verdeckten Rests räumt. |
| lösbar   | ob das Brett mit dieser Hand überhaupt zu räumen ist, Reihenfolge egal: exakte Mengenüberdeckung. Kein Spieler schafft mehr; seine Quote ist ein Boden unter allen. Gibt nach 2 Mio. Suchknoten auf und meldet „offen", statt zu raten. |

### 1. Was sich zwischen Level 20 und 60 ändert: nichts

Ballgrößen über 200 Bretter je Level; „Reichweite/Knoten" ist die Summe der
mittleren Ballgrößen der Hand, geteilt durch die Knotenzahl — eine nominelle
Deckung, Überlappung nicht abgezogen. `node tools/plateau.js --spec --seeds=200`:

```
Level  Knoten  Verhältnis  Sender  Hand r1/r2/r3  Ball r1/r2/r3          Reichweite/Knoten
    1       9      0.6667       6  2/3/1          3.32 / 5.58 /  7.41    3.42
    2      22      0.2201       5  2/2/1          3.69 / 6.84 /  9.98    1.41
    3      26      0.2046       5  2/2/1          3.73 / 7.01 / 10.41    1.23
    4      30      0.1925       6  2/3/1          3.72 / 6.94 / 10.24    1.28
    5      34      0.1831       6  2/3/1          3.78 / 7.20 / 10.82    1.18
    6      38      0.1758       7  3/3/1          3.68 / 6.91 / 10.25    1.11
    8      46      0.1656       8  3/3/2          3.90 / 7.73 / 12.04    1.28
   10      54      0.1595       9  3/4/2          3.81 / 7.39 / 11.33    1.18
   12      60      0.1558       9  3/4/2          4.02 / 8.15 / 12.89    1.17
   20      60      0.1508       9  3/4/2          4.03 / 8.22 / 13.07    1.19
   30      60      0.1501       9  3/4/2          4.02 / 8.15 / 12.86    1.17
   60      60      0.1500       9  3/4/2          4.03 / 8.16 / 12.89    1.18
```

Ab Level 12 hat jedes Level 60 Knoten, 9 Sender und die Hand 3/4/2. Das
Verhältnis bewegt sich nur noch in der vierten Nachkommastelle und ändert die
Senderzahl nicht mehr; auch die Ballgrößen stehen still. Nicht ab Level 20,
sondern ab Level 12.

### 2. Scheitern je Level

Jedes Level für sich, 1000 Seeds, dieselben Seeds für alle Spieler.
`node tools/plateau.js --levels --level=2-12,15,20,25,30,40,50,60 --seeds=1000`:

```
Level  Knoten  Sender   gierig   Planer   Rollout   lösbar
    2      22       5     4.2 %    0.0 %     0.0 %    0.0 %
    3      26       5    18.5 %    0.6 %     0.0 %    0.0 %
    4      30       6    13.1 %    0.5 %     0.0 %    0.0 %
    5      34       6    33.6 %    4.7 %     0.3 %    0.0 %
    6      38       7    41.6 %    9.3 %     1.2 %    0.0 %
    7      42       7    69.1 %   33.2 %    13.3 %    2.4 %
    8      46       8    19.6 %    1.4 %     0.0 %    0.0 %
    9      50       8    48.1 %   12.7 %     1.2 %    0.0 %
   10      54       9    39.2 %   12.6 %     0.0 %    0.0 %
   11      58       9    47.2 %   12.2 %     0.5 %    0.0 %
   12      60       9    48.3 %   14.5 %     0.6 %    0.0 %
   15      60       9    50.2 %   11.8 %     0.6 %    0.0 %
   20      60       9    48.9 %   13.5 %     0.2 %    0.0 %
   25      60       9    48.8 %   13.2 %     0.1 %    0.0 %
   30      60       9    48.0 %   10.3 %     0.2 %    0.0 %
   40      60       9    47.9 %   11.6 %     1.1 %    0.0 %
   50      60       9    49.1 %   13.6 %     0.2 %    0.0 %
   60      60       9    46.1 %   11.0 %     0.4 %    0.0 %
```

Gezählt wird das *geschaffte* Level, wie seit 2026-10-12.

Gepoolt über die acht Plateau-Zeilen (8000 Bretter): gierig **48.4 %**,
Planer **12.4 %**, Rollout **0.43 %**, lösbar **0 von 8000 unlösbar**. Die
Quote ist ab Level 12 im Rahmen der Streuung konstant — der Verdacht stimmt:
ab dort ist die Partie ein gedächtnisloser Prozess mit fester Abbruchrate.
Und weil jedes dieser Bretter lösbar ist, scheitert dort niemand am Spiel,
sondern nur an eigenen Fehlern.

### 3. Gegenprobe: Modell gegen ganze Läufe

Das Produkt der Einzelquoten (`--compose`) gegen ganze Läufe
(`--runs=500`, Planer) und die Tabelle im Kommentar zu `firstLevel`:

| | Modell | ganze Läufe |
|---|---|---|
| Planer | Median 8, Mittel 10.4 | Median 8, Mittel 10.73 (500 Läufe) |
| gierig | Mittel 4.4 | 4.40 (Onboarding-Tabelle, 1000 Läufe) |

Die Lücke im Planer-Mittel kommt daher, dass das Modell das Plateau aus einer
einzelnen Stichprobe mit 14.5 % nimmt; gepoolt sind es 12.4 %.

### 4. Der Maßstab

| | Plateau-Quote | Median geschafft (Modell) |
|---|---|---|
| Planer | 12.4 % | 8 |
| guter Mensch (beobachtet) | ≈ 1 % (gerechnet) | 50–60 |
| Rollout | 0.43 % | 97–131 (je nach Stichprobe des Plateaus) |
| lösbar | 0 % | — (scheitert nur auf 2.4 % der Level 7) |

Die Plateau-Quote des Menschen ist zurückgerechnet: Wer bis Level 11 zu etwa
84 % überlebt (wie der Rollout-Bot) und im Median 54 schafft, verliert auf den
43 Plateau-Leveln dazwischen je etwa 1.2 %; bei 70 % Überleben bis Level 11
sind es 0.8 %. **Der Planer verliert auf dem Plateau rund zwölfmal so oft wie
ein guter Mensch.** Er stirbt vor jeder Änderung, die in diesem Eintrag
getestet wird: Sein Median bleibt in allen Varianten bei 8, weil die Varianten
erst dahinter greifen.

**Menschen-Faktor.** Für die Abschätzung des Menschen werden die
Rollout-Quoten jedes Levels mit einem Faktor k multipliziert. k = 1.7 bis 1.9
ist der Bereich, in dem die ausgelieferte Kurve auf 52 bis 63 kommt:

```
k     ausgeliefert   8 ab L18   8 ab L20   Hand 12/3   Hand 12/4   Hand 14/3
1.0            131         21         23          23          26          25
1.5             76         19         21          21          23          23
1.7             63         18         20          20          22          22
1.8             57         18         20          20          21          22
1.9             52         18         20          20          21          21
2.0             47         18         20          19          20          21
3.0             17         17         17          14          15          16
```

**Das ist eine ungeprüfte Annahme aus einer einzigen Beobachtung**: einem
Spieler, der regelmäßig 50 bis 60 erreicht. Sie unterstellt, dass ein Mensch
auf jedem Brett um denselben Faktor schlechter ist als der Rollout-Bot, auf
Level 7 genauso wie auf dem Plateau und auf einer kleineren Hand genauso wie
auf der großen. Nichts davon ist gemessen. Die Spalten oben sind eine
Größenordnung, keine Vorhersage.

### 5. Variante 1: die Kurve fällt weiter

Das Verhältnis wirkt nur über `round(n · Verhältnis)`. Auf 60 Knoten gibt es
darum nur drei Zustände. `--grid`, 1000 Seeds:

```
Knoten  Sender  Verh.   Planer   Rollout   lösbar
    60       9  0.150   13.9 %     0.1 %    0.0 %
    60       8  0.133   43.3 %    10.1 %    0.1 %
    60       7  0.117   96.4 %    91.9 %   75.9 %
    60       6  0.100   99.5 %    99.3 %   97.2 %
```

Bei 7 Sendern sind drei von vier Brettern unlösbar. Eine weiter fallende Kurve
läuft deshalb immer in diese Wand. `--compose`, Level 1–40, 1000 Seeds je
Brettgröße:

```
Variante                              Planer        Rollout              lösbar
                                      Median        Median (Quartile)    Median (Quartile)
ausgeliefert                            8           97 (29–212)          —
fällt ab L9 um 0.002/Level              8           18 (14–21)           21 (21–21)
fällt ab L9 um 0.003/Level              8           16 (11–17)           17 (17–17)
fällt ab L9 um 0.004/Level              8           15 (11–15)           15 (15–15)
fällt ab L9 um 0.005/Level              8           14 (11–14)           14 (14–14)
fällt ab L11 um 0.004/Level             8           17 (13–17)           17 (17–17)
fällt ab L13 um 0.004/Level             8           19 (15–19)           19 (19–19)
8 Sender ab L12                         8           15 (11–21)           679
8 Sender ab L14                         8           17 (13–23)           681
8 Sender ab L16                         8           19 (15–25)           683
8 Sender ab L18                         8           21 (17–27)           685
8 Sender ab L20                         8           23 (19–29)           687
```

Die fallenden Kurven haben eine Wand: Beim Löser fallen die Quartile auf ein
einziges Level zusammen, jeder Lauf endet dort, wo 60/7 beginnt. Die steileren
ziehen außerdem Level 10 auf 54/8 herunter und machen damit den Einstieg härter
(≥10 geschafft beim Planer 43.0 % → 31.1 %).

Die einzige brauchbare Form ist der eine Schritt auf 8 Sender. Mit dem Schritt
ab Level 18 bis 20 landet der Rollout-Bot bei 21 bis 23, mit einer echten
Verteilung. Danach ist die Quote aber wieder konstant, nur höher (10.9 %): Die
Partie wird kürzer, steigert sich aber nicht.

### 6. Variante 2: Bretter wachsen über 60 hinaus

Gleiches Wachstum von 4 Knoten je Level, ausgelieferte Verhältniskurve.
`--compose`, Level 1–30, 400 Seeds je Brettgröße:

```
Variante            Planer Median   Rollout Median (Quartile)   Rollout Plateau
wächst bis 80              8           52 (20–107)               1.3 %
wächst bis 100             8          134 (16–411)               0.3 %
wächst ohne Deckel         —           nicht gemessen (s. u.)
```

Je Brettgröße, Rollout:

```
62/10 0.5 %   66/10 2.3 %   70/11 0.3 %   74/11 1.0 %   78/12 1.5 %
80/12 1.3 %   82/12 14.5 %  86/13 0.3 %   90/14 0.0 %   94/14 0.8 %
98/15 0.8 %  100/15 0.3 %  102/15 1.0 %  106/16 0.0 %  110/17 0.3 %
114/17 0.3 % 118/18 0.0 %  122/18 0.0 %  126/19 0.0 %  130/20 0.0 %
```

Wachsen allein steigert nichts. Bei gleichem Verhältnis wird es für den
Rollout-Bot sogar eher leichter, und die Quote springt mit der Rundung: 80/12
1.3 %, 82/12 14.5 %, 86/13 0.3 %. Bei 82 Knoten rundet 82 · 0.1516 = 12.4 auf
12 ab, effektiv 0.146, und die Reichweite pro Knoten fällt auf 1.06.

Mit weniger Sendern auf 80 Knoten (`--grid`, 500 Seeds) gibt es eine feinere
Treppe als auf 60, aber auch hier ist ein Schritt schon groß:

```
Knoten  Sender  Verh.   Planer   Rollout   lösbar
    80      12  0.150   42.8 %     2.1 %    0.0 %   (26 offen, 1000 Seeds)
    80      11  0.138   67.2 %     7.6 %    0.0 %   (30 offen)
    80      10  0.125   89.0 %    51.4 %    0.0 %   (118 offen)
    80       9  0.113   96.4 %    82.6 %   24.3 %   (125 offen)
```

Der Löser kommt auf großen Brettern an sein Budget; „offen" sind die Bretter,
für die er nach 2 Mio. Suchknoten keine Antwort hatte.

**Das 134er-Brett und „wächst ohne Deckel" sind bewusst nicht zu Ende
gemessen.** Über 80 Knoten ist das Brett auf dem Telefon nicht bedienbar: Schon
auf dem 60er bei 360 px lag vor der Korrektur jeder zweite Tipp zwischen zwei
Knoten (Commit „Tipp geht an den nächsten Knoten"). Variante 2 war damit vorher
entschieden, die Messung über 80 hinaus hätte daran nichts geändert. Auch die
Rasterzeilen mit 100 Knoten und weniger Sendern sind aus diesem Grund
abgebrochen worden.

### 7. Die Stellschraube, die funktioniert: die Hand

Die Rundungssprünge in Variante 2 erklärt nicht das Verhältnis, sondern die
Reichweite pro Knoten — und in die geht die Zusammensetzung der Hand ein.
Daraus folgt eine feinere Stellschraube als die Senderzahl. Gleiches Brett,
gleiche Senderzahl, nur die Hand ändert sich. `--grid=60:9:a/b/c`, 1000 Seeds:

```
Hand r1/r2/r3   Reichweite/Knoten   Planer   Rollout   lösbar
3/4/2 (heute)               1.18     13.9 %     0.1 %    0.0 %
4/3/2                       1.11     23.5 %     1.9 %    0.0 %
3/5/1                       1.10     36.6 %     3.0 %    0.0 %
5/2/2                       1.04     42.3 %     7.4 %    0.0 %
4/4/1                       1.03     53.5 %     9.2 %    0.0 %
5/3/1                       0.96     74.3 %    33.1 %    2.6 %   (3 offen)
60/8 mit 3/3/2              1.04     43.3 %    10.1 %    0.1 %
```

Die Quote steigt gleichmäßig, und bis zur letzten Stufe ist jedes Brett
lösbar: Die Schwierigkeit kommt aus dem Spielen, nicht aus Pech. 4/4/1 bei 9
Sendern und 3/3/2 bei 8 Sendern haben dieselbe Reichweite pro Knoten und
dieselbe Quote; die Reichweite pro Knoten ist also die Größe, die die
Schwierigkeit trägt, nicht das Senderverhältnis.

Als Lauf: ab Level `from` alle `step` Level eine Stufe die Leiter hinab, Brett
konstant 60/9. `--compose`, Level 1–40, 1000 Seeds je Hand:

```
Variante                        Planer   Rollout Median (Quartile)   lösbar Median (Quartile)
Hand ab L12, alle 2 Level         8        20 (16–22)                  39 (28–58)
Hand ab L12, alle 3 Level         8        23 (17–27)                  44 (33–62)
Hand ab L12, alle 4 Level         8        26 (19–31)                  49 (37–67)
Hand ab L14, alle 3 Level         8        25 (19–29)                  46 (35–64)
```

Die Quote je Level steigt dabei wirklich: 0.6 → 2.1 → 3.1 → 7.6 → 11.7 →
32.0 % (die Rollout-Werte dieser Stichprobe). Bis Level 11 bleibt alles wie
ausgeliefert, auch „≥10 geschafft" (Rollout 84.4 %, Planer 43.0 %): Der
Einstieg wird nicht härter.

### Befund

**Der Planer hat als Maßstab ausgedient.** Er verliert auf dem Plateau rund
zwölfmal so oft wie ein guter Mensch (12.4 % gegen etwa 1 %) und stirbt vor
jeder hier getesteten Änderung: In allen Varianten bleibt sein Median bei 8.
Das ist keine Randnotiz. Alle bisherigen Kalibrierungen dieses Projekts
beruhen auf ihm — `senderCurve`, `blockedRatio`, `firstLevel`, die
Verstärker- und Kantenlöschmessungen. Ihre Tabellen bleiben richtig als das,
was sie sind, nämlich Messungen gegen den Planer; ob sie für einen guten
Spieler dasselbe aussagen, ist offen. Wo ein früherer Eintrag auf Level 8 und
später schaut, sah er einen Spieler, den es so nicht gibt. **Ab jetzt ist der
Rollout-Bot der Maßstab**, mit dem Löser als Boden darunter.

**Ab Level 12 ändert sich nichts mehr.** 60 Knoten, 9 Sender, Hand 3/4/2, eine
konstante Abbruchquote, auf Brettern, die alle lösbar sind. Das erklärt das
Gefühl, dass jedes Level gleich ist.

**Variante 1 (Kurve fällt weiter) läuft in eine Wand**, außer in ihrer
einzigen brauchbaren Form, dem Schritt auf 8 Sender. Der verkürzt die Partie,
steigert aber nichts.

**Variante 2 (Bretter wachsen) steigert nichts** und ist über 80 Knoten auf
dem Telefon nicht bedienbar.

**Die Zusammensetzung der Hand ist die Stellschraube.** Sie stuft fein ab,
hält jedes Brett lösbar und lässt den Einstieg unberührt. Mit dem
Menschen-Faktor 1.7 bis 1.9 landet ein guter Spieler mit „ab L12 alle 4 Level"
oder „ab L14 alle 3 Level" bei 21 bis 22 — mit dem Vorbehalt aus Abschnitt 4.

### Nebenbefund: Level 7 ist eine Wand aus Rundung

Level 7 hat 42 Knoten und 7 Sender: 42 · 0.1704 = 7.16, abgerundet. Effektiv
sind das 0.167, die niedrigste Reichweite pro Knoten der ganzen Kurve vor dem
Plateau. Der Planer verliert dort 33 % der Läufe, die ankommen, der
Rollout-Bot 13 %, und selbst der Löser findet 2.4 % der Bretter unlösbar. Auf
Level 8 (46/8) verliert der Planer 1.4 %. Der Planer-Median von 8 hängt zu
einem guten Teil an dieser einen Stufe.

### Reproduktion

```sh
node tools/plateau.js --check                    # Konstruktion und Bots gegen bot64.js
node tools/plateau.js --spec --seeds=200         # Abschnitt 1
node tools/plateau.js --levels --level=2-12,15,20,25,30,40,50,60 --seeds=1000
node tools/plateau.js --runs=500                 # ganze Läufe, Planer
node tools/plateau.js --compose=shipped --bots=greedy,planner --upto=30
node tools/plateau.js --grid=60:9,60:8,60:7,60:6,70:11,80:12,90:14,100:15,120:18
node tools/plateau.js --grid=80:11,80:10,80:9 --seeds=500
node tools/plateau.js --grid=60:9:3/4/2,60:9:4/3/2,60:9:3/5/1,60:9:5/2/2,60:9:4/4/1,60:9:5/3/1,60:8:3/3/2
node tools/plateau.js --compose=eight-12,eight-14,eight-16,eight-18,eight-20,fall-8-0.002,fall-8-0.003,fall-8-0.004,fall-8-0.005,fall-10-0.004,fall-12-0.004 --upto=40
node tools/plateau.js --compose=grow-80,grow-100 --bots=planner,rollout --seeds=400 --upto=30
node tools/plateau.js --compose=hand-12-2,hand-12-3,hand-12-4,hand-14-3 --upto=40
```

Mit zwei Kernen dauert das zusammen gut eine Stunde; die Bretter über 80
Knoten und der Löser auf knappen Händen sind der größte Teil davon.

### 8. Nachgemessen vor dem Einbau: Level 7 mit acht Sendern

Die neue Kurve hängt an der Annahme, dass Level 7 mit einem Sender mehr
praktisch nicht mehr verloren wird. `--grid=42:8:3/3/2,42:7:3/3/1
--bots=greedy,planner,rollout,solvable`, 1000 Seeds:

```
Knoten  Sender  Hand    gierig   Planer   Rollout   lösbar
    42       8  3/3/2   19.0 %    2.6 %     0.1 %    0.0 %
    42       7  3/3/1   67.3 %   32.3 %    13.4 %    3.1 %
```

Hält: 0.1 % beim Rollout-Bot, kein unlösbares Brett. (42/7 hier auf den Seeds
von Index 20, darum 13.4 % / 3.1 % statt 13.3 % / 2.4 % in Abschnitt 2.)

### 9. Kontrollrechnung: das Tagesbrett mit Ende nach 25

Level 7 auf 42/8, ab Level 12 Brett 60/9 und die Hand alle 3 oder alle 4
Level eine Stufe kleiner, Ende nach Level 25. `--compose=daily-3,daily-4
--human=1.7,1.8,1.9`, 1000 Seeds je Brett; „Mensch k" ist der Rollout-Bot mal
k, mit dem Vorbehalt aus Abschnitt 4:

```
                    alle 3 Level                       alle 4 Level
                    Median  Quartile  ≥20     ≥25      Median  Quartile  ≥20     ≥25
Planer                11     8–15      3.7 %   0.2 %     11     8–15      6.0 %   0.5 %
Rollout               24    20–25     78.0 %  49.4 %   durch   22–25     83.5 %  62.2 %
Mensch 1.7            21    18–25     65.2 %  29.1 %     24    19–25     73.4 %  44.0 %
Mensch 1.8            21    18–25     63.5 %  27.0 %     23    19–25     72.1 %  41.8 %
Mensch 1.9            21    17–24     61.8 %  24.9 %     23    19–25     70.8 %  39.7 %
lösbar             durch    25–25    100 %   100 %    durch    25–25    100 %   100 %
```

„≥25" ist durchgespielt. Beide Fassungen landen einen guten Spieler bei 20 bis
25. **Gewählt: alle 3 Level.** Der Median liegt mitten im Ziel, die Leiter wird
bis 4/4/1 ausgenutzt, und durchspielen schafft etwa jeder vierte gute Spieler
statt fast jeder zweite. Der Löser spielt jeden Tag durch: Kein Tagesbrett
wird an einem unlösbaren Level verloren.

Der Einstieg wird nicht härter, sondern leichter, weil Level 7 seine Wand
verliert: ≥10 geschafft steigt beim Rollout-Bot von 84.4 % auf 97.3 %, beim
Planer von 43.0 % auf 63.0 %.

`--check` bestätigt, dass `DAILY_RUN` in `src/run.js` Level für Level
`daily-3` austeilt und dass einzeln gebaute Tageslevel denen echter Läufe
gleichen (278 von 278, bis Level 25).

### Was blieb

- `src/run.js` — `DAILY_RUN`: die Endloskurve mit `levelSenders: { 7: 8 }`,
  `handLadder` ab Level 12 (60 Knoten, 9 Sender, Hand 3/4/2 → 4/3/2 → 3/5/1 →
  5/2/2 → 4/4/1, alle 3 Level) und `lastLevel: 25`. `levelSpec` liefert für
  Leiterlevel die Hand als `composition` mit; `buildLevel` teilt sie aus.
  Ein Lauf mit `lastLevel` endet nach dessen Räumung in `'won'`. Das Brett
  eines Levels ändert sich dadurch nicht, nur die Hand: Sie wird nach dem
  Brett aus demselben Zufallsstrom gezogen.
- `ENDLESS_RUN` bleibt, wie es war. Das freie Spiel ist vorerst nicht umgebaut
  und hat weiter das Plateau und die Wand auf Level 7.
- `index.html` — das Tagesbrett spielt `DAILY_RUN`; `DAILY_RULES` 3, ein
  gespeicherter Versuch nach Regeln 2 wird nicht nachgespielt. Die Endkarte
  kommt auch bei `'won'`, mit „Alle 25 Level geschafft." in der Signalfarbe
  statt „Keine Sender mehr.".
- `src/share.js` — ein durchgespielter Tag teilt „durchgespielt, alle 25
  Level"; ein verlorener weiter „N Level geschafft".
- `tools/plateau.js` — das Werkzeug dieses Eintrags. Exportiert
  `rolloutChoice` für den Smoke-Test.
- `tools/ui-smoke.js` — spielt den verlorenen Tag wie bisher durch, prüft die
  Regeln-2-Verwerfung, und lässt einen vom Rollout-Bot durchgespielten Tag
  (2026-09-25, 130 Punkte) aus dem Speicher nachspielen: Karte, Kopfzeile bei
  25, geteilte Zeile, Countdown, „Frei" in einem Tipp.
- `test/run.test.js`, `test/share.test.js` — Kurve, Leiter, genaue Hand,
  Sieg nach dem letzten Level, freies Spiel unberührt; Ergebniszeile für
  durchgespielt gegen 24 geschafft.
- `CLAUDE.md` — der Rollout-Bot ist der Maßstab, der Menschen-Faktor als
  ungeprüfte Annahme vermerkt, frühere Kalibrierungen als gegen den Planer
  gemacht markiert.

---

## 2026-11-10 — Das Ziel in der Kopfzeile, das Level des Scheiterns in der Zeile

**Werkzeug:** keins; Anzeige, kein Parameter.
**Ergebnis:** Auf dem Tagesbrett zeigt die Kopfzeile „Level 12 von 25", die
Ergebniszeile eines verlorenen Tages „in Level 12 von 25 gescheitert" und die
Endkarte „Level 12 von 25". Kopfzeile, Endkarte und Ergebniszeile nennen
dasselbe Level: das, in dem die Partie endete.

### Warum

Der Kern der Rückmeldung zum Plateau war, dass jedes Level gleich wirkt. Ein
Ende nach Level 25 hilft dagegen nur, wenn man es sieht: ohne sichtbares Ziel
merkt niemand, dass es eins gibt. Das Ziel hängt an `lastLevel` der Partie,
nicht an der Spielart; das freie Spiel hat keins und zeigt weiter nur
„Level 12".

### Was das an der Zählung vom 2026-10-12 ändert

Der Eintrag „Level statt Etappe" legte fest, dass Endkarte **und**
Ergebniszeile das letzte geschaffte Level zählen. Für die Ergebniszeile gilt
das nicht mehr: Sie nennt das Level, in dem der Tag endete, und das Ziel. Neben
einem Ziel liest sich „11 Level geschafft" als Strecke ohne Richtung; „in
Level 12 von 25" stellt den Tag auf den Weg, den die Kopfzeile die ganze
Partie über zeigt. Ein durchgespielter Tag sagt „durchgespielt, alle 25
Level".

**Nachtrag, ebenfalls 2026-11-10: auch die Endkarte.** Zuerst zählte die
Endkarte weiter die geschafften Level. Neben der neuen Zeile standen damit zwei
Zahlen für denselben Tag — „Level geschafft: 11" auf der Karte, „in Level 12
gescheitert" in der Zeile — und das liest sich wie ein Fehler. Die Karte nennt
jetzt dasselbe Level wie Kopfzeile und Zeile, beschriftet „Level", auf dem
Tagesbrett mit Ziel („12 von 25", durchgespielt „25 von 25"), im freien Spiel
ohne („12"). Damit gilt die Festlegung vom 2026-10-12 auf der Seite nirgends
mehr; das freie Spiel ist eingeschlossen, weil Karte und Kopfzeile beiden
Spielarten gehören.

Die **Werkzeuge** zählen weiter das geschaffte Level wie seit 2026-10-12, und
`state.cleared` bzw. `levelsCleared` bleiben, was sie sind. Keine Tabelle in
dieser Datei ist betroffen.

### Was es kostet

„von 25" macht die Levelanzeige etwa 40 px breiter. Bei 320 px Breite braucht
die Kopfzeile damit rund 307 von 288 px, gemessen mit den breitesten Zahlen
des Tagesbretts (Level 25 von 25, dreistellige Punkte); vorher passte sie. Unter
340 px entfällt darum die Marke links, die nur Dekoration ist. Bei 360 px
bleibt sie.

### Was blieb

- `index.html` — `#hud-goal` mit „von N" hinter der Levelzahl, sichtbar, wenn
  die Partie ein `lastLevel` hat; die Lesung bricht nicht um; unter 340 px
  ohne `.hud-mark`. Die Endkarte beschriftet „Level" statt „Level geschafft"
  und zeigt `state.level`, mit „von N", wenn die Partie ein Ende hat.
- `src/share.js` — „in Level N von 25 gescheitert", ohne „von" für eine Partie
  ohne Ende.
- `test/share.test.js` — die neuen Zeilen, auch ohne Ziel.
- `tools/ui-smoke.js` — liest die Kopfzeile wie ein Spieler: „Level 1 von 25"
  auf dem Tagesbrett, „Level 1" im freien Spiel, „Level 25 von 25" nach dem
  Durchspielen; bei 320 und 360 px eine Zeile ohne Überstand. Die Endkarte
  zeigt im freien Spiel das Level, in dem die Partie endete, auf dem
  Tagesbrett „N von 25", durchgespielt „25 von 25".
- `README.md` — Kopfzeile und Beispielzeile.

---

## 2026-11-10 — Hilfetext ab Level 5 ausblenden: bringt die Höhe dem Brett etwas?

**Werkzeug:** `tools/stage-gain.js` (neu)
**Ergebnis: nicht eingebaut.** Der Hilfetext bleibt. Mehr Bühnenhöhe macht
die Knoten auf dem Telefon nicht größer, weil die Breite die Skalierung
begrenzt, nicht die Höhe.

### Die Frage

Der Hilfetext unter dem Brett erklärt Tippen und die achteckigen Knoten. Nach
den ersten Leveln weiß das jeder, und auf dem Telefon kostet er Höhe. Der
Vorschlag: ab Level 5 ausblenden und die Höhe der Bühne geben, damit die
Knoten größer werden. Bedingung: lohnt sich nur ab etwa 5 % mehr
Knotenradius. Und vorher prüfen, ob die Bühne überhaupt begrenzt.

### Wie das Brett skaliert

Zwei Größen, die man auseinanderhalten muss:

- Der Knotenradius **im Brett** ist 0.20 des engsten Knotenpaars
  (`DOT_RATIO`, Eintrag „Knotenradius aus dem engsten Paar"). Er hängt am
  Brett, nicht an der Bühne.
- Der Knotenradius **auf dem Schirm** ist dieser Radius mal dem Maßstab, mit
  dem das Brett in die Bühne gepasst wird: `min(Bühnenbreite / Brettbreite,
  Bühnenhöhe / Bretthöhe)`, uniform (`preserveAspectRatio`).

Mehr Bühnenhöhe hilft also nur, wenn die Höhe der kleinere der beiden
Quotienten ist. Die Bretter sind breiter als hoch — Breite zu Höhe im Mittel
1.20 (22 Knoten) bis 1.10 (34 bis 60 Knoten), einzelne bis 1.44 —, eine
Telefonbühne ist höher als breit (0.92 bei 360 × 640, 0.90 bei 320 × 568,
0.64 bei 390 × 844). Dann begrenzt die Breite.

### Gemessen

Sechs Bretter je Größe, in die Bühne gezeichnet, Hilfetext ein- und
ausgeblendet, Radius eines gewöhnlichen Knotens auf dem Schirm.
`node tools/stage-gain.js`:

```
360 × 640
Knoten  Bühne mit→ohne  Radius mit→ohne   Gewinn  begrenzt durch
    22  356→431 px      7.80→7.82 px       0.3 %  Breite (5 von 6), einmal Höhe→Breite
    34  356→431 px      6.43→6.43 px       0.0 %  Breite
    46  356→431 px      5.76→5.76 px       0.0 %  Breite
    60  356→431 px      5.03→5.03 px       0.0 %  Breite

320 × 568
    22  320→359 px      6.87→6.87 px       0.0 %  Breite
    34  320→359 px      5.65→5.65 px       0.0 %  Breite
    46  320→359 px      5.06→5.06 px       0.0 %  Breite
    60  320→359 px      4.42→4.42 px       0.0 %  Breite

390 × 844
    22  560→635 px      8.54→8.54 px       0.0 %  Breite
    34  560→635 px      7.02→7.02 px       0.0 %  Breite
    46  560→635 px      6.29→6.29 px       0.0 %  Breite
    60  560→635 px      5.49→5.49 px       0.0 %  Breite
```

Die Bühne gewinnt 75 px (360 × 640) bzw. 39 px (320 × 568), der Knotenradius
**0.0 %**. Ein einziges 22er-Brett war mit Hilfetext knapp höhenbegrenzt und
gewinnt 0.3 %. Alles andere ist Luft über und unter dem Brett.

### Befund

**Nicht eingebaut.** Die Grenze liegt weit unter den geforderten 5 %. Die
Bühne ist auf dem Telefon nicht der begrenzende Faktor; die Breite ist es,
und die ist mit dem Hilfetext dieselbe wie ohne.

Was die Knoten auf dem Telefon tatsächlich größer machen würde, zur
Einordnung, nicht als Vorschlag:

- **Die seitlichen 16 px Rand** der Seite: das Brett auf volle Breite gäbe
  etwa 10 % Radius (328 → 360 px), auf Kosten des Randes, den auch Kopfzeile
  und Hilfetext haben.
- **Hochformatige Bretter.** Bei einem Brett mit dem Seitenverhältnis der
  Bühne (0.92 statt 1.2) wäre der Maßstab rund 30 % größer. Das ist eine
  Änderung am Generator — und damit an jeder gespeicherten Levelsequenz,
  siehe „Byte-Identität der Level-Sets" in `CLAUDE.md`.

### Reproduktion

```sh
node tools/stage-gain.js        # startet seinen eigenen Server auf 8743
```

### Was blieb

- `tools/stage-gain.js` — das Werkzeug. Sonst nichts: kein Code am Spiel.

### Nachtrag, 2026-11-10: der Hilfetext geht jetzt doch — aus einem anderen Grund

Der Text verschwindet seit diesem Tag, sobald jemand einmal über Level 5
hinaus gespielt hat (`funkloch.hilfe`, beide Spielarten, dauerhaft). Nicht
wegen der Knoten — die Messung oben gilt weiter, die Breite begrenzt —,
sondern weil er dann gelesen ist. Der Platz geht an die Bühne, als Luft
oben und unten.

Gemessen mit dem Smoke-Test, mit Datenschutz-Link und Standzeile an Ort und
Stelle (die Standzeile fehlt in der Tabelle von `stage-gain.js`, dort ist
die Bühne 28 px höher):

```
Bildschirm   Bühne mit Hilfetext   ohne Hilfetext   Höhe/Breite vorher → nachher
360 × 640    360 × 356             360 × 403        0.99 → 1.12
320 × 568    320 × 320             320 × 331        1.00 → 1.03
```

Die Bühne ist damit wieder höher als breit, aber nur knapp. Die Drehung
(Eintrag „Die Breite ausnutzen") greift wieder; `stage-gain.js --width`,
Variante „alles", gegen den heutigen Stand ohne Seitenrand: **+10 %** bei
360 × 640 (34 bis 60 Knoten, 431 px Bühne ohne Standzeile, mit Standzeile
weniger), **+7 bis 8 %** bei 320 × 568, +10 % bei 390 × 844 wie zuvor. Die
20 % aus der alten Tabelle waren gegen den Stand *mit* Seitenrand gerechnet;
die eine Hälfte davon ist seit dem Randwegfall längst realisiert.

**Die Drehung ist damit endgültig erledigt.** 7 bis 10 % rechtfertigen den
Umbau an der Trefferauflösung (`locate` in `input.js`, siehe „Was bei der
Drehung bräche") nicht. Sie wird nicht erneut vorgeschlagen, solange sich
die Bedingungen nicht ändern: andere Bühnenmaße, hochformatige Bretter aus
dem Generator, oder eine Trefferauflösung, die ohnehin auf gezeichneten
Koordinaten rechnet.

---

## 2026-11-10 — Die Breite ausnutzen: Seitenrand weg, Drehung nicht

**Werkzeug:** `tools/stage-gain.js --width` (Variante des vorigen Eintrags)
**Ergebnis: Der Seitenrand der Bühne ist weg** (`#stage { margin: 0 -16px }`),
9 bis 11 % mehr Knotenradius auf dem Telefon ohne Risiko. **Die Drehung ist
nicht eingebaut**: 5 bis 6 % auf den kleinen Telefonen, mit Umbau an der
Trefferauflösung, und zusammen mit dem Rand greift ihre Bedingung ohnehin
nicht mehr. Nebenbei repariert: `fitHitAreas` nahm nur die Breite als
Maßstab.

### Die Frage

Der vorige Eintrag zeigte, dass auf dem Telefon die Breite den Maßstab
begrenzt, nicht die Höhe. Oben und unten ist Luft, links und rechts sitzt das
Brett an der Kante der Bühne — und die Bühne hat, wie die ganze Seite, 16 px
Rand je Seite. Zwei Hebel, beide ohne Änderung am Generator und ohne dass
sich gespeicherte Bretter ändern:

1. Den Seitenrand der Bühne aufgeben; Kopfzeile, Hilfetext und
   Datenschutz-Link behalten ihren.
2. Das Brett beim Einpassen um 90° drehen, wenn es breiter als hoch ist und
   die Bühne höher als breit; derselbe Graph, nur die Darstellung.

Dazu beides zusammen, und als fünfter Fall beides plus den ausgeblendeten
Hilfetext aus dem vorigen Eintrag.

### Gemessen

Sechs Bretter je Größe, in die Bühne gezeichnet, Radius eines gewöhnlichen
Knotens auf dem Schirm; „Luft" ist der freie Streifen je Seite zwischen
viewBox und Bühnenrand. Die Drehung für die Messung über ein `<g transform>`
mit getauschter viewBox — zum Messen des Radius genügt das, als Umsetzung
wäre es der Weg, der die Trefferauflösung bricht (unten).

```
360 × 640 (Bühne 328×356, ohne Rand 360×356, ohne Rand und Hilfetext 360×431)
Knoten  Variante                 Radius    Gewinn   Luft oben/unten  links/rechts  gedreht
    22  heute                    7.80 px             37 px            0 px
    22  ohne Rand                8.39 px   +7.6 %    26 px            4 px
    22  gedreht                  8.15 px   +4.5 %     4 px           21 px         4/6
    22  beides                   8.39 px   +7.6 %    26 px            4 px         0/6
    22  beides, ohne Hilfetext   9.46 px  +21.3 %    14 px           15 px         4/6
    60  heute                    5.03 px             28 px            0 px
    60  ohne Rand                5.51 px   +9.5 %    14 px            0 px
    60  gedreht                  5.28 px   +4.9 %     6 px            7 px         5/6
    60  beides                   5.51 px   +9.5 %    14 px            0 px         0/6
    60  beides, ohne Hilfetext   6.08 px  +20.7 %    18 px            0 px         5/6

320 × 568 (Bühne 288×320, ohne Rand 320×320, ohne Rand und Hilfetext 320×359)
    60  heute                    4.42 px             28 px            0 px
    60  ohne Rand                4.91 px  +11.0 %    14 px            0 px
    60  gedreht                  4.69 px   +6.2 %     7 px            5 px         5/6
    60  beides                   4.91 px  +11.0 %    14 px            0 px         0/6
    60  beides, ohne Hilfetext   5.24 px  +18.6 %     9 px            4 px         5/6

390 × 844 (Bühne 358×560, ohne Rand 390×560, ohne Rand und Hilfetext 390×635)
    22  heute                    8.54 px            125 px            0 px
    22  ohne Rand                9.30 px   +8.9 %   111 px            0 px
    22  gedreht                 10.46 px  +22.5 %    58 px            0 px         4/6
    22  beides                  11.36 px  +33.1 %    39 px            1 px         4/6
    60  heute                    5.49 px            116 px            0 px
    60  ohne Rand                5.99 px   +8.9 %   101 px            0 px
    60  gedreht                  6.04 px  +10.0 %    83 px            0 px         5/6
    60  beides                   6.58 px  +19.8 %    66 px            0 px         5/6
    60  beides, ohne Hilfetext   6.58 px  +19.8 %   103 px            0 px         5/6
```

34 und 46 Knoten liegen jeweils innerhalb von 0.3 Prozentpunkten bei 60.
„gedreht" zählt, wie viele der sechs Bretter die Drehbedingung erfüllten;
ein 22er-Brett von sechs war schon hochformatig.

Die Tabelle ist vom Stand *vor* dem Einbau. Das Werkzeug misst „heute" an
der Seite, wie sie ausgeliefert wird; seit der Rand weg ist, steht dort
dasselbe wie unter „ohne Rand" (5.51 px bei 360 × 640), und „gedreht" greift
auf den kleinen Telefonen nicht mehr (0 von 6).

**Trefferflächen nach dem Randwegfall:** auf dem dichtesten Brett des
Smoke-Laufs (42 Knoten, Level 7) misst die kleinste Trefferfläche bei
360 × 640 und bei 320 × 568 je **44.0 px**. Die Knoten sind größer geworden,
die Abstände dieselben, die Trefferflächen unverändert am Minimum.

### Was die Zahlen sagen

- **Der Seitenrand allein bringt 9 bis 11 %** auf den kleinen Telefonen,
  9 % auf dem großen. Kein Umbau, kein Risiko.
- **Die Drehung allein bringt auf den kleinen Telefonen 5 bis 6 %.** Die
  Bühne ist dort mit 0.92 fast quadratisch, ein gedrehtes Brett (1.10 → 0.91)
  hat fast dieselbe Form; danach begrenzt die Höhe. Nur auf dem hohen Telefon
  (Bühne 0.64) zahlt sie sich aus: 10 %, beim 22er-Brett 22 %.
- **„Beides" ist auf den kleinen Telefonen dasselbe wie „ohne Rand".** Ohne
  Seitenrand ist die Bühne 360 × 356 bzw. 320 × 320, nicht mehr höher als
  breit, und die Drehbedingung greift nicht. Erst der ausgeblendete Hilfetext
  macht sie wieder hochformatig (360 × 431); dann greift die Drehung, und alle
  drei Hebel zusammen bringen rund 20 %.

### Was bei der Drehung bräche

Festgehalten für den Fall, dass sich die Bedingungen ändern — etwa wenn der
Hilfetext doch geht, oder hohe Telefone wichtiger werden:

- **Trefferauflösung über Nähe.** `locate` in `input.js` rechnet den Zeiger
  über die CTM des SVG-Wurzelelements zurück und sucht den nächsten Knoten in
  den Graph-Koordinaten (`scene.board.graph.nodes`). Eine Drehung über ein
  `<g transform>` wäre für diese Rechnung unsichtbar; Tipps gingen an falsche
  Knoten. Die Drehung müsste in `render.js` auf gezeichneten Koordinaten
  liegen, und die Nähe-Suche müsste dieselben benutzen; der Graph bliebe
  unangetastet. Die Druckproben im Smoke-Test („0 von 48 am falschen Knoten")
  fingen einen Fehler hier.
- **Trefferflächen.** Nach der Drehung begrenzt auf den kleinen Telefonen die
  Höhe; `fitHitAreas` mit Breite allein hätte die 44 px verfehlt. Das ist
  jetzt repariert, unabhängig von der Drehung.
- **Nicht betroffen:** die Signalanimation (Verzögerung nach Hops, ohne
  Geometrie), die Endkarte (HTML über der Bühne) und das Nachspielen eines
  gespeicherten Tagesversuchs (`place`/`advance` über Knoten-IDs, bevor
  gezeichnet wird).

### `fitHitAreas`: der Maßstab ist das Minimum

`fitHitAreas` rechnete den Maßstab aus Bühnenbreite zu viewBox-Breite. Das
stimmt, solange die Breite begrenzt — auf dem Telefon bisher immer, deshalb
fiel es nicht auf. Auf einer Bühne, die über die Höhe begrenzt, wären die
Trefferflächen kleiner als 44 px gewesen, auf einer dreimal zu breiten Bühne
ein Drittel. Jetzt ist der Maßstab `min(Breite/vbBreite, Höhe/vbHöhe)`, so wie
`preserveAspectRatio` zeichnet; `test/render.test.js` prüft beide Seiten.

### Befund

**Seitenrand weg, Drehung nicht.** 9 bis 11 % ohne Risiko gegen 5 bis 6 %
mit Umbau an zwei Stellen, und zusammen mit dem Rand hat die Drehung keinen
Fall mehr. Die Drehung bleibt als Hebel dokumentiert.

Nachtrag vom selben Tag: Seit der Hilfetext ab Level 6 weg ist, greift die
Drehbedingung wieder, der Gewinn gegen den heutigen Stand liegt aber bei 7
bis 10 %. Damit ist die Drehung endgültig erledigt; die Zahlen stehen im
Nachtrag zum Eintrag „Hilfetext ab Level 5 ausblenden".

### Reproduktion

```sh
node tools/stage-gain.js --width   # Rand, Drehung, beides, alles; drei Bildschirme
npm run smoke                      # Kanten, Ränder, kleinste Trefferfläche
```

### Was blieb

- `index.html` — `#stage { margin: 0 -16px }`.
- `src/render.js` — `fitHitAreas` nimmt das Minimum beider Verhältnisse;
  `createScene` gibt `viewBox.height` mit.
- `test/render.test.js` — Trefferflächen auf breiten- und höhenbegrenzter
  Bühne, nie kleiner als der Ring, unberührt vor dem Layout.
- `tools/ui-smoke.js` — bei 360 und 320 px: Bühne von Kante zu Kante,
  Kopfzeile/Hilfetext/Datenschutz-Link bei 16 px, kleinste Trefferfläche
  ≥ 44 px auf dem dichtesten Brett.
- `tools/stage-gain.js` — `--width` misst die fünf Varianten.

---

## 2026-11-10 — Blockadendichte gegen den Rollout-Bot, auf der Tageskurve

**Konstante:** `ENDLESS_RUN.blockedRatio` in `src/run.js` (0.05, von `DAILY_RUN`
geerbt)
**Werkzeug:** `tools/plateau.js --compose=daily --bots=greedy,rollout --blocked=…`
**Ergebnis:** Vergleichsmessung, Konstante unverändert. Blockaden treffen den
guten Spieler **nicht** stärker als den schwachen, wenn man die Partielänge
ansieht — das Verhältnis zwischen den Bots hält oder wächst mit der Dichte.
Wo sie den guten Spieler treffen, ist die Durchlaufquote: 59 % → 47 % → 34 %
→ 19 % von 0 bis 0.15.

### Die Frage

Die 0.05 wurden gegen den Planer kalibriert („blockedRatio" im Kommentar in
`src/run.js`): Mit der Dichte fiel das Verhältnis Planer zu gierig von 2.47x
auf 1.78x, Blockaden trafen den planenden Bot härter, und die Dichte blieb so
niedrig, wie die Brettvariation es zuließ. Seit „Das Plateau" ist der Planer
kein Maßstab mehr, und das Tagesbrett hat eine andere Kurve: Ende nach 25,
Schwierigkeit über die Hand. Gilt der Befund noch, oder war er ein Effekt des
Planers oder der alten Kurve?

### Methode

Wie in „Das Plateau": jedes Level für sich, 500 Seeds je Brett, dieselben
Seeds für beide Bots, die Partie aus den Levelquoten zusammengesetzt.
`--blocked=` setzt die Dichte auf jedem Brett ab Level 2 (Level 1 hat keine
Blockaden). Gieriger Bot als der schwache Spieler, Rollout-Bot als der gute.
Klein gehalten: vier Dichten, zwei Bots, kein Löser.

### Partien auf der Tageskurve

```
Dichte   gierig                    Rollout                                   Rollout / gierig
         Median  Mittel  ≥10       Median  Mittel  Quartile  ≥10    ≥20    durch (≥25)   (Mittel)
0        5       5.3    10.0 %     durch   22.9    22–25    98.4 %  86.1 %  59.1 %       4.32x
0.05     4       4.8     6.1 %     24      21.8    20–25    96.8 %  77.6 %  47.0 %       4.54x
0.10     4       4.3     3.8 %     22      20.6    18–25    93.6 %  70.8 %  34.0 %       4.79x
0.15     4       3.9     1.8 %     20      18.5    15–23    89.3 %  51.8 %  19.0 %       4.74x
```

Gegen Dichte 0 verliert der gierige Bot im Mittel 9 / 19 / 26 % seiner
Partielänge, der Rollout-Bot 5 / 10 / 19 %. Der Rollout-Bot ist dabei nach
oben gedeckelt — bei 25 ist Schluss, und bei Dichte 0 spielt er 59 % der
Partien durch —, sein Verlust ist also eher unter- als überschätzt.

### Je Brett: wo die Dichte beißt

Scheiterquote je Level, die Stufen der Handleiter auf 60/9 und Level 7:

```
Brett        Dichte   gierig   Rollout       Brett        Dichte   gierig   Rollout
42/8  3/3/2  0        12.4 %    0.0 %        60/9  5/2/2  0        74.4 %    6.2 %
             0.05     16.0 %    0.0 %                     0.05     79.6 %    8.0 %
             0.10     20.4 %    0.2 %                     0.10     86.4 %   11.2 %
             0.15     25.8 %    0.4 %                     0.15     88.6 %   15.4 %
60/9  3/4/2  0        41.4 %    0.0 %        60/9  4/4/1  0        79.6 %    8.8 %
             0.05     47.8 %    0.2 %                     0.05     82.0 %   11.8 %
             0.10     55.4 %    0.8 %                     0.10     86.2 %   17.2 %
             0.15     62.2 %    2.0 %                     0.15     90.4 %   22.2 %
60/9  4/3/2  0        61.2 %    1.4 %        60/9  3/5/1  0        66.6 %    3.0 %
             0.05     67.0 %    2.4 %                     0.05     71.6 %    4.4 %
             0.10     69.2 %    3.6 %                     0.10     77.6 %    4.4 %
             0.15     75.6 %    5.6 %                     0.15     81.8 %    9.4 %
```

Zwei Lesarten, beide richtig:

- **In Prozentpunkten** trifft die Dichte den gierigen Bot härter: auf 60/9
  3/4/2 +21 Punkte (41 → 62 %), den Rollout-Bot +2 (0 → 2 %).
- **Relativ, wo der gute Spieler überhaupt scheitert**, wächst seine Quote
  schneller: auf 4/4/1 verdoppelt sie sich bis 0.10 (8.8 → 17.2 %) und
  verzweieinhalbfacht sich bis 0.15 (22.2 %), der gierige Bot legt dort noch
  14 % zu, weil er an der Decke ist. Auf den leichten Stufen bleibt der
  Rollout-Bot unter 2 %, Blockaden hin oder her: Dort gibt es für ihn nichts
  zu verlieren.

In der Partielänge wiegt die erste Lesart. Der gierige Bot verliert seine
Partien auf den leichten Stufen, und dort kostet ihn jede Blockade; der
Rollout-Bot verliert sie auf den schweren Stufen am Ende, und dort ist der
Zuwachs zwar relativ groß, aber die Partie fast vorbei.

### Gegenprobe: derselbe Bot auf der alten Kurve

War der alte Befund eine Eigenschaft des Planers oder der Kurve? Rollout-
und gieriger Bot auf `ENDLESS_RUN`, wie es bis zum Tagesbrett galt — endlos,
Plateau ab Level 12 bei 60/9 mit 3/4/2 —, Level 1–40 gemessen, danach die
Plateau-Quote fortgeschrieben. `--compose=shipped --upto=40`, 500 Seeds:

```
Dichte   gierig Mittel   Rollout                                        Rollout / gierig
                         Median   Mittel   ≥25      Plateau-Quote
0        4.7             ∞        ∞        89.2 %   0.0 %               ∞
0.05     4.4             271      430      81.8 %   0.2 %               98x
0.15     3.7             28       44.5     53.7 %   2.0 %               12x
```

(Je Brett 60/9 3/4/2: Rollout 0.0 → 0.2 → 2.0 %, gierig 41 → 48 → 62 % —
dieselben Bretter wie auf der Tageskurve, die Stufe ist dieselbe.)

Auf der alten Kurve bricht das Verhältnis mit der Dichte ein, mit dem
Rollout-Bot sogar weit stärker als damals mit dem Planer: 98x bei 0.05, 12x
bei 0.15. Der Mechanismus ist die endlose Partie: Die Plateau-Quote des guten
Spielers ist fast null, und jede Blockade verzehnfacht sie (0.2 → 2.0 %); über
hunderte Level multipliziert sich das zu einem Faktor 10 in der Partielänge.
Der gierige Bot stirbt lange vorher und merkt von der Dichte nur die ersten
Level.

**Der alte Befund war ein Effekt der alten Kurve, nicht des Planers.** Auf
der Tageskurve ist die Partie nach 25 Leveln zu Ende, und die Handleiter
bringt den guten Spieler auf den letzten Stufen ohnehin auf 6 bis 12 %
Scheiterquote; was die Dichte dort hinzufügt, ist klein gegen das, was die
Hand schon kostet. Darum hält das Verhältnis.

### Befund

**Auf der Tageskurve fällt das Verhältnis zwischen gutem und schwachem
Spieler mit der Dichte nicht mehr.** Es steigt von 4.32x auf 4.74x, mit einer
Decke, die den guten Spieler drückt. Auf der alten Endloskurve fiele es mit
jedem Bot, weil sich dort eine kleine Quote endlos aufmultipliziert; das
freie Spiel hat diese Kurve noch. Was Blockaden beim guten Spieler kosten, ist die
Durchlaufquote: 59 → 47 → 34 → 19 %. Für die Wahl der Dichte ist also nicht
mehr der Abstand der Bots die Frage, sondern wie viele gute Spieler den Tag
durchspielen sollen.

Bei 0.05 liegt die Durchlaufquote des Rollout-Bots bei 47 %; mit dem
Menschen-Faktor 1.7 bis 1.9 aus „Das Plateau" (ungeprüfte Annahme) war das
dort etwa jeder vierte gute Spieler — der Wert, auf den die Handleiter
abgestimmt wurde. Eine andere Dichte verschöbe diese Abstimmung mit.

**Konstante unverändert.** Die alte Begründung im Kommentar zu `blockedRatio`
(„trifft den planenden Bot härter") gilt für das Tagesbrett nicht mehr; der
Kommentar verweist hierher und behält die alte Tabelle als Protokoll der
damaligen Wahl.

### Reproduktion

```sh
node tools/plateau.js --compose=daily --bots=greedy,rollout --blocked=0.05 --seeds=500
node tools/plateau.js --compose=shipped --bots=greedy,rollout --blocked=0.05 --seeds=500 --upto=40
```

Je Dichte und Kurve 2 bis 4 Minuten; `--blocked` nimmt 0, 0.05, 0.1, 0.15.

### Was blieb

- `tools/plateau.js` — `--blocked=` setzt die Dichte ab Level 2; die
  Levelquoten werden je Dichte getrennt gehalten.
- `src/run.js` — der Kommentar zu `blockedRatio` nennt diese Messung vor der
  alten Tabelle. Der Wert bleibt 0.05.

---

## 2026-11-11 — Einstiegsbrett erlassen, Wortmarke gefüllt

**Konstanten:** `GAME_NAME_WON` in `src/share.js` (neu, `funkl●ch`);
`createRun({ onboarding: false })` in `src/run.js` (neu)
**Werkzeug:** `tools/share-forms.js --render` (Kopfzeile in beiden Formen)
**Ergebnis:** Wer über Level 5 hinaus gespielt hat, beginnt jede Partie auf
Level 2; Level 1 wird als geschafft gutgeschrieben. Die geteilte Zeile eines
durchgespielten Tags schreibt den Namen mit gefülltem Kreis.

### Die Zählung beim Erlassen

Zwei Wege standen zur Wahl: bei Level 2 beginnen und bei 25 enden (24
gespielte Bretter), oder alles um eins verschieben (25 gespielte, aber andere
als Anfänger). **Gewählt ist der erste, mit Gutschrift für Level 1.** Die
Levelnummer ist hier keine Zählung, sondern eine Adresse — Level i ist das
Brett aus `seed + i · 7919` — und zugleich das Punktegewicht seiner Reste.
Verschieben ließe „in Level 12 von 25" und „12 Punkte" bei zwei Spielern
desselben Tages zwei verschiedene Bretter meinen und gäbe Erfahrenen ein 26.
Brett; Rangliste und Zeile stünden auf zwei Maßstäben, und jede Kalibrierung
(8 Sender auf Level 7, Handleiter ab 12) wanderte mit.

Ohne Gutschrift hätte ein Erfahrener nach dem Durchspielen 24 geschaffte
Level, ein Anfänger 25 — dieselben zwei Maßstäbe, nur in `levelsCleared`. Die
Gutschrift kostet nichts, weil das Einstiegsbrett schon vorher keine Punkte
brachte und niemand es verliert: gierig scheitert in 5000 Seeds nie,
Zufallstippen in 0,3 % (Eintrag „Level 1 als Einstiegsbrett"). Ab Level 2 sind
die Bretter bitgleich, ob Level 1 gespielt wurde oder nicht; `test/run.test.js`
spielt beide Fassungen mit dem gierigen Bot und verlangt dasselbe Ende, dieselbe
Zählung, dieselben Punkte.

Neu gemessen wurde nichts: die Schwierigkeit der Partie ändert sich nicht,
nur die Zahl der Tipps bis zum ersten Brett, das etwas verlangt.

### Rendertest der gefüllten Wortmarke

Wie 2026-10-12, drei Schriften bei `letter-spacing: -1px`, dazu
`CSS.getPlatformFontsForNode` je Zeichen und die Breite der Wortmarke als
`Range.getBoundingClientRect()` über ihre acht Zeichen:

| Schrift | `○` und `●` gezeichnet aus | `funkl○ch` | `funkl●ch` |
| --- | --- | --- | --- |
| system-ui | Liberation Serif | 57,19 px | 57,19 px |
| Georgia, serif | Liberation Serif | 50,55 px | 50,55 px |
| monospace | DejaVu Sans Mono | 69,06 px | 69,06 px |

Beide Zeichen kommen in jeder Schrift aus derselben Schriftfamilie, beide
Wortmarken sind auf den Hundertstelpixel gleich breit, und der Kreis sitzt wie
der Ring auf Höhe der Kleinbuchstaben. **`●` hält.**

### Reproduktion

```sh
node tools/share-forms.js --render=formen.png --days=1   # Kopfzeile in beiden Formen
npm run smoke                                            # Start auf Level 2, Kippfall, Durchspielen ab 2
```

### Was blieb

- `src/run.js` — `createRun({ onboarding: false })` öffnet auf Level 2 mit
  `cleared: [{ level: 1, left: 0 }]`; der Zustand und `snapshot()` tragen
  `onboarding`.
- `index.html` — dieselbe Markierung wie der Hilfetext (`funkloch.hilfe`,
  jetzt `KNOWS_GAME_KEY`) erlässt das Einstiegsbrett. Der gespeicherte
  Tagesversuch hält in `onboarding` fest, wo er begann; der Nachbau folgt ihm
  und nicht der Markierung, die mitten im Tag kippen kann. Ein Versuch ohne
  Zug hat nicht begonnen.
- `src/share.js` — `GAME_NAME_WON`, genommen bei Status `won`.
- `test/run.test.js`, `test/share.test.js`, `tools/ui-smoke.js` — Gutschrift
  und Gleichstand der Zählung; Ring und Kreis; Start auf Level 2 mit
  Markierung, Durchspielen ab Level 2 mit Karte, Zeile und Rangliste auf 25,
  und der Kippfall mit Neuladen und Tageswechsel.
