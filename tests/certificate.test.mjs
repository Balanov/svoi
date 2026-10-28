import test from 'node:test';
import assert from 'node:assert/strict';
import { createInitialState } from '../shared/core.js';
import { createCertificate, syncCertificate, revokeCertificate } from '../electron/certificate.mjs';

const created = { id: 'SV-ABCDEFGHJKLM', secret: 'a-very-long-random-revoke-secret-123456789', publicUrl: 'https://svoi.balanov.pro/operator.php?id=SV-ABCDEFGHJKLM' };
function fetchMock(status = 200) {
  const calls = [];
  const fn = async (url, options) => { calls.push({ url, options }); return { ok: status < 400, status, text: async () => JSON.stringify(status < 400 ? created : { error: 'Ошибка теста' }) }; };
  return { fn, calls };
}

test('создание не отправляет резюме или переписку', async () => {
  const mock = fetchMock(); const state = { ...createInitialState(), documents: [{ text: 'ПАСПОРТНЫЕ ДАННЫЕ' }], conversations: [{ incoming: 'ЛИЧНАЯ ПЕРЕПИСКА' }] };
  const cert = await createCertificate(state, { displayName: 'Антон Н.', status: 'working', consent: true }, mock.fn);
  assert.equal(cert.status, 'working'); assert.equal(cert.active, true);
  assert.equal(mock.calls[0].options.body.includes('ПАСПОРТНЫЕ'), false);
  assert.equal(mock.calls[0].options.body.includes('ЛИЧНАЯ'), false);
  assert.equal(mock.calls[0].options.headers.Authorization, undefined);
});
test('обновление использует отдельный секрет и выбранный статус', async () => {
  const mock = fetchMock(); const state = { ...createInitialState(), certificate: { ...created, url: created.publicUrl, active: true, displayName: 'Псевдоним', status: 'paused' } };
  await syncCertificate(state, mock.fn);
  assert.equal(mock.calls[0].options.method, 'PUT'); assert.equal(mock.calls[0].options.headers.Authorization, `Bearer ${created.secret}`);
  assert.match(mock.calls[0].options.body, /"status":"paused"/); assert.equal(mock.calls[0].options.body.includes('secret'), false);
});
test('отзыв ссылки не стирает локальные документы', async () => {
  const mock = fetchMock(); const state = createInitialState(); state.documents.push({ text: 'Резюме сохранено' });
  await revokeCertificate({ ...created, url: created.publicUrl, active: true }, mock.fn);
  assert.equal(mock.calls[0].options.method, 'DELETE'); assert.match(mock.calls[0].options.body, /revoke/); assert.equal(state.documents.length, 1);
});
test('чужой идентификатор нельзя синхронизировать без секрета', async () => { await assert.rejects(() => syncCertificate({ ...createInitialState(), certificate: { id: 'SV-ABCDEFGHJKLM', active: true } }), /повреждены/); });
test('ошибка сервера не маскируется под успех', async () => { const mock = fetchMock(503); await assert.rejects(() => createCertificate(createInitialState(), { consent: true }, mock.fn), /Ошибка теста/); });
