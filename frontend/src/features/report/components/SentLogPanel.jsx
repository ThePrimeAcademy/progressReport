// features/report/components/SentLogPanel.jsx
// The Sent log page: a searchable history of every email the server sent (or
// failed to send) - report emails and Compose messages, sent right away or
// scheduled. Read-only; the server writes a row at send time
// (db.logSentEmail).
import React, { useState, useEffect, useCallback } from 'react';
import { format } from 'date-fns';
import { LuChevronLeft, LuChevronRight, LuInbox, LuPaperclip, LuRefreshCw, LuSearch } from 'react-icons/lu';
import { cn } from '@/lib/utils';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { Notice } from '@/components/common/Notice';
import { fetchSentLog } from '../api/reportApi.js';

const PAGE_SIZE = 100;
const KIND_LABEL = { report: 'Report', custom: 'Message' };
const SOURCE_LABEL = { immediate: 'Sent now', scheduled: 'Scheduled' };
const COLUMN_COUNT = 6;

function formatWhen(iso) {
  const date = new Date(iso);
  return Number.isNaN(date.getTime()) ? String(iso || '') : format(date, 'MMM d, yyyy, h:mm a');
}

const typeLabel = (e) => `${KIND_LABEL[e.kind] || e.kind} · ${SOURCE_LABEL[e.source] || e.source}`;

function Attachments({ names }) {
  const files = String(names || '').split(', ').filter(Boolean);
  if (files.length === 0) return null;
  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <button
          type="button"
          className="inline-flex shrink-0 items-center gap-1 rounded-sm text-xs text-muted-foreground outline-none hover:text-foreground focus-visible:ring-[3px] focus-visible:ring-ring/50"
          aria-label={`Attachments: ${files.join(', ')}`}
        >
          <LuPaperclip className="size-3.5" aria-hidden="true" />
          <span className="tabular-nums">{files.length}</span>
        </button>
      </TooltipTrigger>
      <TooltipContent side="top" className="block">
        {files.map((file) => <div key={file}>{file}</div>)}
      </TooltipContent>
    </Tooltip>
  );
}

function StatusBadge({ failed }) {
  return <Badge variant={failed ? 'destructive' : 'success'}>{failed ? 'Failed' : 'Sent'}</Badge>;
}

function EmptyLog({ searching }) {
  return (
    <Empty>
      <EmptyHeader>
        <EmptyMedia variant="icon"><LuInbox /></EmptyMedia>
        <EmptyTitle>{searching ? 'No matches' : 'Nothing sent yet'}</EmptyTitle>
        <EmptyDescription>
          {searching ? 'No sent email matches your search.' : 'Emails appear here as they are sent.'}
        </EmptyDescription>
      </EmptyHeader>
    </Empty>
  );
}

// Phones and tablets: one block per email.
function LogList({ entries }) {
  return entries.map((e) => {
    const failed = e.status !== 'sent';
    return (
      <div key={e.id} className="grid gap-1 border-b px-4 py-3 last:border-b-0">
        <div className="flex items-start justify-between gap-3">
          <span className="min-w-0 text-sm font-medium break-words">{e.student_name || e.student_id || '-'}</span>
          <StatusBadge failed={failed} />
        </div>
        <div className="flex items-start gap-2 text-sm">
          <span className="min-w-0 flex-1 break-words">{e.subject || '-'}</span>
          <Attachments names={e.attachments} />
        </div>
        <p className="text-xs break-words text-muted-foreground">To {e.recipients || '-'}</p>
        <p className="text-xs text-muted-foreground">{typeLabel(e)} · {formatWhen(e.sent_at)}</p>
        {failed && e.error && <p className="text-xs break-words text-destructive">{e.error}</p>}
      </div>
    );
  });
}

