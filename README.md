# Volleybal

Een kleine PWA voor Nevobo-volleybal: zoek je team, bewaar het als favoriet en zet wedstrijden
(per wedstrijd of voor het hele team) in je agenda. Geen account, geen login, geen tracking, geen dependencies.

- **Favoriet**: wordt in `localStorage` op je eigen toestel bewaard.
- **Per wedstrijd in je agenda**: de app maakt in de browser een `.ics`-bestand van die ene wedstrijd.
  De UID is die van Nevobo, dus opnieuw toevoegen werkt een bestaande afspraak bij.
- **Hele team in je agenda**: een `webcal://`-abonnement op Nevobo's eigen `programma.ics` van het team.
  Wijzigingen van Nevobo komen vanzelf mee. Lukt `webcal://` niet (sommige Android-apps), kopieer dan de link
  en voeg hem toe als agenda-abonnement (Google Agenda → Andere agenda's → Via URL).
- **Installeren**: open de pagina op je telefoon en kies “Zet op beginscherm”. Daarna werkt hij ook offline.

## Hoe het werkt

`api.nevobo.nl` stuurt geen CORS-headers mee, dus de browser mag de API niet zelf aanroepen. Daarom haalt
`scripts/build.mjs` (in GitHub Actions, twee keer per dag) alle teams en hun wedstrijdprogramma op en
publiceert die als statische JSON naast de app op GitHub Pages:

```
data/teams.json          alle teams: [sleutel, naam, vereniging, plaats, standpositie]
data/t/<club>-<soort>-<nr>.json   de wedstrijden van één team
```

De zoekfunctie draait lokaal op `teams.json`; de API zelf kan niet filteren op naam.

## Eenmalig instellen

Settings → Pages → Source: **GitHub Actions**. Daarna publiceert elke push naar `main` (en het schema) de site.

## Lokaal proberen

```sh
FORCE=1 LIMIT=50 node scripts/build.mjs   # eerste 50 teams ophalen
npx serve _site                            # of: python3 -m http.server -d _site
```

Zonder `LIMIT` duurt een volledige run een kwartier. Gegevens: [Nevobo](https://www.nevobo.nl).
