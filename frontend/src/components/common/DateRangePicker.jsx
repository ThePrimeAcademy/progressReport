// components/common/DateRangePicker.jsx
// One button showing the report's date range; it opens a two-month calendar
// with a few common ranges alongside. Picking works the obvious way: the
// first click is the first day, the second click the last day (in either
// order), and the calendar closes.
//
// startDate / endDate are 'YYYY-MM-DD' strings ('' when unset).
import React, { useState } from 'react';
import { format, startOfMonth, subMonths } from 'date-fns';
import { LuCalendar } from 'react-icons/lu';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import LazyCalendar from '@/components/common/LazyCalendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { useMediaQuery } from '@/hooks/use-media-query';
import { formatDay, lastDays, parseDay, serverToday } from '@/lib/dates';
import { PROGRAM_START_DATE } from '@/features/report/constants';

const PRESETS = [
  { label: 'Last 7 days', range: () => lastDays(7) },
  { label: 'Last 14 days', range: () => lastDays(14) },
  { label: 'Last 30 days', range: () => lastDays(30) },
  { label: 'Whole program', range: () => ({ startDate: PROGRAM_START_DATE, endDate: serverToday() }) },
];

export function formatRange(startDate, endDate) {
  const from = parseDay(startDate);
  const to = parseDay(endDate);
  if (!from || !to) return '';
  const sameYear = from.getFullYear() === to.getFullYear();
  return `${format(from, sameYear ? 'MMM d' : 'MMM d, yyyy')} → ${format(to, 'MMM d, yyyy')}`;
}

export default function DateRangePicker({ id, startDate, endDate, onStartChange, onEndChange, className }) {
  const [open, setOpen] = useState(false);
  const [firstDay, setFirstDay] = useState(null); // the first click of a new range
  const twoMonths = useMediaQuery('(min-width: 640px)');

  const from = parseDay(startDate);
  const to = parseDay(endDate);
  const invalid = Boolean(from && to && from > to);

  function apply(range) {
    onStartChange(range.startDate);
    onEndChange(range.endDate);
    setFirstDay(null);
    setOpen(false);
  }

  function pick(_range, day) {
    if (!firstDay) {
      setFirstDay(day);
      return;
    }
    const [start, end] = firstDay <= day ? [firstDay, day] : [day, firstDay];
    apply({ startDate: formatDay(start), endDate: formatDay(end) });
  }

  const selected = firstDay ? { from: firstDay, to: undefined } : from ? { from, to } : undefined;
  const anchor = to || from || new Date();
  const label = formatRange(startDate, endDate);

  return (
    <div className={cn('grid gap-1.5', className)}>
      <Popover open={open} onOpenChange={(next) => { setOpen(next); setFirstDay(null); }}>
        <PopoverTrigger asChild>
          <Button
            id={id}
            variant="outline"
            aria-invalid={invalid || undefined}
            className={cn('w-full justify-start font-normal', !label && 'text-muted-foreground')}
          >
            <LuCalendar data-icon="inline-start" />
            {label || 'Pick a date range'}
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-auto p-0" align="start" collisionPadding={16}>
          <div className="flex flex-col sm:flex-row">
            <div className="flex flex-wrap gap-1 border-b p-2 sm:w-36 sm:flex-col sm:flex-nowrap sm:border-r sm:border-b-0">
              {PRESETS.map((preset) => (
                <Button
                  key={preset.label}
                  variant="ghost"
                  size="sm"
                  className="justify-start font-normal"
                  onClick={() => apply(preset.range())}
                >
                  {preset.label}
                </Button>
              ))}
            </div>
            <div>
              <LazyCalendar
                mode="range"
                numberOfMonths={twoMonths ? 2 : 1}
                defaultMonth={startOfMonth(twoMonths ? subMonths(anchor, 1) : anchor)}
                selected={selected}
                onSelect={pick}
                captionLayout="dropdown"
                startMonth={new Date(2024, 0)}
                endMonth={new Date(new Date().getFullYear() + 1, 11)}
              />
              <p className="px-3 pb-3 text-xs text-muted-foreground" aria-live="polite">
                {firstDay ? `From ${format(firstDay, 'MMM d')}: now pick the last day.` : 'Pick the first day, then the last.'}
              </p>
            </div>
          </div>
        </PopoverContent>
      </Popover>
      {invalid && <p className="text-sm text-destructive">The start date is after the end date.</p>}
    </div>
  );
}
