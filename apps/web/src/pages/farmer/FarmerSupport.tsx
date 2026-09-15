import { useEffect, useState } from 'react';
import {
  ALL_FEEDBACK_CATEGORIES,
  ALL_GRIEVANCE_CATEGORIES,
  pickLocalized,
} from '@kisansetu/shared';
import type {
  FaqItem,
  FeedbackView,
  GrievanceDetail,
  GrievanceListItem,
  HelplineEntry,
  SchemeDetail,
  SchemeListItem,
  SubmitFeedbackRequest,
  SubmitGrievanceRequest,
} from '@kisansetu/shared';
import { api } from '../../lib/api.js';
import { useI18n, useT } from '../../i18n/index.js';
import { FarmerHeader } from '../../components/farmer/FarmerHeader.js';
import { ErrorPanel } from '../../components/AppShell.js';
import { Spinner } from '../../components/Spinner.js';

type Tab = 'FEEDBACK' | 'GRIEVANCES' | 'HELPLINE' | 'SCHEMES' | 'FAQS';
const TABS: Tab[] = ['FEEDBACK', 'GRIEVANCES', 'HELPLINE', 'SCHEMES', 'FAQS'];

/**
 * Help & Support (§4, §6, §16, §23, §33) — one page, five tabs, so a farmer
 * has one place to remember instead of five. Every sub-feature keeps its own
 * fetch and its own state; nothing here is shared beyond the tab switch
 * itself.
 */
export function FarmerSupport(): JSX.Element {
  const t = useT();
  const [tab, setTab] = useState<Tab>('FEEDBACK');

  return (
    <div className="min-h-screen bg-stone-50">
      <FarmerHeader />
      <main className="mx-auto max-w-2xl space-y-4 px-4 py-6">
        <div>
          <h1 className="text-xl font-semibold text-stone-900">{t('support.title')}</h1>
          <p className="text-sm text-stone-600">{t('support.subtitle')}</p>
        </div>

        <div className="flex flex-wrap gap-2" role="tablist">
          {TABS.map((option) => (
            <button
              key={option}
              type="button"
              role="tab"
              aria-selected={tab === option}
              onClick={() => setTab(option)}
              className={`rounded-full px-3 py-1.5 text-sm font-medium transition ${
                tab === option
                  ? 'bg-harvest-600 text-white'
                  : 'bg-white text-stone-700 ring-1 ring-inset ring-stone-300'
              }`}
            >
              {t(`support.tab.${option.toLowerCase()}`)}
            </button>
          ))}
        </div>

        {tab === 'FEEDBACK' ? <FeedbackTab /> : null}
        {tab === 'GRIEVANCES' ? <GrievancesTab /> : null}
        {tab === 'HELPLINE' ? <HelplineTab /> : null}
        {tab === 'SCHEMES' ? <SchemesTab /> : null}
        {tab === 'FAQS' ? <FaqsTab /> : null}
      </main>
    </div>
  );
}

// --- Feedback ----------------------------------------------------------------

