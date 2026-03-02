import { Cache } from '../../core/cache.js';
import { Toast } from '../../core/toast.js';

const CONFIG_KEY = 'ptpro_config_v3';

export class SettingsPage {
    constructor(container) { this.container = container; }

    mount() {
        const cfg = JSON.parse(localStorage.getItem(CONFIG_KEY) || '{}');
        this.container.innerHTML = `
            <div class="card" style="max-width:540px;">
                <div class="card-title">⚙️ Impostazioni</div>
                <span class="modal-label">Firebase Database URL</span>
                <input type="url" id="s-dburl" value="${cfg.dbUrl || ''}">
                <span class="modal-label" style="margin-top:14px;">Nuova Password (lascia vuoto per non cambiare)</span>
                <input type="password" id="s-pass1" placeholder="Nuova password">
                <input type="password" id="s-pass2" placeholder="Conferma nuova password" style="margin-top:8px;">
                <button id="s-save" class="btn btn-success" style="margin-top:18px;">Salva Modifiche</button>
                <hr style="border-color:var(--border); margin:20px 0;">
                <span class="modal-label">Cache Prezzi</span>
                <p class="text-muted fs-sm" style="margin:6px 0 12px;">La cache locale velocizza il caricamento iniziale (TTL 8 min).</p>
                <button id="s-clear-cache" class="btn btn-danger btn-sm">🗑 Svuota Cache Prezzi</button>
            </div>`;

        document.getElementById('s-clear-cache').onclick = () => {
            Cache.clear(); Toast.show('Cache svuotata', 'ok');
        };

        document.getElementById('s-save').onclick = async () => {
            let url  = document.getElementById('s-dburl').value.trim();
            const p1 = document.getElementById('s-pass1').value;
            const p2 = document.getElementById('s-pass2').value;
            if (!url) { Toast.show('URL obbligatorio', 'err'); return; }
            if (!url.endsWith('/')) url += '/';
            const newCfg = { ...cfg, dbUrl: url };
            if (p1) {
                if (p1 !== p2) { Toast.show('Le password non coincidono', 'err'); return; }
                if (p1.length < 4) { Toast.show('Password troppo corta', 'err'); return; }
                const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(p1));
                newCfg.passwordHash = Array.from(new Uint8Array(buf)).map(b=>b.toString(16).padStart(2,'0')).join('');
            }
            localStorage.setItem(CONFIG_KEY, JSON.stringify(newCfg));
            window.__CONFIG__ = newCfg;
            Toast.show('Impostazioni salvate', 'ok');
        };
    }
    destroy() {}
}
