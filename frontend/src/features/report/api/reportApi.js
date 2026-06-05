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

export async function downloadReport(payload) {
  const response = await apiClient.post('/report', payload, {
    responseType: 'arraybuffer',
  });
  const disposition = response.headers['content-disposition'] || '';
  const match = disposition.match(/filename="?([^"]+)"?/);
  const filename = match ? match[1] : `progress-report.pdf`;
  return { buffer: response.data, filename };
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

export async function createExam({ name, sections }) {
  const response = await apiClient.post('/exams', { name, sections });
  return response.data.data;
}

export async function updateExam(examId, { name, sections }) {
  const response = await apiClient.put(`/exams/${encodeURIComponent(examId)}`, { name, sections });
  return response.data.data;
}

export async function deleteExam(examId) {
  const response = await apiClient.delete(`/exams/${encodeURIComponent(examId)}`);
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
