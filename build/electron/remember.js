'use strict';
// "Remember my code on this PC": the code is encrypted with Windows' own protection (DPAPI, through Electron's safeStorage), so the
// file is useless on any other PC or Windows account. Owner accounts only; the screen decides who may ask for it.
const { app, safeStorage } = require('electron');
const fs = require('fs');
const path = require('path');

const file = () => path.join(app.getPath('userData'), 'remembered-login.json');
const read = () => { try { return JSON.parse(fs.readFileSync(file(), 'utf8')); } catch (error) { return null; } };
const available = () => { try { return Boolean(safeStorage.isEncryptionAvailable()); } catch (error) { return false; } };

module.exports = {
  info() { const saved = read(); return { available: available(), name: saved && typeof saved.name === 'string' ? saved.name : '' }; },
  save(name, code) {
    if (!available() || typeof code !== 'string' || !code || code.length > 64) return { ok: false };
    fs.mkdirSync(path.dirname(file()), { recursive: true });
    fs.writeFileSync(file(), JSON.stringify({ name: String(name || '').slice(0, 80), blob: safeStorage.encryptString(code).toString('base64') }));
    return { ok: true };
  },
  use() {
    const saved = read();
    if (!saved || !saved.blob || !available()) return { ok: false };
    try { return { ok: true, name: saved.name || '', code: safeStorage.decryptString(Buffer.from(saved.blob, 'base64')) }; } catch (error) { return { ok: false }; }
  },
  forget() { try { fs.unlinkSync(file()); } catch (error) { /* nothing saved */ } return { ok: true }; }
};
