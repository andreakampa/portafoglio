import { Toast } from './toast.js';

function getDbUrl() {
    return window.__CONFIG__?.dbUrl || '';
}

function getUid() {
    return window.__UID__ || null;
}

function getToken() {
    // Firebase mantiene il token in indexedDB — lo recuperiamo tramite l'SDK
    return window.__FB_TOKEN__ || null;
}

export const DB = {
    async load(path) {
        const uid = getUid();
        if (!uid) { Toast.show('Utente non autenticato', 'err'); return {}; }
        try {
            const token = await this._getToken();
            const url   = `${getDbUrl()}users/${uid}/${path}.json${token ? `?auth=${token}` : ''}`;
            const r     = await fetch(url);
            return await r.json() || {};
        } catch (e) {
            Toast.show('Errore caricamento dati', 'err');
            return {};
        }
    },

    async save(path, data) {
        const uid = getUid();
        if (!uid) { Toast.show('Utente non autenticato', 'err'); return false; }
        try {
            const token = await this._getToken();
            const url   = `${getDbUrl()}users/${uid}/${path}.json${token ? `?auth=${token}` : ''}`;
            await fetch(url, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            return true;
        } catch (e) {
            Toast.show('Errore salvataggio', 'err');
            return false;
        }
    },

    async _getToken() {
        try {
            const FB_AUTH_URL = 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
            const { getAuth } = await import(FB_AUTH_URL);
            const auth = getAuth();
            const user = auth.currentUser;
            if (!user) return null;
            return await user.getIdToken();
        } catch (e) { return null; }
    }
};
