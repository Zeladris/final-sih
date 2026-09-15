import { useEffect, useState } from 'react';
import {
  ALL_GRIEVANCE_CATEGORIES,
  ALL_GRIEVANCE_STATUSES,
  ALL_LANGUAGES,
  GRIEVANCE_TRANSITIONS,
  LANGUAGE_ENDONYM,
} from '@kisansetu/shared';
import type {
  AdminMe,
  CreateHelplineRequest,
  CreateSchemeRequest,
  FaqItem,
  GrievanceDetail,
  GrievanceListItem,
  GrievanceStatus,
  HelplineEntry,
  Language,
  Role,
  SchemeDetail,
} from '@kisansetu/shared';
import { api } from '../../lib/api.js';
import { useAuth } from '../../auth/AuthProvider.js';
import { useT } from '../../i18n/index.js';
import { AppShell, ErrorPanel } from '../../components/AppShell.js';
import { Spinner } from '../../components/Spinner.js';

type Tab = 'GRIEVANCES' | 'HELPLINE' | 'SCHEMES' | 'FAQS';

/**
 * The government-side Help & Support workspace (§10–§37).
 *
 * Centre Staff only ever see the Complaints tab — they are where most
 * complaints first land, but helpline/scheme/FAQ publishing is District/State
 * Admin work. The tab list below is a convenience; the backend re-checks
 * every one of these actions against the caller's real role and scope
 * regardless of what this page ever shows (§25).
 */
export function GovernmentSupport(): JSX.Element {
  const t = useT();
  const { profile } = useAuth();
  const role = profile?.role as Role | undefined;
  const canPublish = role === 'DISTRICT_ADMIN' || role === 'STATE_ADMIN';

  const [tab, setTab] = useState<Tab>('GRIEVANCES');
  const [me, setMe] = useState<AdminMe | null>(null);

  useEffect(() => {
    if (canPublish) api.get<AdminMe>('/api/admin/me').then(setMe).catch(() => undefined);
  }, [canPublish]);

  const tabs: Tab[] = canPublish ? ['GRIEVANCES', 'HELPLINE', 'SCHEMES', 'FAQS'] : ['GRIEVANCES'];

  return (
    <AppShell title={t('gov.title')} subtitle={t('gov.subtitle')}>
      <div className="space-y-4">
        {tabs.length > 1 ? (
          <div className="flex gap-1 rounded-lg border border-stone-200 bg-white p-1" role="tablist">
            {tabs.map((option) => (
              <button
                key={option}
                type="button"
                role="tab"
                aria-selected={tab === option}
                onClick={() => setTab(option)}
                className={`rounded-md px-4 py-1.5 text-sm font-medium ${
                  tab === option ? 'bg-harvest-600 text-white' : 'text-stone-700'
                }`}
              >
                {t(`gov.tab.${option.toLowerCase()}`)}
              </button>
            ))}
          </div>
        ) : null}

        {tab === 'GRIEVANCES' ? <GrievancesPanel canAssign={canPublish} /> : null}
        {tab === 'HELPLINE' && canPublish ? <HelplinePanel me={me} /> : null}
        {tab === 'SCHEMES' && canPublish ? <SchemesPanel me={me} /> : null}
        {tab === 'FAQS' && canPublish ? <FaqsPanel me={me} /> : null}
      </div>
    </AppShell>
  );
}

// --- Grievances ------------------------------------------------------------------

