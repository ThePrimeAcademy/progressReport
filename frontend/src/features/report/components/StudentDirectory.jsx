// features/report/components/StudentDirectory.jsx
// The Students page: pick a ClassMarker group or a program and every student
// in it lists out. Opening a student offers two actions:
//   • View report - jumps to the Single Student page with them selected and
//     previews the report for the date range picked here.
//   • Email report - sends the PDF to their student and parent emails,
//     through the same /report/email pipeline as the Single Student page.
import React, { useEffect, useMemo, useState } from 'react';
import { LuChevronDown, LuFileText, LuSearch, LuSend, LuUsers } from 'react-icons/lu';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
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
import { Notice } from '@/components/common/Notice';
import DateRangePicker from '@/components/common/DateRangePicker';
import { emailReport, fetchEmailJobStatus } from '../api/reportApi.js';
import {
  useContacts,
  useDirectory,
  useEmailConfigured,
  useNoteContactsSaved,
  usePrograms,
  useStudentsById,
} from '../api/queries.js';
import { DEFAULT_REPORT_SUBJECT, isValidContactField } from '../constants.js';

export function initials(name) {
  return String(name || '?')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join('')
    .toUpperCase();
}

// Send one report email and poll to completion - the same job pattern as the
// Single Student page.
async function sendAndPoll(payload) {
  const start = await emailReport(payload);
  const jobId = start?.jobId;
  if (!jobId) throw new Error('Server did not return a job id.');
  let job = null;
  for (let i = 0; i < 90; i++) {
    await new Promise((r) => setTimeout(r, i === 0 ? 1000 : 2000));
    job = await fetchEmailJobStatus(jobId);
    if (job?.status === 'sent' || job?.status === 'failed') break;
  }
  if (!job || job.status === 'pending') {
    throw new Error('Send is taking longer than expected. Check your inbox before retrying.');
  }
  if (job.status === 'failed') throw new Error(job.error || 'Send failed.');
  return { deduplicated: Boolean(start?.deduplicated), to: job.result?.to || [] };
}

function EmailAction({ student, saved, startDate, endDate, dayOfWeek, configured, onSent }) {
  const [studentEmail, setStudentEmail] = useState(saved ? saved.studentEmail || '' : student.email || '');
  const [parentEmail, setParentEmail] = useState(saved?.parentEmail || '');
  const [subject, setSubject] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState(null);
  const [success, setSuccess] = useState(null);

  const datesOk = Boolean(startDate && endDate && new Date(startDate) <= new Date(endDate));
  const anyRecipient = Boolean(studentEmail.trim() || parentEmail.trim());
  const studentInvalid = !isValidContactField(studentEmail);
  const parentInvalid = !isValidContactField(parentEmail);
  const canSend = configured && datesOk && anyRecipient && !studentInvalid && !parentInvalid && !sending;

  const hint = !configured
    ? 'Email isn’t set up on the server.'
    : !datesOk
      ? 'Pick a valid date range above first.'
      : !anyRecipient
        ? 'Enter at least one email.'
        : null;

  async function handleSend() {
    setError(null);
    setSuccess(null);
    setSending(true);
    try {
      const result = await sendAndPoll({
        studentId: student.id,
        startDate,
        endDate,
        dayOfWeek: dayOfWeek && dayOfWeek.length ? dayOfWeek : undefined,
        studentEmail: studentEmail.trim(),
        parentEmail: parentEmail.trim(),
        subject: subject || undefined,
      });
      const to = result.to.join(', ');
      setSuccess(result.deduplicated
        ? (to ? `Already sent to ${to} recently, so no duplicate was sent.` : 'Already sent recently, so no duplicate was sent.')
        : (to ? `Sent to ${to}.` : 'Email sent.'));
      onSent?.(student.id, { studentEmail: studentEmail.trim(), parentEmail: parentEmail.trim() });
    } catch (e) {
      setError(e.message || 'Send failed.');
    } finally {
      setSending(false);
    }
  }

  const id = (name) => `dir-${student.id}-${name}`;
  return (
    <div className="grid gap-4">
      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={studentInvalid || undefined}>
          <FieldLabel htmlFor={id('student-email')}>Student email</FieldLabel>
          <Input
            id={id('student-email')}
            type="email"
            value={studentEmail}
            placeholder="student@email.com"
            aria-invalid={studentInvalid || undefined}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => { setStudentEmail(e.target.value); setSuccess(null); }}
          />
        </Field>
        <Field data-invalid={parentInvalid || undefined}>
          <FieldLabel htmlFor={id('parent-email')}>Parent email</FieldLabel>
          <Input
            id={id('parent-email')}
            type="email"
            value={parentEmail}
            placeholder="parent@email.com"
            aria-invalid={parentInvalid || undefined}
            autoComplete="off"
            spellCheck={false}
            onChange={(e) => { setParentEmail(e.target.value); setSuccess(null); }}
          />
        </Field>
      </div>
      <Field>
        <FieldLabel htmlFor={id('subject')}>Subject</FieldLabel>
        <Input
          id={id('subject')}
          value={subject}
          placeholder={DEFAULT_REPORT_SUBJECT}
          onChange={(e) => setSubject(e.target.value)}
        />
      </Field>
      <div className="flex flex-wrap items-center gap-3">
        <Button onClick={handleSend} disabled={!canSend}>
          {sending ? <Spinner data-icon="inline-start" /> : <LuSend data-icon="inline-start" />}
          {sending ? 'Sending…' : 'Email report'}
        </Button>
        {hint && <span className="text-sm text-muted-foreground">{hint}</span>}
      </div>
      {success && <Notice variant="success">{success}</Notice>}
      {error && <Notice variant="destructive">{error}</Notice>}
    </div>
  );
}

