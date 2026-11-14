// features/report/components/ComposeEmailPanel.jsx
// The Compose page: write your own message and send it to selected students'
// saved contacts (student + parent). By design this does NOT send the
// progress report - the PDF only rides along when "Attach progress report"
// is checked.
import React, { useMemo, useState } from 'react';
import { LuCalendarClock, LuPencil, LuSearch, LuSend, LuUsers } from 'react-icons/lu';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Checkbox } from '@/components/ui/checkbox';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldContent, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
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
import { Textarea } from '@/components/ui/textarea';
import { Notice } from '@/components/common/Notice';
import DateRangePicker from '@/components/common/DateRangePicker';
import ScheduleTimePicker from '@/components/common/ScheduleTimePicker';
import {
  sendCustomEmail,
  fetchCustomEmailJobStatus,
  scheduleCustomEmail,
  saveStudentContacts,
} from '../api/reportApi.js';
import {
  useContacts,
  useDirectory,
  useEmailConfigured,
  useNoteContactsSaved,
  usePrograms,
  useStudents,
  useStudentsById,
} from '../api/queries.js';
import { isValidContactField } from '../constants.js';
import { formatSendTime } from './sendStatus.jsx';

const ALL_STUDENTS = '__all__';

function RecipientSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading students">
      {Array.from({ length: 5 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 border-b px-4 py-3 last:border-b-0">
          <Skeleton className="size-4 rounded-[4px]" />
          <div className="grid flex-1 gap-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-64" />
          </div>
        </div>
      ))}
    </div>
  );
}

