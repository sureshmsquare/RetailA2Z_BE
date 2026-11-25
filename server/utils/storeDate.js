/**
 * Store-timezone date utilities using native Intl.DateTimeFormat (BRD CR-01, Section 11).
 * Zero external dependencies.
 */

const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/**
 * Calculates timezone offset in milliseconds for a given date in the specified timezone.
 * Returns local time minus UTC time in ms (e.g. +19800000 ms for Asia/Kolkata).
 */
export function getTimeZoneOffsetMs(date, tz = DEFAULT_TIMEZONE) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const get = (type) => parts.find((p) => p.type === type)?.value;
  let hour = parseInt(get('hour'), 10);
  if (hour === 24) hour = 0;

  const localAsUtc = Date.UTC(
    parseInt(get('year'), 10),
    parseInt(get('month'), 10) - 1,
    parseInt(get('day'), 10),
    hour,
    parseInt(get('minute'), 10),
    parseInt(get('second'), 10)
  );

  return localAsUtc - date.getTime();
}

/**
 * Formats a Date or ISO string into 'YYYY-MM-DD' calendar date in the store timezone.
 *
 * @param {Date|string|number} isoOrDate
 * @param {string} tz - IANA timezone string
 * @returns {string|null} - 'YYYY-MM-DD'
 */
export function formatStoreDate(isoOrDate, tz = DEFAULT_TIMEZONE) {
  if (!isoOrDate) return null;
  const date = isoOrDate instanceof Date ? isoOrDate : new Date(isoOrDate);
  if (isNaN(date.getTime())) return null;

  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: tz,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });

  return formatter.format(date);
}

/**
 * Returns today's date in the store timezone.
 *
 * @param {string} tz - IANA timezone string
 * @returns {{ year: number, month: number, day: number, isoDateString: string }}
 */
export function getStoreToday(tz = DEFAULT_TIMEZONE) {
  const isoDateString = formatStoreDate(new Date(), tz);
  const [year, month, day] = isoDateString.split('-').map(Number);
  return { year, month, day, isoDateString };
}

/**
 * Adds a number of calendar days to a base date in the store's timezone,
 * returning the UTC Date corresponding to local midnight (00:00:00.000) of that day in that timezone.
 *
 * Example:
 * IST (+05:30) bill posted 2026-11-24 23:30 local + 15 days
 * -> 2026-12-09 00:00:00+05:30 -> UTC 2026-12-08T18:30:00.000Z
 *
 * @param {Date|string|number} baseIso - Starting date
 * @param {number} days - Number of calendar days to add
 * @param {string} tz - IANA timezone string
 * @returns {Date}
 */
export function addDaysInStoreTz(baseIso, days, tz = DEFAULT_TIMEZONE) {
  const baseDateStr = formatStoreDate(baseIso, tz);
  if (!baseDateStr) return null;

  const [y, m, d] = baseDateStr.split('-').map(Number);
  // Add days using UTC calendar arithmetic
  const targetUtcCalendar = new Date(Date.UTC(y, m - 1, d + Number(days), 0, 0, 0));
  const ty = targetUtcCalendar.getUTCFullYear();
  const tm = targetUtcCalendar.getUTCMonth();
  const td = targetUtcCalendar.getUTCDate();

  // Find UTC timestamp that yields midnight (00:00:00) in tz
  const targetLocalUtc = Date.UTC(ty, tm, td, 0, 0, 0);
  const offset0 = getTimeZoneOffsetMs(new Date(targetLocalUtc), tz);
  const t1 = targetLocalUtc - offset0;
  const offset1 = getTimeZoneOffsetMs(new Date(t1), tz);

  return new Date(targetLocalUtc - offset1);
}

/**
 * Returns the calendar days difference between two dates in the store timezone (toIso - fromIso).
 *
 * Example:
 * If now is 2026-11-25 in store tz:
 * - dueDate is 2026-11-25 (due today) -> 0
 * - dueDate is 2026-11-24 (due yesterday) -> 1
 * - dueDate is 2026-11-18 (due 7 days ago) -> 7
 * - dueDate is 2026-11-26 (due tomorrow) -> -1
 *
 * @param {Date|string|number} fromIso - Starting date (e.g. dueDate)
 * @param {Date|string|number} toIso - Ending date (e.g. now)
 * @param {string} tz - IANA timezone string
 * @returns {number}
 */
export function daysBetweenInStoreTz(fromIso, toIso, tz = DEFAULT_TIMEZONE) {
  if (!fromIso || !toIso) return 0;
  const fromStr = formatStoreDate(fromIso, tz);
  const toStr = formatStoreDate(toIso, tz);
  if (!fromStr || !toStr) return 0;

  const [y1, m1, d1] = fromStr.split('-').map(Number);
  const [y2, m2, d2] = toStr.split('-').map(Number);

  const utc1 = Date.UTC(y1, m1 - 1, d1);
  const utc2 = Date.UTC(y2, m2 - 1, d2);

  return Math.round((utc2 - utc1) / (24 * 60 * 60 * 1000));
}

export default {
  getTimeZoneOffsetMs,
  formatStoreDate,
  getStoreToday,
  addDaysInStoreTz,
  daysBetweenInStoreTz,
};

