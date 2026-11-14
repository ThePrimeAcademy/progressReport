// app/sections.js
// The app's navigation: three sections in the header, each with its own pages
// shown as tabs underneath. A page's `id` doubles as the URL hash (#directory,
// #bulk, …), so a refresh or a bookmark lands on the same page - these ids
// are the same as before the sections existed, so old bookmarks still work.
import {
  LuFileChartColumn,
  LuHistory,
  LuLayers,
  LuMail,
  LuSend,
  LuSheet,
  LuSquarePen,
  LuUser,
  LuUsers,
  LuBookOpen,
} from 'react-icons/lu';

export const SECTIONS = [
  {
    id: 'reports',
    label: 'Reports',
    icon: LuFileChartColumn,
    pages: [
      {
        id: 'directory',
        label: 'Students',
        icon: LuUsers,
        title: 'Students',
        description: 'Pick a group or program to list its students, then view or email any student’s report.',
      },
      {
        id: 'single',
        label: 'Single student',
        icon: LuUser,
        title: 'Student report',
        description: 'Choose a student and a date range to preview their report, download the PDF or email it.',
      },
    ],
  },
  {
    id: 'programs',
    label: 'Programs',
    icon: LuLayers,
    pages: [
      {
        id: 'programs',
        label: 'Programs & exams',
        icon: LuBookOpen,
        title: 'Programs & exams',
        description: 'Group exams into programs, enroll students, and choose the scoring sheet each exam uses.',
      },
      {
        id: 'sheets',
        label: 'Scoring sheets',
        icon: LuSheet,
        title: 'Scoring sheets',
        description: 'Three shared sheets per subject - Easy, Medium and Hard. Each exam is graded with one English and one Math sheet.',
      },
    ],
  },
  {
    id: 'email',
    label: 'Email',
    icon: LuMail,
    pages: [
      {
        id: 'bulk',
        label: 'Bulk send',
        icon: LuSend,
        title: 'Send reports',
        description: 'Email progress reports to many students at once, now or at a scheduled time.',
      },
      {
        id: 'email',
        label: 'Compose',
        icon: LuSquarePen,
        title: 'Email families',
        description: 'Write a message to selected students and parents, with or without their report attached.',
      },
      {
        id: 'log',
        label: 'Sent log',
        icon: LuHistory,
        title: 'Sent emails',
        description: 'Every email this system has sent, newest first.',
      },
    ],
  },
];

export const PAGES = SECTIONS.flatMap((section) => section.pages.map((page) => ({ ...page, section })));
export const DEFAULT_PAGE_ID = 'directory';

export function pageById(id) {
  return PAGES.find((page) => page.id === id) || PAGES.find((page) => page.id === DEFAULT_PAGE_ID);
}
