import crypto from 'crypto';

const pad = (n) => String(n).padStart(2, '0');

const toICSDate = (date) => {
  const d = new Date(date);
  return `${d.getUTCFullYear()}${pad(d.getUTCMonth() + 1)}${pad(d.getUTCDate())}T${pad(d.getUTCHours())}${pad(d.getUTCMinutes())}${pad(d.getUTCSeconds())}Z`;
};

const escapeICS = (s = '') =>
  String(s)
    .replace(/\\/g, '\\\\')
    .replace(/\n/g, '\\n')
    .replace(/,/g, '\\,')
    .replace(/;/g, '\\;');

export const buildBookingICS = ({ uid, title, description, start, end, location, organizer }) => {
  const eventUid = uid || `${crypto.randomUUID()}@bookiify`;
  const dtstamp = toICSDate(new Date());
  const dtstart = toICSDate(start);
  const dtend = toICSDate(end);

  return [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Bookiify//Booking//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${escapeICS(eventUid)}`,
    `DTSTAMP:${dtstamp}`,
    `DTSTART:${dtstart}`,
    `DTEND:${dtend}`,
    `SUMMARY:${escapeICS(title)}`,
    `DESCRIPTION:${escapeICS(description)}`,
    location ? `LOCATION:${escapeICS(location)}` : undefined,
    organizer ? `ORGANIZER:${escapeICS(organizer)}` : undefined,
    'END:VEVENT',
    'END:VCALENDAR',
  ]
    .filter(Boolean)
    .join('\r\n');
};

