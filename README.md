# Volleybal

**Live: https://abons.github.io/Volleybal/**

Een kleine PWA voor Nevobo-volleybal: zoek je team, bewaar het als favoriet en zet wedstrijden
(per wedstrijd of voor het hele team) in je agenda, en bekijk uitslagen en de stand. Geen account, geen login, geen tracking, geen dependencies.

- **Favoriet**: wordt in `localStorage` op je eigen toestel bewaard.
- **Per wedstrijd in je agenda**: de app maakt in de browser een `.ics`-bestand van die ene wedstrijd.
  De UID is die van Nevobo, dus opnieuw toevoegen werkt een bestaande afspraak bij.
- **Hele team in je agenda**: een `webcal://`-abonnement op Nevobo's eigen `programma.ics` van het team.
  Wijzigingen van Nevobo komen vanzelf mee. Lukt `webcal://` niet (sommige Android-apps), kopieer dan de link
  en voeg hem toe als agenda-abonnement (Google Agenda → Andere agenda's → Via URL).
- **Installeren als app**: op Android verschijnt onderaan de knop “Zet op je beginscherm als app” (of kies in Chrome ⋮ → *App installeren*).
  Op iPhone/iPad: Safari → Deel → *Zet op beginscherm*. Daarna werkt hij ook offline.

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

## Eenmalig instellen

Settings → Pages → Source: **GitHub Actions**. Daarna publiceert elke push naar `main` (en het schema) de site.

## Lokaal proberen

```sh
FORCE=1 LIMIT=50 node scripts/build.mjs   # eerste 50 teams ophalen
npx serve _site                            # of: python3 -m http.server -d _site
```

Zonder `LIMIT` duurt een volledige run een kwartier. Gegevens: [Nevobo](https://www.nevobo.nl).