function GrievancesPanel({ canAssign }: { canAssign: boolean }): JSX.Element {
  const t = useT();
  const [status, setStatus] = useState<GrievanceStatus | ''>('');
  const [category, setCategory] = useState<string>('');
  const [search, setSearch] = useState('');
  const [list, setList] = useState<GrievanceListItem[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = (): void => {
    setError(null);
    const params = new URLSearchParams();
    if (status) params.set('status', status);
    if (category) params.set('category', category);
    if (search.trim()) params.set('search', search.trim());
    const qs = params.toString();
    api
      .get<{ grievances: GrievanceListItem[] }>(`/api/government/grievances${qs ? `?${qs}` : ''}`)
      .then((data) => setList(data.grievances))
      .catch(setError);
  };
  useEffect(load, [status, category, search]);

  if (selectedId) {
    return (
      <GrievanceDetailPanel
        id={selectedId}
        canAssign={canAssign}
        onBack={() => {
          setSelectedId(null);
          load();
        }}
      />
    );
  }

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-stone-600">
          {t('gov.grievance.filters.status')}
          <select className="field-input mt-0.5 py-1" value={status} onChange={(e) => setStatus(e.target.value as GrievanceStatus | '')}>
            <option value="">{t('gov.grievance.filters.any')}</option>
            {ALL_GRIEVANCE_STATUSES.map((s) => (
              <option key={s} value={s}>
                {t(`grievance.status.${s}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-stone-600">
          {t('gov.grievance.filters.category')}
          <select className="field-input mt-0.5 py-1" value={category} onChange={(e) => setCategory(e.target.value)}>
            <option value="">{t('gov.grievance.filters.any')}</option>
            {ALL_GRIEVANCE_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {t(`grievance.category.${c}`)}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-stone-600">
          {t('gov.grievance.filters.search')}
          <input className="field-input mt-0.5 py-1" value={search} onChange={(e) => setSearch(e.target.value)} />
        </label>
      </div>

      {error ? <ErrorPanel error={error} /> : null}
      {list === null ? (
        <Spinner label={t('admin.loading')} />
      ) : list.length === 0 ? (
        <p className="rounded-lg bg-stone-50 px-3 py-4 text-center text-sm text-stone-600">{t('gov.grievance.empty')}</p>
      ) : (
        <ul className="space-y-2">
          {list.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setSelectedId(item.id)}
                className="card block w-full text-left transition hover:bg-stone-50"
              >
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-medium text-stone-900">{item.subject}</p>
                  <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700">
                    {t(`grievance.status.${item.status}`)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-stone-500">
                  {item.reference} · {t(`grievance.category.${item.category}`)}
                </p>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function GrievanceDetailPanel({
  id,
  canAssign,
  onBack,
}: {
  id: string;
  canAssign: boolean;
  onBack: () => void;
}): JSX.Element {
  const t = useT();
  const [detail, setDetail] = useState<GrievanceDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [note, setNote] = useState('');
  const [response, setResponse] = useState('');
  const [newStatus, setNewStatus] = useState<GrievanceStatus | ''>('');
  const [reason, setReason] = useState('');
  const [assignTo, setAssignTo] = useState('');
  const [escalateReason, setEscalateReason] = useState('');
  const [busy, setBusy] = useState(false);

  const load = (): void => {
    api
      .get<{ grievance: GrievanceDetail }>(`/api/government/grievances/${id}`)
      .then((data) => setDetail(data.grievance))
      .catch(setError);
  };
  useEffect(load, [id]);

  async function run(action: () => Promise<void>): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await action();
      load();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  const nextStatuses = detail ? GRIEVANCE_TRANSITIONS[detail.status] : [];

  return (
    <div className="space-y-4">
      <button type="button" className="text-sm font-medium text-harvest-800 underline underline-offset-2" onClick={onBack}>
        ← {t('gov.grievance.backToList')}
      </button>

      {error ? <ErrorPanel error={error} /> : null}

      {!detail ? (
        <Spinner label={t('admin.loading')} />
      ) : (
        <>
          <div className="card">
            <div className="flex items-start justify-between gap-2">
              <h2 className="text-base font-semibold text-stone-900">{detail.subject}</h2>
              <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700">
                {t(`grievance.status.${detail.status}`)}
              </span>
            </div>
            <p className="mt-1 text-xs text-stone-500">
              {detail.reference} · {t(`grievance.category.${detail.category}`)}
            </p>
            <p className="mt-2 text-sm text-stone-700">{detail.description}</p>
          </div>

          <div className="card">
            <h3 className="text-sm font-semibold text-stone-900">{t('grievance.timelineTitle')}</h3>
            <ul className="mt-2 space-y-1.5">
              {detail.history.map((entry, index) => (
                <li key={index} className="text-sm text-stone-600">
                  <span className="font-medium text-stone-900">{t(`grievance.status.${entry.toStatus}`)}</span>
                  {' · '}
                  {new Date(entry.createdAt).toLocaleString()}
                  {entry.changeReason ? <span className="block text-xs text-stone-500">{entry.changeReason}</span> : null}
                </li>
              ))}
            </ul>
          </div>

          {nextStatuses.length > 0 ? (
            <div className="card space-y-2">
              <h3 className="text-sm font-semibold text-stone-900">{t('gov.grievance.changeStatus')}</h3>
              <div className="flex flex-wrap items-end gap-2">
                <label className="text-xs text-stone-600">
                  {t('gov.grievance.newStatus')}
                  <select className="field-input mt-0.5 py-1" value={newStatus} onChange={(e) => setNewStatus(e.target.value as GrievanceStatus | '')}>
                    <option value="">{t('gov.grievance.filters.any')}</option>
                    {nextStatuses.map((s) => (
                      <option key={s} value={s}>
                        {t(`grievance.status.${s}`)}
                      </option>
                    ))}
                  </select>
                </label>
                <input
                  className="field-input flex-1"
                  placeholder={t('gov.grievance.reasonPlaceholder')}
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-primary"
                  disabled={!newStatus || busy}
                  onClick={() =>
                    void run(async () => {
                      await api.patch(`/api/government/grievances/${id}/status`, { status: newStatus, reason: reason.trim() || undefined });
                      setNewStatus('');
                      setReason('');
                    })
                  }
                >
                  {t('gov.grievance.applyStatus')}
                </button>
              </div>
            </div>
          ) : (
            <p className="text-sm text-stone-500">{t('gov.grievance.noTransitions')}</p>
          )}

          <div className="card space-y-2">
            <h3 className="text-sm font-semibold text-stone-900">{t('gov.grievance.addResponseTitle')}</h3>
            {detail.responses.length > 0 ? (
              <ul className="space-y-1.5">
                {detail.responses.map((r) => (
                  <li key={r.id} className="rounded-lg bg-stone-50 p-2 text-sm text-stone-700">
                    {r.message}
                    <p className="mt-1 text-xs text-stone-400">{new Date(r.createdAt).toLocaleString()}</p>
                  </li>
                ))}
              </ul>
            ) : null}
            <div className="flex gap-2">
              <input
                className="field-input flex-1"
                placeholder={t('gov.grievance.addResponsePlaceholder')}
                value={response}
                onChange={(e) => setResponse(e.target.value)}
              />
              <button
                type="button"
                className="btn-primary shrink-0"
                disabled={!response.trim() || busy}
                onClick={() =>
                  void run(async () => {
                    await api.post(`/api/government/grievances/${id}/responses`, { message: response.trim() });
                    setResponse('');
                  })
                }
              >
                {t('gov.grievance.sendResponse')}
              </button>
            </div>
          </div>

          <div className="card space-y-2">
            <h3 className="text-sm font-semibold text-stone-900">{t('gov.grievance.notesTitle')}</h3>
            <p className="text-xs text-stone-500">{t('gov.grievance.notesHint')}</p>
            {detail.notes && detail.notes.length > 0 ? (
              <ul className="space-y-1.5">
                {detail.notes.map((n) => (
                  <li key={n.id} className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900">
                    {n.note}
                    <p className="mt-1 text-xs text-amber-700">{new Date(n.createdAt).toLocaleString()}</p>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-stone-500">{t('gov.grievance.noNotes')}</p>
            )}
            <div className="flex gap-2">
              <input
                className="field-input flex-1"
                placeholder={t('gov.grievance.addNotePlaceholder')}
                value={note}
                onChange={(e) => setNote(e.target.value)}
              />
              <button
                type="button"
                className="btn-secondary shrink-0"
                disabled={!note.trim() || busy}
                onClick={() =>
                  void run(async () => {
                    await api.post(`/api/government/grievances/${id}/notes`, { note: note.trim() });
                    setNote('');
                  })
                }
              >
                {t('gov.grievance.addNote')}
              </button>
            </div>
          </div>

          {canAssign ? (
            <div className="card space-y-2">
              <h3 className="text-sm font-semibold text-stone-900">{t('gov.grievance.assignTitle')}</h3>
              <div className="flex gap-2">
                <input
                  className="field-input flex-1"
                  placeholder={t('gov.grievance.assignPlaceholder')}
                  value={assignTo}
                  onChange={(e) => setAssignTo(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-secondary shrink-0"
                  disabled={!assignTo.trim() || busy}
                  onClick={() =>
                    void run(async () => {
                      await api.post(`/api/government/grievances/${id}/assign`, { userId: assignTo.trim() });
                      setAssignTo('');
                    })
                  }
                >
                  {t('gov.grievance.assign')}
                </button>
              </div>
            </div>
          ) : null}

          {!['CLOSED', 'CLOSED_INVALID'].includes(detail.status) ? (
            <div className="card space-y-2">
              <h3 className="text-sm font-semibold text-stone-900">{t('gov.grievance.escalateTitle')}</h3>
              <div className="flex gap-2">
                <input
                  className="field-input flex-1"
                  placeholder={t('gov.grievance.escalateReasonPlaceholder')}
                  value={escalateReason}
                  onChange={(e) => setEscalateReason(e.target.value)}
                />
                <button
                  type="button"
                  className="btn-secondary shrink-0"
                  disabled={!escalateReason.trim() || busy}
                  onClick={() =>
                    void run(async () => {
                      await api.post(`/api/government/grievances/${id}/escalate`, { reason: escalateReason.trim() });
                      setEscalateReason('');
                    })
                  }
                >
                  {t('gov.grievance.escalate')}
                </button>
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

// --- Shared per-language field block (title/description or question/answer) ------

type LangFields = Record<Language, { a: string; b: string }>;
const emptyLangFields = (): LangFields =>
  Object.fromEntries(ALL_LANGUAGES.map((l) => [l, { a: '', b: '' }])) as LangFields;

function LanguageBlock({
  fields,
  setField,
  labelA,
  labelB,
  maxA,
  maxB,
  multilineB,
}: {
  fields: LangFields;
  setField: (lang: Language, key: 'a' | 'b', value: string) => void;
  labelA: string;
  labelB: string;
  maxA: number;
  maxB: number;
  multilineB?: boolean;
}): JSX.Element {
  const t = useT();
  return (
    <>
      {ALL_LANGUAGES.map((lang) => (
        <div key={lang} className="rounded-lg border border-stone-200 p-3">
          <p className="text-sm font-semibold text-stone-900">
            {LANGUAGE_ENDONYM[lang]}
            {lang !== 'en' ? <span className="ml-1 font-normal text-stone-400">({t('common.optional')})</span> : null}
          </p>
          <div className="mt-2 space-y-2">
            <div>
              <label className="field-label">{labelA}</label>
              <input
                className="field-input"
                maxLength={maxA}
                value={fields[lang].a}
                onChange={(e) => setField(lang, 'a', e.target.value)}
              />
            </div>
            <div>
              <label className="field-label">{labelB}</label>
              {multilineB ? (
                <textarea
                  className="field-input"
                  rows={2}
                  maxLength={maxB}
                  value={fields[lang].b}
                  onChange={(e) => setField(lang, 'b', e.target.value)}
                />
              ) : (
                <input
                  className="field-input"
                  maxLength={maxB}
                  value={fields[lang].b}
                  onChange={(e) => setField(lang, 'b', e.target.value)}
                />
              )}
            </div>
          </div>
        </div>
      ))}
    </>
  );
}

// --- Helpline ------------------------------------------------------------------

function HelplinePanel({ me }: { me: AdminMe | null }): JSX.Element {
  const t = useT();
  const [list, setList] = useState<HelplineEntry[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [showForm, setShowForm] = useState(false);

  const load = (): void => {
    api
      .get<{ helpline: HelplineEntry[] }>('/api/government/helpline')
      .then((data) => setList(data.helpline))
      .catch(setError);
  };
  useEffect(load, []);

  return (
    <div className="space-y-4">
      {showForm ? (
        <HelplineForm me={me} onCancel={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />
      ) : (
        <button type="button" className="btn-primary" onClick={() => setShowForm(true)}>
          {t('gov.helpline.newTitle')}
        </button>
      )}

      <div>
        <h3 className="text-sm font-semibold text-stone-900">{t('gov.helpline.listTitle')}</h3>
        {error ? <ErrorPanel error={error} /> : null}
        {list === null ? (
          <Spinner label={t('admin.loading')} />
        ) : list.length === 0 ? (
          <p className="mt-2 text-sm text-stone-600">{t('gov.helpline.empty')}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {list.map((entry) => (
              <li key={entry.id} className="card">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-stone-900">{entry.title.en}</p>
                  <span
                    className={`shrink-0 rounded-full px-2 py-0.5 text-xs font-medium ${
                      entry.isActive ? 'bg-harvest-100 text-harvest-800' : 'bg-stone-100 text-stone-500'
                    }`}
                  >
                    {entry.isActive ? t('gov.helpline.active') : t('gov.helpline.inactive')}
                  </span>
                </div>
                <p className="mt-1 text-xs text-stone-500">
                  {entry.phoneNumber ?? ''} {entry.email ? `· ${entry.email}` : ''}
                </p>
                <div className="mt-2 flex gap-2">
                  {!entry.lastVerifiedAt || entry.isActive ? (
                    <button
                      type="button"
                      className="btn-secondary py-1 text-xs"
                      onClick={() => api.post(`/api/government/helpline/${entry.id}/verify`, {}).then(load).catch(setError)}
                    >
                      {t('gov.helpline.verify')}
                    </button>
                  ) : null}
                  <button
                    type="button"
                    className="btn-secondary py-1 text-xs"
                    onClick={() =>
                      api
                        .patch(`/api/government/helpline/${entry.id}`, { isActive: !entry.isActive })
                        .then(load)
                        .catch(setError)
                    }
                  >
                    {entry.isActive ? t('gov.faq.deactivate') : t('gov.faq.activate')}
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function HelplineForm({
  me,
  onCancel,
  onSaved,
}: {
  me: AdminMe | null;
  onCancel: () => void;
  onSaved: () => void;
}): JSX.Element {
  const t = useT();
  const [fields, setFields] = useState<LangFields>(emptyLangFields);
  const [category, setCategory] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [office, setOffice] = useState('');
  const [address, setAddress] = useState('');
  const [url, setUrl] = useState('');
  const [source, setSource] = useState('');
  const [scopeType, setScopeType] = useState<'DISTRICT' | 'STATE' | 'NATIONAL'>(me?.scope === 'STATE' ? 'STATE' : 'DISTRICT');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const setField = (lang: Language, key: 'a' | 'b', value: string): void =>
    setFields((current) => ({ ...current, [lang]: { ...current[lang], [key]: value } }));

  const valid = fields.en.a.trim().length > 0 && category.trim().length > 0 && (phone.trim() || email.trim() || url.trim());

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const body: CreateHelplineRequest = {
        titleEn: fields.en.a.trim(),
        titleTa: fields.ta.a.trim() || null,
        titleKn: fields.kn.a.trim() || null,
        titleHi: fields.hi.a.trim() || null,
        titleMl: fields.ml.a.trim() || null,
        descriptionEn: fields.en.b.trim() || null,
        descriptionTa: fields.ta.b.trim() || null,
        descriptionKn: fields.kn.b.trim() || null,
        descriptionHi: fields.hi.b.trim() || null,
        descriptionMl: fields.ml.b.trim() || null,
        phoneNumber: phone.trim() || null,
        email: email.trim() || null,
        officeName: office.trim() || null,
        address: address.trim() || null,
        scopeType,
        districtId: scopeType === 'DISTRICT' ? me?.district?.id ?? null : null,
        stateId: scopeType === 'STATE' ? me?.state?.id ?? null : null,
        category: category.trim(),
        officialUrl: url.trim() || null,
        sourceReference: source.trim() || null,
      };
      await api.post('/api/government/helpline', body);
      onSaved();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3">
      {me?.role === 'STATE_ADMIN' ? (
        <div>
          <label className="field-label">{t('gov.helpline.categoryLabel')}</label>
          <select className="field-input" value={scopeType} onChange={(e) => setScopeType(e.target.value as typeof scopeType)}>
            <option value="STATE">{t('gov.helpline.scopeState')}</option>
            <option value="NATIONAL">{t('gov.helpline.scopeNational')}</option>
          </select>
        </div>
      ) : (
        <p className="text-xs text-stone-500">{t('gov.helpline.scopeDistrict')}</p>
      )}

      <div>
        <label className="field-label">{t('gov.helpline.categoryLabel')}</label>
        <input className="field-input" placeholder={t('gov.helpline.categoryPlaceholder')} value={category} onChange={(e) => setCategory(e.target.value)} />
      </div>

      <LanguageBlock
        fields={fields}
        setField={setField}
        labelA={t('gov.helpline.titleLabel')}
        labelB={t('gov.helpline.descriptionLabel')}
        maxA={200}
        maxB={1000}
        multilineB
      />

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="field-label">{t('gov.helpline.phoneLabel')}</label>
          <input className="field-input" value={phone} onChange={(e) => setPhone(e.target.value)} />
        </div>
        <div>
          <label className="field-label">{t('gov.helpline.emailLabel')}</label>
          <input className="field-input" value={email} onChange={(e) => setEmail(e.target.value)} />
        </div>
        <div>
          <label className="field-label">{t('gov.helpline.officeLabel')}</label>
          <input className="field-input" value={office} onChange={(e) => setOffice(e.target.value)} />
        </div>
        <div>
          <label className="field-label">{t('gov.helpline.addressLabel')}</label>
          <input className="field-input" value={address} onChange={(e) => setAddress(e.target.value)} />
        </div>
        <div>
          <label className="field-label">{t('gov.helpline.urlLabel')}</label>
          <input className="field-input" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div>
          <label className="field-label">{t('gov.helpline.sourceLabel')}</label>
          <input className="field-input" value={source} onChange={(e) => setSource(e.target.value)} />
        </div>
      </div>

      {error ? <ErrorPanel error={error} /> : null}

      <div className="flex gap-2">
        <button type="button" className="btn-primary flex-1" disabled={!valid || busy} onClick={() => void save()}>
          {t('gov.helpline.create')}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          {t('gov.helpline.cancel')}
        </button>
      </div>
    </div>
  );
}

// --- Schemes ---------------------------------------------------------------------

function SchemesPanel({ me }: { me: AdminMe | null }): JSX.Element {
  const t = useT();
  const [list, setList] = useState<SchemeDetail[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [showForm, setShowForm] = useState(false);

  const load = (): void => {
    api
      .get<{ schemes: SchemeDetail[] }>('/api/government/schemes')
      .then((data) => setList(data.schemes))
      .catch(setError);
  };
  useEffect(load, []);

  async function setStatus(id: string, action: 'publish' | 'archive'): Promise<void> {
    try {
      await api.post(`/api/government/schemes/${id}/${action}`, {});
      load();
    } catch (cause) {
      setError(cause);
    }
  }

  return (
    <div className="space-y-4">
      {showForm ? (
        <SchemeForm me={me} onCancel={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />
      ) : (
        <button type="button" className="btn-primary" onClick={() => setShowForm(true)}>
          {t('gov.scheme.newTitle')}
        </button>
      )}

      <div>
        <h3 className="text-sm font-semibold text-stone-900">{t('gov.scheme.listTitle')}</h3>
        {error ? <ErrorPanel error={error} /> : null}
        {list === null ? (
          <Spinner label={t('admin.loading')} />
        ) : list.length === 0 ? (
          <p className="mt-2 text-sm text-stone-600">{t('gov.scheme.empty')}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {list.map((scheme) => (
              <li key={scheme.id} className="card">
                <div className="flex items-start justify-between gap-2">
                  <p className="text-sm font-semibold text-stone-900">{scheme.name.en}</p>
                  <span className="shrink-0 rounded-full bg-stone-100 px-2 py-0.5 text-xs font-medium text-stone-700">
                    {t(`gov.scheme.status.${scheme.status}`)}
                  </span>
                </div>
                <p className="mt-1 text-xs text-stone-500">
                  {scheme.authorityName} · {scheme.category}
                </p>
                <div className="mt-2 flex gap-2">
                  {scheme.status !== 'PUBLISHED' ? (
                    <button type="button" className="btn-secondary py-1 text-xs" onClick={() => void setStatus(scheme.id, 'publish')}>
                      {t('gov.scheme.publish')}
                    </button>
                  ) : null}
                  {scheme.status !== 'ARCHIVED' ? (
                    <button type="button" className="btn-secondary py-1 text-xs" onClick={() => void setStatus(scheme.id, 'archive')}>
                      {t('gov.scheme.archive')}
                    </button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function SchemeForm({
  me,
  onCancel,
  onSaved,
}: {
  me: AdminMe | null;
  onCancel: () => void;
  onSaved: () => void;
}): JSX.Element {
  const t = useT();
  const [names, setNames] = useState<Record<Language, string>>(
    () => Object.fromEntries(ALL_LANGUAGES.map((l) => [l, ''])) as Record<Language, string>,
  );
  const [authority, setAuthority] = useState('');
  const [department, setDepartment] = useState('');
  const [category, setCategory] = useState('');
  const [level, setLevel] = useState<'NATIONAL' | 'STATE' | 'DISTRICT'>(me?.scope === 'STATE' ? 'STATE' : 'DISTRICT');
  const [benefit, setBenefit] = useState('');
  const [eligibility, setEligibility] = useState('');
  const [documents, setDocuments] = useState('');
  const [apply, setApply] = useState('');
  const [crops, setCrops] = useState('');
  const [url, setUrl] = useState('');
  const [source, setSource] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const valid = names.en.trim().length > 0 && authority.trim().length > 0 && category.trim().length > 0 && source.trim().length > 0;

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const body: CreateSchemeRequest = {
        nameEn: names.en.trim(),
        nameTa: names.ta.trim() || null,
        nameKn: names.kn.trim() || null,
        nameHi: names.hi.trim() || null,
        nameMl: names.ml.trim() || null,
        authorityName: authority.trim(),
        departmentName: department.trim() || null,
        level,
        districtId: level === 'DISTRICT' ? me?.district?.id ?? null : null,
        stateId: level === 'STATE' ? me?.state?.id ?? null : null,
        category: category.trim(),
        benefitSummaryEn: benefit.trim() || null,
        eligibilitySummaryEn: eligibility.trim() || null,
        documentsSummaryEn: documents.trim() || null,
        applicationMethodEn: apply.trim() || null,
        relevantCropCodes: crops
          .split(',')
          .map((c) => c.trim().toUpperCase())
          .filter(Boolean),
        officialUrl: url.trim() || null,
        sourceReference: source.trim(),
      };
      await api.post('/api/government/schemes', body);
      onSaved();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3">
      {me?.role === 'STATE_ADMIN' ? (
        <div>
          <label className="field-label">{t('gov.scheme.levelLabel')}</label>
          <select className="field-input" value={level} onChange={(e) => setLevel(e.target.value as typeof level)}>
            <option value="STATE">{t('gov.helpline.scopeState')}</option>
            <option value="NATIONAL">{t('gov.helpline.scopeNational')}</option>
          </select>
        </div>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2">
        {ALL_LANGUAGES.map((lang) => (
          <div key={lang}>
            <label className="field-label">
              {t('gov.scheme.nameLabel')} ({LANGUAGE_ENDONYM[lang]})
              {lang !== 'en' ? <span className="ml-1 font-normal text-stone-400">({t('common.optional')})</span> : null}
            </label>
            <input
              className="field-input"
              maxLength={200}
              value={names[lang]}
              onChange={(e) => setNames((current) => ({ ...current, [lang]: e.target.value }))}
            />
          </div>
        ))}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="field-label">{t('gov.scheme.authorityLabel')}</label>
          <input className="field-input" value={authority} onChange={(e) => setAuthority(e.target.value)} />
        </div>
        <div>
          <label className="field-label">{t('gov.scheme.departmentLabel')}</label>
          <input className="field-input" value={department} onChange={(e) => setDepartment(e.target.value)} />
        </div>
        <div>
          <label className="field-label">{t('gov.scheme.categoryLabel')}</label>
          <input className="field-input" value={category} onChange={(e) => setCategory(e.target.value)} />
        </div>
        <div>
          <label className="field-label">{t('gov.scheme.cropsLabel')}</label>
          <input className="field-input" value={crops} onChange={(e) => setCrops(e.target.value)} />
        </div>
      </div>

      <div>
        <label className="field-label">{t('gov.scheme.benefitLabel')}</label>
        <textarea className="field-input" rows={2} value={benefit} onChange={(e) => setBenefit(e.target.value)} />
      </div>
      <div>
        <label className="field-label">{t('gov.scheme.eligibilityLabel')}</label>
        <textarea className="field-input" rows={2} value={eligibility} onChange={(e) => setEligibility(e.target.value)} />
      </div>
      <div>
        <label className="field-label">{t('gov.scheme.documentsLabel')}</label>
        <textarea className="field-input" rows={2} value={documents} onChange={(e) => setDocuments(e.target.value)} />
      </div>
      <div>
        <label className="field-label">{t('gov.scheme.applyLabel')}</label>
        <textarea className="field-input" rows={2} value={apply} onChange={(e) => setApply(e.target.value)} />
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="field-label">{t('gov.scheme.urlLabel')}</label>
          <input className="field-input" value={url} onChange={(e) => setUrl(e.target.value)} />
        </div>
        <div>
          <label className="field-label">{t('gov.scheme.sourceLabel')}</label>
          <input className="field-input" value={source} onChange={(e) => setSource(e.target.value)} />
        </div>
      </div>

      {error ? <ErrorPanel error={error} /> : null}

      <div className="flex gap-2">
        <button type="button" className="btn-primary flex-1" disabled={!valid || busy} onClick={() => void save()}>
          {t('gov.scheme.create')}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          {t('gov.scheme.cancel')}
        </button>
      </div>
    </div>
  );
}

// --- FAQs --------------------------------------------------------------------------

function FaqsPanel({ me }: { me: AdminMe | null }): JSX.Element {
  const t = useT();
  const [list, setList] = useState<FaqItem[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [showForm, setShowForm] = useState(false);

  const load = (): void => {
    api
      .get<{ faqs: FaqItem[] }>('/api/government/faqs')
      .then((data) => setList(data.faqs))
      .catch(setError);
  };
  useEffect(load, []);

  return (
    <div className="space-y-4">
      {showForm ? (
        <FaqForm me={me} onCancel={() => setShowForm(false)} onSaved={() => { setShowForm(false); load(); }} />
      ) : (
        <button type="button" className="btn-primary" onClick={() => setShowForm(true)}>
          {t('gov.faq.newTitle')}
        </button>
      )}

      <div>
        <h3 className="text-sm font-semibold text-stone-900">{t('gov.faq.listTitle')}</h3>
        {error ? <ErrorPanel error={error} /> : null}
        {list === null ? (
          <Spinner label={t('admin.loading')} />
        ) : list.length === 0 ? (
          <p className="mt-2 text-sm text-stone-600">{t('gov.faq.empty')}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {list.map((faq) => (
              <li key={faq.id} className="card">
                <p className="text-sm font-semibold text-stone-900">{faq.question.en}</p>
                <p className="mt-1 text-sm text-stone-600">{faq.answer.en}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function FaqForm({
  me,
  onCancel,
  onSaved,
}: {
  me: AdminMe | null;
  onCancel: () => void;
  onSaved: () => void;
}): JSX.Element {
  const t = useT();
  const [fields, setFields] = useState<LangFields>(emptyLangFields);
  const [category, setCategory] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const setField = (lang: Language, key: 'a' | 'b', value: string): void =>
    setFields((current) => ({ ...current, [lang]: { ...current[lang], [key]: value } }));

  const valid = fields.en.a.trim().length > 0 && fields.en.b.trim().length > 0 && category.trim().length > 0;

  async function save(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/government/faqs', {
        category: category.trim(),
        questionEn: fields.en.a.trim(),
        questionTa: fields.ta.a.trim() || null,
        questionKn: fields.kn.a.trim() || null,
        questionHi: fields.hi.a.trim() || null,
        questionMl: fields.ml.a.trim() || null,
        answerEn: fields.en.b.trim(),
        answerTa: fields.ta.b.trim() || null,
        answerKn: fields.kn.b.trim() || null,
        answerHi: fields.hi.b.trim() || null,
        answerMl: fields.ml.b.trim() || null,
        scopeType: me?.scope === 'STATE' ? 'STATE' : 'DISTRICT',
        districtId: me?.scope === 'DISTRICT' ? me?.district?.id ?? null : null,
        stateId: me?.scope === 'STATE' ? me?.state?.id ?? null : null,
      });
      onSaved();
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3">
      <div>
        <label className="field-label">{t('gov.faq.categoryLabel')}</label>
        <input className="field-input" value={category} onChange={(e) => setCategory(e.target.value)} />
      </div>

      <LanguageBlock
        fields={fields}
        setField={setField}
        labelA={t('gov.faq.questionLabel')}
        labelB={t('gov.faq.answerLabel')}
        maxA={300}
        maxB={2000}
        multilineB
      />

      {error ? <ErrorPanel error={error} /> : null}

      <div className="flex gap-2">
        <button type="button" className="btn-primary flex-1" disabled={!valid || busy} onClick={() => void save()}>
          {t('gov.faq.create')}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          {t('gov.faq.cancel')}
        </button>
      </div>
    </div>
  );
}
