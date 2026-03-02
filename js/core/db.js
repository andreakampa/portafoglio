import { Toast } from './toast.js';

function getDbUrl() {
    return window.__CONFIG__?.dbUrl || '';
}

export const DB = {
    async load(path) {
        try {
            const r = await fetch(getDbUrl() + path + '.json');
            return await r.json() || {};
        } catch (e) {
            Toast.show('Errore caricamento dati', 'err');
            return {};
        }
    },

    async save(path, data) {
        try {
            await fetch(getDbUrl() + path + '.json', {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            return true;
        } catch (e) {
            Toast.show('Errore salvataggio', 'err');
            return false;
        }
    }
};
