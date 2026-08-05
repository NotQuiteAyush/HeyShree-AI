import fs from "fs";
import path from "path";
import { Memory } from "./src/types";

const MEMORIES_FILE = path.join(process.cwd(), "memories.json");

// Importance weights for retrieval ranking
const IMPORTANCE_WEIGHTS: Record<Memory["importance"], number> = {
  Critical: 100,
  High: 50,
  Medium: 20,
  Low: 5,
};

// Category descriptions to guide model understanding
export const CATEGORY_DESCRIPTIONS: Record<Memory["category"], string> = {
  Identity: "User's name, age, gender, background, and core identity details.",
  Preferences: "User's likes, dislikes, UI/theme settings, tone choices, and lifestyle choices.",
  Personality: "User's behavioral style, communication tendencies, or personality notes.",
  Projects: "User's ongoing coding, YouTube, design, study, or business initiatives.",
  Goals: "User's personal, professional, academic, or long-term achievements they strive for.",
  Relationships: "Details about friends, family, partners, or mentioned acquaintances.",
  Schedule: "Daily habits, time frames, routines, or when the user is busy/active.",
  Habits: "Repetitive patterns, study methods, workout regimens, or regular actions.",
  Emotional: "Sensitive past struggles, emotional triggers, moods, or support needs.",
  Semantic: "Factual trivia, customized concepts, or shared world knowledge.",
};

/**
 * Safely loads the user's structured memory file.
 * Automatically falls back to seed memories if the file is missing or invalid.
 */
export function loadMemories(): Memory[] {
  try {
    if (fs.existsSync(MEMORIES_FILE)) {
      const data = fs.readFileSync(MEMORIES_FILE, "utf-8");
      return JSON.parse(data) as Memory[];
    }
  } catch (err) {
    console.error("Error reading memories.json, using defaults:", err);
  }

  // Fallback default seed memories
  return [
    {
      id: "mem_seed01",
      category: "Identity",
      content: "My name is SHREE, an emotionally intelligent, supportive, and polite female Indian AI companion.",
      importance: "Critical",
      confidence: 1.0,
      timestamp: new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
      timesReinforced: 1,
    },
    {
      id: "mem_seed02",
      category: "Relationships",
      content: "The user is my primary companion. I am dedicated to listening, offering warm comfort, and supporting their creative projects.",
      importance: "High",
      confidence: 0.98,
      timestamp: new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
      timesReinforced: 1,
    },
    {
      id: "mem_seed03",
      category: "Preferences",
      content: "The user appreciates warm, natural, and highly conversational interactions in both English and sweet Hinglish.",
      importance: "Medium",
      confidence: 0.95,
      timestamp: new Date().toISOString(),
      lastAccessed: new Date().toISOString(),
      timesReinforced: 1,
    }
  ];
}

/**
 * Persists the structured memories to memories.json.
 */
export function saveMemories(memories: Memory[]): void {
  try {
    fs.writeFileSync(MEMORIES_FILE, JSON.stringify(memories, null, 2), "utf-8");
  } catch (err) {
    console.error("Failed to write memories.json:", err);
  }
}

/**
 * Automatically creates a new memory or reinforces an existing one.
 * If a memory of the same category has highly overlapping terms, we reinforce/merge it.
 */
export function addMemory(
  category: Memory["category"],
  content: string,
  importance: Memory["importance"] = "Medium"
): Memory {
  const memories = loadMemories();
  const now = new Date().toISOString();

  // Look for a potential match in the same category to reinforce
  const categoryMemories = memories.filter((m) => m.category === category);
  let bestMatch: Memory | null = null;
  let highestOverlapRatio = 0;

  const newWords = new Set(content.toLowerCase().split(/\s+/).filter(w => w.length > 3));

  for (const m of categoryMemories) {
    const existingWords = m.content.toLowerCase().split(/\s+/).filter(w => w.length > 3);
    if (existingWords.length === 0) continue;

    let matchCount = 0;
    for (const word of existingWords) {
      if (newWords.has(word)) matchCount++;
    }

    const overlapRatio = matchCount / Math.max(existingWords.length, 1);
    if (overlapRatio > highestOverlapRatio) {
      highestOverlapRatio = overlapRatio;
      bestMatch = m;
    }
  }

  // If there's an overlapping memory (> 50% matching content words), reinforce it
  if (bestMatch && highestOverlapRatio > 0.5) {
    bestMatch.timesReinforced += 1;
    bestMatch.lastAccessed = now;
    bestMatch.content = content; // Update with the latest, potentially more precise wording
    bestMatch.confidence = Math.min(1.0, bestMatch.confidence + 0.1);
    // Upgrade importance if the new reinforcement is higher
    if (IMPORTANCE_WEIGHTS[importance] > IMPORTANCE_WEIGHTS[bestMatch.importance]) {
      bestMatch.importance = importance;
    }
    
    saveMemories(memories);
    console.log(`Reinforced existing memory: "${bestMatch.content}"`);
    return bestMatch;
  }

  // Otherwise, create a brand-new memory
  const newMemory: Memory = {
    id: "mem_" + Math.random().toString(36).substring(2, 11),
    category,
    content,
    importance,
    confidence: 0.9,
    timestamp: now,
    lastAccessed: now,
    timesReinforced: 1,
  };

  memories.push(newMemory);
  saveMemories(memories);
  console.log(`Saved brand new memory: "${content}"`);
  return newMemory;
}

