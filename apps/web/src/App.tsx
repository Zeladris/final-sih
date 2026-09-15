import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { DASHBOARD_PATH, FARMER_ACCOUNT_DESTINATION, ROLES } from '@kisansetu/shared';
import { AuthProvider, useAuth } from './auth/AuthProvider.js';
import { I18nProvider, useAdoptProfileLanguage, useI18n } from './i18n/index.js';
import { RequireRole } from './components/guards.js';
import { FullPageSpinner } from './components/Spinner.js';
import { AccountLoadFailed, AccountNotConfigured } from './components/AccountProblem.js';
import { LanguageSelection } from './pages/LanguageSelection.js';
import { LoginPage } from './pages/LoginPage.js';
import { RegistrationLayout } from './registration/RegistrationLayout.js';
import { StartStep } from './registration/StartStep.js';
import { PersonalDetailsStep } from './registration/PersonalDetailsStep.js';
import { AddressStep } from './registration/AddressStep.js';
import { LandStep } from './registration/LandStep.js';
import { DocumentsStep } from './registration/DocumentsStep.js';
import { PhotoStep } from './registration/PhotoStep.js';
import { ReviewStep } from './registration/ReviewStep.js';
import { SubmittedStep } from './registration/SubmittedStep.js';
import { FarmerDashboard } from './pages/farmer/FarmerDashboard.js';
import { FarmerProfile } from './pages/farmer/FarmerProfile.js';
import { VerificationStatus } from './pages/farmer/VerificationStatus.js';
import { WelcomeBack } from './pages/farmer/WelcomeBack.js';
import { FarmerBooking } from './pages/farmer/FarmerBooking.js';
import { FarmerBookings } from './pages/farmer/FarmerBookings.js';
import { FarmerBookingDetails } from './pages/farmer/FarmerBookingDetails.js';
import { FarmerBookingStatus } from './pages/farmer/FarmerBookingStatus.js';
import { FarmerNotifications } from './pages/farmer/FarmerNotifications.js';
import { FarmerSupport } from './pages/farmer/FarmerSupport.js';
import { StaffDashboard } from './pages/staff/StaffDashboard.js';
import { StaffToday } from './pages/staff/StaffToday.js';
import { StaffBookingWorkflow } from './pages/staff/StaffBookingWorkflow.js';
import { StaffSlots } from './pages/staff/StaffSlots.js';
import { StaffQueue } from './pages/staff/StaffQueue.js';
import { StaffPayments, StaffProcurementPayment } from './pages/staff/StaffPayments.js';
import { FarmerPayment } from './pages/farmer/FarmerPayment.js';
import { StaffProfile } from './pages/staff/StaffProfile.js';
import { AdminDashboard } from './pages/admin/AdminDashboard.js';
import { AdminCentreDetail } from './pages/admin/AdminCentreDetail.js';
import { MessageComposer } from './pages/admin/MessageComposer.js';
import { GovernmentSupport } from './pages/admin/GovernmentSupport.js';
import { DistrictVerificationQueuePage } from './pages/admin/DistrictVerificationQueue.js';
import { DistrictVerificationReview } from './pages/admin/DistrictVerificationReview.js';
import { NotFound } from './pages/NotFound.js';

/** URLs of the retired per-role sign-in pages, kept so old links and bookmarks still work. */
const RETIRED_LOGIN_PATHS = [
  '/login',
  '/farmer/login',
  '/farmer/register',
  '/staff/login',
  '/district/login',
  '/state/login',
  '/district-admin/login',
  '/state-admin/login',
] as const;

/**
 * One sign-in page at `/`; the role is decided afterwards, by the server.
 *
 * Each area below is guarded by the role the server reported. Typing another
 * role's URL renders the access-denied screen rather than silently switching
 * the user somewhere they do not belong — and the API refuses that role's data
 * regardless, because every route group is behind `requireRole`.
 */
