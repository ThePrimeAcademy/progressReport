// services/email.service.js
// Sends progress-report emails.
//
// On Railway Free/Hobby, OUTBOUND SMTP (ports 465/587) is blocked. That is why
// smtppro.zoho.com / smtp.zoho.com all return "Connection timeout" — not a bad
// app password. Use Zoho ZeptoMail's HTTPS API instead (port 443 works everywhere).
//
// Preferred (works on Railway Hobby):
//   ZEPTOMAIL_TOKEN   — Send Mail Token from ZeptoMail → Mail Agent → SMTP/API
//   EMAIL_FROM        — verified sender, e.g. "Prime Academy <admin@primeacademynova.com>"
//                       (domain must be verified in the ZeptoMail agent)
//
// Legacy SMTP (only works if Railway plan allows outbound SMTP, i.e. Pro+):
//   ZOHO_USER / ZOHO_APP_PASSWORD
//   SMTP_HOST / SMTP_PORT (or ZOHO_HOST / ZOHO_PORT)

const nodemailer = require('nodemailer');

function hasZeptoMail() {
  return Boolean(process.env.ZEPTOMAIL_TOKEN || process.env.ZOHO_ZEPTOMAIL_TOKEN);
}

function hasSmtp() {
  return Boolean(process.env.ZOHO_USER && process.env.ZOHO_APP_PASSWORD);
}

function isConfigured() {
  return hasZeptoMail() || hasSmtp();
}

function getZeptoToken() {
  return String(process.env.ZEPTOMAIL_TOKEN || process.env.ZOHO_ZEPTOMAIL_TOKEN || '').trim();
}

