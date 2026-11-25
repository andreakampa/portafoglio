// Test delle regole del database (database.rules.json) sugli emulatori Firebase.
// Uso: firebase emulators:exec --only auth,database "node tests/rules.test.mjs"
// Non tocca il database vero: tutto avviene sugli emulatori locali.

const DB = 'http://127.0.0.1:9000';
const NS = 'calcolo-pmc-default-rtdb';
const AUTH = 'http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1';

let passed = 0, failed = 0;

async function signUp(email) {
    const r = await fetch(`${AUTH}/accounts:signUp?key=fake-key`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password: 'password123', returnSecureToken: true })
    });
    const j = await r.json();
    if (!j.idToken) throw new Error('signUp fallito: ' + JSON.stringify(j));
    return { uid: j.localId, token: j.idToken, email };
}

// user = null -> non autenticato; user = 'owner' -> bypass delle regole (solo per preparare i dati)
async function req(user, method, path, body) {
    const url = new URL(`${DB}/${path}.json`);
    url.searchParams.set('ns', NS);
    const headers = { 'Content-Type': 'application/json' };
    if (user === 'owner') headers.Authorization = 'Bearer owner';
    else if (user) url.searchParams.set('auth', user.token);
    const r = await fetch(url, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
    return { status: r.status, data: await r.json().catch(() => null) };
}

async function expect(name, promise, allowed) {
    const { status } = await promise;
    const ok = allowed ? status === 200 : status === 401 || status === 403;
    if (ok) { passed++; console.log(`  ✔ ${name}`); }
    else { failed++; console.log(`  ✘ ${name} (status ${status}, atteso ${allowed ? 'consentito' : 'negato'})`); }
}

const claim = (user, code, email = user.email) => req(user, 'PATCH', '', {
    [`members/${user.uid}`]: { invite: code, email, joinedAt: { '.sv': 'timestamp' } },
    [`invites/${code}/usedBy`]: user.uid
});

// ── preparazione ──────────────────────────────────────────────────
await req('owner', 'PUT', '', null);
const admin = await signUp('admin@test.it');
const anna  = await signUp('anna@test.it');
const bruno = await signUp('bruno@test.it');
const carlo = await signUp('carlo@test.it');
await req('owner', 'PUT', `admins/${admin.uid}`, true);
await req('owner', 'PUT', `members/${admin.uid}`, { invite: 'ADMIN-BOOTSTRAP', email: admin.email });
await req('owner', 'PUT', `users/${admin.uid}/portfolio_state`, { activePortfolioId: 'p1' });
await req('owner', 'PUT', 'inviteCode', 'VECCHIO-CODICE');

console.log('\nNon autenticati');
await expect('non leggono users', req(null, 'GET', `users/${admin.uid}`), false);
await expect('non leggono il vecchio inviteCode', req(null, 'GET', 'inviteCode'), false);
await expect('non leggono invites', req(null, 'GET', 'invites'), false);
await expect('non scrivono members', req(null, 'PUT', `members/x`, { invite: 'AAAA-BBBB-CCCC' }), false);

console.log('\nAccount senza invito');
await expect('non legge i propri dati', req(anna, 'GET', `users/${anna.uid}`), false);
await expect('non scrive i propri dati', req(anna, 'PUT', `users/${anna.uid}/portfolio_state`, { x: 1 }), false);
await expect('non legge il vecchio inviteCode', req(anna, 'GET', 'inviteCode'), false);
await expect('non elenca gli inviti', req(anna, 'GET', 'invites'), false);
await expect('non elenca i membri', req(anna, 'GET', 'members'), false);
await expect('non si nomina admin', req(anna, 'PUT', `admins/${anna.uid}`, true), false);
await expect('non crea inviti', req(anna, 'PUT', 'invites/ANNA-FAKE-CODE', { createdBy: anna.uid }), false);
await expect('non riscatta un invito inesistente', claim(anna, 'NONE-XIST-ENTE'), false);
await expect('legge il proprio members (vuoto)', req(anna, 'GET', `members/${anna.uid}`), true);

console.log('\nAdmin');
await expect('crea un invito', req(admin, 'PUT', 'invites/K7PM-Q2XD-9RWA', { createdBy: admin.uid, createdAt: { '.sv': 'timestamp' } }), true);
await expect('crea un secondo invito', req(admin, 'PUT', 'invites/ZZZZ-YYYY-XXXX', { createdBy: admin.uid }), true);
await expect('crea un terzo invito', req(admin, 'PUT', 'invites/MMMM-NNNN-PPPP', { createdBy: admin.uid }), true);
await expect('non crea codici in formato errato', req(admin, 'PUT', 'invites/abc', { createdBy: admin.uid }), false);
await expect('elenca gli inviti', req(admin, 'GET', 'invites'), true);
await expect('elenca i membri', req(admin, 'GET', 'members'), true);
await expect('legge i propri dati', req(admin, 'GET', `users/${admin.uid}`), true);

console.log('\nRiscatto dell\'invito');
await expect('non riscatta con email diversa dalla propria', claim(anna, 'K7PM-Q2XD-9RWA', 'altra@test.it'), false);
await expect('non crea members senza segnare l\'invito come usato',
    req(anna, 'PUT', `members/${anna.uid}`, { invite: 'K7PM-Q2XD-9RWA', email: anna.email }), false);
await expect('non segna l\'invito come usato senza creare members',
    req(anna, 'PUT', 'invites/K7PM-Q2XD-9RWA/usedBy', anna.uid), false);
await expect('riscatta un invito valido', claim(anna, 'K7PM-Q2XD-9RWA'), true);
await expect('ora legge i propri dati', req(anna, 'GET', `users/${anna.uid}`), true);
await expect('ora scrive i propri dati', req(anna, 'PUT', `users/${anna.uid}/portfolio_state`, { activePortfolioId: 'a' }), true);
await expect('un altro non riusa lo stesso invito', claim(bruno, 'K7PM-Q2XD-9RWA'), false);
await expect('chi è già membro non riscatta un altro invito', claim(anna, 'ZZZZ-YYYY-XXXX'), false);
await expect('non cambia il proprio members', req(anna, 'PUT', `members/${anna.uid}`, { invite: 'ZZZZ-YYYY-XXXX', email: anna.email }), false);
await expect('non toglie l\'uso dall\'invito', req(anna, 'DELETE', 'invites/K7PM-Q2XD-9RWA/usedBy'), false);
await expect('non segna come usato l\'invito di un altro', req(anna, 'PUT', 'invites/MMMM-NNNN-PPPP/usedBy', anna.uid), false);
await expect('bruno riscatta un altro invito libero', claim(bruno, 'ZZZZ-YYYY-XXXX'), true);

console.log('\nIsolamento tra utenti');
await expect('anna non legge i dati di admin', req(anna, 'GET', `users/${admin.uid}`), false);
await expect('anna non scrive i dati di bruno', req(anna, 'PUT', `users/${bruno.uid}/portfolio_state`, { x: 1 }), false);
await expect('anna non legge members di bruno', req(anna, 'GET', `members/${bruno.uid}`), false);
await expect('anna non legge la radice', req(anna, 'GET', ''), false);
await expect('anna non è admin', req(anna, 'PUT', 'invites/AAAA-BBBB-CCCC', { createdBy: anna.uid }), false);
await expect('carlo (senza invito) resta fuori', req(carlo, 'GET', `users/${carlo.uid}`), false);

console.log('\nAvviso di chiusura del sito');
await expect('non autenticati non lo leggono', req(null, 'GET', 'notice'), false);
await expect('chi non è membro non lo legge', req(carlo, 'GET', 'notice'), false);
await expect('un membro non lo scrive', req(anna, 'PUT', 'notice', { closesAt: 1 }), false);
await expect('admin lo scrive', req(admin, 'PUT', 'notice', { closesAt: Date.now() + 60 * 86400000, message: 'Grazie' }), true);
await expect('admin non scrive un avviso senza data', req(admin, 'PUT', 'notice', { message: 'x' }), false);
await expect('un membro lo legge', req(anna, 'GET', 'notice'), true);
await expect('admin lo toglie', req(admin, 'DELETE', 'notice'), true);

console.log('\nSospensione e cancellazione');
await req('owner', 'PUT', `users/${bruno.uid}/settings/x`, 1);
await expect('un membro non si toglie la sospensione da solo', req(bruno, 'PUT', `members/${bruno.uid}/suspendedAt`, null), false);
await expect('admin sospende bruno', req(admin, 'PATCH', `members/${bruno.uid}`, { suspendedAt: Date.now(), deleteAfter: Date.now() + 30 * 86400000 }), true);
await expect('sospeso: legge ancora i suoi dati (per scaricarli)', req(bruno, 'GET', `users/${bruno.uid}`), true);
await expect('sospeso: legge la propria sospensione', req(bruno, 'GET', `members/${bruno.uid}`), true);
await expect('sospeso: non modifica i dati', req(bruno, 'PUT', `users/${bruno.uid}/settings/x`, 2), false);
await expect('sospeso: non toglie la sospensione', req(bruno, 'DELETE', `members/${bruno.uid}/suspendedAt`), false);
await expect('admin non legge i dati di bruno', req(admin, 'GET', `users/${bruno.uid}`), false);
await expect('admin non cancella prima dei 30 giorni', req(admin, 'DELETE', `users/${bruno.uid}`), false);
await req('owner', 'PUT', `members/${bruno.uid}/deleteAfter`, Date.now() - 1000);
await expect('admin non scrive i dati di bruno nemmeno dopo', req(admin, 'PUT', `users/${bruno.uid}/settings/x`, 3), false);
await expect('admin cancella dati e membro a periodo finito', req(admin, 'PATCH', '', { [`users/${bruno.uid}`]: null, [`members/${bruno.uid}`]: null }), true);
await expect('bruno resta fuori', req(bruno, 'GET', `users/${bruno.uid}`), false);
await expect('admin sospende anna', req(admin, 'PATCH', `members/${anna.uid}`, { suspendedAt: Date.now(), deleteAfter: Date.now() - 1000 }), true);
await expect('admin riattiva anna', req(admin, 'PATCH', `members/${anna.uid}`, { suspendedAt: null, deleteAfter: null }), true);
await expect('admin non cancella i dati di un membro non sospeso', req(admin, 'DELETE', `users/${anna.uid}`), false);
await expect('anna riattivata riscrive', req(anna, 'PUT', `users/${anna.uid}/settings/x`, 1), true);

console.log('\nElimina il mio account');
const dario = await signUp('dario@test.it');
await req('owner', 'PUT', `members/${dario.uid}`, { invite: 'DARI-OOOO-CODE', email: dario.email, suspendedAt: 1, deleteAfter: Date.now() + 86400000 });
await req('owner', 'PUT', `users/${dario.uid}/settings/x`, 1);
await expect('anna non cancella i dati di dario', req(anna, 'PATCH', '', { [`users/${dario.uid}`]: null, [`members/${dario.uid}`]: null }), false);
await expect('anna non cancella il members di dario', req(anna, 'DELETE', `members/${dario.uid}`), false);
await expect('anna cancella i propri dati e il proprio members', req(anna, 'PATCH', '', { [`users/${anna.uid}`]: null, [`members/${anna.uid}`]: null }), true);
await expect('anna poi non legge più nulla', req(anna, 'GET', `users/${anna.uid}`), false);
await expect('anche sospeso si può cancellare da solo', req(dario, 'PATCH', '', { [`users/${dario.uid}`]: null, [`members/${dario.uid}`]: null }), true);

console.log(`\n${passed} superati, ${failed} falliti`);
process.exit(failed ? 1 : 0);
