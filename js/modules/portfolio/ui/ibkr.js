// ui/ibkr.js
// Collegamento IBKR: pulsante nella barra, impostazioni (token, Query ID, portafoglio),
// scaricamento giornaliero automatico tramite relay, finestra di revisione dell'import,
// annullamento dell'ultimo import. Non conosce index.js: riceve getState e save.

import { DB } from '../../../core/db.js';
import { Toast } from '../../../core/toast.js';
import { Exchange } from '../../../api/exchange.js';
import { Calc } from '../calc.js';
import { lockScroll, unlockScroll } from './helpers.js';
import { parseFlexXml } from '../ibkr-flex.js';
import { buildImportPlan, applyImportPlan, reviewCount, safeChangeCount, classifyKey } from '../ibkr-import.js';
import { downloadFlexReport } from '../ibkr-flex-client.js';

const CONFIG_PATH = 'ibkr_config';            // users/{uid}/ibkr_config — leggibile solo dall'utente
const BACKUP_PATH = 'ibkr_backup_ultimo_import';

const todayLocal = () => {
    const d = new Date();
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SYM = (c) => (c === 'USD' ? '$' : c === 'CAD' ? 'C$' : c === 'EUR' ? '€' : c || '');
const fmtDate = (d) => (d ? d.split('-').reverse().join('/') : '—');
const TYPE_LABEL = { buy: '🟢 Acquisto', sell: '🔴 Vendita', short_sell: '🔻 Short', buy_to_cover: '🔺 Copertura' };
const KIND_LABEL = {
    'premio-in-azioni': 'Premio in azioni IBKR',
    'tassa-transazioni': 'Tassa sulle transazioni finanziarie',
    'strumento-non-supportato': 'Strumento non supportato (es. opzione)',
    'apertura-chiusura-mista': 'Operazione mista apertura/chiusura',
    'trasferimento-in-uscita': 'Trasferimento in uscita'
};

export const IbkrSync = {
    _getState: null,
    _save: null,
    cfg: {},
    parsed: null,
    plan: null,
    overrides: {},
    acceptProbable: new Set(),
    manualActions: {},
    tab: 'import',
    showAll: false,
    busy: false,
    status: { kind: 'idle', text: '' },

    async init({ getState, save }) {
        this._getState = getState;
        this._save = save;
        this._ensureButton();
        const loaded = await DB.load(CONFIG_PATH);
        this.cfg = loaded && typeof loaded === 'object' ? loaded : {};
        if (!Array.isArray(this.cfg.dismissed)) this.cfg.dismissed = [];
        this._refreshButton();
        this.autoSync(); // non bloccante: il sito resta utilizzabile mentre scarica
    },

    _portfolio() {
        return this._getState?.()?.portfolios?.[this.cfg.portfolioId] || null;
    },

    _relayUrl() {
        return window.__CONFIG__?.ibkrRelayUrl || this.cfg.relayUrl || '';
    },

    _configured() {
        return !!(this.cfg.token && this.cfg.queryId && this._relayUrl() && this._portfolio());
    },

    async _saveCfg() {
        await DB.save(CONFIG_PATH, this.cfg);
    },

    // ── Scaricamento ────────────────────────────────────────────────────
    async autoSync() {
        if (!this._configured() || this.cfg.lastDownloadDay === todayLocal()) return;
        await this.download({ auto: true });
    },

    async download({ auto = false } = {}) {
        if (this.busy) return;
        if (!this._configured()) {
            if (!auto) { this.tab = 'settings'; this.openModal(); Toast.show('Completa prima le impostazioni IBKR', 'err'); }
            return;
        }
        this.busy = true;
        this._setStatus('loading', 'Scarico il report IBKR…');
        try {
            const xml = await downloadFlexReport({
                relayUrl: this._relayUrl(), token: this.cfg.token, queryId: this.cfg.queryId,
                onProgress: (m) => this._setStatus('loading', m)
            });
            this.cfg.lastDownloadDay = todayLocal();
            this.cfg.lastError = null;
            await this._loadXml(xml, { auto });
        } catch (e) {
            this.cfg.lastError = e.message;
            this._setStatus('error', e.message);
            if (!auto) Toast.show(e.message, 'err');
        } finally {
            this.busy = false;
            await this._saveCfg();
            this._rerenderIfOpen();
        }
    },

    async loadFile(file) {
        if (!this._portfolio()) { this.tab = 'settings'; this._rerenderIfOpen(); Toast.show('Scegli prima il portafoglio IBKR', 'err'); return; }
        try {
            const xml = await file.text();
            await this._loadXml(xml, { auto: false });
        } catch (e) {
            Toast.show(e.message || 'File non valido', 'err');
        }
    },

    async _loadXml(xml, { auto }) {
        this.parsed = parseFlexXml(xml);
        this.overrides = {};
        this.manualActions = {};
        this._rebuildPlan();
        // il report vince: di default tutti i probabili vengono corretti con IBKR
        this.acceptProbable = new Set(this.plan.trades.probable.map((p) => p.trade.externalId));

        if (auto) {
            // automatico: applico solo ciò che non richiede decisioni
            if (!this.plan.accountMismatch && safeChangeCount(this.plan) > 0) {
                await this._apply({ onlySafe: true, silentToast: false });
            }
            this._rebuildPlan();
            const n = this._reviewCount();
            this._setStatus(n ? 'review' : 'ok', n ? `${n} da rivedere` : `Aggiornato al ${fmtDate(this.plan.meta.to)}`);
            if (!n) { this.parsed = null; this.plan = null; }
            return;
        }
        this.tab = 'import';
        this.openModal();
    },

    _rebuildPlan() {
        const pf = this._portfolio();
        if (!this.parsed || !pf) { this.plan = null; return; }
        this.plan = buildImportPlan(this.parsed, pf, { tickerOverrides: this.overrides });
        const dismissed = new Set(this.cfg.dismissed || []);
        this.plan.toClassify = this.plan.toClassify.filter((x) => !dismissed.has(classifyKey(x)));
        // trasferimenti da broker non tracciati nel sito e avvisi: si possono silenziare con "Ho visto"
        this.plan.transfers.unmatched = this.plan.transfers.unmatched.filter((x) => !dismissed.has(`T|${x.transfer.externalId}`));
        this.plan.warnings = this.plan.warnings.filter((w) => !dismissed.has(`W|${w}`));
    },

    _reviewCount() {
        return reviewCount(this.plan, this.cfg.dismissed || []);
    },

    async _apply({ onlySafe = false, silentToast = false } = {}) {
        const pf = this._portfolio();
        if (!pf || !this.plan) return null;
        if (this.plan.accountMismatch) { Toast.show('Il report è di un altro conto IBKR: import annullato', 'err'); return null; }

        // copia di sicurezza per "Annulla ultimo import"
        await DB.save(BACKUP_PATH, { savedAt: new Date().toISOString(), portfolioId: this.cfg.portfolioId,
                                     portfolio: JSON.parse(JSON.stringify(pf)) });

        const summary = applyImportPlan(this.plan, pf, {
            onlySafe,
            acceptProbable: this.acceptProbable,
            manualActions: this.manualActions
        });

        // tassi BCE per le nuove date, prima di ricalcolare (altrimenti si userebbe il cambio di oggi)
        try { await Exchange.prefetchRatesForPortfolio(pf.assets); } catch { /* il sito riprova da solo */ }

        await this._save();
        this.cfg.lastImport = { ...summary, at: new Date().toISOString(), reportTo: this.plan.meta.to };
        this.cfg.lastReportTo = this.plan.meta.to;
        this.cfg.hasBackup = true;
        await this._saveCfg();

        const parts = [];
        if (summary.added) parts.push(`${summary.added} nuovi`);
        if (summary.corrected) parts.push(`${summary.corrected} corretti`);
        if (summary.deleted) parts.push(`${summary.deleted} eliminati`);
        if (summary.interestAdded + summary.interestUpdated) parts.push('interessi aggiornati');
        if (!silentToast && parts.length) Toast.show(`IBKR: ${parts.join(', ')}`, 'ok');
        return summary;
    },

    async undoLastImport() {
        const backup = await DB.load(BACKUP_PATH);
        const state = this._getState?.();
        if (!backup?.portfolio || !state?.portfolios?.[backup.portfolioId]) {
            Toast.show('Nessun import da annullare', 'err');
            return;
        }
        const when = new Date(backup.savedAt).toLocaleString('it-IT');
        if (!confirm(`Ripristinare il portafoglio com'era prima dell'import del ${when}?\nLe modifiche fatte dopo su quel portafoglio andranno perse.`)) return;
        const current = state.portfolios[backup.portfolioId];
        // sostituisco il contenuto mantenendo lo stesso oggetto (index.js tiene riferimenti)
        for (const k of Object.keys(current)) delete current[k];
        Object.assign(current, backup.portfolio);
        await this._save();
        await DB.save(BACKUP_PATH, null);
        this.cfg.hasBackup = false;
        this.cfg.lastDownloadDay = null; // al prossimo avvio riscarica
        await this._saveCfg();
        this.plan = null; this.parsed = null;
        this._setStatus('idle', 'Import annullato');
        this._rerenderIfOpen();
        Toast.show('Ultimo import annullato', 'ok');
    },

    // ── Pulsante nella barra ───────────────────────────────────────────
    _ensureButton() {
        const bar = document.querySelector('.controls-right');
        if (!bar || document.getElementById('btn-ibkr')) return;
        const btn = document.createElement('button');
        btn.id = 'btn-ibkr';
        btn.className = 'btn-fiscale';
        btn.innerHTML = `🏦 IBKR <span class="fiscale-badge" id="ibkr-badge" style="display:none;"></span>`;
        btn.addEventListener('click', () => {
            this.tab = this._configured() || this.plan ? 'import' : 'settings';
            this.openModal();
        });
        bar.prepend(btn);
    },

    _setStatus(kind, text) {
        this.status = { kind, text };
        this._refreshButton();
        const el = document.getElementById('ibkr-status-line');
        if (el) el.textContent = text;
    },

    _refreshButton() {
        const btn = document.getElementById('btn-ibkr');
        const badge = document.getElementById('ibkr-badge');
        if (!btn || !badge) return;
        const { kind, text } = this.status;
        const map = { loading: '…', review: String(this._reviewCount() || '!'), error: '!', ok: '✓' };
        badge.textContent = map[kind] || '';
        badge.style.display = map[kind] ? 'inline-flex' : 'none';
        btn.title = text || (this._configured() ? 'IBKR collegato' : 'Collega IBKR');
    },

    // ── Finestra ───────────────────────────────────────────────────────
    openModal() {
        let wrap = document.getElementById('modal-ibkr');
        if (!wrap) {
            wrap = document.createElement('div');
            wrap.id = 'modal-ibkr';
            wrap.className = 'overlay visible';
            document.body.appendChild(wrap);
            lockScroll();
            this._bindModal(wrap);
        }
        this._render(wrap);
    },

    closeModal() {
        const wrap = document.getElementById('modal-ibkr');
        if (!wrap) return;
        wrap.remove();
        unlockScroll();
    },

    _rerenderIfOpen() {
        const wrap = document.getElementById('modal-ibkr');
        if (wrap) this._render(wrap);
    },

    _render(wrap) {
        const tabBtn = (id, label) =>
            `<button class="btn-toggle ${this.tab === id ? 'active' : ''}" data-ibkr-tab="${id}">${label}</button>`;
        wrap.innerHTML = `
            <div class="modal modal-wide">
                <div class="modal-header">
                    <h3>🏦 IBKR</h3>
                    <button class="btn-x" data-ibkr-close>✕</button>
                </div>
                <div class="modal-body">
                    <div style="display:flex;gap:8px;margin-bottom:14px;">
                        ${tabBtn('import', 'Import')}${tabBtn('settings', 'Impostazioni')}
                    </div>
                    <div id="ibkr-status-line" style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">${esc(this.status.text)}</div>
                    ${this.tab === 'settings' ? this._settingsHtml() : this._importHtml()}
                </div>
            </div>`;
    },

    _settingsHtml() {
        const portfolios = Object.values(this._getState?.()?.portfolios || {});
        const guess = portfolios.find((p) => /ibkr|interactive/i.test(p.name || ''))
            || portfolios.find((p) => p.taxRegime === 'dichiarativo');
        const selected = this.cfg.portfolioId || guess?.id || '';
        const relayFromConfig = !!window.__CONFIG__?.ibkrRelayUrl;
        const li = this.cfg.lastImport;
        return `
            <div class="form-grid-2">
                <div>
                    <span class="modal-label">Portafoglio IBKR</span>
                    <select id="ibkr-portfolio">
                        ${portfolios.map((p) => `<option value="${esc(p.id)}" ${p.id === selected ? 'selected' : ''}>${esc(p.name)} · ${p.taxRegime === 'dichiarativo' ? 'Dich.' : 'Amm.'}</option>`).join('')}
                    </select>
                </div>
                <div>
                    <span class="modal-label">Query ID</span>
                    <input type="text" id="ibkr-query" inputmode="numeric" value="${esc(this.cfg.queryId || '')}" placeholder="es. 1234567">
                </div>
                <div>
                    <span class="modal-label">Token Flex Web Service</span>
                    <input type="password" id="ibkr-token" autocomplete="off" placeholder="${this.cfg.token ? 'salvato — lascia vuoto per non cambiarlo' : 'incolla il token generato su IBKR'}">
                </div>
                ${relayFromConfig ? '' : `
                <div>
                    <span class="modal-label">Indirizzo relay</span>
                    <input type="text" id="ibkr-relay" value="${esc(this.cfg.relayUrl || '')}" placeholder="https://….workers.dev">
                </div>`}
            </div>
            <p style="font-size:11px;color:var(--text-muted);margin:10px 0 0;">
                Il token resta nel tuo spazio privato del database: lo leggi solo tu. Serve solo a scaricare i report, non a operare sul conto.
            </p>
            <div style="display:flex;flex-wrap:wrap;gap:8px;margin-top:14px;">
                <button class="btn btn-success" data-ibkr-save>💾 Salva</button>
                <button class="btn btn-dark" data-ibkr-download ${this.busy ? 'disabled' : ''}>⬇️ Scarica ora</button>
                <label class="btn btn-dark" style="cursor:pointer;">📄 Carica XML<input type="file" accept=".xml,text/xml" data-ibkr-file style="display:none;"></label>
                ${this.cfg.hasBackup ? `<button class="btn btn-ghost" data-ibkr-undo>↩️ Annulla ultimo import</button>` : ''}
                ${this.cfg.token ? `<button class="btn btn-ghost" data-ibkr-forget>Scollega</button>` : ''}
            </div>
            <div class="preview-box" style="margin-top:14px;font-size:12px;">
                <div>Ultimo scaricamento: <b>${fmtDate(this.cfg.lastDownloadDay)}</b> · report fino al <b>${fmtDate(this.cfg.lastReportTo)}</b></div>
                ${li ? `<div style="margin-top:4px;">Ultimo import: ${li.added} nuovi, ${li.corrected} corretti, ${li.deleted || 0} eliminati, ${li.interestAdded + li.interestUpdated} righe interessi</div>` : ''}
                ${this.cfg.lastError ? `<div style="margin-top:4px;color:var(--danger);">Ultimo errore: ${esc(this.cfg.lastError)}</div>` : ''}
            </div>`;
    },

    _importHtml() {
        const p = this.plan;
        if (!p) {
            return `
                <div class="fiscale-empty" style="padding:18px 0;">
                    ${this._configured()
                        ? `Il sito scarica il report da solo una volta al giorno. ${this.status.kind === 'ok' ? 'Oggi è già tutto aggiornato.' : ''}`
                        : 'Collega IBKR dalle Impostazioni, oppure carica un file XML.'}
                </div>
                <div style="display:flex;gap:8px;flex-wrap:wrap;">
                    <button class="btn btn-dark" data-ibkr-download ${this.busy || !this._configured() ? 'disabled' : ''}>⬇️ Scarica ora</button>
                    <label class="btn btn-dark" style="cursor:pointer;">📄 Carica XML<input type="file" accept=".xml,text/xml" data-ibkr-file style="display:none;"></label>
                </div>`;
        }

        const t = p.trades;
        const kpi = (label, value) => `
            <div style="flex:1;min-width:110px;background:var(--bg2);border:1px solid var(--border);border-radius:8px;padding:8px 10px;">
                <div style="font-size:11px;color:var(--text-muted);">${label}</div>
                <div style="font-size:18px;font-weight:700;">${value}</div>
            </div>`;
        const toReview = this._reviewCount();

        // Tabella movimenti
        const rows = [
            ...t.toAdd.map((x) => ({ t: x.trade, state: 'new' })),
            ...t.matched.map((x) => ({ t: x.trade, state: Object.values(x.diff).some(Boolean) ? 'fixed' : 'linked' })),
            ...t.probable.map((x) => ({ t: x.trade, state: 'probable' }))
        ].sort((a, b) => b.t.date.localeCompare(a.t.date));
        const shown = this.showAll ? rows : rows.slice(0, 12);
        const stateBadge = {
            new: '<span class="badge" style="color:var(--success);">Nuovo</span>',
            linked: '<span class="badge">Già tuo</span>',
            fixed: '<span class="badge" style="color:var(--accent);">Corretto</span>',
            probable: '<span class="badge" style="color:var(--warning);">Da verificare</span>'
        };
        const movHtml = rows.length ? `
            <div class="table-wrapper">
                <table class="tx-table tx-table-compact">
                    <thead><tr><th>Data</th><th>Tipo</th><th>Titolo</th><th>Q.tà</th><th>Prezzo</th><th>Comm.</th><th>Stato</th></tr></thead>
                    <tbody>${shown.map(({ t: tr, state }) => `
                        <tr>
                            <td>${fmtDate(tr.date)}</td>
                            <td>${TYPE_LABEL[tr.type] || tr.type}</td>
                            <td>${esc(tr.symbol)}</td>
                            <td>${Calc.fmt(tr.qty, 4)}</td>
                            <td>${SYM(tr.currency)} ${Calc.fmt(tr.price, 4)}</td>
                            <td>${SYM(tr.commissionCurrency)} ${Calc.fmt(tr.commission)}</td>
                            <td>${stateBadge[state]}</td>
                        </tr>`).join('')}
                    </tbody>
                </table>
            </div>
            ${rows.length > 12 ? `<button class="btn btn-ghost btn-sm" data-ibkr-showall style="margin-top:6px;">${this.showAll ? 'Mostra meno' : `Mostra tutti e ${rows.length}`}</button>` : ''}`
            : '<div class="fiscale-empty">Nessun movimento nuovo.</div>';

        // Probabili: il report vince, ma puoi dire che sono due operazioni diverse
        const fmtSide = (o, cur) => `${Calc.fmt(o.qty, 4)} @ ${SYM(cur)} ${Calc.fmt(o.price, 4)} · comm ${SYM(o.ccy)} ${Calc.fmt(o.comm)}`;
        const probHtml = t.probable.length ? section('Valori diversi dai tuoi: vince IBKR', t.probable.map((x) => `
            <label style="display:flex;gap:8px;align-items:flex-start;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;">
                <input type="checkbox" data-ibkr-prob="${esc(x.trade.externalId)}" ${this.acceptProbable.has(x.trade.externalId) ? 'checked' : ''}>
                <span><b>${esc(x.trade.symbol)}</b> ${TYPE_LABEL[x.trade.type]} del ${fmtDate(x.trade.date)}<br>
                    Tuo: ${fmtSide({ qty: x.tx.qty, price: x.tx.price, comm: x.tx.commission || 0, ccy: x.tx.commissionCurrency || 'EUR' }, x.trade.currency)}<br>
                    IBKR: ${fmtSide({ qty: x.trade.qty, price: x.trade.price, comm: x.trade.commission, ccy: x.trade.commissionCurrency }, x.trade.currency)}<br>
                    <span style="color:var(--text-muted);">Togli la spunta se sono due operazioni diverse: aggiungo quella IBKR e tengo la tua.</span></span>
            </label>`).join('')) : '';

        // Titoli nuovi: ticker Yahoo modificabile
        const assetsHtml = p.newAssets.length ? section('Titoli nuovi: controlla il ticker di Yahoo', `
            <div style="display:grid;grid-template-columns:repeat(auto-fill,minmax(210px,1fr));gap:6px;">
                ${p.newAssets.map((a) => `
                    <div style="display:flex;align-items:center;gap:6px;border:1px solid ${a.confident ? 'var(--border)' : 'var(--warning)'};border-radius:6px;padding:4px 6px;font-size:12px;">
                        <span style="width:52px;">${esc(a.symbol)}</span>
                        <input type="text" value="${esc(a.ticker)}" data-ibkr-ticker="${esc(a.symbol)}" style="width:90px;font-size:12px;">
                        <span class="badge">${esc(a.currency)}</span>
                        ${a.confident ? '' : '<span class="badge" style="color:var(--warning);">verifica</span>'}
                    </div>`).join('')}
            </div>`) : '';

        // Tuoi movimenti senza corrispondenza
        const manualHtml = t.unmatchedManual.length ? section('Tuoi movimenti che IBKR non ha', t.unmatchedManual.map((u) => `
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;">
                <span>${fmtDate(u.tx.date)} · ${TYPE_LABEL[u.tx.type] || u.tx.type} · <b>${esc(this._portfolio()?.assets?.[u.assetId]?.nome || u.assetId)}</b> · ${Calc.fmt(u.tx.qty, 4)} @ ${Calc.fmt(u.tx.price, 4)}</span>
                <select data-ibkr-manual="${esc(u.txId || '')}" ${u.txId ? '' : 'disabled title="Ricarica la pagina per abilitare"'}>
                    <option value="">Decidi dopo</option>
                    <option value="delete" ${this.manualActions[u.txId] === 'delete' ? 'selected' : ''}>Elimina</option>
                    <option value="keep" ${this.manualActions[u.txId] === 'keep' ? 'selected' : ''}>Tieni, non chiedere più</option>
                </select>
            </div>`).join('')) : '';

        // Trasferimenti non trovati, avvisi, voci da classificare
        const infoRows = [
            ...p.transfers.unmatched.map((x) => ({ text: `Trasferimento in ingresso ${esc(x.ticker)} · ${Calc.fmt(x.transfer.qty, 4)} del ${fmtDate(x.transfer.date)}: crealo dal portafoglio d'origine, così il costo fiscale resta quello vero`, key: `T|${x.transfer.externalId}` })),
            ...p.warnings.map((w) => ({ text: esc(w), key: `W|${w}` })),
            ...p.toClassify.map((x) => ({ text: `${KIND_LABEL[x.kind] || x.kind} · ${esc(x.symbol)} · ${fmtDate(x.date)} · ${esc(x.detail)}`, key: classifyKey(x) }))
        ];
        const infoHtml = infoRows.length ? section('Da sapere', infoRows.map((r) => `
            <div style="display:flex;justify-content:space-between;gap:8px;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px;">
                <span>${r.text}</span>
                ${r.key ? `<button class="btn btn-ghost btn-sm" data-ibkr-dismiss="${esc(r.key)}">Ho visto</button>` : ''}
            </div>`).join('')) : '';

        // Interessi
        const it = p.interest;
        const intTot = {};
        for (const x of [...it.toAdd, ...it.matched, ...it.updated]) intTot[x.currency || x.row?.currency] = (intTot[x.currency || x.row?.currency] || 0) + x.amount;
        const intHtml = (it.toAdd.length + it.matched.length + it.updated.length)
            ? section('Interessi di margine', `<div style="font-size:12px;">${it.toAdd.length} mesi nuovi, ${it.matched.length + it.updated.length} aggiornati · ${Object.entries(intTot).map(([c, v]) => `${SYM(c)} ${Calc.fmt(v)}`).join(' · ')}</div>`)
            : '';

        const actionable = t.toAdd.length + t.matched.length + t.probable.length
            + Object.values(this.manualActions).filter(Boolean).length + p.transfers.matched.length
            + it.toAdd.length + it.matched.length + it.updated.length;

        return `
            ${p.accountMismatch ? `<div class="preview-box" style="border-color:var(--danger);color:var(--danger);margin-bottom:10px;">Questo report è di un altro conto IBKR: l'import è bloccato.</div>` : ''}
            <div style="font-size:12px;color:var(--text-muted);margin-bottom:10px;">Report dal ${fmtDate(p.meta.from)} al ${fmtDate(p.meta.to)} · ${this.parsed?.trades?.length || 0} ordini</div>
            <div style="display:flex;gap:8px;flex-wrap:wrap;margin-bottom:14px;">
                ${kpi('Nuovi', t.toAdd.length)}${kpi('Abbinati ai tuoi', t.matched.length)}${kpi('Già importati', t.alreadyImported.length)}${kpi('Da rivedere', toReview)}
            </div>
            ${movHtml}${probHtml}${assetsHtml}${manualHtml}${infoHtml}${intHtml}
            <div style="display:flex;justify-content:flex-end;gap:8px;margin-top:16px;">
                <button class="btn btn-ghost" data-ibkr-close>Chiudi</button>
                <button class="btn btn-success" data-ibkr-apply ${p.accountMismatch || !actionable ? 'disabled' : ''}>Importa</button>
            </div>`;
    },

    _bindModal(wrap) {
        wrap.addEventListener('click', async (e) => {
            const el = e.target.closest('[data-ibkr-close],[data-ibkr-tab],[data-ibkr-save],[data-ibkr-download],[data-ibkr-undo],[data-ibkr-forget],[data-ibkr-apply],[data-ibkr-showall],[data-ibkr-dismiss]');
            if (!el) { if (e.target === wrap) this.closeModal(); return; }
            if (el.hasAttribute('data-ibkr-close')) return this.closeModal();
            if (el.dataset.ibkrTab) { this.tab = el.dataset.ibkrTab; return this._render(wrap); }
            if (el.hasAttribute('data-ibkr-showall')) { this.showAll = !this.showAll; return this._render(wrap); }
            if (el.hasAttribute('data-ibkr-save')) return this._saveSettings();
            if (el.hasAttribute('data-ibkr-download')) return this.download({ auto: false });
            if (el.hasAttribute('data-ibkr-undo')) return this.undoLastImport();
            if (el.hasAttribute('data-ibkr-forget')) {
                if (!confirm('Scollegare IBKR? Il token verrà rimosso da questo sito. I movimenti già importati restano.')) return;
                delete this.cfg.token; this.cfg.lastDownloadDay = null;
                await this._saveCfg(); this._setStatus('idle', 'IBKR scollegato'); return this._render(wrap);
            }
            if (el.dataset.ibkrDismiss) {
                this.cfg.dismissed = [...new Set([...(this.cfg.dismissed || []), el.dataset.ibkrDismiss])];
                await this._saveCfg();
                this._rebuildPlan(); this._refreshButton(); return this._render(wrap);
            }
            if (el.hasAttribute('data-ibkr-apply')) {
                el.disabled = true;
                const summary = await this._apply({ onlySafe: false });
                if (!summary) { el.disabled = false; return; }
                this._rebuildPlan();
                const n = this._reviewCount();
                this._setStatus(n ? 'review' : 'ok', n ? `${n} da rivedere` : `Aggiornato al ${fmtDate(this.plan?.meta?.to)}`);
                if (!n) { this.plan = null; this.parsed = null; }
                return this._render(wrap);
            }
        });

        wrap.addEventListener('change', (e) => {
            const el = e.target;
            if (el.matches('[data-ibkr-file]') && el.files?.[0]) return this.loadFile(el.files[0]);
            if (el.dataset.ibkrProb) {
                if (el.checked) this.acceptProbable.add(el.dataset.ibkrProb);
                else this.acceptProbable.delete(el.dataset.ibkrProb);
                return;
            }
            if (el.dataset.ibkrManual !== undefined && el.dataset.ibkrManual) {
                this.manualActions[el.dataset.ibkrManual] = el.value || undefined;
                return this._render(wrap);
            }
            if (el.dataset.ibkrTicker) {
                const v = el.value.trim().toUpperCase();
                if (v) this.overrides[el.dataset.ibkrTicker] = v; else delete this.overrides[el.dataset.ibkrTicker];
                this._rebuildPlan();
                return this._render(wrap);
            }
        });
    },

    async _saveSettings() {
        const pid = document.getElementById('ibkr-portfolio')?.value || '';
        const query = (document.getElementById('ibkr-query')?.value || '').trim();
        const token = (document.getElementById('ibkr-token')?.value || '').trim();
        const relay = document.getElementById('ibkr-relay');
        if (!pid) { Toast.show('Scegli il portafoglio IBKR', 'err'); return; }
        if (query && !/^\d{3,12}$/.test(query)) { Toast.show('Il Query ID è fatto solo di cifre', 'err'); return; }
        if (token && !/^[A-Za-z0-9]{8,64}$/.test(token)) { Toast.show('Token non valido: controlla di averlo copiato intero', 'err'); return; }

        const changed = pid !== this.cfg.portfolioId || (query && query !== this.cfg.queryId) || !!token;
        this.cfg.portfolioId = pid;
        if (query) this.cfg.queryId = query;
        if (token) this.cfg.token = token;
        if (relay) this.cfg.relayUrl = relay.value.trim().replace(/\/+$/, '');
        if (changed) this.cfg.lastDownloadDay = null;
        await this._saveCfg();
        Toast.show('Impostazioni IBKR salvate', 'ok');
        this.tab = 'import';
        this._rerenderIfOpen();
        if (changed && this._configured()) this.download({ auto: false });
    }
};

function section(title, body) {
    return `<div style="margin-top:16px;"><div style="font-size:12px;font-weight:600;color:var(--text-muted);margin-bottom:6px;">${title}</div>${body}</div>`;
}