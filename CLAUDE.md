# Konventionen

Regeln, die sich in diesem Projekt bewährt haben. Sie sind kein Stilgeschmack —
jede steht hier, weil ihre Verletzung schon einmal etwas kaputtgemacht hat, das
niemand sofort gesehen hat.

## Spiellogik bleibt rein und DOM-frei

`src/game.js`, `src/run.js`, `src/graph.js`, `src/solver.js`, `src/tiers*.js`
und `src/generator.js` kennen kein `document`, kein `window`, keine Timer und
keinen `localStorage`. Jede Aktion gibt einen neuen, eingefrorenen Zustand
zurück, dessen `toJSON()` ein einfaches, serialisierbares Abbild liefert.

Nur `src/render.js` und `src/input.js` fassen das DOM an, und `index.html`
verdrahtet beides. Das ist die Grenze, die den Bot tausende Läufe in Node
spielen lässt und die Tests ohne Browser auskommen lässt.

Neue Spielregeln gehören in die reine Hälfte, auch wenn es sich im Renderer
gerade kürzer anfühlt.

## `coverage()` ist die einzige Quelle der Wahrheit

Wer versorgt ist, sagt `coverage()` in `src/graph.js` — nirgends sonst. Weder
das Spiel noch der Generator noch der Solver noch der Renderer rechnet
Abdeckung selbst nach. Auch nicht „nur schnell für die Anzeige": eine zweite
Implementierung driftet, und dann zeigt das Brett etwas anderes an, als die
Gewinnprüfung sieht.

Dasselbe gilt für die Reichweite: `bfsWithin` bzw. `bfsWithinBlocked` für
Bretter mit undurchlässigen Knoten.

## Seedbarer PRNG statt `Math.random`

Alles Zufällige läuft über `mulberry32(seed)` aus `src/generator.js`. `Math.random`
kommt im Quelltext nicht vor und soll auch nicht dazukommen.

Im Lauf wird alles aus `(seed, stage)` abgeleitet, damit kein RNG-Zustand
mitgeschleppt werden muss: das Brett hängt dann nicht davon ab, wie gespielt
wurde, und ein Lauf ist reproduzierbar, vergleichbar und aus einer URL heraus
wiederherstellbar (`?seed=7`).

## Byte-Identität der Level-Sets ist ein Regressionstest

`npm run levels` baut aus demselben Basis-Seed byte-identische Dateien.
`test/generator.test.js` prüft das direkt („is byte-for-byte reproducible from
the seed"), und `test/tiers-exact.test.js` läuft über das gebaute Set.

Wenn eine Änderung an Generator, Delaunay-Triangulation, Solver oder
Schlussregeln die Dateien in `levels/` verschiebt, ist das ein Befund, kein
Rauschen: entweder war die Änderung unbeabsichtigt, oder die Levels müssen
bewusst neu gebaut und das Ergebnis geprüft werden. Nie einfach neu bauen, um
den Test grün zu bekommen.

Koordinaten müssen einen JSON-Rundlauf unverändert überstehen, sonst driften
gespeicherte Levels.

## Invarianten melden, nicht Regeln nachziehen

Wenn eine Invariante verletzt scheint — ein Level ohne eindeutige Lösung, eine
Schlussregel, die einen Kandidaten streicht, den die Lösung braucht, ein
Zustand, der nicht gewinnbar ist — dann ist das zu **melden**, nicht durch
Lockern der Regel zu beheben.

Die Tests sind so gebaut: „tier 2 never strikes a candidate the solution needs"
läuft über jedes gebaute Level und über 100 frisch erzeugte. Eine Regel
aufzuweichen, damit dieser Test durchgeht, macht genau die Aussage kaputt, für
die er existiert.

## Kalibrierungskonstanten tragen ihre Messung im Kommentar

Jede Zahl, die aus einer Messung stammt — `depotRatio`, `depotCurve`,
`blockedRatio`, `composition`, die Parameterfenster in `tools/build-levels.js` —
steht mit den Alternativen im Kommentar, gegen die sie gewonnen hat, samt
Stichprobengröße. Siehe `ENDLESS_RUN.blockedRatio` in `src/run.js` als Vorbild:
fünf Dichten, je 500 Läufe, mit dem Verhältnis der Bots und der Streuung.

Wer die Zahl später anfasst, muss sehen können, was sie ersetzt — und was es
gekostet hat. Wird neu gemessen, kommt die neue Tabelle dazu, die alte bleibt
mit dem Hinweis stehen, unter welchen Bedingungen sie galt.

## Messen vor Implementieren

Design-Parameter werden nicht geschätzt. Depotgröße, Sendermischung,
Blockadedichte, Etappenwachstum, Schwierigkeitsfenster — dafür gibt es die
Werkzeuge in `tools/`, und sie laufen *vor* der Entscheidung:

```sh
node tools/endless.js --runs=1000        # Streak-Verteilung, beide Bots
node tools/endless.js --curves           # Sweep über Depotkurven
node tools/blocked.js --bots --runs=400  # Blockadedichte gegen beide Bots
```

Gemessen wird gegen den **planenden** Bot (`lookaheadChoice`), nicht nur gegen
den gierigen: ein Mensch sieht die nächsten zwei Sender und benutzt sie. Wer
gegen einen Bot kalibriert, der die Vorschau ignoriert, stellt die
Schwierigkeit für einen Spieler ein, den es nicht gibt.

Zwei Dinge sind dabei interessanter als der Mittelwert: die **Streuung** — ein
Modus, in dem jeder Lauf an derselben Etappe stirbt, hat eine Wand, keine
Schwierigkeit — und der **Abstand zwischen den Bots**, denn der ist es, was
Vorausdenken belohnt.

## Kleinkram

- Kommentare im Quelltext auf Englisch, Oberfläche und Werkzeug-Ausgabe auf
  Deutsch. So ist es gewachsen.
- Kein Build-Schritt, keine Laufzeit-Abhängigkeiten. `playwright` ist
  devDependency und nur für `tools/preview.js` und `tools/ui-smoke.js`.
- Nach Änderungen an `index.html`, `render.js` oder `input.js`: `npm run smoke`.
  Element-IDs sind die Nahtstelle zwischen Seite und Test.
- `.node`, `.edge` und `.dot` gehören dem Brett. Anderes SVG auf der Seite —
  Marke, Icons — braucht eigene Klassennamen (`.mark-node`, `.mark-edge`), sonst
  antwortet es auf jeden Selektor, der einen Knoten meint, und `.node`
  zählt plötzlich 19 statt 18.
- Die App-Icons sind abgeleitet, nicht gezeichnet: `favicon.svg` ist die Quelle,
  `tools/make-icons.js` rastert sie. Wer ein PNG von Hand ändert, gabelt das
  Icon in vier leicht verschiedene Zeichnungen.
