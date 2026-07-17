// services/report-delivery.service.js
// Shared report-delivery pipeline: resolve a student, gather their data across
// ClassMarker / SAT / webhook sources, render the PDF, and email it. Both the
// on-demand POST /api/report/email route and the scheduled-batch sender call
// buildAndSendReport, so there is exactly one delivery code path to maintain.

const {
  getStudentById,
  getStudentResultsGrouped,
  getLatestTestResult,
  computeCategoryPerformance,
} = require('./classmarker.service');
const { getSatScoresForStudent } = require('./sat.service');
const { getProgramForStudent } = require('./program.service');
const { getProgramSummary } = require('./program-summary.service');
const {
  getLatestWebhookTestResult,
  getWebhookCategoryPerformance,
  getWebhookCategoryPerformanceSplit,
} = require('./webhook.service');
const { computeStats } = require('./stats.service');
const { generateReportPDF, generateProgramSummaryPDF } = require('./pdf.service');
const { sendReportEmail } = require('./email.service');
const db = require('./db.service');

// Concatenated first+last+"Report" — e.g. "Darin Kim" -> "DarinKimReport".
// Strips diacritics/whitespace/punctuation so it's safe in Content-Disposition.
function buildReportFilename(studentName) {
  const cleaned = String(studentName || 'Student')
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9 ]+/g, '')
    .trim()
    .split(/\s+/)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join('');
  return `${cleaned}Report`;
}

// Resolve student — handles both ClassMarker IDs and sheets: prefixed IDs.
async function resolveStudent(studentId) {
  if (studentId.startsWith('sheets:')) {
    const { loadRecords } = require('./sheets.service');
    const records = await loadRecords();
    const key = studentId.replace('sheets:', '');
    const record = records?.find((r) =>
      r.normalized_email === key || r.normalized_name === key
    );
    if (!record) throw Object.assign(new Error(`Student "${studentId}" not found`), { status: 404 });
    return { id: studentId, name: record.name, email: record.email };
  }
  return getStudentById(studentId);
}

// Gather everything the PDF template needs for one student over a date range.
// Identical for preview, on-demand download, and scheduled sends.
async function gatherReportData({ studentId, startDate, endDate, dayOfWeek }) {
  const student = await resolveStudent(studentId);
  const isSheets = studentId.startsWith('sheets:');

  const [groups, apiLatestTest, satScores, webhookLatestTest, webhookCategoryPerf, webhookCategorySplit] = await Promise.all([
    isSheets ? Promise.resolve([]) : getStudentResultsGrouped(studentId, startDate, endDate, dayOfWeek),
    isSheets ? Promise.resolve(null) : getLatestTestResult(studentId, startDate, endDate, dayOfWeek),
    getSatScoresForStudent(student),
    getLatestWebhookTestResult(student, startDate, endDate, dayOfWeek),
    getWebhookCategoryPerformance(student, startDate, endDate, dayOfWeek),
    getWebhookCategoryPerformanceSplit(student, startDate, endDate, dayOfWeek),
  ]);

  const allResults = groups.flatMap((g) => g.results);
  const stats = computeStats(allResults);
  const categoryPerf = webhookCategoryPerf.length
    ? webhookCategoryPerf
    : computeCategoryPerformance(groups);
  const latestTest = webhookLatestTest || apiLatestTest;

  return {
    student, groups, stats, satScores, startDate, endDate,
    latestTest, categoryPerf, categoryPerfSplit: webhookCategorySplit,
  };
}

// Build the PDF for one student and email it to the given recipients, then
// persist the recipients as that student's saved contacts (mirrors the prior
// inline behaviour of POST /api/report/email). Throws on any failure so the
// Best-effort program summary PDF for a student — the group-level "how we're
// doing" context that rides along with the report card. Returns an attachment
// object or null; a summary failure never blocks the report itself.
async function buildProgramSummaryAttachment(studentId, tag = `[report-delivery ${studentId}]`) {
  const program = getProgramForStudent(studentId);
  if (!program) return null;
  try {
    const tSum = Date.now();
    const summary = await getProgramSummary(program.programId);
    if (!summary) return null;
    const summaryPdf = await generateProgramSummaryPDF(summary);
    console.log(`${tag} program summary attached in ${Date.now() - tSum}ms`);
    return { filename: `${program.name} Summary.pdf`, content: summaryPdf };
  } catch (err) {
    console.warn(`${tag} program summary attach failed:`, err.message);
    return null;
  }
}

// Report PDF + best-effort program summary as a ready-to-send attachments
// array. Shared by the custom-email send (Email tab) and its scheduled
// counterpart, so "Attach progress report" always matches what the report
// pipeline itself would send.
async function buildReportAttachments({ studentId, startDate, endDate, dayOfWeek }) {
  const data = await gatherReportData({ studentId, startDate, endDate, dayOfWeek });
  const pdfBuffer = await generateReportPDF(
    data.student, data.groups, data.stats, data.satScores,
    startDate, endDate, data.latestTest, data.categoryPerf, data.categoryPerfSplit
  );
  const attachments = [{ filename: `${buildReportFilename(data.student.name)}.pdf`, content: pdfBuffer }];
  const summary = await buildProgramSummaryAttachment(data.student.id);
  if (summary) attachments.push(summary);
  return attachments;
}

// caller can mark the job/item failed.
async function buildAndSendReport({
  studentId, startDate, endDate, dayOfWeek,
  recipients, studentEmail, parentEmail, subject, homework,
}) {
  const t0 = Date.now();
  const tag = `[report-delivery ${studentId}]`;

  console.log(`${tag} gather data…`);
  const data = await gatherReportData({ studentId, startDate, endDate, dayOfWeek });
  console.log(`${tag} gather done in ${Date.now() - t0}ms name=${data.student?.name || '?'}`);

  const tPdf = Date.now();
  console.log(`${tag} render PDF…`);
  const pdfBuffer = await generateReportPDF(
    data.student, data.groups, data.stats, data.satScores,
    startDate, endDate, data.latestTest, data.categoryPerf, data.categoryPerfSplit, homework
  );
  const filename = `${buildReportFilename(data.student.name)}.pdf`;
  console.log(`${tag} PDF ready in ${Date.now() - tPdf}ms (${Math.round((pdfBuffer?.length || 0) / 1024)}KB)`);

  const attachments = [];
  const summaryAttachment = await buildProgramSummaryAttachment(data.student.id, tag);
  if (summaryAttachment) attachments.push(summaryAttachment);

  const tSmtp = Date.now();
  console.log(`${tag} SMTP send → ${(recipients || []).join(', ')}`);
  const sendResult = await sendReportEmail({
    studentName: data.student.name,
    recipients,
    pdfBuffer,
    filename,
    startDate,
    endDate,
    subject,
    attachments,
  });
  console.log(`${tag} SMTP done in ${Date.now() - tSmtp}ms (total ${Date.now() - t0}ms)`);

  // Persist whichever of student/parent emails were supplied so the contact
  // pills stay accurate. A scheduled batch always carries its recipients.
  if (studentEmail !== undefined || parentEmail !== undefined) {
    await db.setContacts(studentId, {
      studentEmail: studentEmail || '',
      parentEmail: parentEmail || '',
    });
  }

  return sendResult;
}

module.exports = {
  buildReportFilename,
  resolveStudent,
  gatherReportData,
  buildReportAttachments,
  buildAndSendReport,
};