function StudentRow({ student, saved, open, onOpenChange, onViewReport, emailProps }) {
  const hasContacts = Boolean(saved?.studentEmail || saved?.parentEmail);
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="border-b last:border-b-0">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className={cn(
            'flex w-full items-center gap-3 px-4 py-3 text-left transition-colors outline-none hover:bg-muted/50 focus-visible:bg-muted/50 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset',
            open && 'bg-muted/50'
          )}
        >
          <span
            aria-hidden="true"
            className="flex size-9 shrink-0 items-center justify-center rounded-full bg-muted text-xs font-medium text-muted-foreground"
          >
            {initials(student.name)}
          </span>
          <span className="min-w-0 flex-1">
            <span className="block truncate text-sm font-medium">{student.name}</span>
            {student.email && <span className="block truncate text-xs text-muted-foreground">{student.email}</span>}
          </span>
          <Badge variant={hasContacts ? 'success' : 'warning'} className="hidden sm:inline-flex">
            {hasContacts ? 'Contacts saved' : 'No contacts'}
          </Badge>
          <LuChevronDown
            aria-hidden="true"
            className={cn('size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
          />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid gap-5 border-t bg-muted/30 px-4 py-4 sm:pl-16">
          <div className="flex flex-wrap items-center gap-2">
            <Button variant="outline" onClick={() => onViewReport?.(student.id)}>
              <LuFileText data-icon="inline-start" />
              View report
            </Button>
            <Badge variant={hasContacts ? 'success' : 'warning'} className="sm:hidden">
              {hasContacts ? 'Contacts saved' : 'No contacts'}
            </Badge>
          </div>
          <EmailAction student={student} saved={saved} {...emailProps} />
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

function ListSkeleton() {
  return (
    <div className="divide-y rounded-lg border" aria-busy="true" aria-label="Loading students">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="flex items-center gap-3 px-4 py-3">
          <Skeleton className="size-9 rounded-full" />
          <div className="grid flex-1 gap-1.5">
            <Skeleton className="h-3.5 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="h-5 w-24 rounded-full" />
        </div>
      ))}
    </div>
  );
}

