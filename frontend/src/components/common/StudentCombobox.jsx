// components/common/StudentCombobox.jsx
// Pick one student from a searchable list (by name or email) - quicker than
// scrolling a long dropdown. value / onChange use the student id.
import React, { useState } from 'react';
import { LuChevronsUpDown } from 'react-icons/lu';
import { cn } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

// Every typed word must appear in the name or email ("jo sm" finds John
// Smith). The default fuzzy match also finds names that merely contain the
// letters in order, which reads as noise in a list of people.
export function containsEveryWord(value, search) {
  const haystack = value.toLowerCase();
  return search.toLowerCase().split(/\s+/).filter(Boolean).every((word) => haystack.includes(word)) ? 1 : 0;
}

export default function StudentCombobox({ id, students, value, onChange, disabled, placeholder = 'Select a student' }) {
  const [open, setOpen] = useState(false);
  const selected = students.find((st) => String(st.id) === String(value));

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn('w-full justify-between font-normal', !selected && 'text-muted-foreground')}
        >
          <span className="truncate">{selected ? selected.name : placeholder}</span>
          <LuChevronsUpDown data-icon="inline-end" className="opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-(--radix-popover-trigger-width) min-w-72 p-0" align="start" collisionPadding={16}>
        <Command filter={containsEveryWord}>
          <CommandInput placeholder="Search by name or email…" />
          <CommandList>
            <CommandEmpty>No student matches.</CommandEmpty>
            <CommandGroup>
              {students.map((st) => (
                <CommandItem
                  key={st.id}
                  value={`${st.name} ${st.email || ''} ${st.id}`}
                  data-checked={String(st.id) === String(value)}
                  onSelect={() => {
                    onChange(String(st.id));
                    setOpen(false);
                  }}
                >
                  <span className="min-w-0 flex-1 truncate">{st.name}</span>
                  {st.email && <span className="truncate text-xs text-muted-foreground">{st.email}</span>}
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
