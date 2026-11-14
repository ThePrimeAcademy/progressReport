// app/AppHeader.jsx
// The sticky page header: the brand, the three sections as a segmented
// switch, the ClassMarker sync status, and - underneath - the pages of the
// current section as underlined tabs. Everything is a plain #hash link, so a
// page can be bookmarked or opened in a new tab.
import React from 'react';
import { LuGraduationCap } from 'react-icons/lu';
import { cn } from '@/lib/utils';
import SyncStatus from '@/components/common/SyncStatus';
import { SECTIONS } from './sections';

const focusRing = 'outline-none focus-visible:ring-[3px] focus-visible:ring-ring/50';

export default function AppHeader({ page, sectionTargets }) {
  const section = page.section;

  return (
    // Solid, not frosted: colored notices scrolling underneath showed through
    // a translucent header as smudges.
    <header className="sticky top-0 z-40 border-b bg-background">
      <div className="mx-auto grid h-14 w-full max-w-6xl grid-cols-[auto_1fr_auto] items-center gap-3 px-4 sm:grid-cols-[1fr_auto_1fr] sm:px-6">
        <a
          href={`#${SECTIONS[0].pages[0].id}`}
          className={cn('flex items-center gap-2.5 justify-self-start rounded-md', focusRing)}
          aria-label="ProgressReport - students"
        >
          <span className="flex size-8 items-center justify-center rounded-lg bg-primary text-primary-foreground">
            <LuGraduationCap className="size-[18px]" aria-hidden="true" />
          </span>
          <span className="hidden text-[15px] font-semibold tracking-tight sm:inline">ProgressReport</span>
        </a>

        <nav aria-label="Sections" className="justify-self-center">
          <div className="inline-flex items-center gap-0.5 rounded-lg bg-muted p-[3px]">
            {SECTIONS.map((s) => {
              const active = s.id === section.id;
              return (
                <a
                  key={s.id}
                  href={`#${sectionTargets[s.id] || s.pages[0].id}`}
                  aria-current={active ? 'true' : undefined}
                  className={cn(
                    'inline-flex h-8 items-center gap-2 rounded-md px-3 text-sm font-medium whitespace-nowrap transition-all',
                    focusRing,
                    active
                      ? 'bg-primary text-primary-foreground shadow-sm'
                      : 'text-foreground/60 hover:text-foreground'
                  )}
                >
                  <s.icon className="hidden size-4 sm:block" aria-hidden="true" />
                  {s.label}
                </a>
              );
            })}
          </div>
        </nav>

        <div className="justify-self-end">
          <SyncStatus />
        </div>
      </div>

      <div className="mx-auto w-full max-w-6xl px-4 sm:px-6">
        <nav aria-label={`${section.label} pages`} className="-mb-px flex gap-6 overflow-x-auto">
          {section.pages.map((p) => {
            const active = p.id === page.id;
            return (
              <a
                key={p.id}
                href={`#${p.id}`}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'relative inline-flex h-11 shrink-0 items-center gap-2 rounded-sm text-sm font-medium whitespace-nowrap transition-colors',
                  'after:absolute after:inset-x-0 after:bottom-0 after:h-0.5 after:rounded-full after:transition-colors',
                  focusRing,
                  active
                    ? 'text-primary after:bg-primary'
                    : 'text-muted-foreground after:bg-transparent hover:text-foreground'
                )}
              >
                <p.icon className="hidden size-4 sm:block" aria-hidden="true" />
                {p.label}
              </a>
            );
          })}
        </nav>
      </div>
    </header>
  );
}
