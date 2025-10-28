export type PlateRecord = { plate: string; timestamp: number };

// BR plate formats
export const regexes = {
  old: /^[A-Z]{3}[0-9]{4}$/,
  merc: /^[A-Z]{3}[0-9][A-Z][0-9]{2}$/,
};

export function isMercosulPlate(plate: string): boolean {
  return regexes.merc.test(plate);
}

export function isValidPlate(plate: string): boolean {
  return regexes.merc.test(plate) || regexes.old.test(plate);
}

export function normalizeText(input: string): string {
  return input
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
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
      if (c === '0') chars[i] = 'O';
      else if (c === '1') chars[i] = 'I';
      else if (c === '2') chars[i] = 'Z';
      else if (c === '5') chars[i] = 'S';
      else if (c === '8') chars[i] = 'B';
    } else if (isDigitPos(i)) {
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
  const cleaned = normalizeText(text);
  const found: string[] = [];
  const pushUnique = (p: string) => {
    if (isValidPlate(p) && !found.includes(p)) found.push(p);
  };
  for (let i = 0; i < cleaned.length; i++) {
    for (let len = 6; len <= 8; len++) {
      const sub = cleaned.slice(i, i + len);
      if (sub.length < 6) continue;
      if (isValidPlate(sub)) pushUnique(sub);
      const fixed1 = fixConfusions(sub);
      if (fixed1 !== sub && isValidPlate(fixed1)) pushUnique(fixed1);
      const tight = sub.replace(/[^A-Z0-9]/g, '');
      if (tight.length >= 6 && isValidPlate(tight)) pushUnique(tight);
      const fixed2 = fixConfusions(tight);
      if (fixed2 !== tight && isValidPlate(fixed2)) pushUnique(fixed2);
    }
  }
  return found;
}

// Strict version: limits heuristic changes to avoid fabricated plates
export function extractPlatesStrict(text: string, maxCorrections = 1): string[] {
  const cleaned = normalizeText(text);
  const found: Set<string> = new Set();
  const pushIfValid = (candidate: string) => {
    if (isValidPlate(candidate)) found.add(candidate);
  };
  const countDiffs = (a: string, b: string) => {
    let diff = 0;
    const n = Math.min(a.length, b.length);
    for (let i = 0; i < n; i++) if (a[i] !== b[i]) diff++;
    diff += Math.abs(a.length - b.length);
    return diff;
  };
  for (let i = 0; i < cleaned.length; i++) {
    for (let len = 6; len <= 8; len++) {
      const sub = cleaned.slice(i, i + len);
      if (sub.length < 6) continue;
      const tight = sub.replace(/[^A-Z0-9]/g, '');
      if (tight.length < 6) continue;
      if (isValidPlate(tight)) pushIfValid(tight);
      const fixed = fixConfusions(tight);
      if (fixed !== tight && countDiffs(tight, fixed) <= maxCorrections) {
        if (isValidPlate(fixed)) pushIfValid(fixed);
      }
    }
  }
  return Array.from(found);
}