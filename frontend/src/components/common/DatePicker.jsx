// components/common/DatePicker.jsx
// A button showing one date that opens a calendar. value is a 'YYYY-MM-DD'
// string ('' when unset); onChange receives the same ('' when cleared).
import React, { useState } from 'react';
import { format } from 'date-fns';
import { LuCalendar } from 'react-icons/lu';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import LazyCalendar from '@/components/common/LazyCalendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { formatDay, parseDay } from '@/lib/dates';

export default function DatePicker({
  id,
  value,
  onChange,
  placeholder = 'Pick a date',
  clearable = false,
  disabledBefore, // Date: days before it can't be picked
  size = 'default',
  className,
  'aria-label': ariaLabel,
}) {
  const [open, setOpen] = useState(false);
  const date = parseDay(value);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          size={size}
          aria-label={ariaLabel}
          className={cn('justify-start font-normal', !date && 'text-muted-foreground', className)}
        >
          <LuCalendar data-icon="inline-start" />
          {date ? format(date, 'MMM d, yyyy') : placeholder}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start" collisionPadding={16}>
        <LazyCalendar
          mode="single"
          selected={date}
          defaultMonth={date}
          captionLayout="dropdown"
          startMonth={new Date(2024, 0)}
          endMonth={new Date(new Date().getFullYear() + 1, 11)}
          disabled={disabledBefore ? { before: disabledBefore } : undefined}
          onSelect={(day) => {
            onChange(day ? formatDay(day) : '');
            setOpen(false);
          }}
        />
        {clearable && date && (
          <div className="border-t p-2">
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              onClick={() => { onChange(''); setOpen(false); }}
            >
              Clear date
            </Button>
          </div>
        )}
      </PopoverContent>
    </Popover>
  );
}
