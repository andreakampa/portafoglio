import { DB } from '../../core/db.js';
import { Cache } from '../../core/cache.js';
import { Toast } from '../../core/toast.js';
import { Exchange } from '../../api/exchange.js';
import { Yahoo } from '../../api/yahoo.js';
import { Search } from '../../api/search.js';
import { renderPage, renderTable, renderKPI, renderSkeleton, renderMobileCards } from './render.js';
import { openTransactionModal, openHistoryModal, openSimModal } from './ui.js';

export class PortfolioPage {
    constructor(container) {
        this.container   = container;
        this.portfolio   = {};
        this.prices      = {};
        this.prevClose   = {};
        this.currency    = 'EUR';
        this._autoTimer  = null;
        this._state = () => ({
            portfolio: this.portfolio,
            prices:    this.prices,
            prevClose: this.prevClose,
            currency:  this.currency,
        });
    }

    async mount() {
        renderPage(this.container);
        this._bindStaticEvents();
        renderSkeleton();

        const cached = Cache.getPrices();
        if (cached) { this.prices = cached.prices; this.prevClose = cached.prevs; }

        await Promise.all([Exchange.update(), this._loadData()]);
        this._updateExchangeLabel();
        renderTable(this._state(), this._handlers());
        renderKPI(this._state());

        this._refreshPrices();
        this._autoTimer = setInterval(() => this._backgroundRefresh(), 5 * 60 * 1000);
    }

    destroy() {
        clearInterval(this._autoTimer);
    }

    async _loadData() {
        const raw = await DB.load('portafoglio');
        this.portfolio = raw || {};
        let migrated = false;
        for (const id in this.portfolio) {
            const p = this.portfolio[id];
            if (!p.transactions) {
                p.transactions = [];
                if (p.qta > 0) {
                    p.transactions.push({
                        date: new Date().toISOString().slice(0,10),
                        type: 'buy', qty: +p.qta, price: +(p.pmc || 0), commission: 0
                    });
                }
                if (p.realizedPnL) p._legacyRealizedPnL = +p.realizedPnL;
                if (!p.tipoAsset)  p.tipoAsset = 'stock';
                if (!p.commDefault) p.commDefault = 7;
                delete p.qta; delete p.pmc; delete p.realizedPnL;
                migrated = true;
            }
        }
        if (migrated) {
            await DB.save('portafoglio', this.portfolio);
            Toast.show('📦 Dati migrati al nuovo formato', 'info');
        }
    }

        async _save() {
        await DB.save('portafoglio', this.portfolio);
        renderTable(this._state(), this._handlers());
        renderKPI(this._state());
        renderMobileCards(this._state(), this._handlers());
    }

    async _refreshPrices(soloId = null) {
        const btn = document.getElementById('btn-refresh');
        if (btn) { btn.disabled = true; btn.innerHTML = '<span class="spinner"></span>Aggiornamento...'; }

        const tickerMap = soloId
            ? { [soloId]: this.portfolio[soloId].nome }
            : Object.fromEntries(Object.keys(this.portfolio).map(id => [id, this.portfolio[id].nome]));

        const { prices, prevs } = await Yahoo.fetchAll(tickerMap);
        Object.assign(this.prices, prices);
        Object.assign(this.prevClose, prevs);
        Cache.savePrices(this.prices, this.prevClose);

        if (btn) { btn.disabled = false; btn.innerHTML = '🔄 Aggiorna'; }
        this._updateTimestamp();
        renderTable(this._state(), this._handlers());
        renderKPI(this._state());
        renderMobileCards(this._state(), this._handlers());

    }

    async _backgroundRefresh() {
        await Exchange.update();
        this._updateExchangeLabel();
        await this._refreshPrices();
    }

    _updateExchangeLabel() {
        const el = document.getElementById('exchange-info');
        if (el) el.innerHTML = `Cambio Real-Time: <span>1 EUR = ${Exchange.rate.toFixed(4)} USD</span>`;
    }

    _updateTimestamp() {
        const el = document.getElementById('last-update');
        if (!el) return;
        const d = new Date();
        el.textContent =
            `Agg. ${String(d.getHours()).padStart(2,'0')}:${String(d.getMinutes()).padStart(2,'0')}`;
    }

