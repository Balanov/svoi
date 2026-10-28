import path from 'node:path';
import { LOCAL_SYSTEM_PROMPT, localPrompt, offlineReply } from '../shared/assistant.js';

export const MODEL_URI = 'hf:Qwen/Qwen3-4B-GGUF:Q4_K_M';
let embeddedPromise;

export async function detectOllama(fetchImpl = fetch) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 1200);
  try {
    const response = await fetchImpl('http://127.0.0.1:11434/api/tags', { signal: controller.signal });
    if (!response.ok) return null;
    const data = await response.json();
    return (data.models || []).map(item => item.name).filter(name => /qwen/i.test(name) && !/vl|vision|embedding/i.test(name)).sort((a, b) => Number(/qwen3/i.test(b)) - Number(/qwen3/i.test(a)) || b.length - a.length)[0] || null;
  } catch { return null; } finally { clearTimeout(timer); }
}

async function embeddedSession(userDataPath, onProgress) {
  if (!embeddedPromise) embeddedPromise = (async () => {
    const { getLlama, resolveModelFile, LlamaChatSession, QwenChatWrapper } = await import('node-llama-cpp');
    onProgress?.({ stage: 'model', message: 'Подготавливаю локальную модель. Это может занять время при первом запуске.' });
    let lastBucket = -1;
    const modelPath = await resolveModelFile(MODEL_URI, {
      directory: path.join(userDataPath, 'models'), cli: false,
      onProgress: ({ totalSize, downloadedSize }) => {
        const bucket = totalSize ? Math.floor(downloadedSize / totalSize * 100) : 0;
        if (bucket === lastBucket) return;
        lastBucket = bucket;
        onProgress?.({ stage: 'model', message: `Загрузка модели: ${bucket}%`, progress: totalSize ? downloadedSize / totalSize : 0 });
      },
    });
    onProgress?.({ stage: 'model', message: 'Запускаю модель на этом компьютере', progress: 1 });
    const llama = await getLlama();
    const model = await llama.loadModel({ modelPath });
    const context = await model.createContext({ contextSize: 4096 });
    return { context, LlamaChatSession, QwenChatWrapper };
  })().catch(error => { embeddedPromise = null; throw error; });
  return embeddedPromise;
}

export async function prepareLocalModel({ userDataPath, onProgress }) {
  const ollama = await detectOllama();
  if (ollama) return { mode: `qwen-ollama:${ollama}`, ready: true };
  await embeddedSession(userDataPath, onProgress);
  return { mode: 'qwen-embedded', ready: true };
}

export async function chatWithLocalModel({ input, state, history, userDataPath, allowEmbedded, onProgress }) {
  if (!allowEmbedded) return offlineReply(input, state);
  let model;
  try { model = await detectOllama(); } catch { model = null; }
  const prompt = localPrompt(input, state, history);
  try {
    if (model) {
      const response = await fetch('http://127.0.0.1:11434/api/chat', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, messages: [{ role: 'system', content: LOCAL_SYSTEM_PROMPT }, { role: 'user', content: prompt }], stream: false, think: false, options: { temperature: 0.2, num_predict: 1000 } }),
      });
      if (!response.ok) throw new Error(`Ollama HTTP ${response.status}`);
      const data = await response.json();
      const answer = String(data.message?.content || '').replace(/<think>[\s\S]*?<\/think>/g, '').trim().slice(0, 8000);
      if (!answer) throw new Error('Пустой ответ локальной модели');
      return { answer, mode: `qwen-ollama:${model}` };
    }
    const { context, LlamaChatSession, QwenChatWrapper } = await embeddedSession(userDataPath, onProgress);
    const session = new LlamaChatSession({ contextSequence: context.getSequence(), systemPrompt: LOCAL_SYSTEM_PROMPT, autoDisposeSequence: true, chatWrapper: new QwenChatWrapper({ thoughts: 'discourage' }) });
    let answer;
    try {
      answer = await session.prompt(`${prompt}\n/no_think`, { temperature: 0.2, maxTokens: 1000, responsePrefix: '</think>\n\n', repeatPenalty: { penalty: 1.12, lastTokens: 256 } });
    } finally { session.dispose(); }
    answer = String(answer).trim().slice(0, 8000);
    if (!answer) throw new Error('Пустой ответ локальной модели');
    return { answer, mode: 'qwen-embedded' };
  } catch (error) {
    console.error('[Svoi] Local model unavailable:', error.message);
    return { ...offlineReply(input, state), mode: 'offline-rules', warning: 'Локальная модель сейчас недоступна. Показан ответ встроенного помощника без отправки данных в облако.' };
  }
}