function parseFrom(raw) {
  const s = String(raw || process.env.EMAIL_FROM || process.env.ZOHO_USER || '').trim();
  const m = s.match(/^\s*(?:"?([^"]*)"?\s*)?<([^>]+)>\s*$/);
  if (m) {
    return { name: (m[1] || '').trim() || undefined, address: m[2].trim() };
  }
  if (s.includes('@')) return { address: s };
  return { address: s || 'noreply@example.com' };
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

function smtpCandidates() {
  const primary = getSmtpConfig();
  const hosts = [primary.host, 'smtppro.zoho.com', 'smtp.zoho.com'];
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

function buildHtmlBody(studentName) {
  return `<p>Hi,</p>
<p>Attached is the most recent weekly progress report for ${studentName}.</p>
<p>Best regards,<br />Prime Academy</p>`;
}

// ── ZeptoMail HTTPS API (Railway-friendly) ─────────────────────────────────

function bufferToBase64(buf) {
  if (!buf) return '';
  if (Buffer.isBuffer(buf)) return buf.toString('base64');
  if (typeof buf === 'string') return Buffer.from(buf).toString('base64');
  return Buffer.from(buf).toString('base64');
}

async function sendViaZeptoMail({ studentName, recipients, pdfBuffer, filename, subject, attachments = [], htmlBody }) {
  const token = getZeptoToken();
  const from = parseFrom(process.env.EMAIL_FROM || process.env.ZOHO_USER);
  const finalSubject = (subject && String(subject).trim()) || buildDefaultSubject(studentName);
  const html = htmlBody || buildHtmlBody(studentName);

  // pdfBuffer is optional — custom emails may carry no report attachment.
  const zeptoAttachments = [
    ...(pdfBuffer
      ? [{
          name: filename || 'progress-report.pdf',
          mime_type: 'application/pdf',
          content: bufferToBase64(pdfBuffer),
        }]
      : []),
    ...(attachments || []).map((a) => ({
      name: a.filename || 'attachment.pdf',
      mime_type: a.contentType || 'application/pdf',
      content: bufferToBase64(a.content),
    })),
  ];

  const results = [];
  const errors = [];
  // One API call per recipient so one bad address doesn't block the rest.
  for (const recipient of recipients) {
    const t0 = Date.now();
    try {
      const body = {
        from: { address: from.address, ...(from.name ? { name: from.name } : {}) },
        to: [{ email_address: { address: recipient } }],
        subject: finalSubject,
        htmlbody: html,
        ...(zeptoAttachments.length ? { attachments: zeptoAttachments } : {}),
      };
      const res = await fetch('https://api.zeptomail.com/v1.1/email', {
        method: 'POST',
        headers: {
          Accept: 'application/json',
          'Content-Type': 'application/json',
          Authorization: `Zoho-enczapikey ${token}`,
        },
        body: JSON.stringify(body),
      });
      const text = await res.text();
      let data = null;
      try { data = text ? JSON.parse(text) : null; } catch (_) { /* non-json */ }

      if (!res.ok) {
        const detail =
          data?.error?.message ||
          data?.message ||
          data?.error?.details?.[0]?.message ||
          text.slice(0, 300) ||
          `HTTP ${res.status}`;
        throw new Error(detail);
      }

      const id = data?.request_id || data?.data?.[0]?.message_id || `zepto-${Date.now()}`;
      console.log(`[email/zepto] sent → ${recipient} in ${Date.now() - t0}ms id=${id}`);
      results.push({ messageId: id });
      await new Promise((r) => setTimeout(r, 400));
    } catch (e) {
      console.error(`[email/zepto] Failed to send to ${recipient}:`, e.message);
      errors.push(`${recipient}: ${e.message}`);
    }
  }

  if (results.length === 0) {
    throw Object.assign(
      new Error(errors.length ? errors.join(' | ') : 'All ZeptoMail sends failed.'),
      { status: 502 }
    );
  }

  return {
    id: results.map((r) => r.messageId).join(','),
    to: recipients,
    subject: finalSubject,
    via: 'zeptomail-api',
    partialErrors: errors.length ? errors : undefined,
  };
}

async function verifyZeptoMail() {
  const token = getZeptoToken();
  // Lightweight auth check: empty-ish request should fail with a structured
  // auth error if the token is bad, or validation error if the token is good.
  const res = await fetch('https://api.zeptomail.com/v1.1/email', {
    method: 'POST',
    headers: {
      Accept: 'application/json',
      'Content-Type': 'application/json',
      Authorization: `Zoho-enczapikey ${token}`,
    },
    body: JSON.stringify({}),
  });
  const text = await res.text();
  let data = null;
  try { data = text ? JSON.parse(text) : null; } catch (_) { /* ignore */ }

  // 401/403 → bad token. Other 4xx (e.g. missing fields) means the token was accepted.
  if (res.status === 401 || res.status === 403) {
    const msg = data?.error?.message || data?.message || text.slice(0, 200) || `HTTP ${res.status}`;
    throw Object.assign(new Error(`ZeptoMail token rejected: ${msg}`), { status: 502 });
  }

  const from = parseFrom(process.env.EMAIL_FROM || process.env.ZOHO_USER);
  return {
    ok: true,
    transport: 'zeptomail-api',
    host: 'api.zeptomail.com',
    port: 443,
    user: from.address,
    note: 'HTTPS API — works on Railway Hobby (SMTP ports are blocked there).',
  };
}

// ── SMTP (Railway Pro+ only) ───────────────────────────────────────────────

let _transporter = null;
let _transporterKey = null;
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
  console.log(`[email] SMTP transporter → ${cfg.host}:${cfg.port} as ${cfg.user}`);
  return _transporter;
}

function clearTransporter() {
  _transporter = null;
  _transporterKey = null;
}

async function resolveWorkingTransporter() {
  if (_workingEndpoint) return getTransporter(_workingEndpoint);

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
      if (!isConnectFailure(e) && candidates.indexOf(cfg) === 0) break;
    }
  }

  const err = new Error(
    `Could not reach Zoho SMTP from this server. Tried: ${errors.join(' | ')}. ` +
    `Railway Free/Hobby blocks outbound SMTP (ports 465/587). ` +
    `Use Zoho ZeptoMail HTTPS instead: set ZEPTOMAIL_TOKEN (Send Mail Token from ZeptoMail → Mail Agent → SMTP/API) ` +
    `and EMAIL_FROM with a domain verified in that agent. Or upgrade Railway to Pro for raw SMTP.`
  );
  err.status = 502;
  throw err;
}

function withTimeout(promise, ms, label) {
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

async function sendViaSmtp({ studentName, recipients, pdfBuffer, filename, subject, attachments = [], htmlBody }) {
  const finalSubject = (subject && String(subject).trim()) || buildDefaultSubject(studentName);
  const html = htmlBody || buildHtmlBody(studentName);
  const from = process.env.EMAIL_FROM || process.env.ZOHO_USER;

  // pdfBuffer is optional — custom emails may carry no report attachment.
  const mailAttachments = [
    ...(pdfBuffer
      ? [{ filename: filename || 'progress-report.pdf', content: pdfBuffer, contentType: 'application/pdf' }]
      : []),
    ...(attachments || []).map((a) => ({
      filename: a.filename,
      content: a.content,
      contentType: a.contentType || 'application/pdf',
    })),
  ];

  const results = [];
  const errors = [];
  const sendTimeoutMs = Number(process.env.SMTP_SEND_TIMEOUT_MS) || 60000;
  let transport = await resolveWorkingTransporter();

  for (const recipient of recipients) {
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
      await new Promise((r) => setTimeout(r, 1500));
    } catch (e) {
      console.error(`[SMTP ERROR] Failed to send to ${recipient}:`, e.message || e);
      errors.push(`${recipient}: ${e.message}`);
      clearTransporter();
      _workingEndpoint = null;
      if (isConnectFailure(e)) {
        try { transport = await resolveWorkingTransporter(); } catch (probeErr) {
          errors.push(probeErr.message);
          break;
        }
      }
    }
  }

  if (results.length === 0) {
    throw Object.assign(
      new Error(errors.length ? errors.join(' | ') : 'All email sends failed.'),
      { status: 502 }
    );
  }

  return {
    id: results.map((r) => r?.messageId).join(','),
    to: recipients,
    subject: finalSubject,
    via: 'smtp',
    partialErrors: errors.length ? errors : undefined,
  };
}

