import type { DayType } from '../types/transit.ts';

export interface NormalizedISTTimestamp {
  isoIst: string; // YYYY-MM-DD HH:mm:ss
  date: string; // YYYY-MM-DD
  hour: number; // 0..23
  minute: number; // 0..59
  second: number; // 0..59
  dayOfWeek: number; // 0..6 (0=Sun)
  dayType: DayType;
  istEpochMs: number; // Epoch ms representing IST wall clock for chronological diffing
}

/**
 * Normalizes ETM timestamps to Asia/Kolkata (+05:30).
 * - Timezone-aware timestamps (Z / +HH:MM / -HH:MM) are shifted to +05:30.
 * - Naive timestamps (YYYY-MM-DD HH:mm:ss or DD/MM/YYYY HH:mm:ss) are interpreted directly as IST.
 */
export function normalizeToAsiaKolkata(raw: string): NormalizedISTTimestamp | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;

  const hasExplicitTz = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(trimmed);

  let year: number;
  let month: number;
  let day: number;
  let hour: number;
  let minute: number;
  let second: number;

  if (hasExplicitTz) {
    const parsed = new Date(trimmed);
    if (Number.isNaN(parsed.getTime())) return null;
    // Shift UTC ms by +05:30 (19,800,000 ms) to extract exact IST wall-clock components
    const istMs = parsed.getTime() + 330 * 60 * 1000;
    const istDate = new Date(istMs);
    year = istDate.getUTCFullYear();
    month = istDate.getUTCMonth() + 1;
    day = istDate.getUTCDate();
    hour = istDate.getUTCHours();
    minute = istDate.getUTCMinutes();
    second = istDate.getUTCSeconds();
  } else {
    // Support YYYY-MM-DD[ T]HH:mm[:ss] and DD/MM/YYYY[ T]HH:mm[:ss]
    const ymdMatch = trimmed.match(
      /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/
    );
    const dmyMatch = !ymdMatch
      ? trimmed.match(
          /^(\d{1,2})[-/](\d{1,2})[-/](\d{4})(?:[T\s](\d{1,2}):(\d{1,2})(?::(\d{1,2}))?)?/
        )
      : null;

    if (ymdMatch) {
      year = Number(ymdMatch[1]);
      month = Number(ymdMatch[2]);
      day = Number(ymdMatch[3]);
      hour = Number(ymdMatch[4] ?? 0);
      minute = Number(ymdMatch[5] ?? 0);
      second = Number(ymdMatch[6] ?? 0);
    } else if (dmyMatch) {
      day = Number(dmyMatch[1]);
      month = Number(dmyMatch[2]);
      year = Number(dmyMatch[3]);
      hour = Number(dmyMatch[4] ?? 0);
      minute = Number(dmyMatch[5] ?? 0);
      second = Number(dmyMatch[6] ?? 0);
    } else {
      const fallback = new Date(trimmed.replace(' ', 'T'));
      if (Number.isNaN(fallback.getTime())) return null;
      year = fallback.getFullYear();
      month = fallback.getMonth() + 1;
      day = fallback.getDate();
      hour = fallback.getHours();
      minute = fallback.getMinutes();
      second = fallback.getSeconds();
    }
  }

  if (
    month < 1 ||
    month > 12 ||
    day < 1 ||
    day > 31 ||
    hour < 0 ||
    hour > 23 ||
    minute < 0 ||
    minute > 59 ||
    second < 0 ||
    second > 59
  ) {
    return null;
  }

  const utcWallCheck = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  if (
    utcWallCheck.getUTCFullYear() !== year ||
    utcWallCheck.getUTCMonth() !== month - 1 ||
    utcWallCheck.getUTCDate() !== day
  ) {
    return null;
  }

  const date = `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
  const isoIst = `${date} ${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:${String(second).padStart(2, '0')}`;
  const dayOfWeek = utcWallCheck.getUTCDay();
  const dayType: DayType = dayOfWeek === 0 || dayOfWeek === 6 ? 'weekend' : 'weekday';
  // True UTC epoch ms corresponding to this IST wall clock time
  const istEpochMs = utcWallCheck.getTime() - 330 * 60 * 1000;

  return { isoIst, date, hour, minute, second, dayOfWeek, dayType, istEpochMs };
}
