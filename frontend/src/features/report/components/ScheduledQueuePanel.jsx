// features/report/components/ScheduledQueuePanel.jsx
// Scheduled sends: every batch the server sends (or has sent) at a set time.
// Polls so batches in flight advance on their own, opens a batch to show each
// recipient's delivery, and cancels a batch that hasn't started yet.
import React, { useCallback, useEffect, useState } from 'react';
import { LuCalendarClock, LuChevronDown, LuRefreshCw, LuX } from 'react-icons/lu';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Card, CardAction, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible';
import { Empty, EmptyDescription, EmptyHeader, EmptyMedia, EmptyTitle } from '@/components/ui/empty';
import { Skeleton } from '@/components/ui/skeleton';
import { Spinner } from '@/components/ui/spinner';
import { Notice } from '@/components/common/Notice';
import { useConfirm } from '@/components/common/confirm';
import { formatRange } from '@/components/common/DateRangePicker';
import { fetchEmailQueue, fetchEmailBatch, cancelScheduledBatch } from '../api/reportApi.js';
import { BatchStatusBadge, SendStatusBadge, formatSendTime } from './sendStatus.jsx';

const POLL_INTERVAL_MS = 15000;

// A canceled batch keeps its unsent recipients as 'pending' on the server;
// they will never go out, so they read as canceled here.
const isCanceled = (batch) => batch.status === 'canceled';
const itemStatus = (batch, item) => (isCanceled(batch) && item.status === 'pending' ? 'canceled' : item.status);

function countsSummary(batch) {
  const c = batch.counts;
  if (!c) return '';
  const parts = [];
  if (c.sent) parts.push(`${c.sent} sent`);
  if (c.failed) parts.push(`${c.failed} failed`);
  if (c.sending) parts.push(`${c.sending} sending`);
  if (c.pending) parts.push(`${c.pending} ${isCanceled(batch) ? 'canceled' : 'queued'}`);
  if (c.skipped) parts.push(`${c.skipped} skipped`);
  parts.push(`${c.total} total`);
  return parts.join(' · ');
}

// What the batch sends, and for which report dates (a message without a
// report has none).
function describeBatch(batch) {
  const custom = batch.kind === 'custom';
  const withReport = !custom || Boolean(batch.include_report);
  const kind = custom ? (withReport ? 'Message with report' : 'Message') : 'Report';
  const range = withReport ? formatRange(batch.start_date, batch.end_date) : '';
  return [formatSendTime(batch.send_at), kind, range].filter(Boolean).join(' · ');
}

function BatchRow({ batch, open, onOpenChange, detail, detailLoading, canceling, onCancel }) {
  const cancelable = batch.status === 'scheduled';
  return (
    <Collapsible open={open} onOpenChange={onOpenChange} className="border-b last:border-b-0">
      <div className={cn('flex items-center gap-2 pr-4 transition-colors hover:bg-muted/50', open && 'bg-muted/40')}>
        <CollapsibleTrigger asChild>
          <button
            type="button"
            className="flex min-w-0 flex-1 items-start gap-3 py-3 pl-4 text-left outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50 focus-visible:ring-inset"
          >
            <LuChevronDown
              aria-hidden="true"
              className={cn('mt-0.5 size-4 shrink-0 text-muted-foreground transition-transform', open && 'rotate-180')}
            />
            <span className="grid min-w-0 flex-1 gap-1">
              <span className="flex flex-wrap items-center gap-2">
                <span className="min-w-0 text-sm font-medium break-words">{batch.label || 'Untitled batch'}</span>
                <BatchStatusBadge status={batch.status} />
              </span>
              <span className="text-xs text-muted-foreground">{describeBatch(batch)}</span>
              <span className="text-xs text-muted-foreground tabular-nums">{countsSummary(batch)}</span>
            </span>
          </button>
        </CollapsibleTrigger>
        {cancelable && (
          <Button variant="outline" size="sm" onClick={() => onCancel(batch)} disabled={canceling}>
            {canceling ? <Spinner data-icon="inline-start" /> : <LuX data-icon="inline-start" />}
            {canceling ? 'Canceling…' : 'Cancel'}
          </Button>
        )}
      </div>
      <CollapsibleContent>
        <div className="border-t bg-muted/20">
          {detailLoading && !detail && (
            <p className="flex items-center gap-2 px-4 py-3 pl-11 text-sm text-muted-foreground">
              <Spinner className="size-3.5" /> Loading recipients…
            </p>
          )}
          {detail?.items?.map((item) => {
            const to = [item.student_email, item.parent_email].filter(Boolean).join(', ');
            return (
              <div key={item.id} className="grid gap-0.5 border-b py-2 pr-4 pl-11 last:border-b-0">
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-sm">{item.student_name || item.student_id}</span>
                  <SendStatusBadge status={itemStatus(batch, item)} />
                </div>
                {to && <p className="text-xs break-words text-muted-foreground">{to}</p>}
                {item.error && <p className="text-xs break-words text-destructive">{item.error}</p>}
              </div>
            );
          })}
          {detail?.items?.length === 0 && (
            <p className="px-4 py-3 pl-11 text-sm text-muted-foreground">No recipients in this batch.</p>
          )}
          {!detailLoading && !detail && (
            <p className="px-4 py-3 pl-11 text-sm text-muted-foreground">Could not load the recipients.</p>
          )}
        </div>
      </CollapsibleContent>
    </Collapsible>
  );
}

