// services/scheduled-email.service.js
// Polls scheduled_batches and delivers due bulk-email batches server-side.
// Bulk sends are scheduled from the UI, but the browser won't be open when
// they fire — so the work runs here on a timer. Each due batch streams its
// students through the same buildAndSendReport pipeline used by the on-demand
// send, with bounded concurrency, persisting per-student status as it goes.
// Started once from server.js via startScheduler().

const db = require('./db.service');
const { buildAndSendReport, buildReportAttachments } = require('./report-delivery.service');
const { sendCustomEmail } = require('./email.service');

const SCHEDULER_INTERVAL_MS = 30 * 1000;
const ITEM_CONCURRENCY = 3;
// Delay the first poll so the DB load + ClassMarker cache warm finishes first.
const INITIAL_DELAY_MS = 5 * 1000;

let _timer = null;
let _initialTimer = null;
let _ticking = false;

function startScheduler() {
  if (_timer) return;
  db.recoverInterruptedBatches().catch((e) => console.error('[scheduler] recover failed:', e.message));
  _timer = setInterval(() => {
    tick().catch((e) => console.error('[scheduler] tick failed:', e.message));
  }, SCHEDULER_INTERVAL_MS);
  _initialTimer = setTimeout(() => {
    tick().catch((e) => console.error('[scheduler] initial tick failed:', e.message));
  }, INITIAL_DELAY_MS);
  console.log(`[scheduler] started — checking every ${SCHEDULER_INTERVAL_MS / 1000}s`);
}

function stopScheduler() {
  if (_timer) { clearInterval(_timer); _timer = null; }
  if (_initialTimer) { clearTimeout(_initialTimer); _initialTimer = null; }
}

// Process every batch whose send time has passed. Never overlaps with itself —
// a long-running batch holds the lock so the next interval is skipped.
async function tick() {
  if (_ticking) return;
  _ticking = true;
  try {
    const due = await db.getDueBatches(new Date().toISOString());
    for (const batch of due) {
      await processBatch(batch);
    }
  } finally {
    _ticking = false;
  }
}

async function processBatch(batch) {
  console.log(`[scheduler] running batch ${batch.id} (${batch.label || 'untitled'})`);
  await db.markBatchStatus(batch.id, 'running', { startedAt: new Date().toISOString() });

  // Only items not already delivered (a resumed batch may have some 'sent').
  const items = (await db.getBatchItems(batch.id)).filter((it) => it.status === 'pending');
  const dayOfWeek = batch.day_of_week ? batch.day_of_week.split(',').map(Number) : undefined;

  let cursor = 0;
  async function worker() {
    while (cursor < items.length) {
      const item = items[cursor++];
      const recipients = [item.student_email, item.parent_email]
        .map((e) => String(e || '').trim())
        .filter(Boolean);

      if (!recipients.length) {
        await db.markItemStatus(item.id, 'skipped', {});
        continue;
      }

      await db.markItemStatus(item.id, 'sending', {});
      try {
        if (batch.kind === 'custom') {
          // Email-tab schedule: send the admin-written message; the report
          // PDF (+ program summary) only rides along when the batch was
          // created with "Attach progress report" checked.
          const attachments = Number(batch.include_report)
            ? await buildReportAttachments({
                studentId: item.student_id,
                startDate: batch.start_date,
                endDate: batch.end_date,
                dayOfWeek,
              })
            : [];
          await sendCustomEmail({
            recipients,
            subject: batch.subject || undefined,
            message: batch.message,
            attachments,
          });
        } else {
          await buildAndSendReport({
            studentId: item.student_id,
            startDate: batch.start_date,
            endDate: batch.end_date,
            dayOfWeek,
            recipients,
            studentEmail: item.student_email,
            parentEmail: item.parent_email,
            subject: batch.subject || undefined,
          });
        }
        await db.markItemStatus(item.id, 'sent', { sentAt: new Date().toISOString() });
      } catch (err) {
        console.error(`[scheduler] batch ${batch.id} item ${item.id} (${item.student_name}) failed:`, err.message);
        await db.markItemStatus(item.id, 'failed', { error: err.message });
      }
    }
  }

  await Promise.all(
    Array.from({ length: Math.min(ITEM_CONCURRENCY, items.length) }, () => worker())
  );

  const finalItems = await db.getBatchItems(batch.id);
  const anyFailed = finalItems.some((it) => it.status === 'failed');
  const sentCount = finalItems.filter((it) => it.status === 'sent').length;
  await db.markBatchStatus(
    batch.id,
    anyFailed ? 'completed_with_errors' : 'completed',
    { finishedAt: new Date().toISOString() }
  );
  console.log(`[scheduler] batch ${batch.id} done — ${sentCount}/${finalItems.length} sent`);
}

module.exports = { startScheduler, stopScheduler, tick };