export default function StudentDirectory({
  startDate, endDate, onStartDate, onEndDate,
  dayOfWeek,
  onViewReport,
}) {
  const directory = useDirectory();
  const { programs, isPending: programsLoading } = usePrograms();
  const { contacts } = useContacts();
  const byId = useStudentsById();
  const emailConfigured = useEmailConfigured();
  const noteContactsSaved = useNoteContactsSaved();

  const groups = directory.data?.groups ?? [];
  const loading = directory.isPending || programsLoading;
  const [selectedId, setSelectedId] = useState('');
  const [search, setSearch] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  // Start on the first group (or program) so students show right away.
  useEffect(() => {
    if (selectedId || loading) return;
    if (groups.length > 0) setSelectedId(`g:${groups[0].groupId}`);
    else if (programs.length > 0) setSelectedId(`p:${programs[0].programId}`);
  }, [selectedId, loading, groups, programs]);

  const roster = useMemo(() => {
    if (selectedId.startsWith('g:')) {
      const group = groups.find((g) => `g:${g.groupId}` === selectedId);
      return (group?.studentIds || []).map((id) => byId.get(id) || { id, name: `User ${id}`, email: null });
    }
    const program = programs.find((p) => `p:${p.programId}` === selectedId);
    return (program?.studentIds || [])
      .map((id) => byId.get(String(id)) || { id: String(id), name: `User ${id}`, email: null })
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [selectedId, groups, programs, byId]);

  const query = search.trim().toLowerCase();
  const filtered = query
    ? roster.filter((st) => st.name.toLowerCase().includes(query) || String(st.email || '').toLowerCase().includes(query))
    : roster;

  const emailProps = { startDate, endDate, dayOfWeek, configured: emailConfigured, onSent: noteContactsSaved };

  return (
    <Card>
      <CardContent className="grid gap-6">
        <div className="grid gap-4 md:grid-cols-2">
          <Field>
            <FieldLabel htmlFor="directory-group">Group or program</FieldLabel>
            <Select
              value={selectedId}
              onValueChange={(value) => { setSelectedId(value); setExpandedId(null); setSearch(''); }}
              disabled={loading}
            >
              <SelectTrigger id="directory-group" className="w-full">
                <SelectValue placeholder={loading ? 'Loading…' : 'Nothing to show yet'} />
              </SelectTrigger>
              <SelectContent>
                {groups.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>ClassMarker groups</SelectLabel>
                    {groups.map((g) => (
                      <SelectItem key={g.groupId} value={`g:${g.groupId}`}>
                        {g.groupName}
                        <span className="text-muted-foreground">{g.studentIds.length}</span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {groups.length > 0 && programs.length > 0 && <SelectSeparator />}
                {programs.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Programs</SelectLabel>
                    {programs.map((p) => (
                      <SelectItem key={p.programId} value={`p:${p.programId}`}>
                        {p.name}
                        <span className="text-muted-foreground">{(p.studentIds || []).length}</span>
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          </Field>
          <Field>
            <FieldLabel htmlFor="directory-dates">Report dates</FieldLabel>
            <DateRangePicker
              id="directory-dates"
              startDate={startDate}
              endDate={endDate}
              onStartChange={onStartDate}
              onEndChange={onEndDate}
            />
            <FieldDescription>Used by View report and emailed reports.</FieldDescription>
          </Field>
        </div>

        <div className="grid gap-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <InputGroup className="sm:max-w-xs">
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
            {!loading && (
              <span className="text-sm text-muted-foreground tabular-nums">
                {query ? `${filtered.length} of ${roster.length}` : roster.length} student{roster.length === 1 ? '' : 's'}
              </span>
            )}
          </div>

          {directory.error && <Notice variant="destructive">Could not load students: {directory.error.message}</Notice>}

          {loading ? (
            <ListSkeleton />
          ) : filtered.length === 0 ? (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon"><LuUsers /></EmptyMedia>
                <EmptyTitle>{roster.length === 0 ? 'No students here yet' : 'No matches'}</EmptyTitle>
                <EmptyDescription>
                  {roster.length === 0
                    ? 'Students appear once they take a test in this group, or are enrolled in this program.'
                    : 'No student’s name or email matches your search.'}
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="overflow-hidden rounded-lg border bg-card">
              {filtered.map((st) => (
                <StudentRow
                  key={st.id}
                  student={st}
                  saved={contacts[st.id]}
                  open={expandedId === st.id}
                  onOpenChange={(open) => setExpandedId(open ? st.id : null)}
                  onViewReport={onViewReport}
                  emailProps={emailProps}
                />
              ))}
            </div>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
