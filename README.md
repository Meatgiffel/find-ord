# Find ord

**AI-lavet projekt:** Kode, tests, brugerflade og dokumentation er i væsentligt omfang udviklet med AI-assistance fra OpenAI Codex under menneskelig styring. Projektet er en tidlig udgave og er ikke færdigverificeret for sikkerhed, tilgængelighed eller børneindhold. Gennemgå det selv, før du bruger det med rigtige konti eller børn.

Find ord er en dansk ordjagt bygget med Svelte, Node.js, Better Auth og SQLite. Serveren danner baner med én kategori; en hentet bane kan spilles og afsluttes offline i den installérbare PWA. Træk synkroniseres, når serveren igen er tilgængelig.

De aftalte regler og første versions afgrænsning står i [spilreglerne](docs/spilregler.md).
Systemets moduler, aktuelle API og planlagte kontraktændringer står i [arkitektur- og API-beskrivelsen](docs/arkitektur-og-api.md).

## Status og begrænsninger

Den første spilbare udgave har ni kategorier, alle fire niveauer (Let, Normal, Svær og Ekspert), enkeltbaner og endeløse kampagner, separat login, administration af nye konti, ordmarkering, hints, lokal lagring, synkronisering, 47 achievements og frivillige mål, der giver hintkreditter.