/**
 * Updates an existing memory when information changes (e.g. "I play BGMI now" vs old "I play PUBG").
 * Merges or replaces older outdated memory cards.
 */
export function updateMemory(
  category: Memory["category"],
  oldContent: string,
  newContent: string
): boolean {
  const memories = loadMemories();
  const now = new Date().toISOString();

  // Find a memory under this category that contains elements of oldContent
  const matchingIndices = memories
    .map((m, idx) => ({ m, idx }))
    .filter(({ m }) => m.category === category);

  let bestIndex = -1;
  let highestMatchScore = 0;

  const oldWords = oldContent.toLowerCase().split(/\s+/).filter(w => w.length > 3);

  for (const { m, idx } of matchingIndices) {
    const memWords = m.content.toLowerCase();
    let matches = 0;
    for (const w of oldWords) {
      if (memWords.includes(w)) matches++;
    }

    if (matches > highestMatchScore) {
      highestMatchScore = matches;
      bestIndex = idx;
    }
  }

  if (bestIndex !== -1 && highestMatchScore > 0) {
    memories[bestIndex].content = newContent;
    memories[bestIndex].lastAccessed = now;
    memories[bestIndex].confidence = Math.min(1.0, memories[bestIndex].confidence + 0.05);
    memories[bestIndex].timesReinforced += 1;
    
    saveMemories(memories);
    console.log(`Updated memory index ${bestIndex} to: "${newContent}"`);
    return true;
  }

  // Fallback: If no match is found, treat it as a new memory entry
  addMemory(category, newContent, "Medium");
  return true;
}

/**
 * Deletes or cleans up outdated/incorrect memories based on category and description.
 * Set contentToForget to 'all' to delete an entire category.
 */
export function forgetMemory(category: Memory["category"], contentToForget: string): boolean {
  let memories = loadMemories();
  const initialLength = memories.length;

  if (contentToForget.trim().toLowerCase() === "all") {
    memories = memories.filter((m) => m.category !== category);
    saveMemories(memories);
    console.log(`Cleared all memories under category: ${category}`);
    return true;
  }

  // Filter out any matching memory cards
  const keywords = contentToForget.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  
  memories = memories.filter((m) => {
    if (m.category !== category) return true;
    
    // Check keyword overlap
    const memContent = m.content.toLowerCase();
    let matches = 0;
    for (const kw of keywords) {
      if (memContent.includes(kw)) matches++;
    }

    // If keywords overlap significantly, forget it!
    const matchesRequired = Math.min(keywords.length, 2);
    if (keywords.length > 0 && matches >= matchesRequired) {
      console.log(`Forgetting memory: "${m.content}"`);
      return false;
    }
    
    // Exact or direct substring match
    if (memContent.includes(contentToForget.toLowerCase()) || contentToForget.toLowerCase().includes(memContent)) {
      console.log(`Forgetting memory: "${m.content}"`);
      return false;
    }

    return true;
  });

  if (memories.length < initialLength) {
    saveMemories(memories);
    return true;
  }

  return false;
}

/**
 * Searches and ranks past memories based on the user's current query and context.
 * Always includes crucial ("Critical") user identity details (like their name).
 */
