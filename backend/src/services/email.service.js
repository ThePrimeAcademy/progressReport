// services/email.service.js
// Sends progress-report emails via Resend.
// Required env vars:
//   RESEND_API_KEY   — API key from https://resend.com
//   EMAIL_FROM       — verified sender, e.g. "Prime Academy <reports@yourdomain.com>"

function isConfigured() {
  return Boolean(process.env.RESEND_API_KEY && process.env.EMAIL_FROM);
}

function buildSubject(studentName) {
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

async function sendReportEmail({ studentName, recipients, pdfBuffer, filename, startDate, endDate }) {
  if (!isConfigured()) {
    const err = new Error(
      'Email service not configured. Set RESEND_API_KEY and EMAIL_FROM in backend/.env.'
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

  const subject = buildSubject(studentName);
  const html = buildHtmlBody(studentName, startDate, endDate);

  const payload = {
    from: process.env.EMAIL_FROM,
    to,
    subject,
    html,
    attachments: [
      {
        filename: filename || 'progress-report.pdf',
        content: Buffer.from(pdfBuffer).toString('base64'),
      },
    ],
  };

  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(payload),
  });

  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const message = body?.message || body?.error || `Resend HTTP ${res.status}`;
    const err = new Error(`Failed to send email: ${message}`);
    err.status = res.status >= 400 && res.status < 600 ? res.status : 502;
    throw err;
  }

  return { id: body?.id || null, to, subject };
}

module.exports = {
  isConfigured,
  sendReportEmail,
  buildSubject,
};