function AppRoutes(): JSX.Element {
  return (
    <Routes>
      <Route path="/" element={<Landing />} />
      <Route path="/language" element={<LanguageSelection />} />

      {RETIRED_LOGIN_PATHS.map((path) => (
        <Route key={path} path={path} element={<Navigate to="/" replace />} />
      ))}

      {/* Farmer registration flow. The layout loads the registration once and
          shares it with every step, which is what makes resume work. */}
      <Route path="/farmer/registration" element={<RegistrationLayout />}>
        <Route index element={<Navigate to="personal" replace />} />
        <Route path="start" element={<StartStep />} />
        <Route path="personal" element={<PersonalDetailsStep />} />
        <Route path="address" element={<AddressStep />} />
        <Route path="land" element={<LandStep />} />
        <Route path="documents" element={<DocumentsStep />} />
        <Route path="photo" element={<PhotoStep />} />
        <Route path="review" element={<ReviewStep />} />
        <Route path="submitted" element={<SubmittedStep />} />
      </Route>

      {/* Resume screen for a farmer who left registration unfinished (§12). */}
      <Route
        path="/farmer/welcome"
        element={
          <RequireRole role={ROLES.FARMER}>
            <WelcomeBack />
          </RequireRole>
        }
      />

      {/* Booking (Phase 4) */}
      <Route
        path="/farmer/book"
        element={
          <RequireRole role={ROLES.FARMER}>
            <FarmerBooking />
          </RequireRole>
        }
      />
      <Route
        path="/farmer/bookings"
        element={
          <RequireRole role={ROLES.FARMER}>
            <FarmerBookings />
          </RequireRole>
        }
      />
      <Route
        path="/farmer/bookings/:bookingId"
        element={
          <RequireRole role={ROLES.FARMER}>
            <FarmerBookingDetails />
          </RequireRole>
        }
      />
      <Route
        path="/farmer/bookings/:bookingId/payment"
        element={
          <RequireRole role={ROLES.FARMER}>
            <FarmerPayment />
          </RequireRole>
        }
      />
      <Route
        path="/farmer/bookings/:bookingId/status"
        element={
          <RequireRole role={ROLES.FARMER}>
            <FarmerBookingStatus />
          </RequireRole>
        }
      />

      <Route
        path="/farmer/status"
        element={
          <RequireRole role={ROLES.FARMER}>
            <VerificationStatus />
          </RequireRole>
        }
      />

      <Route
        path="/farmer/notifications"
        element={
          <RequireRole role={ROLES.FARMER}>
            <FarmerNotifications />
          </RequireRole>
        }
      />

      {/* The dashboard is the landing page for every farmer who has a
          registration — the verification card adapts to the state rather than
          the page being gated to VERIFIED. It routes an unfinished
          registration onward itself. */}
      <Route
        path="/farmer/dashboard"
        element={
          <RequireRole role={ROLES.FARMER}>
            <FarmerDashboard />
          </RequireRole>
        }
      />

      <Route
        path="/farmer/profile"
        element={
          <RequireRole role={ROLES.FARMER}>
            <FarmerProfile />
          </RequireRole>
        }
      />

      <Route
        path="/farmer/support"
        element={
          <RequireRole role={ROLES.FARMER}>
            <FarmerSupport />
          </RequireRole>
        }
      />

      {/* Bare /farmer resolves through the account state rather than assuming
          a dashboard the farmer may not be entitled to yet. */}
      <Route path="/farmer" element={<Landing />} />

      {/* Centre staff */}
      <Route
        path="/staff/dashboard"
        element={
          <RequireRole role={ROLES.CENTRE_STAFF}>
            <StaffDashboard />
          </RequireRole>
        }
      />
      {/* Procurement operations — the primary staff workflow (§2). */}
      <Route
        path="/staff/today"
        element={
          <RequireRole role={ROLES.CENTRE_STAFF}>
            <StaffToday />
          </RequireRole>
        }
      />
      <Route
        path="/staff/booking/:bookingId"
        element={
          <RequireRole role={ROLES.CENTRE_STAFF}>
            <StaffBookingWorkflow />
          </RequireRole>
        }
      />
      <Route
        path="/staff/payments"
        element={
          <RequireRole role={ROLES.CENTRE_STAFF}>
            <StaffPayments />
          </RequireRole>
        }
      />
      <Route
        path="/staff/procurements/:procurementId/payment"
        element={
          <RequireRole role={ROLES.CENTRE_STAFF}>
            <StaffProcurementPayment />
          </RequireRole>
        }
      />
      <Route
        path="/staff/queue"
        element={
          <RequireRole role={ROLES.CENTRE_STAFF}>
            <StaffQueue />
          </RequireRole>
        }
      />
      <Route
        path="/staff/slots"
        element={
          <RequireRole role={ROLES.CENTRE_STAFF}>
            <StaffSlots />
          </RequireRole>
        }
      />

      <Route
        path="/staff/profile"
        element={
          <RequireRole role={ROLES.CENTRE_STAFF}>
            <StaffProfile />
          </RequireRole>
        }
      />
      <Route path="/staff" element={<Navigate to="/staff/dashboard" replace />} />

      {/* District admin */}
      <Route
        path="/district/dashboard"
        element={
          <RequireRole role={ROLES.DISTRICT_ADMIN}>
            <AdminDashboard />
          </RequireRole>
        }
      />
      <Route path="/district" element={<Navigate to="/district/dashboard" replace />} />

      {/* Farmer verification — the District Admin's alone (Phase 14). */}
      <Route
        path="/district/verification"
        element={
          <RequireRole role={ROLES.DISTRICT_ADMIN}>
            <DistrictVerificationQueuePage />
          </RequireRole>
        }
      />
      <Route
        path="/district/verification/:farmerUserId"
        element={
          <RequireRole role={ROLES.DISTRICT_ADMIN}>
            <DistrictVerificationReview />
          </RequireRole>
        }
      />

      {/* State admin */}
      <Route
        path="/state/dashboard"
        element={
          <RequireRole role={ROLES.STATE_ADMIN}>
            <AdminDashboard />
          </RequireRole>
        }
      />
      <Route path="/state" element={<Navigate to="/state/dashboard" replace />} />
      {/* Phase 12: the spec's role-named paths, and the scope-checked centre drill-down. */}
      <Route path="/district-admin/dashboard" element={<Navigate to="/district/dashboard" replace />} />
      <Route path="/state-admin/dashboard" element={<Navigate to="/state/dashboard" replace />} />
      <Route
        path="/admin/messages"
        element={
          <RequireRole role={[ROLES.DISTRICT_ADMIN, ROLES.STATE_ADMIN]}>
            <MessageComposer />
          </RequireRole>
        }
      />
      <Route
        path="/support"
        element={
          <RequireRole role={[ROLES.CENTRE_STAFF, ROLES.DISTRICT_ADMIN, ROLES.STATE_ADMIN]}>
            <GovernmentSupport />
          </RequireRole>
        }
      />
      <Route
        path="/admin/centres/:centreId"
        element={
          <RequireRole role={[ROLES.DISTRICT_ADMIN, ROLES.STATE_ADMIN]}>
            <AdminCentreDetail />
          </RequireRole>
        }
      />

      <Route path="*" element={<NotFound />} />
    </Routes>
  );
}

