// Editorial word lists. Every word is a COR 1.5.1.0 word form (see docs/ordindhold.md).
// A word is approved for children when it is listed here and not in adultOnly; words
// that are not listed are never playable. Bump WORD_LIST_VERSION/CATEGORY_TAG_VERSION
// and CHILD_POLICY_VERSION when the lists or child approvals change.
type CategoryDefinition = { name: string; description: string; words: readonly string[]; adultOnly?: Readonly<Record<string, string>> };
const list = (text: string) => text.trim().split(/\s+/);

export const CATEGORIES = {
  farver: {
    name: "Farver",
    description: "Navne på farver og farvenuancer.",
    words: list(`
      RØD BLÅ GUL GRØN SORT HVID BRUN GRÅ PINK LILLA ORANGE TURKIS VIOLET INDIGO BEIGE GYLDEN SØLV GULD CYAN
      KORAL ROSA MØRK LYS LYSEBLÅ MØRKEBLÅ LYSEGRØN MØRKEGRØN LYSERØD MØRKERØD BORDEAUX OLIVENGRØN HIMMELBLÅ
      MARINEBLÅ CITRONGUL KOBOLTBLÅ LAKSEFARVET KARMIN OKKER PURPUR SKARLAGEN AZUR ANTRACIT CREME ELFENBEN
      ASKEGRÅ MUSEGRÅ KONGEBLÅ GRÆSGRØN FLASKEGRØN MINTGRØN TOMATRØD KANARIEGUL SANDFARVET KAKI LAVENDEL
      ROSENRØD KULSORT SNEHVID LYSEBRUN MØRKEBRUN LYSEGRÅ MØRKEGRÅ RUSTRØD`)
  },
  dyr: {
    name: "Dyr",
    description: "Dyr, fugle, fisk og insekter samt deres unger.",
    words: list(`
      HUND KAT MUS GRIS HEST FÅR GED HØNE AND GÅS FISK HAJ HVAL SÆL RÆV ULV BJØRN LØVE TIGER ZEBRA GIRAF ABE
      KAMEL KRABBE ØRN UGLE SVANE SPURV SOMMERFUGL ELEFANT KANIN HAMSTER MARSVIN PAPEGØJE PINGVIN KROKODILLE
      SKILDPADDE FRØ TUDSE SNEGL MYRE HVEPS EDDERKOP MARIEHØNE GULDSMED DELFIN BLÆKSPRUTTE SØSTJERNE VANDMAND
      HUMMER REJE ØRRED LAKS TORSK SILD MAKREL EGERN PINDSVIN GRÆVLING ODDER BÆVER ELG HJORT RÅDYR LEOPARD
      GEPARD JAGUAR PANDA KOALA KÆNGURU NÆSEHORN FLODHEST GORILLA CHIMPANSE ORANGUTANG LAMA ALPAKA ÆSEL TYR
      KALV LAM KALKUN DUE KRAGE RAVN SOLSORT MEJSE MÅGE STORK FLAMINGO PELIKAN STRUDS ISBJØRN HVALROS FIRBEN
      SLANGE HUMLEBI FLAGERMUS MULDVARP ROTTE LEMMING SVIN FØL KYLLING HVALP KILLING SPÆTTE SVALE FASAN
      VASKEBJØRN BÆNKEBIDER REGNORM GUPPY GULDFISK HANE ISFUGL HAREKILLING HARE`)
  },
  natur: {
    name: "Natur",
    description: "Landskaber, vand, planter, træer og himmellegemer.",
    words: list(`
      TRÆ BUSK BLOMST BLAD GRÆS SKOV MARK ENG BJERG BAKKE DAL HAV STRAND STEN SAND JORD VIND REGN SOL MÅNE
      STJERNE SKY MOS MOSE TÅGE SNE KLIPPE EGETRÆ BØGETRÆ GRAN FYR BIRK BØG PIL ASK LIND KASTANJE SVAMP BREGNE
      ROSE TULIPAN MÆLKEBØTTE KLØVER VALMUE LYNG SIV KOGLE AGERN NØD GREN STAMME ROD BARK FRØ FJORD BÆK FLOD
      VANDFALD KILDE SUMP KYST KLIT ØRKEN JUNGLE REGNSKOV VULKAN GLETSJER HULE HALVØ BUGT LAGUNE SKRÆNT SLUGT
      HEDE PRÆRIE SAVANNE OASE KRAT LYSNING SKOVBUND HASSEL HYLD TJØRN NATUR HIMMEL HORISONT SOLOPGANG
      SOLNEDGANG ANEMONE VIOL SNEGLEHUS MUSLING TANG BØLGE ØKOSYSTEM BLÅKLOKKE GÆRDE PLANTE KNOP KRONBLAD
      SOLSIKKE BJERGTOP SKOVSØ INDSØ STRANDENG KLITTER STEPPE TUNDRA KORALREV`)
  },
  mad: {
    name: "Mad",
    description: "Mad, frugt, grøntsager, krydderier og drikkevarer.",
    words: list(`
      BRØD SMØR OST MÆLK MEL RIS PASTA SUPPE SALAT ÆBLE PÆRE BANAN BÆR DRUE TOMAT AGURK GULEROD KARTOFFEL LØG
      ÆRT HONNING KAGE GRØD FISK KYLLING VAND SAFT YOGHURT RUGBRØD BOLLE KIKS SMÅKAGE PANDEKAGE VAFFEL
      FRIKADELLE PØLSE SKINKE BØF KØDBOLLE LASAGNE PIZZA BURGER SPAGHETTI NUDLER APPELSIN CITRON MELON JORDBÆR
      HINDBÆR BLÅBÆR KIRSEBÆR BLOMME FERSKEN ANANAS MANGO KIWI ABRIKOS ROSIN AVOCADO MAJS BROCCOLI BLOMKÅL KÅL
      SPINAT SELLERI PEBERFRUGT SQUASH GRÆSKAR BØNNE LINSE HAVREGRYN MARMELADE LEVERPOSTEJ SALAMI REMOULADE
      KETCHUP SENNEP MAYONNAISE SUKKER SALT PEBER KANEL CHOKOLADE SLIK KAKAO KAFFE JUICE SMOOTHIE SODAVAND
      LIMONADE KÆRNEMÆLK FLØDE SKYR POPCORN PIROG TÆRTE BOLSJE LAKRIDS VANILJE MAKRONER RABARBER STIKKELSBÆR
      SOLBÆR OLIVEN SARDIN TUN REJER LEVER RÅKOST KARTOFFELMOS SKIPPERLABSKOVS BOLLER FLÆSKESTEG KYLLINGEBRYST
      ÆBLESKIVE RISENGRØD HAVREGRØD SPEGEPØLSE VIN SNAPS CHAMPAGNE WHISKY`),
    adultOnly: { VIN: "alkohol", SNAPS: "alkohol", CHAMPAGNE: "alkohol", WHISKY: "alkohol" }
  },
  hjemmet: {
    name: "Hjemmet",
    description: "Rum, møbler, ting og redskaber i et hjem.",
    words: list(`
      HUS DØR VINDUE TAG GULV VÆG BORD STOL SOFA SENG PUDE DYNE LAMPE SKAB HYLDE SPEJL TÆPPE KOP GLAS
      TALLERKEN SKE GAFFEL GRYDE OVN KØKKEN BAD KURV NØGLE KNIV PANDE SKÅL KANDE TEKANDE KØLESKAB FRYSER
      KOMFUR MIKROOVN OPVASKEMASKINE VASKEMASKINE STØVSUGER KOST SPAND KLUD HÅNDKLÆDE SÆBE TANDBØRSTE BADEKAR
      BRUSER TOILET HANE VASK GARDIN REOL SKUFFE KOMMODE LÆNESTOL SKAMMEL TRAPPE KÆLDER LOFT ALTAN TERRASSE
      HAVE HÆK HEGN LÅGE POSTKASSE DØRMÅTTE RADIATOR PEJS STEARINLYS LYSESTAGE BILLEDE MALERI VASE URTEPOTTE
      FJERNSYN RADIO TELEFON COMPUTER SOVEVÆRELSE STUE BADEVÆRELSE ENTRE GANG BRYGGERS VÆKKEUR STRYGEJERN
      SKÆREBRÆT ØSE PISKERIS DØRKLOKKE LAMPESKÆRM HOVEDPUDE SENGETØJ MADRAS KØJESENG VUGGE BARNESTOL SPISEBORD
      SKRIVEBORD ASKEBÆGER`),
    adultOnly: { ASKEBÆGER: "tobak" }
  },
  skolen: {
    name: "Skolen",
    description: "Skoleting, fag, steder og aktiviteter i skolen.",
    words: list(`
      BOG PEN BLYANT PAPIR TASKE LINEAL VISKELÆDER TAVLE KRIDT KLASSE LÆRER ELEV SKOLE TIME PAUSE BORD STOL
      ORD TAL REGNE LÆSE SKRIVE MAPPE HÆFTE BIBLIOTEK FARVE PENSEL SAKS LIM SPIDSER PENALHUS FARVEBLYANT TUSCH
      KUGLEPEN LOMMEREGNER GLOBUS KORT ATLAS ORDBOG LÆSEBOG SKOLETASKE MADPAKKE SKOLEGÅRD FRIKVARTER GYMNASTIK
      DANSK MATEMATIK ENGELSK HISTORIE GEOGRAFI BIOLOGI FYSIK KEMI MUSIK BILLEDKUNST IDRÆT LEKTIE OPGAVE PRØVE
      EKSAMEN KARAKTER ALFABET BOGSTAV SÆTNING STAVE LEGEPLADS PEDEL INSPEKTØR SKOLEBUS KLASSEKAMMERAT PLUS
      MINUS GANGE TABEL SKEMA KLASSELOKALE KATEDER TAVLEKLUD STILEHÆFTE KLADDE DIKTAT OPLÆSNING SKOLEDAG
      SKOLESTART SOMMERFERIE LEKTIEHJÆLP TEGNING TALLINJE BRØK GEOMETRI TRIANGEL KOMPAS VINKEL`)
  },
  sport: {
    name: "Sport",
    description: "Sportsgrene, udstyr, steder og roller i sport.",
    words: list(`
      BOLD MÅL BANE HOLD SPIL LØB HOP KAST SVØM CYKEL TENNIS FODBOLD HÅNDBOLD BADMINTON BASKET TRÆNING SKO NET
      FLØJTE DOMMER SEJR KAMP STAFET MARATON ISHOCKEY SKØJTE SEJLADS RONING SKI GOLF SVØMNING GYMNASTIK
      ATLETIK HØJDESPRING LÆNGDESPRING SPYDKAST KUGLESTØD VOLLEYBALL BASKETBALL BORDTENNIS RIDNING DANS YOGA
      KARATE JUDO BOKSNING BRYDNING SKATEBOARD SURFING KAJAK KLATRING ORIENTERINGSLØB TRIATLON MEDALJE POKAL
      TRØJE STADION HAL MÅLMAND ANGRIBER FORSVARER TRÆNER PUBLIKUM POINT SPILLER SPRINT HOPPE LØBE SPARKE
      KASTE TURNERING FINALE HALVLEG STRAFFESPARK HJØRNESPARK MÅLSTOLPE KETCHER FJERBOLD SKIHOP LANGREND KÆLK
      TRAMPOLIN HULAHOPRING RULLESKØJTE STOPUR STARTSKUD FODBOLDBANE SVØMMEHAL HOLDKAMMERAT`)
  },
  transport: {
    name: "Transport",
    description: "Køretøjer, veje, rejser og det, der hører til dem.",
    words: list(`
      BIL BUS TOG BÅD FÆRGE FLY CYKEL SCOOTER TAXA LASTBIL TRAKTOR METRO SPORVOGN KANO KAJAK SKIB BILLET VEJ
      BRO HAVN STATION SKINNE HJUL MOTOR RAT SÆDE STOP RUTE TUR REJSE HELIKOPTER LUFTHAVN RAKET UBÅD SEJLBÅD
      ROBÅD MOTORCYKEL KNALLERT LØBEHJUL AMBULANCE BRANDBIL POLITIBIL VAREVOGN CAMPINGVOGN MINIBUS GRAVKO KRAN
      TUNNEL MOTORVEJ RUNDKØRSEL LYSKRYDS FORTOV CYKELSTI PARKERING BENZIN PILOT CHAUFFØR KONDUKTØR PASSAGER
      BAGAGE KUFFERT PAS KØREPLAN PERRON ANKER SEJL ÅRE PROPEL VINGE BREMSE GEAR SELE BLINKLYS LYGTE
      NUMMERPLADE TANKSTATION RUTEBIL TOGVOGN LOKOMOTIV FLYVEMASKINE LUFTBALLON SVÆVEFLY TANKBIL CYKELHJELM
      BUSSTOPPESTED CONTAINERSKIB SLÆBEBÅD SPEEDBÅD KØRESTOL BARNEVOGN TRÆKVOGN HESTEVOGN SLÆDE CYKELKURV`)
  },
  vejret: {
    name: "Vejret",
    description: "Vejrfænomener, årstider, målinger og tøj til vejret.",
    words: list(`
      SOL REGN SNE VIND SKY TÅGE FROST VARME KULDE BLÆST STORM BYGE TORDEN LYN REGNBUE HAGL SLUD DUG VEJR
      FORÅR SOMMER EFTERÅR VINTER GRADER KLART SKYET TØVEJR ORKAN SKYBRUD REGNVEJR SOLSKIN SNEVEJR SNEFNUG
      SNEBOLD SNEMAND ISTAP TERMOMETER BAROMETER PROGNOSE VEJRUDSIGT TEMPERATUR NEDBØR HEDEBØLGE TØRKE
      OVERSVØMMELSE PARAPLY REGNFRAKKE GUMMISTØVLE VANTE HUE HALSTØRKLÆDE SKUMRING DAGGRY RIMFROST STORMVEJR
      TORDENVEJR SOLSTRÅLE MÅNESKIN VINDSTØD TORNADO MONSUN ISSLAG REGNSKYL SNESTORM SNEDRIVE SOLCREME
      SOLBRILLER VINDMØLLE VEJRHANE LUFTTRYK HØJTRYK LAVTRYK KOLD VARM BLÆSENDE REGNFULD SOLRIG DISET KLAMT
      FUGTIG TØRVEJR SNESJAP GLATIS`)
  },
  toej: {
    name: "Tøj",
    description: "Tøj, fodtøj, tilbehør og tøjets dele.",
    words: list(`
      BLUSE SKJORTE BUKSER NEDERDEL KJOLE JAKKE FRAKKE TRØJE SWEATER STRIK VEST SOKKER SKO STØVLE SANDAL HUE
      KASKET HAT HANDSKE VANTE HALSTØRKLÆDE TØRKLÆDE BÆLTE SLIPS PYJAMAS NATTØJ KÅBE BADEDRAGT BADEBUKSER
      BIKINI UNDERBUKSER STRØMPER STRØMPEBUKSER REGNTØJ REGNFRAKKE GUMMISTØVLE FLYVERDRAGT LOMME KNAP LYNLÅS
      ÆRME KRAVE HÆTTE SNØREBÅND SHORTS JEANS OVERALL CARDIGAN UNIFORM KOSTUME FORKLÆDE TØFLER HJEMMESKO
      PANDEBÅND RING HALSKÆDE ARMBÅND ØRERING SPÆNDE SELER LUFFER UNDERTRØJE HABIT KAPPE PONCHO DRAGT
      SKOTØJ KNAPHUL`)
  },
  musik: {
    name: "Musik",
    description: "Instrumenter, musikgenrer, musikere og det, der hører til at spille og synge.",
    words: list(`
      GUITAR KLAVER TROMME VIOLIN FLØJTE TROMPET HARMONIKA SAXOFON KLARINET BASUN TUBA CELLO KONTRABAS HARPE
      XYLOFON TAMBURIN TRIANGEL ORGEL BLOKFLØJTE ELGUITAR KEYBOARD MIKROFON HØJTTALER HØRETELEFONER SANG
      SANGER KOR ORKESTER BAND DIRIGENT NODE MELODI RYTME TAKT TONE AKKORD KONCERT SCENE PUBLIKUM DANS
      SALME OPERA MUSICAL KOMPONIST MUSIKER STRENG PLADE RADIO BANJO UKULELE HORN VIOLA FAGOT OBO
      MUNDHARMONIKA KLOKKESPIL SANGBOG VISE OMKVÆD TEKST DUET SOLO KVARTET INSTRUMENT LYD STEMME FESTIVAL ROCK
      JAZZ RAP DISKOTEK TROMMESÆT`)
  },
  erhverv: {
    name: "Erhverv",
    description: "Fag og arbejde, som børn kender fra hverdagen.",
    words: list(`
      LÆGE SYGEPLEJERSKE TANDLÆGE DYRLÆGE BETJENT BRANDMAND LÆRER PÆDAGOG BAGER SLAGTER KOK TJENER FRISØR
      MURER TØMRER ELEKTRIKER SMED MEKANIKER LANDMAND FISKER GARTNER PILOT CHAUFFØR POSTBUD BIBLIOTEKAR
      ARKITEKT INGENIØR PROGRAMMØR FORFATTER JOURNALIST FOTOGRAF KUNSTNER MALER MUSIKER SKUESPILLER ADVOKAT
      DOMMER EKSPEDIENT SÆLGER PRÆST ASTRONAUT FORSKER OPFINDER LIVREDDER JORDEMODER APOTEKER OPTIKER VAGT
      REDAKTØR DESIGNER BUSCHAUFFØR KAPTAJN STYRMAND MATROS SKRÆDDER SKOMAGER URMAGER KONDITOR BLIKKENSLAGER
      SNEDKER PEDEL VÆRKFØRER DIREKTØR SEKRETÆR REVISOR BANKRÅDGIVER KASSERER LAGERARBEJDER PSYKOLOG
      FYSIOTERAPEUT`)
  }
} as const satisfies Record<string, CategoryDefinition>;

