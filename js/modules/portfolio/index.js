import { DB } from '../../core/db.js';
import { Cache } from '../../core/cache.js';
import { Toast } from '../../core/toast.js';
import { Exchange } from '../../api/exchange.js';
import { Yahoo } from '../../api/yahoo.js';
import { Search } from '../../api/search.js';
import { Calc } from './calc.js';
import {
    renderPage, renderTable, renderKPI, renderSkeleton,
    renderMobileCards, buildPositionMap
} from './render.js';
import { openTransactionModal, openHistoryModal, openSimModal, CartPanel } from './ui.js';
import { initCassettoFiscale, aggiornaBadgeFiscale } from '../../api/fiscale.js';

const DEFAULT_PORTFOLIO_NAME = 'Portafoglio principale';
const DEFAULT_TAX_REGIME = 'amministrato';

function makePortfolioId() {
    return 'P' + Date.now();
}

function normalizeState(raw) {
    if (!raw || typeof raw !== 'object') {
        const id = makePortfolioId();
        return {
            activePortfolioId: id,
            portfolios: {
                [id]: {
                    id,
                    name: DEFAULT_PORTFOLIO_NAME,
                    taxRegime: DEFAULT_TAX_REGIME,
                    assets: {},
                    fiscal: { manualLosses: [] }
                }
            }
        };
    }

    if (raw.portfolios && raw.activePortfolioId) {
        return raw;
    }

    const id = makePortfolioId();
    const legacyAssets = raw || {};
    return {
        activePortfolioId: id,
        portfolios: {
            [id]: {
                id,
                name: DEFAULT_PORTFOLIO_NAME,
                taxRegime: DEFAULT_TAX_REGIME,
                assets: legacyAssets,
                fiscal: { manualLosses: [] }
            }
        }
    };
}

export class PortfolioPage {
    constructor(container) {
        this.container = container;
        this.portfolioState = null;
        this.activePortfolioId = null;
        this.portfolio = {};
        this.prices = {};
        this.prevClose = {};
        this.currency = 'EUR';
        this._autoTimer = null;
        this._portfolioSwitcherBound = false;
    }

    _getActivePortfolio() {
        return this.portfolioState?.portfolios?.[this.activePortfolioId] || null;
    }

    _syncActivePortfolio() {
        const active = this._getActivePortfolio();
        this.portfolio = active?.assets || {};
    }

    async mount() {
        renderPage(this.container);
        this._bindStaticEvents();
        renderSkeleton();

        const cached = Cache.getPrices();
        if (cached) {
            this.prices = cached.prices;
            this.prevClose = cached.prevs;
        }

        await Promise.all([Exchange.update(), this._loadData()]);
        this._updateExchangeLabel();
        this._ensurePortfolioSwitcher();

        await Exchange.prefetchRatesForPortfolio(this.portfolio);
        this._syncActivePortfolio();

        await this._render();

        CartPanel.init();

        initCassettoFiscale(() => this.portfolio);
        aggiornaBadgeFiscale(this.portfolio);

        this._refreshPrices();
        this._autoTimer = setInterval(() => this._backgroundRefresh(), 5 * 60 * 1000);
    }

    destroy() {
        clearInterval(this._autoTimer);
    }

    async _render() {
        this._syncActivePortfolio();

        const { portfolio, prices, prevClose, currency } = this;
        const positionMap = await buildPositionMap(portfolio, prices);
        const state = { portfolio, positionMap, prices, prevClose, currency };

        renderTable._refresh = () => renderTable(state, this._handlers());
        renderKPI(state);
        renderTable(state, this._handlers());
        renderMobileCards(state, this._handlers());

        aggiornaBadgeFiscale(this.portfolio);
    }

