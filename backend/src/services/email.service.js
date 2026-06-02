// services/email.service.js
// Sends progress-report emails via the Gmail API (HTTPS, not SMTP) using a
// long-lived OAuth refresh token. Works from any cloud host because it never
// opens an SMTP port — Gmail's REST endpoint is on standard HTTPS.
//
// Required env vars (set on Railway):
//   GOOGLE_CLIENT_ID       — from Google Cloud Console > Credentials
//   GOOGLE_CLIENT_SECRET   — same place
//   GOOGLE_REFRESH_TOKEN   — generated locally via scripts/get-gmail-refresh-token.js
//
// Optional env var:
//   EMAIL_FROM   — display name + address used in the From: header. Must
//                  match the authenticated Gmail account or one of its
//                  Send-As aliases, otherwise Gmail rejects the send.
//                  If unset, Gmail uses the authenticated account directly.
//
// Local first-time setup is documented in scripts/get-gmail-refresh-token.js.

const { google } = require('googleapis');

function isConfigured() {
  return Boolean(
    process.env.GOOGLE_CLIENT_ID &&
    process.env.GOOGLE_CLIENT_SECRET &&
    process.env.GOOGLE_REFRESH_TOKEN
  );
}

function buildDefaultSubject(studentName) {
  return `Prime Academy Report Card: ${studentName}`;
}

function buildHtmlBody(studentName, startDate, endDate) {
  const range = startDate && endDate
    ? ` covering <strong>${startDate}</strong> to <strong>${endDate}</strong>`
    : '';
  return `
    <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 560px; margin: 0 auto; color: #1f2937;">
      <p>Hi,</p>
      <p>Attached is the Prime Academy progress report for <strong>${studentName}</strong>${range}.</p>
      <p>If you have any questions about this report, just reply to this email.</p>
      <p>— Prime Academy</p>
    </div>
  `;
}

let _oauth2Client = null;
function getOAuth2Client() {
  if (_oauth2Client) return _oauth2Client;
  _oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET
  );
  _oauth2Client.setCredentials({ refresh_token: process.env.GOOGLE_REFRESH_TOKEN });
  return _oauth2Client;
}

function getGmail() {
  return google.gmail({ version: 'v1', auth: getOAuth2Client() });
}

// RFC 2047 encoding for non-ASCII in headers (subject, names) — wraps in
// =?UTF-8?B?...?= so Gmail and other clients render unicode correctly.
function encodeHeader(value) {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7F]*$/.test(value)) return value;
  return `=?UTF-8?B?${Buffer.from(value, 'utf-8').toString('base64')}?=`;
}

function buildRfc822Message({ from, to, subject, html, attachment }) {
  const boundary = `----=_PrimeReport_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const pdfBase64 = Buffer.from(attachment.content).toString('base64');
  // RFC 5322: lines must be <= 998 chars; base64 typically wraps at 76.
  const pdfWrapped = pdfBase64.match(/.{1,76}/g).join('\r\n');

  const lines = [];
  if (from) lines.push(`From: ${encodeHeader(from)}`);
  lines.push(`To: ${to.join(', ')}`);
  lines.push(`Subject: ${encodeHeader(subject)}`);
  lines.push('MIME-Version: 1.0');
  lines.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
  lines.push('');
  lines.push(`--${boundary}`);
  lines.push('Content-Type: text/html; charset="UTF-8"');
  lines.push('Content-Transfer-Encoding: 7bit');
  lines.push('');
  lines.push(html);
  lines.push('');
  lines.push(`--${boundary}`);
  lines.push(`Content-Type: application/pdf; name="${attachment.filename}"`);
  lines.push(`Content-Disposition: attachment; filename="${attachment.filename}"`);
  lines.push('Content-Transfer-Encoding: base64');
  lines.push('');
  lines.push(pdfWrapped);
  lines.push('');
  lines.push(`--${boundary}--`);
  return lines.join('\r\n');
}

// Gmail expects URL-safe base64 with no padding.
function toBase64Url(input) {
  return Buffer.from(input, 'utf-8')
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

async function sendReportEmail({ studentName, recipients, pdfBuffer, filename, startDate, endDate, subject }) {
  if (!isConfigured()) {
    const err = new Error(
      'Email service not configured. Set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, and GOOGLE_REFRESH_TOKEN on the backend.'
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
  const from = process.env.EMAIL_FROM || '';

  const rfc822 = buildRfc822Message({
    from,
    to,
    subject: finalSubject,
    html,
    attachment: {
      filename: filename || 'progress-report.pdf',
      content: pdfBuffer,
    },
  });

  try {
    const res = await getGmail().users.messages.send({
      userId: 'me',
      requestBody: { raw: toBase64Url(rfc822) },
    });
    return { id: res?.data?.id || null, to, subject: finalSubject };
  } catch (e) {
    const upstream = e?.errors?.[0]?.message || e.message;
    const err = new Error(`Gmail API send failed: ${upstream}`);
    err.status = 502;
    throw err;
  }
}

// verifyConnection — confirms the OAuth refresh token + client credentials
// are valid by exchanging the refresh token for a fresh access token. This
// works regardless of which Gmail scope was granted (we only request
// gmail.send, which is insufficient for users.getProfile).
async function verifyConnection() {
  if (!isConfigured()) {
    const err = new Error('Gmail API not configured (set GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET, GOOGLE_REFRESH_TOKEN)');
    err.status = 503;
    throw err;
  }
  try {
    const { token } = await getOAuth2Client().getAccessToken();
    if (!token) throw new Error('No access token returned');
    return {
      ok: true,
      scope: 'gmail.send',
      tokenPreview: token.slice(0, 12) + '…',
    };
  } catch (e) {
    const upstream = e?.errors?.[0]?.message || e.response?.data?.error_description || e.message;
    const err = new Error(`Gmail API verify failed: ${upstream}`);
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
