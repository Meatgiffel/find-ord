# Arkitektur og API-kontrakter

Beslutningen styres i [Linear TEA-6](https://linear.app/team-vre/issue/TEA-6/beskriv-enkel-arkitektur-og-api-kontrakter-til-lokal-drift). Her står både den nuværende kontrakt og de besluttede udvidelser. Udvidelser mærket **planlagt** er endnu ikke leveret.

## Drift og modulgrænser

Find ord har én applikationscontainer med Node/Express, Better Auth, SQLite og en bygget Svelte-klient. Docker-volumet til `/app/data` skal ligge på lokal disk og bevares sammen med authentication-hemmeligheden. Der køres én app-replika mod databasen. En reverse proxy leverer HTTPS til telefoner og tablets; proxyen ændrer ikke spilregler eller kontoautorisation.

| Modul | Ansvar | Nuværende placering |
| --- | --- | --- |
| Login og konti | Passwords, sessions og roller via Better Auth; serverbestemt børneflag og ejerskab i appen | `src/server/auth.ts`, `src/server/index.ts`, `src/web/auth.ts` |
| Ordgrundlag | Versioneret COR-import, kategorier og godkendelsespolitik | `src/server/lexicon.ts`, `src/shared/words.ts`, `src/shared/safety.ts` |
| Generator og validering | Deterministisk grid, lovlige retninger, versioner og sikkerhedstjek | `src/shared/game.ts`, `src/shared/validation.ts` |
| Spil og synkronisering | Personlige baner, validerede fund/hints, hændelser og completion | `src/server/game-sync.ts`, `src/web/storage.ts` |
| Statistik og achievements | Servergodkendt progression; lokal visning kan være foreløbig | `src/server/achievements.ts`, `src/shared/achievements.ts` |
| PWA | Manifest og Workbox-appcache; kontoafgrænsede baner/outbox i Dexie | `vite.config.ts`, `src/web/storage.ts` |

Serveren bestemmer profiltype, lovlige træk, statistik og belønninger. Klienten får grid og målliste for at kunne spille offline, men ingen separat liste over løsningernes koordinater. De rene funktioner i `src/shared` giver samme lokale feedback som servervalideringen; serveren efterprøver alle synkroniserede hændelser. Browserens service worker cacher appfiler og er adskilt fra den **planlagte** server-worker, der skal generere baner uden at blokere login eller træk. Server-workeren får versionsbundne input, men skriver ikke selv i SQLite; hovedprocessen validerer og gemmer resultatet.

### Afprøvede versioner

`package-lock.json` låser de konkrete versioner. Kode, tests og produktionsbuild er afprøvet med Node 22 (lokalt 22.23.1 og i GitHub Actions med `node-version: 22`):

| Område | Version i lockfil |
| --- | --- |
| Svelte / Vite / TypeScript | 5.57.2 / 7.3.7 / 5.9.3 |
| Express / Better Auth / better-sqlite3 | 4.22.3 / 1.7.10 / 12.11.1 |
| vite-plugin-pwa / Dexie | 2.0.0 / 4.4.6 |

Better Auths Svelte-klient, username-plugin og SQLite-driver passer til denne integration. Username-pluginet kræver stadig `email` ved oprettelse. Serveren bruger derfor den unikke interne adresse `<normaliseret-brugernavn>@users.find-ord.invalid`; ingen mail sendes, og børn skal ikke have en rigtig email. Administratoren opretter konti; offentlig sign-up er lukket. Se [Better Auth-klient](https://better-auth.com/docs/concepts/client), [username](https://better-auth.com/docs/plugins/username), [SQLite](https://better-auth.com/docs/adapters/sqlite) og [admin-plugin](https://better-auth.com/docs/plugins/admin).

## HTTP-kontrakt, nuværende version

Alle endpoints nedenfor bruger cookie-session, bortset fra login. Ændrende app-kald kræver tilladt `Origin`; Better Auth håndterer sine egne auth-ruter og deres fejlformat. Appens fejl er JSON med `error` som dansk tekst. HTTP-status er den stabile maskinlæsbare del: `400` ugyldige data, `401` intet gyldigt login, `403` forbudt handling eller origin, `404` ikke fundet for den aktuelle konto, `409` konflikt, `410` udgået bane og `503` midlertidig genereringsfejl. Klienten må ikke vise en `404` som bevis for, om en anden kontos bane findes.

| Metode og sti | Input | Succes og ejerregel |
| --- | --- | --- |
| `POST /api/auth/sign-in/username` | Better Auth: `username`, `password` | Better Auth sætter session-cookie. `POST /api/auth/sign-up/email` afvises for offentligheden. |
| `GET /api/me` | — | Konto-ID, navn, rolle, serverens `child` og `puzzleVersions` for regler, validering, ord, kategoritags og børnepolitik. |
| `GET /api/categories` | — | Kategori-ID, navn og aktuelt tilgængelige niveauer. Kræver login. |
| `POST /api/games` | `{category, level}` | `201` med `{puzzle, found: [], hints: [], completed: false, revision: 0}`. Serveren bruger sessionens konto og børneflag og validerer kombinationen. |
| `GET /api/games` | — | Højst 30 af kontoens seneste baner med pakke og fremdrift. |
| `GET /api/games/:id` | — | Kun ejerens bane; `410` hvis kategori, ord eller sikkerhedspolitik gør den ugyldig. |
| `POST /api/games/:id/sync` | `{events: Move[]}`, højst 500 | `200` med `{found, hints, completed, revision}` efter servervalidering. Se hændelsesformatet nedenfor. |
| `GET /api/achievements` | — | Serverberegnet liste over kontoens achievements og fremdrift. |
| `GET /api/accounts` | — | Kun admin: kontoliste uden passwords. |
| `POST /api/accounts` | `{username, name, password, child}` | Kun admin: `201` med offentlig kontoprofil; `400` ugyldigt input, `409` duplikat/oprettelsesfejl. |

En banepakke indeholder `puzzle.id`, `category`, `level`, `grid`, `words`, `seed`, `child` samt `version`, `wordListVersion`, `categoryTagVersion`, `validationVersion` og `childPolicyVersion`. Konto-ID sendes ikke som autoritativt felt i banepakken; serveren binder spillet til sessionens bruger, og Dexie gemmer ejeren lokalt. Historik indeholder samme kategori-ID og tagversion gennem den gemte pakke. Ord fra COR importeres lokalt, men bruges ikke som målord, før de er godkendt og kategoriseret.

`Move` har et globalt unikt UUID som `id` og én af disse former:

```json
[
  { "id": "<uuid-1>", "kind": "find", "word": "HUND", "start": { "row": 1, "col": 2 }, "end": { "row": 1, "col": 5 } },
  { "id": "<uuid-2>", "kind": "hint", "word": "KAT" },
  { "id": "<uuid-3>", "kind": "complete" }
]
```

Fund kræver en ret, tilladt linje i det gemte grid og et endnu ikke fundet målord. Hint kræver et uopdaget ord og ledigt budget. Completion kræver alle målord; serveren tæller den én gang. `409` ved overskredet hintbudget indeholder også `rejectedHintId` og `serverGame`, så klienten kan fjerne netop det afviste offlinehint og forsøge andre træk igen. Almindelige konflikter har kun `{error}`. Rækkefølgen af hændelser i batchen er betydningsfuld.

`GET/POST /api/campaigns` og `POST /api/campaigns/:id/refill` leverer personlige kampagner med op til tre hentbare uafsluttede baner ad gangen. Kampagnebaner bruger de samme versioner, ejerregler og sync-endpoint som enkeltbaner.

## Besluttede udvidelser til første version

| Kontrakt | Beslutning og ansvar | Status |
| --- | --- | --- |
| Idempotent spiloprettelse | `POST /api/games` får et klientgenereret `requestId` (UUID). Gentagelse med samme konto, ID og parametre giver samme bane eller job; anden payload med samme ID giver `409`. Tom cache kan returnere ventestatus med et kontoafgrænset job-ID. [TEA-30](https://linear.app/team-vre/issue/TEA-30/byg-automatisk-baneforsyning-med-cache-og-begraensede-jobs) fastlægger pollingrespons og grænser. | Planlagt; i dag kan retry oprette en ekstra bane. |
| Specifik synckvittering | Sync-respons får accepterede og tidligere accepterede event-ID'er, så klienten kun sletter specifikt kvitterede outbox-rækker. Samme ID med ændret ejer, bane eller payload giver konflikt. Revision/sekvens styrer samtidige enheder og completion. [TEA-46](https://linear.app/team-vre/issue/TEA-46/synkroniser-offlinehaendelser-med-idempotens-og-konfliktregler). | Planlagt; i dag returneres samlet tilstand og hele succesbatchen slettes. |
| Kontoændringer | `PATCH /api/profile` tager `{name, avatarId}` for egen profil og returnerer den opdaterede profil; rolle og børneflag er ikke accepterede felter. `PATCH /api/accounts/:id/policy` tager `{child, adminPassword, expectedVersion}` og returnerer `{id, child, policyVersion}`. Den kræver administrator og nylig passwordbekræftelse; forældet version giver `409`, og ændringen invaliderer berørte sessioner/baner. Passwordnulstilling, deaktivering og sletning bruger Better Auths administrative funktioner. Ingen ændring må autoriseres ud fra offlineidentitet. [TEA-15](https://linear.app/team-vre/issue/TEA-15/handhaev-profiladgang-og-voksenstyring-af-borneindstillinger), [TEA-16](https://linear.app/team-vre/issue/TEA-16/byg-profilsider-og-administration-af-brugere) og [TEA-17](https://linear.app/team-vre/issue/TEA-17/implementer-lokal-kontogendannelse-og-sletning-af-brugerdata) står for implementering og test. | Planlagt; kun oprettelse og listning findes i app-API'et nu. |
| Kategoristatistik | Hændelser og statistikrespons bærer kategori-ID og `categoryTagVersion`, så gamle resultater kan forklares efter ændringer. [TEA-35](https://linear.app/team-vre/issue/TEA-35/implementer-palidelige-spilhaendelser-og-personlig-statistik). | Planlagt; achievements-respons er endnu ikke versionsbundet. |

## Data, offline og konflikter

SQLite kører i WAL-tilstand på lokalt volume. Better Auths skema migreres ved start, derefter appens versionerede migrationer. En accepteret batch opdaterer `game_event` og `game` i samme SQLite-transaktion; fejl ruller batchen tilbage. Kampagnepåfyldning bruger også transaktion. En ren database skal kunne initialiseres uden private driftsdata. Der bruges én replika og ingen delt netværksfil til SQLite. [SQLite anbefaler en serverdatabase ved mange samtidige skrivere eller netværksadgang](https://www.sqlite.org/whentouse.html), og [WAL understøtter ikke et netværksfilsystem mellem værter](https://www.sqlite.org/wal.html). Vurder PostgreSQL særskilt, hvis topologien eller skrivepresset ændrer sig.

Dexie-skemaet er versioneret (aktuelt 1–4). Fremtidige skemaopgraderinger skal bevare baner og usynkroniserede hændelser eller fejle samlet uden delvis migration. En fuld banepakke gemmes og valideres før “Klar offline”. Fund, hints og completion gemmes sammen med en outbox-hændelse i én lokal transaktion, før feedback vises. Outbox sendes i batches på højst 500 i lokal sekvensorden ved åbning, genkontakt og manuel synkronisering. Retry bruger samme event-ID. Når serveren er offline eller sessionen udløber, kan sidst indloggede kontos allerede godkendte baner fortsættes lokalt; upload venter på gyldigt login til samme konto. Ved profil-/versionsændring genkontrolleres downloads ved næste serverkontakt. En ugyldig pakke må ikke vises, men dens usynkroniserede hændelser skal bevares i en særskilt afventende tilstand, indtil synkronisering eller udtrykkelig opgivelse er afklaret. En offlineenhed kan ikke opdage en fjernændring før næste kontakt. [Dexie beskriver skemaversioner](https://dexie.org/docs/Dexie/Dexie.version%28%29) og [transaktionernes atomiske adfærd](https://dexie.org/docs/Dexie/Dexie.transaction%28%29).

Workbox precacher appens byggede filer og bruges ikke som autoritet for baner eller brugerdata. Den nuværende `generateSW`-strategi bygger service workeren fra Vite-konfigurationen; [Vite PWA dokumenterer strategien](https://vite-pwa-org.netlify.app/workbox/) og [Svelte-integrationen](https://vite-pwa-org.netlify.app/frameworks/svelte). Serverens kommende generator-worker er en anden procesopgave og har ingen adgang til browserens cache.

## Kapacitetsmål og åbne punkter

Det foreløbige kapacitetsmål er fem samtidige spillere på lokal hardware. [TEA-38](https://linear.app/team-vre/issue/TEA-38/tilfoj-driftsstatus-og-mal-kapacitet-pa-lokal-hardware) skal beskrive referencehardware, belastningsmønster og faktiske svartider. Spil må ikke kræve cloud-, AI-, mail- eller eksterne API-kald; det bundtede ordregister og authentication kører lokalt.

Den tidlige udgave genererer stadig baner synkront i Express, har endnu ikke idempotent enkeltbaneoprettelse, specifik eventkvittering eller versionsbundet kategoriopdelt statistik. Børnebaner bruger endnu den samme indbyggede temaliste som voksenbaner med en foreløbig gridkontrol; redaktionelt godkendt børneindhold mangler. `reconcileDownloadedGames` sletter i dag også pending events, når en pakke fjernes efter versionsskift; [TEA-44](https://linear.app/team-vre/issue/TEA-44/gem-komplette-banepakker-og-lokal-fremdrift-med-dexie) skal erstatte dette med sikker bevaring uden at vise ugyldigt børneindhold. Kontooprettelse består af Better Auth-oprettelse og efterfølgende profilindsættelse, som endnu ikke er én fælles transaktion. Det sidste og første administrator-setup følges i [TEA-13](https://linear.app/team-vre/issue/TEA-13/implementer-forste-administrator-og-oprettelse-af-separate-brugerkonti). Den eksisterende `/api/health` er kun et simpelt liveness-svar; readiness hører til TEA-38. Disse punkter er implementeringsarbejde, ikke skjulte garantier i den nuværende API.
