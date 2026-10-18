# Find ord

**AI-lavet projekt:** Kode, tests, brugerflade og dokumentation er i væsentligt omfang udviklet med AI-assistance fra OpenAI Codex under menneskelig styring. Projektet er en tidlig udgave og er ikke færdigverificeret for sikkerhed, tilgængelighed eller børneindhold. Gennemgå det selv, før du bruger det med rigtige konti eller børn.

Find ord er en dansk ordjagt bygget med Svelte, Node.js, Better Auth og SQLite. Serveren danner baner med én kategori; en hentet bane kan spilles og afsluttes offline i den installérbare PWA. Træk synkroniseres, når serveren igen er tilgængelig.

De aftalte regler og første versions afgrænsning står i [spilreglerne](docs/spilregler.md).
Systemets moduler, aktuelle API og planlagte kontraktændringer står i [arkitektur- og API-beskrivelsen](docs/arkitektur-og-api.md).

## Status og begrænsninger

Den første spilbare udgave har ni kategorier, niveauer som ordpuljen tillader, enkeltbaner og endeløse kampagner, separat login, administration af nye konti, ordmarkering, hints, lokal lagring, synkronisering og 40 achievements. Ekspert er endnu ikke tilgængelig med de indbyggede ordpuljer.

**Børneprofilen er ikke færdigvalideret.** Den bruger foreløbig de indbyggede temalister og en begrænset kontrol af skjulte udtryk i hele gitteret. Ord og sikkerhedspolitik kræver redaktionel gennemgang, før indholdet kan præsenteres som børnesikkert. Planlagt automatisk backup og fysisk test på iPhone, iPad og Android er heller ikke færdigverificeret.

## Start med Docker

Du skal bruge Docker med Compose. Kopiér [.env.example](.env.example) til `.env`, og tilpas adressen før start. `.env`, databasen og authentication-hemmeligheden må aldrig lægges i Git.

```sh
cp .env.example .env
docker compose up -d --build
docker compose exec find-ord npm run bootstrap
```

Åbn adressen i `BASE_URL`. Bootstrap beder interaktivt om brugernavn, visningsnavn og adgangskode til den første administrator; der findes ingen standardkonto. Administratoren kan derefter oprette separate voksen- og børnekonti i appen. Bootstrap kan kun bruges, når databasen er tom.

Valgfrit kan `LOG_LEVEL=error` begrænse loggen til fejl, og `GAME_CREATION_LIMIT` (standard 60) styrer, hvor mange nye baner og kampagnepåfyldninger én konto kan hente pr. 10 minutter. Containeren lukker SQLite pænt ned ved `docker compose stop`. Imaget er afprøvet på linux/amd64; linux/arm64 er endnu ikke verificeret.

Compose gemmer SQLite-database og en lokalt genereret authentication-hemmelighed i volumet `find-ord-data`. Bevar begge dele ved opgradering og backup. Servicen er tænkt til en betroet lokal installation; offentlig interneteksponering er ikke gennemgået.

### Telefon, tablet og HTTPS

PWA-installation på en anden enhed kræver HTTPS med et certifikat, som enheden stoler på. Sæt `BASE_URL` til den eksterne HTTPS-adresse, og lad en reverse proxy videresende til port 3000. Tilføj eventuelle andre tilladte origins i `TRUSTED_ORIGINS` som en kommasepareret liste. Bind helst appens port til loopback eller et afgrænset lokalnet. Almindelig HTTP på lokalnettet sender loginoplysninger og sessionscookies ukrypteret og kan ikke bruges til PWA-installation på en anden enhed.

Første login og nye baner kræver serverkontakt. En ny app-version installeres i baggrunden og aktiveres først, når spilleren trykker "Opdatér" på forsiden; den afbryder aldrig en bane, og gemte baner bevares. En komplet hentet bane gemmes på enheden og kan fortsættes offline. Browseren eller brugeren kan slette lokal lagring; synkronisér derfor før rydning af browserdata eller skift af enhed. Serverbackup omfatter kun synkroniserede træk.

