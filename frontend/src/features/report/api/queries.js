// features/report/api/queries.js
// Data several tabs share - the student directory, saved contacts, programs,
// exams - is fetched once and cached for the whole session (React Query), so
// switching tabs costs no requests. None of these requests reach ClassMarker:
// the server answers from its own cache.
//
// After changing something on the server, invalidate its key (or write the new
// value with setQueryData) and every screen showing it updates.
import { useCallback, useMemo } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import {
  fetchDirectory,
  fetchAllContacts,
  fetchPrograms,
  fetchEmailStatus,
  fetchExams,
  fetchAvailableTests,
  fetchSheetLibrary,
} from './reportApi.js';

export const queryKeys = {
  directory: ['directory'],
  contacts: ['contacts'],
  programs: ['programs'],
  emailStatus: ['email-status'],
  exams: ['exams'],
  availableTests: ['available-tests'],
  sheetLibrary: ['sheet-library'],
};

const EMPTY_LIST = [];
const EMPTY_MAP = {};

// { students, groups, sync } - see fetchDirectory.
export function useDirectory() {
  return useQuery({ queryKey: queryKeys.directory, queryFn: fetchDirectory });
}

// Every student, sorted by name (empty while loading).
export function useStudents() {
  const query = useDirectory();
  return { ...query, students: query.data?.students ?? EMPTY_LIST };
}

// id → student, for resolving the ids programs and groups store.
export function useStudentsById() {
  const { students } = useStudents();
  return useMemo(() => new Map(students.map((st) => [String(st.id), st])), [students]);
}

// { [studentId]: { studentEmail, parentEmail } } for students with saved contacts.
export function useContacts() {
  const query = useQuery({ queryKey: queryKeys.contacts, queryFn: fetchAllContacts });
  return { ...query, contacts: query.data ?? EMPTY_MAP };
}

// Record contacts the server has just saved, without refetching the map.
export function useNoteContactsSaved() {
  const queryClient = useQueryClient();
  return useCallback((studentId, saved) => {
    if (!studentId) return;
    queryClient.setQueryData(queryKeys.contacts, (prev) => ({
      ...(prev || {}),
      [String(studentId)]: {
        studentEmail: saved?.studentEmail || '',
        parentEmail: saved?.parentEmail || '',
      },
    }));
  }, [queryClient]);
}

export function usePrograms() {
  const query = useQuery({ queryKey: queryKeys.programs, queryFn: fetchPrograms });
  return { ...query, programs: query.data ?? EMPTY_LIST };
}

// Whether the server can send email at all; it doesn't change while the page is open.
export function useEmailConfigured() {
  const query = useQuery({ queryKey: queryKeys.emailStatus, queryFn: fetchEmailStatus, staleTime: Infinity });
  return Boolean(query.data?.configured);
}

export function useExams() {
  const query = useQuery({ queryKey: queryKeys.exams, queryFn: fetchExams });
  return { ...query, exams: query.data ?? EMPTY_LIST };
}

export function useAvailableTests() {
  const query = useQuery({ queryKey: queryKeys.availableTests, queryFn: fetchAvailableTests });
  return { ...query, tests: query.data ?? EMPTY_LIST };
}

export function useSheetLibrary() {
  return useQuery({ queryKey: queryKeys.sheetLibrary, queryFn: fetchSheetLibrary });
}
