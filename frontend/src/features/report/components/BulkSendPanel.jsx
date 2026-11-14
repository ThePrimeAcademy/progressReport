// features/report/components/BulkSendPanel.jsx
// Bulk Send: email progress reports to many students at once - now (sent
// from this page, three at a time) or at a scheduled time (sent by the
// server, so the page can be closed).
import React, { useMemo, useState } from 'react';
import { LuCalendarClock, LuSave, LuSend, LuUsers } from 'react-icons/lu';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { ButtonGroup } from '@/components/ui/button-group';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Notice } from '@/components/common/Notice';
import DateRangePicker from '@/components/common/DateRangePicker';
import DayOfWeekPicker from '@/components/common/DayOfWeekPicker';
import ScheduleTimePicker from '@/components/common/ScheduleTimePicker';
import {
  emailReport,
  fetchEmailJobStatus,
  saveStudentContacts,
  scheduleBulkEmail,
} from '../api/reportApi.js';
import {
  useContacts,
  useEmailConfigured,
  useNoteContactsSaved,
  usePrograms,
  useStudents,
  useStudentsById,
} from '../api/queries.js';
import { DEFAULT_REPORT_SUBJECT, isValidContactField } from '../constants.js';
import { SendStatusBadge, formatSendTime } from './sendStatus.jsx';

const MAX_CONCURRENCY = 3;
const POLL_INTERVAL_MS = 2000;
// ~4 minutes - PDF + optional program summary + email can exceed 2 min each.
const MAX_POLL_ATTEMPTS = 120;
const ALL_STUDENTS = '__all__';

// Which recipients a student would get, from their EFFECTIVE emails
// (typed here > saved contacts > ClassMarker email).
const CONTACT_STATE = {
  both: { label: 'Student + parent', variant: 'success' },
  studentOnly: { label: 'Student only', variant: 'secondary' },
  parentOnly: { label: 'Parent only', variant: 'secondary' },
  none: { label: 'No contacts', variant: 'warning' },
};

async function pollJobUntilTerminal(jobId) {
  for (let i = 0; i < MAX_POLL_ATTEMPTS; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? 800 : POLL_INTERVAL_MS));
    let job;
    try {
      job = await fetchEmailJobStatus(jobId);
    } catch (err) {
      // The job map is in memory - a Railway restart mid-send yields 404.
      if (err.status === 404) {
        throw new Error('Send job lost (the server restarted mid-send). Try again.');
      }
      throw new Error(err.message || 'Job status check failed');
    }
    if (job?.status === 'sent' || job?.status === 'failed') return job;
  }
  throw new Error(
    'Send timed out waiting for the server (~4 min). Check the Railway logs for [report-delivery] / [SMTP ERROR].'
  );
}

function ListSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading students">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
          <Skeleton className="size-4 rounded-[4px]" />
          <Skeleton className="h-3.5 w-44" />
          <Skeleton className="ml-auto h-5 w-24 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export default function BulkSendPanel({
  startDate, endDate, onStartDate, onEndDate,
  dayOfWeek, onDayOfWeek,
  onScheduled,
}) {
  const { students, isPending: studentsLoading } = useStudents();
  const studentsById = useStudentsById();
  const { programs } = usePrograms();
  const { contacts: allContacts, isPending: contactsLoading } = useContacts();
  const noteContactsSaved = useNoteContactsSaved();
  const emailConfigured = useEmailConfigured();

  const [selectedIds, setSelectedIds] = useState(() => new Set());
  const [subject, setSubject] = useState(DEFAULT_REPORT_SUBJECT);
  // Which program's summary rides along with each report: 'auto' = each
  // student's own program, 'none' = report only, or a specific programId.
  const [summaryProgramId, setSummaryProgramId] = useState('auto');
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState({});
  const [globalError, setGlobalError] = useState(null);
  // Per-row email edits keyed by student id. Effective email =
  // edit > saved contact > ClassMarker registered email (student field).
  // Edits save to the student's contacts on blur (and via "Save contacts"),
  // so typed emails survive switching pages.
  const [rowEdits, setRowEdits] = useState({});
  // id → 'saving' | 'saved' | 'error:<message>'
  const [saveStates, setSaveStates] = useState({});

  // Schedule for later: a local 'YYYY-MM-DDTHH:mm' string ('' = not set).
  // Submitting stores a server-side batch instead of sending from the browser.
  const [sendAt, setSendAt] = useState('');
  const [scheduling, setScheduling] = useState(false);
  const [scheduleMsg, setScheduleMsg] = useState(null); // { type: 'success' | 'error', text }

  // Who the list shows: every student, or one program's enrolled roster.
  const [scope, setScope] = useState(ALL_STUDENTS);
  const activeProgram = programs.find((p) => p.programId === scope) || null;

  // Students in the list, sorted by name. A program's roster maps each
  // enrolled id to its student (falling back to a bare row, so nobody is
  // silently dropped).
  const sortedStudents = useMemo(() => {
    const toRow = (rawId, st) => {
      const id = String(rawId);
      return { id, name: st?.name || `User ${id}`, email: st?.email || '' };
    };
    const base = activeProgram
      ? (activeProgram.studentIds || []).map((id) => toRow(id, studentsById.get(String(id))))
      : students.map((st) => toRow(st.id, st));
    return base.sort((a, b) => a.name.localeCompare(b.name));
  }, [activeProgram, studentsById, students]);

  const rowById = useMemo(() => new Map(sortedStudents.map((st) => [st.id, st])), [sortedStudents]);

  // Picking a program selects its whole roster (uncheck to leave anyone
  // out); going back to all students clears the selection. Done here rather
  // than in an effect so a background refresh of the programs never undoes
  // someone's unchecks.
  function changeScope(next) {
    setScope(next);
    const program = programs.find((p) => p.programId === next);
    setSelectedIds(program ? new Set((program.studentIds || []).map(String)) : new Set());
  }

  // Effective email for a student row. Priority:
  //   1. what was typed in this batch
  //   2. the saved contact
  //   3. (student field only) the ClassMarker-registered email
  function effectiveEmail(rawId, field) {
    const id = String(rawId);
    const edit = rowEdits[id]?.[field];
    if (edit !== undefined) return edit;
    const saved = allContacts[id]?.[field] || allContacts[rawId]?.[field] || '';
    if (saved) return saved;
    if (field === 'studentEmail') return rowById.get(id)?.email || '';
    return '';
  }

  function setEdit(rawId, field, value) {
    const id = String(rawId);
    setRowEdits((prev) => ({ ...prev, [id]: { ...(prev[id] || {}), [field]: value } }));
    // New keystrokes invalidate any previous saved / error indicator.
    setSaveStates((prev) => {
      if (!(id in prev)) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
  }

  // Save one row's contacts. Does nothing when nothing was typed or the values
  // already match the saved contact; skips (with an inline error) when an
  // email is malformed, so a half-typed address never overwrites a good one.
  async function persistRow(rawId) {
    const id = String(rawId);
    if (!rowEdits[id]) return;
    const studentEmail = (effectiveEmail(id, 'studentEmail') || '').trim();
    const parentEmail = (effectiveEmail(id, 'parentEmail') || '').trim();
    const saved = allContacts[id] || allContacts[rawId] || {};
    if ((saved.studentEmail || '') === studentEmail && (saved.parentEmail || '') === parentEmail) return;
    if (!isValidContactField(studentEmail) || !isValidContactField(parentEmail)) {
      setSaveStates((prev) => ({ ...prev, [id]: 'error:Check the email - not saved yet.' }));
      return;
    }
    setSaveStates((prev) => ({ ...prev, [id]: 'saving' }));
    try {
      await saveStudentContacts(id, { studentEmail, parentEmail });
      noteContactsSaved(id, { studentEmail, parentEmail });
      // The saved contact now carries the values - drop the local edit.
      setRowEdits((prev) => {
        const next = { ...prev };
        delete next[id];
        return next;
      });
      setSaveStates((prev) => ({ ...prev, [id]: 'saved' }));
    } catch (err) {
      setSaveStates((prev) => ({ ...prev, [id]: `error:${err.message || 'Save failed.'}` }));
    }
  }

  const dirtyCount = Object.keys(rowEdits).length;
  async function saveAllDirty() {
    await Promise.all(Object.keys(rowEdits).map((id) => persistRow(id)));
  }

  // 'both' | 'studentOnly' | 'parentOnly' | 'none', from the effective emails.
  function contactsState(id) {
    const hasStudent = Boolean((effectiveEmail(id, 'studentEmail') || '').trim());
    const hasParent = Boolean((effectiveEmail(id, 'parentEmail') || '').trim());
    if (hasStudent && hasParent) return 'both';
    if (hasStudent) return 'studentOnly';
    if (hasParent) return 'parentOnly';
    return 'none';
  }
  const hasRecipient = (id) => contactsState(id) !== 'none';

  function toggle(rawId) {
    const id = String(rawId);
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  const selectAll = () => setSelectedIds(new Set(sortedStudents.map((st) => st.id)));
  const selectNone = () => setSelectedIds(new Set());
  const selectWithContacts = () => setSelectedIds(new Set(sortedStudents.filter((st) => hasRecipient(st.id)).map((st) => st.id)));

  const totalSelected = selectedIds.size;
  const sendableCount = sortedStudents.filter((st) => selectedIds.has(st.id) && hasRecipient(st.id)).length;
  const missingContactsCount = totalSelected - sendableCount;
  const datesOk = Boolean(startDate && endDate && new Date(startDate) <= new Date(endDate));
  // Without email set up on the server every send would just fail, one by one.
  const canSend = emailConfigured && !running && totalSelected > 0 && datesOk;

  async function handleSendAll() {
    setGlobalError(null);
    setRunning(true);

    const targets = sortedStudents.filter((st) => selectedIds.has(st.id));
    const initial = {};
    for (const st of targets) initial[st.id] = { status: hasRecipient(st.id) ? 'pending' : 'skipped' };
    setResults(initial);

    const sendable = targets.filter((st) => hasRecipient(st.id));
    let cursor = 0;
    async function worker() {
      while (cursor < sendable.length) {
        const st = sendable[cursor++];
        setResults((prev) => ({ ...prev, [st.id]: { status: 'sending' } }));
        const recipients = {
          studentEmail: effectiveEmail(st.id, 'studentEmail'),
          parentEmail: effectiveEmail(st.id, 'parentEmail'),
        };
        try {
          const start = await emailReport({
            studentId: st.id,
            startDate,
            endDate,
            dayOfWeek: dayOfWeek || undefined,
            subject: subject || undefined,
            summaryProgramId,
            ...recipients,
          });
          if (!start?.jobId) throw new Error('No job id returned.');
          const job = await pollJobUntilTerminal(start.jobId);
          if (job.status === 'failed') {
            setResults((prev) => ({ ...prev, [st.id]: { status: 'failed', error: job.error || 'Send failed.' } }));
          } else {
            // A successful send stores these recipients as the student's
            // contacts on the server - mirror that so the badge is right.
            noteContactsSaved(st.id, recipients);
            setResults((prev) => ({
              ...prev,
              [st.id]: { status: start.deduplicated ? 'deduped' : 'sent', recipients: job.result?.to || [] },
            }));
          }
        } catch (err) {
          setResults((prev) => ({ ...prev, [st.id]: { status: 'failed', error: err.message } }));
        }
      }
    }

    const workers = Array.from({ length: Math.min(MAX_CONCURRENCY, sendable.length) }, () => worker());
    try {
      await Promise.all(workers);
    } catch (err) {
      setGlobalError(err.message);
    } finally {
      setRunning(false);
    }
  }

  // Store a server-side batch that fires at `sendAt`. Recipients and the
  // report date range are frozen now, so this page need not stay open. Only
  // selected students with a recipient email are included.
  async function handleSchedule() {
    setScheduleMsg(null);
    if (!sendAt) {
      setScheduleMsg({ type: 'error', text: 'Pick a date and time to schedule.' });
      return;
    }
    const when = new Date(sendAt);
    if (Number.isNaN(when.getTime()) || when.getTime() < Date.now()) {
      setScheduleMsg({ type: 'error', text: 'The scheduled time must be in the future.' });
      return;
    }
    const targets = sortedStudents.filter((st) => selectedIds.has(st.id) && hasRecipient(st.id));
    if (targets.length === 0) {
      setScheduleMsg({ type: 'error', text: 'None of the selected students has a recipient email.' });
      return;
    }

    setScheduling(true);
    try {
      // Save any typed emails first so the batch uses the latest values.
      await saveAllDirty();
      const items = targets.map((st) => ({
        studentId: st.id,
        studentName: st.name,
        studentEmail: effectiveEmail(st.id, 'studentEmail'),
        parentEmail: effectiveEmail(st.id, 'parentEmail'),
      }));
      const res = await scheduleBulkEmail({
        label: activeProgram ? activeProgram.name : 'All students',
        subject: subject || undefined,
        startDate,
        endDate,
        dayOfWeek: dayOfWeek || undefined,
        summaryProgramId,
        sendAt: when.toISOString(),
        items,
      });
      setScheduleMsg({
        type: 'success',
        text: `Scheduled ${res.scheduledCount} report${res.scheduledCount === 1 ? '' : 's'} for ${formatSendTime(when)}.`,
      });
      setSendAt('');
      onScheduled?.();
    } catch (err) {
      setScheduleMsg({ type: 'error', text: err.message || 'Could not schedule the send.' });
    } finally {
      setScheduling(false);
    }
  }

  const tally = useMemo(() => {
    const t = { sent: 0, deduped: 0, failed: 0, skipped: 0, pending: 0, sending: 0 };
    for (const r of Object.values(results)) t[r.status] = (t[r.status] || 0) + 1;
    return t;
  }, [results]);
  const resultCount = Object.keys(results).length;
  const finishedCount = tally.sent + tally.deduped + tally.failed + tally.skipped;
  const listLoading = studentsLoading || contactsLoading;

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Report</CardTitle>
          <CardDescription>What every selected student receives.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5 md:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="bulk-dates">Report dates</FieldLabel>
            <DateRangePicker
              id="bulk-dates"
              startDate={startDate}
              endDate={endDate}
              onStartChange={onStartDate}
              onEndChange={onEndDate}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="bulk-days">Day of week</FieldLabel>
            <DayOfWeekPicker id="bulk-days" value={dayOfWeek} onChange={onDayOfWeek} />
          </Field>
          <Field>
            <FieldLabel htmlFor="bulk-subject">Subject</FieldLabel>
            <Input
              id="bulk-subject"
              value={subject}
              onChange={(e) => setSubject(e.target.value)}
              autoComplete="off"
            />
            <FieldDescription>Used for every email in this send.</FieldDescription>
          </Field>
          <Field>
            <FieldLabel htmlFor="bulk-summary">Program summary</FieldLabel>
            <Select value={summaryProgramId} onValueChange={setSummaryProgramId}>
              <SelectTrigger id="bulk-summary" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="auto">Each student’s own program</SelectItem>
                <SelectItem value="none">No summary - report only</SelectItem>
                {programs.length > 0 && <SelectSeparator />}
                {programs.map((p) => (
                  <SelectItem key={p.programId} value={p.programId}>{p.name}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <FieldDescription>The cohort summary PDF attached next to each report.</FieldDescription>
          </Field>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Recipients</CardTitle>
          <CardDescription>
            Reports go to each student’s student and parent emails. An email typed here is saved as that student’s contact.
          </CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <Field className="sm:max-w-sm">
            <FieldLabel htmlFor="bulk-scope">Send to</FieldLabel>
            <Select value={scope} onValueChange={changeScope}>
              <SelectTrigger id="bulk-scope" className="w-full"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_STUDENTS}>All students</SelectItem>
                {programs.length > 0 && (
                  <>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel>Programs</SelectLabel>
                      {programs.map((p) => (
                        <SelectItem key={p.programId} value={p.programId}>
                          {p.name}
                          <span className="text-muted-foreground">{(p.studentIds || []).length} enrolled</span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </>
                )}
              </SelectContent>
            </Select>
            {activeProgram && (
              <FieldDescription>
                Everyone enrolled in {activeProgram.name} is selected - uncheck anyone to leave them out.
              </FieldDescription>
            )}
          </Field>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground tabular-nums">
              {totalSelected} selected · {sendableCount} with an email
            </span>
            <div className="flex flex-wrap items-center gap-2">
              {dirtyCount > 0 && (
                <Button size="sm" variant="outline" onClick={saveAllDirty}>
                  <LuSave data-icon="inline-start" />
                  Save contacts ({dirtyCount})
                </Button>
              )}
              <ButtonGroup aria-label="Select students">
                <Button size="sm" variant="outline" onClick={selectAll}>All</Button>
                <Button size="sm" variant="outline" onClick={selectWithContacts}>With contacts</Button>
                <Button size="sm" variant="outline" onClick={selectNone}>None</Button>
              </ButtonGroup>
            </div>
          </div>

          <div className="max-h-[30rem] overflow-y-auto rounded-lg border bg-card">
            {listLoading ? (
              <ListSkeleton />
            ) : sortedStudents.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon"><LuUsers /></EmptyMedia>
                  <EmptyTitle>No students</EmptyTitle>
                  <EmptyDescription>
                    {activeProgram ? 'Nobody is enrolled in this program yet.' : 'Students appear once they take a test.'}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              sortedStudents.map((st) => {
                const checked = selectedIds.has(st.id);
                const contact = CONTACT_STATE[contactsState(st.id)];
                const saveState = saveStates[st.id];
                const studentEmail = effectiveEmail(st.id, 'studentEmail');
                const parentEmail = effectiveEmail(st.id, 'parentEmail');
                const fieldId = (name) => `bulk-${st.id}-${name}`;
                // Flag a field only once saving it failed, not while typing.
                const saveFailed = Boolean(saveState?.startsWith('error:'));
                const studentInvalid = saveFailed && !isValidContactField(studentEmail);
                const parentInvalid = saveFailed && !isValidContactField(parentEmail);
                return (
                  <div key={st.id} className={cn('border-b last:border-b-0', checked && 'bg-muted/30')}>
                    <label className="flex cursor-pointer items-center gap-3 px-4 py-2.5 transition-colors hover:bg-muted/50">
                      <Checkbox checked={checked} onCheckedChange={() => toggle(st.id)} />
                      <span className="min-w-0 flex-1 truncate text-sm">{st.name}</span>
                      <Badge variant={contact.variant}>{contact.label}</Badge>
                    </label>
                    {checked && (
                      <div className="grid gap-3 px-4 pb-3 pl-11 sm:grid-cols-2">
                        <Field className="gap-1.5" data-invalid={studentInvalid || undefined}>
                          <FieldLabel htmlFor={fieldId('student')} className="text-xs font-normal text-muted-foreground">
                            Student email
                          </FieldLabel>
                          <Input
                            id={fieldId('student')}
                            type="email"
                            className="h-8 bg-background"
                            placeholder={st.email || 'student@example.com'}
                            value={studentEmail}
                            aria-invalid={studentInvalid || undefined}
                            onChange={(e) => setEdit(st.id, 'studentEmail', e.target.value)}
                            onBlur={() => persistRow(st.id)}
                            autoComplete="off"
                            spellCheck={false}
                          />
                        </Field>
                        <Field className="gap-1.5" data-invalid={parentInvalid || undefined}>
                          <FieldLabel htmlFor={fieldId('parent')} className="text-xs font-normal text-muted-foreground">
                            Parent email
                          </FieldLabel>
                          <Input
                            id={fieldId('parent')}
                            type="email"
                            className="h-8 bg-background"
                            placeholder="parent@example.com"
                            value={parentEmail}
                            aria-invalid={parentInvalid || undefined}
                            onChange={(e) => setEdit(st.id, 'parentEmail', e.target.value)}
                            onBlur={() => persistRow(st.id)}
                            autoComplete="off"
                            spellCheck={false}
                          />
                        </Field>
                        {saveState && (
                          <p
                            className={cn(
                              'flex items-center gap-1.5 text-xs sm:col-span-2',
                              saveState.startsWith('error:') ? 'text-destructive' : 'text-muted-foreground'
                            )}
                            aria-live="polite"
                          >
                            {saveState === 'saving' && <><Spinner className="size-3" /> Saving…</>}
                            {saveState === 'saved' && <span className="text-success">Contacts saved</span>}
                            {saveState.startsWith('error:') && saveState.slice(6)}
                          </p>
                        )}
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </div>

          {missingContactsCount > 0 && (
            <Notice variant="warning">
              {missingContactsCount} selected student{missingContactsCount === 1 ? ' has' : 's have'} no email and will be
              skipped. Type an email in the list to include them.
            </Notice>
          )}
        </CardContent>

        <CardFooter className="grid items-start gap-6 border-t lg:grid-cols-[auto_minmax(0,28rem)] lg:justify-between">
          <div className="grid content-start gap-2">
            <span className="text-sm font-medium">Send now</span>
            <div>
              <Button onClick={handleSendAll} disabled={!canSend}>
                {running ? <Spinner data-icon="inline-start" /> : <LuSend data-icon="inline-start" />}
                {running
                  ? `Sending ${tally.sending + tally.sent + tally.deduped + tally.failed} of ${sendableCount}…`
                  : `Send to ${sendableCount} student${sendableCount === 1 ? '' : 's'}`}
              </Button>
            </div>
            <p className="text-sm text-muted-foreground">
              {!emailConfigured
                ? 'Email isn’t set up on the server.'
                : !datesOk
                  ? 'Pick a valid date range first.'
                  : running
                    ? 'Keep this page open until every report has gone out.'
                    : 'Sends from this page - keep it open until it finishes.'}
            </p>
          </div>
          <Field>
            <FieldLabel htmlFor="bulk-send-at">Or schedule for later</FieldLabel>
            <div className="grid gap-2 sm:flex sm:flex-wrap sm:items-center">
              <ScheduleTimePicker
                id="bulk-send-at"
                value={sendAt}
                onChange={(value) => { setSendAt(value); setScheduleMsg(null); }}
                className="min-w-0 sm:flex-1"
              />
              <Button
                variant="outline"
                className="w-full sm:w-auto"
                onClick={handleSchedule}
                disabled={!emailConfigured || running || scheduling || !sendAt || sendableCount === 0}
              >
                {scheduling ? <Spinner data-icon="inline-start" /> : <LuCalendarClock data-icon="inline-start" />}
                Schedule{sendableCount > 0 ? ` ${sendableCount}` : ''}
              </Button>
            </div>
            <FieldDescription>
              Goes out automatically at that time, even with this page closed. Track or cancel it in the queue below.
            </FieldDescription>
            {scheduleMsg && (
              <Notice variant={scheduleMsg.type === 'error' ? 'destructive' : 'success'}>{scheduleMsg.text}</Notice>
            )}
          </Field>
        </CardFooter>
      </Card>

      {globalError && <Notice variant="destructive">{globalError}</Notice>}

      {resultCount > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>Send progress</CardTitle>
            <CardDescription className="tabular-nums">
              {tally.sent + tally.deduped} sent · {tally.failed} failed · {tally.skipped} skipped · {tally.pending + tally.sending} in progress
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <div className="flex items-center gap-3">
              <Progress
                value={Math.round((finishedCount / resultCount) * 100)}
                className="h-2"
                aria-label={`${finishedCount} of ${resultCount} done`}
              />
              <span className="shrink-0 text-sm text-muted-foreground tabular-nums">
                {finishedCount} of {resultCount}
              </span>
            </div>
            <div className="max-h-96 overflow-y-auto rounded-lg border">
              {sortedStudents
                .filter((st) => results[st.id])
                .map((st) => {
                  const r = results[st.id];
                  return (
                    <div key={st.id} className="grid gap-1 border-b px-4 py-2.5 last:border-b-0">
                      <div className="flex items-center gap-3">
                        <span className="min-w-0 flex-1 truncate text-sm">{st.name}</span>
                        <SendStatusBadge status={r.status} />
                      </div>
                      {r.status !== 'failed' && r.recipients?.length > 0 && (
                        <p className="text-xs break-words text-muted-foreground">{r.recipients.join(', ')}</p>
                      )}
                      {r.error && <p className="text-xs break-words text-destructive">{r.error}</p>}
                    </div>
                  );
                })}
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
