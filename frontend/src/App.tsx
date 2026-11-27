import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider } from './auth/AuthProvider'
import { useAuth } from './auth/use-auth'
import AuthIdleGuard from './auth/AuthIdleGuard'
import AuthRecoveryScreen from './components/AuthRecoveryScreen'
import GlobalApiErrorBanner from './components/GlobalApiErrorBanner'
import SessionNoticeBanner from './components/SessionNoticeBanner'
import DashboardLayout from './components/DashboardLayout'
import PlatformLayout from './components/PlatformLayout'
import ProtectedRoute, {
  AssessmentRecordsRoute,
  ClassTeacherRoute,
  FullSchoolMemberRoute,
  PlatformProtectedRoute,
  SchoolAdminRoute,
  SubjectTeacherRoute,
  TeacherRoute,
} from './components/ProtectedRoute'
import BillingPage from './pages/dashboard/BillingPage'
import CalendarPage from './pages/dashboard/CalendarPage'
import ClassesPage from './pages/dashboard/ClassesPage'
import AttendancePage from './pages/dashboard/AttendancePage'
import AttitudePage from './pages/dashboard/AttitudePage'
import DashboardOverviewPage from './pages/dashboard/DashboardOverviewPage'
import PupilsPage from './pages/dashboard/PupilsPage'
import PupilDuplicatesPage from './pages/dashboard/PupilDuplicatesPage'
import TeacherRemarksPage from './pages/dashboard/TeacherRemarksPage'
import ReportCardPage from './pages/dashboard/ReportCardPage'
import ReportsPage from './pages/dashboard/ReportsPage'
import ResultReviewPage from './pages/dashboard/ResultReviewPage'
import SchoolProfilePage from './pages/dashboard/SchoolProfilePage'
import ScoreEntryPage from './pages/dashboard/ScoreEntryPage'
import SubmissionsPage from './pages/dashboard/SubmissionsPage'
import TeachersPage from './pages/dashboard/TeachersPage'
import LoginPage from './pages/LoginPage'
import NotFoundPage from './pages/NotFoundPage'
import PlaceholderPage from './pages/PlaceholderPage'
import PlatformAccountPage from './pages/platform/PlatformAccountPage'
import PlatformAuditPage from './pages/platform/PlatformAuditPage'
import PlatformAccountsPage from './pages/platform/PlatformAccountsPage'
import PlatformDeletedAccountsPage from './pages/platform/PlatformDeletedAccountsPage'
import PlatformBillingPage from './pages/platform/PlatformBillingPage'
import PlatformCalendarPage from './pages/platform/PlatformCalendarPage'
import PlatformExportsPage from './pages/platform/PlatformExportsPage'
import PlatformHealthPage from './pages/platform/PlatformHealthPage'
import PlatformMonitoringPage from './pages/platform/PlatformMonitoringPage'
import PlatformNotificationsPage from './pages/platform/PlatformNotificationsPage'
import PlatformOverviewPage from './pages/platform/PlatformOverviewPage'
import PlatformReconciliationPage from './pages/platform/PlatformReconciliationPage'
import PlatformReportsPage from './pages/platform/PlatformReportsPage'
import PlatformSchoolsPage from './pages/platform/PlatformSchoolsPage'
import PlatformSecurityPage from './pages/platform/PlatformSecurityPage'
import PlatformSettingsPage from './pages/platform/PlatformSettingsPage'
import RegisterSchoolPage from './pages/RegisterSchoolPage'
import AccessCodePage from './pages/AccessCodePage'
import ChangePasswordPage from './pages/ChangePasswordPage'
import VerifyEmailPage from './pages/VerifyEmailPage'
import ForgotPasswordPage from './pages/ForgotPasswordPage'
import ResetPasswordPage from './pages/ResetPasswordPage'
import SchoolSessionSettingsPage from './pages/dashboard/SchoolSessionSettingsPage'
import { SchoolProvider } from './schools/SchoolProvider'

