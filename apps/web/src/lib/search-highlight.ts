export type SearchHighlightSegment = {
  text: string;
  match: boolean;
};

export function searchHighlightSegments(
  text: string,
  query: string,
): SearchHighlightSegment[] {
  const term = query.trim();
  if (!term) return [{ text, match: false }];
  const haystack = text.toLocaleLowerCase();
  const needle = term.toLocaleLowerCase();
  const segments: SearchHighlightSegment[] = [];
  let offset = 0;
  let matches = 0;
  while (offset < text.length && matches < 50) {
    const index = haystack.indexOf(needle, offset);
    if (index < 0) break;
    if (index > offset) {
      segments.push({ text: text.slice(offset, index), match: false });
    }
    const end = index + term.length;
    segments.push({ text: text.slice(index, end), match: true });
    offset = end;
    matches += 1;
  }
  if (offset < text.length) {
    segments.push({ text: text.slice(offset), match: false });
  }
  return segments.length > 0 ? segments : [{ text, match: false }];
}