        _bindStaticEvents() {
        document.getElementById('btn-refresh')?.addEventListener('click', async () => {
            await Exchange.update();
            this._updateExchangeLabel();
            await this._refreshPrices();
            Toast.show('Prezzi aggiornati', 'ok');
        });

        document.getElementById('btn-eur')?.addEventListener('click', () => this._setValuta('EUR'));
        document.getElementById('btn-usd')?.addEventListener('click', () => this._setValuta('USD'));

        // ── AUTO SUGGEST ──────────────────────────────
        let _suggestTimer = null;
        const inputTitolo  = document.getElementById('input-titolo');
        const suggestBox   = document.getElementById('ticker-suggestions');
        const selectedBox  = document.getElementById('ticker-selected');
        const btnAdd       = document.getElementById('btn-add-titolo');
        const hiddenTicker = document.getElementById('input-ticker-final');
        const hiddenValuta = document.getElementById('input-valuta');

        const clearSelection = () => {
            hiddenTicker.value = '';
            hiddenValuta.value = '';
            btnAdd.disabled = true;
            selectedBox.textContent = '— nessuno selezionato —';
            selectedBox.className = 'ticker-selected-box';
        };

        inputTitolo.addEventListener('input', () => {
            clearSelection();
            clearTimeout(_suggestTimer);
            const q = inputTitolo.value.trim();
            if (q.length < 1) { suggestBox.innerHTML = ''; suggestBox.classList.remove('visible'); return; }
            suggestBox.innerHTML = '<div class="suggest-loading">Ricerca...</div>';
            suggestBox.classList.add('visible');
            _suggestTimer = setTimeout(async () => {
                const results = await Search.query(q);
                if (!results.length) {
                    suggestBox.innerHTML = '<div class="suggest-empty">Nessun risultato</div>';
                    return;
                }
                    suggestBox.innerHTML = results.map(r => `
                    <div class="suggest-item" 
                         data-ticker="${r.ticker}" 
                         data-currency="${r.currency}" 
                         data-name="${r.name}"
                         data-tipo="${r.tipoAsset}"
                         data-tipolabel="${r.tipoLabel}">
                        <span class="suggest-ticker">${r.ticker}</span>
                        <span class="suggest-name">${r.name}</span>
                        <span class="suggest-meta">${r.exchange} · ${r.currency} · ${r.tipoLabel}</span>
                    </div>`).join('');


                                suggestBox.querySelectorAll('.suggest-item').forEach(el => {
                    el.addEventListener('click', () => {
                        const ticker    = el.dataset.ticker;
                        const currency  = el.dataset.currency;
                        const name      = el.dataset.name;
                        const tipoAsset = el.dataset.tipo;
                        const tipoLabel = el.dataset.tipolabel;
                        hiddenTicker.value = ticker;
                        hiddenValuta.value = currency;
                        inputTitolo.value  = ticker;
                        suggestBox.innerHTML = '';
                        suggestBox.classList.remove('visible');
                        btnAdd.disabled = false;

                        // imposta automaticamente il tipo asset nel select
                        const hiddenTipo = document.getElementById('input-tipo-asset');
                        if (hiddenTipo) hiddenTipo.value = tipoAsset;

                        selectedBox.innerHTML =
                            `<b>${ticker}</b> — ${name} <span class="badge">${currency}</span> <span class="badge">${tipoLabel}</span>`;
                        selectedBox.className = 'ticker-selected-box selected';
                    });
                });
            }, 350);
        });

        document.addEventListener('click', e => {
            if (!e.target.closest('#input-titolo') && !e.target.closest('#ticker-suggestions')) {
                suggestBox.classList.remove('visible');
            }
        });

        document.getElementById('btn-add-titolo')?.addEventListener('click', () => this._aggiungiTitolo());
    }


    _setValuta(v) {
        this.currency = v;
        document.getElementById('btn-eur')?.classList.toggle('active', v === 'EUR');
        document.getElementById('btn-usd')?.classList.toggle('active', v === 'USD');
        renderTable(this._state(), this._handlers());
        renderKPI(this._state());
    }

    _handlers() {
        return {
            onHistory:     id => openHistoryModal(id, this.portfolio, () => this._save()),
            onTransaction: (id, type) => openTransactionModal(id, type, this.portfolio, this.prices,
                async () => { await this._save(); }),
            onSimulation:  id => openSimModal(id, this.portfolio, this.prices),
            onDelete:      id => this._elimina(id),
        };
    }

      async _aggiungiTitolo() {
        const nome   = document.getElementById('input-ticker-final').value.toUpperCase().trim();
        const valuta = document.getElementById('input-valuta').value || 'EUR';
        if (!nome) { Toast.show('Seleziona un titolo dalla lista', 'err'); return; }
        if (Object.values(this.portfolio).find(p => p.nome === nome)) {
            Toast.show(`${nome} già presente`, 'err'); return;
        }
          
       const id = 'T' + Date.now();
const logoUrl = document.getElementById('input-logo-url').value || null;
this.portfolio[id] = {
    nome, valuta,
    tipoAsset:   document.getElementById('input-tipo-asset').value,
    commDefault: parseFloat(document.getElementById('input-comm-default').value) || 7,
    logoUrl,
    transactions: []
};

        document.getElementById('input-titolo').value       = '';
        document.getElementById('input-ticker-final').value = '';
        document.getElementById('input-valuta').value       = '';
        document.getElementById('btn-add-titolo').disabled  = true;
        document.getElementById('ticker-selected').textContent = '— nessuno selezionato —';
        document.getElementById('ticker-selected').className   = 'ticker-selected-box';
        await this._save();
        this._refreshPrices(id);
        Toast.show(`${nome} aggiunto (${valuta})`, 'ok');
    }


    async _elimina(id) {
        const nome = this.portfolio[id]?.nome;
        if (!confirm(`Eliminare ${nome} e tutto il suo storico?`)) return;
        delete this.portfolio[id];
        delete this.prices[id];
        delete this.prevClose[id];
        await this._save();
        Toast.show(`${nome} rimosso`, 'ok');
    }
}






