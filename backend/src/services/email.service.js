// services/email.service.js
// Sends progress-report emails via SMTP (nodemailer). Works with any SMTP
// provider — Gmail, iCloud, Outlook, Resend's SMTP gateway, etc.
//
// Required env vars:
//   SMTP_USER   — your account, e.g. you@gmail.com
//   SMTP_PASS   — app password (Gmail/iCloud) or SMTP password
//
// Optional env vars:
//   SMTP_HOST   — default smtp.gmail.com
//   SMTP_PORT   — default 465
//   SMTP_SECURE — default "true" (true for 465, false for 587/STARTTLS)
//   EMAIL_FROM  — default falls back to SMTP_USER
//
// Gmail setup (most common path):
//   1. Turn on 2-Step Verification on your Google account.
//   2. Generate an App Password at https://myaccount.google.com/apppasswords.
//   3. Set SMTP_USER=your.address@gmail.com, SMTP_PASS=<16-char app password>.

const nodemailer = require('nodemailer');

function isConfigured() {
  return Boolean(process.env.SMTP_USER && process.env.SMTP_PASS);
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

let _transporter = null;
function getTransporter() {
  if (_transporter) return _transporter;
  const port = Number(process.env.SMTP_PORT) || 465;
  const secureEnv = process.env.SMTP_SECURE;
  const secure = secureEnv != null ? secureEnv !== 'false' : port === 465;
  _transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port,
    secure,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
  });
  return _transporter;
}

async function sendReportEmail({ studentName, recipients, pdfBuffer, filename, startDate, endDate, subject }) {
  if (!isConfigured()) {
    const err = new Error(
      'Email service not configured. Set SMTP_USER and SMTP_PASS in backend/.env (or on Railway Variables).'
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
  const from = process.env.EMAIL_FROM || process.env.SMTP_USER;

  try {
    const info = await getTransporter().sendMail({
      from,
      to,
      subject: finalSubject,
      html,
      attachments: [
        {
          filename: filename || 'progress-report.pdf',
          content: Buffer.from(pdfBuffer),
        },
      ],
    });

    return { id: info?.messageId || null, to, subject: finalSubject };
  } catch (e) {
    const err = new Error(`Failed to send email: ${e.message}`);
    err.status = 502;
    throw err;
  }
}

// verifyConnection — tests SMTP auth/connectivity in seconds without sending.
// Returns { ok: true } or throws with the underlying error message.
async function verifyConnection() {
  if (!isConfigured()) {
    const err = new Error('SMTP_USER / SMTP_PASS not set');
    err.status = 503;
    throw err;
  }
  try {
    await getTransporter().verify();
    return {
      ok: true,
      host: process.env.SMTP_HOST || 'smtp.gmail.com',
      port: Number(process.env.SMTP_PORT) || 465,
      user: process.env.SMTP_USER,
    };
  } catch (e) {
    const err = new Error(`SMTP verify failed: ${e.message}`);
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
