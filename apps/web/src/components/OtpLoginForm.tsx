import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from '../auth/AuthProvider.js';
import { useT } from '../i18n/index.js';
import { AuthFailure } from '../lib/authErrors.js';
import { MobileInput } from './auth/MobileInput.js';
import { OtpInput } from './auth/OtpInput.js';
import { isValidPhone, maskPhone, normalisePhone } from './auth/phone.js';

/**
 * The one authentication component (§3, §20), used by the one sign-in page.
 *
 * It asks for a mobile number and a code — never a role. Signing in and
 * signing up are the same "verify this phone" step; afterwards the server says
 * whether the number belongs to a farmer, a centre, a district or the state,
 * or to nobody yet (a new farmer, sent to registration).
 *
 * There are no demo numbers and no OTP hints — the code always arrives by SMS
 * from Supabase Auth.
 */

const RESEND_SECONDS = 30;
/** No infinite retry loop: after this many wrong codes, request a new one. */
const MAX_VERIFY_ATTEMPTS = 5;

export function OtpLoginForm(): JSX.Element {
  const { signInWithOtp, verifyOtp } = useAuth();
  const t = useT();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();

  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [phone, setPhone] = useState('');
  const [sentTo, setSentTo] = useState('');
  const [code, setCode] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(
    // Set when a guard bounced the user here after their session expired (§16).
    searchParams.get('reason') === 'expired' ? 'login.sessionExpired' : null,
  );
  const [busy, setBusy] = useState(false);
  const [attempts, setAttempts] = useState(0);
  const [cooldown, setCooldown] = useState(0);

  // Prevents a double-submit from a fast second tap or an auto-submit racing
  // the button (§6 "prevent rapid repeated submission").
  const inFlight = useRef(false);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown((value) => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function sendOtp(): Promise<void> {
    if (inFlight.current) return;

    setError(null);
    setNotice(null);

    const normalised = normalisePhone(phone);
    if (!isValidPhone(normalised)) {
      setError(t('login.error.invalidMobile'));
      return;
    }

    inFlight.current = true;
    setBusy(true);
    try {
      await signInWithOtp(normalised);
      setSentTo(normalised);
      setStep('otp');
      setCode('');
      setAttempts(0);
      setCooldown(RESEND_SECONDS);
    } catch (cause) {
      if (cause instanceof AuthFailure) {
        setError(t(cause.messageKey));
        // Honour the provider's own cooldown rather than guessing.
        if (cause.retryAfterSeconds) setCooldown(cause.retryAfterSeconds);
      } else {
        setError(t('login.error.sendFailed'));
      }
    } finally {
      inFlight.current = false;
      setBusy(false);
    }
  }

  const submitCode = useCallback(
    async (value: string): Promise<void> => {
      if (inFlight.current) return;

      setError(null);
      if (!/^\d{6}$/.test(value)) {
        setError(t('login.error.emptyCode'));
        return;
      }

      inFlight.current = true;
      setBusy(true);
      try {
        await verifyOtp(sentTo, value);
        // Where they land is decided by the landing route from the
        // server-derived role and account state.
        navigate('/', { replace: true });
      } catch (cause) {
        setCode('');

        if (cause instanceof AuthFailure) {
          // An expired code or a rate limit is not a wrong guess — do not
          // spend one of the farmer's attempts on it.
          if (cause.kind === 'EXPIRED_CODE' || cause.kind === 'TOO_MANY_ATTEMPTS') {
            setError(t(cause.messageKey));
            if (cause.retryAfterSeconds) setCooldown(cause.retryAfterSeconds);
            inFlight.current = false;
            setBusy(false);
            return;
          }

          if (cause.kind === 'NETWORK') {
            setError(t(cause.messageKey));
            inFlight.current = false;
            setBusy(false);
            return;
          }
        }

        const next = attempts + 1;
        setAttempts(next);

        if (next >= MAX_VERIFY_ATTEMPTS) {
          setStep('phone');
          setAttempts(0);
          setError(t('login.error.tooManyAttempts'));
        } else {
          setError(
            `${t('login.error.invalidCode')} ${t('login.attemptsLeft', {
              remaining: MAX_VERIFY_ATTEMPTS - next,
            })}`,
          );
        }
      } finally {
        inFlight.current = false;
        setBusy(false);
      }
    },
    [attempts, navigate, sentTo, t, verifyOtp],
  );

  const errorId = 'auth-error';

  return (
    <div className="card w-full">
      {step === 'otp' ? (
        <div>
          <h2 className="text-xl font-semibold text-stone-900">{t('login.otpTitle')}</h2>
          <p className="mt-2 text-sm text-stone-600">{t('login.otpSentTo')}</p>
          <p className="mt-1 font-mono text-sm text-stone-900" dir="ltr">
            {maskPhone(sentTo)}
          </p>
        </div>
      ) : null}

      {notice ? (
        <p role="status" className="mb-4 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
          {t(notice)}
        </p>
      ) : null}

      {step === 'phone' ? (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void sendOtp();
          }}
          className="space-y-4"
          noValidate
        >
          <div>
            <label htmlFor="phone" className="field-label">
              {t('login.mobileLabel')}
            </label>
            <MobileInput
              value={phone}
              onChange={setPhone}
              disabled={busy}
              invalid={error !== null}
              describedBy={error ? errorId : 'phone-help'}
              autoFocus
            />
            <p id="phone-help" className="mt-1.5 text-xs text-stone-500">
              {t('login.mobileHelp')}
            </p>
          </div>

          {error ? <ErrorNote id={errorId}>{error}</ErrorNote> : null}

          <button type="submit" className="btn-primary" disabled={busy}>
            {busy ? t('login.sending') : t('common.continue')}
          </button>

          <p className="pt-1 text-center text-xs text-stone-500">{t('login.newHere')}</p>
        </form>
      ) : (
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void submitCode(code);
          }}
          className="mt-6 space-y-4"
          noValidate
        >
          <OtpInput
            value={code}
            onChange={setCode}
            // Auto-submits as soon as six digits are present (§8).
            onComplete={(value) => void submitCode(value)}
            disabled={busy}
            invalid={error !== null}
            describedBy={error ? errorId : undefined}
          />

          {error ? <ErrorNote id={errorId}>{error}</ErrorNote> : null}

          <button type="submit" className="btn-primary" disabled={busy || code.length < 6}>
            {busy ? t('login.verifying') : t('login.verify')}
          </button>

          <div className="flex flex-wrap items-center justify-between gap-2 text-sm">
            <button
              type="button"
              className="text-stone-600 underline underline-offset-2 hover:text-stone-900"
              onClick={() => {
                // Back to the number, keeping what they typed so they can fix
                // a digit rather than retype it (§25).
                setStep('phone');
                setCode('');
                setError(null);
              }}
            >
              {t('login.changeNumber')}
            </button>

            <button
              type="button"
              className="text-harvest-700 underline underline-offset-2 disabled:text-stone-400 disabled:no-underline"
              disabled={cooldown > 0 || busy}
              onClick={() => void sendOtp()}
            >
              {cooldown > 0 ? t('login.resendIn', { seconds: cooldown }) : t('login.resend')}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

function ErrorNote({ id, children }: { id: string; children: React.ReactNode }): JSX.Element {
  return (
    <p id={id} role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
      {children}
    </p>
  );
}
