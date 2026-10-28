import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchHhVacancies, findVacancies, parseHhSearchPage } from '../electron/jobs.mjs';

const item = { id: '123', name: 'UX-дизайнер', alternate_url: 'https://hh.ru/vacancy/123', employer: { name: 'Компания' }, area: { name: 'Москва' }, snippet: { requirement: 'Figma', responsibility: 'Дизайн продукта' } };
const response = data => ({ ok: true, status: 200, json: async () => data });

test('официальный API нормализует только реальные записи', async () => {
  let endpoint;
  const result = await fetchHhVacancies('https://hh.ru', { role: 'дизайнер', skills: ['Figma'] }, { fetchImpl: async (url, options) => { endpoint = url; assert.match(options.headers['User-Agent'], /Svoi/); return response({ items: [item] }); } });
  assert.match(endpoint, /^https:\/\/api\.hh\.ru\/vacancies/); assert.equal(result.length, 1); assert.equal(result[0].id, 'hh-123');
});
test('произвольный сайт не превращается в запрос к внутреннему адресу', async () => { let called = false; const result = await fetchHhVacancies('http://127.0.0.1:8080', { role: 'дизайнер' }, { fetchImpl: async () => { called = true; } }); assert.equal(called, false); assert.deepEqual(result, []); });
test('HTTP 403 не подменяется выдуманными вакансиями', async () => { await assert.rejects(() => fetchHhVacancies('hh.ru', { role: 'дизайнер' }, { fetchImpl: async () => ({ ok: false, status: 403 }) }), /403/); });
test('CAPTCHA или антибот не обходится', async () => { await assert.rejects(() => fetchHhVacancies('hh.ru', { role: 'дизайнер' }, { fetchImpl: async () => ({ ok: false, status: 429 }) }), /429/); });
test('пустая должность запрещает бессмысленный поиск', async () => { await assert.rejects(() => fetchHhVacancies('hh.ru', { role: '' }), /позицию/); });
test('другие выбранные сайты остаются доступны для ручного сценария', async () => {
  const state = { sites: ['https://career.habr.com/', 'https://hh.ru/'], profile: { role: 'дизайнер', skills: [] }, vacancies: [] };
  const result = await findVacancies(state, { fetchImpl: async () => response({ items: [item] }) });
  assert.equal(result.supportedSites, 1); assert.equal(result.found, 1); assert.equal(state.sites.length, 2);
});
const html = '<div data-qa="vacancy-serp__vacancy"><a data-qa="serp-item__title" href="https://hh.ru/vacancy/123?query=test">UX-дизайнер</a><span data-qa="vacancy-serp__vacancy-employer">Компания</span><span data-qa="vacancy-serp__vacancy-address">Москва</span><span data-qa="vacancy-serp__vacancy-compensation">от 200 000 ₽</span><span data-qa="vacancy-serp__vacancy_snippet_requirement">Figma</span></div>';
test('резервный разбор использует реальные data-qa карточки', () => { const result = parseHhSearchPage(html, { role: 'дизайнер', skills: ['Figma'] }); assert.equal(result.length, 1); assert.equal(result[0].salary, 'от 200 000 ₽'); assert.equal(result[0].url, 'https://hh.ru/vacancy/123'); assert.equal(result[0].snippet, 'Figma'); });
test('резервный разбор не принимает чужой источник', () => { assert.throws(() => parseHhSearchPage(html.replace('https://hh.ru/vacancy/123', 'https://evil.example/vacancy/123'), { role: 'дизайнер', skills: [] }), /Не удалось прочитать/); });
test('проверка человеком останавливает разбор', () => { assert.throws(() => parseHhSearchPage('Подтвердите, что вы человек', { role: 'дизайнер' }), /не будем/); });
test('недоступный API использует публичную страницу без обхода CAPTCHA', async () => { const result = await fetchHhVacancies('hh.ru', { role: 'дизайнер', skills: ['Figma'] }, { fetchImpl: async url => String(url).includes('api.hh.ru') ? { ok: false, status: 403 } : { ok: true, status: 200, text: async () => html } }); assert.equal(result.length, 1); assert.equal(result[0].company, 'Компания'); });

test('новая разметка HH берёт зарплату и дату из подписанных данных страницы', async () => {
  const initial = { vacancySearchResult: { vacancies: [{ vacancyId: 123, compensation: { from: 200000, to: 300000, currencyCode: 'RUR', gross: false }, publicationTime: { $: '2026-10-28T10:00:00+03:00' } }] } };
  const currentHtml = html.replace('<div data-qa="vacancy-serp__vacancy">', `<template id="HH-Lux-InitialState">${JSON.stringify(initial)}</template><div data-qa="vacancy-serp__vacancy">`).replace('<span data-qa="vacancy-serp__vacancy-compensation">от 200 000 ₽</span>', '');
  const result = parseHhSearchPage(currentHtml, { role: 'дизайнер', skills: ['Figma'] });
  assert.equal(result[0].salary.replace(/\s/g, ' '), 'от 200 000 до 300 000 ₽ на руки');
  assert.equal(result[0].publishedAt, '2026-10-28T10:00:00+03:00');
});

test('выбранная вакансия обогащается настоящим описанием и навыками', async () => {
  const { parseHhVacancyPage, fetchHhVacancyDetails } = await import('../electron/jobs.mjs');
  const detailHtml = '<div data-qa="vacancy-description">Развивать бренд-систему. Требуется профессиональный опыт Figma.</div><span data-qa="skills-element">Figma</span><span data-qa="skills-element">Adobe Photoshop</span>';
  const parsed = parseHhVacancyPage(detailHtml, { id: 'hh-123', url: 'https://hh.ru/vacancy/123', skills: [] });
  assert.match(parsed.snippet, /бренд-систему/);
  assert.deepEqual(parsed.skills, ['Figma', 'Adobe Photoshop']);
  const result = await fetchHhVacancyDetails({ id: 'hh-123', url: 'https://hh.ru/vacancy/123', skills: [] }, { fetchImpl: async url => { assert.equal(url, 'https://hh.ru/vacancy/123'); return { ok: true, text: async () => detailHtml }; } });
  assert.match(result.snippet, /Figma/);
  await assert.rejects(() => fetchHhVacancyDetails({ id: 'hh-123', url: 'https://hh.ru/vacancy/123' }, { fetchImpl: async () => ({ ok: false, status: 403 }) }), /403/);
});
