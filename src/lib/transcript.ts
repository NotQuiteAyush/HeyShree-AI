const cleanSpacing = (value: string) =>
  value.trim().replace(/\s+/g, " ").replace(/\s+(\p{P})/gu, "$1");

export const mergeTranscriptFragments = (current: string, incoming: string): string => {
  const previous = cleanSpacing(current);
  const next = cleanSpacing(incoming);
  if (!previous) return next;
  if (!next || previous.endsWith(next)) return previous;
  if (next.startsWith(previous)) return next;

  const previousWords = previous.split(" ");
  const nextWords = next.split(" ");
  const comparable = (word: string) => word.toLocaleLowerCase().replace(/\p{P}+$/gu, "");
  const maximumOverlap = Math.min(previousWords.length, nextWords.length);
  for (let overlap = maximumOverlap; overlap > 0; overlap -= 1) {
    const tail = previousWords.slice(-overlap).map(comparable).join(" ");
    const head = nextWords.slice(0, overlap).map(comparable).join(" ");
    if (tail === head) {
      return cleanSpacing([...previousWords.slice(0, -overlap), ...nextWords].join(" "));
    }
  }

  return cleanSpacing(`${previous} ${next}`);
};
