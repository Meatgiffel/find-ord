# Find ord

**AI-lavet projekt:** Kode, tests, brugerflade og dokumentation er i væsentligt omfang udviklet med AI-assistance fra OpenAI Codex under menneskelig styring. Projektet er en tidlig udgave og er ikke færdigverificeret for sikkerhed, tilgængelighed eller børneindhold. Gennemgå det selv, før du bruger det med rigtige konti eller børn.

Find ord er en dansk ordjagt bygget med Svelte, Node.js, Better Auth og SQLite. Serveren danner baner med én kategori; en hentet bane kan spilles og afsluttes offline i den installérbare PWA. Træk synkroniseres, når serveren igen er tilgængelig.

De aftalte regler og første versions afgrænsning står i [spilreglerne](docs/spilregler.md).
Systemets moduler, aktuelle API og planlagte kontraktændringer står i [arkitektur- og API-beskrivelsen](docs/arkitektur-og-api.md).

## Status og begrænsninger

Den første spilbare udgave har ni kategorier, niveauer som ordpuljen tillader, enkeltbaner og endeløse kampagner, separat login, administration af nye konti, ordmarkering, hints, lokal lagring, synkronisering og 40 achievements. Ekspert er endnu ikke tilgængelig med de indbyggede ordpuljer.

**Børneprofilen er ikke færdigvalideret.** Den bruger foreløbig de indbyggede temalister og en begrænset kontrol af skjulte udtryk i hele gitteret. Ord og sikkerhedspolitik kræver redaktionel gennemgang, før indholdet kan præsenteres som børnesikkert. Samtidige offlineenheder, automatisk backup/restore og fysisk test på iPhone, iPad og Android er heller ikke færdigverificeret.

## Start med Docker

Du skal bruge Docker med Compose. Kopiér [.env.example](.env.example) til `.env`, og tilpas adressen før start. `.env`, databasen og authentication-hemmeligheden må aldrig lægges i Git.

```sh
cp .env.example .env
docker compose up -d --build
docker compose exec find-ord npm run bootstrap
```

Åbn adressen i `BASE_URL`. Bootstrap beder interaktivt om brugernavn, visningsnavn og adgangskode til den første administrator; der findes ingen standardkonto. Administratoren kan derefter oprette separate voksen- og børnekonti i appen. Bootstrap kan kun bruges, når databasen er tom.

Compose gemmer SQLite-database og en lokalt genereret authentication-hemmelighed i volumet `find-ord-data`. Bevar begge dele ved opgradering og backup. Servicen er tænkt til en betroet lokal installation; offentlig interneteksponering er ikke gennemgået.

### Telefon, tablet og HTTPS

PWA-installation på en anden enhed kræver HTTPS med et certifikat, som enheden stoler på. Sæt `BASE_URL` til den eksterne HTTPS-adresse, og lad en reverse proxy videresende til port 3000. Tilføj eventuelle andre tilladte origins i `TRUSTED_ORIGINS` som en kommasepareret liste. Bind helst appens port til loopback eller et afgrænset lokalnet. Almindelig HTTP på lokalnettet sender loginoplysninger og sessionscookies ukrypteret og kan ikke bruges til PWA-installation på en anden enhed.

Første login og nye baner kræver serverkontakt. En komplet hentet bane gemmes på enheden og kan fortsættes offline. Browseren eller brugeren kan slette lokal lagring; synkronisér derfor før rydning af browserdata eller skift af enhed. Serverbackup omfatter kun synkroniserede træk.

En kampagne holder samme sværhedsgrad og skifter kategori mellem banerne. Højst tre uafsluttede baner hentes på forhånd. Når køen er tom, kræver nye baner forbindelse. En udløbet onlinesession stopper ikke allerede hentede baner for den senest indloggede konto; nyt login kræves for synkronisering.

Hver bane har et fast hintbudget: 1 på Let, 2 på Normal, 3 på Svær og 4 på Ekspert. Seneste hints startfelt markeres i gitteret og beskrives med ord og position i tekst, indtil ordet findes. Ældre gemte baner over grænsen beholder deres fremdrift, men kan ikke få flere hints. Ved en konflikt mellem offlineenheder afvises det hint, der overskrider banens grænse; øvrige træk forbliver i køen til nyt synkroniseringsforsøg.

## Udvikling og checks

Node.js 22 og npm kræves til lokal udvikling:

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

## Backup og opdatering

En enkel manuel backup tages med servicen stoppet, så SQLite og authentication-hemmeligheden kopieres konsistent:

```sh
docker compose stop find-ord
backup_dir="../find-ord-backup-$(date +%Y%m%d-%H%M%S)"
mkdir -m 700 "$backup_dir"
docker cp find-ord:/app/data/. "$backup_dir/"
docker compose start find-ord
```

Opbevar backupmappen sikkert uden for repositoryet. Ved opdatering tages backup først, og derefter køres `docker compose up -d --build` uden at fjerne volumet. Automatisk backup og afprøvet restore mangler stadig.

## Ordgrundlag

Det bundtede grundregister er [COR 1.5.1.0](https://ordregister.dk/) fra Dansk Sprognævn. Kilde-TSV: `https://ordregister.dk/files/cor1.5.1.0.tsv`, SHA-256 `1c4d1c06bd676e66be8e8c0af68615c8a892472a05af3b261ba8a9d1f2d2b82b`. Dansk Sprognævn beskriver COR som [frit tilgængeligt og anvendeligt til alle formål](https://www.dsn.dk/forskning/sprogteknologi-og-fagsprog/cor/). Registeret importeres ved første start. Ord herfra bruges først som målord, når de er godkendt og knyttet til en kategori; indtil da bruges de indbyggede temalister.

“Alle danske ord” betyder bred, udvidelig og dokumenteret kildedækning, ikke en fuldstændig liste over alle mulige sammensætninger. Kategorisering af hele COR-registeret og en godkendt børneordliste er planlagt, men endnu ikke leveret.
