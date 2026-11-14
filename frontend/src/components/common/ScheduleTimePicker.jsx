// components/common/ScheduleTimePicker.jsx
// When a scheduled send should go out: a day (today or later) and a time.
// value / onChange use a local 'YYYY-MM-DDTHH:mm' string ('' when unset) -
// what new Date() reads as the viewer's own time.
import React from 'react';
import { startOfToday } from 'date-fns';
import { cn } from '@/lib/utils';
import { Input } from '@/components/ui/input';
import DatePicker from '@/components/common/DatePicker';

export default function ScheduleTimePicker({ id, value, onChange, className }) {
  const [day = '', time = ''] = String(value || '').split('T');

  // Until a day is picked there is nothing to send; a day with no time yet
  // defaults to 9:00 AM, which the time field then shows.
  function update(nextDay, nextTime) {
    if (!nextDay) return onChange('');
    return onChange(`${nextDay}T${nextTime || '09:00'}`);
  }

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <DatePicker
        id={id}
        value={day}
        onChange={(next) => update(next, time)}
        placeholder="Pick a day"
        disabledBefore={startOfToday()}
        className="min-w-36 flex-1"
        aria-label="Send on"
      />
      <Input
        type="time"
        step={60}
        value={time}
        disabled={!day}
        onChange={(e) => update(day, e.target.value)}
        className="w-30"
        aria-label="Send at"
      />
    </div>
  );
}
