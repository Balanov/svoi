import fs from 'node:fs/promises';
import path from 'node:path';
import { safeStorage } from 'electron';
import { normalizeState, createInitialState } from '../shared/core.js';

export class SecureStore {
  constructor(userDataPath) { this.file = path.join(userDataPath, 'svoi-private-store.bin'); }
  async load() {
    try {
      const encoded = await fs.readFile(this.file);
      if (!safeStorage.isEncryptionAvailable()) throw new Error('Системное шифрование недоступно. Данные не будут сохранены без защиты.');
      return normalizeState(JSON.parse(safeStorage.decryptString(encoded.toString())));
    } catch (error) {
      if (error.code === 'ENOENT') return createInitialState();
      throw new Error('Не удалось открыть защищённое хранилище. Файл не перезаписан. ' + error.message);
    }
  }
  async save(state) {
    if (!safeStorage.isEncryptionAvailable()) throw new Error('Системное шифрование недоступно. Изменения не сохранены.');
    const normalized = normalizeState(state);
    const encrypted = safeStorage.encryptString(JSON.stringify(normalized));
    const temp = `${this.file}.tmp`;
    await fs.mkdir(path.dirname(this.file), { recursive: true, mode: 0o700 });
    await fs.writeFile(temp, encrypted, { mode: 0o600 });
    await fs.rename(temp, this.file);
    return normalized;
  }
  async destroy() {
    await fs.rm(this.file, { force: true });
    await fs.rm(`${this.file}.tmp`, { force: true });
  }
}