**Børneprofilen** bruger kun ord, der er godkendt til børn efter [børnepolitikken](docs/ordindhold.md#børnepolitik-version-3). Hele gitteret tjekkes desuden for forbudte sekvenser. Politikken og listerne er lavet af AI på ejerens vegne og er ikke gennemgået af en uafhængig redaktør. Ingen kontrol fanger enhver stødende tolkning. Planlagt automatisk backup og fysisk test på iPhone, iPad og Android er heller ikke færdigverificeret.

## Start med Docker

Du skal bruge Docker med Compose. Kopiér [.env.example](.env.example) til `.env`, og tilpas adressen før start. `.env`, databasen og authentication-hemmeligheden må aldrig lægges i Git.

```sh
cp .env.example .env
docker compose up -d --build
docker compose logs find-ord
```

Ved første start har databasen ingen konti. Serverens log viser da et engangslink, `…/?opsaetning=<kode>`; åbn det, og opret den første administrator i appen. Koden ligger kun i datamappen og i loggen, virker én gang og slettes, når administratoren er oprettet; der findes ingen standardkonto. Alternativt kan administratoren oprettes i terminalen med `docker compose exec find-ord npm run bootstrap`. Administratoren kan derefter oprette separate voksen- og børnekonti i appen, skifte en konto mellem børne- og voksenprofil (kræver administratorens adgangskode og logger kontoen ud) samt deaktivere og genaktivere konti. Hver spiller kan selv ændre visningsnavn, avatar og adgangskode under “Min konto”. Administratoren kan nulstille en spillers adgangskode og slette konti; begge dele logger kontoen ud, og sletning fjerner kontoens spil, statistik og achievements, men ikke andres data. Den sidste administrator kan ikke slettes eller degraderes.

Har ingen længere administratoradgang, kan ejeren af Docker-værten gendanne den for en eksisterende voksenkonto:

```sh
docker compose exec find-ord npm run reset-admin
```

Kommandoen spørger interaktivt om brugernavn og ny adgangskode, giver kontoen administratorrolle og logger den ud alle steder. Bootstrap kan kun bruges, når databasen er tom.

Valgfrit kan `LOG_LEVEL=error` begrænse loggen til fejl, og `GAME_CREATION_LIMIT` (standard 60) styrer, hvor mange nye baner og kampagnepåfyldninger én konto kan hente pr. 10 minutter. Baner dannes i en worker-tråd og holdes klar i en lille cache. `GENERATION_QUEUE_LIMIT` (standard 8), `GENERATION_TIMEOUT_MS` (3000) og `PUZZLE_CACHE_LIMIT` (300) sætter grænser for kø, tid pr. bane og antal cachede baner. `/api/ready` tjekker database, skema og ordgrundlag, og loggen er JSON med request-ID. Status, grænser og målt kapacitet står i [docs/drift-og-kapacitet.md](docs/drift-og-kapacitet.md). Containeren lukker SQLite pænt ned ved `docker compose stop`. Imaget er afprøvet på linux/amd64; linux/arm64 er endnu ikke verificeret.

Compose gemmer SQLite-database og en lokalt genereret authentication-hemmelighed i volumet `find-ord-data`. Bevar begge dele ved opgradering og backup. Servicen er tænkt til en betroet lokal installation; offentlig interneteksponering er ikke gennemgået.

### Telefon, tablet og HTTPS

PWA-installation på en anden enhed kræver HTTPS med et certifikat, som enheden stoler på. Sæt `BASE_URL` til den eksterne HTTPS-adresse, og lad en reverse proxy videresende til port 3000. Tilføj eventuelle andre tilladte origins i `TRUSTED_ORIGINS` som en kommasepareret liste. Sæt `TRUST_PROXY` til proxyens adresse eller net (fx `192.168.50.0/24`), så begrænsningen af loginforsøg gælder pr. klient; uden den ser servicen kun proxyens adresse, og alle deler samme grænse. Servicen overskriver selv klientadressen, så en klient ikke kan forfalske den. Bind helst appens port til loopback eller et afgrænset lokalnet. Almindelig HTTP på lokalnettet sender loginoplysninger og sessionscookies ukrypteret og kan ikke bruges til PWA-installation på en anden enhed.

Første login og nye baner kræver serverkontakt. En ny app-version installeres i baggrunden og aktiveres først, når spilleren trykker "Opdatér" på forsiden; den afbryder aldrig en bane, og gemte baner bevares. En komplet hentet bane gemmes på enheden og kan fortsættes offline. Browseren eller brugeren kan slette lokal lagring; synkronisér derfor før rydning af browserdata eller skift af enhed. Serverbackup omfatter kun synkroniserede træk.

En kampagne holder samme sværhedsgrad og skifter kategori mellem banerne. Højst tre uafsluttede baner hentes på forhånd. Når køen er tom, kræver nye baner forbindelse. En udløbet onlinesession stopper ikke allerede hentede baner for den senest indloggede konto; nyt login kræves for synkronisering.

Ved valg af sværhedsgrad og på selve banen vises de tilladte ordretninger. Når en bane er gennemført, vises resultatet ved gitteret med valg om næste eller ny bane og forside. En bane kan også opgives; den tæller så ikke som gennemført. En ny enkeltbane bruger samme kategori og sværhedsgrad. Offline åbnes kun en allerede hentet, uafsluttet bane med de samme valg; hvis der ikke er en, kræver en ny bane forbindelse. Kampagnen fortsætter med en hentet bane, hvis en er klar.

Under et aktivt spil vises kategori, fremdrift og gemmestatus i en kompakt top, og en åbnet bane starter øverst. På mobil i portræt kommer gitteret før ordlisten, og genveje forbinder dem; på lave landskabsskærme står ordlisten ved siden af, og gitteret tilpasses skærmhøjden. Hintknappen og beskeder under spillet ligger ved gitteret, så intet flydende element dækker bogstaverne. Gitteret er ét tabstop, og piletasterne flytter mellem felterne.

Hver bane har et fast hintbudget: 1 på Let, 2 på Normal, 3 på Svær og 4 på Ekspert. Et hint koster 1 hintkredit. Kreditter optjenes ved at klare frivillige mål på forsiden, uden tidsfrist (se [spilreglerne](docs/spilregler.md#mål-og-hintkreditter)). Seneste hints startfelt markeres i gitteret og beskrives med ord og position i tekst, indtil ordet findes. Ældre gemte baner over grænsen beholder deres fremdrift, men kan ikke få flere hints. Ved en konflikt mellem offlineenheder afviser serveren kun de træk, der ikke længere er gyldige, fx et hint over banens grænse; øvrige træk gemmes, og spilleren får en forklaring.

## Udvikling og checks

Node.js 22 og npm 10 kræves til lokal udvikling (`.nvmrc` og `package.json` angiver versionerne):

```sh
npm ci
npm run bootstrap
npm run dev
```

Udviklingssiden er på <http://localhost:5173>, og API'et er på port 3000. Kør disse checks før en ændring deles:

```sh
npm run lint
npm run check
npm test
npm run build
npm run test:generator -- --seeds=1000
```

Generatorprøven bruger 1.000 reproducerbare seeds pr. tilgængelig kategori, niveau og profiltype. Rapporten `reports/generator.json` viser succesrate, gennemsnitlig og maksimal tid pr. kombination samt kombinationer, der mangler ord. Fejl angiver kombination, seed og versioner. Egenskabstestene i `src/shared/generator.property.test.ts` dækker retninger, kanter, krydsninger, palindromer, små puljer, genereringsbudget og injicerede blokerede sekvenser. GitHub Actions kører hurtige checks og generatorprøven som særskilte jobs og gemmer rapporter som artifacts. Jobbet “Release checks passed” bliver kun grønt, når begge jobs består; gør det til et påkrævet statuscheck før udgivelse.

Tests bruger midlertidige SQLite-databaser og kontrollerede ord-fixtures. HTTP-integrationstesten starter en lokal server og kontrollerer login, adgang til egne baner og afvisning af ugyldige kald. Testene kræver ikke internet eller private driftsdata.

## Backup, restore og opdatering

Backup kan tages, mens servicen kører. Den bruger SQLites online backup, kontrollerer kopien og gemmer database, `auth-secret` og et manifest med versioner, antal og SHA-256 i en ny mappe. En afbrudt backup efterlades som `.partial` og kan ikke gendannes.

```sh
docker compose exec find-ord npm run backup -- /app/data/backups
docker cp find-ord:/app/data/backups/. ../find-ord-backups/
docker compose exec find-ord rm -rf /app/data/backups
```

Opbevar backupmappen et sikkert sted uden for repositoryet; filerne har rettighed `600`, og `auth-secret` giver adgang til sessioner. Sættes hemmeligheden med `BETTER_AUTH_SECRET` i stedet for filen, skal du selv gemme den. Backuppen indeholder kun data, serveren har modtaget: synkronisér alle enheder (forsiden viser “Alt er synkroniseret”) før backup eller flytning.

Restore kontrollerer checksum, integritet og skemaversion, før noget ændres. En eksisterende database erstattes kun med `--replace` og gemmes først som `find-ord.sqlite.before-restore-<tid>`:

```sh
docker compose stop find-ord
docker compose run --rm -v "$PWD/../find-ord-backups/find-ord-backup-<tid>:/restore:ro" find-ord npm run restore -- /restore --replace
docker compose start find-ord
```

Containeren kører som uid 1000; backupfilerne skal kunne læses af den bruger. Lokalt uden Docker hedder kommandoerne `npm run backup -- <mappe>` og `npm run restore -- <backupmappe> [--replace]` og bruger `DATA_FILE`.

Ved opdatering: tag backup, kør `docker compose up -d --build`, og behold volumet. Migrationer kører ved start i transaktioner; fejler en, beholdes de eksisterende data, og servicen starter ikke. Rul tilbage ved at bygge den tidligere udgave (`git checkout <tidligere commit>`) og gendanne backuppen fra før opdateringen. En backup fra en nyere udgave afvises af en ældre. Ældre backups indeholder data for konti, der senere er slettet; slet eller udskift dem efter din egen opbevaringsperiode, hvis de data ikke skal kunne gendannes. Hold databasen på lokal disk i Docker-volumet, ikke på et delt netværksfilsystem; SQLite i WAL-tilstand understøtter det ikke.

## Ordgrundlag

Det bundtede grundregister er [COR 1.5.1.0](https://ordregister.dk/) fra Dansk Sprognævn. Kilde-TSV: `https://ordregister.dk/files/cor1.5.1.0.tsv`, SHA-256 `1c4d1c06bd676e66be8e8c0af68615c8a892472a05af3b261ba8a9d1f2d2b82b`. Dansk Sprognævn beskriver COR som [frit tilgængeligt og anvendeligt til alle formål](https://www.dsn.dk/forskning/sprogteknologi-og-fagsprog/cor/). Registeret importeres ved første start i én transaktion, og importen registrerer en årsag til hvert udelukket ord. Rapporten kan ses med `npm run import:words`. Kun ord på de redaktionelle kategorilister bliver målord. Listerne har 858 ordformer, og hver har en COR-kilde.

“Alle danske ord” betyder bred, udvidelig og dokumenteret kildedækning, ikke en fuldstændig liste over alle mulige sammensætninger. Kategorier, børnepolitik, forbudte sekvenser og den redaktionelle procedure er beskrevet i [docs/ordindhold.md](docs/ordindhold.md). Dækningen pr. kategori, niveau og profiltype står i [docs/ordrapport.md](docs/ordrapport.md) (`npm run report:words`).
