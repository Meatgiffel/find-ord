# Drift og kapacitet

## Status og logs

| Endpoint | Formål |
|---|---|
| `GET /api/health` | Liveness. Svarer `200`, så længe processen kører. Kræver ingen database eller ekstern adgang. |
| `GET /api/ready` | Readiness. Tjekker, at databasen svarer, at skemaet har den nyeste migration, og at COR-versionen er indlæst. Svarer `503` med en liste over problemer, hvis noget mangler. Svaret viser også versioner og cachens tilstand. Docker-healthchecket bruger dette endpoint. |

Serveren logger én JSON-linje pr. hændelse til stdout og stderr (se `docker compose logs find-ord`):

- `startup` med versioner og antal COR-ordformer, samt `puzzle-cache` og `listening`.
- `request` for hvert API-kald med `requestId`, metode, sti uden query, status og varighed i ms.
- `game-created` med kilde (`cache` eller `generated`), varighed, niveau, profiltype og cachens tilstand.
- `generation-failed`, `request-failed` (fx `SQLITE_FULL`), `startup-failed` og `shutdown`.

Hver respons har headeren `X-Request-Id`. En proxy kan sende sin egen (højst 64 tegn: bogstaver, tal, `.`, `_` og `-`). Logs indeholder aldrig adgangskoder, tokens, brugernavne, ord eller spilforløb. Engangslinket til den første administrator er en undtagelse: det skrives som almindelig tekst, indtil administratoren er oprettet. `LOG_LEVEL=error` begrænser loggen til fejl.

## Grænser

| Variabel | Standard | Virkning |
|---|---|---|
| `GENERATION_TIMEOUT_MS` | 5000 | Hårdt tidsbudget pr. bane. Derefter stoppes workeren, og der prøves op til to gange mere (højst cirka 15 s i alt). Kontrolleret fejl: `503` med `Retry-After`. |
| `GENERATION_QUEUE_LIMIT` | 8 | Antal job i køen. Ved fuld kø svarer serveren `503` med `Retry-After: 5`. |
| `PUZZLE_CACHE_LIMIT` | 300 | Højeste antal færdige baner i cachen. De ældste fjernes først. |
| `GAME_CREATION_LIMIT` | 60 | Nye baner og kampagnepåfyldninger pr. konto pr. 10 minutter. |

## Målinger (2026-10-18)

**Referencehardware:** docker-01, en VM med 4 vCPU (QEMU Virtual CPU 2.5+), 7,8 GiB RAM og SSD, kørt i Docker. Klienten stod på samme LAN, så tiderne indeholder netværket. Testen bruger `npm run test:load` med 5 samtidige spillere, hvoraf 2 er børneprofiler. Hver spiller tager 4–8 baner på skiftende niveauer og sender ét ordfund ad gangen.

| Handling | Mål p95 | Målt p95 | Målt maks. |
|---|---|---|---|
| Ordfund (sync) | < 300 ms | 36–43 ms | 107 ms |
| Achievements og mål | < 300 ms | 26–35 ms | 52 ms |
| Ny bane fra cache | < 500 ms | 29 ms (serverens tid) | 29 ms |
| Ny bane, genereret | < 3 s | 254 ms (serverens tid) | 276 ms |

Generatoren alene bruger højst 58 ms på den udviklingsmaskine, hvor `npm run test:generator` kører. Med 160 MiB hukommelsesgrænse var p95 for en ny bane 66 ms og for ordfund 43 ms. Processen brugte 68 MiB, og den blev ikke stoppet for at bruge for meget hukommelse.

Tallene er fra én kørsel. Kør testen igen efter ændringer i generator, ordlister eller hardware. Den opretter konti, så den skal køre mod en separat testinstans og aldrig mod de rigtige data.

## Fejltests

| Scenarie | Resultat |
|---|---|
| Disken løber fuld under drift (tmpfs fyldt med `dd`) | Nye baner og sync svarer `507` med en dansk forklaring. Processen kører videre, og `/api/health` og login virker stadig. Når der er plads igen, virker alt uden genstart. |
| For lidt disk ved første start (COR-importen) | `startup-failed` med `SQLITE_FULL`, og processen stopper. Importen er én transaktion, så den starter forfra næste gang. |
| Worker overskrider tidsbudgettet (`GENERATION_TIMEOUT_MS=1`) | `503` med `Retry-After` og loggen `generation-failed`. Workeren startes igen til næste job, og resten af appen svarer. |
| Genstart | `/api/ready` er klar efter cirka 1 s. Cachen bevares (16 baner før og efter), og job i hukommelsen forsvinder uden halve rækker. |
| 12 samtidige bestillinger | 9 bliver leveret, og 3 får `503`. Kø og cache holder deres grænser. |

## Klient

- **Bundlebudget (gzip):** JavaScript højst 120 kB og CSS højst 15 kB. Målt: 88 kB og 5 kB. `npm run check:bundle` kører i CI. De redaktionelle ordlister er med i appen, men COR-ordbogen er det ikke.
- **Banepakker:** En komplet bane fylder cirka 0,6 kB (Let) til 2,1 kB (Ekspert) som JSON.
- **Forbindelse:** Appen skelner mellem "Ingen internet" (enheden er offline), "Serveren svarer ikke" (netværket virker, men serveren svarer ikke) og "Session udløbet". I alle tre tilfælde kan hentede baner spilles videre, og trækkene sendes senere.
- **Mangler:** Inputrespons og download på en rigtig telefon og tablet måles under TEA-48.
