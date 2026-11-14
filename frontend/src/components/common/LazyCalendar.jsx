// components/common/LazyCalendar.jsx
// The calendar (react-day-picker and the date-fns it uses, ~90 KB) is only
// needed once a date picker opens, so it loads then instead of with the first
// page. The shell also preloads it when the browser is idle, so in practice it
// is ready before anyone opens a picker.
import React, { Suspense, lazy } from 'react';
import { Spinner } from '@/components/ui/spinner';

const loadCalendar = () => import('@/components/ui/calendar');
const Calendar = lazy(() => loadCalendar().then((module) => ({ default: module.Calendar })));

export function preloadCalendar() {
  return loadCalendar();
}

export default function LazyCalendar(props) {
  return (
    <Suspense
      fallback={(
        <div className="grid h-72 w-64 place-items-center text-muted-foreground" aria-busy="true">
          <Spinner />
        </div>
      )}
    >
      <Calendar {...props} />
    </Suspense>
  );
}
