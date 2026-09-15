export function Spinner({ label = 'Loading' }: { label?: string }): JSX.Element {
  return (
    <div className="flex items-center justify-center gap-3 py-12 text-stone-600" role="status">
      <span
        aria-hidden="true"
        className="h-5 w-5 animate-spin rounded-full border-2 border-stone-300 border-t-harvest-700"
      />
      <span className="text-sm">{label}…</span>
    </div>
  );
}

export function FullPageSpinner({ label }: { label?: string }): JSX.Element {
  return (
    <div className="flex min-h-screen items-center justify-center bg-stone-50">
      <Spinner label={label} />
    </div>
  );
}
