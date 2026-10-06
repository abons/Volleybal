# Open werk

## Hier begint de volgende sessie

- Eén-regel-aanwezigheid (pil links, `✓ n` rechts, `site/style.css` onderaan) alleen bekeken op een nagebouwde kaart in dark mode, niet op een smal toestel (360dp) of met grote systeemlettergrootte; `--pill-w` is vast (6 / 6,8 / 7,8 rem) en kan bij "Je komt niet" over het getal lopen.
- Agenda-download met aanwezigheid (`veventFor` in `site/app.js`): `SEQUENCE` is Unix-seconden en het UID blijft dat van Nevobo. Getest: importeren in Google Agenda (na Agenda-update) werkt en overschrijft een eerdere import. Niet getest: of het ook zonder `SEQUENCE` overschrijft, en of een Nevobo-abonnement ernaast hindert (verwacht van niet: aparte agenda's).