export type CategoryId = keyof typeof CATEGORIES;

// Built-in avatars; players pick one of these, no uploads.
export const AVATARS = { ugle: "🦉", raev: "🦊", hval: "🐋", bi: "🐝", skildpadde: "🐢", egern: "🐿️", pingvin: "🐧", froe: "🐸" } as const;
export const AVATAR_NAMES: Record<keyof typeof AVATARS, string> = { ugle: "Ugle", raev: "Ræv", hval: "Hval", bi: "Bi", skildpadde: "Skildpadde", egern: "Egern", pingvin: "Pingvin", froe: "Frø" };
export type AvatarId = keyof typeof AVATARS;
export type LevelId = "let" | "normal" | "svaer" | "ekspert";

// Bump these when the built-in target words or their category assignments change.
export const WORD_LIST_VERSION = 3;
export const CATEGORY_TAG_VERSION = 3;

export const LEVELS: Record<LevelId, { name: string; size: number; words: number; min: number; max: number; directions: number }> = {
  let: { name: "Let", size: 8, words: 6, min: 3, max: 5, directions: 2 },
  normal: { name: "Normal", size: 12, words: 10, min: 3, max: 8, directions: 4 },
  svaer: { name: "Svær", size: 16, words: 15, min: 4, max: 12, directions: 8 },
  ekspert: { name: "Ekspert", size: 20, words: 20, min: 5, max: 16, directions: 8 }
};

