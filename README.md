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

Gespielt wird ohne Server. Zwei Dinge reden trotzdem mit einem: der Stand
unter dem Hilfetext (`api/version.js`, eine Vercel Function neben der Seite)
und die tägliche Rangliste, die der Browser direkt bei PocketBase unter
`https://api.thssn.dev` abfragt — nur wenn man sie öffnet oder sich einträgt.

## Die Modi

**Rätsel** (`src/game.js`, Level in `levels/`) — 30 handverlesene Bretter mit
einem festen Senderbudget und *genau einer* Lösung. Kein Timer, keine Punkte,
kein Verlieren. Zwei Regelsätze: `cover` verlangt nur, dass jeder Knoten
versorgt ist, Überlappung eingeschlossen; `exact` (`levels/exact/`) verlangt
eine Partition — ein Knoten mit zwei Signalen ist ein Konflikt, kein Bonus.
Levels sind nach der höchsten Schlussregel sortiert, die sie erzwingen
(`src/tiers.js`), nicht nach Brettgröße.

**Sender-Lauf** (`DEFAULT_RUN` in `src/run.js`) — drei wachsende Level (18,
24, 30 Knoten) und je Level ein Stapel Sender mit Radius 1, 2 oder 3. Man zieht
den vordersten, sieht die nächsten zwei, setzt ihn. Wer ein Brett räumt, bevor
die Sender ausgehen, behält den Rest als Punkte. Gesetzt ist gesetzt: ein Sender
lässt sich nicht wieder abnehmen. Das Abnehmen gab es einmal — es kostete die
Karte und gab nur den Knoten zurück —, und es ist gemessen wieder verschwunden:
der planende Bot griff in 5,7 % der Partien danach und gewann 0,5 Prozentpunkte
damit, zu wenig für die klarste Regel des Spiels.

**Endlos** (`ENDLESS_RUN` in `src/run.js`) — dasselbe ohne letztes Level. Das
Brett wächst (22 → 60 Knoten ab Level 2), die Senderzahl schrumpft relativ dazu
(0,22 → 0,15 des Knotenzählers entlang einer Exponentialkurve). Das ist der
Modus, den `index.html` spielt.

Level 1 ist das Einstiegsbrett und gehört nicht zur Kurve: 9 Knoten, 6 Sender,
keine Achtecke. Es erklärt die Regel, indem man es gewinnt — Antippen setzt,
das Signal breitet sich aus, alles muss versorgt sein —, und es ist so
ausgelegt, dass auch der gierige Bot es nie verliert. Weil es so großzügig ist,
bringen seine Reste keine Punkte; es zählt aber als geschafft.

Bestwert sind die **Punkte**, und nur sie. Das Level ist Standanzeige ohne
eigenen Rekord: zwei Bestwerte ließen offen, welcher zählt, und von den beiden
misst der Punktestand mehr. Er steigt mit dem Level ohnehin, und zwischen zwei
Läufen, die auf demselben Brett gestorben sind, unterscheidet er noch den, der
seine Level mit Sendern übrig geräumt hat, von dem, der sich durchgequält hat.

Während der Partie zeigt die Kopfzeile das Level, das gerade gespielt wird.
Kopfzeile, Endkarte und Ergebniszeile nennen dasselbe Level: das, in dem die
Partie endete. Wer in Level 10 scheitert, liest überall Level 10. Die
Werkzeuge zählen dagegen das letzte **geschaffte**, dort sind es 9.

## Tagesbrett

Der Startseed steht fest: er wird aus dem Datum abgeleitet, alle spielen am
selben Tag dasselbe Brett, und es gibt einen Versuch pro Tag. Danach zeigt das
Spiel das Ergebnis und die Zeit bis zum nächsten Brett, statt eine neue Partie
anzubieten. Umgeschaltet wird in der Kopfzeile.

Anders als das freie Spiel hat das Tagesbrett ein Ende (`DAILY_RUN` in
`src/run.js`): nach Level 25 ist es durchgespielt. Bis Level 11 folgt es der
Endloskurve, nur Level 7 hat einen Sender mehr; ab Level 12 bleibt das Brett
bei 60 Knoten und 9 Sendern, und alle drei Level wird die Hand eine Stufe
kleiner (3/4/2 → 4/3/2 → 3/5/1 → 5/2/2 → 4/4/1 Sender mit Reichweite 1/2/3).
Die Kopfzeile zeigt während der Partie das Ziel mit, „Level 12 von 25"; im
freien Spiel steht nur „Level 12". Wer durchspielt, sieht „Alle 25 Level
geschafft." und teilt „durchgespielt". Warum so, steht in `MESSUNGEN.md` unter
2026-11-10.

Die Seite öffnet immer auf dem Tagesbrett, egal was zuletzt gespielt wurde: ist
der Versuch offen, zum Spielen, ist er verbraucht, mit Ergebnis und Countdown.
Die Spielart wird nicht gespeichert. Ins freie Spiel geht es mit einem Tipp auf
„Frei" in der Kopfzeile; nur ein `?seed=` in der Adresse öffnet direkt eine
freie Partie.

