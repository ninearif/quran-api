export interface ReciterData {
  id: number;
  name: string;
  style: string;
  /** Word-by-word segments available; otherwise ayah-level timings only */
  hasWordTimings: boolean;
  /** mp3quran.net read id (ayah-level source). Absent for quran.com reciters */
  ayahTimingsRead?: number;
  /** Path under cdn.mp3quran.net/audio/ holding NNN.mp3 surah files */
  audioFolder?: string;
  /** Surahs served from mp3quran instead of quran.com, because quran.com's mp3 is a different recording from its timings */
  mp3quranSurahs?: { read: number; audioFolder: string; chapters: number[] };
}

/**
 * Reciters with word-level segments (quran.com) or ayah-level timings (mp3quran.net).
 * Word-level IDs are quran.com (QDC) reciter IDs. Excluded on purpose: 168 (Minshawi
 * "kids repeat" — each verse is recited twice, so segments double up) and
 * 173 (second Afasy recording under the same name).
 */
export const reciters: ReciterData[] = [
  {
    id: 7,
    name: "Mishari Rashid al-Afasy",
    style: "Murattal",
    hasWordTimings: true,
    // quran.com's 37, 78 and 82 mp3s line up with only 50-67% of their ayah boundaries (chance level); the other 111 surahs line up with 92-100%
    mp3quranSurahs: {
      read: 123,
      audioFolder: "mishary-alafasy/r1",
      chapters: [37, 78, 82],
    },
  },
  {
    id: 2,
    name: "AbdulBaset AbdulSamad",
    style: "Murattal",
    hasWordTimings: true,
  },
  {
    id: 1,
    name: "AbdulBaset AbdulSamad",
    style: "Mujawwad",
    hasWordTimings: true,
  },
  {
    id: 3,
    name: "Abdur-Rahman as-Sudais",
    style: "Murattal",
    hasWordTimings: true,
  },
  {
    id: 4,
    name: "Abu Bakr al-Shatri",
    style: "Murattal",
    hasWordTimings: true,
  },
  { id: 5, name: "Hani ar-Rifai", style: "Murattal", hasWordTimings: true },
  {
    id: 6,
    name: "Mahmoud Khalil Al-Husary",
    style: "Murattal",
    hasWordTimings: true,
  },
  {
    id: 12,
    name: "Mahmoud Khalil Al-Husary",
    style: "Muallim",
    hasWordTimings: true,
  },
  {
    id: 9,
    name: "Mohamed Siddiq al-Minshawi",
    style: "Murattal",
    hasWordTimings: true,
  },
  {
    id: 10,
    name: "Sa`ud ash-Shuraym",
    style: "Murattal",
    hasWordTimings: true,
  },
  {
    id: 97,
    name: "Yasser Ad Dussary",
    style: "Murattal",
    hasWordTimings: true,
  },
  {
    id: 161,
    name: "Khalifah Al Tunaiji",
    style: "Murattal",
    hasWordTimings: true,
  },

  // Ayah-level timings from mp3quran.net (no word segments). IDs are
  // 1000 + mp3quran read id so they never collide with quran.com IDs.
  {
    id: 1133,
    name: "Maher Al-Muaiqly",
    style: "Murattal",
    hasWordTimings: false,
    ayahTimingsRead: 133,
    audioFolder: "maher-muaiqly/r3",
  },
  {
    id: 1030,
    name: "Saad Al-Ghamdi",
    style: "Murattal",
    hasWordTimings: false,
    ayahTimingsRead: 30,
    audioFolder: "saad-ghamdi/r1",
  },
  {
    id: 1043,
    name: "Salah Al-Budair",
    style: "Murattal",
    hasWordTimings: false,
    ayahTimingsRead: 43,
    audioFolder: "salah-budair/r1",
  },
  {
    id: 1005,
    name: "Ahmed ibn Ali al-Ajamy",
    style: "Murattal",
    hasWordTimings: false,
    ayahTimingsRead: 5,
    audioFolder: "ahmad-ajmi/r1",
  },
  {
    id: 1076,
    name: "Ali Jaber",
    style: "Murattal",
    hasWordTimings: false,
    ayahTimingsRead: 76,
    audioFolder: "ali-jaber/r1",
  },
  {
    id: 1122,
    name: "Mahmoud Ali Al-Banna",
    style: "Mujawwad",
    hasWordTimings: false,
    ayahTimingsRead: 122,
    audioFolder: "mahmoud-banna/r2",
  },
  {
    id: 1288,
    name: "Mustafa Ismail",
    style: "Mujawwad",
    hasWordTimings: false,
    ayahTimingsRead: 288,
    audioFolder: "mustafa-ismail/r2",
  },
  {
    id: 1109,
    name: "Muhammad Ayyoub",
    style: "Murattal",
    hasWordTimings: false,
    ayahTimingsRead: 109,
    audioFolder: "muhammad-ayyub/r1",
  },
  {
    id: 1086,
    name: "Nasser Al-Qatami",
    style: "Murattal",
    hasWordTimings: false,
    ayahTimingsRead: 86,
    audioFolder: "nasser-qatami/r1",
  },
  {
    id: 1106,
    name: "Mohamed al-Tablawi",
    style: "Murattal",
    hasWordTimings: false,
    ayahTimingsRead: 106,
    audioFolder: "muhammad-tablawi/r1",
  },
  {
    id: 1081,
    name: "Fares Abbad",
    style: "Murattal",
    hasWordTimings: false,
    ayahTimingsRead: 81,
    audioFolder: "fares-abbad/r1",
  },
  {
    id: 1012,
    name: "Idrees Abkar",
    style: "Murattal",
    hasWordTimings: false,
    ayahTimingsRead: 12,
    audioFolder: "idrees-abkar/r1",
  },
];

export const DEFAULT_RECITER_ID = 7;
