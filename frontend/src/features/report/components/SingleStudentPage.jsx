// features/report/components/SingleStudentPage.jsx
// The Single Student page: choose a student, a date range and (optionally)
// weekdays, preview the report, then download or email it. All state lives
// in useGenerateReport (passed in as `report`) so the Students page can open
// a student here and preview straight away.
import React from 'react';
import { LuEye } from 'react-icons/lu';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardFooter, CardHeader, CardTitle } from '@/components/ui/card';
import { Field, FieldDescription, FieldLabel } from '@/components/ui/field';
import { Spinner } from '@/components/ui/spinner';
import { Notice } from '@/components/common/Notice';
import DateRangePicker from '@/components/common/DateRangePicker';
import DayOfWeekPicker from '@/components/common/DayOfWeekPicker';
import StudentCombobox from '@/components/common/StudentCombobox';
import ReportViewer from './ReportViewer.jsx';

export default function SingleStudentPage({ report }) {
  const {
    students, studentsLoading, studentsError,
    selectedStudentId, setSelectedStudentId,
    startDate, setStartDate,
    endDate, setEndDate,
    dayOfWeek, setDayOfWeek,
    previewData, previewLoading, previewError,
    handlePreview, isValid,
  } = report;

  return (
    <div className="grid gap-6">
      <Card>
        <CardHeader>
          <CardTitle>Report settings</CardTitle>
          <CardDescription>The report covers tests finished between these dates.</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-5">
          <div className="grid gap-5 md:grid-cols-2">
            <Field>
              <FieldLabel htmlFor="single-student">Student</FieldLabel>
              <StudentCombobox
                id="single-student"
                students={students}
                value={selectedStudentId}
                onChange={setSelectedStudentId}
                disabled={studentsLoading}
                placeholder={studentsLoading ? 'Loading students…' : 'Select a student'}
              />
              {studentsError && <FieldDescription className="text-destructive">{studentsError}</FieldDescription>}
            </Field>
            <Field>
              <FieldLabel htmlFor="single-dates">Dates</FieldLabel>
              <DateRangePicker
                id="single-dates"
                startDate={startDate}
                endDate={endDate}
                onStartChange={setStartDate}
                onEndChange={setEndDate}
              />
            </Field>
          </div>
          <Field>
            <FieldLabel htmlFor="single-days">Day of week</FieldLabel>
            <DayOfWeekPicker id="single-days" value={dayOfWeek} onChange={setDayOfWeek} />
            <FieldDescription>Only count tests taken on these days, e.g. the Saturday class.</FieldDescription>
          </Field>
        </CardContent>
        <CardFooter className="flex-col items-stretch gap-4 border-t sm:flex-row sm:items-center">
          <Button onClick={handlePreview} disabled={!isValid || previewLoading} className="sm:w-auto">
            {previewLoading ? <Spinner data-icon="inline-start" /> : <LuEye data-icon="inline-start" />}
            {previewLoading ? 'Loading results…' : 'View report'}
          </Button>
          {!selectedStudentId && !studentsLoading && (
            <span className="text-sm text-muted-foreground">Choose a student to see their report.</span>
          )}
        </CardFooter>
      </Card>

      {previewError && <Notice variant="destructive" title="The report could not be loaded">{previewError}</Notice>}

      {previewData && (
        <ReportViewer
          data={previewData}
          onDownload={report.handleDownload}
          downloadLoading={report.downloadLoading}
          downloadError={report.downloadError}
          downloadSuccess={report.downloadSuccess}
          homework={report.homework}
          onHomeworkChange={report.setHomework}
          contacts={report.contacts}
          onContactsChange={report.updateContacts}
          onSaveContacts={report.saveContacts}
          onSendEmail={report.handleEmail}
          emailConfigured={report.emailConfigured}
          emailLoading={report.emailLoading}
          emailError={report.emailError}
          emailSuccess={report.emailSuccess}
          emailSubject={report.emailSubject}
          onEmailSubjectChange={report.setEmailSubject}
        />
      )}
    </div>
  );
}