„Ergebnis teilen" öffnet auf dem Handy die native Teilen-Auswahl (Web Share
API), sonst kopiert es in die Zwischenablage und sagt „Kopiert."; klappt auch
das nicht, steht der Text zum Markieren da. Geteilt wird das Ergebnis, gebaut
in `src/share.js`:

```
funkl○ch 06.10. — in Level 16 von 25 gescheitert, 77 Punkte
https://funkloch.thssn.dev
```

Ein verlorener Tag nennt das Level, in dem er endete, und das Ziel; ein
durchgespielter sagt es in Worten: `funkl○ch 06.10. — durchgespielt, alle 25
Level, 143 Punkte`. Die Endkarte nennt dasselbe Level wie Kopfzeile und Zeile.

Die zweite Zeile ist die Adresse des Spiels als Link (`GAME_URL` in `src/share.js`).
Nichts davon verrät das Brett. Eine Grafik des Verlaufs gibt es nicht mehr;
warum keine, steht in `MESSUNGEN.md`.

### Rangliste

Nach dem Vorbild der Rangliste in Landlines. „Rangliste" rechts in der
Kartenreihe öffnet die Top 10 des Tages; wer eingetragen ist, sieht „Platz X
von Y", und steht er nicht unter den zehn, folgen „…" und die eigene Zeile mit
dem echten Platz. Sortiert wird nach geschafften Level, dann Punkten, beides
absteigend (`-level,-points`); gleiches Level und gleiche Punkte teilen den
Platz. Eine Zeile liest sich „25 Level, 130 Punkte".

Eingetragen wird nur auf der Endkarte des Tagesbretts und nur per Klick, neben
„Ergebnis teilen". Beim ersten Mal fragt das Spiel nach einem Namen (2 bis 20
Zeichen) und merkt ihn sich; danach heißt der Knopf „Als <Name> eintragen",
daneben „Namen ändern". Ein Eintrag pro Gerät und Tag: eine zufällige
Geräte-ID im localStorage, die nie auf der Seite erscheint, und ein Unique
Index auf (date, client_id) auf dem Server. Eingetragen wird die Zahl der
**geschafften** Level — 4, wer in Level 5 scheitert, 25, wer durchspielt —,
nicht das Level, das Karte und Kopfzeile zeigen.

Der Code liegt in `src/leaderboard.js`: nur `fetch`, kein SDK, 5 s Timeout,
Adresse, Collection und Sortierung als Konstanten in `LEADERBOARD`. Beim Start
geht keine Anfrage hinaus; gelesen wird beim Öffnen der Rangliste und nach dem
Eintragen, geschrieben nur beim Klick. Ist der Server nicht erreichbar, sagt
die Rangliste es in einer Zeile, und das Spiel läuft weiter. Namen kommen nur
als Text auf die Seite. Was gespeichert wird und wie lange, steht in
`datenschutz.html`, verlinkt unter dem Hilfetext und beim Eintragen.

Der Server: PocketBase unter `https://api.thssn.dev`, Collection
`funkloch_daily` mit `date`, `username`, `level`, `points` und dem versteckten
`client_id`; Unique Index auf (date, client_id); List, View und Create
öffentlich, Update und Delete gesperrt. Die Seite hat keine Content Security
Policy; käme eine dazu, braucht sie `connect-src https://api.thssn.dev`.

Der Tag wird **in Berlin** gerechnet (`boardDay` und `DAILY_TIME_ZONE` in
`src/run.js`), mit echter Zeitzone über `Intl.DateTimeFormat` und nicht mit
festem Versatz, und nicht in der Zone des Geräts. Das Brett wechselt um
Mitternacht deutscher Zeit, im Sommer wie im Winter; der Countdown zählt auf
dieselbe Mitternacht. Entscheidend ist nicht, dass die Zone neutral ist, sondern
dass sie für alle dieselbe ist: mit einer gerätelokalen Datumsgrenze hätte
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
dieselben Bretter und dieselben Sender. Jede freie Partie hat einen: ohne
`?seed=` wird er aus der Uhrzeit abgeleitet (`freeSeed` in `src/run.js`), und
die Endkarte nennt ihn als Link, der die Partie noch einmal austeilt.

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
| `node tools/make-icons.js` | rastert `favicon.svg` zu den App-Icons und setzt daraus und aus der Wortmarke das Vorschaubild `og-image.png` |
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

Unter dem Hilfetext steht klein der laufende Stand, die ersten sieben Zeichen
des Commits („Stand 4e9a9b8", der ganze Hash im Tooltip). Er kommt ohne
Build-Schritt auf die Seite: `api/version.js` ist eine Vercel Function, die
`VERCEL_GIT_COMMIT_SHA` zur Laufzeit liest; die Seite fragt sie nach dem
Laden. Voraussetzung ist ein Deployment aus einem Git-Push und der Haken bei
„Enable access to System Environment Variables" unter Environment
Variables in den Projekteinstellungen (seit einiger Zeit Vorgabe). Fehlt eins davon, oder läuft die Seite ohne Endpunkt,
bleibt die Zeile weg. `npm run serve` beantwortet denselben Pfad mit demselben
Handler; mit `VERCEL_GIT_COMMIT_SHA=… npm run serve` zeigt er einen Stand.
