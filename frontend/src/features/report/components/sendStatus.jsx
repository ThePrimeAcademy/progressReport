// features/report/components/sendStatus.jsx
// Status badges shared by the email pages: one recipient's delivery status
// (Bulk Send results, the scheduled queue) and a scheduled batch's status.
import React from 'react';
import { format } from 'date-fns';
import {
  LuBan,
  LuCalendarClock,
  LuCheck,
  LuCheckCheck,
  LuCircleX,
  LuClock,
  LuTriangleAlert,
} from 'react-icons/lu';
import { Badge } from '@/components/ui/badge';
import { Spinner } from '@/components/ui/spinner';

const SEND_STATUS = {
  pending: { label: 'Queued', variant: 'outline', icon: LuClock },
  sending: { label: 'Sending', variant: 'secondary', busy: true },
  sent: { label: 'Sent', variant: 'success', icon: LuCheck },
  deduped: { label: 'Already sent', variant: 'success', icon: LuCheckCheck },
  skipped: { label: 'No contacts', variant: 'warning', icon: LuBan },
  failed: { label: 'Failed', variant: 'destructive', icon: LuCircleX },
  // Still pending when its batch was canceled - it will never go out.
  canceled: { label: 'Canceled', variant: 'outline', icon: LuBan },
};

const BATCH_STATUS = {
  scheduled: { label: 'Scheduled', variant: 'secondary', icon: LuCalendarClock },
  running: { label: 'Sending', variant: 'secondary', busy: true },
  completed: { label: 'Completed', variant: 'success', icon: LuCheck },
  completed_with_errors: { label: 'Completed with errors', variant: 'warning', icon: LuTriangleAlert },
  canceled: { label: 'Canceled', variant: 'outline', icon: LuBan },
  failed: { label: 'Failed', variant: 'destructive', icon: LuCircleX },
};

function StatusBadge({ status, table }) {
  const s = table[status] || { label: String(status || 'Unknown'), variant: 'outline' };
  const Icon = s.icon;
  return (
    <Badge variant={s.variant}>
      {s.busy ? <Spinner aria-hidden="true" /> : Icon ? <Icon aria-hidden="true" /> : null}
      {s.label}
    </Badge>
  );
}

// pending | sending | sent | deduped | skipped | failed | canceled
export function SendStatusBadge({ status }) {
  return <StatusBadge status={status} table={SEND_STATUS} />;
}

// scheduled | running | completed | completed_with_errors | canceled | failed
export function BatchStatusBadge({ status }) {
  return <StatusBadge status={status} table={BATCH_STATUS} />;
}

// When a scheduled send goes out, e.g. "Dec 15, 2026 at 9:00 AM".
export function formatSendTime(dateOrIso) {
  const date = dateOrIso instanceof Date ? dateOrIso : new Date(dateOrIso);
  return Number.isNaN(date.getTime()) ? String(dateOrIso || '') : format(date, "MMM d, yyyy 'at' h:mm a");
}
