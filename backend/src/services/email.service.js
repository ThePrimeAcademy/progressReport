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
//   ZOHO_HOST / SMTP_HOST  — SMTP host. Defaults to smtppro.zoho.com (org/domain mail).
//                            Personal Zoho: smtp.zoho.com. Other DCs: smtp.zoho.eu etc.
//   ZOHO_PORT / SMTP_PORT  — Prefer 465 (SSL). 587 = STARTTLS. Cloud hosts often
//                            time out on one port and work on the other — we try
//                            both automatically on connection failure.
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
    'smtppro.zoho.com';
  const port = Number(
    process.env.ZOHO_PORT ||
    process.env.SMTP_PORT ||
    465
  );
  const user = process.env.ZOHO_USER;
  const pass = String(process.env.ZOHO_APP_PASSWORD || '').replace(/\s+/g, '');
  return { host, port, user, pass };
}

// Prefer the configured host/port first, then common Zoho combos. Org domain
// mailboxes usually need smtppro.*; personal mailboxes use smtp.zoho.*.
// 465 (implicit TLS) is tried early — many cloud providers reach it more
// reliably than 587 STARTTLS.
function smtpCandidates() {
  const primary = getSmtpConfig();
  const hosts = [
    primary.host,
    'smtppro.zoho.com',
    'smtp.zoho.com',
  ];
  const ports = [primary.port, 465, 587];
  const seen = new Set();
  const out = [];
  for (const host of hosts) {
    for (const port of ports) {
      const key = `${host}:${port}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push({ host, port, user: primary.user, pass: primary.pass });
    }
  }
  return out;
}

function isConnectFailure(err) {
  const msg = String(err?.message || err || '').toLowerCase();
  const code = err?.code || err?.errno || '';
  return (
    msg.includes('connection timeout') ||
    msg.includes('connect etimedout') ||
    msg.includes('connect econnrefused') ||
    msg.includes('connect enotfound') ||
    msg.includes('greeting never received') ||
    msg.includes('socket closed') ||
    msg.includes('esocket') ||
    code === 'ETIMEDOUT' ||
    code === 'ECONNREFUSED' ||
    code === 'ECONNECTION' ||
    code === 'ESOCKET'
  );
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
  return `<p>Hi,</p>
<p>Attached is the most recent weekly progress report for ${studentName}.</p>
<p>Best regards,<br />Prime Academy</p>`;
}

let _transporter = null;
let _transporterKey = null;
// Once we find a host:port that works from this network, stick to it for the
// process lifetime so bulk sends don't re-probe on every message.
let _workingEndpoint = null;

function createTransporter({ host, port, user, pass }) {
  const connectMs = Number(process.env.SMTP_CONNECTION_TIMEOUT_MS) || 20000;
  const socketMs = Number(process.env.SMTP_SOCKET_TIMEOUT_MS) || 45000;
  return nodemailer.createTransport({
    host,
    port,
    secure: port === 465,
    requireTLS: port === 587,
    auth: { user, pass },
    connectionTimeout: connectMs,
    greetingTimeout: connectMs,
    socketTimeout: socketMs,
    tls: { minVersion: 'TLSv1.2' },
  });
}

function getTransporter(endpoint) {
  const cfg = endpoint || _workingEndpoint || getSmtpConfig();
  const key = `${cfg.host}:${cfg.port}:${cfg.user}:${cfg.pass}`;
  if (_transporter && _transporterKey === key) return _transporter;

  _transporterKey = key;
  _transporter = createTransporter(cfg);
  console.log(
    `[email] SMTP transporter → ${cfg.host}:${cfg.port} as ${cfg.user}`
  );
  return _transporter;
}

function clearTransporter() {
  _transporter = null;
  _transporterKey = null;
}

// Try configured + fallback Zoho endpoints until one accepts a connection.
async function resolveWorkingTransporter() {
  if (_workingEndpoint) {
    return getTransporter(_workingEndpoint);
  }

  const candidates = smtpCandidates();
  const errors = [];
  for (const cfg of candidates) {
    const transport = createTransporter(cfg);
    try {
      console.log(`[email] probing ${cfg.host}:${cfg.port}…`);
      await transport.verify();
      _workingEndpoint = { host: cfg.host, port: cfg.port, user: cfg.user, pass: cfg.pass };
      clearTransporter();
      console.log(`[email] using ${cfg.host}:${cfg.port}`);
      return getTransporter(_workingEndpoint);
    } catch (e) {
      console.warn(`[email] ${cfg.host}:${cfg.port} failed: ${e.message}`);
      errors.push(`${cfg.host}:${cfg.port} → ${e.message}`);
      try { transport.close(); } catch (_) { /* ignore */ }
      if (!isConnectFailure(e) && candidates.indexOf(cfg) === 0) {
        // Auth/config error on the primary endpoint — don't burn through
        // every host with the same bad password.
        break;
      }
    }
  }

  const err = new Error(
    `Could not reach Zoho SMTP from this server. Tried: ${errors.join(' | ')}. ` +
    `Set SMTP_HOST/SMTP_PORT on Railway (try smtppro.zoho.com + 465). ` +
    `Connection timeout is a network path issue, not a missing Zoho app password.`
  );
  err.status = 502;
  throw err;
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

    // Resolve a reachable Zoho endpoint once before the recipient loop.
    let transport = await resolveWorkingTransporter();

    for (const recipient of to) {
      const t0 = Date.now();
      try {
        const info = await withTimeout(
          transport.sendMail({
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
        await new Promise(resolve => setTimeout(resolve, 1500));
      } catch (e) {
        console.error(`[SMTP ERROR] Failed to send to ${recipient} after ${Date.now() - t0}ms:`, e.message || e);
        errors.push(`${recipient}: ${e.message}`);
        clearTransporter();
        _workingEndpoint = null;
        if (isConnectFailure(e)) {
          try {
            transport = await resolveWorkingTransporter();
          } catch (probeErr) {
            errors.push(probeErr.message);
            break;
          }
        }
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
    err.status = e.status || 502;
    throw err;
  }
}

async function verifyConnection() {
  if (!isConfigured()) {
    const err = new Error('Zoho SMTP not configured (set ZOHO_USER, ZOHO_APP_PASSWORD)');
    err.status = 503;
    throw err;
  }
  try {
    _workingEndpoint = null;
    clearTransporter();
    const transport = await resolveWorkingTransporter();
    const { host, port, user } = _workingEndpoint || getSmtpConfig();
    return { ok: true, host, port, user };
  } catch (e) {
    const cfg = getSmtpConfig();
    const err = new Error(
      `Zoho SMTP verify failed (${cfg.host}:${cfg.port} as ${cfg.user}): ${e.message}`
    );
    err.status = 502;
    throw err;
  }
}

module.exports = { isConfigured, sendReportEmail, buildDefaultSubject, verifyConnection };