// Wide screens: a table. One tbody per email, so a failed send's error line
// belongs to its row - the tbody carries the hover highlight and separator.
function LogTable({ entries }) {
  return (
    <Table className="min-w-[56rem] table-fixed">
      <TableHeader>
        <TableRow className="hover:bg-transparent">
          <TableHead className="w-[15%] pl-4 text-xs text-muted-foreground">Student</TableHead>
          <TableHead className="w-[25%] text-xs text-muted-foreground">Recipients</TableHead>
          <TableHead className="w-[24%] text-xs text-muted-foreground">Subject</TableHead>
          <TableHead className="w-[13%] text-xs text-muted-foreground">Type</TableHead>
          <TableHead className="w-[9%] text-xs text-muted-foreground">Status</TableHead>
          <TableHead className="w-[14%] pr-4 text-xs text-muted-foreground">Sent</TableHead>
        </TableRow>
      </TableHeader>
      {entries.map((e) => {
        const failed = e.status !== 'sent';
        return (
          <TableBody key={e.id} className="border-b transition-colors last:border-b-0 hover:bg-muted/50">
            <TableRow className="border-b-0 align-top hover:bg-transparent">
              <TableCell className="pl-4 font-medium whitespace-normal break-words">
                {e.student_name || e.student_id || '-'}
              </TableCell>
              <TableCell className="whitespace-normal break-words text-muted-foreground">{e.recipients || '-'}</TableCell>
              <TableCell className="whitespace-normal">
                <div className="flex items-start gap-2">
                  <span className="min-w-0 flex-1 break-words">{e.subject || '-'}</span>
                  <Attachments names={e.attachments} />
                </div>
              </TableCell>
              <TableCell className="whitespace-normal text-muted-foreground">{typeLabel(e)}</TableCell>
              <TableCell><StatusBadge failed={failed} /></TableCell>
              <TableCell className="pr-4 whitespace-normal text-muted-foreground">{formatWhen(e.sent_at)}</TableCell>
            </TableRow>
            {failed && e.error && (
              <TableRow className="hover:bg-transparent">
                <TableCell colSpan={COLUMN_COUNT} className="px-4 pt-0 pb-3 text-xs whitespace-normal break-words text-destructive">
                  {e.error}
                </TableCell>
              </TableRow>
            )}
          </TableBody>
        );
      })}
    </Table>
  );
}

function LoadingRows() {
  return (
    <div aria-busy="true" aria-label="Loading the sent log">
      {Array.from({ length: 6 }, (_, i) => (
        <div key={i} className="grid gap-2 border-b px-4 py-3.5 last:border-b-0 lg:grid-cols-[15%_25%_24%_13%_9%_14%] lg:gap-0">
          <Skeleton className="h-3.5 w-28" />
          <Skeleton className="h-3.5 w-44" />
          <Skeleton className="h-3.5 w-36" />
          <Skeleton className="hidden h-3.5 w-20 lg:block" />
          <Skeleton className="hidden h-5 w-14 rounded-full lg:block" />
          <Skeleton className="hidden h-3.5 w-24 lg:block" />
        </div>
      ))}
    </div>
  );
}

export default function SentLogPanel() {
  const [entries, setEntries] = useState([]);
  const [search, setSearch] = useState('');
  const [applied, setApplied] = useState('');
  const [page, setPage] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  const load = useCallback(async (searchTerm, pageNum) => {
    setLoading(true);
    setError(null);
    try {
      setEntries(await fetchSentLog({ limit: PAGE_SIZE, offset: pageNum * PAGE_SIZE, search: searchTerm }));
    } catch (e) {
      setError(e.message || 'Could not load the sent log.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(applied, page); }, [load, applied, page]);

  // Typing settles for a moment before searching, and starts from page one.
  useEffect(() => {
    const timer = setTimeout(() => { setApplied(search.trim()); setPage(0); }, 350);
    return () => clearTimeout(timer);
  }, [search]);

  return (
    <Card>
      <CardContent className="grid gap-4">
        <div className="flex items-center gap-2">
          <InputGroup className="min-w-0 flex-1 sm:max-w-md">
            <InputGroupAddon>
              <LuSearch aria-hidden="true" />
            </InputGroupAddon>
            <InputGroupInput
              value={search}
              placeholder="Search sent emails"
              aria-label="Search the sent log by student, recipient or subject"
              onChange={(e) => setSearch(e.target.value)}
            />
          </InputGroup>
          <Button variant="outline" onClick={() => load(applied, page)} disabled={loading} aria-label="Refresh">
            <LuRefreshCw data-icon="inline-start" className={cn(loading && 'animate-spin')} />
            <span className="hidden sm:inline">Refresh</span>
          </Button>
        </div>

        {error && <Notice variant="destructive">{error}</Notice>}

        <div className="overflow-hidden rounded-lg border bg-card">
          {loading ? (
            <LoadingRows />
          ) : entries.length === 0 ? (
            <EmptyLog searching={Boolean(applied)} />
          ) : (
            <>
              <div className="lg:hidden"><LogList entries={entries} /></div>
              <div className="hidden lg:block"><LogTable entries={entries} /></div>
            </>
          )}
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={page === 0 || loading}
            onClick={() => setPage((p) => Math.max(p - 1, 0))}
          >
            <LuChevronLeft data-icon="inline-start" />
            Newer
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={entries.length < PAGE_SIZE || loading}
            onClick={() => setPage((p) => p + 1)}
          >
            Older
            <LuChevronRight data-icon="inline-end" />
          </Button>
          <span className="text-sm text-muted-foreground">
            Page {page + 1}{applied ? ` · matching “${applied}”` : ''}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}