// ── Public API ─────────────────────────────────────────────────────────────

async function sendReportEmail({ studentName, recipients, pdfBuffer, filename, startDate, endDate, subject, attachments = [] }) {
  if (!isConfigured()) {
    const err = new Error(
      'Email not configured. On Railway Hobby set ZEPTOMAIL_TOKEN (ZeptoMail HTTPS). ' +
      'SMTP (ZOHO_USER/ZOHO_APP_PASSWORD) only works on Railway Pro+.'
    );
    err.status = 503;
    throw err;
  }

  const to = (recipients || [])
    .map((e) => String(e || '').trim())
    .filter((e) => e && e.includes('@') && !e.includes('example.com'));
  if (to.length === 0) {
    const err = new Error('At least one recipient email is required.');
    err.status = 400;
    throw err;
  }

  try {
    if (hasZeptoMail()) {
      console.log('[email] transport=zeptomail-api (HTTPS)');
      return await sendViaZeptoMail({
        studentName, recipients: to, pdfBuffer, filename, subject, attachments,
      });
    }
    console.log('[email] transport=smtp');
    return await sendViaSmtp({
      studentName, recipients: to, pdfBuffer, filename, subject, attachments,
    });
  } catch (e) {
    const err = new Error(`Email send failed: ${e.message}`);
    err.status = e.status || 502;
    throw err;
  }
}

// Custom (non-report) email — plain admin-written message, optionally with
// attachments (e.g. the progress report PDF when the sender opts in).
// `message` is plain text; it gets escaped and converted to simple HTML.
async function sendCustomEmail({ recipients, subject, message, attachments = [] }) {
  if (!isConfigured()) {
    const err = new Error(
      'Email not configured. On Railway Hobby set ZEPTOMAIL_TOKEN (ZeptoMail HTTPS). ' +
      'SMTP (ZOHO_USER/ZOHO_APP_PASSWORD) only works on Railway Pro+.'
    );
    err.status = 503;
    throw err;
  }

  const to = (recipients || [])
    .map((e) => String(e || '').trim())
    .filter((e) => e && e.includes('@') && !e.includes('example.com'));
  if (to.length === 0) {
    const err = new Error('At least one recipient email is required.');
    err.status = 400;
    throw err;
  }

  const text = String(message || '').trim();
  if (!text) {
    const err = new Error('A message body is required.');
    err.status = 400;
    throw err;
  }

  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  const htmlBody = `<div style="font-family:Arial,Helvetica,sans-serif;font-size:14px;line-height:1.6;color:#1f2937;">${escaped.replace(/\n/g, '<br />')}</div>`;
  const finalSubject = (subject && String(subject).trim()) || 'Prime Academy';

  try {
    if (hasZeptoMail()) {
      console.log('[email/custom] transport=zeptomail-api (HTTPS)');
      return await sendViaZeptoMail({
        recipients: to, pdfBuffer: null, subject: finalSubject, attachments, htmlBody,
      });
    }
    console.log('[email/custom] transport=smtp');
    return await sendViaSmtp({
      recipients: to, pdfBuffer: null, subject: finalSubject, attachments, htmlBody,
    });
  } catch (e) {
    const err = new Error(`Email send failed: ${e.message}`);
    err.status = e.status || 502;
    throw err;
  }
}

async function verifyConnection() {
  if (!isConfigured()) {
    const err = new Error(
      'Email not configured. Set ZEPTOMAIL_TOKEN for Railway Hobby, or ZOHO_USER+ZOHO_APP_PASSWORD on Pro.'
    );
    err.status = 503;
    throw err;
  }
  try {
    if (hasZeptoMail()) {
      return await verifyZeptoMail();
    }
    _workingEndpoint = null;
    clearTransporter();
    await resolveWorkingTransporter();
    const { host, port, user } = _workingEndpoint || getSmtpConfig();
    return { ok: true, transport: 'smtp', host, port, user };
  } catch (e) {
    const err = new Error(e.message);
    err.status = e.status || 502;
    throw err;
  }
}

module.exports = { isConfigured, sendReportEmail, sendCustomEmail, buildDefaultSubject, verifyConnection };
