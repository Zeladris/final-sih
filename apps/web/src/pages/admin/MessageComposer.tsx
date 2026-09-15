import { useEffect, useState } from 'react';
import { ALL_LANGUAGES, LANGUAGE_ENDONYM } from '@kisansetu/shared';
import type {
  AdminMe,
  CreateFarmerMessageRequest,
  FarmerMessageHistoryItem,
  Language,
} from '@kisansetu/shared';
import { api } from '../../lib/api.js';
import { useT } from '../../i18n/index.js';
import { AppShell, ErrorPanel } from '../../components/AppShell.js';
import { Spinner } from '../../components/Spinner.js';

interface ScopeCentre {
  id: string;
  name: string;
  districtId: string;
  districtName: string | null;
}

interface ScopeResponse {
  scope: 'DISTRICT' | 'STATE';
  districts: Array<{ id: string; name: string }>;
  centres: ScopeCentre[];
}

type Audience = 'FARMER' | 'CENTRE' | 'DISTRICT' | 'STATE';

/**
 * District/State Admin message composer + history (§21, §31, §43).
 *
 * One page for both roles: the frontend narrows which audience options are
 * offered (a District Admin never sees STATE), but that is a convenience,
 * not the authorization boundary — the backend re-validates every target
 * against the caller's real scope regardless of what this form ever shows.
 */
export function MessageComposer(): JSX.Element {
  const t = useT();
  const [tab, setTab] = useState<'COMPOSE' | 'HISTORY'>('COMPOSE');
  const [me, setMe] = useState<AdminMe | null>(null);
  const [scope, setScope] = useState<ScopeResponse | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    Promise.all([
      api.get<AdminMe>('/api/admin/me'),
      api.get<ScopeResponse>('/api/admin/centres'),
    ])
      .then(([meData, scopeData]) => {
        setMe(meData);
        setScope(scopeData);
      })
      .catch(setError);
  }, []);

  if (error) {
    return (
      <AppShell title={t('messages.title')}>
        <ErrorPanel error={error} />
      </AppShell>
    );
  }
  if (!me || !scope) {
    return (
      <AppShell title={t('messages.title')}>
        <Spinner label={t('admin.loading')} />
      </AppShell>
    );
  }

  return (
    <AppShell title={t('messages.title')} subtitle={t('messages.subtitle')}>
      <div className="flex gap-2">
        {(['COMPOSE', 'HISTORY'] as const).map((option) => (
          <button
            key={option}
            type="button"
            onClick={() => setTab(option)}
            className={`rounded-full px-4 py-1.5 text-sm font-medium transition ${
              tab === option ? 'bg-harvest-600 text-white' : 'bg-white text-stone-700 ring-1 ring-inset ring-stone-300'
            }`}
          >
            {t(option === 'COMPOSE' ? 'messages.tab.compose' : 'messages.tab.history')}
          </button>
        ))}
      </div>

      {tab === 'COMPOSE' ? <Composer me={me} scope={scope} onPublished={() => setTab('HISTORY')} /> : <History />}
    </AppShell>
  );
}

