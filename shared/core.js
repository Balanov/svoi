export const APP_VERSION = '1.0.0';
export const CERTIFICATE_ORIGIN = 'https://svoi.balanov.pro';
export const COUNTER_KEYS = Object.freeze(['vacanciesReviewed', 'draftsPrepared', 'applicationsConfirmed', 'repliesTracked', 'interviewsPrepared', 'workSessions', 'activityDays']);
export const STATUSES = new Set(['search', 'working', 'paused']);
export const MAX_TEXT = 24000;

export function cleanText(value, max = 500) {
  return String(value ?? '').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '').trim().slice(0, max);
}

export function safeUrl(value) {
  try {
    const raw = cleanText(value, 500);
    if (!raw || /^(javascript|data|file|vbscript):/i.test(raw)) return null;
    const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    if (!['https:', 'http:'].includes(url.protocol) || url.username || url.password || !url.hostname.includes('.') || /\s/.test(url.hostname)) return null;
    url.hash = '';
    return url.toString();
  } catch { return null; }
}

export function normalizeSites(values) {
  if (!Array.isArray(values)) return [];
  return [...new Set(values.map(safeUrl).filter(Boolean))].slice(0, 12);
}

export function hhSearchUrl(site, profile) {
  const host = safeUrl(site) && new URL(safeUrl(site)).hostname.toLowerCase();
  if (!host || !(host === 'hh.ru' || host.endsWith('.hh.ru'))) return null;
  const url = new URL('https://api.hh.ru/vacancies');
  url.searchParams.set('text', cleanText(profile.role, 120));
  if (profile.city) url.searchParams.set('text', `${profile.role} ${cleanText(profile.city, 60)}`);
  url.searchParams.set('per_page', '50');
  url.searchParams.set('page', '0');
  url.searchParams.set('order_by', 'publication_time');
  return url.toString();
}

export const SKILL_LEXICON = ['JavaScript', 'TypeScript', 'Python', 'Java', 'Kotlin', 'Swift', 'C#', 'C++', 'SQL', 'Excel', 'Power BI', 'Figma', 'Photoshop', 'Illustrator', 'AutoCAD', '1С', 'React', 'Vue', 'Node.js', 'Docker', 'Kubernetes', 'Git', 'HTML', 'CSS', 'PHP', 'Linux', 'ML', 'LLM', 'CRM', 'Bitrix24', 'SAP', '_project management', 'Agile', 'Scrum', 'аналитика', 'тестирование', 'продажи', 'переговоры', 'маркетинг', 'копирайтинг', 'дизайн', 'управление проектами', 'подбор персонала', 'бухгалтерия', 'логистика', 'техническая поддержка', 'техническое писательство'];

export function extractSkills(text) {
  const source = String(text || '');
  return SKILL_LEXICON.map(item => item.replace(/^_/, '')).filter(skill => {
    const escaped = skill.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    return new RegExp(`(^|[^a-zA-Zа-яА-Я0-9])${escaped}([^a-zA-Zа-яА-Я0-9]|$)`, 'iu').test(source);
  }).slice(0, 20);
}

export function inferProfile(documents) {
  const text = (Array.isArray(documents) ? documents : []).map(doc => cleanText(doc?.text, MAX_TEXT)).filter(Boolean).join('\n').slice(0, 80000);
  const beginning = text.slice(0, 2200);
  const name = beginning.match(/(?:ФИО|Ф\.?\s?И\.?\s?О\.?)\s*[:\-]?\s*([А-ЯЁ][а-яё]+(?:-[А-ЯЁ][а-яё]+)?\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+)/u)?.[1]
    || beginning.match(/(?:^|\n)\s*([А-ЯЁ][а-яё]{1,40}\s+[А-ЯЁ][а-яё]{1,40}\s+[А-ЯЁ][а-яё]{1,40})(?=\s*\n)/u)?.[1] || '';
  const role = text.match(/(?:Желаемая должность|Желаемая позиция|Должность|Позиция|Цель)\s*[:\-]?\s*([^\n\r|]{2,100})/iu)?.[1]?.trim() || '';
  const city = text.match(/(?:Город|Местоположение|Проживает)\s*[:\-]?\s*([^\n\r|]{2,70})/iu)?.[1]?.trim() || '';
  return { name: cleanText(name, 100), role: cleanText(role, 120), city: cleanText(city, 70), skills: extractSkills(text) };
}

export function emptyCounters() {
  return Object.fromEntries(COUNTER_KEYS.map(key => [key, 0]));
}

export function createInitialState() {
  return {
    version: 1,
    profile: { name: '', role: '', city: '', skills: [], salary: '', about: '', confirmed: false },
    sites: [],
    documents: [],
    vacancies: [],
    applications: [],
    conversations: [],
    messages: [],
    tasks: [],
    events: [],
    counters: emptyCounters(),
    activeDates: [],
    certificate: null,
    settings: { localModelEnabled: false, searchIntervalHours: 6, notifications: true },
    updatedAt: null,
  };
}

