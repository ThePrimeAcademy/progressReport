// features/report/api/reportApi.js
import apiClient from '../../../services/apiClient.js';

export async function fetchStudents() {
  const response = await apiClient.get('/students');
  return response.data.data;
}

// previewReport now returns { jobId, status } immediately. Caller is expected
// to poll fetchPreviewJobStatus(jobId) until status === 'ready' or 'failed'.
export async function previewReport(payload) {
  const response = await apiClient.post('/report/preview', payload, { timeout: 15000 });
  return response.data.data;
}

export async function fetchPreviewJobStatus(jobId) {
  const response = await apiClient.get(`/report/preview/job/${encodeURIComponent(jobId)}`);
  return response.data.data;
}

// PDF generation is job-based (the render takes longer than Railway's edge
// allows a single request to live): POST enqueues, we poll until ready, then
// hand back the file URL — the caller points a browser tab at it and the
// server streams the PDF inline. Every step is a short request, so transient
// network errors get absorbed by the apiClient retry. The render is usually
// pre-warmed by the preview, so polling often succeeds on the first check.
const PDF_POLL_INTERVAL_MS = 1000;
const PDF_POLL_MAX_ATTEMPTS = 180; // ~3 minutes

export async function requestReportPdf(payload) {
  const start = await apiClient.post('/report', payload, { timeout: 15000 });
  const { jobId } = start.data.data;

  for (let attempt = 0; attempt < PDF_POLL_MAX_ATTEMPTS; attempt++) {
    const res = await apiClient.get(`/report/job/${encodeURIComponent(jobId)}`);
    const job = res.data.data;
    if (job.status === 'ready') break;
    if (job.status === 'failed') throw new Error(job.error || 'PDF generation failed');
    if (attempt === PDF_POLL_MAX_ATTEMPTS - 1) throw new Error('PDF generation timed out — please try again');
    await new Promise((resolve) => setTimeout(resolve, attempt === 0 ? 250 : PDF_POLL_INTERVAL_MS));
  }

  return {
    jobId,
    fileUrl: `${apiClient.defaults.baseURL}/report/job/${encodeURIComponent(jobId)}/file`,
  };
}

export async function listScoringSheets() {
  const response = await apiClient.get('/scoring-sheets');
  return response.data.data || {};
}

function fileToBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result || '';
      const comma = String(result).indexOf(',');
      resolve(comma >= 0 ? String(result).slice(comma + 1) : String(result));
    };
    reader.onerror = () => reject(reader.error || new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

export async function uploadScoringSheet({ groupId, section, file }) {
  const fileBase64 = await fileToBase64(file);
  const response = await apiClient.post('/scoring-sheets', {
    groupId,
    section,
    filename: file.name,
    fileBase64,
  });
  return response.data.data;
}

// Reuse a curve already uploaded to another exam — no file re-upload needed.
export async function copyScoringSheet({ fromGroupId, toGroupId, section }) {
  const response = await apiClient.post('/scoring-sheets/copy', { fromGroupId, toGroupId, section });
  return response.data.data;
}

export async function deleteScoringSheet({ groupId, section }) {
  const response = await apiClient.delete(`/scoring-sheets/${encodeURIComponent(groupId)}/${encodeURIComponent(section)}`);
  return response.data;
}

export async function setScoringSheetBound({ groupId, section, bound }) {
  const response = await apiClient.patch(
    `/scoring-sheets/${encodeURIComponent(groupId)}/${encodeURIComponent(section)}`,
    { bound }
  );
  return response.data.data;
}

// ── SAT exams ──────────────────────────────────────────────────
// An exam maps up to four ClassMarker tests onto DSAT sections 1-4.
// Curves upload through the scoring-sheet endpoints with groupId = exam.curveKey.

export async function fetchExams() {
  const response = await apiClient.get('/exams');
  return response.data.data || [];
}

export async function fetchAvailableTests() {
  const response = await apiClient.get('/exams/available-tests');
  return response.data.data || [];
}

// payload: { name, date?, sections?, studentIds?, hiddenStudentIds? } — fields
// omitted from an update keep their stored value.
export async function createExam(payload) {
  const response = await apiClient.post('/exams', payload);
  return response.data.data;
}

export async function updateExam(examId, payload) {
  const response = await apiClient.put(`/exams/${encodeURIComponent(examId)}`, payload);
  return response.data.data;
}

export async function deleteExam(examId) {
  const response = await apiClient.delete(`/exams/${encodeURIComponent(examId)}`);
  return response.data;
}

// orderedIds: examIds in the desired display order within the program.
export async function reorderExams(programId, orderedIds) {
  const response = await apiClient.post('/exams/reorder', { programId, orderedIds });
  return response.data.data;
}

// { all: true } skips the enrolled-only filter — used by the program roster's
// bulk-enroll, which needs takers who aren't enrolled yet. { group } keeps only
// attempts made under that ClassMarker group (a test can be linked to several).
export async function fetchExamTakers(examId, { all = false, group = '' } = {}) {
  const params = new URLSearchParams();
  if (all) params.set('all', '1');
  if (group) params.set('group', group);
  const qs = params.toString();
  const response = await apiClient.get(`/exams/${encodeURIComponent(examId)}/takers${qs ? `?${qs}` : ''}`);
  return response.data.data || [];
}

export async function fetchExamScoreboard(examId) {
  const response = await apiClient.get(`/exams/${encodeURIComponent(examId)}/scoreboard`);
  return response.data.data;
}

// ── SAT programs ───────────────────────────────────────────────
// A program groups exams into a cohort and owns the student roster for every
// exam inside it. Enrolling a student makes all the program's exams appear in
// their SAT report; non-enrolled students never see them. Exams are linked to
// a program via updateExam(examId, { programId }).

export async function fetchPrograms() {
  const response = await apiClient.get('/programs');
  return response.data.data || [];
}

export async function createProgram(payload) {
  const response = await apiClient.post('/programs', payload);
  return response.data.data;
}

export async function updateProgram(programId, payload) {
  const response = await apiClient.put(`/programs/${encodeURIComponent(programId)}`, payload);
  return response.data.data;
}

export async function deleteProgram(programId) {
  const response = await apiClient.delete(`/programs/${encodeURIComponent(programId)}`);
  return response.data;
}

export async function fetchStudentContacts(studentId) {
  const response = await apiClient.get(
    `/students/${encodeURIComponent(studentId)}/contacts`
  );
  return response.data.data;
}

export async function saveStudentContacts(studentId, contacts) {
  const response = await apiClient.put(
    `/students/${encodeURIComponent(studentId)}/contacts`,
    contacts
  );
  return response.data.data;
}

export async function fetchAllContacts() {
  const response = await apiClient.get('/students/contacts');
  return response.data.data || {};
}

export async function fetchActiveStudents({ startDate, endDate, dayOfWeek }) {
  const params = new URLSearchParams();
  if (startDate) params.set('startDate', startDate);
  if (endDate) params.set('endDate', endDate);
  if (dayOfWeek && dayOfWeek.length) {
    params.set('dayOfWeek', Array.isArray(dayOfWeek) ? dayOfWeek.join(',') : dayOfWeek);
  }
  const qs = params.toString();
  const response = await apiClient.get(`/students/active${qs ? `?${qs}` : ''}`);
  return response.data.data || [];
}

export async function fetchEmailStatus() {
  const response = await apiClient.get('/report/email/status');
  return response.data.data;
}

export async function emailReport(payload) {
  // POST returns immediately with a jobId (work runs in background on the
  // server). Use a short timeout — anything slower than this means the proxy
  // ate the request, not the email send itself.
  const response = await apiClient.post('/report/email', payload, { timeout: 30000 });
  return response.data.data;
}

export async function fetchEmailJobStatus(jobId) {
  const response = await apiClient.get(`/report/email/job/${encodeURIComponent(jobId)}`);
  return response.data.data;
}
