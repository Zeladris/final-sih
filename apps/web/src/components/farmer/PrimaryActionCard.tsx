import { Link } from 'react-router-dom';
import type { PrimaryAction } from '@kisansetu/shared';
import { useT } from '../../i18n/index.js';

/**
 * The single most useful next action (§10, §36).
 *
 * When the destination belongs to a phase that does not exist yet, the button
 * renders disabled with an explanation instead of linking somewhere broken.
 * Showing it greyed out is honest; hiding it would leave a verified farmer
 * with no visible next step at all.
 */
export function PrimaryActionCard({ action }: { action: PrimaryAction }): JSX.Element {
  const t = useT();

  if (!action.available) {
    return (
      <section className="card flex flex-col items-center justify-center text-center">
        <button
          type="button"
          disabled
          aria-disabled="true"
          className="btn-primary py-4 text-lg"
        >
          {t(action.labelKey)}
        </button>
        {action.noteKey ? (
          <p className="mt-2 text-center text-xs text-stone-500">{t(action.noteKey)}</p>
        ) : null}
      </section>
    );
  }

  return (
    <section className="card flex items-center justify-center">
      <Link to={action.to ?? '/'} className="btn-primary block py-4 text-center text-lg">
        {t(action.labelKey)}
      </Link>
    </section>
  );
}
