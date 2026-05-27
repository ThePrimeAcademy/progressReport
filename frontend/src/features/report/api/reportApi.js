// features/report/api/reportApi.js
import apiClient from '../../../services/apiClient.js';

export async function fetchStudents() {
  const response = await apiClient.get('/students');
  return response.data.data;
}

export async function previewReport(payload) {
  const response = await apiClient.post('/report/preview', payload);
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
