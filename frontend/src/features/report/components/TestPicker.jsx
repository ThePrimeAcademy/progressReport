// features/report/components/TestPicker.jsx
// Choose the ClassMarker test behind one DSAT section: a searchable list with
// the tests grouped under the ClassMarker group(s) they were taken in. A test
// linked to several groups is listed under each of them.
//
//   <TestPicker tests={…} value={testId} onChange={(testId) => …}>
//     <button>…the trigger…</button>
//   </TestPicker>
//
// `value` / onChange use the test id ('' for no test). Inside a Dialog pass
// `modal` so the list can be scrolled with the mouse wheel.
import React, { useMemo, useState } from 'react';
import { Command, CommandEmpty, CommandGroup, CommandInput, CommandItem, CommandList } from '@/components/ui/command';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';

const NO_GROUP = 'Other tests';

const words = (text) => String(text || '').toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

// Each typed word must start a word of the test's name or group, so "test 6"
// finds Test 6 but not every test of a "2026" group. Matches on the test name
// rank above those that need the group name.
function matchTest(value, search) {
  const typed = words(search);
  if (typed.length === 0) return 1;
  const [group = '', , name = ''] = value.split('::');
  const nameWords = words(name);
  const found = (pool) => typed.every((t) => pool.some((w) => w.startsWith(t)));
  if (found(nameWords)) return 1;
  return found(nameWords.concat(words(group))) ? 0.5 : 0;
}

// Every ClassMarker group a test was taken under, by name.
export function testGroupNames(test) {
  const names = new Set();
  for (const g of test.groups || []) if (g.groupName) names.add(g.groupName);
  if (test.groupName) names.add(test.groupName);
  return [...names];
}

function groupTests(tests) {
  const byGroup = new Map();
  for (const test of tests) {
    const names = testGroupNames(test);
    for (const name of names.length ? names : [NO_GROUP]) {
      if (!byGroup.has(name)) byGroup.set(name, []);
      byGroup.get(name).push(test);
    }
  }
  return [...byGroup.entries()].sort(([a], [b]) => (a === NO_GROUP) - (b === NO_GROUP) || a.localeCompare(b));
}

export default function TestPicker({ tests, value, onChange, modal = false, align = 'start', children }) {
  const [open, setOpen] = useState(false);
  const groups = useMemo(() => groupTests(tests), [tests]);

  function pick(testId) {
    setOpen(false);
    if (String(testId || '') !== String(value || '')) onChange(testId);
  }

  return (
    <Popover open={open} onOpenChange={setOpen} modal={modal}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent className="w-96 max-w-[calc(100vw-2rem)] p-0" align={align} collisionPadding={16}>
        <Command filter={matchTest}>
          <CommandInput placeholder="Search tests or groups…" />
          <CommandList className="max-h-80">
            <CommandEmpty>No test matches.</CommandEmpty>
            <CommandGroup>
              <CommandItem value="No test::none::No test" data-checked={!value} onSelect={() => pick('')}>
                <span className="text-muted-foreground">No test</span>
              </CommandItem>
            </CommandGroup>
            {groups.map(([groupName, list]) => (
              <CommandGroup key={groupName} heading={groupName}>
                {list.map((test) => (
                  <CommandItem
                    key={`${groupName}::${test.testId}`}
                    value={`${groupName}::${test.testId}::${test.testName}`}
                    data-checked={String(test.testId) === String(value)}
                    onSelect={() => pick(String(test.testId))}
                  >
                    <span className="min-w-0 flex-1 truncate">{test.testName}</span>
                    <span className="shrink-0 text-xs text-muted-foreground tabular-nums">
                      {test.attempts} attempt{test.attempts === 1 ? '' : 's'}
                    </span>
                  </CommandItem>
                ))}
              </CommandGroup>
            ))}
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
