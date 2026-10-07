# Open werk

## Hier begint de volgende sessie

- Eén-regel-aanwezigheid (pil links, `✓ n` rechts, `site/style.css` onderaan) alleen bekeken op een nagebouwde kaart in dark mode, niet op een smal toestel (360dp) of met grote systeemlettergrootte; `--pill-w` is vast (6 / 6,8 / 7,8 rem) en kan bij "Je komt niet" over het getal lopen.
- Agenda-download met aanwezigheid (`veventFor` in `site/app.js`): `SEQUENCE` is Unix-seconden en het UID blijft dat van Nevobo. Getest: importeren in Google Agenda (na Agenda-update) werkt en overschrijft een eerdere import. Niet getest: of het ook zonder `SEQUENCE` overschrijft, en of een Nevobo-abonnement ernaast hindert (verwacht van niet: aparte agenda's).
- Bug (testen op pc met emulator): na openen via de herstellink in de browser staat de groep er wel, maar na "toevoegen aan startscherm" en de app openen word je er helemaal uit gegooid (gemeld door teamgenoot).
  - Vermoeden (niet bevestigd): browser en geïnstalleerde app delen geen opslag. `main()` in `site/app.js` (~r. 1219) wist de `#groep=…`-parameters direct met `history.replaceState`; lid, groep en anonieme Firebase-login staan alleen in `localStorage`/de browser. De app start op `start_url: "./"` zonder die gegevens. Op iOS is de opslag zeker apart; op Android/Chrome deelt een geïnstalleerde app die meestal wel, dus eerst in de emulator vaststellen wat er echt gebeurt (wordt `state` leeg, of alleen de login?).
  - Oplossingsrichtingen, voorkeursvolgorde:
    1. Herstellen vanuit de app zelf: veld "Heb je een herstel-link of code?" (link plakken, of code + naam) dat dezelfde flow draait als nu (`pendingId`, `claimGhost`). Werkt op elk platform, ook na gewiste browsergegevens.
    2. Aanvulling: `naam`/`id` van de herstel-link in de URL laten staan zodat iOS "Zet op beginscherm" ze meeneemt; de app moet dan tegen herhaald openen kunnen (grotendeels al zo: "al lid"-paden). Nadeel: groepscode blijft zichtbaar in de URL.
    3. Alleen tekst: bij een herstel-link eerst "installeer de app en open de link daarin" tonen (`showInstall`). Helpt deels, een link opent niet vanzelf in de app.
    4. Eenmalige koppelcode voor browser naar app: te veel werk en risico, niet doen.
