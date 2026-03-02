import { Toast } from './toast.js';

const CONFIG_KEY = 'ptpro_config_v3';

export class Auth {
    constructor() {
        this.config = null;
    }

    async init() {
        const saved = localStorage.getItem(CONFIG_KEY);
        if (!saved) {
            this._showSetup();
            return false;
        }
        this.config = JSON.parse(saved);
        window.__CONFIG__ = this.config;
        const authed = await this._showLogin();
        return authed;
    }

    logout() {
        sessionStorage.removeItem('ptpro_session');
        location.reload();
    }

    async _sha256(str) {
        const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(str));
        return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
    }

    _showSetup() {
        const overlay = document.getElementById('setup-overlay');
        overlay.classList.add('visible');
        document.getElementById('btn-setup-save').addEventListener('click', async () => {
            let url  = document.getElementById('setup-db-url').value.trim();
            const p1 = document.getElementById('setup-password').value;
            const p2 = document.getElementById('setup-password2').value;
            const err = document.getElementById('setup-error');
            if (!url || !p1)     { err.textContent = 'Inserisci URL e password.'; return; }
            if (p1 !== p2)       { err.textContent = 'Le password non coincidono.'; return; }
            if (p1.length < 4)   { err.textContent = 'Password troppo corta (min 4).'; return; }
            if (!url.endsWith('/')) url += '/';
            const hash = await this._sha256(p1);
            localStorage.setItem(CONFIG_KEY, JSON.stringify({ dbUrl: url, passwordHash: hash }));
            Toast.show('Configurazione salvata!', 'ok');
            location.reload();
        });
    }

    _showLogin() {
        return new Promise(resolve => {
            if (sessionStorage.getItem('ptpro_session') === '1') {
                resolve(true); return;
            }
            const overlay = document.getElementById('login-overlay');
            overlay.classList.add('visible');
            const doLogin = async () => {
                const pass = document.getElementById('login-password').value;
                const hash = await this._sha256(pass);
                if (hash === this.config.passwordHash) {
                    sessionStorage.setItem('ptpro_session', '1');
                    overlay.classList.remove('visible');
                    resolve(true);
                } else {
                    document.getElementById('login-error').textContent = 'Password errata.';
                    document.getElementById('login-password').value = '';
                }
            };
            document.getElementById('btn-login').addEventListener('click', doLogin);
            document.getElementById('login-password').addEventListener('keydown', e => {
                if (e.key === 'Enter') doLogin();
            });
            document.getElementById('btn-reset-config').addEventListener('click', () => {
                if (confirm('Rimuovere la configurazione locale?')) {
                    localStorage.removeItem(CONFIG_KEY);
                    location.reload();
                }
            });
        });
    }
}
