export type PlateRecord = { plate: string; timestamp: number };

// BR older: AAA0000; Mercosul: AAA0A00
const regexes = [
  /^[A-Z]{3}[0-9]{4}$/,
  /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/,
];

export function isMercosulPlate(plate: string): boolean {
  return /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/.test(plate);
}

export function normalizeText(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '') // keep alphanumerics only
    .trim();
}

function fixConfusions(sub: string): string {
  if (sub.length !== 7) return sub;
  const chars = sub.split('');
  const isLetterPos = (i: number) => i === 0 || i === 1 || i === 2 || i === 4; // Mercosul
  const isDigitPos = (i: number) => i === 3 || i === 5 || i === 6;
  for (let i = 0; i < 7; i++) {
    const c = chars[i];
    if (isLetterPos(i)) {
      // map digits that look like letters
      if (c === '0') chars[i] = 'O';
      else if (c === '1') chars[i] = 'I';
      else if (c === '2') chars[i] = 'Z';
      else if (c === '5') chars[i] = 'S';
      else if (c === '8') chars[i] = 'B';
    } else if (isDigitPos(i)) {
      // map letters that look like digits
      if (c === 'O' || c === 'Q') chars[i] = '0';
      else if (c === 'I' || c === 'L') chars[i] = '1';
      else if (c === 'Z') chars[i] = '2';
      else if (c === 'S') chars[i] = '5';
      else if (c === 'B') chars[i] = '8';
      else if (c === 'G') chars[i] = '6';
    }
  }
  return chars.join('');
}

export function extractPlates(text: string): string[] {
  const raw = normalizeText(text);
  const candidates: string[] = [];
  // generate substrings of plausible plate length (7)
  for (let i = 0; i <= raw.length - 7; i++) {
    const sub = raw.slice(i, i + 7);
    if (regexes.some((r) => r.test(sub))) {
      candidates.push(sub);
    } else {
      const fixed = fixConfusions(sub);
      if (regexes.some((r) => r.test(fixed))) candidates.push(fixed);
    }
  }
  return Array.from(new Set(candidates));
}