function Composer({
  me,
  scope,
  onPublished,
}: {
  me: AdminMe;
  scope: ScopeResponse;
  onPublished: () => void;
}): JSX.Element {
  const t = useT();
  const [audience, setAudience] = useState<Audience>('DISTRICT');
  const [districtId, setDistrictId] = useState('');
  const [centreId, setCentreId] = useState('');
  const [farmerId, setFarmerId] = useState('');
  // One field pair per language rather than ten separate useState calls
  // (§51, §94) — English is required, the other four are each optional and
  // independent: a message can ship with only some languages filled in, and
  // §95's completion indicator below shows exactly which.
  const emptyContent = (): Record<Language, { title: string; body: string }> =>
    Object.fromEntries(ALL_LANGUAGES.map((lang) => [lang, { title: '', body: '' }])) as Record<
      Language,
      { title: string; body: string }
    >;
  const [content, setContent] = useState(emptyContent);
  const setField = (lang: Language, field: 'title' | 'body', value: string): void =>
    setContent((current) => ({ ...current, [lang]: { ...current[lang], [field]: value } }));
  const [priority, setPriority] = useState<'LOW' | 'NORMAL' | 'HIGH' | 'URGENT'>('NORMAL');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [publishedCount, setPublishedCount] = useState<number | null>(null);

  const availableAudiences: Audience[] =
    me.role === 'STATE_ADMIN' ? ['FARMER', 'CENTRE', 'DISTRICT', 'STATE'] : ['FARMER', 'CENTRE', 'DISTRICT'];

  // A District Admin has exactly one district; a State Admin picks one from
  // their own state's list (never types an id) — the dropdown itself cannot
  // offer a district outside scope (§21).
  const districtOptions =
    me.role === 'DISTRICT_ADMIN' && me.district ? [me.district] : scope.districts;

  const centreOptions = districtId
    ? scope.centres.filter((centre) => centre.districtId === districtId)
    : scope.centres;

  const valid =
    content.en.title.trim().length > 0 &&
    content.en.body.trim().length > 0 &&
    ((audience === 'FARMER' && farmerId.trim().length > 0) ||
      (audience === 'CENTRE' && centreId.length > 0) ||
      (audience === 'DISTRICT' && districtId.length > 0) ||
      audience === 'STATE');

  async function publish(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const body: CreateFarmerMessageRequest = {
        audienceType: audience,
        audienceFarmerId: audience === 'FARMER' ? farmerId.trim() : null,
        audienceCentreId: audience === 'CENTRE' ? centreId : null,
        audienceDistrictId: audience === 'DISTRICT' ? districtId || me.district?.id || null : null,
        audienceStateId: audience === 'STATE' ? me.state?.id ?? null : null,
        titleEn: content.en.title.trim(),
        bodyEn: content.en.body.trim(),
        titleTa: content.ta.title.trim() || null,
        bodyTa: content.ta.body.trim() || null,
        titleKn: content.kn.title.trim() || null,
        bodyKn: content.kn.body.trim() || null,
        titleHi: content.hi.title.trim() || null,
        bodyHi: content.hi.body.trim() || null,
        titleMl: content.ml.title.trim() || null,
        bodyMl: content.ml.body.trim() || null,
        priority,
      };
      const { message } = await api.post<{ message: { recipientCount: number } }>(
        '/api/farmer-messages',
        body,
      );
      setPublishedCount(message.recipientCount);
      setContent(emptyContent());
      setTimeout(onPublished, 1200);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="card mt-4 space-y-4">
      <fieldset>
        <legend className="field-label">{t('messages.audience')}</legend>
        <div className="mt-2 flex flex-wrap gap-2">
          {availableAudiences.map((option) => (
            <button
              key={option}
              type="button"
              aria-pressed={audience === option}
              onClick={() => setAudience(option)}
              className={`rounded-lg border px-3 py-1.5 text-sm transition ${
                audience === option
                  ? 'border-harvest-600 bg-harvest-50 text-harvest-900'
                  : 'border-stone-300 text-stone-700 hover:bg-stone-50'
              }`}
            >
              {t(`messages.audience.${option}`)}
            </button>
          ))}
        </div>
      </fieldset>

      {audience === 'FARMER' ? (
        <div>
          <label htmlFor="farmerId" className="field-label">
            {t('messages.farmerId')}
          </label>
          <input
            id="farmerId"
            className="field-input"
            value={farmerId}
            onChange={(event) => setFarmerId(event.target.value)}
            placeholder={t('messages.farmerIdHelp')}
          />
        </div>
      ) : null}

      {audience === 'CENTRE' || audience === 'DISTRICT' ? (
        <div>
          <label htmlFor="districtId" className="field-label">
            {t('messages.district')}
          </label>
          <select
            id="districtId"
            className="field-input"
            value={districtId}
            onChange={(event) => {
              setDistrictId(event.target.value);
              setCentreId('');
            }}
          >
            <option value="">{t('messages.selectDistrict')}</option>
            {districtOptions.map((district) => (
              <option key={district.id} value={district.id}>
                {district.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {audience === 'CENTRE' ? (
        <div>
          <label htmlFor="centreId" className="field-label">
            {t('messages.centre')}
          </label>
          <select
            id="centreId"
            className="field-input"
            value={centreId}
            onChange={(event) => setCentreId(event.target.value)}
          >
            <option value="">{t('messages.selectCentre')}</option>
            {centreOptions.map((centre) => (
              <option key={centre.id} value={centre.id}>
                {centre.name}
              </option>
            ))}
          </select>
        </div>
      ) : null}

      {audience === 'STATE' ? (
        <p className="rounded-lg bg-stone-50 px-3 py-2 text-sm text-stone-700">
          {t('messages.stateWideNote', { state: me.state?.name ?? '' })}
        </p>
      ) : null}

      {/* Stacked, one language at a time (§94 — mobile prefers stacked
          sections over cramped tabs), with a completion summary so an
          incomplete translation is always visible, never implied (§95). */}
      <div>
        <p className="field-label">{t('messages.translationProgress')}</p>
        <div className="mt-1 flex flex-wrap gap-2">
          {ALL_LANGUAGES.map((lang) => {
            const done = content[lang].title.trim().length > 0 && content[lang].body.trim().length > 0;
            return (
              <span
                key={lang}
                className={`rounded-full px-2.5 py-1 text-xs font-medium ${
                  done ? 'bg-harvest-100 text-harvest-800' : 'bg-stone-100 text-stone-500'
                }`}
              >
                {LANGUAGE_ENDONYM[lang]} {done ? '✓' : ''}
              </span>
            );
          })}
        </div>
      </div>

      {ALL_LANGUAGES.map((lang) => (
        <div key={lang} className="rounded-lg border border-stone-200 p-3">
          <p className="text-sm font-semibold text-stone-900">
            {LANGUAGE_ENDONYM[lang]}
            {lang !== 'en' ? (
              <span className="ml-1 font-normal text-stone-400">({t('common.optional')})</span>
            ) : null}
          </p>
          <div className="mt-2 space-y-3">
            <div>
              <label htmlFor={`title-${lang}`} className="field-label">
                {t('messages.titleField')}
              </label>
              <input
                id={`title-${lang}`}
                className="field-input"
                maxLength={200}
                value={content[lang].title}
                onChange={(event) => setField(lang, 'title', event.target.value)}
              />
            </div>
            <div>
              <label htmlFor={`body-${lang}`} className="field-label">
                {t('messages.bodyField')}
              </label>
              <textarea
                id={`body-${lang}`}
                rows={3}
                className="field-input"
                maxLength={2000}
                value={content[lang].body}
                onChange={(event) => setField(lang, 'body', event.target.value)}
              />
            </div>
          </div>
        </div>
      ))}

      <div>
        <label htmlFor="priority" className="field-label">
          {t('messages.priority')}
        </label>
        <select
          id="priority"
          className="field-input max-w-xs"
          value={priority}
          onChange={(event) => setPriority(event.target.value as typeof priority)}
        >
          {(['LOW', 'NORMAL', 'HIGH', 'URGENT'] as const).map((option) => (
            <option key={option} value={option}>
              {t(`notification.priority.${option}`)}
            </option>
          ))}
        </select>
      </div>

      {error ? <ErrorPanel error={error} /> : null}
      {publishedCount !== null ? (
        <p className="rounded-lg bg-harvest-50 px-3 py-2 text-sm text-harvest-900">
          {t('messages.published', { count: publishedCount })}
        </p>
      ) : null}

      <button type="button" className="btn-primary" disabled={!valid || busy} onClick={() => void publish()}>
        {busy ? t('messages.publishing') : t('messages.publish')}
      </button>
    </section>
  );
}

function History(): JSX.Element {
  const t = useT();
  const [messages, setMessages] = useState<FarmerMessageHistoryItem[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api
      .get<{ messages: FarmerMessageHistoryItem[] }>('/api/farmer-messages')
      .then((data) => setMessages(data.messages))
      .catch(setError);
  }, []);

  if (error) return <ErrorPanel error={error} />;
  if (!messages) return <Spinner label={t('admin.loading')} />;

  if (messages.length === 0) {
    return (
      <section className="card mt-4 text-center">
        <p className="text-sm text-stone-600">{t('messages.historyEmpty')}</p>
      </section>
    );
  }

  return (
    <ul className="mt-4 space-y-2">
      {messages.map((message) => (
        <li key={message.id} className="card">
          <div className="flex items-start justify-between gap-2">
            <p className="font-medium text-stone-900">{message.titleEn}</p>
            <span className="shrink-0 text-xs text-stone-500">
              {t(`messages.audience.${message.audienceType}`)}
            </span>
          </div>
          <p className="mt-1 text-sm text-stone-600">{message.bodyEn}</p>
          <div className="mt-2 flex flex-wrap gap-1">
            {ALL_LANGUAGES.map((lang) => (
              <span
                key={lang}
                className={`rounded-full px-2 py-0.5 text-xs ${
                  message.translationStatus[lang]
                    ? 'bg-harvest-100 text-harvest-800'
                    : 'bg-stone-100 text-stone-400'
                }`}
              >
                {LANGUAGE_ENDONYM[lang]}
              </span>
            ))}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-stone-500">
            <span>{t('messages.stats.recipients', { count: message.recipientCount })}</span>
            <span>{t('messages.stats.read', { count: message.readCount })}</span>
            <span>{new Date(message.publishedAt).toLocaleString()}</span>
            {message.status === 'EXPIRED' ? (
              <span className="font-medium text-amber-700">{t('messages.expired')}</span>
            ) : null}
          </div>
        </li>
      ))}
    </ul>
  );
}
