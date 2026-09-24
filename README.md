# Funkloch

Ein Abdeckungspuzzle auf einem Graphen. Auf dem Brett liegen Knoten, verbunden
zu einem Netz; jeder Knoten ohne Signal ist ein **Funkloch**. Ein gesetzter
Sender versorgt alles, was über höchstens `k` Kanten von ihm aus erreichbar ist.
Ziel ist immer dasselbe: kein Funkloch mehr.

Achteckige Knoten sind undurchlässig — sie leuchten selbst, geben das Signal
aber nicht weiter. Sie ändern keine Regel, nur was eine Position wert ist.

Reine ES-Module, kein Build-Schritt, keine Laufzeit-Abhängigkeiten. Die
Spiellogik ist DOM-frei und deterministisch; der Browser bekommt sie über
`<script type="module">` direkt aus `src/`.

## Die Modi

**Rätsel** (`src/game.js`, Level in `levels/`) — 30 handverlesene Bretter mit
einem festen Senderbudget und *genau einer* Lösung. Kein Timer, keine Punkte,
kein Verlieren. Zwei Regelsätze: `cover` verlangt nur, dass jeder Knoten
versorgt ist, Überlappung eingeschlossen; `exact` (`levels/exact/`) verlangt
eine Partition — ein Knoten mit zwei Signalen ist ein Konflikt, kein Bonus.
Levels sind nach der höchsten Schlussregel sortiert, die sie erzwingen
(`src/tiers.js`), nicht nach Brettgröße.

**Depot-Lauf** (`DEFAULT_RUN` in `src/run.js`) — drei wachsende Etappen (18,
24, 30 Knoten) und ein Depot voller Sender mit Radius 1, 2 oder 3. Man zieht den
vordersten, sieht die nächsten zwei, setzt ihn. Wer ein Brett räumt, bevor das
Depot leer ist, behält den Rest als Punkte. Gesetzt ist gesetzt: ein Sender
lässt sich nicht wieder abnehmen. Das Abnehmen gab es einmal — es kostete die
Karte und gab nur den Knoten zurück —, und es ist gemessen wieder verschwunden:
der planende Bot griff in 5,7 % der Partien danach und gewann 0,5 Prozentpunkte
damit, zu wenig für die klarste Regel des Spiels.

**Endlos** (`ENDLESS_RUN` in `src/run.js`) — dasselbe ohne letzte Etappe. Das
Brett wächst (18 → 60 Knoten), das Depot schrumpft relativ dazu (0,24 → 0,15
des Knotenzählers entlang einer Exponentialkurve). Das ist der Modus, den
`index.html` spielt.

Bestwert sind die **Punkte**, und nur sie. Die Etappe ist Standanzeige ohne
eigenen Rekord: zwei Bestwerte ließen offen, welcher zählt, und von den beiden
misst der Punktestand mehr. Er steigt mit der Etappe ohnehin, und zwischen zwei
Läufen, die auf demselben Brett gestorben sind, unterscheidet er noch den, der
seine Etappen mit Sendern übrig geräumt hat, von dem, der sich durchgequält hat.

## Tagesbrett

Derselbe Endlosmodus, nur steht der Startseed fest: er wird aus dem Datum
abgeleitet, alle spielen am selben Tag dasselbe Brett, und es gibt einen Versuch
pro Tag. Danach zeigt das Spiel das Ergebnis und die Zeit bis zum nächsten
Brett, statt eine neue Partie anzubieten. Ein Knopf legt eine Ergebniszeile in
die Zwischenablage — `funkloch 24.09. — Etappe 11, 7 Punkte` —, die das Brett
nicht verrät. Umgeschaltet wird in der Kopfzeile.

Der Tag wird **in UTC** gerechnet (`utcDay` in `src/run.js`), nicht in der
lokalen Zone. Das ist der ganze Punkt: mit einer lokalen Datumsgrenze hätte
Neuseeland das Brett von morgen, während Kalifornien noch auf dem von gestern
sitzt, und zwei Ergebnisse wären nicht vergleichbar.

Der Versuch liegt in `localStorage`, und zwar als vollständige Zugfolge, nicht
nur als Endstand. Das erledigt beide Hälften von „ein Versuch pro Tag" auf
einmal: ein Neuladen spielt den Versuch dorthin zurück, wo er war — ein
Versehen kostet also nichts —, und es gibt keinen Moment, in dem die Seite ein
ungespieltes Brett zurückgeben könnte, ein absichtliches Neuladen bringt also
auch nichts.

## Lokal starten

```sh
npm run serve      # http://127.0.0.1:8000/
```

Der Dev-Server existiert aus einem Grund: er schickt `Cache-Control: no-store`.
Ein `python3 -m http.server` lässt den Browser ES-Module heuristisch cachen,
und ein frisches `index.html` gegen ein veraltetes Modul rendert eine leere
Seite ohne sichtbaren Fehler.

`index.html` direkt aus dem Dateisystem zu öffnen funktioniert nicht — die
ES-Module brauchen `http://`.

Mit `?seed=7` wird ein bestimmter Lauf gespielt; derselbe Seed gibt immer
dieselben Bretter und dasselbe Depot.

## Tests

```sh
npm test           # node --test, ~15 s, keine Abhängigkeiten
```

Deckt Graph, Generator, Solver, Schlussregeln, Spielzustand, Lauf und Renderer
ab. Die Tests laufen ohne Browser und ohne Netz.

## Smoke-Test

```sh
npm run smoke      # spielt einen ganzen Lauf im echten Chromium
```

Die Unit-Tests können sagen, dass `run.js` richtig zählt und der Renderer
zeichnet, was man ihm sagt. Nur der Smoke-Test sagt, dass die Seite beides
verbindet: dass ein Klick auf dem richtigen Knoten landet, dass die Statuszeile
zählt, was der Zustand zählt, dass der Rekord einen Reload überlebt und dass
die Endkarte überhaupt erscheint. Die Züge werden vorher vom Planungs-Bot
gespielt, die erwarteten Zahlen stehen also fest, bevor der Browser aufgeht.

Braucht die playwright-devDependency und einen Browser:

```sh
npm install && npx playwright install --with-deps chromium
```

Wo die Systembibliotheken nicht installierbar sind, hilft eine lokale Kopie:

```sh
LD_LIBRARY_PATH=~/.local/browser-libs/root/usr/lib64 npm run smoke
```

## Weitere Werkzeuge

| Befehl | Zweck |
| --- | --- |
| `npm run levels` | baut `levels/` neu — aus demselben Seed byte-identisch |
| `npm run preview` | Screenshots und Rendering-Prüfungen im Browser |
| `node tools/make-icons.js` | rastert `favicon.svg` zu den App-Icons |
| `node tools/endless.js --runs=1000` | wie weit die Bots im Endlosmodus kommen |
| `node tools/blocked.js --bots` | was undurchlässige Knoten mit einem Brett machen |
| `node tools/density.js` | was die Kantendichte mit Brettform und Bots macht |

Was mit diesen Werkzeugen gemessen und daraufhin entschieden wurde — auch das,
was gemessen und *nicht* geändert wurde — steht in [MESSUNGEN.md](MESSUNGEN.md).

## Deployment

Statisch, ohne Build-Schritt: `vercel.json` setzt Framework auf „Other", leert
Build- und Install-Befehl und liefert den Projektordner direkt aus. Alle Pfade
in `index.html` und den Modulen sind relativ, das Spiel läuft also auch unter
einem Unterpfad.
