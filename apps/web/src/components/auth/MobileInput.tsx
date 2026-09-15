import { useT } from '../../i18n/index.js';
import { formatForDisplay } from './phone.js';

/**
 * Mobile number entry (§6, §26).
 *
 * A fixed `+91` prefix rather than a country field: this is a Tamil Nadu
 * procurement system and asking a farmer to pick a country code is friction
 * with no payoff. `inputMode="numeric"` brings up the number pad.
 */
export function MobileInput({
  value,
  onChange,
  disabled = false,
  invalid = false,
  describedBy,
  autoFocus = false,
}: {
  value: string;
  onChange: (value: string) => void;
  disabled?: boolean;
  invalid?: boolean;
  describedBy?: string;
  autoFocus?: boolean;
}): JSX.Element {
  const t = useT();

  return (
    <div
      className={`flex items-stretch overflow-hidden rounded-lg border shadow-sm transition
        focus-within:border-harvest-600 focus-within:ring-1 focus-within:ring-harvest-600
        ${invalid ? 'border-red-400' : 'border-stone-300'}`}
      dir="ltr"
    >
      <span
        aria-hidden="true"
        className="flex select-none items-center border-r border-stone-200 bg-stone-50 px-3 text-base text-stone-600"
      >
        +91
      </span>

      <input
        id="phone"
        name="phone"
        type="tel"
        inputMode="numeric"
        autoComplete="tel-national"
        autoFocus={autoFocus}
        // 10 digits plus the space the formatter inserts.
        maxLength={11}
        className="w-full px-3 py-3 text-base tracking-wide placeholder:text-stone-400 focus:outline-none disabled:bg-stone-100"
        placeholder={t('login.mobilePlaceholder')}
        value={formatForDisplay(value)}
        disabled={disabled}
        aria-invalid={invalid}
        aria-describedby={describedBy}
        onChange={(event) => onChange(event.target.value.replace(/\D/g, '').slice(0, 10))}
      />
    </div>
  );
}
