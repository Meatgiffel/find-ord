# Udgivelser

## Ikke udgivet

### Data

- Serveren gemmer enhedens rækkefølge og tidspunkt for hvert træk adskilt fra servertiden (databasemigration 10). Opbevaringspolitikken for spildata står i [arkitektur- og API-beskrivelsen](docs/arkitektur-og-api.md#opbevaring-og-genberegning) ([TEA-35](https://linear.app/team-vre/issue/TEA-35)).

## 0.2.0 – 2026-10-19

Nyt udseende efter redesignet i Claude Design ([TEA-66](https://linear.app/team-vre/issue/TEA-66)). Stadig en forudgivelse: test på fysiske enheder mangler ([TEA-48](https://linear.app/team-vre/issue/TEA-48)).

### Udseende

- Nye farver med mørk tilstand og skrifterne Atkinson Hyperlegible og Bricolage Grotesque, som ligger i appen og virker offline.
- Forside, login, opsætning af første administrator og administration følger det nye layout. Låste niveauer vises med lås og forklaring.

### Spil

- Fundne ord får en farvet kapsel, og korte beskeder vises øverst i gitteret.
- 16×16 og 20×20 på små skærme vises som et udsnit med minikort, pileknapper og panorering ved kanten under et træk. "Hele gitteret" giver overblik.
- Ét hint ad gangen. "Opgiv bane" bekræftes direkte på siden, og de manglende ord vises bagefter i gitteret.

### Kendte begrænsninger

- Kantpanorering og felter på 35 px er ikke testet på en rigtig telefon.
- Engangskode til nye spillere, "Sidst aktiv" og meddelelsen om fuld disk fra designet er ikke med.

## 0.1.0 – 2026-10-18

Første udgivelse. Det er en forudgivelse: alt kører og er testet i browser og Docker, men testen på fysiske iPhone-, iPad- og Android-enheder mangler stadig ([TEA-48](https://linear.app/team-vre/issue/TEA-48)). Version 1.0.0 udkommer, når releasechecket i [TEA-40](https://linear.app/team-vre/issue/TEA-40) er gennemført.

### Spil

- Dansk ordjagt med tolv kategorier og fire niveauer: Let 8×8, Normal 12×12, Svær 16×16 og Ekspert 20×20. Bogstaverne Æ, Ø og Å er selvstændige.
- Enkeltbaner med "Overrask mig" og endeløse kampagner med fast niveau og skiftende kategorier.
- Markering med træk, tryk eller tastatur. Hints har et budget pr. bane og koster hintkreditter, som optjenes ved frivillige mål uden tidsfrist.
- 47 achievements, statistik og frivillige mål, alle beregnet på serveren.

### Ord og børn

- 1.050 kuraterede ord med kilde i Dansk Sprognævns COR 1.5.1.0, heraf 1.045 godkendt til børn efter den dokumenterede børnepolitik. Hele gitteret tjekkes for uønskede bogstavrækker.
- En bane bruger højst én bøjning af hvert grundord, og ord fra de seneste baner gentages så lidt som muligt.
- Administratorer kan gennemse ordlister, kilder og dækning i appen.

### Konti og offline

- Første administrator oprettes via et engangslink. Administratoren opretter voksen- og børnekonti, nulstiller adgangskoder og sletter konti.
- Installérbar PWA. Hentede baner kan spilles og afsluttes offline, og trækkene synkroniseres bagefter med præcis ét resultat.

### Drift

- Docker Compose med SQLite, backup og restore, `/api/ready` og JSON-logs med request-ID.
- Banerne dannes i en worker-tråd med cache, begrænset kø og tidsbudget. En fuld disk giver en fejlbesked i stedet for et nedbrud.
- Målt kapacitet: 5 samtidige spillere med p95 under 50 ms for ordfund og 254 ms for en ny bane på referencehardwaren.

### Kendte begrænsninger

- Ikke testet på fysiske telefoner og tablets, med VoiceOver eller TalkBack, eller på linux/arm64.
- Ordlister og børnepolitik er lavet af AI på ejerens vegne og er ikke gennemgået af en uafhængig redaktør.
- Kun tænkt til en betroet lokal installation; offentlig interneteksponering er ikke gennemgået.
