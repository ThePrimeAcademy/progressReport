// features/report/components/EmailReportPanel.jsx
// "Email this report" inside the report preview: the recipients (saved as
// the student's contacts), the subject, and Send.
import React, { useEffect, useState } from 'react';
import { LuCheck, LuRotateCcw, LuSave, LuSend } from 'react-icons/lu';
import { Button } from '@/components/ui/button';
import { Field, FieldError, FieldLabel } from '@/components/ui/field';
import { Input } from '@/components/ui/input';
import { Spinner } from '@/components/ui/spinner';
import { Notice } from '@/components/common/Notice';
import { DEFAULT_REPORT_SUBJECT, isValidContactField } from '../constants.js';

export default function EmailReportPanel({
  registeredStudentEmail,
  contacts,
  onChange,
  onSave,
  onSend,
  configured,
  loading,
  error,
  success,
  subject,
  onSubjectChange,
}) {
  const effectiveSubject = subject != null && subject !== '' ? subject : DEFAULT_REPORT_SUBJECT;
  const [saveState, setSaveState] = useState('idle'); // 'idle' | 'saving' | 'saved' | 'failed'

  useEffect(() => {
    if (saveState !== 'saved') return undefined;
    const t = setTimeout(() => setSaveState('idle'), 1800);
    return () => clearTimeout(t);
  }, [saveState]);

  const studentEmail = contacts?.studentEmail || '';
  const parentEmail = contacts?.parentEmail || '';
  const hasRecipient = Boolean(studentEmail.trim() || parentEmail.trim());
  const studentInvalid = !isValidContactField(studentEmail);
  const parentInvalid = !isValidContactField(parentEmail);
  const studentEmailDiffers = Boolean(
    registeredStudentEmail &&
    studentEmail &&
    studentEmail.trim().toLowerCase() !== String(registeredStudentEmail).trim().toLowerCase()
  );

  async function handleSave() {
    if (!onSave) return;
    setSaveState('saving');
    try {
      await onSave();
      setSaveState('saved');
    } catch (_) {
      setSaveState('failed');
    }
  }

  return (
    <section className="grid gap-4 rounded-lg border p-4" aria-labelledby="email-report-heading">
      <h2 id="email-report-heading" className="text-sm font-medium">Email this report</h2>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field data-invalid={studentInvalid || undefined}>
          <div className="flex items-center justify-between gap-2">
            <FieldLabel htmlFor="report-student-email">Student email</FieldLabel>
            {studentEmailDiffers && (
              <Button
                variant="link"
                size="xs"
                className="h-auto p-0"
                onClick={() => onChange({ studentEmail: registeredStudentEmail })}
                title={`Reset to ${registeredStudentEmail}`}
              >
                <LuRotateCcw data-icon="inline-start" />
                Use ClassMarker email
              </Button>
            )}
          </div>
          <Input
            id="report-student-email"
            type="email"
            placeholder={registeredStudentEmail || 'student@example.com'}
            value={studentEmail}
            aria-invalid={studentInvalid || undefined}
            onChange={(e) => onChange({ studentEmail: e.target.value })}
            autoComplete="off"
            spellCheck={false}
          />
          {studentInvalid && <FieldError>Check this address - separate several with commas.</FieldError>}
        </Field>
        <Field data-invalid={parentInvalid || undefined}>
          <FieldLabel htmlFor="report-parent-email">Parent email</FieldLabel>
          <Input
            id="report-parent-email"
            type="email"
            placeholder="parent@example.com"
            value={parentEmail}
            aria-invalid={parentInvalid || undefined}
            onChange={(e) => onChange({ parentEmail: e.target.value })}
            autoComplete="off"
            spellCheck={false}
          />
          {parentInvalid && <FieldError>Check this address - separate several with commas.</FieldError>}
        </Field>
      </div>

      <Field>
        <FieldLabel htmlFor="report-subject">Subject</FieldLabel>
        <Input
          id="report-subject"
          value={effectiveSubject}
          onChange={(e) => onSubjectChange?.(e.target.value)}
          autoComplete="off"
        />
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <Button
          onClick={onSend}
          disabled={!configured || !hasRecipient || studentInvalid || parentInvalid || loading}
        >
          {loading ? <Spinner data-icon="inline-start" /> : <LuSend data-icon="inline-start" />}
          {loading ? 'Sending…' : 'Send report'}
        </Button>
        <Button
          variant="outline"
          onClick={handleSave}
          disabled={saveState === 'saving' || studentInvalid || parentInvalid}
        >
          {saveState === 'saving' ? <Spinner data-icon="inline-start" />
            : saveState === 'saved' ? <LuCheck data-icon="inline-start" />
              : <LuSave data-icon="inline-start" />}
          {saveState === 'saved' ? 'Saved' : 'Save contacts'}
        </Button>
        {saveState === 'failed' && <span className="text-sm text-destructive">Could not save the contacts.</span>}
      </div>

      {!configured && (
        <Notice variant="warning" title="Email isn’t set up on the server">
          Set <code className="font-mono text-xs">ZEPTOMAIL_TOKEN</code> on Railway (HTTPS - SMTP ports are blocked). See <code className="font-mono text-xs">backend/.env.example</code>.
        </Notice>
      )}
      {error && <Notice variant="destructive">{error}</Notice>}
      {success && <Notice variant="success">{success}</Notice>}
    </section>
  );
}
