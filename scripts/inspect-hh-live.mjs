import fs from 'node:fs';
import { load } from 'cheerio';

const headers = { 'User-Agent': 'Svoi/1.0 (https://svoi.balanov.pro/)', Accept: 'text/html' };
const response = await fetch('https://hh.ru/vacancy/138848744', { headers });
const html = await response.text();
const $ = load(html);
console.log(JSON.stringify({
  status: response.status,
  title: $('title').text(),
  description: $('[data-qa="vacancy-description"]').text().replace(/\s+/g, ' ').trim().slice(0, 1800),
  skills: $('[data-qa="skills-element"]').map((_, element) => $(element).text().trim()).get(),
  salary: $('[data-qa*="compensation"]').map((_, element) => [$(element).attr('data-qa'), $(element).text().trim()]).get(),
}, null, 2));
const search = load(fs.readFileSync(new URL('../validation-hh-page.html', import.meta.url), 'utf8'));
const state = JSON.parse(search('template#HH-Lux-InitialState').text());
const compensation = state.vacancySearchResult.vacancies.map(v => v.compensation).filter(v => v && !v.noCompensation);
console.log('compensation_examples', JSON.stringify(compensation.slice(0, 6), null, 2));