    async _loadData() {
        const raw = await DB.load('portfolio_state');
        this.portfolioState = normalizeState(raw);
        this.activePortfolioId = this.portfolioState.activePortfolioId;

        if (!raw || !raw.portfolios) {
            const legacyRaw = await DB.load('portafoglio');
            if (legacyRaw && Object.keys(legacyRaw).length) {
                const id = this.activePortfolioId;
                this.portfolioState = {
                    activePortfolioId: id,
                    portfolios: {
                        [id]: {
                            id,
                            name: DEFAULT_PORTFOLIO_NAME,
                            taxRegime: DEFAULT_TAX_REGIME,
                            assets: legacyRaw,
                            fiscal: { manualLosses: [] }
                        }
                    }
                };
                await DB.save('portfolio_state', this.portfolioState);
                Toast.show('📦 Dati migrati al nuovo formato multi-portafoglio', 'info');
            }
        }

        this._syncActivePortfolio();
        this._ensurePortfolioSwitcher();
    }

    async _save() {
        this._syncActivePortfolio();
        await DB.save('portfolio_state', this.portfolioState);
        Calc.clearCaches();
        await this._render();
    }

    async _refreshPrices(soloId = null) {
        const btn = document.getElementById('btn-refresh');
        if (btn) {
            btn.disabled = true;
            btn.innerHTML = '<span class=\"spinner\"></span>Aggiornamento...';
        }

        const tickerMap = soloId
            ? { [soloId]: this.portfolio[soloId].nome }
            : Object.fromEntries(
                Object.keys(this.portfolio).map(id => [id, this.portfolio[id].nome])
            );

        const { prices, prevs } = await Yahoo.fetchAll(tickerMap);
        Object.assign(this.prices, prices);
        Object.assign(this.prevClose, prevs);
        Cache.savePrices(this.prices, this.prevClose);

        if (btn) {
            btn.disabled = false;
            btn.innerHTML = '🔄 Aggiorna';
        }
        this._updateTimestamp();

        await this._render();
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
        el.textContent = `Agg. ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    }

        _getPortfolioLabel(pf) {
        if (!pf) return 'Portafoglio';
        const regime = pf.taxRegime === 'dichiarativo' ? 'Dich.' : 'Amm.';
        return `${pf.name} · ${regime}`;
    }

    _ensurePortfolioSwitcher() {
        const bar = document.querySelector('.controls-right');
        if (!bar) return;

        let wrap = document.getElementById('portfolio-switcher');
        if (!wrap) {
            wrap = document.createElement('div');
            wrap.id = 'portfolio-switcher';
            wrap.className = 'portfolio-switcher';
            wrap.innerHTML = `
                <button id="portfolio-switcher-toggle" class="portfolio-switcher-toggle" type="button">
                    <span id="portfolio-switcher-label">Portafoglio</span>
                    <span class="portfolio-switcher-caret">▾</span>
                </button>
                <div id="portfolio-switcher-menu" class="portfolio-switcher-menu" style="display:none;">
                    <div id="portfolio-switcher-list" class="portfolio-switcher-list"></div>
                    <div class="portfolio-switcher-actions">
                        <button id="portfolio-new-btn" type="button">＋ Nuovo portafoglio</button>
                        <button id="portfolio-rename-btn" type="button">✎ Rinomina attivo</button>
                    </div>
                </div>
            `;
            bar.prepend(wrap);
        }

        this._renderPortfolioSwitcher();

        if (this._portfolioSwitcherBound) return;
        this._portfolioSwitcherBound = true;

        const toggle = document.getElementById('portfolio-switcher-toggle');
        const menu = document.getElementById('portfolio-switcher-menu');

        toggle?.addEventListener('click', (e) => {
            e.stopPropagation();
            const isOpen = menu.style.display !== 'none';
            menu.style.display = isOpen ? 'none' : 'block';
        });

        document.addEventListener('click', (e) => {
            if (!e.target.closest('#portfolio-switcher')) {
                const menu = document.getElementById('portfolio-switcher-menu');
                if (menu) menu.style.display = 'none';
            }
        });

        document.getElementById('portfolio-new-btn')?.addEventListener('click', async () => {
            const name = prompt('Nome del nuovo portafoglio?');
            if (!name || !name.trim()) return;

            const regime = prompt('Regime fiscale? Scrivi: amministrato oppure dichiarativo', 'amministrato');
            const normalizedRegime = (regime || '').trim().toLowerCase() === 'dichiarativo'
                ? 'dichiarativo'
                : 'amministrato';

            const id = makePortfolioId();
            this.portfolioState.portfolios[id] = {
                id,
                name: name.trim(),
                taxRegime: normalizedRegime,
                assets: {},
                fiscal: { manualLosses: [] }
            };
            this.portfolioState.activePortfolioId = id;
            this.activePortfolioId = id;
            this._syncActivePortfolio();

            await DB.save('portfolio_state', this.portfolioState);
            this._renderPortfolioSwitcher();
            await this._render();
            Toast.show(`Creato portafoglio "${name.trim()}"`, 'ok');
        });

        document.getElementById('portfolio-rename-btn')?.addEventListener('click', async () => {
            const active = this._getActivePortfolio();
            if (!active) return;

            const name = prompt('Nuovo nome del portafoglio attivo:', active.name || '');
            if (!name || !name.trim()) return;

            active.name = name.trim();
            await DB.save('portfolio_state', this.portfolioState);
            this._renderPortfolioSwitcher();
            Toast.show('Portafoglio rinominato', 'ok');
        });
    }

    _renderPortfolioSwitcher() {
        const active = this._getActivePortfolio();
        const label = document.getElementById('portfolio-switcher-label');
        const list = document.getElementById('portfolio-switcher-list');

        if (label) {
            label.textContent = this._getPortfolioLabel(active);
        }
        if (!list) return;

        const portfolios = Object.values(this.portfolioState?.portfolios || {});
        list.innerHTML = portfolios.map(pf => `
            <button
                type="button"
                class="portfolio-switcher-item ${pf.id === this.activePortfolioId ? 'active' : ''}"
                data-pid="${pf.id}">
                <span class="portfolio-switcher-item-name">${pf.name}</span>
                <span class="portfolio-switcher-item-meta">
                    ${pf.taxRegime === 'dichiarativo' ? 'Regime dichiarativo' : 'Regime amministrato'}
                </span>
            </button>
        `).join('');

        list.querySelectorAll('[data-pid]').forEach(btn => {
            btn.addEventListener('click', async () => {
                const pid = btn.dataset.pid;
                if (!pid || pid === this.activePortfolioId) {
                    const menu = document.getElementById('portfolio-switcher-menu');
                    if (menu) menu.style.display = 'none';
                    return;
                }

                this.activePortfolioId = pid;
                this.portfolioState.activePortfolioId = pid;
                this._syncActivePortfolio();

                await DB.save('portfolio_state', this.portfolioState);
                this._renderPortfolioSwitcher();

                const menu = document.getElementById('portfolio-switcher-menu');
                if (menu) menu.style.display = 'none';

                await Exchange.prefetchRatesForPortfolio(this.portfolio);
                await this._render();
                Toast.show(`Portafoglio attivo: ${this._getActivePortfolio()?.name || '—'}`, 'ok');
            });
        });
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

        let _suggestTimer = null;
        const inputTitolo = document.getElementById('input-titolo');
        const suggestBox = document.getElementById('ticker-suggestions');
        const selectedBox = document.getElementById('ticker-selected');
        const btnAdd = document.getElementById('btn-add-titolo');
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
            if (q.length < 1) {
                suggestBox.innerHTML = '';
                suggestBox.classList.remove('visible');
                return;
            }
            suggestBox.innerHTML = '<div class=\"suggest-loading\">Ricerca...</div>';
            suggestBox.classList.add('visible');
            _suggestTimer = setTimeout(async () => {
                const results = await Search.query(q);
                if (!results.length) {
                    suggestBox.innerHTML = '<div class=\"suggest-empty\">Nessun risultato</div>';
                    return;
                }
                suggestBox.innerHTML = results.map(r => `
                    <div class=\"suggest-item\"
                         data-ticker=\"${r.ticker}\"
                         data-currency=\"${r.currency}\"
                         data-name=\"${r.name}\"
                         data-tipo=\"${r.tipoAsset}\"
                         data-tipolabel=\"${r.tipoLabel}\"
                         data-logo=\"${r.logoUrl || ''}\">
                        ${r.logoUrl ? `<img src=\"${r.logoUrl}\" class=\"suggest-logo\" alt=\"\">` : ''}
                        <span class=\"suggest-ticker\">${r.ticker}</span>
                        <span class=\"suggest-name\">${r.name}</span>
                        <span class=\"suggest-meta\">${r.exchange} · ${r.currency} · ${r.tipoLabel}</span>
                    </div>`).join('');

                suggestBox.querySelectorAll('.suggest-item').forEach(el => {
                    el.addEventListener('click', () => {
                        const ticker = el.dataset.ticker;
                        const currency = el.dataset.currency;
                        const name = el.dataset.name;
                        const tipoAsset = el.dataset.tipo;
                        const tipoLabel = el.dataset.tipolabel;
                        const logo = el.dataset.logo || '';

                        hiddenTicker.value = ticker;
                        hiddenValuta.value = currency;
                        inputTitolo.value = ticker;
                        document.getElementById('input-logo-url').value = logo;
                        suggestBox.innerHTML = '';
                        suggestBox.classList.remove('visible');
                        btnAdd.disabled = false;

                        const hiddenTipo = document.getElementById('input-tipo-asset');
                        if (hiddenTipo) hiddenTipo.value = tipoAsset;

                        selectedBox.innerHTML =
                            `${logo ? `<img src=\"${logo}\" class=\"ticker-logo\" alt=\"\">` : ''}
                             <b>${ticker}</b> — ${name}
                             <span class=\"badge\">${currency}</span>
                             <span class=\"badge\">${tipoLabel}</span>`;
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

    async _setValuta(v) {
        this.currency = v;
        document.getElementById('btn-eur')?.classList.toggle('active', v === 'EUR');
        document.getElementById('btn-usd')?.classList.toggle('active', v === 'USD');
        await this._render();
    }

    _handlers() {
        return {
            onHistory: id => openHistoryModal(id, this.portfolio, () => this._save(), this.currency),
            onTransaction: (id, type) => openTransactionModal(id, type, this.portfolio, this.prices,
                async () => { await this._save(); }),
            onSimulation: id => openSimModal(id, this.portfolio, this.prices),
            onDelete: id => this._elimina(id),
        };
    }

    async _aggiungiTitolo() {
        const nome = document.getElementById('input-ticker-final').value.toUpperCase().trim();
        const valuta = document.getElementById('input-valuta').value || 'EUR';
        if (!nome) { Toast.show('Seleziona un titolo dalla lista', 'err'); return; }
        if (Object.values(this.portfolio).find(p => p.nome === nome)) {
            Toast.show(`${nome} già presente`, 'err'); return;
        }
        const id = 'T' + Date.now();
        const logoUrl = document.getElementById('input-logo-url').value || null;

        this.portfolio[id] = {
            nome, valuta,
            tipoAsset: document.getElementById('input-tipo-asset').value,
            commDefault: parseFloat(document.getElementById('input-comm-default').value) || 7,
            logoUrl,
            transactions: []
        };

        document.getElementById('input-titolo').value = '';
        document.getElementById('input-ticker-final').value = '';
        document.getElementById('input-valuta').value = '';
        document.getElementById('input-logo-url').value = '';
        document.getElementById('btn-add-titolo').disabled = true;
        document.getElementById('ticker-selected').textContent = '— nessuno selezionato —';
        document.getElementById('ticker-selected').className = 'ticker-selected-box';

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