import { useEffect, useRef } from 'react';
import { useT } from '../../i18n/index.js';

/**
 * Six-digit OTP entry (§8).
 *
 * Six separate boxes rather than one field, because on a phone that is what
 * makes the code legible while typing. The behaviours that matter:
 *
 *   - auto-focus the first empty box
 *   - advance on entry, retreat on backspace from an empty box
 *   - accept a pasted code into any box (SMS autofill pastes the whole thing)
 *   - auto-submit the moment six digits are present, so nobody hunts for a button
 *
 * Accessibility (§27): the group is labelled, each box is individually
 * labelled for screen readers, and the error is associated with the group via
 * aria-describedby rather than conveyed by colour alone.
 */
const LENGTH = 6;

export function OtpInput({
  value,
  onChange,
  onComplete,
  disabled = false,
  invalid = false,
  describedBy,
}: {
  value: string;
  onChange: (value: string) => void;
  onComplete: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
}): JSX.Element {
  const t = useT();
  const boxes = useRef<Array<HTMLInputElement | null>>([]);
  // Guards against firing submit twice for the same code when React re-renders.
  const submitted = useRef<string | null>(null);

  const digits = value.padEnd(LENGTH, ' ').slice(0, LENGTH).split('');

  useEffect(() => {
    if (disabled) return;
    const focusIndex = Math.min(value.length, LENGTH - 1);
    boxes.current[focusIndex]?.focus();
  }, [value.length, disabled]);

  useEffect(() => {
    if (value.length === LENGTH && submitted.current !== value) {
      submitted.current = value;
      onComplete(value);
    }
    if (value.length < LENGTH) submitted.current = null;
  }, [value, onComplete]);

  function setDigit(index: number, digit: string): void {
    const next = value.padEnd(LENGTH, ' ').split('');
    next[index] = digit;
    onChange(next.join('').replace(/\s/g, '').slice(0, LENGTH));
  }

  function handleChange(index: number, raw: string): void {
    const clean = raw.replace(/\D/g, '');
    if (clean.length === 0) return;

    if (clean.length > 1) {
      // A paste landed in one box — spread it across the rest.
      onChange(clean.slice(0, LENGTH));
      return;
    }

    // Typing past the end replaces the last digit rather than being dropped.
    if (index >= value.length) {
      onChange((value + clean).slice(0, LENGTH));
    } else {
      setDigit(index, clean);
    }
  }

  function handleKeyDown(index: number, event: React.KeyboardEvent<HTMLInputElement>): void {
    if (event.key === 'Backspace') {
      event.preventDefault();
      if (value[index] !== undefined && index < value.length) {
        onChange(value.slice(0, index) + value.slice(index + 1));
      } else {
        onChange(value.slice(0, -1));
      }
      return;
    }

    if (event.key === 'ArrowLeft' && index > 0) {
      event.preventDefault();
      boxes.current[index - 1]?.focus();
    }

    if (event.key === 'ArrowRight' && index < LENGTH - 1) {
      event.preventDefault();
      boxes.current[index + 1]?.focus();
    }
  }

  function handlePaste(event: React.ClipboardEvent<HTMLInputElement>): void {
    event.preventDefault();
    const pasted = event.clipboardData.getData('text').replace(/\D/g, '').slice(0, LENGTH);
    if (pasted.length > 0) onChange(pasted);
  }

  return (
    <div
      role="group"
      aria-label={t('login.otpGroupLabel')}
      aria-describedby={describedBy}
      className="flex justify-between gap-2"
      dir="ltr"
    >
      {digits.map((digit, index) => (
        <input
          key={index}
          ref={(element) => {
            boxes.current[index] = element;
          }}
          type="text"
          inputMode="numeric"
          // Lets Android/iOS offer the SMS code straight into the first box.
          autoComplete={index === 0 ? 'one-time-code' : 'off'}
          maxLength={1}
          value={digit.trim()}
          disabled={disabled}
          aria-label={t('login.otpDigitLabel', { position: index + 1 })}
          aria-invalid={invalid}
          onChange={(event) => handleChange(index, event.target.value)}
          onKeyDown={(event) => handleKeyDown(index, event)}
          onPaste={handlePaste}
          onFocus={(event) => event.target.select()}
          className={`h-14 w-full rounded-lg border text-center text-2xl font-semibold
            shadow-sm transition
            focus:border-harvest-600 focus:ring-1 focus:ring-harvest-600
            disabled:bg-stone-100 disabled:text-stone-400
            ${invalid ? 'border-red-400 bg-red-50' : 'border-stone-300'}`}
        />
      ))}
    </div>
  );
}