export function normalizeState(value) {
  const base = createInitialState();
  if (!value || typeof value !== 'object' || Array.isArray(value)) return base;
  const profile = value.profile && typeof value.profile === 'object' ? value.profile : {};
  const state = {
    ...base,
    profile: {
      name: cleanText(profile.name, 100), role: cleanText(profile.role, 120), city: cleanText(profile.city, 70),
      skills: Array.isArray(profile.skills) ? profile.skills.map(x => cleanText(x, 60)).filter(Boolean).slice(0, 20) : [],
      salary: cleanText(profile.salary, 60), about: cleanText(profile.about, 12000), confirmed: profile.confirmed === true,
    },
    sites: normalizeSites(value.sites),
    documents: Array.isArray(value.documents) ? value.documents.slice(0, 10).map(doc => ({ id: cleanText(doc.id, 70), name: cleanText(doc.name, 200), text: cleanText(doc.text, MAX_TEXT), kind: doc.kind === 'response' ? 'response' : 'resume' })) : [],
    vacancies: Array.isArray(value.vacancies) ? value.vacancies.slice(0, 200) : [],
    applications: Array.isArray(value.applications) ? value.applications.slice(0, 500) : [],
    conversations: Array.isArray(value.conversations) ? value.conversations.slice(0, 500) : [],
    messages: Array.isArray(value.messages) ? value.messages.slice(-100) : [],
    tasks: Array.isArray(value.tasks) ? value.tasks.slice(0, 300) : [],
    events: Array.isArray(value.events) ? value.events.slice(-5000) : [],
    counters: Object.fromEntries(COUNTER_KEYS.map(key => [key, clampCounter(value.counters?.[key])])),
    activeDates: Array.isArray(value.activeDates) ? [...new Set(value.activeDates.filter(x => /^\d{4}-\d{2}-\d{2}$/.test(x)))].slice(-3660) : [],
    certificate: value.certificate && typeof value.certificate === 'object' ? {
      id: cleanText(value.certificate.id, 30), url: safeUrl(value.certificate.url), secret: cleanText(value.certificate.secret, 128),
      displayName: cleanText(value.certificate.displayName, 80), active: value.certificate.active === true,
      status: STATUSES.has(value.certificate.status) ? value.certificate.status : 'search',
    } : null,
    settings: { localModelEnabled: value.settings?.localModelEnabled === true, searchIntervalHours: [3, 6, 12, 24].includes(value.settings?.searchIntervalHours) ? value.settings.searchIntervalHours : 6, notifications: value.settings?.notifications !== false },
    updatedAt: cleanText(value.updatedAt, 40) || null,
  };
  state.counters.activityDays = state.activeDates.length;
  return state;
}

function clampCounter(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.min(1_000_000_000, Math.max(0, Math.floor(number))) : 0;
}

export function recordActivity(state, type, payload = {}, at = new Date()) {
  const increments = {
    vacancy_reviewed: 'vacanciesReviewed', draft_prepared: 'draftsPrepared', application_confirmed: 'applicationsConfirmed',
    reply_tracked: 'repliesTracked', interview_prepared: 'interviewsPrepared', work_session: 'workSessions',
  };
  const date = at.toISOString().slice(0, 10);
  const activeDates = [...new Set([...state.activeDates, date])].sort().slice(-3660);
  const subjectId = cleanText(payload.subjectId, 100);
  const duplicate = subjectId && state.events.some(event => event.type === type && event.subjectId === subjectId);
  const counters = { ...state.counters, activityDays: activeDates.length };
  const counter = increments[type];
  if (counter && !duplicate) counters[counter] = clampCounter(counters[counter] + 1);
  const events = duplicate ? state.events : [...state.events, { id: `${at.getTime().toString(36)}-${Math.random().toString(36).slice(2, 9)}`, type, at: at.toISOString(), subjectId }].slice(-5000);
  return { ...state, counters, activeDates, events, updatedAt: at.toISOString() };
}

export function certificatePayload(state, { displayName, status = 'search', consent = false } = {}) {
  if (consent !== true) throw new Error('Нужно явное согласие на публикацию сертификата');
  if (!STATUSES.has(status)) throw new Error('Неизвестный статус поиска');
  return {
    version: 1,
    displayName: cleanText(displayName, 80) || 'Оператор Своего',
    status,
    counters: Object.fromEntries(COUNTER_KEYS.map(key => [key, clampCounter(state.counters[key])])),
    consent: true,
  };
}

export function publicCertificateView(record) {
  if (!record || record.active !== true) return null;
  return { id: record.id, displayName: record.displayName, status: record.status, counters: Object.fromEntries(COUNTER_KEYS.map(key => [key, clampCounter(record.counters?.[key])])), startedAt: record.startedAt, updatedAt: record.updatedAt };
}