En kampagne holder samme sværhedsgrad og skifter kategori mellem banerne. Højst tre uafsluttede baner hentes på forhånd. Når køen er tom, kræver nye baner forbindelse. En udløbet onlinesession stopper ikke allerede hentede baner for den senest indloggede konto; nyt login kræves for synkronisering.

Ved valg af sværhedsgrad og på selve banen vises de tilladte ordretninger. Når en bane er gennemført, vises resultatet ved gitteret med valg om næste eller ny bane og forside. En bane kan også opgives; den tæller så ikke som gennemført. En ny enkeltbane bruger samme kategori og sværhedsgrad. Offline åbnes kun en allerede hentet, uafsluttet bane med de samme valg; hvis der ikke er en, kræver en ny bane forbindelse. Kampagnen fortsætter med en hentet bane, hvis en er klar.

Under et aktivt spil vises kategori, fremdrift og gemmestatus i en kompakt top, og en åbnet bane starter øverst. På mobil i portræt kommer gitteret før ordlisten, og genveje forbinder dem; på lave landskabsskærme står ordlisten ved siden af, og gitteret tilpasses skærmhøjden. Hintknappen og beskeder under spillet ligger ved gitteret, så intet flydende element dækker bogstaverne. Gitteret er ét tabstop, og piletasterne flytter mellem felterne.

Hver bane har et fast hintbudget: 1 på Let, 2 på Normal, 3 på Svær og 4 på Ekspert. Seneste hints startfelt markeres i gitteret og beskrives med ord og position i tekst, indtil ordet findes. Ældre gemte baner over grænsen beholder deres fremdrift, men kan ikke få flere hints. Ved en konflikt mellem offlineenheder afviser serveren kun de træk, der ikke længere er gyldige, fx et hint over banens grænse; øvrige træk gemmes, og spilleren får en forklaring.

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

Generatorprøven bruger 1.000 reproducerbare seeds pr. tilgængelig kategori, niveau og profiltype. Fejl angiver kombination og seed i `reports/generator.json`. GitHub Actions kører hurtige checks og generatorprøven som særskilte jobs og gemmer rapporter som artifacts. Jobbet “Release checks passed” bliver kun grønt, når begge jobs består; gør det til et påkrævet statuscheck før udgivelse.

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

Ved opdatering: tag backup, kør `docker compose up -d --build`, og behold volumet. Migrationer kører ved start i transaktioner; fejler en, beholdes de eksisterende data, og servicen starter ikke. Rul tilbage ved at bygge den tidligere udgave (`git checkout <tidligere commit>`) og gendanne backuppen fra før opdateringen. En backup fra en nyere udgave afvises af en ældre. Hold databasen på lokal disk i Docker-volumet, ikke på et delt netværksfilsystem; SQLite i WAL-tilstand understøtter det ikke.

## Ordgrundlag

Det bundtede grundregister er [COR 1.5.1.0](https://ordregister.dk/) fra Dansk Sprognævn. Kilde-TSV: `https://ordregister.dk/files/cor1.5.1.0.tsv`, SHA-256 `1c4d1c06bd676e66be8e8c0af68615c8a892472a05af3b261ba8a9d1f2d2b82b`. Dansk Sprognævn beskriver COR som [frit tilgængeligt og anvendeligt til alle formål](https://www.dsn.dk/forskning/sprogteknologi-og-fagsprog/cor/). Registeret importeres ved første start. Ord herfra bruges først som målord, når de er godkendt og knyttet til en kategori; indtil da bruges de indbyggede temalister.

“Alle danske ord” betyder bred, udvidelig og dokumenteret kildedækning, ikke en fuldstændig liste over alle mulige sammensætninger. Kategorisering af hele COR-registeret og en godkendt børneordliste er planlagt, men endnu ikke leveret.
