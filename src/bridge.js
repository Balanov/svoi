import { createInitialState, normalizeState, normalizeSites, cleanText, inferProfile, recordActivity, draftForVacancy, interviewPlan, rankVacancies, resumeMarkdown, safeUrl, normalizeHhVacancy } from '../shared/core.js';
import { offlineReply } from '../shared/assistant.js';

let state = createInitialState();
const STORAGE_KEY = 'svoi-preview-v1';
const save = next => { state = normalizeState(next); localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); return state; };
const vacancy = id => { const item = state.vacancies.find(v => v.id === id); if (!item) throw new Error('Вакансия не найдена'); return item; };
const updateApplication = ({ id, status, draft }) => {
  const application = state.applications.find(x => x.id === id);
  if (!application) throw new Error('Черновик не найден');
  let next = { ...state, applications: state.applications.map(x => x.id === id ? { ...x, status, draft: cleanText(draft, 4000), updatedAt: new Date().toISOString() } : x) };
  if (status === 'sent') next = recordActivity(next, 'application_confirmed', { subjectId: application.vacancyId });
  if (status === 'replied') next = recordActivity(next, 'reply_tracked', { subjectId: application.vacancyId });
  return save(next);
};

const browser = {
  isDesktop: false,
  async load() {
    try { state = normalizeState(JSON.parse(localStorage.getItem(STORAGE_KEY))); } catch { state = createInitialState(); }
    return { ...state, environment: { desktop: false, preview: true } };
  },
  async saveProfile(payload) {
    if (payload.confirmed !== true || !payload.profile?.role?.trim()) throw new Error('Укажите и подтвердите желаемую позицию');
    return save({ ...state, profile: { ...payload.profile, confirmed: true }, sites: normalizeSites(payload.sites) });
  },
  async importDocuments({ kind = 'resume' } = {}) {
    const files = await new Promise(resolve => {
      const input = document.createElement('input'); input.type = 'file'; input.multiple = true; input.accept = '.txt,.md,.csv,.json';
      input.onchange = () => resolve([...input.files]); input.click();
    });
    const documents = [];
    for (const file of files.slice(0, 10)) {
      if (file.size > 8_000_000) continue;
      documents.push({ id: crypto.randomUUID(), name: file.name, text: (await file.text()).slice(0, 24000), kind: kind === 'response' ? 'response' : 'resume' });
    }
    const all = [...state.documents, ...documents].slice(-10);
    return { state: save({ ...state, documents: all }), suggestedProfile: documents.length ? inferProfile(all) : null };
  },
  async search() {
    if (!state.profile.role) throw new Error('Укажите желаемую позицию');
    const hhSite = state.sites.find(site => /^(https?:\/\/)?(www\.)?hh\.ru/.test(site));
    if (!hhSite) return { state, found: 0, supportedSites: 0 };
    const url = new URL('https://api.hh.ru/vacancies'); url.searchParams.set('text', state.profile.role); url.searchParams.set('per_page', '50');
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HH.ru вернул HTTP ${response.status}`);
    const data = await response.json();
    const vacancies = rankVacancies(data.items.map(item => normalizeHhVacancy(item, hhSite)).filter(Boolean), state.profile);
    return { state: save({ ...state, vacancies: [...vacancies, ...state.vacancies.filter(old => !vacancies.some(v => v.id === old.id))].slice(0, 200) }), found: vacancies.length, supportedSites: 1 };
  },
  async review(id) { vacancy(id); return save(recordActivity(state, 'vacancy_reviewed', { subjectId: id })); },
  async draft(id) {
    const item = vacancy(id); const old = state.applications.find(x => x.vacancyId === id);
    const application = { id: old?.id || crypto.randomUUID(), vacancyId: id, title: item.title, company: item.company, url: item.url, draft: draftForVacancy(item, state.profile, state.documents), status: old?.status || 'draft', updatedAt: new Date().toISOString() };
    return save(recordActivity({ ...state, applications: old ? state.applications.map(x => x.id === old.id ? application : x) : [application, ...state.applications] }, 'draft_prepared', { subjectId: id }));
  },
  async addVacancy(payload) {
    const url = safeUrl(payload.url); if (!url || !cleanText(payload.title, 180)) throw new Error('Укажите название и корректную ссылку');
    const item = { ...payload, id: `manual-${crypto.randomUUID()}`, title: cleanText(payload.title, 180), url, source: new URL(url).hostname, skills: [], publishedAt: new Date().toISOString() };
    return save({ ...state, vacancies: [rankVacancies([item], state.profile)[0], ...state.vacancies] });
  },
  async updateApplication(payload) { return updateApplication(payload); },
  async replyDraft({ applicationId, incoming, intent = 'clarify' }) {
    const application = state.applications.find(x => x.id === applicationId);
    if (!application || !cleanText(incoming, 5000)) throw new Error('Выберите отклик и вставьте сообщение');
    const drafts = { accept: 'Здравствуйте! Спасибо за приглашение. Подтверждаю встречу в предложенное время. Пожалуйста, направьте ссылку или адрес и уточните, что стоит подготовить к разговору.', clarify: 'Здравствуйте! Спасибо за сообщение. Чтобы подготовиться к следующему шагу, уточните, пожалуйста, приоритетные задачи позиции и ожидаемый результат. После этого смогу предметно рассказать о релевантном опыте.', decline: 'Здравствуйте! Спасибо за предложение и уделённое время. Сейчас не готов продолжить по этой позиции. Буду признателен, если сохраните мои контакты на случай более подходящей роли.', followup: 'Здравствуйте! Возвращаюсь к нашему диалогу по позиции. Подскажите, пожалуйста, удалось ли определить следующий шаг? По-прежнему заинтересован в предметном разговоре.' };
    const draft = drafts[intent] || drafts.clarify;
    const next = save(recordActivity({ ...state, conversations: [{ id: crypto.randomUUID(), applicationId, incoming: cleanText(incoming, 5000), intent, draft }, ...state.conversations] }, 'reply_tracked', { subjectId: application.vacancyId }));
    return { state: next, draft };
  },
  async interview(id) { const item = vacancy(id); const plan = interviewPlan(item, state.profile); return { state: save(recordActivity(state, 'interview_prepared', { subjectId: id })), plan }; },
  async chat({ input, context }) {
    const result = offlineReply(input, state);
    let next = { ...state, messages: [...state.messages, { id: crypto.randomUUID(), role: 'user', text: cleanText(input, 2400) }, { id: crypto.randomUUID(), role: 'assistant', text: result.answer, mode: result.mode }].slice(-100) };
    if (context === 'work') next = recordActivity(next, 'work_session', { subjectId: crypto.randomUUID() });
    return save(next);
  },
  async addTask(payload) { return save(recordActivity({ ...state, tasks: [{ id: crypto.randomUUID(), title: cleanText(payload.title, 300), details: cleanText(payload.details, 4000), done: false }, ...state.tasks] }, 'work_session', { subjectId: crypto.randomUUID() })); },
  async toggleTask(id) { return save({ ...state, tasks: state.tasks.map(task => task.id === id ? { ...task, done: !task.done } : task) }); },
  async enableModel() { throw new Error('Локальная модель доступна в Windows-приложении, не в браузерном предпросмотре'); },
  async certificateCreate() { throw new Error('Создание сертификата проверяется в Windows-приложении'); },
  async certificateSync() { throw new Error('Создание сертификата доступно в Windows-приложении'); },
  async certificateRevoke() { throw new Error('Нет активного сертификата в предпросмотре'); },
  async certificatePurge() { throw new Error('Нет активного сертификата в предпросмотре'); },
  async exportResume() { const blob = new Blob([resumeMarkdown(state)], { type: 'text/markdown;charset=utf-8' }); const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'Свой-резюме.md'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000); return { saved: true }; },
  async openExternal(url) { const safe = safeUrl(url); if (!safe) throw new Error('Небезопасная ссылка'); window.open(safe, '_blank', 'noopener,noreferrer'); },
  async resetAll() { localStorage.removeItem(STORAGE_KEY); return save(createInitialState()); },
  onProgress() { return () => {}; },
};

export const api = window.svoi || browser;
