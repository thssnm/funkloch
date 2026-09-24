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

## Die drei Modi

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
Depot leer ist, behält den Rest als Punkte. Ein gesetzter Sender lässt sich
wieder abnehmen, wandert aber nicht zurück ins Depot — die Karte ist so
oder so verbraucht. Was das Abnehmen kauft, ist der *Knoten*.

**Endlos** (`ENDLESS_RUN` in `src/run.js`) — dasselbe ohne letzte Etappe. Das
Brett wächst (18 → 60 Knoten), das Depot schrumpft relativ dazu (0,24 → 0,15
des Knotenzählers entlang einer Exponentialkurve). Bestwert für Etappe und
Punkte liegt in `localStorage`. Das ist der Modus, den `index.html` spielt.

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

## Deployment

Statisch, ohne Build-Schritt: `vercel.json` setzt Framework auf „Other", leert
Build- und Install-Befehl und liefert den Projektordner direkt aus. Alle Pfade
in `index.html` und den Modulen sind relativ, das Spiel läuft also auch unter
einem Unterpfad.