export const DIRECTIONS = [
  [0, 1], [1, 0], [0, -1], [-1, 0],
  [1, 1], [1, -1], [-1, 1], [-1, -1]
] as const;

export function directionDescription(level: LevelId): string {
  const allowed = DIRECTIONS.slice(0, LEVELS[level].directions);
  if (allowed.length === 2) return "mod højre eller nedad";
  if (allowed.length === 4) return "vandret eller lodret i begge retninger";
  if (allowed.length === 8) return "vandret, lodret eller diagonalt i begge retninger";
  const names = ["mod højre", "nedad", "mod venstre", "opad", "skråt ned mod højre", "skråt ned mod venstre", "skråt op mod højre", "skråt op mod venstre"];
  return allowed.map((_, index) => names[index]).join(", ");
}

export function normalizedWord(input: string): string {
  return input.normalize("NFC").toLocaleUpperCase("da-DK");
}

// Playable target words for a category; children only get approved words.
export function categoryWords(category: CategoryId, child = false): string[] {
  const definition: CategoryDefinition = CATEGORIES[category];
  const words = [...new Set(definition.words.map(normalizedWord))];
  return child ? words.filter((word) => !definition.adultOnly?.[word]) : words;
}

// Words in the same category that are forms of one COR lemma. A board uses at most one
// word from each group. content.test.ts checks this list against content/ordkilder.tsv.
export const LEMMA_GROUPS: readonly (readonly string[])[] = [
  ["MOS", "MOSE"], ["KLIT", "KLITTER"], ["BOLLE", "BOLLER"], ["SPIL", "SPILLER"], ["LØB", "LØBE"],
  ["HOP", "HOPPE"], ["KAST", "KASTE"], ["SKY", "SKYET"], ["VARM", "VARME"], ["BLÆSENDE", "BLÆST"]
];
const lemmaOf = new Map(LEMMA_GROUPS.flatMap((group) => group.map((word) => [word, group[0]] as const)));
export function lemmaKey(word: string): string {
  return lemmaOf.get(word) ?? word;
}

