# Spilregler for første version

Beslutningerne styres i [Linear TEA-5](https://linear.app/team-vre/issue/TEA-5/fastlaeg-spilleregler-svaerhedsgrader-og-scope-for-forste-version). Dette dokument er den læsbare specifikation til kode og test. Det beskriver mål for første version; [README](../README.md) beskriver, hvad den nuværende udgave faktisk kan.

## Bane og ord

En bane har præcis én kategori og en liste med unikke målord fra kategorien. Ordene placeres i én ret, ubrudt linje uden knæk eller passage over griddets kant. Kun ens bogstaver må overlappe. Hvert målord skal kunne findes mindst ét sted. Tomme felter fyldes med A–Z og Æ, Ø, Å efter en fast vægtet fordeling, der groft følger dansk bogstavhyppighed (`LETTERS` i `src/shared/game.ts`); C, Q, W, X og Z bruges ikke som fyld.

Et fund godkendes, når den valgte linje staver et endnu ikke fundet målord i en retning, som niveauet tillader. Det gælder også en ekstra forekomst skabt af fyldbogstaver. En ordform kan kun tælle én gang på samme bane, selv om den findes flere steder, markeres igen eller er et palindrom, der læses ens i begge retninger. En linje uden for griddet, med knæk eller i en ikke tilladt retning afvises.

## Niveauer

| Niveau | Grid | Målord | Længde | Retninger | Hints pr. bane |
| --- | ---: | ---: | ---: | --- | ---: |
| Let | 8×8 | 6 | 3–5 | → ↓ | 1 |
| Normal | 12×12 | 10 | 3–8 | → ← ↑ ↓ | 2 |
| Svær | 16×16 | 15 | 4–12 | Alle otte | 3 |
| Ekspert | 20×20 | 20 | 5–16 | Alle otte | 4 |

Parametrene er startværdier. Ændringer kræver dokumenteret afprøvning af ordpulje, generering og brugbarhed på telefon/tablet. Kategori, niveau og børnepolitik er separate valg. En kombination kan kun vælges, når der er nok forskellige egnede ord, og banen kan genereres og valideres. Ellers vises den som utilgængelig med forklaring.

Børnebaner må på alle niveauer kun bruge særskilt godkendte ord og grids. Den redaktionelle godkendelse er endnu ikke leveret; den nuværende udgave må derfor ikke præsenteres som færdigvalideret for børn.

## Kategorier

Startkategorierne er Farver, Dyr, Natur, Mad, Hjemmet, Skolen, Sport, Transport og Vejret. Et ord kan være knyttet til flere kategorier i ordgrundlaget, men alle målord på en bane tilhører banens ene kategori. “Overrask mig” vælger én tilgængelig kategori for den valgte profil og det valgte niveau. Skærmen viser kategori, ordliste med afkrydsning og et stort interaktivt bogstavgitter på dansk.

## Hjælp, pause og afslutning

Et hint viser startfeltet for et endnu ikke fundet målord. Hintforbruget gemmes, før hintet vises. Samme ord kan kun få ét hint, og banens samlede grænse følger tabellen ovenfor. Hvert hint koster desuden 1 hintkredit.

## Mål og hintkreditter

Hver konto starter med 2 hintkreditter og kan højst have 5. Der er altid 3 aktive mål af forskellige typer: find et antal ord, find ord med Æ, Ø eller Å, find lange ord (mindst 8 bogstaver), gennemfør en bane uden hint, gennemfør en bane i en bestemt kategori, eller gennemfør en bane på et bestemt niveau (Normal eller sværere). Kategorier og niveauer vælges kun blandt dem, profilen kan spille. Målene har ingen tidsfrist og kræver ingen daglige serier, og de kan alle klares uden hints.

- Et mål tæller kun validerede træk, som serveren har modtaget efter målets start. Gentaget synkronisering og genåbning tæller ikke dobbelt.
- Et klaret mål giver 1 kredit én gang. Er saldoen fuld, venter krediten, og målet bliver stående, til der er plads. Derefter erstattes det af et nyt mål.
- Kreditter kan ikke købes og udløber ikke. Et hint trækker 1 kredit i samme transaktion som hintet. Samme hint koster aldrig to gange, og saldoen bliver aldrig negativ.
- Offline bruges den senest bekræftede saldo minus de hints, der venter på synkronisering. Bruger to offlineenheder den samme kredit, afviser serveren det hint, der kommer sidst, og forklarer hvorfor. Ordfund i samme synkronisering gemmes stadig. Fremdrift på mål vises først, når serveren har godkendt trækkene. Pause bevarer banen uden tidsstraf. Opgivelse afslutter den konkrete bane uden gennemførelsesbelønning; et senere forsøg er en ny bane. Når alle ord er fundet, gennemføres banen én gang. Resultatet vises straks, mens endelig progression og achievements afventer servervalidering ved offline spil. Der er ingen nedtælling, tidsbonus eller tidsbaserede achievements.

Kataloget har 40 achievements. Tildelinger fratages aldrig. Tre mål kræver Ekspert. Ændres en regel eller tærskel, får målet et nyt ID, og den gamle tildeling bevares i historikken.

## Første versions ramme

Spillet er single-player. Multiplayer, ranglister, daglige konkurrencer og udskrivning er ikke releasekrav. En fuldt hentet bane skal kunne spilles og afsluttes offline i en installérbar PWA på telefon/tablet, også efter lukning og genåbning. Første login og hentning af nye baner kræver serverkontakt. Frontend bruger Svelte, TypeScript og Vite. Authentication håndteres af Better Auth, ikke af egen password- eller sessionskode.

Implementering og verifikation af reglerne er fordelt på de efterfølgende Linear-opgaver. Opgivelse er implementeret. Pause er i den nuværende udgave det samme som at forlade banen, der altid er gemt; en særskilt pausetilstand findes ikke. Redaktionelt godkendt børneindhold mangler fortsat.
