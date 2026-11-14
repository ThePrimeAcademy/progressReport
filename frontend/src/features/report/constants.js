// features/report/constants.js

// The first day of the current SAT program: the date range every report
// screen starts with, so View Report and Email work without any setup.
export const PROGRAM_START_DATE = '2026-06-22';

// The subject a report email gets when nobody types one.
export const DEFAULT_REPORT_SUBJECT = 'Prime Academy Weekly Report';

// A contact field may hold several addresses (e.g. two parents) separated by
// commas, semicolons or slashes - the same rule the server applies.
const EMAIL_RX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function splitAddresses(field) {
  return String(field || '')
    .split(/[,;/\n]+/)
    .map((part) => part.trim())
    .filter(Boolean);
}

// True for an empty field (nothing to send to) or a field of valid addresses.
export function isValidContactField(field) {
  const parts = splitAddresses(field);
  return parts.every((address) => EMAIL_RX.test(address));
}
