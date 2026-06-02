// features/report/hooks/useGenerateReport.js
import { useState, useEffect, useCallback } from 'react';
import {
  fetchStudents,
  previewReport,
  downloadReport,
  listScoringSheets,
  fetchStudentContacts,
  saveStudentContacts,
  fetchEmailStatus,
  emailReport,
} from '../api/reportApi.js';
import { downloadFile } from '../../../utils/downloadFile.js';

export function useGenerateReport() {
  const [students, setStudents] = useState([]);
  const [studentsLoading, setStudentsLoading] = useState(true);
  const [studentsError, setStudentsError] = useState(null);

  const [selectedStudentId, setSelectedStudentId] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [dayOfWeek, setDayOfWeek] = useState([]);

  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);

  const [downloadLoading, setDownloadLoading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  const [scoringSheets, setScoringSheets] = useState({});

  const [contacts, setContacts] = useState({ studentEmail: '', parentEmail: '' });
  const [contactsLoading, setContactsLoading] = useState(false);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState(null);
  const [emailSuccess, setEmailSuccess] = useState(null);

  const refreshScoringSheets = useCallback(async () => {
    try {
      const data = await listScoringSheets();
      setScoringSheets(data || {});
    } catch (err) {
      // Non-fatal; report still renders without scoring-sheet metadata.
      console.warn('Failed to load scoring sheets', err.message);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;
    async function load() {
      try {
        setStudentsLoading(true);
        setStudentsError(null);
        const data = await fetchStudents();
        if (!cancelled) setStudents(data);
      } catch (err) {
        if (!cancelled) setStudentsError(err.message);
      } finally {
        if (!cancelled) setStudentsLoading(false);
      }
    }
    load();
    refreshScoringSheets();
    fetchEmailStatus()
      .then((s) => setEmailConfigured(Boolean(s?.configured)))
      .catch(() => setEmailConfigured(false));
    return () => { cancelled = true; };
  }, [refreshScoringSheets]);

  useEffect(() => {
    let cancelled = false;
    setEmailError(null);
    setEmailSuccess(null);
    if (!selectedStudentId) {
      setContacts({ studentEmail: '', parentEmail: '' });
      return;
    }
    setContactsLoading(true);
    fetchStudentContacts(selectedStudentId)
      .then((c) => { if (!cancelled) setContacts({ studentEmail: c?.studentEmail || '', parentEmail: c?.parentEmail || '' }); })
      .catch(() => { if (!cancelled) setContacts({ studentEmail: '', parentEmail: '' }); })
      .finally(() => { if (!cancelled) setContactsLoading(false); });
    return () => { cancelled = true; };
  }, [selectedStudentId]);

  useEffect(() => {
    setPreviewData(null);
    setPreviewError(null);
    setDownloadSuccess(false);
  }, [selectedStudentId, startDate, endDate, dayOfWeek]);

  const handlePreview = useCallback(async () => {
    setPreviewError(null);
    setPreviewData(null);
    setPreviewLoading(true);
    setDownloadSuccess(false);
    try {
      const data = await previewReport({
        studentId: selectedStudentId,
        startDate,
        endDate,
        dayOfWeek: dayOfWeek || undefined,
      });
      setPreviewData(data);
    } catch (err) {
      setPreviewError(err.message);
    } finally {
      setPreviewLoading(false);
    }
  }, [selectedStudentId, startDate, endDate, dayOfWeek]);

  const handleDownload = useCallback(async () => {
    setDownloadError(null);
    setDownloadSuccess(false);
    setDownloadLoading(true);
    try {
      const { buffer, filename } = await downloadReport({
        studentId: selectedStudentId,
        startDate,
        endDate,
        dayOfWeek: dayOfWeek || undefined,
      });
      downloadFile(buffer, filename, 'application/pdf');
      setDownloadSuccess(true);
    } catch (err) {
      setDownloadError(err.message);
    } finally {
      setDownloadLoading(false);
    }
  }, [selectedStudentId, startDate, endDate, dayOfWeek]);

  const updateContacts = useCallback((patch) => {
    setContacts((c) => ({ ...c, ...patch }));
    setEmailSuccess(null);
    setEmailError(null);
  }, []);

  const saveContacts = useCallback(async () => {
    if (!selectedStudentId) return;
    await saveStudentContacts(selectedStudentId, contacts);
  }, [selectedStudentId, contacts]);

  const handleEmail = useCallback(async () => {
    setEmailError(null);
    setEmailSuccess(null);
    setEmailLoading(true);
    try {
      const result = await emailReport({
        studentId: selectedStudentId,
        startDate,
        endDate,
        dayOfWeek: dayOfWeek || undefined,
        studentEmail: contacts.studentEmail || '',
        parentEmail: contacts.parentEmail || '',
      });
      setEmailSuccess(
        result?.to?.length
          ? `Sent to ${result.to.join(', ')}`
          : 'Email sent.'
      );
    } catch (err) {
      setEmailError(err.message);
    } finally {
      setEmailLoading(false);
    }
  }, [selectedStudentId, startDate, endDate, dayOfWeek, contacts]);

  const isValid =
    selectedStudentId !== '' &&
    startDate !== '' &&
    endDate !== '' &&
    new Date(startDate) <= new Date(endDate);

  return {
    students, studentsLoading, studentsError, setStudents,
    selectedStudentId, setSelectedStudentId,
    startDate, setStartDate,
    endDate, setEndDate,
    dayOfWeek, setDayOfWeek,
    previewData, previewLoading, previewError,
    downloadLoading, downloadError, downloadSuccess,
    handlePreview, handleDownload,
    scoringSheets, refreshScoringSheets,
    contacts, updateContacts, saveContacts, contactsLoading,
    emailConfigured, emailLoading, emailError, emailSuccess,
    handleEmail,
    isValid,
  };
}