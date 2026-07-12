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
//   ZOHO_HOST / SMTP_HOST  — SMTP host. Defaults to smtp.zoho.com (US).
//                            Org plans often use smtppro.zoho.com.
//                            Other DCs: smtp.zoho.eu / smtp.zoho.in / smtp.zoho.com.au
//   ZOHO_PORT / SMTP_PORT  — 465 (implicit TLS, default) or 587 (STARTTLS).
//   EMAIL_FROM             — display name + address used in the From: header, e.g.
//                            "Prime Academy <admin@primeacademynova.com>". Must be the
//                            Zoho mailbox or one of its verified aliases, otherwise Zoho
//                            rejects the send. Defaults to ZOHO_USER.

const nodemailer = require('nodemailer');

function isConfigured() {
  return Boolean(process.env.ZOHO_USER && process.env.ZOHO_APP_PASSWORD);
}

function getSmtpConfig() {
  const host =
    process.env.ZOHO_HOST ||
    process.env.SMTP_HOST ||
    'smtp.zoho.com';
  const port = Number(
    process.env.ZOHO_PORT ||
    process.env.SMTP_PORT ||
    465
  );
  const user = process.env.ZOHO_USER;
  const pass = String(process.env.ZOHO_APP_PASSWORD || '').replace(/\s+/g, '');
  return { host, port, user, pass };
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
  return `<p>Hi,</p>
<p>Attached is the most recent weekly progress report for ${studentName}.</p>
<p>Best regards,<br />Prime Academy</p>`;
}

let _transporter = null;
let _transporterKey = null;

function getTransporter() {
  const { host, port, user, pass } = getSmtpConfig();
  const key = `${host}:${port}:${user}:${pass}`;
  if (_transporter && _transporterKey === key) return _transporter;

  _transporterKey = key;
  // Timeouts so a stuck Zoho session can't leave bulk-send jobs "pending"
  // forever (UI would show "Sending…" until the client poll timed out).
  const connectMs = Number(process.env.SMTP_CONNECTION_TIMEOUT_MS) || 15000;
  const socketMs = Number(process.env.SMTP_SOCKET_TIMEOUT_MS) || 45000;
  _transporter = nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: { user, pass },
    connectionTimeout: connectMs,
    greetingTimeout: connectMs,
    socketTimeout: socketMs,
    // STARTTLS on 587 needs this; on 465 secure already encrypts the socket.
    tls: { minVersion: 'TLSv1.2' },
  });
  console.log(`[email] SMTP transporter → ${host}:${port} as ${user} (connect ${connectMs}ms, socket ${socketMs}ms)`);
  return _transporter;
}

// Hard cap around a single sendMail — nodemailer timeouts are not always
// reliable on half-open sockets, and large PDF attachments can stall silently.
function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      reject(new Error(`${label} timed out after ${ms}ms`));
    }, ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function sendReportEmail({ studentName, recipients, pdfBuffer, filename, startDate, endDate, subject, attachments = [] }) {
  if (!isConfigured()) {
    const err = new Error('Email service not configured. Set ZOHO_USER and ZOHO_APP_PASSWORD on the backend.');
    err.status = 503;
    throw err;
  }

  try {
    const to = (recipients || [])
      .map((e) => String(e || '').trim())
      .filter((e) => e && e.includes('@') && !e.includes('example.com'));
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
    const errors = [];
    const sendTimeoutMs = Number(process.env.SMTP_SEND_TIMEOUT_MS) || 60000;
    const attachBytes = mailAttachments.reduce((n, a) => n + (a.content?.length || 0), 0);
    console.log(
      `[email] sending "${finalSubject}" to ${to.length} recipient(s) ` +
      `from=${from} attach=${mailAttachments.length} (~${Math.round(attachBytes / 1024)}KB)`
    );

    for (const recipient of to) {
      const t0 = Date.now();
      try {
        const info = await withTimeout(
          getTransporter().sendMail({
            from,
            to: recipient,
            subject: finalSubject,
            html,
            attachments: mailAttachments,
          }),
          sendTimeoutMs,
          `SMTP send to ${recipient}`
        );
        console.log(`[email] sent → ${recipient} in ${Date.now() - t0}ms id=${info?.messageId || '?'}`);
        results.push(info);
        // Brief pause so Zoho's hourly reputation limits are less likely to trip.
        await new Promise(resolve => setTimeout(resolve, 1500));
      } catch (e) {
        console.error(`[SMTP ERROR] Failed to send to ${recipient} after ${Date.now() - t0}ms:`, e.message || e);
        errors.push(`${recipient}: ${e.message}`);
        // Drop the cached transporter after a failure — next attempt re-auths clean.
        _transporter = null;
        _transporterKey = null;
      }
    }

    if (results.length === 0) {
      throw new Error(errors.length ? errors.join(' | ') : 'All email sends failed.');
    }

    return {
      id: results.map(r => r?.messageId).join(','),
      to: to,
      subject: finalSubject,
      partialErrors: errors.length ? errors : undefined,
    };
  } catch (e) {
    const err = new Error(`Zoho SMTP send failed: ${e.message}`);
    err.status = 502;
    throw err;
  }
}

async function verifyConnection() {
  if (!isConfigured()) {
    const err = new Error('Zoho SMTP not configured (set ZOHO_USER, ZOHO_APP_PASSWORD)');
    err.status = 503;
    throw err;
  }
  const { host, port, user } = getSmtpConfig();
  try {
    await getTransporter().verify();
    return { ok: true, host, port, user };
  } catch (e) {
    const err = new Error(
      `Zoho SMTP verify failed (${host}:${port} as ${user}): ${e.message}`
    );
    err.status = 502;
    throw err;
  }
}

module.exports = { isConfigured, sendReportEmail, buildDefaultSubject, verifyConnection };