/**
 * The sign-in page and the post-login router in one route.
 *
 * First-run language choice, then the single sign-in page, then wherever the
 * SERVER says this account belongs (GET /api/auth/session):
 *   - no profile yet            → farmer registration (only farmers self-register)
 *   - farmer                    → resume registration, verification status, or dashboard
 *   - centre staff / district / state admin → their dashboard
 *   - unusable profile          → "Account not configured"
 * A returning user never sees the language screen again (§7).
 */
function Landing(): JSX.Element {
  const { loading, session, profile, account, needsOnboarding, accountNotConfigured, profileLoadFailed } =
    useAuth();
  const { hasChosen } = useI18n();

  useAdoptProfileLanguage(profile?.preferredLanguage);

  if (!hasChosen && !session) return <Navigate to="/language" replace />;
  if (loading) return <FullPageSpinner />;
  if (!session) return <LoginPage />;
  if (accountNotConfigured) return <AccountNotConfigured />;
  if (needsOnboarding) return <Navigate to="/farmer/registration/start" replace />;
  if (profileLoadFailed) return <AccountLoadFailed />;
  if (!profile) return <FullPageSpinner />;

  // A farmer goes wherever their registration/verification state calls for —
  // resume, status, or the dashboard (§14). The state came from the server.
  if (profile.role === ROLES.FARMER && account) {
    return <Navigate to={FARMER_ACCOUNT_DESTINATION[account.state]} replace />;
  }

  // Looked up rather than assumed: a role this build does not know has no
  // dashboard, and is shown as not configured instead of being guessed.
  const destination = DASHBOARD_PATH[profile.role] as string | undefined;
  return destination ? <Navigate to={destination} replace /> : <AccountNotConfigured />;
}

export function App(): JSX.Element {
  return (
    <BrowserRouter>
      <I18nProvider>
        <AuthProvider>
          <AppRoutes />
        </AuthProvider>
      </I18nProvider>
    </BrowserRouter>
  );
}