export function searchAndRankMemories(userQuery: string, limit: number = 6): Memory[] {
  const memories = loadMemories();
  if (memories.length === 0) return [];

  const queryClean = userQuery.toLowerCase().trim();
  
  // If query is empty, return top-rated memories by baseline importance
  if (!queryClean) {
    const scored = memories.map((m) => {
      const score = IMPORTANCE_WEIGHTS[m.importance] + m.confidence * 15 + Math.min(m.timesReinforced * 5, 25);
      return { m, score };
    });
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, limit).map(item => item.m);
  }

  // We have a query!
  const queryWords = queryClean.split(/\s+/).filter(w => w.length > 3);

  // Score each memory card based on matching query keywords or categories
  const scoredMemories = memories.map((m) => {
    let score = 0;
    const contentClean = m.content.toLowerCase();
    let wordMatches = 0;

    // Check query word overlaps
    for (const word of queryWords) {
      if (contentClean.includes(word)) {
        wordMatches++;
      }
    }

    if (wordMatches > 0) {
      score += wordMatches * 100; // Large boost per matching keyword
      score += IMPORTANCE_WEIGHTS[m.importance]; // Add importance weight
      score += m.confidence * 15;
      score += Math.min(m.timesReinforced * 5, 25);
    }

    // Direct category reference in query (e.g. if query contains "project", boost Projects category)
    const categoryLower = m.category.toLowerCase();
    const singularCategory = categoryLower.substring(0, categoryLower.length - 1);
    if (queryClean.includes(singularCategory) || queryClean.includes(categoryLower)) {
      score += 50;
    }

    // Always keep critical Identity memories warm in the score to help model remember the user's name
    if (m.category === "Identity" && m.importance === "Critical") {
      score += 10; // Small baseline so it is always > 0 and returned
    }

    return { m, score };
  });

  // Filter out memories that have 0 score (no relevance to user query at all)
  const relevantScored = scoredMemories.filter(item => item.score > 0);

  // Sort memories descending by score
  relevantScored.sort((a, b) => b.score - a.score);

  // Return the top-scored memories within limit
  const selectedMemories = relevantScored.slice(0, limit).map(item => item.m);

  // Make sure at least name/core identity details are present if they exist
  const coreIdentity = memories.find(m => m.category === "Identity" && m.importance === "Critical");
  if (coreIdentity && !selectedMemories.some(m => m.id === coreIdentity.id)) {
    selectedMemories.unshift(coreIdentity);
  }

  return selectedMemories;
}

/**
 * Constructs a beautiful, scannable context block representing what SHREE remembers about the user.
 * Includes precise directives to make sure SHREE retrieves and references these memories naturally.
 */
export function getMemoriesContextString(userQuery: string = ""): string {
  const relevantMemories = searchAndRankMemories(userQuery, 8);
  if (relevantMemories.length === 0) {
    return "";
  }

  let text = "\n==================================================\n";
  text += "🧠 ACTIVE SHREE LONG-TERM MEMORIES & USER PERSISTENT PROFILE:\n";
  text += "Below are long-term facts you have extracted and verified about the user over previous sessions.\n";
  text += "Use this profile to personalize your replies, offer continuous support, and build trust over months/years.\n\n";

  // Group by category
  const grouped: Record<string, string[]> = {};
  for (const m of relevantMemories) {
    if (!grouped[m.category]) {
      grouped[m.category] = [];
    }
    const reinforcedIndicator = m.timesReinforced > 1 ? ` (Verified ${m.timesReinforced}x)` : "";
    grouped[m.category].push(`- ${m.content}${reinforcedIndicator}`);
  }

  for (const [cat, lines] of Object.entries(grouped)) {
    text += `[${cat} (${CATEGORY_DESCRIPTIONS[cat as Memory["category"]]})]\n`;
    for (const line of lines) {
      text += `  ${line}\n`;
    }
    text += "\n";
  }

  text += "HUMAN-LIKE MEMORY RETRIEVAL & CONVERSATION RULES:\n";
  text += "1. NEVER list facts or say things like 'My memory card says you play PUBG'. That sounds cold and robotic.\n";
  text += "2. Integrate memory fluidly, sweet and warm. E.g. instead of 'You like coding', say 'Oh, how is your coding project going, by the way?' or 'Since you enjoy coding, maybe we can write a script for this!'\n";
  text += "3. If the user contradicts any fact above, immediately trigger the 'updateMemory' or 'forgetMemory' tool to correct or retire that memory! Say 'Ah, you changed your mind? I'll update that for you!'\n";
  text += "4. If the user shares any new personal detail (nickname, age, birthday, goals, relationships, project names, habits, or schedule), immediately call 'rememberInformation' to store it permanently!\n";
  text += "5. If the user asks about a personal fact or detail (such as their hobbies, preferences, relationships, dog's name, etc.) and it is NOT explicitly listed in the active memories above, do NOT make up, guess, or hallucinate an answer! Politely, warmly, and sweetly tell the user that you don't remember or don't know yet, and ask them to tell you so you can remember it.\n";
  text += "==================================================\n";

  return text;
}
