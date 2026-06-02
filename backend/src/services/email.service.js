// services/email.service.js
// Sends progress-report emails via Brevo's transactional HTTP API. No SMTP
// (Railway blocks SMTP), no 7-day OAuth token expiry. Brevo lets us verify a
// single sender address with no domain or DNS — recipients see the report as
// coming from your personal email.
//
// Required env vars (set on Railway):
//   BREVO_API_KEY   — generated at https://app.brevo.com/settings/keys/api
//
// Optional env var:
//   EMAIL_FROM      — display name + sender, e.g.
//                       "David Kim <david.kim@youngcorporation.com>"
//                     or just an email address. Must match a verified sender
//                     in your Brevo account (configured at
//                     https://app.brevo.com/senders/list).

const BREVO_API = 'https://api.brevo.com/v3';

function isConfigured() {
  return Boolean(process.env.BREVO_API_KEY);
}

function buildDefaultSubject(_studentName) {
  return 'Prime Academy Weekly Report';
}

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
];

function ordinal(n) {
  const v = n % 100;
  if (v >= 11 && v <= 13) return n + 'th';
  switch (n % 10) {
    case 1: return n + 'st';
    case 2: return n + 'nd';
    case 3: return n + 'rd';
    default: return n + 'th';
  }
}

// "2025-10-10" -> "October 10th". Returns the input unchanged if it doesn't
// match the expected ISO YYYY-MM-DD shape.
function formatPrettyDate(iso) {
  if (!iso) return '';
  const m = String(iso).match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return iso;
  const month = MONTHS[Number(m[2]) - 1];
  const day = Number(m[3]);
  if (!month || !day) return iso;
  return `${month} ${ordinal(day)}`;
}

function buildHtmlBody(studentName, startDate, endDate) {
  const startISO = startDate ? String(startDate).slice(0, 10) : '';
  const endISO = endDate ? String(endDate).slice(0, 10) : '';
  const sameYear = startISO.slice(0, 4) && startISO.slice(0, 4) === endISO.slice(0, 4);
  const startPretty = formatPrettyDate(startISO);
  const endPretty = formatPrettyDate(endISO) + (sameYear ? '' : (endISO ? `, ${endISO.slice(0, 4)}` : ''));
  const range = startPretty && endPretty
    ? ` from ${startPretty} to ${endPretty}`
    : '';
  return `<p>Hi,</p>
<p>Attached is the weekly progress report for ${studentName}${range}.</p>
<p>Best regards,<br />Prime Academy</p>`;
}

// Parse EMAIL_FROM in either "Name <email>" or "email" form.
function parseFromAddress() {
  const raw = (process.env.EMAIL_FROM || '').trim();
  if (!raw) return null;
  const m = raw.match(/^(.*?)\s*<\s*([^>]+?)\s*>$/);
  if (m) {
    return { name: m[1].replace(/^"|"$/g, '').trim() || undefined, email: m[2].trim() };
  }
  return { email: raw };
}

async function sendReportEmail({ studentName, recipients, pdfBuffer, filename, startDate, endDate, subject }) {
  if (!isConfigured()) {
    const err = new Error('Email service not configured. Set BREVO_API_KEY on the backend.');
    err.status = 503;
    throw err;
  }

  const from = parseFromAddress();
  if (!from) {
    const err = new Error('EMAIL_FROM env var is required (must be a sender verified in Brevo).');
    err.status = 503;
    throw err;
  }

  const to = (recipients || [])
    .map((e) => String(e || '').trim())
    .filter(Boolean)
    .map((email) => ({ email }));
  if (to.length === 0) {
    const err = new Error('At least one recipient email is required.');
    err.status = 400;
    throw err;
  }

  const finalSubject = (subject && String(subject).trim()) || buildDefaultSubject(studentName);
  const html = buildHtmlBody(studentName, startDate, endDate);

  const payload = {
    sender: from,
    to,
    subject: finalSubject,
    htmlContent: html,
    attachment: [
      {
        name: filename || 'progress-report.pdf',
        content: Buffer.from(pdfBuffer).toString('base64'),
      },
    ],
  };

  let res;
  try {
    res = await fetch(`${BREVO_API}/smtp/email`, {
      method: 'POST',
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        'content-type': 'application/json',
        accept: 'application/json',
      },
      body: JSON.stringify(payload),
    });
  } catch (e) {
    const err = new Error(`Brevo send failed: ${e.message}`);
    err.status = 502;
    throw err;
  }

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const upstream = body?.message || body?.error || `Brevo HTTP ${res.status}`;
    const err = new Error(`Brevo send failed: ${upstream}`);
    err.status = res.status >= 400 && res.status < 600 ? res.status : 502;
    throw err;
  }

  return {
    id: body?.messageId || null,
    to: to.map((t) => t.email),
    subject: finalSubject,
  };
}

// verifyConnection — calls /v3/account to confirm the API key is valid.
async function verifyConnection() {
  if (!isConfigured()) {
    const err = new Error('Brevo not configured (set BREVO_API_KEY)');
    err.status = 503;
    throw err;
  }
  let res;
  try {
    res = await fetch(`${BREVO_API}/account`, {
      headers: {
        'api-key': process.env.BREVO_API_KEY,
        accept: 'application/json',
      },
    });
  } catch (e) {
    const err = new Error(`Brevo verify failed: ${e.message}`);
    err.status = 502;
    throw err;
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const upstream = body?.message || body?.error || `HTTP ${res.status}`;
    const err = new Error(`Brevo verify failed: ${upstream}`);
    err.status = res.status >= 400 && res.status < 600 ? res.status : 502;
    throw err;
  }
  return {
    ok: true,
    email: body?.email || null,
    plan: body?.plan?.[0]?.type || null,
    from: process.env.EMAIL_FROM || null,
  };
}

module.exports = {
  isConfigured,
  sendReportEmail,
  buildDefaultSubject,
  verifyConnection,
};