export default function ScheduledQueuePanel({ refreshSignal = 0 }) {
  const confirm = useConfirm();
  const [batches, setBatches] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState(null);
  const [expandedId, setExpandedId] = useState(null);
  const [details, setDetails] = useState({}); // batchId -> { items }
  const [detailLoading, setDetailLoading] = useState(null);
  const [canceling, setCanceling] = useState(() => new Set());

  const load = useCallback(async () => {
    try {
      setBatches(await fetchEmailQueue());
      setError(null);
    } catch (err) {
      setError(err.message || 'Could not load the queue.');
    } finally {
      setLoading(false);
    }
  }, []);

  // First load, and again whenever a new batch has just been scheduled.
  useEffect(() => { load(); }, [load, refreshSignal]);

  // Poll so scheduled and in-flight batches advance without a manual refresh.
  useEffect(() => {
    const timer = setInterval(load, POLL_INTERVAL_MS);
    return () => clearInterval(timer);
  }, [load]);

  // Keep an open batch's recipients current while it is waiting or sending.
  useEffect(() => {
    if (!expandedId) return;
    const batch = batches.find((b) => b.id === expandedId);
    if (batch && (batch.status === 'running' || batch.status === 'scheduled')) {
      fetchEmailBatch(expandedId)
        .then((detail) => setDetails((prev) => ({ ...prev, [expandedId]: detail })))
        .catch(() => {});
    }
  }, [batches, expandedId]);

  async function setOpen(id, open) {
    if (!open) {
      setExpandedId(null);
      return;
    }
    setExpandedId(id);
    if (details[id]) return;
    setDetailLoading(id);
    try {
      const detail = await fetchEmailBatch(id);
      setDetails((prev) => ({ ...prev, [id]: detail }));
    } catch {
      // Leave it unset; the row says the recipients could not be loaded.
    } finally {
      setDetailLoading(null);
    }
  }

  async function refresh() {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  }

  async function handleCancel(batch) {
    const total = batch.counts?.total ?? 0;
    const ok = await confirm({
      title: 'Cancel this scheduled send?',
      description: `“${batch.label || 'Untitled batch'}” will not go out, so none of its ${total} recipient${total === 1 ? '' : 's'} will be emailed.`,
      confirmLabel: 'Cancel send',
      cancelLabel: 'Keep it',
      destructive: true,
    });
    if (!ok) return;
    setCanceling((prev) => new Set(prev).add(batch.id));
    try {
      await cancelScheduledBatch(batch.id);
      await load();
    } catch (err) {
      setError(err.message || 'Could not cancel the send.');
    } finally {
      setCanceling((prev) => {
        const next = new Set(prev);
        next.delete(batch.id);
        return next;
      });
    }
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>Scheduled sends</CardTitle>
        <CardDescription>Each batch goes out at its time. Open one to see every recipient.</CardDescription>
        <CardAction>
          <Button variant="ghost" size="icon-sm" onClick={refresh} disabled={refreshing} aria-label="Refresh the queue">
            <LuRefreshCw className={cn(refreshing && 'animate-spin')} />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="grid gap-4">
        {error && <Notice variant="destructive">{error}</Notice>}
        {loading && batches.length === 0 ? (
          <div className="grid gap-2" aria-busy="true" aria-label="Loading the queue">
            <Skeleton className="h-16 w-full" />
            <Skeleton className="h-16 w-full" />
          </div>
        ) : batches.length === 0 ? (
          !error && (
            <Empty className="border">
              <EmptyHeader>
                <EmptyMedia variant="icon"><LuCalendarClock /></EmptyMedia>
                <EmptyTitle>Nothing scheduled</EmptyTitle>
                <EmptyDescription>Pick a day and time under “Or schedule for later” to send reports automatically.</EmptyDescription>
              </EmptyHeader>
            </Empty>
          )
        ) : (
          <div className="overflow-hidden rounded-lg border bg-card">
            {batches.map((batch) => (
              <BatchRow
                key={batch.id}
                batch={batch}
                open={expandedId === batch.id}
                onOpenChange={(open) => setOpen(batch.id, open)}
                detail={details[batch.id]}
                detailLoading={detailLoading === batch.id}
                canceling={canceling.has(batch.id)}
                onCancel={handleCancel}
              />
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}
