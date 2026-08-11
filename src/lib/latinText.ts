const devanagariVowels: Record<string, string> = {"अ":"a","आ":"aa","इ":"i","ई":"i","उ":"u","ऊ":"u","ऋ":"ri","ए":"e","ऐ":"ai","ओ":"o","औ":"au"};
const devanagariSigns: Record<string, string> = {"ा":"aa","ि":"i","ी":"i","ु":"u","ू":"u","ृ":"ri","े":"e","ै":"ai","ो":"o","ौ":"au","ॅ":"e","ॉ":"o"};
const devanagariConsonants: Record<string, string> = {
  "क":"k","ख":"kh","ग":"g","घ":"gh","ङ":"n","च":"ch","छ":"chh","ज":"j","झ":"jh","ञ":"ny",
  "ट":"t","ठ":"th","ड":"d","ढ":"dh","ण":"n","त":"t","थ":"th","द":"d","ध":"dh","न":"n",
  "प":"p","फ":"ph","ब":"b","भ":"bh","म":"m","य":"y","र":"r","ल":"l","व":"v","श":"sh",
  "ष":"sh","स":"s","ह":"h","ळ":"l","क़":"q","ख़":"kh","ग़":"gh","ज़":"z","ड़":"d","ढ़":"dh","फ़":"f","य़":"y",
};
const devanagariDigits: Record<string, string> = {"०":"0","१":"1","२":"2","३":"3","४":"4","५":"5","६":"6","७":"7","८":"8","९":"9"};
const arabicWords: Record<string, string> = {
  "کیا":"kya", "کر":"kar", "رہی":"rahi", "رہا":"raha", "ہو":"ho",
  "مجھے":"mujhe", "میں":"main", "ہاں":"haan", "بولو":"bolo",
  "کھولو":"kholo", "کھول":"khol", "کرو":"karo", "شری":"shree",
  "شریے":"shree", "سری":"shree", "نمستے":"namaste",
};
const arabicCharacters: Record<string, string> = {
  "ا":"a","آ":"aa","أ":"a","إ":"i","ب":"b","پ":"p","ت":"t","ٹ":"t","ث":"s",
  "ج":"j","چ":"ch","ح":"h","خ":"kh","د":"d","ڈ":"d","ذ":"z","ر":"r","ڑ":"r",
  "ز":"z","ژ":"zh","س":"s","ش":"sh","ص":"s","ض":"z","ط":"t","ظ":"z","ع":"",
  "غ":"gh","ف":"f","ق":"q","ک":"k","ك":"k","گ":"g","ل":"l","م":"m","ن":"n",
  "ں":"n","و":"o","ؤ":"o","ہ":"h","ه":"h","ھ":"h","ء":"'","ی":"y","ي":"y",
  "ئ":"y","ے":"e","ۓ":"e","ة":"h","ى":"a","،":",","؟":"?",
};
const commonScriptWords: Record<string, string> = {
  "మూడు":"three", "శ్రీ":"shree", "শ্রী":"shree", "ਸ੍ਰੀ":"shree",
  "શ્રી":"shree", "ஸ்ரீ":"shree", "ಶ್ರೀ":"shree", "ശ്രീ":"shree",
};

const romanizeWord = (value: string): string => {
  let output = "";
  for (let index = 0; index < value.length; index += 1) {
    const character = value[index];
    const consonant = devanagariConsonants[character];
    if (consonant) {
      output += consonant;
      const following = value[index + 1] || "";
      if (following === "्") { index += 1; continue; }
      if (devanagariSigns[following]) { output += devanagariSigns[following]; index += 1; continue; }
      output += "a";
      continue;
    }
    if (devanagariVowels[character]) output += devanagariVowels[character];
    else if (character === "ं" || character === "ँ") output += "n";
    else if (character === "ः") output += "h";
    else if (character === "।" || character === "॥") output += ".";
    else if (character !== "़" && character !== "्") output += devanagariDigits[character] ?? character;
  }
  if (output.endsWith("a") && output.length > 1) output = output.slice(0, -1);
  return output.replaceAll("kyaa", "kya").replaceAll("Kyaa", "Kya").replaceAll("iyaa", "iya");
};

export const toLatinDisplayText = (value: string): string => {
  const protectedSegments = /(```[\s\S]*?```|`[^`\n]*`|(?:https?|file):\/\/[^\s]+)/gi;
  return value.split(protectedSegments).map((segment) => {
    if (protectedSegments.test(segment)) { protectedSegments.lastIndex = 0; return segment; }
    protectedSegments.lastIndex = 0;
    let converted = segment;
    for (const [source, replacement] of Object.entries(commonScriptWords)) {
      converted = converted.replaceAll(source, replacement);
    }
    converted = converted
      .replace(/[\u0900-\u097f]+/g, romanizeWord)
      .replace(/[\u0600-\u06ff\u0750-\u077f\u08a0-\u08ff]+/g, (word) => {
        if (arabicWords[word]) return arabicWords[word];
        return Array.from(word).map((character) => arabicCharacters[character] ?? "").join("");
      });
    return converted.normalize("NFKD")
      .replace(/[\u0300-\u036f]/g, "")
      .replace(/[\u2018\u2019]/g, "'")
      .replace(/[\u201c\u201d]/g, '"')
      .replace(/[\u2013\u2014]/g, "-")
      .replace(/\u2026/g, "...")
      .replace(/[^\x00-\x7f]/g, " ");
  }).join("").replace(/\s+/g, " ").trim();
};
