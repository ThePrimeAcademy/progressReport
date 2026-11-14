// features/report/components/ReportViewer.jsx
// The on-screen preview of a student's report: SAT scores, homework, the
// latest test, strengths and weaknesses by category, and every test in the
// range. Download and email controls sit at the top.
import React, { useState } from 'react';
import { LuChevronDown, LuDownload } from 'react-icons/lu';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Field, FieldLabel } from '@/components/ui/field';
import { Progress } from '@/components/ui/progress';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Notice } from '@/components/common/Notice';
import { formatRange } from '@/components/common/DateRangePicker';
import { displayDay } from '@/lib/dates';
import EmailReportPanel from './EmailReportPanel.jsx';
import { initials } from './StudentDirectory.jsx';

// ── Helpers ──────────────────────────────────────────────────
function letterGrade(pct) {
  if (pct >= 90) return 'A';
  if (pct >= 80) return 'B';
  if (pct >= 70) return 'C';
  if (pct >= 60) return 'D';
  return 'F';
}

// How a score reads at a glance: strong, fine, or needs work.
function scoreTone(pct) {
  if (pct >= 80) return 'success';
  if (pct >= 60) return 'secondary';
  return 'destructive';
}

const TONE_TEXT = { success: 'text-success', secondary: 'text-foreground', destructive: 'text-destructive', warning: 'text-warning' };
const TONE_BAR = {
  success: '*:data-[slot=progress-indicator]:bg-success',
  secondary: '*:data-[slot=progress-indicator]:bg-foreground/60',
  destructive: '*:data-[slot=progress-indicator]:bg-destructive',
  warning: '*:data-[slot=progress-indicator]:bg-warning',
};

function ScoreBar({ pct, tone = scoreTone(pct), className }) {
  return <Progress value={Math.max(0, Math.min(pct, 100))} className={cn(TONE_BAR[tone], className)} aria-label={`${pct}%`} />;
}

function GradeBadge({ pct, children }) {
  return <Badge variant={scoreTone(pct)} className="tabular-nums">{children ?? letterGrade(pct)}</Badge>;
}

function Stat({ label, value, hint, className }) {
  return (
    <div className={cn('rounded-lg border bg-card p-4', className)}>
      <div className="text-xs font-medium text-muted-foreground">{label}</div>
      <div className="mt-1.5 text-3xl font-semibold tracking-tight tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-muted-foreground">{hint}</div>}
    </div>
  );
}

// ── SAT scores ────────────────────────────────────────────────
function SatScores({ satScores }) {
  const fromWorkbook = satScores?.source === 'excel' || satScores?.source === 'sheets' ? 'From the SAT workbook' : undefined;
  const scores = [
    { label: 'Latest test score', value: satScores?.latestTestScore },
    { label: 'Latest English score', value: satScores?.latestEnglishScore },
    { label: 'Latest Math score', value: satScores?.latestMathScore },
    { label: 'Super score', value: satScores?.superScore },
  ];
  return (
    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
      {scores.map((s) => <Stat key={s.label} label={s.label} value={s.value ?? '-'} hint={fromWorkbook} />)}
    </div>
  );
}

// One tile per SAT exam, newest first. An exam with no total wasn't taken -
// unless it was, and is only waiting on a scoring sheet.
function SatScoreHistory({ allScores }) {
  if (!allScores || allScores.length === 0) return null;
  return (
    // Wraps into extra rows instead of shrinking tiles until scores clip;
    // the 100px minimum matches the PDF.
    <div className="grid grid-cols-[repeat(auto-fill,minmax(112px,1fr))] gap-2">
      {allScores.map((s) => {
        const taken = s.total != null;
        return (
          <div key={s.groupId} className="min-w-0 rounded-lg border bg-muted/30 p-3">
            <div className="truncate text-xs font-medium text-muted-foreground" title={s.groupName}>{s.groupName || 'SAT'}</div>
            <div className={cn('mt-1 text-xl font-semibold tabular-nums', !taken && 'text-muted-foreground')}>
              {taken ? s.total : '-'}
            </div>
            <div className="mt-0.5 text-xs text-muted-foreground tabular-nums">
              {taken ? `RW ${s.english ?? '-'} · M ${s.math ?? '-'}` : <em>{s.pending ? 'Score pending' : 'Not taken'}</em>}
            </div>
            {s.date && <div className="text-xs text-muted-foreground">{displayDay(s.date) || s.date}</div>}
          </div>
        );
      })}
    </div>
  );
}

// ── Homework completion (admin-entered, included in the PDF) ─
// Parent-facing thresholds: 80%+ green, 60-79% orange, below 60% red.
const HW_MAX_TOTAL = 50;
const hwTone = (pct) => (pct >= 80 ? 'success' : pct >= 60 ? 'warning' : 'destructive');
const NONE = '__none__';

