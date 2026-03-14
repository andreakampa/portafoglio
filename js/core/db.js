async load(path) {
    const uid = getUid();
    if (!uid) { Toast.show('Utente non autenticato', 'err'); return {}; }
    try {
        const token = await this._getToken();
        if (!token) { Toast.show('Token non disponibile, riprova', 'err'); return {}; }
        const url = `${getDbUrl()}users/${uid}/${path}.json?auth=${token}`;
        const r   = await fetch(url);
        if (!r.ok) {
            const errText = await r.text();
            console.error(`DB.load error (${r.status}):`, errText);
            Toast.show(`Errore DB: ${r.status}`, 'err');
            return {};
        }
        const data = await r.json();
        return data || {};
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
        if (!token) { Toast.show('Token non disponibile, riprova', 'err'); return false; }
        const url = `${getDbUrl()}users/${uid}/${path}.json?auth=${token}`;
        const r   = await fetch(url, {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(data)
        });
        if (!r.ok) {
            const errText = await r.text();
            console.error(`DB.save error (${r.status}):`, errText);
            Toast.show(`Errore salvataggio: ${r.status}`, 'err');
            return false;
        }
        return true;
    } catch (e) {
        Toast.show('Errore salvataggio', 'err');
        return false;
    }
},
