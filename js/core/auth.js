import { Toast } from './toast.js';
import { DB } from './db.js';

const FB_APP_URL  = 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
const FB_AUTH_URL = 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

// ── CONFIG HARDCODATA ──────────────────────────────────────────────
// La chiave API Firebase è pubblica per natura: la sicurezza sta nelle regole
// del database (database.rules.json), non nel segreto di questi valori.
const FIREBASE_CONFIG = {
    dbUrl:        'https://calcolo-pmc-default-rtdb.europe-west1.firebasedatabase.app/',
    fbApiKey:     'AIzaSyBQ3mSc6sH3dgwvpagi7yaQlDigqyFJRX4',
    fbAuthDomain: 'calcolo-pmc.firebaseapp.com',
    fbProjectId:  'calcolo-pmc',
};

// Prove in locale con gli emulatori Firebase (firebase emulators:start):
// su localhost, localStorage.ptpro_emulator = '1' collega auth e database agli emulatori.
const USE_EMULATOR = ['localhost', '127.0.0.1'].includes(location.hostname)
    && (() => { try { return localStorage.getItem('ptpro_emulator') === '1'; } catch { return false; } })();
// L'emulatore sceglie il database dal sottodominio: questo è quello con le regole del progetto.
if (USE_EMULATOR) FIREBASE_CONFIG.dbUrl = 'http://calcolo-pmc-default-rtdb.localhost:9000/';

// Stesso formato accettato dalle regole: lettere maiuscole, cifre e trattini.
const normalizeInvite = s => String(s || '').trim().toUpperCase().replace(/\s+/g, '');
const INVITE_RE = /^[A-Z0-9-]{8,32}$/;

export class Auth {
    constructor() {
        this.config   = FIREBASE_CONFIG;
        this.fireAuth = null;
        this.user     = null;
    }

    async init() {
        await this._initFirebase();

        this.user = await this._getFirebaseUser();
        if (this.user) {
            this._setGlobals();
            if (await this._isMember()) return true;
            return await this._showOverlay(resolve => this._renderClaimForm(resolve));
        }

        return await this._showOverlay(resolve => this._renderLoginForm(resolve));
    }

    async logout() {
        if (this.fireAuth) {
            const { signOut } = await import(FB_AUTH_URL);
            await signOut(this.fireAuth);
        }
        location.reload();
    }

    getUid() { return this.user?.uid || null; }

    _setGlobals() {
        window.__UID__    = this.user.uid;
        window.__CONFIG__ = this.config;
    }

    // ── FIREBASE INIT ──────────────────────────────────────────────
    async _initFirebase() {
        try {
            const { initializeApp, getApps } = await import(FB_APP_URL);
            const { getAuth, connectAuthEmulator } = await import(FB_AUTH_URL);
            const apps = getApps();
            const app  = apps.length ? apps[0] : initializeApp({
                apiKey:      this.config.fbApiKey,
                authDomain:  this.config.fbAuthDomain,
                databaseURL: this.config.dbUrl,
                projectId:   this.config.fbProjectId,
            });
            this.fireAuth = getAuth(app);
            if (USE_EMULATOR) connectAuthEmulator(this.fireAuth, 'http://127.0.0.1:9099', { disableWarnings: true });
        } catch (e) { console.warn('Firebase init error', e); }
    }

    _getFirebaseUser() {
        return new Promise(resolve => {
            if (!this.fireAuth) { resolve(null); return; }
            import(FB_AUTH_URL).then(({ onAuthStateChanged }) => {
                const unsub = onAuthStateChanged(this.fireAuth, user => {
                    unsub();
                    resolve(user);
                }, () => resolve(null));
            });
        });
    }

    // ── MEMBRI E INVITI ────────────────────────────────────────────
    // Il controllo vero lo fanno le regole del database: senza members/{uid}
    // i dati in users/{uid} non sono leggibili né scrivibili. Qui serve solo
    // a mostrare la schermata giusta, quindi in caso di errore di rete si prosegue.
    async _isMember() {
        const r = await DB.rootRequest('GET', `members/${this.user.uid}`);
        if (r.ok) return r.data !== null;
        return true;
    }

    // Riscatta un invito: una sola scrittura atomica che crea members/{uid}
    // e segna l'invito come usato. Le regole la accettano solo se l'invito
    // esiste e non è già stato usato.
    async _claimInvite(code) {
        const r = await DB.rootRequest('PATCH', '', {
            [`members/${this.user.uid}`]: {
                invite: code,
                email: this.user.email,
                joinedAt: { '.sv': 'timestamp' }
            },
            [`invites/${code}/usedBy`]: this.user.uid
        });
        return r.ok;
    }

    // ── SCHERMATE ──────────────────────────────────────────────────
    _showOverlay(render) {
        return new Promise(resolve => {
            document.getElementById('login-overlay').classList.add('visible');
            render(resolve);
        });
    }

    _done(resolve) {
        document.getElementById('login-overlay').classList.remove('visible');
        resolve(true);
    }

    _renderLoginForm(resolve) {
        document.getElementById('login-box').innerHTML = `
            <div class="auth-logo">🔐</div>
            <h2>Portafoglio Tracker</h2>
            <input type="email"    id="auth-email"    placeholder="Email" autocomplete="username">
            <input type="password" id="auth-password" placeholder="Password" autocomplete="current-password">
            <div class="auth-error" id="auth-error"></div>
            <button class="btn btn-accent btn-full" id="btn-login">Accedi</button>
            <button class="btn btn-ghost  btn-full" id="btn-go-register" style="margin-top:8px;">Registrati con un invito</button>`;

        document.getElementById('btn-login').onclick = () => this._doLogin(resolve);
        document.getElementById('auth-password').addEventListener('keydown', e => {
            if (e.key === 'Enter') this._doLogin(resolve);
        });
        document.getElementById('btn-go-register').onclick = () => this._renderRegisterForm(resolve);
    }

