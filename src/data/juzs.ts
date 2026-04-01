export interface JuzData {
  number: number
  verse_mapping: Record<string, string>
  verses_count: number
}

/**
 * Static juz boundaries — the 30 divisions of the Quran.
 * verse_mapping keys are surah numbers, values are "startVerse-endVerse" ranges.
 * Source: quran.com API v4
 */
export const juzs: JuzData[] = [
  { number: 1, verse_mapping: { "1": "1-7", "2": "1-141" }, verses_count: 148 },
  { number: 2, verse_mapping: { "2": "142-252" }, verses_count: 111 },
  { number: 3, verse_mapping: { "2": "253-286", "3": "1-92" }, verses_count: 126 },
  { number: 4, verse_mapping: { "3": "93-200", "4": "1-23" }, verses_count: 131 },
  { number: 5, verse_mapping: { "4": "24-147" }, verses_count: 124 },
  { number: 6, verse_mapping: { "4": "148-176", "5": "1-81" }, verses_count: 110 },
  { number: 7, verse_mapping: { "5": "82-120", "6": "1-110" }, verses_count: 149 },
  { number: 8, verse_mapping: { "6": "111-165", "7": "1-87" }, verses_count: 142 },
  { number: 9, verse_mapping: { "7": "88-206", "8": "1-40" }, verses_count: 159 },
  { number: 10, verse_mapping: { "8": "41-75", "9": "1-92" }, verses_count: 127 },
  { number: 11, verse_mapping: { "9": "93-129", "10": "1-109", "11": "1-5" }, verses_count: 151 },
  { number: 12, verse_mapping: { "11": "6-123", "12": "1-52" }, verses_count: 170 },
  { number: 13, verse_mapping: { "12": "53-111", "13": "1-43", "14": "1-52" }, verses_count: 154 },
  { number: 14, verse_mapping: { "15": "1-99", "16": "1-128" }, verses_count: 227 },
  { number: 15, verse_mapping: { "17": "1-111", "18": "1-74" }, verses_count: 185 },
  { number: 16, verse_mapping: { "18": "75-110", "19": "1-98", "20": "1-135" }, verses_count: 269 },
  { number: 17, verse_mapping: { "21": "1-112", "22": "1-78" }, verses_count: 190 },
  { number: 18, verse_mapping: { "23": "1-118", "24": "1-64", "25": "1-20" }, verses_count: 202 },
  { number: 19, verse_mapping: { "25": "21-77", "26": "1-227", "27": "1-55" }, verses_count: 339 },
  { number: 20, verse_mapping: { "27": "56-93", "28": "1-88", "29": "1-45" }, verses_count: 171 },
  { number: 21, verse_mapping: { "29": "46-69", "30": "1-60", "31": "1-34", "32": "1-30", "33": "1-30" }, verses_count: 178 },
  { number: 22, verse_mapping: { "33": "31-73", "34": "1-54", "35": "1-45", "36": "1-27" }, verses_count: 169 },
  { number: 23, verse_mapping: { "36": "28-83", "37": "1-182", "38": "1-88", "39": "1-31" }, verses_count: 357 },
  { number: 24, verse_mapping: { "39": "32-75", "40": "1-85", "41": "1-46" }, verses_count: 175 },
  { number: 25, verse_mapping: { "41": "47-54", "42": "1-53", "43": "1-89", "44": "1-59", "45": "1-37" }, verses_count: 246 },
  { number: 26, verse_mapping: { "46": "1-35", "47": "1-38", "48": "1-29", "49": "1-18", "50": "1-45", "51": "1-30" }, verses_count: 195 },
  { number: 27, verse_mapping: { "51": "31-60", "52": "1-49", "53": "1-62", "54": "1-55", "55": "1-78", "56": "1-96", "57": "1-29" }, verses_count: 399 },
  { number: 28, verse_mapping: { "58": "1-22", "59": "1-24", "60": "1-13", "61": "1-14", "62": "1-11", "63": "1-11", "64": "1-18", "65": "1-12", "66": "1-12" }, verses_count: 137 },
  { number: 29, verse_mapping: { "67": "1-30", "68": "1-52", "69": "1-52", "70": "1-44", "71": "1-28", "72": "1-28", "73": "1-20", "74": "1-56", "75": "1-40", "76": "1-31", "77": "1-50" }, verses_count: 431 },
  { number: 30, verse_mapping: { "78": "1-40", "79": "1-46", "80": "1-42", "81": "1-29", "82": "1-19", "83": "1-36", "84": "1-25", "85": "1-22", "86": "1-17", "87": "1-19", "88": "1-26", "89": "1-30", "90": "1-20", "91": "1-15", "92": "1-21", "93": "1-11", "94": "1-8", "95": "1-8", "96": "1-19", "97": "1-5", "98": "1-8", "99": "1-8", "100": "1-11", "101": "1-11", "102": "1-8", "103": "1-3", "104": "1-9", "105": "1-5", "106": "1-4", "107": "1-7", "108": "1-3", "109": "1-6", "110": "1-3", "111": "1-5", "112": "1-4", "113": "1-5", "114": "1-6" }, verses_count: 564 },
]
