import { Cache } from '../../core/cache.js';
import { Toast } from '../../core/toast.js';
import { Exchange } from '../../api/exchange.js';
import { DB } from '../../core/db.js';
import { escapeHtml as esc } from '../portfolio/ui/helpers.js';

// Codice invito: 12 caratteri casuali senza simboli ambigui (0/O, 1/I/L), es. K7PM-Q2XD-9RWA.
// Deve rispettare il formato delle regole del database: /^[A-Z0-9-]{8,32}$/
function newInviteCode() {
    const alphabet = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 31 caratteri
    const out = [];
    while (out.length < 12) {
        const b = crypto.getRandomValues(new Uint8Array(1))[0];
        if (b < 248) out.push(alphabet[b % 31]); // scarta i valori che sbilancerebbero la distribuzione
    }
    return `${out.slice(0, 4).join('')}-${out.slice(4, 8).join('')}-${out.slice(8).join('')}`;
}

const fmtDate = ts => ts ? new Date(ts).toLocaleDateString('it-IT') : '—';

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
            </div>
            <div id="s-invites"></div>`;

        this._initInvites();

        document.getElementById('s-clear-cache').onclick = () => {
            Cache.clear();
            Exchange.clearHistoricCache();
            Toast.show('Cache svuotata', 'ok');
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

    // ── INVITI (solo admin) ─────────────────────────────────────────
    // Chi non è admin non vede nulla: le regole gli negano comunque la lettura di invites e members.
    async _initInvites() {
        const r = await DB.rootRequest('GET', `admins/${window.__UID__}`);
        if (!r.ok || r.data !== true) return;
        this._renderInvites();
    }

    async _renderInvites() {
        const box = document.getElementById('s-invites');
        if (!box) return;
        const [inv, mem] = await Promise.all([
            DB.rootRequest('GET', 'invites'),
            DB.rootRequest('GET', 'members')
        ]);
        if (!inv.ok || !mem.ok) {
            box.innerHTML = `<div class="card" style="max-width:540px;margin-top:16px;">Errore nel caricamento degli inviti.</div>`;
            return;
        }
        const members = mem.data || {};
        const rows = Object.entries(inv.data || {})
            .sort(([, a], [, b]) => (b.createdAt || 0) - (a.createdAt || 0))
            .map(([code, i]) => {
                const used = i.usedBy
                    ? `<span class="text-muted">usato da ${esc(members[i.usedBy]?.email || i.usedBy)}</span>`
                    : '<b class="text-success">libero</b>';
                const actions = i.usedBy ? '' : `
                    <button class="btn btn-ghost btn-sm" data-copy="${esc(code)}" title="Copia codice">📋</button>
                    <button class="btn btn-ghost btn-sm" data-del="${esc(code)}" title="Elimina invito">✕</button>`;
                return `<tr>
                    <td style="font-family:monospace;white-space:nowrap;">${esc(code)}</td>
                    <td>${esc(i.note || '')}</td>
                    <td>${used}</td>
                    <td>${fmtDate(i.createdAt)}</td>
                    <td style="white-space:nowrap;">${actions}</td>
                </tr>`;
            }).join('');

        box.innerHTML = `
            <div class="card" style="max-width:540px;margin-top:16px;">
                <div class="card-title">🎟️ Inviti</div>
                <p class="text-muted fs-sm" style="margin:6px 0 12px;">Ogni codice vale per una sola registrazione. Chi lo usa ha un portafoglio tutto suo: non vede i tuoi dati.</p>
                <div style="display:flex;gap:8px;">
                    <input type="text" id="s-inv-note" placeholder="Per chi è? (facoltativo)" maxlength="60">
                    <button id="s-inv-new" class="btn btn-success btn-sm" style="white-space:nowrap;">+ Crea invito</button>
                </div>
                ${rows ? `<div style="overflow-x:auto;margin-top:12px;"><table class="fs-sm" style="width:100%;">
                    <thead><tr><th>Codice</th><th>Nota</th><th>Stato</th><th>Creato</th><th></th></tr></thead>
                    <tbody>${rows}</tbody></table></div>`
                : '<p class="text-muted fs-sm" style="margin-top:12px;">Nessun invito creato.</p>'}
            </div>`;

        box.querySelector('#s-inv-new').onclick = async () => {
            const code = newInviteCode();
            const note = box.querySelector('#s-inv-note').value.trim().slice(0, 60);
            const res = await DB.rootRequest('PUT', `invites/${code}`, {
                createdBy: window.__UID__,
                createdAt: { '.sv': 'timestamp' },
                ...(note ? { note } : {})
            });
            if (!res.ok) { Toast.show('Errore creazione invito', 'err'); return; }
            try { await navigator.clipboard.writeText(code); Toast.show(`Invito ${code} creato e copiato`, 'ok'); }
            catch { Toast.show(`Invito ${code} creato`, 'ok'); }
            this._renderInvites();
        };
        box.querySelectorAll('[data-copy]').forEach(b => b.onclick = async () => {
            try { await navigator.clipboard.writeText(b.dataset.copy); Toast.show('Codice copiato', 'ok'); }
            catch { Toast.show(b.dataset.copy, 'info'); }
        });
        box.querySelectorAll('[data-del]').forEach(b => b.onclick = async () => {
            if (!confirm(`Eliminare l'invito ${b.dataset.del}?`)) return;
            const res = await DB.rootRequest('DELETE', `invites/${b.dataset.del}`);
            if (!res.ok) { Toast.show('Errore eliminazione', 'err'); return; }
            this._renderInvites();
        });
    }

    destroy() {}
}
