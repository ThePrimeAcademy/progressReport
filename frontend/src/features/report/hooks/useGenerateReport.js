// features/report/hooks/useGenerateReport.js
import { useState, useEffect, useCallback } from 'react';
import {
  fetchStudents,
  previewReport,
  fetchPreviewJobStatus,
  downloadReport,
  listScoringSheets,
  fetchStudentContacts,
  saveStudentContacts,
  fetchAllContacts,
  fetchEmailStatus,
  emailReport,
  fetchEmailJobStatus,
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
  const [allContacts, setAllContacts] = useState({});
  const [allContactsLoading, setAllContactsLoading] = useState(true);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState(null);
  const [emailSuccess, setEmailSuccess] = useState(null);
  const [emailSubject, setEmailSubject] = useState('');

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
    setAllContactsLoading(true);
    fetchAllContacts()
      .then((c) => { if (!cancelled) setAllContacts(c || {}); })
      .catch(() => { if (!cancelled) setAllContacts({}); })
      .finally(() => { if (!cancelled) setAllContactsLoading(false); });
    return () => { cancelled = true; };
  }, [refreshScoringSheets]);

  useEffect(() => {
    let cancelled = false;
    setEmailError(null);
    setEmailSuccess(null);
    setEmailSubject('');
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
      const start = await previewReport({
        studentId: selectedStudentId,
        startDate,
        endDate,
        dayOfWeek: dayOfWeek || undefined,
      });
      const jobId = start?.jobId;
      if (!jobId) throw new Error('Server did not return a preview job id.');

      // Poll up to ~60s; the data gather is usually <2s when cache is warm.
      // First check after 200ms, then every 1s.
      let job = null;
      for (let i = 0; i < 60; i++) {
        await new Promise((r) => setTimeout(r, i === 0 ? 200 : 1000));
        try {
          job = await fetchPreviewJobStatus(jobId);
        } catch (e) {
          throw new Error(e.message || 'Lost track of the preview job.');
        }
        if (job?.status === 'ready' || job?.status === 'failed') break;
      }
      if (!job || job.status === 'pending') {
        throw new Error('Preview is taking longer than expected. Try again.');
      }
      if (job.status === 'failed') {
        throw new Error(job.error || 'Preview failed.');
      }
      setPreviewData(job.result);
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
    // Keep the cached bulk-mode map in sync without a refetch.
    setAllContacts((prev) => ({
      ...prev,
      [selectedStudentId]: {
        studentEmail: contacts.studentEmail || '',
        parentEmail: contacts.parentEmail || '',
      },
    }));
  }, [selectedStudentId, contacts]);

  // Called by the bulk panel after a successful per-student send so the
  // pill state reflects whatever was just persisted on the backend.
  const noteContactsSaved = useCallback((studentId, c) => {
    if (!studentId) return;
    setAllContacts((prev) => ({
      ...prev,
      [studentId]: {
        studentEmail: c?.studentEmail || '',
        parentEmail: c?.parentEmail || '',
      },
    }));
  }, []);

  const handleEmail = useCallback(async () => {
    setEmailError(null);
    setEmailSuccess(null);
    setEmailLoading(true);
    try {
      const start = await emailReport({
        studentId: selectedStudentId,
        startDate,
        endDate,
        dayOfWeek: dayOfWeek || undefined,
        studentEmail: contacts.studentEmail || '',
        parentEmail: contacts.parentEmail || '',
        subject: emailSubject || undefined,
      });

      const jobId = start?.jobId;
      if (!jobId) throw new Error('Server did not return a job id.');

      // Poll every 2s; total budget ~3 minutes which is well past any realistic
      // PDF + Gmail latency. The dedupe key/jobId is stable across retries, so
      // re-clicking Send while a job is pending just rejoins the same job.
      const maxAttempts = 90;
      let job = null;
      for (let i = 0; i < maxAttempts; i++) {
        // First poll after a 1s delay; subsequent polls every 2s.
        await new Promise((r) => setTimeout(r, i === 0 ? 1000 : 2000));
        try {
          job = await fetchEmailJobStatus(jobId);
        } catch (e) {
          // 404 means the job expired or the server restarted — treat as failed.
          throw new Error(e.message || 'Lost track of the send job.');
        }
        if (job?.status === 'sent' || job?.status === 'failed') break;
      }

      if (!job || job.status === 'pending') {
        throw new Error('Send is taking longer than expected. Please check your inbox before retrying.');
      }
      if (job.status === 'failed') {
        throw new Error(job.error || 'Send failed.');
      }

      const result = job.result || {};
      const recipients = result?.to?.length ? result.to.join(', ') : '';
      if (start?.deduplicated) {
        setEmailSuccess(
          recipients
            ? `Already sent to ${recipients} in the last few minutes — no duplicate sent.`
            : 'Already sent recently — no duplicate sent.'
        );
      } else {
        setEmailSuccess(recipients ? `Sent to ${recipients}` : 'Email sent.');
      }
    } catch (err) {
      setEmailError(err.message);
    } finally {
      setEmailLoading(false);
    }
  }, [selectedStudentId, startDate, endDate, dayOfWeek, contacts, emailSubject]);

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
    allContacts, allContactsLoading, noteContactsSaved,
    emailConfigured, emailLoading, emailError, emailSuccess,
    emailSubject, setEmailSubject,
    handleEmail,
    isValid,
  };
}