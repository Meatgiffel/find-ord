# Spilregler for første version

Beslutningerne styres i [Linear TEA-5](https://linear.app/team-vre/issue/TEA-5/fastlaeg-spilleregler-svaerhedsgrader-og-scope-for-forste-version). Dette dokument er den læsbare specifikation til kode og test. Det beskriver mål for første version; [README](../README.md) beskriver, hvad den nuværende udgave faktisk kan.

## Bane og ord

En bane har præcis én kategori og en liste med unikke målord fra kategorien. Ordene placeres i én ret, ubrudt linje uden knæk eller passage over griddets kant. Kun ens bogstaver må overlappe. Hvert målord skal kunne findes mindst ét sted.

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

Et hint viser startfeltet for et endnu ikke fundet målord. Hintforbruget gemmes, før hintet vises. Samme ord kan kun få ét hint, og banens samlede grænse følger tabellen ovenfor. Pause bevarer banen uden tidsstraf. Opgivelse afslutter den konkrete bane uden gennemførelsesbelønning; et senere forsøg er en ny bane. Når alle ord er fundet, gennemføres banen én gang. Resultatet vises straks, mens endelig progression og achievements afventer servervalidering ved offline spil. Der er ingen nedtælling, tidsbonus eller tidsbaserede achievements.

## Første versions ramme

Spillet er single-player. Multiplayer, ranglister, daglige konkurrencer og udskrivning er ikke releasekrav. En fuldt hentet bane skal kunne spilles og afsluttes offline i en installérbar PWA på telefon/tablet, også efter lukning og genåbning. Første login og hentning af nye baner kræver serverkontakt. Frontend bruger Svelte, TypeScript og Vite. Authentication håndteres af Better Auth, ikke af egen password- eller sessionskode.

Implementering og verifikation af reglerne er fordelt på de efterfølgende Linear-opgaver. Især eksplicit pause/opgivelse og redaktionelt godkendt børneindhold mangler i den nuværende udgave.
