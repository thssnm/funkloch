# Konventionen

Regeln, die sich in diesem Projekt bewährt haben. Sie sind kein Stilgeschmack —
jede steht hier, weil ihre Verletzung schon einmal etwas kaputtgemacht hat, das
niemand sofort gesehen hat.

## Spiellogik bleibt rein und DOM-frei

`src/game.js`, `src/run.js`, `src/graph.js`, `src/solver.js`, `src/tiers*.js`,
`src/share.js` und `src/generator.js` kennen kein `document`, kein `window`, keine Timer und
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
kommt im Quelltext nicht vor und soll auch nicht dazukommen — auch nicht in
`index.html`. Die Oberfläche ist keine Ausnahme: braucht sie einen frischen
Seed, liest sie die Uhr und lässt `run.js` daraus einen machen (`freeSeed`,
`dailySeed`), gehasht und nie der rohe Zeitstempel, weil ein Level aus
`seed + level · 7919` gezogen wird. `test/no-math-random.test.js` sucht den
Aufruf in `index.html`, `src/`, `tools/` und `test/`.

Im Lauf wird alles aus `(seed, level)` abgeleitet, damit kein RNG-Zustand
mitgeschleppt werden muss: das Brett hängt dann nicht davon ab, wie gespielt
wurde, und ein Lauf ist reproduzierbar, vergleichbar und aus einer URL heraus
wiederherstellbar (`?seed=7`).

## `level` heißt zweierlei — die Renderschicht sagt `board`

`level` als **Zahl** gibt es nur im Lauf (`src/run.js`, `index.html`, die
Bot-Werkzeuge): das Brett, das gerade gespielt wird, `state.level`, mit
`levelSpec`, `levelCleared`, `levelsCleared`. `level` als **Objekt** gibt es nur
im Rätselmodus (`src/game.js`, Generator, Tiers, `tools/build-*-levels.js`,
`levels/*.json`): ein gespeichertes Rätsel mit `graph`, `count`, `k`.

`src/render.js` dient beiden und sagt deshalb weder das eine noch das andere:
`createScene(board)`, `scene.board`. Sonst stünde in `index.html` `state.level`
(eine Zahl) neben `scene.level` (ein Brett), und der nächste, der eins davon
anfasst, verwechselt sie. Wer im Rätselmodus etwas umbenennt, lässt den Lauf in
Ruhe, und umgekehrt — eine Umbenennung, die die Level-Dateien verschiebt, hat
die falsche Hälfte erwischt.

`#stage` in `index.html` ist die Bühne, der Container des Bretts, und hat mit
keinem der beiden zu tun.

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

Jede Zahl, die aus einer Messung stammt — `senderRatio`, `senderCurve`,
`blockedRatio`, `composition`, die Parameterfenster in `tools/build-levels.js` —
steht mit den Alternativen im Kommentar, gegen die sie gewonnen hat, samt
Stichprobengröße. Siehe `ENDLESS_RUN.blockedRatio` in `src/run.js` als Vorbild:
fünf Dichten, je 500 Läufe, mit dem Verhältnis der Bots und der Streuung.

Wer die Zahl später anfasst, muss sehen können, was sie ersetzt — und was es
gekostet hat. Wird neu gemessen, kommt die neue Tabelle dazu, die alte bleibt
mit dem Hinweis stehen, unter welchen Bedingungen sie galt.

Eine solche Bedingung ist die Zählung: bis 2026-10-12 zählten die Werkzeuge das
*erreichte* Level, seitdem das *geschaffte*, wie das Spiel. Die Mittel fallen
dadurch um 1, die Bot-Verhältnisse steigen ungleichmäßig (2.24x erreicht sind
2.54x geschafft). Alte Tabellen tragen das als Vermerk; Zahlen aus zwei
Zählungen werden nicht miteinander verglichen.

## Messen vor Implementieren

Design-Parameter werden nicht geschätzt. Senderzahl, Sendermischung,
Blockadedichte, Levelwachstum, Schwierigkeitsfenster — dafür gibt es die
Werkzeuge in `tools/`, und sie laufen *vor* der Entscheidung:

```sh
node tools/endless.js --runs=1000        # Streak-Verteilung, beide Bots
node tools/endless.js --curves           # Sweep über Senderkurven
node tools/blocked.js --bots --runs=400  # Blockadedichte gegen beide Bots
```

Gemessen wird gegen den **planenden** Bot (`lookaheadChoice`), nicht nur gegen
den gierigen: ein Mensch sieht die nächsten zwei Sender und benutzt sie. Wer
gegen einen Bot kalibriert, der die Vorschau ignoriert, stellt die
Schwierigkeit für einen Spieler ein, den es nicht gibt.

Zwei Dinge sind dabei interessanter als der Mittelwert: die **Streuung** — ein
Modus, in dem jeder Lauf im selben Level stirbt, hat eine Wand, keine
Schwierigkeit — und der **Abstand zwischen den Bots**, denn der ist es, was
Vorausdenken belohnt.

## Dateien schreiben: Edit und Write, keine Heredocs

Dateien werden über die Werkzeuge `Edit` und `Write` geschrieben, nicht über
`cat > datei <<'EOF'` oder `sed -i` im Shell-Aufruf.

Der Grund ist nicht Geschmack. Ein Heredoc geht durch die Shell, und die Shell
interpretiert: nicht quotiertes `EOF` ersetzt `$foo` und `` `cmd` `` im Text,
ein Backslash verschwindet, ein `EOF` am Zeilenanfang im Inhalt beendet den
Block zu früh. In diesem Projekt trifft das genau die falschen Stellen — SVG-
und Template-Literale in `render.js`, reguläre Ausdrücke, die Kommentare mit
Messtabellen. Ein `>` statt `>>` ist außerdem lautlos: die Datei ist weg, bevor
irgendjemand den Fehler sieht.

`Edit` verlangt, dass die alte Stelle exakt und eindeutig passt, und schlägt
sonst fehl, statt danebenzuschreiben. `Write` überschreibt nur eine Datei, die
vorher gelesen wurde. Beides ist ein Diff, den man vorher sieht — und das ist
bei `levels/` bares Geld wert, wo Byte-Identität ein Test ist.

Für die Shell bleibt, wofür sie da ist: lesen, suchen, Tests und Werkzeuge
starten (`cat`, `sed -n`, `grep`, `node tools/…`, `npm test`).

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
