// features/report/components/StudentChecklist.jsx
// A searchable, scrollable grid of students with a checkbox each - the body
// of the enrollment, exam roster and hidden-students dialogs.
//   students: [{ id, name }]   selected: Set of ids   onToggle(id)
import React, { useState } from 'react';
import { LuSearch } from 'react-icons/lu';
import { cn } from '@/lib/utils';
import { Checkbox } from '@/components/ui/checkbox';
import { InputGroup, InputGroupAddon, InputGroupInput } from '@/components/ui/input-group';

export default function StudentChecklist({
  students,
  selected,
  onToggle,
  checkedClassName, // extra classes for a checked row (e.g. hidden students)
  emptyText = 'No students match your search.',
}) {
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const shown = query ? students.filter((st) => st.name.toLowerCase().includes(query)) : students;

  return (
    <div className="grid gap-3">
      <InputGroup>
        <InputGroupAddon>
          <LuSearch aria-hidden="true" />
        </InputGroupAddon>
        <InputGroupInput
          value={search}
          placeholder="Search students"
          aria-label="Search students"
          onChange={(e) => setSearch(e.target.value)}
        />
      </InputGroup>
      <div className="max-h-[min(22rem,45vh)] overflow-y-auto rounded-lg border">
        {shown.length === 0 ? (
          <p className="px-4 py-6 text-center text-sm text-muted-foreground">{emptyText}</p>
        ) : (
          <div className="grid gap-x-3 p-1.5 sm:grid-cols-2">
            {shown.map((st) => {
              const checked = selected.has(st.id);
              return (
                <label
                  key={st.id}
                  className={cn(
                    'flex min-w-0 cursor-pointer items-center gap-2.5 rounded-md px-2.5 py-2 text-sm transition-colors hover:bg-muted/60',
                    checked && checkedClassName
                  )}
                >
                  <Checkbox checked={checked} onCheckedChange={() => onToggle(st.id)} />
                  <span className="truncate">{st.name}</span>
                </label>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
