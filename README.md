# ProgressReport

Prime Academy's SAT progress reports. It reads test results from ClassMarker, turns raw scores into scaled SAT scores with scoring sheets, and produces a report for each student that can be viewed, downloaded as a PDF, or emailed to the student and their parents.

- **Frontend:** React 18 + Vite, deployed to GitHub Pages on every push to `main` that touches `frontend/`.
- **Backend:** Node + Express, deployed to Railway on every push to `main`. PDFs are rendered with Puppeteer. Data lives on a Railway volume (`DATA_DIR=/data`).

---

## What it does

| Tab | Purpose |
|---|---|
| **Students** | Pick a ClassMarker group or a program, list its students, then view or email any student's report. |
| **Single Student** | Choose a student and a date range, preview the report, download the PDF, or email it. |
| **Programs** | Group exams into programs, enroll students, map each exam's four DSAT sections to ClassMarker tests, and choose the scoring sheet each exam uses. Scoreboard, hidden students and manual raw-score edits live here too. |
| **Scoring Sheets** | The shared Easy / Medium / Hard scoring sheets for English and for Math. |
| **Bulk Send** | Email reports to many students at once, now or at a scheduled time. |
| **Email** | Write a message to selected students and parents, with or without the report attached. |
| **Sent Log** | Every email the system has sent. |

## Scoring sheets

A scoring sheet converts a raw score (number of correct answers) into a scaled section score from 200 to 800.

There are **three shared sheets per subject**: Easy, Medium and Hard, for English (Reading & Writing) and for Math. They are added once on the **Scoring Sheets** tab. On the **Programs** tab every exam then gets one English choice and one Math choice:

| Choice | The exam is graded with |
|---|---|
| Easy / Medium / Hard | the shared sheet of that level |
| Custom | a sheet uploaded just for that exam |

Replacing or editing a shared sheet re-grades every exam that uses it. An exam with no choice, or set to a level whose sheet has not been added yet, shows raw scores only, and reports mark it "Score pending" rather than inventing a score.

Exams created before the shared sheets existed keep their own custom sheets and their exact scores until someone picks a level for them.

### Adding a sheet

Upload an `.xlsx` or `.csv`, or paste the cells straight out of Excel or Google Sheets. The layout does not matter: the importer finds the column counting correct answers (0, 1, 2, ...) and the score column(s) next to it. It handles a title row, merged headers, a long table split into side-by-side blocks, several worksheet tabs, and a "480-520" range written in one cell. You always see a preview of what was read before anything is saved.

- **Several score columns** (for example Easy / Medium / Hard in one file): pick the column to use. When a column or tab is named after the level you are filling, it is preselected.
- **A Lower / Upper range:** both ends are kept, with a switch for which one is used.
- **Problems in the sheet** (a skipped raw score, a score that goes down) are flagged in the preview.

---

## Project structure

```
backend/
  src/
    server.js
    routes/        students, report, exams, programs, scoring-sheets, webhooks
    services/
      classmarker.service.js   results cache for the ClassMarker API
      webhook.service.js       per-question results pushed by ClassMarker webhooks
      db.service.js            SQLite (sql.js) store
      exam.service.js          exams: sections, program, difficulty
      program.service.js       programs and their rosters
      scoring-sheet.service.js storing, reading and applying scoring sheets
      sheet-parser.service.js  finding the score table in any spreadsheet layout
      exam-curve.service.js    which sheet grades which exam
      sat.service.js           section, total and super scores; scoreboards
      pdf.service.js           report and program summary PDFs
      email.service.js         ZeptoMail (HTTPS) or SMTP
    scripts/       python helpers that read .xlsx files
    templates/     report HTML
  scripts/seed-demo.js   made-up data for local development
  test/                  node:test suites
frontend/
  src/pages/ReportPage.jsx        tabs and page shell
  src/features/report/            components, API calls, hooks
```

---

## Running it locally

You need Node 20 or newer and `python3` (used to read `.xlsx` uploads).

```bash
# Install
npm install --prefix backend
npm install --prefix frontend

# Create made-up programs, exams, students and results (no real data, no
# ClassMarker credentials needed). Add `-- --empty-library` to start with no
# shared scoring sheets, or `-- --force` to wipe and reseed.
npm run seed:demo --prefix backend

# Backend on http://localhost:5000
npm run dev --prefix backend

# Frontend on http://localhost:5173/progressReport/, pointed at the local backend
VITE_API_URL=http://localhost:5000/api npm run dev --prefix frontend
```

Without `VITE_API_URL` the frontend talks to the **live** Railway backend, so anything you change there is real.

Without ClassMarker credentials the backend runs offline from whatever is in its data directory, which is what you want for development.

On macOS port 5000 is often taken by AirPlay Receiver; set `PORT=5055` for the backend (and use the same port in `VITE_API_URL`) if the server fails to start.

## Tests

```bash
npm test --prefix backend
```

The suite covers reading scoring sheets in every supported layout, storing and applying them, and the full path from an exam's Easy / Medium / Hard choice to the scores on the scoreboard and the student report. Each test file uses its own temporary data directory and never touches the network. CI runs the tests and the frontend build on every pull request and every push to `main`.

---

## Environment variables (backend)

| Variable | Purpose |
|---|---|
| `PORT` | Port to listen on. Default `5000`. |
| `DATA_DIR` | Where all runtime data is stored. Default `backend/data`. On Railway, mount a volume and set `DATA_DIR=/data`. |
| `CLASSMARKER_API_KEY`, `CLASSMARKER_API_SECRET` | ClassMarker API access. Without them the backend runs offline. |
| `CLASSMARKER_WEBHOOK_SECRET` | Verifies the signature on incoming ClassMarker webhooks. |
| `ZEPTOMAIL_TOKEN` | Sends email over HTTPS. Required on Railway plans that block SMTP ports. |
| `EMAIL_FROM` | Sender, for example `"Prime Academy <admin@primeacademynova.com>"`. |
| `ZOHO_USER`, `ZOHO_APP_PASSWORD`, `SMTP_HOST`, `SMTP_PORT` | SMTP alternative to ZeptoMail. |
| `EXPORT_TOKEN` | Protects the results export endpoint. |

Copy `backend/.env.example` to `backend/.env` for local values. Never commit `.env` or anything under `backend/data/`.

## Deploying

Pushing to `main` deploys both halves: Railway rebuilds the backend from `backend/Dockerfile`, and GitHub Actions publishes the frontend to GitHub Pages. The backend takes a few minutes longer than the frontend, so right after a release that adds API endpoints the new pages can briefly show a "Route not found" message until Railway finishes.

Backend data on the volume is read as-is by newer versions; no migration step is needed.

## Troubleshooting

**`npm install` fails in `backend/` with "browser folder exists but the executable is missing"**
A previous Chrome download was interrupted. Delete `~/.cache/puppeteer/chrome-headless-shell` and install again.

**Puppeteer cannot launch Chrome on Linux**
Install the shared libraries listed in `backend/Dockerfile`.

**Scaled scores are missing for an exam**
Open the exam's scoreboard on the Programs tab: its title says whether no scoring sheet has been chosen or the chosen level has no sheet yet.