function FeedbackTab(): JSX.Element {
  const t = useT();
  const [category, setCategory] = useState<SubmitFeedbackRequest['category']>('GENERAL');
  const [rating, setRating] = useState<number | null>(null);
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [submitted, setSubmitted] = useState(false);
  const [history, setHistory] = useState<FeedbackView[] | null>(null);

  const load = (): void => {
    api
      .get<{ feedback: FeedbackView[] }>('/api/feedback/me')
      .then((data) => setHistory(data.feedback))
      .catch(() => setHistory([]));
  };
  useEffect(load, []);

  const valid = rating !== null || message.trim().length > 0;

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      await api.post<{ feedback: FeedbackView }>('/api/feedback', {
        category,
        rating,
        message: message.trim() || null,
      } satisfies SubmitFeedbackRequest);
      setSubmitted(true);
      setMessage('');
      setRating(null);
      load();
      setTimeout(() => setSubmitted(false), 4000);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <section className="space-y-4">
      <div className="card space-y-3">
        <p className="text-sm text-stone-600">{t('feedback.subtitle')}</p>

        <div>
          <label htmlFor="feedback-category" className="field-label">
            {t('feedback.categoryLabel')}
          </label>
          <select
            id="feedback-category"
            className="field-input"
            value={category}
            onChange={(event) => setCategory(event.target.value as SubmitFeedbackRequest['category'])}
          >
            {ALL_FEEDBACK_CATEGORIES.map((option) => (
              <option key={option} value={option}>
                {t(`feedback.category.${option}`)}
              </option>
            ))}
          </select>
        </div>

        <div>
          <p className="field-label">{t('feedback.ratingLabel')}</p>
          <div className="mt-1 flex gap-1">
            {[1, 2, 3, 4, 5].map((value) => (
              <button
                key={value}
                type="button"
                aria-pressed={rating === value}
                onClick={() => setRating(rating === value ? null : value)}
                className={`h-10 w-10 rounded-lg text-lg transition ${
                  rating !== null && value <= rating
                    ? 'bg-harvest-500 text-white'
                    : 'bg-white text-stone-400 ring-1 ring-inset ring-stone-300'
                }`}
              >
                ★
              </button>
            ))}
          </div>
        </div>

        <div>
          <label htmlFor="feedback-message" className="field-label">
            {t('feedback.messageLabel')}
          </label>
          <textarea
            id="feedback-message"
            className="field-input"
            rows={3}
            maxLength={2000}
            placeholder={t('feedback.messagePlaceholder')}
            value={message}
            onChange={(event) => setMessage(event.target.value)}
          />
        </div>

        {error ? <ErrorPanel error={error} /> : null}
        {submitted ? (
          <p className="rounded-lg bg-harvest-50 px-3 py-2 text-sm text-harvest-900">
            {t('feedback.submitted')}
          </p>
        ) : null}

        <button type="button" className="btn-primary" disabled={!valid || busy} onClick={() => void submit()}>
          {busy ? t('feedback.submitting') : t('feedback.submit')}
        </button>
      </div>

      <div>
        <h2 className="text-sm font-semibold text-stone-900">{t('feedback.historyTitle')}</h2>
        {history === null ? (
          <Spinner label={t('common.loading')} />
        ) : history.length === 0 ? (
          <p className="mt-2 text-sm text-stone-600">{t('feedback.empty')}</p>
        ) : (
          <ul className="mt-2 space-y-2">
            {history.map((item) => (
              <li key={item.id} className="card">
                <div className="flex items-center justify-between gap-2">
                  <span className="text-sm font-medium text-stone-900">
                    {t(`feedback.category.${item.category}`)}
                  </span>
                  {item.rating ? (
                    <span className="text-sm text-harvest-700">{'★'.repeat(item.rating)}</span>
                  ) : null}
                </div>
                {item.message ? <p className="mt-1 text-sm text-stone-600">{item.message}</p> : null}
                <p className="mt-1 text-xs text-stone-400">{new Date(item.createdAt).toLocaleString()}</p>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

// --- Grievances ----------------------------------------------------------------

function GrievancesTab(): JSX.Element {
  const t = useT();
  const [list, setList] = useState<GrievanceListItem[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);

  const load = (): void => {
    setError(null);
    api
      .get<{ grievances: GrievanceListItem[] }>('/api/grievances/me')
      .then((data) => setList(data.grievances))
      .catch(setError);
  };
  useEffect(load, []);

  if (selectedId) {
    return <GrievanceDetailView id={selectedId} onBack={() => { setSelectedId(null); load(); }} />;
  }

  return (
    <section className="space-y-4">
      {showForm ? (
        <NewGrievanceForm
          onCancel={() => setShowForm(false)}
          onSubmitted={(id) => {
            setShowForm(false);
            load();
            setSelectedId(id);
          }}
        />
      ) : (
        <button type="button" className="btn-primary w-full" onClick={() => setShowForm(true)}>
          {t('grievance.newTitle')}
        </button>
      )}

      <div>
        <h2 className="text-sm font-semibold text-stone-900">{t('grievance.listTitle')}</h2>
        {error ? <ErrorPanel error={error} /> : null}
        {list === null ? (
          <Spinner label={t('common.loading')} />
        ) : list.length === 0 ? (
          <p className="mt-2 text-sm text-stone-600">{t('grievance.empty')}</p>
        ) : (
          <ul className="mt-2 space-y-2">
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
                  {item.latestResponse ? (
                    <p className="mt-1 truncate text-sm text-stone-600">{item.latestResponse}</p>
                  ) : null}
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function NewGrievanceForm({
  onCancel,
  onSubmitted,
}: {
  onCancel: () => void;
  onSubmitted: (id: string) => void;
}): JSX.Element {
  const t = useT();
  const [category, setCategory] = useState<SubmitGrievanceRequest['category']>('OTHER');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);

  const valid = subject.trim().length >= 3 && description.trim().length >= 10;

  async function submit(): Promise<void> {
    setBusy(true);
    setError(null);
    try {
      const { grievance } = await api.post<{ grievance: GrievanceListItem }>('/api/grievances', {
        category,
        subject: subject.trim(),
        description: description.trim(),
      } satisfies SubmitGrievanceRequest);
      onSubmitted(grievance.id);
    } catch (cause) {
      setError(cause);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="card space-y-3">
      <p className="text-sm text-stone-600">{t('grievance.subtitle')}</p>

      <div>
        <label htmlFor="grievance-category" className="field-label">
          {t('grievance.categoryLabel')}
        </label>
        <select
          id="grievance-category"
          className="field-input"
          value={category}
          onChange={(event) => setCategory(event.target.value as SubmitGrievanceRequest['category'])}
        >
          {ALL_GRIEVANCE_CATEGORIES.map((option) => (
            <option key={option} value={option}>
              {t(`grievance.category.${option}`)}
            </option>
          ))}
        </select>
      </div>

      <div>
        <label htmlFor="grievance-subject" className="field-label">
          {t('grievance.subjectLabel')}
        </label>
        <input
          id="grievance-subject"
          className="field-input"
          maxLength={200}
          placeholder={t('grievance.subjectPlaceholder')}
          value={subject}
          onChange={(event) => setSubject(event.target.value)}
        />
      </div>

      <div>
        <label htmlFor="grievance-description" className="field-label">
          {t('grievance.descriptionLabel')}
        </label>
        <textarea
          id="grievance-description"
          className="field-input"
          rows={4}
          maxLength={4000}
          placeholder={t('grievance.descriptionPlaceholder')}
          value={description}
          onChange={(event) => setDescription(event.target.value)}
        />
      </div>

      {error ? <ErrorPanel error={error} /> : null}

      <div className="flex gap-2">
        <button type="button" className="btn-primary flex-1" disabled={!valid || busy} onClick={() => void submit()}>
          {busy ? t('grievance.submitting') : t('grievance.submit')}
        </button>
        <button type="button" className="btn-secondary" onClick={onCancel}>
          {t('common.cancel')}
        </button>
      </div>
    </div>
  );
}

function GrievanceDetailView({ id, onBack }: { id: string; onBack: () => void }): JSX.Element {
  const t = useT();
  const [detail, setDetail] = useState<GrievanceDetail | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [reply, setReply] = useState('');
  const [sending, setSending] = useState(false);

  const load = (): void => {
    api
      .get<{ grievance: GrievanceDetail }>(`/api/grievances/${id}`)
      .then((data) => setDetail(data.grievance))
      .catch(setError);
  };
  useEffect(load, [id]);

  async function sendReply(): Promise<void> {
    if (!reply.trim()) return;
    setSending(true);
    try {
      await api.post(`/api/grievances/${id}/responses`, { message: reply.trim() });
      setReply('');
      load();
    } catch (cause) {
      setError(cause);
    } finally {
      setSending(false);
    }
  }

  return (
    <section className="space-y-4">
      <button type="button" className="text-sm font-medium text-harvest-800 underline underline-offset-2" onClick={onBack}>
        ← {t('grievance.backToList')}
      </button>

      {error ? <ErrorPanel error={error} /> : null}

      {!detail ? (
        <Spinner label={t('common.loading')} />
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
              {t('grievance.reference')}: {detail.reference} · {t(`grievance.category.${detail.category}`)}
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

          <div className="card">
            <h3 className="text-sm font-semibold text-stone-900">{t('grievance.responsesTitle')}</h3>
            {detail.responses.length === 0 ? (
              <p className="mt-2 text-sm text-stone-600">{t('grievance.noResponses')}</p>
            ) : (
              <ul className="mt-2 space-y-2">
                {detail.responses.map((response) => (
                  <li key={response.id} className="rounded-lg bg-stone-50 p-2 text-sm text-stone-700">
                    {response.message}
                    <p className="mt-1 text-xs text-stone-400">{new Date(response.createdAt).toLocaleString()}</p>
                  </li>
                ))}
              </ul>
            )}

            <div className="mt-3 flex gap-2">
              <input
                className="field-input flex-1"
                placeholder={t('grievance.addResponsePlaceholder')}
                value={reply}
                onChange={(event) => setReply(event.target.value)}
              />
              <button
                type="button"
                className="btn-primary shrink-0"
                disabled={!reply.trim() || sending}
                onClick={() => void sendReply()}
              >
                {sending ? t('grievance.sending') : t('grievance.send')}
              </button>
            </div>
          </div>
        </>
      )}
    </section>
  );
}

// --- Helpline ------------------------------------------------------------------

function HelplineTab(): JSX.Element {
  const t = useT();
  const { language } = useI18n();
  const [entries, setEntries] = useState<HelplineEntry[] | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api
      .get<{ helpline: HelplineEntry[] }>('/api/helpline')
      .then((data) => setEntries(data.helpline))
      .catch(setError);
  }, []);

  return (
    <section className="space-y-3">
      <p className="text-sm text-stone-600">{t('helpline.subtitle')}</p>
      {error ? <ErrorPanel error={error} /> : null}
      {entries === null ? (
        <Spinner label={t('common.loading')} />
      ) : entries.length === 0 ? (
        <div className="card text-center">
          <p className="text-sm text-stone-700">{t('helpline.empty')}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {entries.map((entry) => (
            <li key={entry.id} className="card">
              <p className="text-sm font-semibold text-stone-900">{pickLocalized(entry.title, language)}</p>
              {entry.description ? (
                <p className="mt-1 text-sm text-stone-600">{pickLocalized(entry.description, language)}</p>
              ) : null}
              <div className="mt-2 flex flex-wrap gap-3 text-sm">
                {entry.phoneNumber ? (
                  <a href={`tel:${entry.phoneNumber}`} className="font-medium text-harvest-800">
                    {t('helpline.call')}: {entry.phoneNumber}
                  </a>
                ) : null}
                {entry.email ? (
                  <a href={`mailto:${entry.email}`} className="font-medium text-harvest-800">
                    {t('helpline.email')}: {entry.email}
                  </a>
                ) : null}
                {entry.officialUrl ? (
                  <a href={entry.officialUrl} target="_blank" rel="noreferrer" className="font-medium text-harvest-800">
                    {t('helpline.website')}
                  </a>
                ) : null}
              </div>
              {entry.lastVerifiedAt ? (
                <p className="mt-1 text-xs text-stone-400">
                  {t('helpline.verifiedOn', { date: new Date(entry.lastVerifiedAt).toLocaleDateString() })}
                </p>
              ) : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

// --- Government schemes ---------------------------------------------------------

function SchemesTab(): JSX.Element {
  const t = useT();
  const { language } = useI18n();
  const [list, setList] = useState<SchemeListItem[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [savedOnly, setSavedOnly] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const load = (): void => {
    setError(null);
    const query = savedOnly ? '?savedOnly=true' : '';
    api
      .get<{ schemes: SchemeListItem[] }>(`/api/schemes${query}`)
      .then((data) => setList(data.schemes))
      .catch(setError);
  };
  useEffect(load, [savedOnly]);

  async function toggleSave(scheme: SchemeListItem): Promise<void> {
    try {
      if (scheme.isSaved) await api.del(`/api/schemes/${scheme.id}/save`);
      else await api.post(`/api/schemes/${scheme.id}/save`);
      load();
    } catch (cause) {
      setError(cause);
    }
  }

  if (selectedId) {
    return <SchemeDetailView id={selectedId} onBack={() => { setSelectedId(null); load(); }} />;
  }

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-stone-600">{t('schemes.subtitle')}</p>
        <label className="flex shrink-0 items-center gap-1.5 text-sm text-stone-700">
          <input type="checkbox" checked={savedOnly} onChange={(event) => setSavedOnly(event.target.checked)} />
          {t('schemes.savedOnlyLabel')}
        </label>
      </div>

      {error ? <ErrorPanel error={error} /> : null}
      {list === null ? (
        <Spinner label={t('common.loading')} />
      ) : list.length === 0 ? (
        <div className="card text-center">
          <p className="text-sm text-stone-700">{t('schemes.empty')}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {list.map((scheme) => (
            <li key={scheme.id} className="card">
              <div className="flex items-start justify-between gap-2">
                <button type="button" className="text-left" onClick={() => setSelectedId(scheme.id)}>
                  <p className="text-sm font-semibold text-stone-900">{pickLocalized(scheme.name, language)}</p>
                  <p className="text-xs text-stone-500">
                    {t('schemes.authorityLabel')}: {scheme.authorityName}
                  </p>
                </button>
                <button
                  type="button"
                  onClick={() => void toggleSave(scheme)}
                  className={`shrink-0 rounded-lg border px-2 py-1 text-xs font-medium transition ${
                    scheme.isSaved
                      ? 'border-harvest-600 bg-harvest-50 text-harvest-900'
                      : 'border-stone-300 text-stone-700 hover:bg-stone-50'
                  }`}
                >
                  {scheme.isSaved ? t('schemes.unsave') : t('schemes.save')}
                </button>
              </div>
              {scheme.shortDescription ? (
                <p className="mt-1 text-sm text-stone-600">{pickLocalized(scheme.shortDescription, language)}</p>
              ) : null}
              {scheme.relevanceReasons.length > 0 ? (
                <p className="mt-1 text-xs text-harvest-700">
                  {t('schemes.relevantBecause')} {scheme.relevanceReasons.join(', ')}
                </p>
              ) : null}
              <button
                type="button"
                className="mt-2 text-sm font-medium text-harvest-800 underline underline-offset-2"
                onClick={() => setSelectedId(scheme.id)}
              >
                {t('schemes.viewDetail')}
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SchemeDetailView({ id, onBack }: { id: string; onBack: () => void }): JSX.Element {
  const t = useT();
  const { language } = useI18n();
  const [scheme, setScheme] = useState<SchemeDetail | null>(null);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    api
      .get<{ scheme: SchemeDetail }>(`/api/schemes/${id}`)
      .then((data) => setScheme(data.scheme))
      .catch(setError);
  }, [id]);

  return (
    <section className="space-y-4">
      <button type="button" className="text-sm font-medium text-harvest-800 underline underline-offset-2" onClick={onBack}>
        ← {t('schemes.backToList')}
      </button>

      {error ? <ErrorPanel error={error} /> : null}

      {!scheme ? (
        <Spinner label={t('common.loading')} />
      ) : (
        <div className="card space-y-3">
          <div>
            <h2 className="text-base font-semibold text-stone-900">{pickLocalized(scheme.name, language)}</h2>
            <p className="text-xs text-stone-500">
              {t('schemes.authorityLabel')}: {scheme.authorityName}
              {scheme.departmentName ? ` · ${scheme.departmentName}` : ''}
            </p>
          </div>

          {scheme.description ? <p className="text-sm text-stone-700">{pickLocalized(scheme.description, language)}</p> : null}

          {scheme.benefitSummary ? (
            <div>
              <p className="text-sm font-semibold text-stone-900">{t('schemes.detail.benefit')}</p>
              <p className="text-sm text-stone-600">{pickLocalized(scheme.benefitSummary, language)}</p>
            </div>
          ) : null}

          {scheme.eligibilitySummary ? (
            <div>
              <p className="text-sm font-semibold text-stone-900">{t('schemes.detail.eligibility')}</p>
              <p className="text-sm text-stone-600">{pickLocalized(scheme.eligibilitySummary, language)}</p>
            </div>
          ) : null}

          {scheme.documentsSummary ? (
            <div>
              <p className="text-sm font-semibold text-stone-900">{t('schemes.detail.documents')}</p>
              <p className="text-sm text-stone-600">{pickLocalized(scheme.documentsSummary, language)}</p>
            </div>
          ) : null}

          {scheme.applicationMethod ? (
            <div>
              <p className="text-sm font-semibold text-stone-900">{t('schemes.detail.apply')}</p>
              <p className="text-sm text-stone-600">{pickLocalized(scheme.applicationMethod, language)}</p>
            </div>
          ) : null}

          {scheme.officialUrl ? (
            <a href={scheme.officialUrl} target="_blank" rel="noreferrer" className="block text-sm font-medium text-harvest-800">
              {t('schemes.detail.officialLink')}
            </a>
          ) : null}

          <p className="text-xs text-stone-400">
            {t('schemes.detail.source')}: {scheme.sourceReference}
            {scheme.lastVerifiedAt
              ? ` · ${t('schemes.detail.verifiedOn', { date: new Date(scheme.lastVerifiedAt).toLocaleDateString() })}`
              : ''}
          </p>
        </div>
      )}
    </section>
  );
}

// --- FAQs ------------------------------------------------------------------------

function FaqsTab(): JSX.Element {
  const t = useT();
  const { language } = useI18n();
  const [faqs, setFaqs] = useState<FaqItem[] | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [openId, setOpenId] = useState<string | null>(null);

  useEffect(() => {
    api
      .get<{ faqs: FaqItem[] }>('/api/faqs')
      .then((data) => setFaqs(data.faqs))
      .catch(setError);
  }, []);

  return (
    <section className="space-y-3">
      <p className="text-sm text-stone-600">{t('faqs.subtitle')}</p>
      {error ? <ErrorPanel error={error} /> : null}
      {faqs === null ? (
        <Spinner label={t('common.loading')} />
      ) : faqs.length === 0 ? (
        <div className="card text-center">
          <p className="text-sm text-stone-700">{t('faqs.empty')}</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {faqs.map((faq) => {
            const open = openId === faq.id;
            return (
              <li key={faq.id} className="card">
                <button
                  type="button"
                  className="flex w-full items-center justify-between gap-2 text-left"
                  aria-expanded={open}
                  onClick={() => setOpenId(open ? null : faq.id)}
                >
                  <span className="text-sm font-medium text-stone-900">{pickLocalized(faq.question, language)}</span>
                  <span aria-hidden="true" className="shrink-0 text-stone-400">
                    {open ? '−' : '+'}
                  </span>
                </button>
                {open ? <p className="mt-2 text-sm text-stone-600">{pickLocalized(faq.answer, language)}</p> : null}
              </li>
            );
          })}
        </ul>
      )}
    </section>
  );
}
