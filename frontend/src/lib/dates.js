// lib/dates.js
// The app passes calendar days around as 'YYYY-MM-DD' strings - the form the
// API takes. These helpers turn them into Date objects for the calendar
// pickers (as local days, so the calendar highlights the right square) and
// back.
import { format, isValid, parse, subDays } from 'date-fns';

export function parseDay(value) {
  if (!value) return undefined;
  const date = parse(value, 'yyyy-MM-dd', new Date());
  return isValid(date) ? date : undefined;
}

export function formatDay(date) {
  return date && isValid(date) ? format(date, 'yyyy-MM-dd') : '';
}

// 'Nov 14, 2026' (or another date-fns pattern) for a 'YYYY-MM-DD' string.
export function displayDay(value, pattern = 'MMM d, yyyy') {
  const date = parseDay(value);
  return date ? format(date, pattern) : '';
}

// "Today" as the server counts days: it reads 'YYYY-MM-DD' as a UTC day, so a
// range ending on the UTC date still includes results from this evening.
export function serverToday() {
  return new Date().toISOString().slice(0, 10);
}

// The range ending today (by the server's count) that covers `days` days.
export function lastDays(days) {
  const end = parseDay(serverToday());
  return { startDate: formatDay(subDays(end, days - 1)), endDate: formatDay(end) };
}

// 'YYYY-MM-DDTHH:mm' in local time - the value a scheduled send is given.
export function toLocalDateTime(date) {
  return format(date, "yyyy-MM-dd'T'HH:mm");
}
