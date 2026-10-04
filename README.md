# Volleybal

**Live: https://abons.github.io/Volleybal/**

Een kleine PWA voor Nevobo-volleybal: zoek je team, bewaar het als favoriet en zet wedstrijden
(per wedstrijd of voor het hele team) in je agenda, en bekijk uitslagen en de stand. Geen account, geen login, geen tracking, geen dependencies.

- **Favoriet**: wordt in `localStorage` op je eigen toestel bewaard.
- **Aanwezigheid**: bij elke komende wedstrijd kies je *Ja*, *Misschien* of *Nee* (nogmaals tikken wist je keuze). Je keuze staat
  op je eigen toestel. Is Firebase ingesteld en neem je deel aan een groep met code (zie *Aanwezigheid delen*), dan zien
  teamgenoten per wedstrijd wie komt. Geen account: Firebase logt het toestel anoniem in.
- **Per wedstrijd in je agenda**: de app maakt in de browser een `.ics`-bestand van die ene wedstrijd.
  De UID is die van Nevobo, dus opnieuw toevoegen werkt een bestaande afspraak bij.
- **Hele team in je agenda**: een `webcal://`-abonnement op Nevobo's eigen `programma.ics` van het team.
  Wijzigingen van Nevobo komen vanzelf mee. Lukt `webcal://` niet (sommige Android-apps), kopieer dan de link
  en voeg hem toe als agenda-abonnement (Google Agenda → Andere agenda's → Via URL).
- **Installeren als app**: op Android verschijnt onderaan de knop “Zet op je beginscherm als app” (of kies in Chrome ⋮ → *App installeren*).
  Op iPhone/iPad: Safari → Deel → *Zet op beginscherm*. Daarna werkt hij ook offline.

## Aanwezigheid delen (Firebase, eenmalig instellen)

Zonder instellingen werkt alles lokaal. Met Firebase kan een team zijn aanwezigheid delen via een **groep met code**:

- In de app: bij het programma van een team kies je *maak een groep of neem deel*. Een nieuwe groep krijgt een willekeurige code
  van 10 tekens (bijvoorbeeld `24WJF-TFG74`); met een code neem je deel aan een bestaande groep. Je vult alleen een naam in; **zonder naam kijk je alleen mee** (je ziet wie er komt, maar krijgt geen knoppen en telt niet als lid). Een naam toevoegen kan later onder *beheer*.
  De link (`#groep=<code>&team=<sleutel>`, via *Kopieer link*) kiest meteen het juiste team en opent het deelnemen-blad met de code ingevuld; je vult alleen je naam in. Oudere links zonder team vragen je eerst een team te kiezen.
- Per team heb je één groep. Je keuze (Ja/Misschien/Nee) zie je terug bij je teamgenoten. Onder elke wedstrijd staat ook met `○`
  wie van de leden nog niets heeft gekozen.
- Onder *beheer* staat een **ledenlijst** met per lid hoeveel komende wedstrijden zijn ingevuld, en bij elk ander lid *Verwijder*.
  Dat is bedoeld voor "spoken": een toestel dat zijn opslag kwijt is, krijgt bij opnieuw deelnemen een nieuwe anonieme gebruiker
  en laat zijn oude naam met oude keuzes achter. Verwijderen haalt het lid-document en de keuzes weg. Een lid dat de app nog gebruikt,
  maakt zijn lid-document bij het volgende laden vanzelf weer aan. De regels staan leden van de groep toe een ander lid te
  verwijderen en de keuzes van een verdwenen lid op te ruimen; publiceer na een wijziging altijd dezelfde `firestore.rules` in de
  Firebase-console.
- **Opslag kwijt?** Onder *beheer* staat *Kopieer herstel-link*: de uitnodigingslink met je naam erbij (`&naam=…`). Bewaar hem in je
  notities. Op een nieuw toestel, of nadat de browser je gegevens heeft gewist, opent hij je team en het deelnemen-blad met je naam
  ingevuld. Neem je deel met een naam die al in de groep staat onder een ander toestel, dan vraagt de app "Ben jij dat?" en neemt bij ja
  de keuzes voor komende wedstrijden over (wat al op dit toestel staat gaat voor) en verwijdert het oude lid. Dat geldt ook als je
  onder *beheer* je naam wijzigt naar een bestaande naam.
- **Keuzes doorsturen**: onder *beheer* staat *Stuur je keuzes door*: een bericht met jouw keuzes voor de komende wedstrijden en een
  link (`&van=<naam>&a=<starttijd><j|m|n>,…`, starttijd in UTC als `jjjjmmdduumm`). Wie de link opent en al in de groep zit, krijgt
  een blad "Aanwezigheid overnemen" met de keuzes en kan ze in één keer overnemen of afwijzen; wie nog niet meedoet, ziet ze op het
  deelnemen-blad en neemt ze bij deelnemen over. Daarna staan de keuzeknoppen open om bij te stellen. Wedstrijden die niet (meer) in
  het programma staan, worden overgeslagen.
- Onder *beheer* staat *Deel wie er komt*: een tekstoverzicht van de komende wedstrijden (wie komt, wie niet, wie nog niet heeft
  gereageerd) met de uitnodigingslink, via het deelmenu van je toestel (bijvoorbeeld naar WhatsApp) of anders naar het klembord.
- **Verzette wedstrijd**: Nevobo houdt het UID bij een verzette wedstrijd meestal gelijk. Een keuze bewaart daarom ook de starttijd
  waarop hij is gegeven (`start`) en geldt alleen als die gelijk is aan de huidige starttijd van de wedstrijd (exacte vergelijking van de
  UTC-string; ook een verschuiving van alleen het tijdstip telt). Een verouderde keuze van een teamgenoot telt niet mee: die staat bij
  *nog niet gereageerd*, en ook niet in de teller onder *beheer*. Een eigen verouderde keuze wist de app bij het laden van het programma
  (met een melding "kies opnieuw"), en `reconcile` ruimt je document in de groep op. Documenten van anderen blijven staan, want de regels
  laten alleen je eigen keuzes verwijderen; ze worden genegeerd. Een ontbrekende `start` geldt als geldig. Een toestel met een ouder
  programma overschrijft of verwijdert geen document met een nieuwere start. Het filter `start >= gisteren` van `rsvps()` betekent dat
  een wedstrijd die naar een eerdere datum verschuift (buiten dat filter) niet via `reconcile` wordt opgeruimd; dat laten we zo.
- **Waarschuwing bij ontbrekende keuzes**: heb je van de komende wedstrijden al minstens 3 en minstens de helft ingevuld, maar ontbreken er
  een paar, dan staat boven het programma "N wedstrijden niet ingevuld: …" met de knop *Vul nu in* (opent alle keuzeknoppen en springt naar de
  eerste zonder keuze). Wie nog niets of weinig heeft ingevuld, ziet niets; wie alleen meekijkt ook niet. Zo valt ook een keuze op die de app
  wiste omdat de wedstrijd verzet is. De regel staat in `missingChoices` (`site/fresh.js`).
- Zit je in een groep, dan vraagt de app de browser je opslag te bewaren (`navigator.storage.persist`) en legt de installeerhint uit
  waarom installeren helpt: Safari wist gegevens van websites die je zeven dagen niet opent, van een app op het beginscherm niet.
- **De code is de enige beveiliging.** Wie de code heeft, kan de groep zien en meedoen. Groepen zijn niet op te sommen
  (de regels staan geen *list* op `groups` toe) en er is geen account; elk toestel logt anoniem in.

Instellen:

1. [Firebase-console](https://console.firebase.google.com) → *Build → Authentication → Sign-in method* → **Anonymous** aanzetten.
2. *Build → Firestore Database* → database maken (productiemodus). Plak onder *Rules* de inhoud van `firestore.rules` en publiceer.
3. *Project settings → Your apps → Web* (`</>`) → app registreren. Zet `apiKey` en `projectId` in `site/firebase-config.js`.
4. Aanbevolen: Google Cloud-console → *APIs & Services → Credentials* → de API-key beperken tot de HTTP-referrer `https://abons.github.io/*`.
5. Commit naar `main`; de site wordt opnieuw gepubliceerd.

Gegevens: `groups/<code>` (alleen `by` en `created`), `groups/<code>/members/<uid>` (naam) en `groups/<code>/rsvp/<wedstrijd>__<uid>`
(naam, keuze, wedstrijd, starttijd). Verlaat je een groep, dan verwijdert de app je lid-document en je keuzes voor de geladen wedstrijden.
De app leest alleen keuzes voor aankomende wedstrijden. Oude documenten en groepen ruimt de app niet op; verwijder ze desgewenst in de console. Iedereen kan anoniem inloggen en groepen aanmaken: zet in de Google Cloud-console een budgetalarm en overweeg App Check.

## Hoe het werkt

`api.nevobo.nl` stuurt geen CORS-headers mee, dus de browser mag de API niet zelf aanroepen. Daarom haalt
`scripts/build.mjs` (in GitHub Actions, twee keer per dag) alle teams, programma's, uitslagen en standen op en
publiceert die als statische JSON naast de app op GitHub Pages:

```
data/teams.json                    alle teams: [sleutel, naam, vereniging, plaats, standpositie]
data/t/<club>-<soort>-<nr>.json    per team: m = komende wedstrijden, r = uitslagen met setstanden, p = poules
data/p/<poule>.json                de stand van één poule
```

De zoekfunctie draait lokaal op `teams.json`; de API zelf kan niet filteren op naam. Programma's komen uit
Nevobo's `programma.ics` per team; uitslagen en standen uit twee grote lijsten (`/competitie/wedstrijden?status=gespeeld`
en `/competitie/pouleindelingen`) die in één keer worden ingelezen en over de teams worden verdeeld.
Poules waarin nog niets gespeeld is, krijgen geen stand.

## Bestanden

```
site/index.html, style.css, app.js   de app (geen framework, geen dependencies, geen build-stap)
site/shared.js, firebase-config.js    aanwezigheid delen via Firebase (REST, geen SDK)
firestore.rules                      beveiligingsregels voor Firestore
site/sw.js                           service worker: offline, nieuwe versie oppakken (BUILD-stempel wordt in de build ingevuld)
site/manifest.webmanifest, icon-*    installeerbaar als app
scripts/build.mjs                    haalt data bij Nevobo op en bouwt ./_site
scripts/ics.mjs                      kleine parser voor Nevobo's programma.ics
.github/workflows/deploy.yml         bouwen + publiceren op GitHub Pages (push, twee keer per dag, handmatig)
```

## Eenmalig instellen

Settings → Pages → Source: **GitHub Actions**. Daarna publiceert elke push naar `main` (en het schema) de site.

## Lokaal proberen

```sh
FORCE=1 LIMIT=50 node scripts/build.mjs   # eerste 50 teams ophalen
npx serve _site                            # of: python3 -m http.server -d _site
```

Zonder `LIMIT` duurt een volledige run ongeveer 8 minuten. De standen en uitslagen worden altijd volledig opgehaald (twee grote lijsten);
`LIMIT` beperkt alleen het aantal programma's. Gegevens: [Nevobo](https://www.nevobo.nl).

## Beheer

- **Handmatig verversen**: GitHub → Actions → "Bouw en publiceer" → *Run workflow*. Een gewone push gebruikt de bewaarde data
  uit de cache (jonger dan 10 uur) en duurt een halve minuut; het schema en *Run workflow* halen alles opnieuw op (ongeveer
  8 minuten en 13,7k verzoeken bij Nevobo, twee keer per dag).
- **Stopt het schema?** GitHub zet geplande workflows in een publieke repo uit na 60 dagen zonder commits. De site blijft dan
  staan maar veroudert (onderaan staat "bijgewerkt op …"). Zet de workflow dan weer aan onder Actions, of doe een commit.
- **Verandert de Nevobo-API?** De build controleert aantallen (te weinig standen, uitslagen of programma's, of meer dan 5% mislukte
  verzoeken) en faalt dan bewust: de live site blijft op de laatste goede data staan. Kijk in de log van de run
  (de regel `SAMENVATTING …` onderaan toont de aantallen) en pas `scripts/build.mjs` aan.
- **Cache**: `_data/` (niet in git) wordt tussen runs bewaard met `actions/cache`; verwijder de cache onder Actions → Caches om
  alles opnieuw op te halen.
- **Nieuwe versie van de app**: telefoons pakken die vanzelf op; de pagina herlaadt dan één keer. Een geopende zoekterm of tab
  gaat daarbij verloren, je favoriet blijft bewaard.
- **Gegevens en voorwaarden**: de wedstrijdgegevens zijn van [Nevobo](https://www.nevobo.nl) en worden via hun publieke API en
  exports opgehaald. Er is geen licentie voor de code toegevoegd; voeg er een toe als je die wilt delen.

## Wat we over de Nevobo-API weten

Voor wie hier later aan verder werkt (alles is in oktober 2026 met echte responses vastgesteld):

- `https://api.nevobo.nl` is een Hydra/JSON-LD-API (`Accept: application/ld+json`), 30 items per pagina, `hydra:last` geeft het aantal
  pagina's. Het filter `naam` op `/competitie/teams` werkt niet; `itemsPerPage` ook niet. Er zijn geen CORS-headers.
- Teams: `/competitie/teams` (13,7k). De sleutel is `/competitie/teams/<clubcode>/<dames|heren|…>/<nr>`.
- Programma per team: `/export/team/<CLUBCODE>/<soort>/<nr>/programma.ics` (hoofdletters in de clubcode). Bevat alleen **komende**
  wedstrijden, met UID, UTC-tijden, adres en GEO. `resultaten.rss` bestaat ook per team.
- Stand: `/competitie/pouleindelingen` (zonder filter: alle teams in alle poules; met `?poule=` of `?team=` gefilterd).
- Uitslagen: `/competitie/wedstrijden?status=gespeeld`. `teams` is `[thuis, uit]` als pouleindeling-IRI's, `eindstand` en
  `setstanden` volgen die volgorde. Er zijn ook filters `team`, `poule`, `vereniging`, `datum[before|after]`, `order[begintijd]`.
- Een team zit vaak in meerdere poules (competitie, beker, promotie). Bij 0 gespeelde wedstrijden ontbreekt `positie` soms.

## Testen

`node --test "scripts/test-*.mjs"` draait de unit tests van de pure logica (nu `site/fresh.js`: wanneer een keuze nog geldt); de workflow doet dat vóór de build.
Voor de rest is er geen testsuite. Wat wel werkt: bouw met testdata in `_data/` (zie `scripts/build.mjs`: als `_data/` vers is wordt er niets opgehaald),
serveer `_site` lokaal en laat Playwright de flow doorlopen (zoeken, team kiezen, tabs, .ics-download, offline herladen).
De Nevobo-API zelf is niet vanuit elke omgeving bereikbaar; een run in GitHub Actions is de betrouwbare test van de crawl.

## Bekende beperkingen

- Alleen komende wedstrijden zitten in het programma; gespeelde staan onder Uitslagen.
- Poules waarin nog niets gespeeld is, krijgen geen stand.
- Een favoriet van een vorig seizoen verdwijnt als dat team niet meer bestaat; kies dan opnieuw.
- Bij een nieuwe versie van de app herlaadt de pagina één keer; een ingetypte zoekterm of geopende tab gaat daarbij verloren.
- Het zoekveld krijgt bij het openen van het zoekscherm altijd focus (op mobiel klapt dan het toetsenbord open).
- De cache `data-v1` in de service worker wordt nooit opgeschoond.
- `webcal://`-abonneren werkt op iPhone direct, op Android niet in elke agenda-app (gebruik dan de knop *Kopieer link voor je agenda*).

## Ideeën voor uitbreiding

- Live bijwerken van de aanwezigheid (nu ververst die bij openen, na je keuze en als je terugkomt in de app) en opruimen van oude `rsvp`-documenten.
- Invullen namens een teamgenoot zonder de app (keuze met velden `voor` en `door`, apart in de regels en gemarkeerd in de lijst).
- Meerdere favoriete teams naast elkaar (nu: wisselen met knoppen), of een startscherm met de eerstvolgende wedstrijd van al je teams.
- Herinnering of alarm in het `.ics`-bestand (bijvoorbeeld een uur voor de wedstrijd).
- Eigen teams groeperen, delen via een link (`#team=…`) of zoeken op hal en regio.
- Alle uitslagen en standen van de hele poule bekijken (de data staat er al).
- Pushmeldingen bij wijzigingen (vereist een server; Nevobo heeft eigen push-topics).
