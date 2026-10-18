# Ordindhold, kategorier og børnepolitik

Dette dokument beskriver, hvor ordene kommer fra, hvordan de fordeles i kategorier, og hvilke ord børn må møde. Dækningstal står i [ordrapporten](ordrapport.md), som genereres med `npm run report:words`.

## Kilde

Basisdatasættet er [COR 1.5.1.0](https://ordregister.dk/) fra Dansk Sprognævn. Det er pakket med installationen som `assets/cor1.5.1.0.tsv.gz` og kan bruges uden internet. Ifølge Dansk Sprognævn er grundressourcen frit anvendelig. Udvidelser som COR.EXT bruges ikke; de vurderes hver for sig, før de tages i brug.

| | |
|---|---|
| Kilde-URL | `https://ordregister.dk/files/cor1.5.1.0.tsv` |
| SHA-256 for kilde-TSV | `1c4d1c06bd676e66be8e8c0af68615c8a892472a05af3b261ba8a9d1f2d2b82b` |
| SHA-256 for pakket fil | `9f845f54acc19da4acdb44e3d690e811f0c595ef7f9d3d7c23cc027e60ad7a46` |
| Hentet | Senest 2026-10-16. Importen afviser filen, hvis checksummen ikke passer. |
| Kreditering | `assets/KILDER.md` følger med distributionen. |

### Import

Serveren importerer registeret ved første start. Importen kan også køres med `npm run import:words`, som udskriver en rapport over de importerede og udelukkede ord.

- Importen sker i én transaktion. En forkert checksum, en ulæselig fil eller en afbrudt import efterlader den senest fuldførte version urørt.
- Ordformer normaliseres til NFC og store bogstaver efter dansk sprog. Æ, Ø og Å er selvstændige bogstaver.
- Kun rækker, som COR markerer som normerede (`N`), bruges. Konstruerede former (`K`) og unormerede former (`U`) udelukkes.
- Former med mellemrum, bindestreg, punktum, tal, accenter eller andre tegn udelukkes med en registreret årsag. Det samme gælder ord på under 3 eller over 20 bogstaver. Intet omskrives i stilhed.
- Samme stavemåde fra flere lemmaer eller bøjninger bliver én spilbar ordform (`lexicon_form`). Alle kilderækker bevares i `lexicon_source` med COR-ID, lemma, original form og ordklasse.
- Rapporten gemmes i `lexicon_import` og viser antal kilderækker, spilbare former, sammenlagte rækker og udelukkede rækker pr. årsag.

COR er et register over almindelige ord, så egennavne indgår stort set ikke. Låneord bruges, når de staves med A–Z og ÆØÅ (fx PIZZA og SQUASH). Låneord med accent (fx CAFÉ) udelukkes.

"Alle danske ord" betyder den bredeste dokumenterede dækning i de valgte kilder. Det betyder ikke alle tænkelige sammensætninger.

## Kategorier

En bane bruger ord fra præcis én kategori. Kun ord, der står på en kategoris redaktionelle liste i `src/shared/words.ts`, kan blive målord. Der findes ingen "alle ord"-fallback, så ord fra COR, der ikke er kategoriseret, bliver aldrig målord. Et ord kan høre til flere kategorier, fx FISK i både Dyr og Mad. Tilknytningen gælder i den kategori, banen er lavet i.

| ID | Navn | Med | Ikke med |
|---|---|---|---|
| `farver` | Farver | Farvenavne og sammensatte nuancer (LYSEBLÅ, KULSORT). | Ting, der blot har en farve. |
| `dyr` | Dyr | Pattedyr, fugle, fisk, krybdyr, insekter og dyreunger. | Kødretter (hører under Mad) og fabeldyr. |
| `natur` | Natur | Landskaber, vand, planter, træer, sten og himmellegemer. | Vejrfænomener (Vejret) og dyr (Dyr). |
| `mad` | Mad | Mad, frugt, grønt, krydderier og drikkevarer. | Køkkenredskaber (Hjemmet). |
| `hjemmet` | Hjemmet | Rum, møbler, husholdningsting, have og redskaber. | Bygninger uden for hjemmet. |
| `skolen` | Skolen | Skoleting, fag, steder, roller og aktiviteter i skolen. | Generelle ord uden en tydelig skolebetydning. |
| `sport` | Sport | Sportsgrene, udstyr, steder, roller og bevægelser i sport. | Fritidsting uden en tydelig sportsbetydning. |
| `transport` | Transport | Køretøjer, infrastruktur, rejser, dele og personale. | Vejrforhold og steder uden en transportfunktion. |
| `vejret` | Vejret | Vejrfænomener, årstider, målinger, vejrord og tøj mod vejret. | Landskaber (Natur). |

Regler for tvetydige ord og bøjninger:

- Et ord står i en kategori, når dets almindelige betydning passer til kategorien. For eksempel står HANE både som dyr og som vandhane i Hjemmet.
- Ord, der mest forstås på en anden måde end kategorien, tages ikke med.
- Listerne indeholder mest grundformer. En bøjningsform skal stå på listen for sig selv og findes i COR, fx REJER og BOLLER.
- Ord på under 3 bogstaver står ikke på listerne. Intet niveau kan bruge dem.
- En kategori må gerne have beslægtede underemner, fx dyreunger under Dyr. Der skal dog være en tydelig sammenhæng med kategoriens navn.
- Kategori og børneegnethed er adskilte. At et ord står under Mad, gør det ikke godkendt til børn.

Niveauet styrer ordlængde, gitterstørrelse, antal ord og retninger, men ikke ordklassen. Ordklassen bestemmes af kategorilisterne, som mest består af navneord og nogle få tillægsord og udsagnsord (fx KLART og LØBE). Hvert niveau har en minimumslængde og en maksimumslængde for ordene. Et niveau tilbydes kun i en kategori, når kategorien har mindst så mange ord med en tilladt længde, som en bane bruger. Det gælder for hver profiltype for sig. Børn får aldrig voksenlisten i stedet. Er der for få ord, bliver niveauet skjult for den profil. Dækningen pr. kategori, niveau og profiltype står i ordrapporten.

## Børnepolitik (version 3)

En børneprofil møder kun målord, der er eksplicit godkendt til børn. Ukendte og ikke-gennemgåede ord er aldrig godkendte.

### Godkendelse

- Et ord er godkendt til børn, når det står på en kategoriliste uden en markering i `adultOnly`. Hvert ord på listerne er gennemgået enkeltvis efter reglerne nedenfor. Det gælder også bøjningsformer.
- Ord, der kun er til voksne, står på kategorilisten med en begrundelse i `adultOnly`, fx VIN (alkohol) og ASKEBÆGER (tobak).
- Ord, der ikke er egnede til nogen profil, kommer slet ikke på listen. Et automatisk forslag, fx fra COR, bliver aldrig godkendt af sig selv.
- Læseniveau er adskilt fra godkendelsen. Det beregnes ud fra ordets længde: 1 er op til 4 bogstaver, 2 er 5–7 bogstaver og 3 er 8 eller flere.
- Godkendelse, begrundelse, læseniveau og COR-kilde står for hvert ord i `content/ordkilder.tsv`. Politikversionen står i hver børnebane.

### Indhold børn ikke må møde som målord

| Område | Regel | Grænsetilfælde |
|---|---|---|
| Seksualiseret sprog | Aldrig. | Anatomiske ord bruges ikke som målord. |
| Skældsord og bandeord | Aldrig. | Milde ord som TÅBE er heller ikke med. |
| Hadefulde udtryk | Aldrig, heller ikke ord, der også bruges som skældsord. | BØSSE bruges ikke, selv om ordet også betyder sparebøsse og gevær. |
| Rusmidler | Alkohol, tobak og stoffer er kun for voksne. | Saft, sodavand og kaffe er tilladt. |
| Vold | Våben, krig og drab bruges ikke. | Hverdagsredskaber som KNIV og SAKS er tilladt. Kampsport som KARATE og BOKSNING er tilladt som sport. |
| Uhygge og død | Bruges ikke som målord. | Dyr og natur er tilladt, også rovdyr og slanger. |

Er et ord tvetydigt, tages den mest almindelige betydning for et barn i skolealderen. Kan en almindelig betydning være stødende, tages ordet ikke med.

### Forbudte sekvenser i hele gitteret

Fyldbogstaver kan tilfældigt danne et ord. Derfor gennemsøges hele børnegitteret i alle otte retninger for sekvenserne i `BLOCKED_SEQUENCES` i `src/shared/safety.ts`. Søgningen fanger også omvendte forekomster og sekvenser inde i længere bogstavrækker. En børnebane med et fund bliver ikke udleveret, og en gemt børnebane med et fund afvises ved validering. Listen vises ikke i appen.

Undtagelse for falske positiver: Ligger en sekvens inde i et børnegodkendt ord på samme linje, er der ikke tale om et fund. Det gælder, uanset hvilken retning ordet læses i. For eksempel er PIS en del af SPISEBORD, og PIK står baglæns i SKIPPERLABSKOVS. Testene sikrer, at ingen godkendt børneord i sig selv bliver blokeret.

### Redaktionel kontrol

Ændringer i listerne følger en fast procedure:

1. Ret listen eller `adultOnly` i `src/shared/words.ts`, og tag stilling til hvert nyt ord efter tabellen ovenfor.
2. Hæv `WORD_LIST_VERSION` og `CATEGORY_TAG_VERSION`. Hæv `CHILD_POLICY_VERSION`, hvis børnegodkendelser eller blokerede sekvenser ændres.
3. Kør `npm run report:words`. Kommandoen fejler, hvis et ord mangler i COR, og den opdaterer kildefilen og ordrapporten.
4. Kør `npm test` og `npm run test:generator`. Testene tjekker, at kildefilen er ajour, at der er mindst 500 børneord, at børnebaner kun bruger børneord, og at undtagelserne virker.
5. Gennemgå ændringen i diffen af `content/ordkilder.tsv`, før den godkendes.

Gemte baner kan fortsat spilles efter en ny ordlisteversion, så længe alle deres målord stadig står på den aktive liste. En ny børnepolitik får derimod tidligere børnebaner til at udløbe.

### Kendte begrænsninger

- Kontrollen håndhæver den valgte politik. Den kan ikke opdage enhver stødende tolkning, fx et sammenfald på tværs af sprog eller et nyt slangudtryk.
- Listerne og godkendelserne er lavet af én redaktør (Claude) på ejerens vegne. Ejeren kan til enhver tid rette dem.
- Sekvenser på tre bogstaver som PIS og HAD fanger også harmløse bogstavrækker. Generatoren prøver derfor flere sæt fyldbogstaver. Det gør børnebaner lidt mindre tilfældige end voksenbaner.