export function rankVacancies(vacancies, profile) {
  const words = new Set(cleanText(profile.role, 120).toLocaleLowerCase('ru').split(/[^\p{L}\p{N}+#]+/u).filter(word => word.length > 2));
  const skills = profile.skills.map(x => x.toLocaleLowerCase('ru'));
  return vacancies.map(vacancy => {
    const title = cleanText(vacancy.title, 200).toLocaleLowerCase('ru');
    const haystack = `${title} ${cleanText(vacancy.snippet, 1500)} ${(vacancy.skills || []).join(' ')}`.toLocaleLowerCase('ru');
    const titleMatches = [...words].filter(word => title.includes(word)).length;
    const skillMatches = skills.filter(skill => haystack.includes(skill)).length;
    const roleScore = words.size ? Math.round(titleMatches / words.size * 60) : 0;
    const skillScore = Math.min(30, skillMatches * 6);
    const score = Math.min(95, roleScore + skillScore + 10);
    const matchedSkills = (vacancy.skills || []).filter(skill => skills.includes(skill.toLocaleLowerCase('ru')));
    return { ...vacancy, score, matchedSkills };
  }).sort((a, b) => b.score - a.score || String(b.publishedAt).localeCompare(String(a.publishedAt)));
}

export function normalizeHhVacancy(item, sourceUrl) {
  if (!item || !item.id || !item.name) return null;
  const url = safeUrl(item.alternate_url) || safeUrl(sourceUrl);
  if (!url) return null;
  const strip = value => cleanText(String(value || '').replace(/<[^>]*>/g, ' '), 1400);
  const salary = item.salary ? `${item.salary.from ? `от ${item.salary.from.toLocaleString('ru-RU')} ` : ''}${item.salary.to ? `до ${item.salary.to.toLocaleString('ru-RU')} ` : ''}${item.salary.currency || ''}`.trim() : 'Зарплата не указана';
  return {
    id: `hh-${cleanText(item.id, 40)}`, source: 'HH.ru', title: cleanText(item.name, 180), company: cleanText(item.employer?.name, 160),
    city: cleanText(item.area?.name, 90), salary: cleanText(salary, 100), url,
    snippet: `${strip(item.snippet?.requirement)} ${strip(item.snippet?.responsibility)}`.trim(),
    skills: (item.key_skills || []).map(x => cleanText(x.name, 50)).filter(Boolean).slice(0, 15),
    publishedAt: cleanText(item.published_at, 40), score: 0, matchedSkills: [],
  };
}

export function draftForVacancy(vacancy, profile, documents = []) {
  const resume = documents.find(doc => doc.kind === 'resume');
  const skills = vacancy.matchedSkills?.length ? vacancy.matchedSkills : profile.skills.slice(0, 4);
  const evidence = skills.length ? `Использую ${skills.join(', ')} — подробности и примеры есть в резюме.` : 'Буду рад рассказать о релевантном опыте и показать примеры работ.';
  return cleanText(`Здравствуйте! Меня заинтересовала позиция «${vacancy.title}»${vacancy.company ? ` в компании ${vacancy.company}` : ''}.\n\n${evidence}\n\nВ описании вакансии обратил внимание на: ${vacancy.snippet ? vacancy.snippet.slice(0, 280) : 'предложенные задачи и формат работы'}.\n\nБуду рад короткому знакомству и уточнению приоритетов первого месяца.\n\n${profile.name || 'С уважением'}`, 4000) + (resume ? '\n\nРезюме приложено к отклику.' : '');
}

export function interviewPlan(vacancy, profile) {
  const skills = (vacancy.skills?.length ? vacancy.skills : profile.skills).slice(0, 5);
  return {
    questions: [
      `Какая задача позиции «${vacancy.title}» самая важная в первые три месяца?`,
      'По каким observable-метрикам поймут, что человек справляется?',
      'Как устроены рабочий процесс, приоритизация и обратная связь?',
      'Какие условия, этапы отбора и следующий шаг можно зафиксировать сейчас?',
    ],
    stories: skills.map(skill => ({ skill, prompt: `Подготовьте пример про ${skill}: контекст → ваша роль → действия → проверяемый результат. Без выдуманных цифр.` })),
    checklist: ['Сверить обязанности с реальным опытом', 'Выписать 3 конкретных примера из практики', 'Проверить условия и ожидания до согласия', 'После встречи записать договорённости'],
  };
}

export function resumeMarkdown(state) {
  const { profile, certificate } = state;
  return `# ${profile.name || 'Резюме'}\n\n**Желаемая позиция:** ${profile.role || 'Не указана'}\n\n**Город:** ${profile.city || 'Не указан'}\n\n**Навыки:** ${profile.skills.join(', ') || 'Не указаны'}\n\n${profile.about || ''}\n${certificate?.active ? `\n**Дневник использования «Своего»:** ${certificate.url}\n\nЭто ссылка на счётчики действий в программе, а не подтверждение квалификации.\n` : ''}`;
}