// Reading level is separate from child approval: 1 = up to 4 letters, 2 = 5–7, 3 = 8 or more.
export function readingLevel(word: string): 1 | 2 | 3 {
  return word.length <= 4 ? 1 : word.length <= 7 ? 2 : 3;
}

export function adultOnlyReason(category: CategoryId, word: string): string | null {
  return (CATEGORIES[category] as CategoryDefinition).adultOnly?.[word] ?? null;
}

// A level is only offered when the profile's own word pool covers it; children never
// fall back to the adult pool.
export function availableLevels(category: CategoryId, child = false): LevelId[] {
  return levelsCoveredBy(categoryWords(category, child));
}

export function levelsCoveredBy(words: readonly string[]): LevelId[] {
  return (Object.keys(LEVELS) as LevelId[]).filter((level) => {
    const setting = LEVELS[level];
    // Forms of one lemma count once, since a board uses at most one of them.
    return new Set(words.filter((word) => word.length >= setting.min && word.length <= setting.max).map(lemmaKey)).size >= setting.words;
  });
}

// "Overrask mig": one category that can generate the chosen level.
export function surpriseCategory(level: LevelId, random: () => number = Math.random, child = false): CategoryId | null {
  const eligible = (Object.keys(CATEGORIES) as CategoryId[]).filter((category) => availableLevels(category, child).includes(level));
  return eligible.length ? eligible[Math.floor(random() * eligible.length)] : null;
}

export function campaignLevels(child = false): LevelId[] {
  return (Object.keys(LEVELS) as LevelId[]).filter((level) =>
    (Object.keys(CATEGORIES) as CategoryId[]).some((category) => availableLevels(category, child).includes(level)));
}
