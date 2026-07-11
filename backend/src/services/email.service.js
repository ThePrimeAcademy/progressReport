// services/email.service.js
// Sends progress-report emails via Zoho Mail over SMTP using nodemailer.
// We use an app-specific password (not the account password) so 2FA on the
// Zoho account doesn't block programmatic sending.
//
// Required env vars (set on Railway):
//   ZOHO_USER           — the full Zoho mailbox address, e.g. admin@primeacademynova.com
//   ZOHO_APP_PASSWORD   — Zoho > Settings > Security > App Passwords. Spaces in
//                         the displayed value are ignored (we strip them).
//
// Optional env vars:
//   ZOHO_HOST    — SMTP host. Defaults to smtp.zoho.com (US data center).
//                  Use smtp.zoho.eu / smtp.zoho.in / smtp.zoho.com.au for
//                  other data centers, or smtppro.zoho.com for some org plans.
//   ZOHO_PORT    — 465 (implicit TLS, default) or 587 (STARTTLS).
//   EMAIL_FROM   — display name + address used in the From: header, e.g.
//                  "Prime Academy <admin@primeacademynova.com>". Must be the
//                  Zoho mailbox or one of its verified aliases, otherwise Zoho
//                  rejects the send. Defaults to ZOHO_USER.

const nodemailer = require('nodemailer');

function isConfigured() {
  return Boolean(process.env.ZOHO_USER && process.env.ZOHO_APP_PASSWORD);
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
    ? ` covering ${startPretty} to ${endPretty}`
    : '';
  return `<p>Hi,</p>
<p>Attached is the most recent weekly progress report for ${studentName}.</p>
<p>Best regards,<br />Prime Academy</p>`;
}

let _transporter = null;
function getTransporter() {
  if (_transporter) return _transporter;
  const host = process.env.ZOHO_HOST || 'smtp.zoho.com';
  const port = Number(process.env.ZOHO_PORT) || 465;
  _transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465, // true for 465, false for 587
    requireTLS: port === 587, // <--- THIS LINE IS CRITICAL
    auth: {
      user: process.env.ZOHO_USER,
      pass: String(process.env.ZOHO_APP_PASSWORD || '').replace(/\s+/g, ''),
    },
    connectionTimeout: 15000,
    greetingTimeout: 15000,
  });
  return _transporter;
}

async function sendReportEmail({ studentName, recipients, pdfBuffer, filename, startDate, endDate, subject, attachments = [] }) {
  if (!isConfigured()) {
    const err = new Error(
      'Email service not configured. Set ZOHO_USER and ZOHO_APP_PASSWORD on the backend.'
    );
    err.status = 503;
    throw err;
  }

  const to = (recipients || []).map((e) => String(e || '').trim()).filter(Boolean);
  if (to.length === 0) {
    const err = new Error('At least one recipient email is required.');
    err.status = 400;
    throw err;
  }

  const finalSubject = (subject && String(subject).trim()) || buildDefaultSubject(studentName);
  const html = buildHtmlBody(studentName, startDate, endDate);
  const from = process.env.EMAIL_FROM || process.env.ZOHO_USER;

  const mailAttachments = [
    { filename: filename || 'progress-report.pdf', content: pdfBuffer, contentType: 'application/pdf' },
    ...(attachments || []).map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType || 'application/pdf',
    })),
  ];

  const results = [];
  
  for (const recipient of to) {
    try {
      const info = await getTransporter().sendMail({
        from,
        to: recipient, // Send individually
        subject: finalSubject,
        html,
        attachments: mailAttachments,
      });
      results.push(info);
      
      // Delay for 2 seconds to avoid rate limiting
      await new Promise(resolve => setTimeout(resolve, 2000));
      
    } catch (e) {
      console.error(`Failed to send to ${recipient}: ${e.message}`);
    }
  }

  if (results.length === 0) {
    throw new Error('All email sends failed.');
  }

  return { 
    id: results.map(r => r?.messageId).join(','), 
    to: to, 
    subject: finalSubject 
  };
  } catch (e) {
    const err = new Error(`Zoho SMTP send failed: ${e.message}`);
    err.status = 502;
    throw err;
  }
}

// verifyConnection — opens an SMTP connection and runs the AUTH handshake
// against Zoho without sending anything, confirming the host, port, and
// app-password credentials are all valid.
async function verifyConnection() {
  if (!isConfigured()) {
    const err = new Error('Zoho SMTP not configured (set ZOHO_USER, ZOHO_APP_PASSWORD)');
    err.status = 503;
    throw err;
  }
  try {
    await getTransporter().verify();
    return {
      ok: true,
      host: process.env.ZOHO_HOST || 'smtp.zoho.com',
      user: process.env.ZOHO_USER,
    };
  } catch (e) {
    const err = new Error(`Zoho SMTP verify failed: ${e.message}`);
    err.status = 502;
    throw err;
  }
}

module.exports = {
  isConfigured,
  sendReportEmail,
  buildDefaultSubject,
  verifyConnection,
};
