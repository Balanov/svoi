const { app, BrowserWindow, Menu, ipcMain, dialog, shell } = require('electron');
const path = require('node:path');
const fs = require('node:fs/promises');
const { randomUUID } = require('node:crypto');

if (process.env.SVOI_USER_DATA_DIR) app.setPath('userData', path.resolve(process.env.SVOI_USER_DATA_DIR));

let state;
let store;
let mainWindow;
let lastSearch = 0;
let searching = false;

const update = async next => { state = await store.save(next); return state; };
const requireProfile = () => { if (!state.profile.confirmed || !state.profile.role) throw new Error('Сначала подтвердите профиль и желаемую позицию'); };
const vacancyById = id => state.vacancies.find(v => v.id === id) || (() => { throw new Error('Вакансия не найдена. Обновите список.'); })();

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1360, height: 900, minWidth: 920, minHeight: 650,
    backgroundColor: '#f5f6fa', title: 'Свой', autoHideMenuBar: true,
    icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.cjs'), contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url);
    return { action: 'deny' };
  });
  mainWindow.webContents.on('will-navigate', (event, url) => { if (mainWindow.webContents.getURL() !== url) event.preventDefault(); });
  if (process.env.VITE_DEV_SERVER_URL) mainWindow.loadURL(process.env.VITE_DEV_SERVER_URL);
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'));
}