function AppContent() {
  const { status, refresh } = useAuth()

  if (status === 'error') {
    return (
      <>
        <AuthRecoveryScreen
          message="We could not load your account because Wise Grade could not reach the server. Check your internet connection and try again."
          onRetry={refresh}
        />
        <GlobalApiErrorBanner />
        <AuthIdleGuard />
      </>
    )
  }

  return (
    <>
      <SessionNoticeBanner />
      <Routes>
          <Route path="/" element={<PlaceholderPage />} />
          <Route path="/login" element={<LoginPage />} />
          <Route path="/access-code" element={<AccessCodePage />} />
          <Route path="/verify-email" element={<VerifyEmailPage />} />
          <Route path="/change-password" element={<ChangePasswordPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/register" element={<RegisterSchoolPage />} />
          <Route
            path="/dashboard"
            element={
              <ProtectedRoute>
                <SchoolProvider>
                  <DashboardLayout />
                </SchoolProvider>
              </ProtectedRoute>
            }
          >
            <Route index element={<DashboardOverviewPage />} />
            <Route
              path="school"
              element={
                <SchoolAdminRoute>
                  <SchoolProfilePage />
                </SchoolAdminRoute>
              }
            />
            <Route
              path="session-settings"
              element={
                <SchoolAdminRoute>
                  <SchoolSessionSettingsPage />
                </SchoolAdminRoute>
              }
            />
            <Route
              path="academics"
              element={<Navigate to="/dashboard/calendar" replace />}
            />
            <Route
              path="calendar"
              element={
                <FullSchoolMemberRoute>
                  <CalendarPage />
                </FullSchoolMemberRoute>
              }
            />
            <Route
              path="classes"
              element={
                <SubjectTeacherRoute>
                  <ClassesPage />
                </SubjectTeacherRoute>
              }
            />
            <Route
              path="pupils"
              element={
                <ClassTeacherRoute>
                  <PupilsPage />
                </ClassTeacherRoute>
              }
            />
            <Route
              path="pupil-duplicates"
              element={
                <SchoolAdminRoute>
                  <PupilDuplicatesPage />
                </SchoolAdminRoute>
              }
            />
            <Route
              path="attendance"
              element={
                <ClassTeacherRoute>
                  <AttendancePage />
                </ClassTeacherRoute>
              }
            />
            <Route
              path="teacher-remarks"
              element={
                <ClassTeacherRoute>
                  <TeacherRemarksPage />
                </ClassTeacherRoute>
              }
            />
            <Route
              path="attitude"
              element={
                <ClassTeacherRoute>
                  <AttitudePage />
                </ClassTeacherRoute>
              }
            />
            <Route
              path="teachers"
              element={
                <SchoolAdminRoute>
                  <TeachersPage />
                </SchoolAdminRoute>
              }
            />
            <Route
              path="billing"
              element={
                <SchoolAdminRoute>
                  <BillingPage />
                </SchoolAdminRoute>
              }
            />
            <Route
              path="assessments/scores"
              element={
                <TeacherRoute>
                  <ScoreEntryPage />
                </TeacherRoute>
              }
            />
            <Route
              path="assessments/submissions"
              element={
                <AssessmentRecordsRoute>
                  <SubmissionsPage />
                </AssessmentRecordsRoute>
              }
            />
            <Route
              path="assessments/review"
              element={
                <SchoolAdminRoute>
                  <ResultReviewPage />
                </SchoolAdminRoute>
              }
            />
            <Route
              path="reports"
              element={
                <SchoolAdminRoute>
                  <ReportsPage />
                </SchoolAdminRoute>
              }
            />
            <Route
              path="reports/cards/:cardId"
              element={
                <SchoolAdminRoute>
                  <ReportCardPage />
                </SchoolAdminRoute>
              }
            />
          </Route>
          <Route
            path="/platform"
            element={
              <PlatformProtectedRoute>
                <PlatformLayout />
              </PlatformProtectedRoute>
            }
          >
            <Route index element={<PlatformOverviewPage />} />
            <Route path="schools" element={<PlatformSchoolsPage />} />
            <Route path="accounts" element={<PlatformAccountsPage />} />
            <Route
              path="accounts/deleted"
              element={<PlatformDeletedAccountsPage />}
            />
            <Route path="monitoring" element={<PlatformMonitoringPage />} />
            <Route path="health" element={<PlatformHealthPage />} />
            <Route path="notifications" element={<PlatformNotificationsPage />} />
            <Route path="billing" element={<PlatformBillingPage />} />
            <Route path="reconciliation" element={<PlatformReconciliationPage />} />
            <Route path="calendar" element={<PlatformCalendarPage />} />
            <Route path="reports" element={<PlatformReportsPage />} />
            <Route path="settings" element={<PlatformSettingsPage />} />
            <Route path="security" element={<PlatformSecurityPage />} />
            <Route path="exports" element={<PlatformExportsPage />} />
            <Route path="audit" element={<PlatformAuditPage />} />
            <Route path="account" element={<PlatformAccountPage />} />
          </Route>
          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      <GlobalApiErrorBanner />
      <AuthIdleGuard />
    </>
  )
}

export default function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </BrowserRouter>
  )
}
