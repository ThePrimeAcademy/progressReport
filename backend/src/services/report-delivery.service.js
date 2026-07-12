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
  
  // FIX: Split the standard API results if the webhook split isn't available
  let finalCategorySplit = webhookCategorySplit;
  
  if (!finalCategorySplit && groups.length > 0) {
    const englishTest = groups[0]?.results?.[0]; // Test 1 (index 0)
    const mathTest = groups[0]?.results?.[1];    // Test 2 (index 1)
    
    finalCategorySplit = {
      english: englishTest ? computeCategoryPerformance([{ results: [englishTest] }]) : [],
      math: mathTest ? computeCategoryPerformance([{ results: [mathTest] }]) : []
    };
  }

  const categoryPerf = webhookCategoryPerf.length
    ? webhookCategoryPerf
    : computeCategoryPerformance(groups);
  const latestTest = webhookLatestTest || apiLatestTest;

  return {
    student, groups, stats, satScores, startDate, endDate,
    latestTest, categoryPerf, categoryPerfSplit: finalCategorySplit,
  };
}

// Build the PDF for one student and email it to the given recipients, then
// persist the recipients as that student's saved contacts (mirrors the prior
// inline behaviour of POST /api/report/email). Throws on any failure so the
// caller can mark the job/item failed.
async function buildAndSendReport({
  studentId, startDate, endDate, dayOfWeek,
  recipients, studentEmail, parentEmail, subject, homework,
}) {
  const data = await gatherReportData({ studentId, startDate, endDate, dayOfWeek });

  const pdfBuffer = await generateReportPDF(
    data.student, data.groups, data.stats, data.satScores,
    startDate, endDate, data.latestTest, data.categoryPerf, data.categoryPerfSplit, homework
  );
  const filename = `${buildReportFilename(data.student.name)}.pdf`;

  // Ride the student's program summary along with the report card so families
  // get the group-level "how we're doing" context. Best-effort: a summary
  // failure never blocks the report card itself.
  const attachments = [];
  const program = getProgramForStudent(data.student.id);
  if (program) {
    try {
      const summary = await getProgramSummary(program.programId);
      if (summary) {
        const summaryPdf = await generateProgramSummaryPDF(summary);
        attachments.push({ filename: `${program.name} Summary.pdf`, content: summaryPdf });
      }
    } catch (err) {
      console.warn(`[report] program summary attach failed for ${data.student.id}:`, err.message);
    }
  }

 // Inside buildAndSendReport
let sendResult;
try {
  sendResult = await sendReportEmail({
    studentName: data.student.name,
    recipients,
    pdfBuffer,
    filename,
    startDate,
    endDate,
    subject,
    attachments,
  });
} catch (err) {
  // Log the actual error from Zoho, not just "send failed"
  console.error(`[report] SMTP failure for ${data.student.id}:`, err.message, err.stack);
  throw err; // Re-throw so the caller knows the job failed
}
}

module.exports = {
  buildReportFilename,
  resolveStudent,
  gatherReportData,
  buildAndSendReport,
};
