// features/report/hooks/useGenerateReport.js
// State behind the report screens: the date range every tab shares, and for
// the Single Student page the chosen student, the preview, the PDF and the
// report email. Students, saved contacts and the email setting come from the
// shared query cache (see api/queries.js).
import { useState, useEffect, useCallback, useRef } from 'react';
import {
  previewReport,
  fetchPreviewJobStatus,
  requestReportPdf,
  saveStudentContacts,
  emailReport,
  fetchEmailJobStatus,
} from '../api/reportApi.js';
import {
  useContacts,
  useEmailConfigured,
  useNoteContactsSaved,
  useStudents,
  useStudentsById,
} from '../api/queries.js';
import { PROGRAM_START_DATE } from '../constants.js';
import { serverToday } from '@/lib/dates';

const NO_CONTACTS = { studentEmail: '', parentEmail: '' };

// Only include homework in a request when both counts are set - a partial
// selection means the admin hasn't finished, so the PDF omits the section.
function buildHomeworkPayload({ total, completed }) {
  if (total === '' || completed === '') return undefined;
  return { total: Number(total), completed: Number(completed) };
}

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export function useGenerateReport() {
  const { students, isPending: studentsLoading, error: studentsQueryError } = useStudents();
  const studentsById = useStudentsById();
  const { contacts: allContacts, isSuccess: contactsLoaded } = useContacts();
  const noteContactsSaved = useNoteContactsSaved();
  const emailConfigured = useEmailConfigured();

  const [selectedStudentId, setSelectedStudentId] = useState('');
  // Program start → today, so View Report and Email work without any setup.
  const [startDate, setStartDate] = useState(PROGRAM_START_DATE);
  const [endDate, setEndDate] = useState(serverToday);
  const [dayOfWeek, setDayOfWeek] = useState([]);

  const [previewData, setPreviewData] = useState(null);
  const [previewLoading, setPreviewLoading] = useState(false);
  const [previewError, setPreviewError] = useState(null);

  const [downloadLoading, setDownloadLoading] = useState(false);
  const [downloadError, setDownloadError] = useState(null);
  const [downloadSuccess, setDownloadSuccess] = useState(false);

  // Admin-entered homework completion - sent with the PDF/email request so
  // parents see a completed/total bar in the report. Cleared whenever the
  // report inputs change so counts never leak across students or ranges.
  const [homework, setHomework] = useState({ total: '', completed: '' });

  // The selected student's recipients, editable before sending.
  const [contacts, setContacts] = useState(NO_CONTACTS);
  const contactsFilledFor = useRef(null);
  const [emailLoading, setEmailLoading] = useState(false);
  const [emailError, setEmailError] = useState(null);
  const [emailSuccess, setEmailSuccess] = useState(null);
  const [emailSubject, setEmailSubject] = useState('');

  // A newly chosen student starts with their saved contacts, or with their
  // ClassMarker email when none are saved. Filled once per student, so a
  // background refresh of the contact list never overwrites what was typed.
  useEffect(() => {
    setEmailError(null);
    setEmailSuccess(null);
    setEmailSubject('');
    if (!selectedStudentId) {
      contactsFilledFor.current = null;
      setContacts(NO_CONTACTS);
    }
  }, [selectedStudentId]);

  useEffect(() => {
    if (!selectedStudentId || !contactsLoaded || contactsFilledFor.current === selectedStudentId) return;
    contactsFilledFor.current = selectedStudentId;
    const saved = allContacts[selectedStudentId];
    setContacts(saved
      ? { studentEmail: saved.studentEmail || '', parentEmail: saved.parentEmail || '' }
      : { studentEmail: studentsById.get(selectedStudentId)?.email || '', parentEmail: '' });
  }, [selectedStudentId, contactsLoaded, allContacts, studentsById]);

  useEffect(() => {
    setPreviewData(null);
    setPreviewError(null);
    setDownloadSuccess(false);
    setHomework({ total: '', completed: '' });
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
        await wait(i === 0 ? 200 : 1000);
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
    // allow it - then navigate it to the PDF once the render finishes.
    // (Opening after the async wait used to get blocked and fall back to a
    // literal file download.)
    let tab = null;
    try {
      tab = window.open('', '_blank');
      if (tab) {
        tab.document.write(
          '<title>Generating report…</title>' +
          '<body style="margin:0;display:grid;place-items:center;height:100vh;' +
          'font-family:ui-sans-serif,system-ui,sans-serif;color:#525252;background:#fafafa">' +
          '<div style="text-align:center;font-size:15px">Generating report…</div></body>'
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
        throw new Error('Pop-up blocked - allow pop-ups for this site to view the report.');
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
    noteContactsSaved(selectedStudentId, contacts);
  }, [selectedStudentId, contacts, noteContactsSaved]);

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
      // PDF + email latency. The dedupe key/jobId is stable across retries, so
      // re-clicking Send while a job is pending just rejoins the same job.
      let job = null;
      for (let i = 0; i < 90; i++) {
        await wait(i === 0 ? 1000 : 2000);
        try {
          job = await fetchEmailJobStatus(jobId);
        } catch (e) {
          // 404 means the job expired or the server restarted - treat as failed.
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

      // A successful send stores these recipients as the student's contacts.
      noteContactsSaved(selectedStudentId, contacts);
      const recipients = job.result?.to?.length ? job.result.to.join(', ') : '';
      if (start?.deduplicated) {
        setEmailSuccess(
          recipients
            ? `Already sent to ${recipients} in the last few minutes, so no duplicate was sent.`
            : 'Already sent recently, so no duplicate was sent.'
        );
      } else {
        setEmailSuccess(recipients ? `Sent to ${recipients}.` : 'Email sent.');
      }
    } catch (err) {
      setEmailError(err.message);
    } finally {
      setEmailLoading(false);
    }
  }, [selectedStudentId, startDate, endDate, dayOfWeek, contacts, emailSubject, homework, noteContactsSaved]);

  const isValid =
    selectedStudentId !== '' &&
    startDate !== '' &&
    endDate !== '' &&
    new Date(startDate) <= new Date(endDate);

  return {
    students, studentsLoading,
    studentsError: studentsQueryError?.message || null,
    selectedStudentId, setSelectedStudentId,
    startDate, setStartDate,
    endDate, setEndDate,
    dayOfWeek, setDayOfWeek,
    previewData, previewLoading, previewError,
    downloadLoading, downloadError, downloadSuccess,
    homework, setHomework,
    handlePreview, handleDownload,
    contacts, updateContacts, saveContacts,
    emailConfigured, emailLoading, emailError, emailSuccess,
    emailSubject, setEmailSubject,
    handleEmail,
    isValid,
  };
}
