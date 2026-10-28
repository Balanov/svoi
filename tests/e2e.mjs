import { _electron as electron } from 'playwright';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const output = path.join(root, 'validation');
const userData = path.join(output, 'electron-data');
await fs.rm(userData, { recursive: true, force: true });
await fs.mkdir(output, { recursive: true });
const environment = { ...process.env, SVOI_USER_DATA_DIR: userData };
delete environment.ELECTRON_RUN_AS_NODE;
const executablePath = process.env.SVOI_EXECUTABLE_PATH;
const app = await electron.launch({ executablePath, args: executablePath ? [] : ['.'], cwd: root, env: environment });
const page = await app.firstWindow();
const errors = [];
page.on('pageerror', error => errors.push(error.message));
const click = name => page.getByRole('button', { name, exact: true }).click();
const textAppears = text => page.waitForFunction(value => document.body.innerText.includes(value), text, { timeout: 30000 });
const screenshot = name => page.screenshot({ path: path.join(output, name), fullPage: false });
let certificateUrl = '';

try {
  await page.setViewportSize({ width: 1440, height: 960 });
  await page.locator('.onboarding').waitFor();
  await screenshot('01-onboarding.png');
  await click('+ hh.ru');
  await click('Продолжить');
  await click('Заполнить профиль вручную');
  await page.getByLabel('Ваше имя или ФИО').fill('Тестов Тест Тестович');
  await page.getByLabel('Желаемая позиция').fill('графический дизайнер');
  await page.getByLabel('Город', { exact: true }).fill('Москва');
  await page.getByLabel('Навыки через запятую').fill('Figma, Photoshop, Illustrator');
  await screenshot('02-profile-confirmation.png');
  await click('Всё верно — начать');
  await textAppears('Рад вас видеть');

  await click('Составь план поиска на неделю');
  await textAppears('держим план, который можно проверить');
  await screenshot('03-chat.png');

  await click('Вакансии');
  await click('Найти вакансии');
  await page.locator('.job-card').first().waitFor({ timeout: 60000 });
  assert.ok(await page.locator('.job-card').count() > 0, 'HH должен вернуть настоящие карточки');
  const searched = await page.evaluate(() => window.svoi.load());
  assert.ok(searched.vacancies.every(v => v.source === 'HH.ru' && /^https:\/\/hh\.ru\/vacancy\/\d+/.test(v.url)));
  assert.ok(searched.vacancies.every(v => !/тестовая вакансия/i.test(v.title)));
  await screenshot('04-live-vacancies.png');

  await page.locator('.job-card').first().getByRole('button', { name: 'Подготовить отклик' }).click();
  await page.locator('.draft-editor').waitFor({ timeout: 60000 });
  await page.waitForFunction(() => document.querySelector('.draft-editor')?.value.includes('Здравствуйте!'));
  const drafted = await page.evaluate(() => window.svoi.load());
  const selectedVacancy = drafted.vacancies.find(v => v.id === drafted.applications[0].vacancyId);
  assert.ok(selectedVacancy.snippet.length > 150, 'Перед откликом должно загрузиться полное описание');
  assert.ok(drafted.applications[0].draft.includes(selectedVacancy.title));
  const editor = page.locator('.draft-editor');
  await editor.fill(`${await editor.inputValue()}\n\nТестовая правка пользователя.`);
  await click('Сохранить');
  await textAppears('Черновик сохранён');
  await click('Я отправил');
  await textAppears('Отмечено как отправленное вами');
  assert.equal((await page.evaluate(() => window.svoi.load())).applications[0].status, 'sent');
  await page.getByPlaceholder('Вставьте сообщение работодателя — оно останется на ПК').fill('Тестовое входящее сообщение: приглашаем на интервью в четверг в 12:00.');
  await page.getByLabel('ОТВЕТИТЬ РАБОТОДАТЕЛЮ').count();
  await click('Подготовить ответ');
  await page.locator('.reply-result').waitFor();
  assert.match(await page.locator('.reply-result').innerText(), /Здравствуйте/);
  await screenshot('05-response-and-reply.png');

  await click('Вакансии');
  await page.locator('.job-card').first().getByRole('button', { name: 'К интервью' }).click();
  await page.getByRole('dialog').waitFor({ timeout: 60000 });
  await textAppears('СПРОСИТЬ РАБОТОДАТЕЛЯ');
  assert.match(await page.getByRole('dialog').innerText(), /observable-метрикам/);
  await screenshot('06-interview.png');
  await page.getByRole('dialog').getByRole('button', { name: 'Закрыть' }).click();

  await click('Моя работа');
  await page.getByPlaceholder('Например, подготовить отчёт к пятнице').fill('Тестовая задача: подготовить презентацию');
  await page.getByPlaceholder('Контекст, срок или ограничения (необязательно)').fill('Проверить факты и согласовать с руководителем');
  await click('Добавить');
  await textAppears('Тестовая задача: подготовить презентацию');
  await page.getByPlaceholder('Опишите рабочую задачу…').fill('Нужно письмо руководителю о переносе срока, потому что жду исходные данные; предложить новый срок — пятницу.');
  await page.getByPlaceholder('Опишите рабочую задачу…').press('Enter');
  await textAppears('давайте превратим это в выполнимую задачу');
  await screenshot('07-work.png');

  await click('Настройки');
  await click('Изменить');
  await page.getByRole('dialog').getByLabel('Город', { exact: true }).fill('Тестовый город');
  await click('Сохранить изменения');
  await textAppears('Профиль обновлён');
  assert.equal((await page.evaluate(() => window.svoi.load())).profile.city, 'Тестовый город');

  const encrypted = await fs.readFile(path.join(userData, 'svoi-private-store.bin'));
  assert.equal(encrypted.toString('utf8').includes('Тестов Тест Тестович'), false, 'Профиль не должен храниться открытым текстом');

  if (process.env.SVOI_LIVE_CERTIFICATE_TEST === '1') {
    await click('Мой сертификат');
    await page.getByLabel('Имя или псевдоним').fill('Тестовый псевдоним — удалить');
    assert.equal(await page.locator('.consent-check input').isChecked(), false, 'Новая ссылка требует нового явного согласия');
    await page.locator('.consent-check').click();
    await click('Создать ссылку и QR');
    await page.locator('.copy-field input').waitFor({ timeout: 30000 });
    certificateUrl = await page.locator('.copy-field input').inputValue();
    const createdState = await page.evaluate(() => window.svoi.load());
    let response = await fetch(certificateUrl);
    const publicHtml = await response.text();
    assert.equal(response.status, 200);
    assert.ok(publicHtml.includes('Тестовый псевдоним — удалить'));
    assert.equal(publicHtml.includes('Тестов Тест Тестович'), false);
    assert.ok(publicHtml.includes(`<strong>${createdState.counters.draftsPrepared}</strong><span>откликов подготовлено</span>`));
    await page.getByLabel('Публичный статус').selectOption('paused');
    await click('Обновить страницу');
    await textAppears('Счётчики и статус обновлены');
    response = await fetch(certificateUrl);
    const updatedHtml = await response.text();
    assert.equal(response.status, 200);
    assert.ok(updatedHtml.includes('Поиск на паузе'));
    assert.ok(updatedHtml.includes(`<strong>${createdState.counters.draftsPrepared}</strong><span>откликов подготовлено</span>`));
    assert.equal(updatedHtml.includes('Тестов Тест Тестович'), false);
    await screenshot('08-certificate.png');
    await click('Отключить ссылку');
    await page.getByRole('dialog').getByRole('button', { name: 'Отключить ссылку', exact: true }).click();
    await textAppears('Публичная ссылка отключена');
    response = await fetch(certificateUrl);
    assert.equal(response.status, 410);
    certificateUrl = '';

    await page.getByLabel('Имя или псевдоним').fill('Тестовый псевдоним — удалить');
    assert.equal(await page.locator('.consent-check input').isChecked(), false, 'Новая ссылка требует нового явного согласия');
    await page.locator('.consent-check').click();
    await click('Создать ссылку и QR');
    await page.locator('.copy-field input').waitFor({ timeout: 30000 });
    certificateUrl = await page.locator('.copy-field input').inputValue();
    await click('Удалить историю…');
    await page.getByLabel('Введите «УДАЛИТЬ ИСТОРИЮ»').fill('УДАЛИТЬ ИСТОРИЮ');
    await click('Удалить необратимо');
    await textAppears('История удалена. Профиль и документы сохранены.');
    response = await fetch(certificateUrl);
    assert.equal(response.status, 404);
    certificateUrl = '';
    const purged = await page.evaluate(() => window.svoi.load());
    assert.equal(purged.certificate, null);
    assert.equal(purged.applications.length, 0);
    assert.equal(purged.tasks.length, 0);
    assert.equal(purged.profile.name, 'Тестов Тест Тестович');
  }
  assert.deepEqual(errors, [], 'Ошибок React/JavaScript быть не должно');
  console.log(JSON.stringify({ ok: true, liveVacancies: searched.vacancies.length, descriptionLength: selectedVacancy.snippet.length, certificateTested: process.env.SVOI_LIVE_CERTIFICATE_TEST === '1', screenshots: output }, null, 2));
} catch (error) {
  await screenshot('99-failure.png').catch(() => {});
  console.error('Текст экрана при ошибке:', (await page.locator('body').innerText()).slice(-5000));
  console.error('Ошибки страницы:', errors);
  throw error;
} finally {
  if (certificateUrl) console.error('Тестовая ссылка требует проверки удаления:', certificateUrl);
  await app.close();
  await fs.rm(userData, { recursive: true, force: true });
}
