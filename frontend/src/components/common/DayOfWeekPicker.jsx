// components/common/DayOfWeekPicker.jsx
// Limit a report to tests taken on certain weekdays. value is a list of day
// numbers as strings ('0' = Sunday … '6' = Saturday); empty means any day.
import React from 'react';
import { Button } from '@/components/ui/button';
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group';

const DAYS = [
  { value: '1', label: 'Mon', name: 'Monday' },
  { value: '2', label: 'Tue', name: 'Tuesday' },
  { value: '3', label: 'Wed', name: 'Wednesday' },
  { value: '4', label: 'Thu', name: 'Thursday' },
  { value: '5', label: 'Fri', name: 'Friday' },
  { value: '6', label: 'Sat', name: 'Saturday' },
  { value: '0', label: 'Sun', name: 'Sunday' },
];

export default function DayOfWeekPicker({ id, value = [], onChange }) {
  const anyDay = value.length === 0;
  return (
    <div id={id} className="flex flex-wrap items-center gap-2">
      <Button
        type="button"
        size="sm"
        variant={anyDay ? 'secondary' : 'outline'}
        aria-pressed={anyDay}
        onClick={() => onChange([])}
      >
        Any day
      </Button>
      <ToggleGroup
        type="multiple"
        variant="outline"
        size="sm"
        spacing={0}
        value={value}
        onValueChange={onChange}
        aria-label="Days of the week"
      >
        {DAYS.map((day) => (
          <ToggleGroupItem key={day.value} value={day.value} aria-label={day.name} className="w-11">
            {day.label}
          </ToggleGroupItem>
        ))}
      </ToggleGroup>
    </div>
  );
}
