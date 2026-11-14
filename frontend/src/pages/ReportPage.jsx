// pages/ReportPage.jsx
// The app shell: header navigation, the current page's heading, and the page
// itself. Which page shows is the URL hash (see app/sections.js).
import React, { Suspense, lazy, useState, useEffect, useCallback, useRef } from 'react';
import AppHeader from '@/app/AppHeader';
import { pageById } from '@/app/sections';
import ErrorBoundary from '@/components/ui/ErrorBoundary';
import { Skeleton } from '@/components/ui/skeleton';
import { preloadCalendar } from '@/components/common/LazyCalendar';
import { useGenerateReport } from '../features/report/hooks/useGenerateReport.js';
import StudentDirectory from '../features/report/components/StudentDirectory.jsx';

// Every page but the first one people see is its own bundle, fetched in the
// background once the app is idle - so the first load is smaller and later
// page switches are still instant.
const loaders = {
  single: () => import('../features/report/components/SingleStudentPage.jsx'),
  bulk: () => import('../features/report/components/BulkSendPanel.jsx'),
  queue: () => import('../features/report/components/ScheduledQueuePanel.jsx'),
  programs: () => import('../features/report/components/ExamManager.jsx'),
  sheets: () => import('../features/report/components/ScoringSheetLibrary.jsx'),
  email: () => import('../features/report/components/ComposeEmailPanel.jsx'),
  log: () => import('../features/report/components/SentLogPanel.jsx'),
  calendar: preloadCalendar,
};
const SingleStudentPage = lazy(loaders.single);
const BulkSendPanel = lazy(loaders.bulk);
const ScheduledQueuePanel = lazy(loaders.queue);
const ExamManager = lazy(loaders.programs);
const ScoringSheetLibrary = lazy(loaders.sheets);
const ComposeEmailPanel = lazy(loaders.email);
const SentLogPanel = lazy(loaders.log);

function usePrefetchPages() {
  useEffect(() => {
    const prefetch = () => Object.values(loaders).forEach((load) => load().catch(() => {}));
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(prefetch, { timeout: 3000 });
      return () => window.cancelIdleCallback(id);
    }
    const timer = setTimeout(prefetch, 1500);
    return () => clearTimeout(timer);
  }, []);
}

function PageFallback() {
  return (
    <div className="grid gap-4" aria-busy="true" aria-label="Loading">
      <Skeleton className="h-40 w-full rounded-xl" />
      <Skeleton className="h-64 w-full rounded-xl" />
    </div>
  );
}

const pageFromHash = () => pageById(window.location.hash.replace(/^#/, ''));

export default function ReportPage() {
  const report = useGenerateReport();
  const {
    startDate, setStartDate,
    endDate, setEndDate,
    dayOfWeek, setDayOfWeek,
    setSelectedStudentId,
    previewData, isValid, handlePreview,
  } = report;

  usePrefetchPages();
  const [page, setPage] = useState(pageFromHash);
  // The page last open in each section, so switching sections returns there.
  const [sectionTargets, setSectionTargets] = useState({});
  useEffect(() => {
    const onHashChange = () => setPage(pageFromHash());
    window.addEventListener('hashchange', onHashChange);
    return () => window.removeEventListener('hashchange', onHashChange);
  }, []);
  useEffect(() => {
    setSectionTargets((prev) => (prev[page.section.id] === page.id ? prev : { ...prev, [page.section.id]: page.id }));
    document.title = `${page.label} · ProgressReport`;
    window.scrollTo({ top: 0 });
  }, [page]);

  const goTo = useCallback((id) => {
    if (window.location.hash.replace(/^#/, '') === id) setPage(pageById(id));
    else window.location.hash = id;
  }, []);

  // Set when programs, exams or scoring sheets change on their own pages. The
  // report on the Single Student page is then out of date, so it is re-run the
  // next time that page is opened.
  const scoringChanged = useRef(false);
  const noteScoringChanged = useCallback(() => { scoringChanged.current = true; }, []);
  const openSheets = useCallback(() => goTo('sheets'), [goTo]);
  // Bumped after a successful schedule so the queue panel refetches immediately.
  const [queueRefresh, setQueueRefresh] = useState(0);
  // Set by the Students page's "View report": preview automatically once the
  // chosen student has reached the Single Student page.
  const [autoPreview, setAutoPreview] = useState(false);

  useEffect(() => {
    if (autoPreview && isValid) {
      setAutoPreview(false);
      handlePreview();
    }
  }, [autoPreview, isValid, handlePreview]);

  useEffect(() => {
    if (page.id === 'single' && scoringChanged.current) {
      scoringChanged.current = false;
      if (previewData && isValid) handlePreview();
    }
    // Only opening the page should trigger this, not every preview update.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page.id]);

  const dateProps = { startDate, endDate, onStartDate: setStartDate, onEndDate: setEndDate };

  return (
    <div className="flex min-h-svh flex-col">
      <AppHeader page={page} sectionTargets={sectionTargets} />

      <main className="mx-auto w-full max-w-6xl flex-1 px-4 pt-8 pb-16 sm:px-6">
        <div className="mb-6 space-y-1">
          <h1 className="text-2xl font-semibold tracking-tight">{page.title}</h1>
          <p className="text-sm text-muted-foreground">{page.description}</p>
        </div>

        <ErrorBoundary resetKey={page.id}>
          <Suspense fallback={<PageFallback />}>
          {page.id === 'directory' && (
            <StudentDirectory
              {...dateProps}
              dayOfWeek={dayOfWeek}
              onViewReport={(studentId) => {
                setSelectedStudentId(studentId);
                goTo('single');
                setAutoPreview(true);
              }}
            />
          )}

          {page.id === 'single' && <SingleStudentPage report={report} />}

          {page.id === 'programs' && (
            <ExamManager onExamsChanged={noteScoringChanged} onOpenSheets={openSheets} />
          )}

          {page.id === 'sheets' && <ScoringSheetLibrary onChanged={noteScoringChanged} />}

          {page.id === 'bulk' && (
            <div className="space-y-6">
              <BulkSendPanel
                {...dateProps}
                dayOfWeek={dayOfWeek}
                onDayOfWeek={setDayOfWeek}
                onScheduled={() => setQueueRefresh((n) => n + 1)}
              />
              <ScheduledQueuePanel refreshSignal={queueRefresh} />
            </div>
          )}

          {page.id === 'email' && (
            <ComposeEmailPanel {...dateProps} dayOfWeek={dayOfWeek} />
          )}

          {page.id === 'log' && <SentLogPanel />}
          </Suspense>
        </ErrorBoundary>
      </main>
    </div>
  );
}