app.whenReady().then(async () => {
  Menu.setApplicationMenu(null);
  const { SecureStore } = await import('./store.mjs');
  store = new SecureStore(app.getPath('userData'));
  state = await store.load();
  const core = await import('../shared/core.js');

  ipcMain.handle('svoi:load', () => ({ ...state, environment: { desktop: true, modelEnabled: state.settings.localModelEnabled } }));
  ipcMain.handle('svoi:save-profile', async (_event, payload = {}) => {
    const role = core.cleanText(payload.profile?.role, 120);
    if (!role) throw new Error('Укажите должность, которую хотите найти');
    if (payload.confirmed !== true) throw new Error('Проверьте и подтвердите данные профиля');
    return update({ ...state,
      profile: { ...state.profile, name: core.cleanText(payload.profile.name, 100), role, city: core.cleanText(payload.profile.city, 70), salary: core.cleanText(payload.profile.salary, 60), about: core.cleanText(payload.profile.about, 12000), skills: Array.isArray(payload.profile.skills) ? payload.profile.skills.map(x => core.cleanText(x, 60)).filter(Boolean).slice(0, 20) : [], confirmed: true },
      sites: core.normalizeSites(payload.sites),
    });
  });
  ipcMain.handle('svoi:import-documents', async (_event, payload = {}) => {
    const picked = await dialog.showOpenDialog({ title: payload.kind === 'response' ? 'Выберите прошлые отклики' : 'Выберите своё резюме', properties: ['openFile', 'multiSelections'], filters: [{ name: 'Документы', extensions: ['txt', 'md', 'csv', 'json', 'pdf', 'docx'] }] });
    if (picked.canceled || !picked.filePaths.length) return { state, suggestedProfile: null };
    const { readCareerFiles } = await import('./files.mjs');
    const documents = await readCareerFiles(picked.filePaths, payload.kind);
    if (!documents.length) throw new Error('Не удалось прочитать документы. Поддерживаются TXT, MD, CSV, JSON, PDF и DOCX до 8 МБ.');
    const all = [...state.documents, ...documents].slice(-10);
    const suggestedProfile = core.inferProfile(all);
    state = await update({ ...state, documents: all });
    return { state, suggestedProfile };
  });
  ipcMain.handle('svoi:search', async () => {
    requireProfile();
    if (searching) throw new Error('Поиск уже выполняется');
    searching = true;
    try {
      const { findVacancies } = await import('./jobs.mjs');
      const result = await findVacancies(state);
      lastSearch = Date.now();
      return { state: await update({ ...state, vacancies: result.vacancies }), found: result.found, supportedSites: result.supportedSites };
    } finally { searching = false; }
  });
  ipcMain.handle('svoi:review', async (_event, id) => {
    const vacancy = vacancyById(id);
    return update(core.recordActivity({ ...state, vacancies: state.vacancies.map(v => v.id === id ? { ...v, status: 'reviewed' } : v) }, 'vacancy_reviewed', { subjectId: vacancy.id }));
  });
  const withVacancyDetails = async vacancy => {
    if (vacancy.source !== 'HH.ru' || vacancy.snippet) return { vacancy, detailsWarning: '' };
    try {
      const { fetchHhVacancyDetails } = await import('./jobs.mjs');
      const detailed = core.rankVacancies([await fetchHhVacancyDetails(vacancy)], state.profile)[0];
      state = await update({ ...state, vacancies: state.vacancies.map(item => item.id === vacancy.id ? { ...detailed, status: item.status } : item) });
      return { vacancy: detailed, detailsWarning: '' };
    } catch (error) {
      return { vacancy, detailsWarning: `${error.message} Черновик использует только данные карточки.` };
    }
  };
  ipcMain.handle('svoi:draft', async (_event, id) => {
    const { vacancy, detailsWarning } = await withVacancyDetails(vacancyById(id));
    const draft = core.draftForVacancy(vacancy, state.profile, state.documents);
    const old = state.applications.find(item => item.vacancyId === id);
    const application = { id: old?.id || randomUUID(), vacancyId: id, title: vacancy.title, company: vacancy.company, url: vacancy.url, draft, status: old?.status || 'draft', updatedAt: new Date().toISOString() };
    const applications = old ? state.applications.map(item => item.id === old.id ? application : item) : [application, ...state.applications];
    const next = await update(core.recordActivity({ ...state, applications }, 'draft_prepared', { subjectId: id }));
    return { state: next, notice: detailsWarning || 'Черновик по реальному описанию готов. Проверьте его перед отправкой.' };
  });
  ipcMain.handle('svoi:add-vacancy', async (_event, payload = {}) => {
    const url = core.safeUrl(payload.url);
    if (!url) throw new Error('Добавьте корректную HTTP или HTTPS ссылку на вакансию');
    const title = core.cleanText(payload.title, 180);
    if (!title) throw new Error('Укажите название позиции');
    const vacancy = { id: `manual-${randomUUID()}`, title, company: core.cleanText(payload.company, 160), city: core.cleanText(payload.city, 90), salary: core.cleanText(payload.salary, 100) || 'Не указана', snippet: core.cleanText(payload.snippet, 1400), skills: Array.isArray(payload.skills) ? payload.skills.map(x => core.cleanText(x, 50)).slice(0, 15) : [], url, source: new URL(url).hostname, publishedAt: new Date().toISOString(), score: 0, matchedSkills: [], status: 'new' };
    return update({ ...state, vacancies: [core.rankVacancies([vacancy], state.profile)[0], ...state.vacancies].slice(0, 200) });
  });
  ipcMain.handle('svoi:update-application', async (_event, payload = {}) => {
    const application = state.applications.find(item => item.id === payload.id);
    if (!application) throw new Error('Черновик не найден');
    const allowed = new Set(['draft', 'ready', 'sent', 'replied', 'rejected', 'interview', 'offer']);
    if (!allowed.has(payload.status)) throw new Error('Неизвестный статус отклика');
    let next = { ...state, applications: state.applications.map(item => item.id === payload.id ? { ...item, status: payload.status, draft: core.cleanText(payload.draft, 4000), updatedAt: new Date().toISOString() } : item) };
    if (payload.status === 'sent') next = core.recordActivity(next, 'application_confirmed', { subjectId: application.vacancyId });
    if (payload.status === 'replied') next = core.recordActivity(next, 'reply_tracked', { subjectId: application.vacancyId });
    return update(next);
  });
  ipcMain.handle('svoi:interview', async (_event, id) => {
    const { vacancy, detailsWarning } = await withVacancyDetails(vacancyById(id));
    const plan = core.interviewPlan(vacancy, state.profile);
    const next = await update(core.recordActivity(state, 'interview_prepared', { subjectId: id }));
    return { state: next, plan, notice: detailsWarning || 'Подготовка собрана по описанию вакансии' };
  });
  ipcMain.handle('svoi:reply-draft', async (_event, payload = {}) => {
    const application = state.applications.find(item => item.id === payload.applicationId);
    if (!application) throw new Error('Сначала выберите отклик');
    const incoming = core.cleanText(payload.incoming, 5000);
    if (!incoming) throw new Error('Вставьте сообщение работодателя');
    const intent = ['accept', 'clarify', 'decline', 'followup'].includes(payload.intent) ? payload.intent : 'clarify';
    const drafts = {
      accept: 'Здравствуйте! Спасибо за приглашение. Подтверждаю встречу в предложенное время. Пожалуйста, направьте ссылку или адрес и уточните, что стоит подготовить к разговору.',
      clarify: 'Здравствуйте! Спасибо за сообщение. Чтобы подготовиться к следующему шагу, уточните, пожалуйста, приоритетные задачи позиции и ожидаемый результат. После этого смогу предметно рассказать о релевантном опыте.',
      decline: 'Здравствуйте! Спасибо за предложение и уделённое время. Сейчас не готов продолжить по этой позиции. Буду признателен, если сохраните мои контакты на случай более подходящей роли.',
      followup: 'Здравствуйте! Возвращаюсь к нашему диалогу по позиции. Подскажите, пожалуйста, удалось ли определить следующий шаг? По-прежнему заинтересован в предметном разговоре.',
    };
    const conversation = { id: randomUUID(), applicationId: application.id, incoming, intent, draft: drafts[intent], at: new Date().toISOString() };
    const next = core.recordActivity({ ...state, conversations: [conversation, ...state.conversations].slice(0, 500) }, 'reply_tracked', { subjectId: application.vacancyId });
    return { state: await update(next), draft: drafts[intent] };
  });
  ipcMain.handle('svoi:chat', async (_event, payload = {}) => {
    const input = core.cleanText(payload.input, 2400);
    if (!input) throw new Error('Напишите сообщение Своему');
    const history = [...state.messages, { id: randomUUID(), role: 'user', text: input, at: new Date().toISOString() }].slice(-100);
    const { chatWithLocalModel } = await import('./local-model.mjs');
    const result = await chatWithLocalModel({ input, state, history, userDataPath: app.getPath('userData'), allowEmbedded: state.settings.localModelEnabled, onProgress: progress => mainWindow?.webContents.send('svoi:progress', progress) });
    let next = { ...state, messages: [...history, { id: randomUUID(), role: 'assistant', text: result.answer, mode: result.mode, warning: result.warning || '', at: new Date().toISOString() }].slice(-100) };
    if (payload.context === 'work') next = core.recordActivity(next, 'work_session', { subjectId: history.at(-1).id });
    return update(next);
  });
  ipcMain.handle('svoi:add-task', async (_event, payload = {}) => {
    const title = core.cleanText(payload.title, 300);
    if (!title) throw new Error('Сформулируйте задачу');
    return update(core.recordActivity({ ...state, tasks: [{ id: randomUUID(), title, details: core.cleanText(payload.details, 4000), done: false, createdAt: new Date().toISOString() }, ...state.tasks] }, 'work_session', { subjectId: title }));
  });
  ipcMain.handle('svoi:toggle-task', async (_event, id) => update({ ...state, tasks: state.tasks.map(task => task.id === id ? { ...task, done: !task.done } : task) }));
  ipcMain.handle('svoi:enable-model', async (_event, payload = {}) => {
    if (payload.confirmed !== true) throw new Error('Подтвердите подготовку локальной модели');
    const choice = await dialog.showMessageBox({ type: 'info', title: 'Локальная модель', message: 'Включить свободный диалог на этом ПК?', detail: 'Если Qwen уже установлена в Ollama, используем её. Иначе «Свой» предложит загрузить открытую модель Qwen3-4B — около 2,5 ГБ. Документы остаются локальными. Основные функции работают и без модели.', buttons: ['Отмена', 'Включить'], defaultId: 0, cancelId: 0, noLink: true });
    if (choice.response !== 1) return state;
    const { prepareLocalModel } = await import('./local-model.mjs');
    await prepareLocalModel({ userDataPath: app.getPath('userData'), onProgress: progress => mainWindow?.webContents.send('svoi:progress', progress) });
    return update({ ...state, settings: { ...state.settings, localModelEnabled: true } });
  });
  ipcMain.handle('svoi:certificate-create', async (_event, payload = {}) => {
    if (payload.consent !== true) throw new Error('Подтвердите согласие на публикацию выбранных данных');
    if (state.certificate?.active) throw new Error('Публичная ссылка уже создана');
    const { createCertificate, syncCertificate } = await import('./certificate.mjs');
    const certificate = await createCertificate(state, { displayName: payload.displayName, status: payload.status, consent: true });
    state = await update({ ...state, certificate });
    try { await syncCertificate(state); } catch (error) { console.error('[Svoi] Certificate sync:', error.message); }
    return state;
  });
  ipcMain.handle('svoi:certificate-sync', async (_event, payload = {}) => {
    if (!state.certificate?.active) throw new Error('Сначала создайте публичную ссылку');
    const status = core.STATUSES.has(payload.status) ? payload.status : 'search';
    state = await update({ ...state, certificate: { ...state.certificate, status } });
    const { syncCertificate } = await import('./certificate.mjs');
    await syncCertificate(state);
    return state;
  });
  ipcMain.handle('svoi:certificate-revoke', async (_event, payload = {}) => {
    if (payload.confirmed !== true) throw new Error('Подтвердите отключение публичной ссылки');
    const { revokeCertificate } = await import('./certificate.mjs');
    await revokeCertificate(state.certificate);
    return update({ ...state, certificate: null });
  });
  ipcMain.handle('svoi:certificate-purge', async (_event, payload = {}) => {
    if (payload.confirmation !== 'УДАЛИТЬ ИСТОРИЮ') throw new Error('Введите подтверждение точно: УДАЛИТЬ ИСТОРИЮ');
    if (state.certificate?.active) {
      const response = await fetch(state.certificate.url, { method: 'DELETE', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${state.certificate.secret}` }, body: JSON.stringify({ action: 'purge' }) });
      if (!response.ok) throw new Error('Сервер не удалил публичную историю. Локальные данные сохранены.');
    }
    const fresh = core.createInitialState();
    return update({ ...fresh, profile: state.profile, sites: state.sites, documents: state.documents, settings: state.settings });
  });
  ipcMain.handle('svoi:export-resume', async () => {
    const picked = await dialog.showSaveDialog({ title: 'Сохранить резюме', defaultPath: 'Свой-резюме.md', filters: [{ name: 'Markdown', extensions: ['md'] }] });
    if (picked.canceled || !picked.filePath) return { saved: false };
    await fs.writeFile(picked.filePath, core.resumeMarkdown(state), 'utf8');
    return { saved: true, path: picked.filePath };
  });
  ipcMain.handle('svoi:open-external', async (_event, value) => {
    const url = core.safeUrl(value);
    if (!url) throw new Error('Разрешены только безопасные HTTP или HTTPS ссылки');
    await shell.openExternal(url);
    return { opened: true };
  });
  ipcMain.handle('svoi:reset-all', async (_event, payload = {}) => {
    if (payload.confirmation !== 'УДАЛИТЬ ВСЕ ДАННЫЕ') throw new Error('Введите: УДАЛИТЬ ВСЕ ДАННЫЕ');
    if (state.certificate?.active) throw new Error('Сначала отключите публичный сертификат');
    await store.destroy();
    return update(core.createInitialState());
  });

  createWindow();
  setInterval(async () => {
    if (!state.profile.confirmed || searching || !state.sites.some(site => core.hhSearchUrl(site, state.profile))) return;
    if (Date.now() - lastSearch < state.settings.searchIntervalHours * 3600000) return;
    try {
      searching = true;
      const { findVacancies } = await import('./jobs.mjs');
      const result = await findVacancies(state);
      lastSearch = Date.now();
      state = await store.save({ ...state, vacancies: result.vacancies });
      mainWindow?.webContents.send('svoi:progress', { stage: 'search', message: `Фоновый поиск: ${result.found} вакансий`, refresh: true });
    } catch (error) { console.error('[Svoi] Background search:', error.message); } finally { searching = false; }
  }, 60000).unref();
  app.on('activate', () => { if (BrowserWindow.getAllWindows().length === 0) createWindow(); });
}).catch(error => {
  console.error('[Svoi] Startup:', error.message);
  dialog.showErrorBox('Свой — ошибка запуска', error.message);
  app.quit();
});
app.on('window-all-closed', () => { if (process.platform !== 'darwin') app.quit(); });