function HomeworkCompletion({ homework, onChange }) {
  const { total, completed } = homework;
  const totalNum = Number(total);
  const hasData = total !== '' && completed !== '';
  const pct = hasData ? Math.round((Number(completed) / totalNum) * 100) : null;
  const tone = pct != null ? hwTone(pct) : null;

  const handleTotal = (value) => {
    if (value === NONE) return onChange({ total: '', completed: '' });
    // Keep the completed pick, clamped so it can never exceed the new total.
    const clamped = completed === '' ? '' : String(Math.min(Number(completed), Number(value)));
    return onChange({ total: value, completed: clamped });
  };

  return (
    <div className="grid gap-4 rounded-lg border bg-muted/30 p-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div className="space-y-1">
          <div className="text-sm font-medium">Homework completion</div>
          <p className="text-sm text-muted-foreground">Set the counts before downloading or emailing - parents see this bar in the PDF.</p>
        </div>
        <div className="flex items-end gap-2">
          <Field className="w-24 gap-1.5">
            <FieldLabel htmlFor="hw-completed" className="text-xs text-muted-foreground">Completed</FieldLabel>
            <Select
              value={completed === '' ? NONE : completed}
              onValueChange={(value) => onChange({ ...homework, completed: value === NONE ? '' : value })}
              disabled={total === ''}
            >
              <SelectTrigger id="hw-completed" size="sm" className="w-full bg-background"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>-</SelectItem>
                {total !== '' && Array.from({ length: totalNum + 1 }, (_, i) => (
                  <SelectItem key={i} value={String(i)}>{i}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
          <span className="pb-1.5 text-sm text-muted-foreground">of</span>
          <Field className="w-24 gap-1.5">
            <FieldLabel htmlFor="hw-total" className="text-xs text-muted-foreground">Total</FieldLabel>
            <Select value={total === '' ? NONE : total} onValueChange={handleTotal}>
              <SelectTrigger id="hw-total" size="sm" className="w-full bg-background"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={NONE}>-</SelectItem>
                {Array.from({ length: HW_MAX_TOTAL }, (_, i) => i + 1).map((i) => (
                  <SelectItem key={i} value={String(i)}>{i}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </Field>
        </div>
      </div>
      {pct != null && (
        <div className="flex items-center gap-3">
          <ScoreBar pct={pct} tone={tone} className="h-2" />
          <Badge variant={tone} className="tabular-nums">{Number(completed)}/{totalNum} · {pct}%</Badge>
        </div>
      )}
    </div>
  );
}

// ── Latest test ───────────────────────────────────────────────
function LatestTest({ latestTest }) {
  return (
    <Card>
      <CardHeader>
        <CardTitle>Latest test</CardTitle>
      </CardHeader>
      <CardContent>
        {!latestTest ? (
          <p className="text-sm text-muted-foreground">No test in the selected range.</p>
        ) : (
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="font-medium">{latestTest.testName}</div>
              <div className="text-sm text-muted-foreground">
                {[latestTest.groupName, displayDay(latestTest.date) || latestTest.date, latestTest.duration].filter(Boolean).join(' · ')}
              </div>
            </div>
            <div className="flex items-center gap-2">
              <span className={cn('text-lg font-semibold tabular-nums', TONE_TEXT[scoreTone(latestTest.percentage)])}>
                {latestTest.percentage}%
              </span>
              <GradeBadge pct={latestTest.percentage} />
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Weekly performance: category strengths and weaknesses ────
function CategoryTable({ title, categories }) {
  const avg = categories.length
    ? Math.round(categories.reduce((sum, c) => sum + c.percentage, 0) / categories.length)
    : null;
  return (
    <div className="overflow-hidden rounded-lg border">
      <div className="flex items-center justify-between gap-2 border-b bg-muted/40 px-4 py-2.5">
        <span className="text-sm font-medium">{title}</span>
        {avg != null && <GradeBadge pct={avg}>Avg {avg}% · {letterGrade(avg)}</GradeBadge>}
      </div>
      {categories.length === 0 ? (
        <p className="px-4 py-3 text-sm text-muted-foreground">No category data.</p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              <TableHead className="pl-4 text-xs text-muted-foreground">Category</TableHead>
              <TableHead className="text-right text-xs text-muted-foreground">Score</TableHead>
              <TableHead className="w-28 pr-4 text-xs text-muted-foreground">
                <span className="sr-only">Performance</span>
              </TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {categories.map((c) => (
              <TableRow key={c.name} className="last:border-b-0">
                <TableCell className="pl-4 whitespace-normal">{c.name}</TableCell>
                <TableCell className={cn('text-right align-top font-medium tabular-nums sm:align-middle', TONE_TEXT[scoreTone(c.percentage)])}>
                  {c.correct}/{c.total} · {c.percentage}%
                </TableCell>
                <TableCell className="pr-4"><ScoreBar pct={c.percentage} /></TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </div>
  );
}

// Shared strengths/weaknesses picker (mirrors the PDF's pick logic).
const pickStrengthsWeaknesses = (cats) => {
  const TOP = 3;
  const MIN_QUESTIONS = 1; // 1-question categories are noise - skip them
  const STRENGTH_MIN = 70; // a strength must actually be strong
  const eligible = cats.filter((c) => c.total >= MIN_QUESTIONS);
  const strengths = eligible
    .filter((c) => c.percentage >= STRENGTH_MIN)
    .sort((a, b) => b.percentage - a.percentage || b.total - a.total)
    .slice(0, TOP);
  const used = new Set(strengths.map((c) => c.name));
  // Weaknesses ranked by missed-question count (total - correct), not raw
  // percentage - so 2/9 (7 missed) outranks 0/1 (1 missed, 100% wrong).
  const missed = (c) => c.total - c.correct;
  const weaknesses = eligible
    .filter((c) => c.percentage < 100 && !used.has(c.name))
    .sort((a, b) => missed(b) - missed(a) || a.percentage - b.percentage)
    .slice(0, TOP);
  return { strengths, weaknesses };
};

function WeeklyPerformance({ categoryPerf, categoryPerfSplit }) {
  // Prefer subject-split data (from webhook questions); fall back to the flat
  // list split by a keyword heuristic.
  const hasSplit = categoryPerfSplit && (
    (categoryPerfSplit.english && categoryPerfSplit.english.length > 0) ||
    (categoryPerfSplit.math && categoryPerfSplit.math.length > 0)
  );

  let enCategories = [];
  let maCategories = [];
  if (hasSplit) {
    enCategories = categoryPerfSplit.english || [];
    maCategories = categoryPerfSplit.math || [];
  } else if (categoryPerf && categoryPerf.length > 0) {
    const isEnglish = (name) =>
      /word|context|grammar|purpose|rhetoric|synthesis|reading|quotation|claim|transition|structure|function/i.test(name);
    enCategories = categoryPerf.filter((c) => isEnglish(c.name));
    maCategories = categoryPerf.filter((c) => !isEnglish(c.name));
  }

  const en = pickStrengthsWeaknesses(enCategories);
  const ma = pickStrengthsWeaknesses(maCategories);
  const hasData = enCategories.length > 0 || maCategories.length > 0;

  return (
    <Card>
      <CardHeader>
        <CardTitle>Weekly performance</CardTitle>
        <CardDescription>Strongest and weakest question categories in English and Math.</CardDescription>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <p className="text-sm text-muted-foreground">
            No category data available. Make sure “Questions / Responses / Category results” is enabled in the ClassMarker webhook settings.
          </p>
        ) : (
          <div className="grid gap-4 lg:grid-cols-2">
            <CategoryTable title="English strengths" categories={en.strengths} />
            <CategoryTable title="Math strengths" categories={ma.strengths} />
            <CategoryTable title="English weaknesses" categories={en.weaknesses} />
            <CategoryTable title="Math weaknesses" categories={ma.weaknesses} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

// ── Every test, by ClassMarker group ──────────────────────────
function GroupSection({ group }) {
  const [open, setOpen] = useState(true);
  const avg = group.results.length
    ? Math.round(group.results.reduce((sum, r) => sum + r.percentage, 0) / group.results.length * 10) / 10
    : 0;

  return (
    <Collapsible open={open} onOpenChange={setOpen} className="overflow-hidden rounded-lg border">
      <CollapsibleTrigger asChild>
        <button
          type="button"
          className="flex w-full items-center gap-3 bg-muted/40 px-4 py-3 text-left outline-none hover:bg-muted/70 focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
        >
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{group.groupName}</span>
          <Badge variant="outline" className="tabular-nums">
            {group.results.length} test{group.results.length !== 1 ? 's' : ''}
          </Badge>
          <GradeBadge pct={avg}>Avg {avg}% · {letterGrade(avg)}</GradeBadge>
          <LuChevronDown aria-hidden="true" className={cn('size-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
        </button>
      </CollapsibleTrigger>
      <CollapsibleContent>
        <Table>
          <TableHeader>
            <TableRow className="hover:bg-transparent">
              {['Test', 'Date', 'Score', 'Grade', 'Performance', 'Status'].map((h) => (
                <TableHead key={h} className="text-xs text-muted-foreground first:pl-4 last:pr-4">{h}</TableHead>
              ))}
            </TableRow>
          </TableHeader>
          <TableBody>
            {group.results.map((r, i) => (
              <TableRow key={`${r.testName}-${r.timeFinished || i}`} className="last:border-b-0">
                <TableCell className="pl-4 font-medium">{r.testName}</TableCell>
                <TableCell className="text-muted-foreground">{displayDay(r.date) || r.date}</TableCell>
                <TableCell className="tabular-nums">
                  <span className={cn('font-medium', TONE_TEXT[scoreTone(r.percentage)])}>{r.score}</span>
                  <span className="text-muted-foreground">/{r.maxScore} · {r.percentage}%</span>
                </TableCell>
                <TableCell><GradeBadge pct={r.percentage} /></TableCell>
                <TableCell className="min-w-28"><ScoreBar pct={r.percentage} /></TableCell>
                <TableCell className="pr-4">
                  <Badge variant={r.passed ? 'success' : 'destructive'}>{r.passed ? 'Passed' : 'Failed'}</Badge>
                </TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      </CollapsibleContent>
    </Collapsible>
  );
}

// ── The report ────────────────────────────────────────────────
export default function ReportViewer({
  data, onDownload, downloadLoading, downloadError, downloadSuccess,
  homework = { total: '', completed: '' }, onHomeworkChange,
  contacts, onContactsChange, onSaveContacts, onSendEmail,
  emailConfigured, emailLoading, emailError, emailSuccess,
  emailSubject, onEmailSubjectChange,
}) {
  const { student, groups, satScores, startDate, endDate, latestTest, categoryPerf, categoryPerfSplit } = data;
  const totalTests = groups.reduce((sum, g) => sum + g.results.length, 0);
  const totalGroups = groups.length;

  return (
    <div className="grid gap-6 animate-in fade-in-0 slide-in-from-bottom-1 duration-300">
      <Card>
        <CardContent className="grid gap-6">
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex min-w-0 items-center gap-3">
              <span
                aria-hidden="true"
                className="flex size-11 shrink-0 items-center justify-center rounded-full bg-primary text-sm font-medium text-primary-foreground"
              >
                {initials(student.name)}
              </span>
              <div className="min-w-0">
                <div className="truncate text-lg font-semibold tracking-tight">{student.name}</div>
                <div className="text-sm text-muted-foreground">
                  {[
                    student.email,
                    formatRange(startDate, endDate),
                    `${totalTests} test${totalTests !== 1 ? 's' : ''} in ${totalGroups} group${totalGroups !== 1 ? 's' : ''}`,
                  ].filter(Boolean).join(' · ')}
                </div>
              </div>
            </div>
            <Button onClick={onDownload} disabled={downloadLoading}>
              {downloadLoading ? <Spinner data-icon="inline-start" /> : <LuDownload data-icon="inline-start" />}
              {downloadLoading ? 'Preparing PDF…' : 'Download PDF'}
            </Button>
          </div>

          {downloadSuccess && <Notice variant="success">The PDF opened in a new tab.</Notice>}
          {downloadError && <Notice variant="destructive">{downloadError}</Notice>}

          <Separator />

          <section className="grid gap-3" aria-labelledby="sat-heading">
            <h2 id="sat-heading" className="text-sm font-medium">SAT scores</h2>
            <SatScores satScores={satScores} />
            <SatScoreHistory allScores={satScores?.allScores} />
          </section>

          {onHomeworkChange && <HomeworkCompletion homework={homework} onChange={onHomeworkChange} />}

          {onSendEmail && (
            <EmailReportPanel
              registeredStudentEmail={student.email}
              contacts={contacts}
              onChange={onContactsChange}
              onSave={onSaveContacts}
              onSend={onSendEmail}
              configured={emailConfigured}
              loading={emailLoading}
              error={emailError}
              success={emailSuccess}
              subject={emailSubject}
              onSubjectChange={onEmailSubjectChange}
            />
          )}
        </CardContent>
      </Card>

      <LatestTest latestTest={latestTest} />

      <WeeklyPerformance categoryPerf={categoryPerf} categoryPerfSplit={categoryPerfSplit} />

      <Card>
        <CardHeader>
          <CardTitle>All tests</CardTitle>
          <CardDescription>Every test in the range, by ClassMarker group.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-3">
          {groups.length === 0 ? (
            <p className="text-sm text-muted-foreground">No results in the selected range.</p>
          ) : (
            groups.map((g) => <GroupSection key={g.groupId} group={g} />)
          )}
        </CardContent>
      </Card>
    </div>
  );
}