    _renderRegisterForm(resolve) {
        document.getElementById('login-box').innerHTML = `
            <div class="auth-logo">📝</div>
            <h2>Registrati</h2>
            <input type="email"    id="auth-email"    placeholder="Email" autocomplete="username">
            <input type="password" id="auth-password" placeholder="Password (min. 6 caratteri)" autocomplete="new-password">
            <input type="password" id="auth-password2" placeholder="Conferma password" autocomplete="new-password">
            <input type="text"     id="auth-invite"   placeholder="Codice invito" autocapitalize="characters" spellcheck="false">
            <div class="auth-error" id="auth-error"></div>
            <button class="btn btn-success btn-full" id="btn-register">Crea Account</button>
            <button class="btn btn-ghost   btn-full" id="btn-go-login" style="margin-top:8px;">Hai già un account? Accedi</button>`;

        document.getElementById('btn-register').onclick = () => this._doRegister(resolve);
        document.getElementById('btn-go-login').onclick = () => this._renderLoginForm(resolve);
    }

    // Per chi ha un account ma non è ancora membro (es. registrazione interrotta).
    _renderClaimForm(resolve) {
        const box = document.getElementById('login-box');
        box.innerHTML = `
            <div class="auth-logo">🎟️</div>
            <h2>Serve un invito</h2>
            <p class="text-muted fs-sm" style="margin:0 0 12px;">Il tuo account non è ancora abilitato. Inserisci il codice invito che hai ricevuto.</p>
            <input type="text" id="auth-invite" placeholder="Codice invito" autocapitalize="characters" spellcheck="false">
            <div class="auth-error" id="auth-error"></div>
            <button class="btn btn-success btn-full" id="btn-claim">Attiva account</button>
            <button class="btn btn-ghost   btn-full" id="btn-claim-logout" style="margin-top:8px;">Esci</button>`;
        box.querySelector('#btn-claim').onclick = async () => {
            const err  = document.getElementById('auth-error');
            const code = normalizeInvite(document.getElementById('auth-invite').value);
            if (!INVITE_RE.test(code)) { err.textContent = 'Codice invito non valido.'; return; }
            err.textContent = 'Verifica codice invito...';
            if (await this._claimInvite(code)) {
                Toast.show('Account attivato! Benvenuto 🎉', 'ok');
                this._done(resolve);
            } else {
                err.textContent = 'Codice invito non valido o già usato.';
            }
        };
        box.querySelector('#btn-claim-logout').onclick = () => this.logout();
    }

    async _doLogin(resolve) {
        const email = document.getElementById('auth-email').value.trim();
        const pass  = document.getElementById('auth-password').value;
        const err   = document.getElementById('auth-error');
        if (!email || !pass) { err.textContent = 'Inserisci email e password.'; return; }
        err.textContent = 'Accesso in corso...';
        try {
            const { signInWithEmailAndPassword } = await import(FB_AUTH_URL);
            const cred = await signInWithEmailAndPassword(this.fireAuth, email, pass);
            this.user = cred.user;
            this._setGlobals();
        } catch (e) {
            err.textContent = 'Email o password errati.';
            document.getElementById('auth-password').value = '';
            return;
        }
        if (await this._isMember()) this._done(resolve);
        else this._renderClaimForm(resolve);
    }

    async _doRegister(resolve) {
        const email  = document.getElementById('auth-email').value.trim();
        const pass   = document.getElementById('auth-password').value;
        const pass2  = document.getElementById('auth-password2').value;
        const invite = normalizeInvite(document.getElementById('auth-invite').value);
        const err    = document.getElementById('auth-error');

        if (!email || !pass)         { err.textContent = 'Inserisci email e password.'; return; }
        if (pass !== pass2)          { err.textContent = 'Le password non coincidono.'; return; }
        if (pass.length < 6)         { err.textContent = 'Password troppo corta (min 6).'; return; }
        if (!INVITE_RE.test(invite)) { err.textContent = 'Inserisci un codice invito valido.'; return; }

        err.textContent = 'Creazione account...';
        try {
            const { createUserWithEmailAndPassword } = await import(FB_AUTH_URL);
            const cred = await createUserWithEmailAndPassword(this.fireAuth, email, pass);
            this.user = cred.user;
            this._setGlobals();
        } catch (e) {
            if (e.code === 'auth/email-already-in-use')
                err.textContent = 'Email già registrata: accedi e inserisci lì il codice invito.';
            else
                err.textContent = 'Errore creazione account.';
            return;
        }

        err.textContent = 'Verifica codice invito...';
        if (await this._claimInvite(invite)) {
            Toast.show('Account creato! Benvenuto 🎉', 'ok');
            this._done(resolve);
            return;
        }

        // Invito non valido: elimina l'account appena creato, così non resta un utente orfano.
        try { await this.user.delete(); } catch { /* resta senza accesso ai dati: nessun rischio */ }
        this.user = null;
        window.__UID__ = null;
        err.textContent = 'Codice invito non valido o già usato.';
    }
}
