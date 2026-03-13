import { Cache } from '../../core/cache.js';
import { Toast } from '../../core/toast.js';
import { Auth } from '../../core/auth.js';

const CONFIG_KEY = 'ptpro_config_v5';

export class SettingsPage {
    constructor(container) { this.container = container; }

    mount() {
        this.container.innerHTML = `
            <div class="card" style="max-width:540px;">
                <div class="card-title">⚙️ Impostazioni</div>
                <span class="modal-label">Nuova Password (lascia vuoto per non cambiare)</span>
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
            const p1 = document.getElementById('s-pass1').value;
            const p2 = document.getElementById('s-pass2').value;
            if (!p1) { Toast.show('Inserisci una nuova password', 'err'); return; }
            if (p1 !== p2) { Toast.show('Le password non coincidono', 'err'); return; }
            if (p1.length < 6) { Toast.show('Password troppo corta (min 6)', 'err'); return; }

            try {
                const FB_AUTH_URL = 'https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js';
                const { getAuth, updatePassword } = await import(FB_AUTH_URL);
                const user = getAuth().currentUser;
                await updatePassword(user, p1);
                Toast.show('Password aggiornata ✅', 'ok');
                document.getElementById('s-pass1').value = '';
                document.getElementById('s-pass2').value = '';
            } catch (e) {
                if (e.code === 'auth/requires-recent-login')
                    Toast.show('Fai logout e riaccedi prima di cambiare password', 'err');
                else
                    Toast.show('Errore aggiornamento password', 'err');
            }
        };
    }
    destroy() {}
}
