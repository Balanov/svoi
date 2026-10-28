import { load } from 'cheerio';
import { hhSearchUrl, normalizeHhVacancy, rankVacancies, safeUrl, cleanText } from '../shared/core.js';

function checkHhAccess($) {
  const visibleText = $('body').clone().find('script,style,noscript,template').remove().end().text().replace(/\s+/g, ' ').slice(0, 4000);
  if (/captcha|доступ запрещ[её]н/i.test($('title').text()) || /доступ запрещ[её]н|подтвердите, что вы человек/i.test(visibleText)) throw new Error('HH.ru запросил проверку доступа. Откройте сайт в браузере — обходить её не будем.');
}

export function hhCompensationText(compensation) {
  if (!compensation || compensation.noCompensation) return 'Зарплата не указана';
  const currencies = { RUR: '₽', RUB: '₽', KZT: '₸', UZS: 'сум', KGS: 'сом', USD: '$', EUR: '€', BYR: 'Br' };
  const from = Number.isFinite(compensation.from) ? `от ${compensation.from.toLocaleString('ru-RU')} ` : '';
  const to = Number.isFinite(compensation.to) ? `до ${compensation.to.toLocaleString('ru-RU')} ` : '';
  if (!from && !to) return 'Зарплата не указана';
  const currency = currencies[compensation.currencyCode] || cleanText(compensation.currencyCode, 10);
  const tax = compensation.gross === true ? ' до вычета налогов' : compensation.gross === false ? ' на руки' : '';
  return cleanText(`${from}${to}${currency}${tax}`, 120);
}

export function parseHhSearchPage(html, profile) {
  const $ = load(html);
  checkHhAccess($);
  let initial = {};
  try { initial = JSON.parse($('template#HH-Lux-InitialState').text()); } catch { /* Карточки HTML остаются независимым источником. */ }
  const states = new Map((Array.isArray(initial.vacancySearchResult?.vacancies) ? initial.vacancySearchResult.vacancies : []).map(item => [String(item.vacancyId), item]));
  const vacancies = $('[data-qa="vacancy-serp__vacancy"]').slice(0, 50).map((_, element) => {
    const card = $(element);
    const link = card.find('[data-qa="serp-item__title"]').first();
    const href = safeUrl(link.attr('href'));
    const id = href?.match(/\/vacancy\/(\d+)/)?.[1];
    if (!id || !href || !/^https:\/\/([a-z0-9-]+\.)?hh\.ru\//i.test(href)) return null;
    const state = states.get(id);
    const vacancy = normalizeHhVacancy({
      id, name: link.text(), alternate_url: `https://hh.ru/vacancy/${id}`,
      employer: { name: card.find('[data-qa="vacancy-serp__vacancy-employer"]').first().text() },
      area: { name: card.find('[data-qa="vacancy-serp__vacancy-address"]').first().text() },
      published_at: state?.publicationTime?.$ || '',
      snippet: {
        requirement: card.find('[data-qa="vacancy-serp__vacancy_snippet_requirement"]').first().text(),
        responsibility: card.find('[data-qa="vacancy-serp__vacancy_snippet_responsibility"]').first().text(),
      },
      salary: { from: null, to: null, currency: '' },
    }, 'https://hh.ru/');
    const salary = cleanText(card.find('[data-qa="vacancy-serp__vacancy-compensation"]').first().text(), 120) || hhCompensationText(state?.compensation);
    return { ...vacancy, salary };
  }).get().filter(Boolean);
  if (!vacancies.length) throw new Error('Не удалось прочитать карточки HH.ru. Откройте поиск в браузере или добавьте вакансию по ссылке.');
  return rankVacancies(vacancies, profile);
}

export function parseHhVacancyPage(html, vacancy) {
  const $ = load(html);
  checkHhAccess($);
  const description = cleanText($('[data-qa="vacancy-description"]').text().replace(/\s+/g, ' '), 12000);
  if (!description) throw new Error('HH.ru не отдал описание вакансии. Откройте источник и проверьте его в браузере.');
  const skills = $('[data-qa="skills-element"]').map((_, element) => cleanText($(element).text(), 80)).get().filter(Boolean).slice(0, 20);
  return { ...vacancy, snippet: description, skills: skills.length ? skills : vacancy.skills };
}

export async function fetchHhVacancyDetails(vacancy, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const id = String(vacancy?.id || '').match(/^hh-(\d+)$/)?.[1];
  if (!id) return vacancy;
  const url = safeUrl(vacancy.url);
  if (!url || !/^https:\/\/([a-z0-9-]+\.)?hh\.ru\/vacancy\/\d+/i.test(url)) throw new Error('Некорректный источник вакансии');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(`https://hh.ru/vacancy/${id}`, { headers: { 'User-Agent': 'Svoi/1.0 (https://svoi.balanov.pro/)', Accept: 'text/html' }, signal: controller.signal });
    if (!response.ok) throw new Error(`HH.ru ограничил доступ к описанию (HTTP ${response.status}). Откройте источник в браузере.`);
    return parseHhVacancyPage(await response.text(), vacancy);
  } finally { clearTimeout(timer); }
}

export async function fetchHhVacancies(site, profile, { fetchImpl = fetch, timeoutMs = 15000 } = {}) {
  const endpoint = hhSearchUrl(site, profile);
  if (!endpoint) return [];
  if (!profile.role?.trim()) throw new Error('Сначала укажите желаемую позицию');
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetchImpl(endpoint, { headers: { 'User-Agent': 'Svoi/1.0 (https://svoi.balanov.pro/)', Accept: 'application/json' }, signal: controller.signal });
    if (response.ok) {
      const data = await response.json();
      if (!Array.isArray(data.items)) throw new Error('HH.ru вернул неожиданный формат. Данные не сохранены.');
      return rankVacancies(data.items.slice(0, 50).map(item => normalizeHhVacancy(item, site)).filter(Boolean), profile);
    }
    if (![401, 403, 404].includes(response.status)) throw new Error(`HH.ru вернул HTTP ${response.status}. Попробуйте позже.`);
    const pageUrl = new URL('https://hh.ru/search/vacancy');
    pageUrl.searchParams.set('text', cleanText(`${profile.role} ${profile.city || ''}`, 200));
    pageUrl.searchParams.set('items_on_page', '50');
    const page = await fetchImpl(pageUrl, { headers: { 'User-Agent': 'Svoi/1.0 (https://svoi.balanov.pro/)', Accept: 'text/html' }, signal: controller.signal });
    if (!page.ok) throw new Error(`HH.ru ограничил доступ (HTTP ${page.status}). Откройте сайт в браузере.`);
    return parseHhSearchPage(await page.text(), profile);
  } finally { clearTimeout(timer); }
}

export async function findVacancies(state, options) {
  const supported = state.sites.filter(site => hhSearchUrl(site, state.profile));
  const lists = await Promise.all(supported.map(site => fetchHhVacancies(site, state.profile, options)));
  const all = lists.flat();
  const existing = new Map(state.vacancies.map(v => [v.id, v]));
  const merged = all.map(v => ({ ...v, status: existing.get(v.id)?.status || 'new' }));
  for (const vacancy of state.vacancies) if (!merged.some(v => v.id === vacancy.id)) merged.push(vacancy);
  return { vacancies: merged.slice(0, 200), found: all.length, supportedSites: supported.length };
}
