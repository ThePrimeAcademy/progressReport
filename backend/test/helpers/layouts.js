// Spreadsheet layouts the scoring-sheet importer has to read, built from a
// fixture curve so tests never depend on a real (possibly private) sheet.

// The three level scores used for one raw score: Easy the lower end of the
// fixture's range, Hard the upper end, Medium in between. Each column rises
// with the raw score, like a real sheet.
const LEVEL_SCORES = {
  Easy: (p) => p.lower,
  Medium: (p) => Math.round((p.lower + p.upper) / 20) * 10,
  Hard: (p) => p.upper,
};

// One table per level printed side by side, each with its own raw column and
// a blank column between tables - the layout of the "DSAT Math Scoring Sheet"
// template:
//   Math              Math              Math
//   Easy              Medium            Hard
//   Raw Score Score   Raw Score Score   Raw Score Score
// The subject and level titles are merged across each table in Excel, which
// leaves their text in the left-most cell, above the raw column.
function levelTablesGrid(points, subject = 'Math') {
  const levels = Object.keys(LEVEL_SCORES);
  const across = (cells) => levels.flatMap((level, i) => [...(i ? [null] : []), ...cells(level)]);
  return [
    across(() => [subject, null]),
    across((level) => [level, null]),
    across(() => ['Raw Score', 'Score']),
    ...points.map((p) => across((level) => [p.raw, LEVEL_SCORES[level](p)])),
  ];
}

module.exports = { LEVEL_SCORES, levelTablesGrid };
