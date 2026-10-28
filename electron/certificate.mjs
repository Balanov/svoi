import { CERTIFICATE_ORIGIN, certificatePayload } from '../shared/core.js';

async function request(url, options = {}, fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 12000);
  try {
    const response = await fetchImpl(url, { ...options, signal: controller.signal, headers: { 'Content-Type': 'application/json', Accept: 'application/json', ...(options.headers || {}) } });
    const text = await response.text();
    let data = {};
    try { data = JSON.parse(text); } catch { throw new Error('Сервер сертификата вернул не JSON'); }
    if (!response.ok) throw new Error(data.error || 'Сервер сертификата временно недоступен');
    return data;
  } finally { clearTimeout(timer); }
}

export async function createCertificate(state, settings, fetchImpl = fetch) {
  const payload = certificatePayload(state, settings);
  const data = await request(`${CERTIFICATE_ORIGIN}/api/certificate.php`, { method: 'POST', body: JSON.stringify(payload) }, fetchImpl);
  if (!/^SV-[A-Z2-9]{12}$/.test(data.id) || !data.secret || data.secret.length < 32) throw new Error('Сервер не подтвердил создание ссылки');
  return { id: data.id, secret: data.secret, url: data.publicUrl, displayName: payload.displayName, status: payload.status, active: true };
}

export async function syncCertificate(state, fetchImpl = fetch) {
  const certificate = state.certificate;
  if (!certificate?.active) return null;
  if (!/^SV-[A-Z2-9]{12}$/.test(certificate.id) || !certificate.secret) throw new Error('Локальные данные сертификата повреждены');
  return request(certificate.url, { method: 'PUT', headers: { Authorization: `Bearer ${certificate.secret}` }, body: JSON.stringify(certificatePayload(state, { displayName: certificate.displayName, status: certificate.status || 'search', consent: true })) }, fetchImpl);
}

export async function revokeCertificate(certificate, fetchImpl = fetch) {
  if (!certificate?.url || !certificate.secret) return { revoked: true };
  return request(certificate.url, { method: 'DELETE', headers: { Authorization: `Bearer ${certificate.secret}` }, body: JSON.stringify({ action: 'revoke' }) }, fetchImpl);
}
