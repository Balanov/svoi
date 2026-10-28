import fs from 'node:fs';
import { load } from 'cheerio';
const $ = load(fs.readFileSync(new URL('../validation-hh-page.html', import.meta.url), 'utf8'));
const first = $('[data-qa="vacancy-serp__vacancy"]').first();
console.log('card_fields', first.find('[data-qa]').map((_, el) => ({ field: $(el).attr('data-qa'), text: $(el).text().trim().slice(0, 150) })).get());
const raw = $('template#HH-Lux-InitialState').text();
try {
  const data = JSON.parse(raw);
  console.log('state_keys', Object.keys(data));
  const search = data.vacancySearchResult;
  console.log('search_keys', search ? Object.keys(search) : null);
  const vacancy = search?.vacancies?.[0];
  console.log('vacancy_fields', vacancy ? Object.keys(vacancy) : null);
  console.log('snippet', JSON.stringify(vacancy?.vacancySnippet));
  console.log('skills', JSON.stringify(vacancy?.keySkills));
  console.log('compensation', JSON.stringify(vacancy?.compensation));
  console.log('company', JSON.stringify(vacancy?.company));
  console.log('links', JSON.stringify(vacancy?.links));
  console.log('publicationTime', JSON.stringify(vacancy?.publicationTime));
  console.log('workExperience', JSON.stringify(vacancy?.workExperience));
  console.log('workFormats', JSON.stringify(vacancy?.workFormats));
  console.log('first_card_html', first.html()?.slice(0, 12000));
} catch (error) { console.log('state_parse', error.message, raw.slice(0, 150)); }
