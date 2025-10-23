export type PlateRecord = { plate: string; timestamp: number };

// BR older: AAA0000; Mercosul: AAA0A00
const regexes = [
  /^[A-Z]{3}[0-9]{4}$/,
  /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/,
];

export function normalizeText(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '') // keep alphanumerics only
    .trim();
}

export function extractPlates(text: string): string[] {
  const raw = normalizeText(text);
  const candidates: string[] = [];
  // generate substrings of plausible plate length (7)
  for (let i = 0; i <= raw.length - 7; i++) {
    const sub = raw.slice(i, i + 7);
    if (regexes.some((r) => r.test(sub))) candidates.push(sub);
  }
  return Array.from(new Set(candidates));
}