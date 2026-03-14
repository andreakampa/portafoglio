import { Toast } from './toast.js';

const CONFIG_KEY  = 'ptpro_config_v5';
const FB_APP_URL  = 'https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js';
const FB_AUTH_URL = 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';

// ── CONFIG HARDCODATA ──────────────────────────────────────────────
const FIREBASE_CONFIG = {
    dbUrl:        'https://calcolo-pmc-default-rtdb.europe-west1.firebasedatabase.app/',
    fbApiKey:     'AIzaSyBQ3mSc6sH3dgwvpagi7yaQlDigqyFJRX4',
    fbAuthDomain: 'calcolo-pmc.firebaseapp.com',
    fbProjectId:  'calcolo-pmc',
};

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
            window.__UID__    = this.user.uid;
            window.__CONFIG__ = this.config;
            return true;
        }

        return await this._showLogin();
    }

    async logout() {
        if (this.fireAuth) {
            const { signOut } = await import(FB_AUTH_URL);
            await signOut(this.fireAuth);
        }
        location.reload();
    }

    getUid() { return this.user?.uid || null; }

    // ── FIREBASE INIT ──────────────────────────────────────────────
    async _initFirebase() {
        try {
            const { initializeApp, getApps } = await import(FB_APP_URL);
            const { getAuth }                = await import(FB_AUTH_URL);
            const apps = getApps();
            const app  = apps.length ? apps[0] : initializeApp({
                apiKey:      this.config.fbApiKey,
                authDomain:  this.config.fbAuthDomain,
                databaseURL: this.config.dbUrl,
                projectId:   this.config.fbProjectId,
            });
            this.fireAuth = getAuth(app);
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

    // ── LOGIN / REGISTRAZIONE ──────────────────────────────────────
    _showLogin() {
        return new Promise(resolve => {
            const overlay = document.getElementById('login-overlay');
            overlay.classList.add('visible');
            this._renderLoginForm(resolve);
        });
    }

    _renderLoginForm(resolve) {
        document.getElementById('login-box').innerHTML = `
            <div class="auth-logo">🔐</div>
            <h2>Portafoglio Tracker</h2>
            <input type="email"    id="auth-email"    placeholder="Email">
            <input type="password" id="auth-password" placeholder="Password">
            <div class="auth-error" id="auth-error"></div>
            <button class="btn btn-accent btn-full" id="btn-login">Accedi</button>
            <button class="btn btn-ghost  btn-full" id="btn-go-register" style="margin-top:8px;">Registrati</button>`;

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
            <input type="email"    id="auth-email"    placeholder="Email">
            <input type="password" id="auth-password" placeholder="Password (min. 6 caratteri)">
            <input type="password" id="auth-password2" placeholder="Conferma password">
            <input type="text"     id="auth-invite"   placeholder="Codice invito">
            <div class="auth-error" id="auth-error"></div>
            <button class="btn btn-success btn-full" id="btn-register">Crea Account</button>
            <button class="btn btn-ghost   btn-full" id="btn-go-login" style="margin-top:8px;">Hai già un account? Accedi</button>`;

        document.getElementById('btn-register').onclick  = () => this._doRegister(resolve);
        document.getElementById('btn-go-login').onclick  = () => this._renderLoginForm(resolve);
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
            window.__UID__    = this.user.uid;
            window.__CONFIG__ = this.config;
            document.getElementById('login-overlay').classList.remove('visible');
            resolve(true);
        } catch (e) {
            err.textContent = 'Email o password errati.';
            document.getElementById('auth-password').value = '';
        }
    }

    async _doRegister(resolve) {
        const email  = document.getElementById('auth-email').value.trim();
        const pass   = document.getElementById('auth-password').value;
        const pass2  = document.getElementById('auth-password2').value;
        const invite = document.getElementById('auth-invite').value.trim();
        const err    = document.getElementById('auth-error');

        if (!email || !pass)         { err.textContent = 'Inserisci email e password.'; return; }
        if (pass !== pass2)          { err.textContent = 'Le password non coincidono.'; return; }
        if (pass.length < 6)         { err.textContent = 'Password troppo corta (min 6).'; return; }
        if (!invite)                 { err.textContent = 'Inserisci il codice invito.'; return; }

        err.textContent = 'Verifica codice invito...';
        try {
            const r    = await fetch(this.config.dbUrl + 'inviteCode.json');
            const code = await r.json();
            if (!code || invite !== code) {
                err.textContent = 'Codice invito non valido.';
                return;
            }
        } catch (e) {
            err.textContent = 'Errore verifica codice invito.';
            return;
        }

        err.textContent = 'Creazione account...';
        try {
            const { createUserWithEmailAndPassword } = await import(FB_AUTH_URL);
            const cred = await createUserWithEmailAndPassword(this.fireAuth, email, pass);
            this.user = cred.user;
            window.__UID__    = this.user.uid;
            window.__CONFIG__ = this.config;
            document.getElementById('login-overlay').classList.remove('visible');
            Toast.show('Account creato! Benvenuto 🎉', 'ok');
            resolve(true);
        } catch (e) {
            if (e.code === 'auth/email-already-in-use')
                err.textContent = 'Email già registrata.';
            else
                err.textContent = 'Errore creazione account.';
        }
    }
}

