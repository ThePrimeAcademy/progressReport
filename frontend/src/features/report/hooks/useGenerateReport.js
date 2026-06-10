// features/report/hooks/useGenerateReport.js
import { useState, useEffect, useCallback } from 'react';
import {
  fetchStudents,
  previewReport,
  fetchPreviewJobStatus,
  requestReportPdf,
  fetchStudentContacts,
  saveStudentContacts,
  fetchAllContacts,
  fetchActiveStudents,
  fetchEmailStatus,
  emailReport,
  fetchEmailJobStatus,
} from '../api/reportApi.js';

// Only include homework in a request when both counts are set — a partial
// selection means the admin hasn't finished, so the PDF omits the section.
function buildHomeworkPayload({ total, completed }) {
  if (total === '' || completed === '') return undefined;
  return { total: Number(total), completed: Number(completed) };
}

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

  // Admin-entered homework completion — sent with the PDF/email request so
  // parents see a completed/total bar in the report. Cleared whenever the
  // report inputs change so counts never leak across students or ranges.
  const [homework, setHomework] = useState({ total: '', completed: '' });

  const [contacts, setContacts] = useState({ studentEmail: '', parentEmail: '' });
  const [contactsLoading, setContactsLoading] = useState(false);
  const [allContacts, setAllContacts] = useState({});
  const [allContactsLoading, setAllContactsLoading] = useState(true);
  // null = filter not applied (e.g. dates not set or fetch in flight on
  // first render). When a Set, only students whose id is in the set are
  // shown in the picker/dropdown.
  const [activeStudentIds, setActiveStudentIds] = useState(null);
  const [emailConfigured, setEmailConfigured] = useState(false);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState(null);
  const [emailSuccess, setEmailSuccess] = useState(null);
  const [emailSubject, setEmailSubject] = useState('');

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
    fetchEmailStatus()
      .then((s) => setEmailConfigured(Boolean(s?.configured)))
      .catch(() => setEmailConfigured(false));
    setAllContactsLoading(true);
    fetchAllContacts()
      .then((c) => { if (!cancelled) setAllContacts(c || {}); })
      .catch(() => { if (!cancelled) setAllContacts({}); })
      .finally(() => { if (!cancelled) setAllContactsLoading(false); });
    return () => { cancelled = true; };
  }, []);

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
    setHomework({ total: '', completed: '' });
  }, [selectedStudentId, startDate, endDate, dayOfWeek]);

  // Filter the picker / dropdown to only students who actually have a
  // finished test in the selected date range. Debounced so quickly
  // tweaking the date inputs doesn't fire a flood of requests. The
  // endpoint is local-only (no ClassMarker call).
  useEffect(() => {
    if (!startDate || !endDate) {
      setActiveStudentIds(null);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(async () => {
      try {
        const ids = await fetchActiveStudents({ startDate, endDate, dayOfWeek });
        if (!cancelled) setActiveStudentIds(new Set(ids));
      } catch (_) {
        if (!cancelled) setActiveStudentIds(null);
      }
    }, 400);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [startDate, endDate, dayOfWeek]);

  const filteredStudents = activeStudentIds
    ? students.filter((s) => activeStudentIds.has(s.id))
    : students;

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
    // Open the tab synchronously, inside the click gesture, so popup blockers
    // allow it — then navigate it to the PDF once the render finishes.
    // (Opening after the async wait used to get blocked and fall back to a
    // literal file download.)
    let tab = null;
    try {
      tab = window.open('', '_blank');
      if (tab) {
        tab.document.write(
          '<title>Generating report…</title>' +
          '<body style="margin:0;display:grid;place-items:center;height:100vh;' +
          'font-family:system-ui,sans-serif;color:#1a56db;background:#f8faff">' +
          '<div style="text-align:center"><div style="font-size:2rem;margin-bottom:10px">⏳</div>' +
          'Generating report…</div></body>'
        );
      }
    } catch (_) {
      tab = null;
    }
    try {
      const { fileUrl } = await requestReportPdf({
        studentId: selectedStudentId,
        startDate,
        endDate,
        dayOfWeek: dayOfWeek || undefined,
        homework: buildHomeworkPayload(homework),
      });
      if (tab && !tab.closed) {
        tab.location.replace(fileUrl);
      } else if (!window.open(fileUrl, '_blank')) {
        throw new Error('Pop-up blocked — allow pop-ups for this site to view the report.');
      }
      setDownloadSuccess(true);
    } catch (err) {
      if (tab && !tab.closed) tab.close();
      setDownloadError(err.message);
    } finally {
      setDownloadLoading(false);
    }
  }, [selectedStudentId, startDate, endDate, dayOfWeek, homework]);

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
        homework: buildHomeworkPayload(homework),
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
  }, [selectedStudentId, startDate, endDate, dayOfWeek, contacts, emailSubject, homework]);

  const isValid =
    selectedStudentId !== '' &&
    startDate !== '' &&
    endDate !== '' &&
    new Date(startDate) <= new Date(endDate);

  return {
    students, studentsLoading, studentsError, setStudents,
    filteredStudents,
    activeStudentIds,
    selectedStudentId, setSelectedStudentId,
    startDate, setStartDate,
    endDate, setEndDate,
    dayOfWeek, setDayOfWeek,
    previewData, previewLoading, previewError,
    downloadLoading, downloadError, downloadSuccess,
    homework, setHomework,
    handlePreview, handleDownload,
    contacts, updateContacts, saveContacts, contactsLoading,
    allContacts, allContactsLoading, noteContactsSaved,
    emailConfigured, emailLoading, emailError, emailSuccess,
    emailSubject, setEmailSubject,
    handleEmail,
    isValid,
  };
}