export default function ComposeEmailPanel({ startDate, endDate, onStartDate, onEndDate, dayOfWeek }) {
  const { students, isPending: studentsLoading } = useStudents();
  const byId = useStudentsById();
  const directory = useDirectory();
  const { programs } = usePrograms();
  const { contacts: allContacts } = useContacts();
  const noteContactsSaved = useNoteContactsSaved();
  const emailConfigured = useEmailConfigured();
  const groups = directory.data?.groups ?? [];

  const [selected, setSelected] = useState(() => new Set());
  const [search, setSearch] = useState('');
  // Group/program filter - all students, 'g:<id>' a ClassMarker group,
  // 'p:<id>' a program. The same choice as the Students page.
  const [filterId, setFilterId] = useState(ALL_STUDENTS);
  const [subject, setSubject] = useState('');
  const [message, setMessage] = useState('');
  const [includeReport, setIncludeReport] = useState(false);
  // Which program's summary rides along with the report: 'auto' = each
  // student's own program, 'none' = report only, or a specific programId.
  const [summaryProgramId, setSummaryProgramId] = useState('auto');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [results, setResults] = useState(null); // [{ studentId, status, to, error }]
  // Schedule for later: the picker stays hidden until "Schedule" is pressed.
  // sendAt is a local 'YYYY-MM-DDTHH:mm' string; the batch is sent by the
  // server, so this page can be closed.
  const [showSchedule, setShowSchedule] = useState(false);
  const [sendAt, setSendAt] = useState('');
  const [scheduling, setScheduling] = useState(false);
  const [scheduleMsg, setScheduleMsg] = useState(null); // { type: 'success' | 'error', text }
  // Inline contact editing - one row at a time.
  const [editingId, setEditingId] = useState(null);
  const [editVals, setEditVals] = useState({ studentEmail: '', parentEmail: '' });
  const [editSaving, setEditSaving] = useState(false);
  const [editErr, setEditErr] = useState(null);

  const contactsFor = (id) => allContacts[id] || {};
  const hasRecipient = (st) => {
    const c = contactsFor(st.id);
    return Boolean(c.studentEmail || c.parentEmail || st.email);
  };

  // Ids allowed by the group/program filter - null means everyone.
  const filterIds = useMemo(() => {
    if (filterId === ALL_STUDENTS) return null;
    if (filterId.startsWith('g:')) {
      const group = groups.find((g) => `g:${g.groupId}` === filterId);
      return new Set((group?.studentIds || []).map(String));
    }
    const program = programs.find((p) => `p:${p.programId}` === filterId);
    return new Set((program?.studentIds || []).map(String));
  }, [filterId, groups, programs]);

  const query = search.trim().toLowerCase();
  const filtered = useMemo(
    () => students.filter((st) =>
      (!filterIds || filterIds.has(String(st.id))) &&
      (!query || st.name.toLowerCase().includes(query) || String(st.email || '').toLowerCase().includes(query))
    ),
    [students, query, filterIds]
  );

  const toggle = (id) => {
    setResults(null);
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // Respects the group/program filter, so "select all" never grabs students
  // outside the chosen group.
  const selectAllWithContacts = () => {
    setResults(null);
    setSelected(new Set(
      students
        .filter((st) => (!filterIds || filterIds.has(String(st.id))) && hasRecipient(st))
        .map((st) => st.id)
    ));
  };

  function startEdit(st) {
    const c = contactsFor(st.id);
    setEditingId(String(st.id));
    setEditVals({ studentEmail: c.studentEmail || st.email || '', parentEmail: c.parentEmail || '' });
    setEditErr(null);
  }

  function cancelEdit() {
    setEditingId(null);
    setEditErr(null);
  }

  // Save the row's contacts. A malformed email never overwrites a good one.
  async function saveEdit(id) {
    const studentEmail = editVals.studentEmail.trim();
    const parentEmail = editVals.parentEmail.trim();
    if (!isValidContactField(studentEmail) || !isValidContactField(parentEmail)) {
      setEditErr('Check the email - not saved. Separate several addresses with commas.');
      return;
    }
    setEditSaving(true);
    setEditErr(null);
    try {
      await saveStudentContacts(String(id), { studentEmail, parentEmail });
      noteContactsSaved(String(id), { studentEmail, parentEmail });
      setEditingId(null);
    } catch (e) {
      setEditErr(e.message || 'Save failed.');
    } finally {
      setEditSaving(false);
    }
  }

  const datesOk = !includeReport || Boolean(startDate && endDate && new Date(startDate) <= new Date(endDate));
  const canSend = emailConfigured && selected.size > 0 && Boolean(message.trim()) && datesOk && !sending;
  const reportOptions = () => (includeReport
    ? { startDate, endDate, dayOfWeek: dayOfWeek && dayOfWeek.length ? dayOfWeek : undefined, summaryProgramId }
    : {});

  async function handleSend() {
    setError(null);
    setResults(null);
    setSending(true);
    try {
      const items = Array.from(selected).map((id) => {
        const st = byId.get(String(id));
        const c = contactsFor(id);
        // With no saved contacts, fall back to the ClassMarker email so the
        // message still has somewhere to go.
        if (!c.studentEmail && !c.parentEmail && st?.email) {
          return { studentId: id, studentName: st?.name || '', studentEmail: st.email, parentEmail: '' };
        }
        return { studentId: id, studentName: st?.name || '' };
      });

      const start = await sendCustomEmail({
        items,
        subject: subject || undefined,
        message,
        includeReport,
        ...reportOptions(),
      });
      const jobId = start?.jobId;
      if (!jobId) throw new Error('Server did not return a job id.');

      // Attaching reports means a PDF render per student - budget generously.
      const maxAttempts = includeReport ? 300 : 120;
      let job = null;
      for (let i = 0; i < maxAttempts; i++) {
        await new Promise((r) => setTimeout(r, i === 0 ? 1000 : 2000));
        job = await fetchCustomEmailJobStatus(jobId);
        if (job?.status === 'done' || job?.status === 'failed') break;
      }
      if (!job || job.status === 'pending') {
        throw new Error('Sending is taking longer than expected - check inboxes before retrying.');
      }
      setResults(job.items || []);
    } catch (e) {
      setError(e.message || 'Send failed.');
    } finally {
      setSending(false);
    }
  }

  // Store a server-side batch that fires at `sendAt`. Recipients (and the
  // report date range, when attaching) are frozen now, so this page need not
  // stay open. Delivery shows in the queue on the Bulk send page.
  async function handleSchedule() {
    setError(null);
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

    // Unlike an immediate send (where the server looks contacts up when it
    // sends), a scheduled batch freezes its recipients - so resolve the saved
    // contacts / ClassMarker fallback here.
    const items = Array.from(selected)
      .map((id) => {
        const st = byId.get(String(id));
        const c = contactsFor(id);
        const studentEmail = c.studentEmail || (!c.parentEmail && st?.email) || '';
        return { studentId: id, studentName: st?.name || '', studentEmail, parentEmail: c.parentEmail || '' };
      })
      .filter((it) => it.studentEmail || it.parentEmail);

    if (items.length === 0) {
      setScheduleMsg({ type: 'error', text: 'None of the selected students has a recipient email.' });
      return;
    }

    setScheduling(true);
    try {
      const res = await scheduleCustomEmail({
        label: `Email - ${subject || 'Prime Academy'}`,
        subject: subject || undefined,
        message,
        includeReport,
        ...reportOptions(),
        sendAt: when.toISOString(),
        items,
      });
      setScheduleMsg({
        type: 'success',
        text: `Scheduled for ${formatSendTime(when)} - ${res.scheduledCount} student${res.scheduledCount === 1 ? '' : 's'}.`,
      });
      setSendAt('');
      setShowSchedule(false);
    } catch (e) {
      setScheduleMsg({ type: 'error', text: e.message || 'Could not schedule the email.' });
    } finally {
      setScheduling(false);
    }
  }

  const sentCount = results ? results.filter((r) => r.status === 'sent').length : 0;
  const failCount = results ? results.filter((r) => r.status === 'failed').length : 0;
  const hint = !emailConfigured
    ? 'Email isn’t set up on the server.'
    : selected.size === 0
      ? 'Select at least one student.'
      : !message.trim()
        ? 'Write a message first.'
        : null;

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Recipients</CardTitle>
          <CardDescription>Your message goes to each selected student’s saved student and parent emails.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-[minmax(0,18rem)_minmax(0,1fr)]">
            <Select
              value={filterId}
              onValueChange={(value) => { setFilterId(value); setResults(null); }}
            >
              <SelectTrigger className="w-full" aria-label="Show students from">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_STUDENTS}>All students</SelectItem>
                {groups.length > 0 && (
                  <>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel>ClassMarker groups</SelectLabel>
                      {groups.map((g) => (
                        <SelectItem key={g.groupId} value={`g:${g.groupId}`}>
                          {g.groupName}
                          <span className="text-muted-foreground">{g.studentIds.length}</span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </>
                )}
                {programs.length > 0 && (
                  <>
                    <SelectSeparator />
                    <SelectGroup>
                      <SelectLabel>Programs</SelectLabel>
                      {programs.map((p) => (
                        <SelectItem key={p.programId} value={`p:${p.programId}`}>
                          {p.name}
                          <span className="text-muted-foreground">{(p.studentIds || []).length}</span>
                        </SelectItem>
                      ))}
                    </SelectGroup>
                  </>
                )}
              </SelectContent>
            </Select>
            <InputGroup>
              <InputGroupAddon>
                <LuSearch aria-hidden="true" />
              </InputGroupAddon>
              <InputGroupInput
                value={search}
                placeholder="Search by name or email"
                aria-label="Search students"
                onChange={(e) => setSearch(e.target.value)}
              />
            </InputGroup>
          </div>

          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="text-sm text-muted-foreground tabular-nums">
              {selected.size} student{selected.size === 1 ? '' : 's'} selected
            </span>
            <div className="flex flex-wrap gap-2">
              <Button size="sm" variant="outline" onClick={selectAllWithContacts}>Select all with an email</Button>
              <Button
                size="sm"
                variant="ghost"
                disabled={selected.size === 0}
                onClick={() => { setSelected(new Set()); setResults(null); }}
              >
                Clear
              </Button>
            </div>
          </div>

          <div className="max-h-[26rem] overflow-y-auto rounded-lg border bg-card">
            {studentsLoading ? (
              <RecipientSkeleton />
            ) : filtered.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon"><LuUsers /></EmptyMedia>
                  <EmptyTitle>No students match</EmptyTitle>
                  <EmptyDescription>Try another group, or clear the search.</EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : (
              filtered.map((st) => {
                const c = contactsFor(st.id);
                const saved = Boolean(c.studentEmail || c.parentEmail);
                const fallback = !saved && Boolean(st.email);
                // Exactly which addresses the send goes to. A no-break space
                // keeps each label on the same line as its address.
                const emailBits = saved
                  ? [c.studentEmail ? `Student:\u00a0${c.studentEmail}` : null, c.parentEmail ? `Parent:\u00a0${c.parentEmail}` : null].filter(Boolean)
                  : fallback ? [`Student:\u00a0${st.email}`] : [];
                const checked = selected.has(st.id);
                const isEditing = editingId === String(st.id);
                const checkboxId = `compose-${st.id}`;
                return (
                  <div
                    key={st.id}
                    className={cn('flex items-start gap-3 border-b px-4 py-3 last:border-b-0', checked && 'bg-muted/30')}
                  >
                    <Checkbox id={checkboxId} checked={checked} onCheckedChange={() => toggle(st.id)} className="mt-0.5" />
                    {isEditing ? (
                      <div className="grid min-w-0 flex-1 gap-2">
                        <label htmlFor={checkboxId} className="text-sm font-medium">{st.name}</label>
                        <div className="grid gap-2 sm:grid-cols-2">
                          <Input
                            type="email"
                            className="h-8 bg-background"
                            value={editVals.studentEmail}
                            placeholder="Student email"
                            aria-label={`${st.name}'s student email`}
                            aria-invalid={(editErr && !isValidContactField(editVals.studentEmail)) || undefined}
                            autoComplete="off"
                            spellCheck={false}
                            autoFocus
                            onChange={(e) => setEditVals((v) => ({ ...v, studentEmail: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveEdit(st.id);
                              if (e.key === 'Escape') cancelEdit();
                            }}
                          />
                          <Input
                            type="email"
                            className="h-8 bg-background"
                            value={editVals.parentEmail}
                            placeholder="Parent email"
                            aria-label={`${st.name}'s parent email`}
                            aria-invalid={(editErr && !isValidContactField(editVals.parentEmail)) || undefined}
                            autoComplete="off"
                            spellCheck={false}
                            onChange={(e) => setEditVals((v) => ({ ...v, parentEmail: e.target.value }))}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') saveEdit(st.id);
                              if (e.key === 'Escape') cancelEdit();
                            }}
                          />
                        </div>
                        {editErr && <p className="text-xs text-destructive" role="alert">{editErr}</p>}
                        <div className="flex gap-2">
                          <Button size="sm" onClick={() => saveEdit(st.id)} disabled={editSaving}>
                            {editSaving && <Spinner data-icon="inline-start" />}
                            Save
                          </Button>
                          <Button size="sm" variant="ghost" onClick={cancelEdit} disabled={editSaving}>Cancel</Button>
                        </div>
                      </div>
                    ) : (
                      <>
                        <label htmlFor={checkboxId} className="grid min-w-0 flex-1 cursor-pointer gap-0.5">
                          <span className="text-sm font-medium break-words">{st.name}</span>
                          <span className="flex flex-col text-xs text-muted-foreground sm:flex-row sm:flex-wrap sm:gap-x-3">
                            {emailBits.length
                              ? emailBits.map((bit) => <span key={bit} className="min-w-0 break-words">{bit}</span>)
                              : 'No email on file'}
                          </span>
                        </label>
                        <Badge
                          variant={saved ? 'success' : fallback ? 'secondary' : 'warning'}
                          className="hidden sm:inline-flex"
                        >
                          {saved ? 'Contacts saved' : fallback ? 'ClassMarker email' : 'No email'}
                        </Badge>
                        <Button
                          size="icon-sm"
                          variant="ghost"
                          className="-my-1"
                          aria-label={`Edit ${st.name}'s contacts`}
                          title="Edit contacts"
                          onClick={() => startEdit(st)}
                        >
                          <LuPencil />
                        </Button>
                      </>
                    )}
                  </div>
                );
              })
            )}
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>Message</CardTitle>
          <CardDescription>Students and parents see this text; attaching the report is optional.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <Field>
            <FieldLabel htmlFor="compose-subject">Subject</FieldLabel>
            <Input
              id="compose-subject"
              value={subject}
              placeholder="Prime Academy"
              onChange={(e) => setSubject(e.target.value)}
              autoComplete="off"
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="compose-message">Message</FieldLabel>
            <Textarea
              id="compose-message"
              className="min-h-40"
              value={message}
              placeholder="Write the message students and parents will see…"
              onChange={(e) => { setMessage(e.target.value); setResults(null); }}
            />
          </Field>
          <Field orientation="horizontal">
            <Checkbox
              id="compose-attach"
              checked={includeReport}
              onCheckedChange={(value) => setIncludeReport(value === true)}
            />
            <FieldContent>
              <FieldLabel htmlFor="compose-attach">Attach progress report PDF</FieldLabel>
              <FieldDescription>
                Off by default - your message is sent on its own. When on, each student’s progress report and program
                summary are attached.
              </FieldDescription>
            </FieldContent>
          </Field>
          {includeReport && (
            <div className="grid gap-5 rounded-lg border bg-muted/30 p-4 md:grid-cols-2">
              <Field>
                <FieldLabel htmlFor="compose-dates">Report dates</FieldLabel>
                <DateRangePicker
                  id="compose-dates"
                  startDate={startDate}
                  endDate={endDate}
                  onStartChange={onStartDate}
                  onEndChange={onEndDate}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="compose-summary">Program summary</FieldLabel>
                <Select value={summaryProgramId} onValueChange={setSummaryProgramId}>
                  <SelectTrigger id="compose-summary" className="w-full bg-background"><SelectValue /></SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Each student’s own program</SelectItem>
                    <SelectItem value="none">No summary - report only</SelectItem>
                    {programs.length > 0 && <SelectSeparator />}
                    {programs.map((p) => (
                      <SelectItem key={p.programId} value={p.programId}>{p.name}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <FieldDescription>Pick a program to send its summary to everyone selected.</FieldDescription>
              </Field>
            </div>
          )}
          {includeReport && !datesOk && <Notice variant="destructive">Pick a valid date range to attach reports.</Notice>}
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-4 border-t">
          <div className="flex flex-wrap items-center gap-2">
            <Button onClick={handleSend} disabled={!canSend}>
              {sending ? <Spinner data-icon="inline-start" /> : <LuSend data-icon="inline-start" />}
              {sending
                ? 'Sending…'
                : `Send${includeReport ? ' with report' : ''} to ${selected.size} student${selected.size === 1 ? '' : 's'}`}
            </Button>
            {!showSchedule && (
              <Button
                variant="outline"
                disabled={!canSend}
                onClick={() => { setShowSchedule(true); setScheduleMsg(null); }}
              >
                <LuCalendarClock data-icon="inline-start" />
                Schedule
              </Button>
            )}
            {hint && <span className="text-sm text-muted-foreground">{hint}</span>}
          </div>
          {showSchedule && (
            <Field>
              <FieldLabel htmlFor="compose-send-at">Send on</FieldLabel>
              <div className="flex flex-wrap items-center gap-2">
                <ScheduleTimePicker
                  id="compose-send-at"
                  value={sendAt}
                  onChange={(value) => { setSendAt(value); setScheduleMsg(null); }}
                  className="min-w-0 flex-1 sm:max-w-sm sm:flex-none"
                />
                <Button variant="outline" onClick={handleSchedule} disabled={!canSend || !sendAt || scheduling}>
                  {scheduling ? <Spinner data-icon="inline-start" /> : <LuCalendarClock data-icon="inline-start" />}
                  {scheduling ? 'Scheduling…' : 'Schedule send'}
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => { setShowSchedule(false); setSendAt(''); setScheduleMsg(null); }}
                >
                  Cancel
                </Button>
              </div>
              <FieldDescription>
                Goes out automatically at that time, even with this page closed. Track or cancel it in the queue on{' '}
                <a href="#bulk">Bulk send</a>.
              </FieldDescription>
            </Field>
          )}
          {scheduleMsg && (
            <Notice variant={scheduleMsg.type === 'error' ? 'destructive' : 'success'}>
              {scheduleMsg.text}
              {scheduleMsg.type === 'success' && <> Track or cancel it in the queue on <a href="#bulk">Bulk send</a>.</>}
            </Notice>
          )}
          {error && <Notice variant="destructive">{error}</Notice>}
        </CardFooter>
      </Card>

      {results && (
        <Card>
          <CardHeader>
            <CardTitle>Results</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4">
            <Notice variant={failCount === 0 && sentCount > 0 ? 'success' : sentCount === 0 ? 'destructive' : 'warning'}>
              {failCount === 0
                ? `Sent to ${sentCount} student${sentCount === 1 ? '' : 's'}.`
                : `${sentCount} sent, ${failCount} failed.`}
            </Notice>
            <div className="max-h-96 overflow-y-auto rounded-lg border">
              {results.map((r) => {
                const st = byId.get(String(r.studentId));
                const sent = r.status === 'sent';
                return (
                  <div key={r.studentId} className="grid gap-0.5 border-b px-4 py-2.5 last:border-b-0">
                    <div className="flex items-center gap-3">
                      <span className="min-w-0 flex-1 truncate text-sm font-medium">{st?.name || r.studentId}</span>
                      <Badge variant={sent ? 'success' : 'destructive'}>{sent ? 'Sent' : 'Failed'}</Badge>
                    </div>
                    <p className={cn('text-xs break-words', sent ? 'text-muted-foreground' : 'text-destructive')}>
                      {sent ? `To ${(r.to || []).join(', ')}` : (r.error || 'Failed')}
                    </p>
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
