import { DB } from '../../core/db.js';
import { Cache } from '../../core/cache.js';
import { Toast } from '../../core/toast.js';
import { Exchange } from '../../api/exchange.js';
import { Yahoo } from '../../api/yahoo.js';
import { renderPage, renderTable, renderKPI, renderSkeleton } from './render.js';
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

        document.getElementById('btn-add-titolo')?.addEventListener('click', () => this._aggiungiTitolo());
        document.getElementById('input-titolo')?.addEventListener('keydown', e => {
            if (e.key === 'Enter') this._aggiungiTitolo();
        });
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
        const nome = document.getElementById('input-titolo').value.toUpperCase().trim();
        if (!nome) { Toast.show('Inserisci un ticker', 'err'); return; }
        if (Object.values(this.portfolio).find(p => p.nome === nome)) {
            Toast.show(`${nome} già presente`, 'err'); return;
        }
        const id = 'T' + Date.now();
        this.portfolio[id] = {
            nome, valuta: document.getElementById('input-valuta').value,
            tipoAsset:    document.getElementById('input-tipo-asset').value,
            commDefault:  parseFloat(document.getElementById('input-comm-default').value) || 7,
            transactions: []
        };
        document.getElementById('input-titolo').value = '';
        await this._save();
        this._refreshPrices(id);
        Toast.show(`${nome} aggiunto`, 'ok');
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
