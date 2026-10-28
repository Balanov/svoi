import fs from 'node:fs';
import { load } from 'cheerio';
const $ = load(fs.readFileSync(new URL('../validation-hh-page.html', import.meta.url), 'utf8'));
const cards = $('[data-qa="vacancy-serp__vacancy"]');
console.log('cards', cards.length);
cards.slice(0, 2).each((_, element) => {
  const card = $(element);
  console.log(JSON.stringify({ title: card.find('[data-qa="serp-item__title"]').text().trim(), href: card.find('[data-qa="serp-item__title"]').attr('href'), company: card.find('[data-qa="vacancy-serp__vacancy-employer"]').text().trim(), salary: card.find('[data-qa="vacancy-serp__vacancy-compensation"]').text().trim(), city: card.find('[data-qa="vacancy-serp__vacancy-address"]').text().trim(), snippet: card.find('[data-qa="vacancy-serp__vacancy_snippet_responsibility"]').text().trim(), requirement: card.find('[data-qa="vacancy-serp__vacancy_snippet_requirement"]').text().trim() }));
});
