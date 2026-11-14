// components/common/SyncStatus.jsx
// How current the ClassMarker results are, in the page header. Opens a short
// explanation, the share of the 30-requests-an-hour budget in use, and a
// button to check ClassMarker now (which the server skips when it synced in
// the last few minutes, so it can't waste requests).
import React, { useEffect, useState } from 'react';
import { formatDistanceToNowStrict } from 'date-fns';
import { useQueryClient } from '@tanstack/react-query';
import { LuRefreshCw } from 'react-icons/lu';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger,
} from '@/components/ui/popover';
import { Separator } from '@/components/ui/separator';
import { Spinner } from '@/components/ui/spinner';
import { refreshDirectory } from '@/features/report/api/reportApi';
import { queryKeys, useDirectory } from '@/features/report/api/queries';

// Re-render every `ms` so "5 minutes ago" keeps counting.
function useNow(ms) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(timer);
  }, [ms]);
  return now;
}

export default function SyncStatus() {
  const { data } = useDirectory();
  const queryClient = useQueryClient();
  const [checking, setChecking] = useState(false);
  const [result, setResult] = useState(null); // { ok, text }
  useNow(30 * 1000);

  const sync = data?.sync;
  if (!sync) return null; // still loading, or a server without sync info

  const syncedAt = sync.syncedAt ? new Date(sync.syncedAt) : null;
  const ago = syncedAt ? formatDistanceToNowStrict(syncedAt, { addSuffix: true }) : null;
  const label = !sync.live ? 'Offline' : ago ? `Synced ${ago}` : 'Not synced yet';

  async function checkNow() {
    setChecking(true);
    setResult(null);
    try {
      const outcome = await refreshDirectory();
      if (outcome.directory) queryClient.setQueryData(queryKeys.directory, outcome.directory);
      else await queryClient.invalidateQueries({ queryKey: queryKeys.directory });
      if (outcome.refreshed) {
        // New results can add tests and attempts, not just students.
        queryClient.invalidateQueries({ queryKey: queryKeys.exams });
        queryClient.invalidateQueries({ queryKey: queryKeys.availableTests });
      }
      setResult({ ok: true, text: outcome.message });
    } catch (err) {
      setResult({ ok: false, text: err.message || 'Could not reach the server.' });
    } finally {
      setChecking(false);
    }
  }

  return (
    <Popover onOpenChange={(open) => { if (!open) setResult(null); }}>
      <PopoverTrigger asChild>
        <Button variant="ghost" size="sm" className="gap-2 text-muted-foreground" aria-label={`ClassMarker: ${label}`}>
          <span
            aria-hidden="true"
            className={cn('size-2 shrink-0 rounded-full', sync.live ? 'bg-success' : 'bg-muted-foreground/50')}
          />
          <span className="hidden md:inline">{label}</span>
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80">
        <PopoverHeader>
          <PopoverTitle>ClassMarker results</PopoverTitle>
          <PopoverDescription>
            {sync.live
              ? 'New results arrive within seconds of each test. The server also double-checks ClassMarker about once an hour.'
              : 'This server has no ClassMarker credentials, so it shows only the results it already has.'}
          </PopoverDescription>
        </PopoverHeader>
        {sync.live && (
          <>
            <Separator />
            <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-1.5 text-sm">
              <dt className="text-muted-foreground">Last checked</dt>
              <dd className="text-right">{ago || 'not yet'}</dd>
              <dt className="text-muted-foreground">API requests this hour</dt>
              <dd className="text-right tabular-nums">
                {sync.requestsLastHour} of {sync.hourlyLimit}
              </dd>
            </dl>
            <Button variant="outline" size="sm" onClick={checkNow} disabled={checking}>
              {checking ? <Spinner data-icon="inline-start" /> : <LuRefreshCw data-icon="inline-start" />}
              Check for new results
            </Button>
            {result && (
              <p className={cn('text-xs', result.ok ? 'text-muted-foreground' : 'text-destructive')} aria-live="polite">
                {result.text}
              </p>
            )}
          </>
        )}
      </PopoverContent>
    </Popover>
  );
}
