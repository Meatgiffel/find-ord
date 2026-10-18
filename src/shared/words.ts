export const CATEGORIES = {
  farver: {
    name: "Farver",
    words: "RØD BLÅ GUL GRØN SORT HVID BRUN GRÅ PINK LILLA ORANGE TURKIS VIOLET INDIGO BEIGE GYLDEN SØLV GULD CYAN MAGENTA KORAL ROSA MØRK LYS".split(" ")
  },
  dyr: {
    name: "Dyr",
    words: "HUND KAT MUS KO GRIS HEST FÅR GED HØNE AND GÅS FISK HAJ HVAL SÆL RÆV ULV BJØRN LØVE TIGER ZEBRA GIRAF ABE KAMEL KRABBE ØRN UGLE SVANE SPURV SOMMERFUGL".split(" ")
  },
  natur: {
    name: "Natur",
    words: "TRÆ BUSK BLOMST BLAD GRÆS SKOV MARK ENG BJERG BAKKE DAL SØ Å HAV STRAND STEN SAND JORD VIND REGN SOL MÅNE STJERNE SKY MOS MOSSE TÅGE IS SNE KLIPPE".split(" ")
  },
  mad: {
    name: "Mad",
    words: "BRØD SMØR OST MÆLK ÆG MEL RIS PASTA SUPPE SALAT ÆBLE PÆRE BANAN BÆR DRUE TOMAT AGURK GULEROD KARTOFFEL LØG ÆRT HONNING KAGE GRØD FISK KYLLING VAND SAFT YOGHURT".split(" ")
  },
  hjemmet: {
    name: "Hjemmet",
    words: "HUS DØR VINDUE TAG GULV VÆG BORD STOL SOFA SENG PUDE DYNE LAMPE SKAB HYLDE SPEJL TÆPPE KOP GLAS TALLERKEN SKE GAFFEL GRYDE OVN KØKKEN BAD KURV NØGLE UR".split(" ")
  },
  skolen: {
    name: "Skolen",
    words: "BOG PEN BLYANT PAPIR TASKE LINEAL VISKELÆDER TAVLE KRIDT KLASSE LÆRER ELEV SKOLE TIME PAUSE BORD STOL ORD TAL REGNE LÆSE SKRIVE MAPPE HÆFTE BIBLIOTEK FARVE PENSEL SAKS LIM".split(" ")
  },
  sport: {
    name: "Sport",
    words: "BOLD MÅL BANE HOLD SPIL LØB HOP KAST SVØM CYKEL TENNIS FODBOLD HÅNDBOLD BADMINTON BASKET TRÆNING SKO NET FLØJTE DOMMER SEJR KAMP STAFET MARATON ISHOCKEY SKØJTE SEJLADS RONING SKI GOLF".split(" ")
  },
  transport: {
    name: "Transport",
    words: "BIL BUS TOG BÅD FÆRGE FLY CYKEL SCOOTER TAXA LASTBIL TRAKTOR METRO SPORVOGN KANO KAJAK SKIB BILLET VEJ BRO HAVN STATION SKINNE HJUL MOTOR RAT SÆDE STOP RUTE TUR REJSE".split(" ")
  },
  vejret: {
    name: "Vejret",
    words: "SOL REGN SNE VIND SKY TÅGE IS FROST VARME KULDE BLÆST STORM BRIS BYGE TORDEN LYN REGNBUE HAGL SLUD DUG VEJR FORÅR SOMMER EFTERÅR VINTER GRADER KLART SKYET TØVEJR".split(" ")
  }
} as const;

export type CategoryId = keyof typeof CATEGORIES;
export type LevelId = "let" | "normal" | "svaer" | "ekspert";

// Bump these when the built-in target words or their category assignments change.
export const WORD_LIST_VERSION = 1;
export const CATEGORY_TAG_VERSION = 1;

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

export function availableLevels(category: CategoryId): LevelId[] {
  const words = [...new Set(CATEGORIES[category].words.map(normalizedWord))];
  return (Object.keys(LEVELS) as LevelId[]).filter((level) => {
    const setting = LEVELS[level];
    return words.filter((word) => word.length >= setting.min && word.length <= setting.max).length >= setting.words;
  });
}

// "Overrask mig": one category that can generate the chosen level.
export function surpriseCategory(level: LevelId, random: () => number = Math.random): CategoryId | null {
  const eligible = (Object.keys(CATEGORIES) as CategoryId[]).filter((category) => availableLevels(category).includes(level));
  return eligible.length ? eligible[Math.floor(random() * eligible.length)] : null;
}

export function campaignLevels(): LevelId[] {
  return (Object.keys(LEVELS) as LevelId[]).filter((level) =>
    (Object.keys(CATEGORIES) as CategoryId[]).some((category) => availableLevels(category).includes(level)));
}
