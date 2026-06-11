import { DB } from '../../core/db.js';
import { Cache } from '../../core/cache.js';
import { Toast } from '../../core/toast.js';
import { Exchange } from '../../api/exchange.js';
import { Yahoo } from '../../api/yahoo.js';
import { Search } from '../../api/search.js';
import { Calc } from './calc.js';
import {
    renderPage, renderTable, renderKPI, renderSkeleton,
    renderMobileCards, buildPositionMap, resetRenderState
} from './render.js';
import { openTransactionModal, openHistoryModal, openSimModal, CartPanel, openTransferModal } from './ui.js';
import { initCassettoFiscale, aggiornaBadgeFiscale } from '../../api/fiscale.js';

import { generaPacTransazioni } from './ui/pac.js';

import { Dividendi } from '../../api/dividendi.js';
import { openDividendiModal } from './ui/dividendi.js';

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
        this.preMarkets = {};
        this.postMarkets = {};
        this.week52Lows = {};
        this.week52Highs = {};
        this.dividendi = {};
        this.currency = 'EUR';
        this._autoTimer = null;
        this._portfolioSwitcherBound = false;
        this._docClickSwitcher = null;
        this._docClickSuggest = null;
    }

    _getActivePortfolio() {
        return this.portfolioState?.portfolios?.[this.activePortfolioId] || null;
    }

    _syncActivePortfolio() {
        const active = this._getActivePortfolio();
        this.portfolio = active?.assets || {};
    }

    async mount() {
        resetRenderState();
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
        this._ensurePortfolioModal();

        await Exchange.prefetchRatesForPortfolio(this.portfolio);
        this._syncActivePortfolio();

        CartPanel.init();

        await this._aggiornaAllPac();

initCassettoFiscale(() => this._getActivePortfolio(), () => this._save());

aggiornaBadgeFiscale(this.portfolio);

        await this._refreshPrices();
await this._aggiornaDividendi();
        this._autoTimer = setInterval(() => this._backgroundRefresh(), 5 * 60 * 1000);
        
    }

    async _aggiornaAllPac() {
        let changed = false;
        for (const id in this.portfolio) {
            const p = this.portfolio[id];
            if (!p.pac) continue;
            const before = (p.transactions || []).length;
            await generaPacTransazioni(id, this.portfolio);
            if ((p.transactions || []).length !== before) changed = true;
        }
        if (changed) {
            await DB.save('portfolio_state', this.portfolioState);
            Calc.clearCaches();
        }
    }


    async _aggiornaDividendi(force = false) {
  const portfolioId = this.activePortfolioId || 'default';

  if (!force) {
    const cached = Dividendi.carica(portfolioId);
    if (cached) {
      this.dividendi = cached;
      await this._render();
      return;
    }
  }

  this.dividendi = await Dividendi.aggiornaPortfolio(this.portfolio);
  Dividendi.salva(this.dividendi, portfolioId);
  await this._render();
}

   destroy() {
        clearInterval(this._autoTimer);
        this._portfolioSwitcherBound = false;
        if (this._docClickSwitcher) document.removeEventListener('click', this._docClickSwitcher);
        if (this._docClickSuggest) document.removeEventListener('click', this._docClickSuggest);
        this._docClickSwitcher = null;
        this._docClickSuggest = null;
    }

    async _render() {
        this._syncActivePortfolio();

        const { portfolio, prices, prevClose, currency, preMarkets, postMarkets, week52Lows, week52Highs } = this;
        const positionMap = await buildPositionMap(portfolio, prices);
        const fiscalState = this._getActivePortfolio()?.fiscal || null;
        const handlers = this._handlers();

const state = {
  portfolio,
  positionMap,
  prices,
  prevClose,
  currency,
  fiscalState,
  preMarkets,
  postMarkets,
  week52Lows,
  week52Highs,
  dividendi: this.dividendi,
  handlers
};

renderTable._refresh = () => renderTable(state, handlers);
renderKPI(state);
renderTable(state, handlers);
renderMobileCards(state, handlers);

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
        Dividendi.clear(this.activePortfolioId);
await this._aggiornaDividendi(true);
    }

    async _refreshPrices(soloId = null) {
  const btn = document.getElementById('btn-refresh');
  if (btn) {
    btn.disabled = true;
    btn.innerHTML = 'Aggiornamento...';
  }

  this._syncActivePortfolio();

  let tickerMap = {};

  if (soloId) {
    const asset = this.portfolio?.[soloId];

    if (!asset?.nome) {
      console.warn('Refresh saltato: asset non trovato nel portafoglio attivo', {
        soloId,
        activePortfolioId: this.activePortfolioId,
        portfolio: this.portfolio
      });

      if (btn) {
        btn.disabled = false;
        btn.innerHTML = '🔄 Aggiorna';
      }

      await this._render();
      return;
    }

    tickerMap = { [soloId]: asset.nome };
  } else {
    tickerMap = Object.fromEntries(
      Object.entries(this.portfolio)
        .filter(([, asset]) => asset?.nome)
        .map(([id, asset]) => [id, asset.nome])
    );
  }

  if (!Object.keys(tickerMap).length) {
    if (btn) {
      btn.disabled = false;
      btn.innerHTML = '🔄 Aggiorna';
    }
    await this._render();
    return;
  }

  const { prices, prevs, preMarkets, postMarkets, week52Lows, week52Highs } = await Yahoo.fetchAll(tickerMap);
  Object.assign(this.prices, prices);
  Object.assign(this.prevClose, prevs);
  Object.assign(this.preMarkets, preMarkets || {});
  Object.assign(this.postMarkets, postMarkets || {});
  Object.assign(this.week52Lows, week52Lows || {});
  Object.assign(this.week52Highs, week52Highs || {});
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
                        <button id="portfolio-delete-btn" type="button">🗑 Elimina portafoglio</button>
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

        this._docClickSwitcher = (e) => {
            if (!e.target.closest('#portfolio-switcher')) {
                const menu = document.getElementById('portfolio-switcher-menu');
                if (menu) menu.style.display = 'none';
            }
        };
        document.addEventListener('click', this._docClickSwitcher);

                document.getElementById('portfolio-new-btn')?.addEventListener('click', () => {
            this._openCreatePortfolioModal();
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

                document.getElementById('portfolio-delete-btn')?.addEventListener('click', async () => {
            const portfolios = Object.values(this.portfolioState?.portfolios || {});
            if (portfolios.length <= 1) {
                Toast.show('Devi mantenere almeno un portafoglio', 'err');
                return;
            }

            const active = this._getActivePortfolio();
            if (!active) return;

            const positions = Object.values(active.assets || {});
            const names = positions.map(p => p.nome).filter(Boolean);
            const listHtml = names.length
                ? names.map(n => `• ${n}`).join('\n')
                : '• Nessuna posizione';

            const msg =
                `Stai per eliminare il portafoglio "${active.name}".\n` +
                `Regime: ${active.taxRegime === 'dichiarativo' ? 'dichiarativo' : 'amministrato'}\n` +
                `Posizioni presenti: ${positions.length}\n\n` +
                `Titoli coinvolti:\n${listHtml}\n\n` +
                `Questa azione eliminerà anche storico transazioni, dati fiscali e contenuto del portafoglio.`;

            const ok = confirm(msg);
            if (!ok) return;

            const ids = Object.keys(this.portfolioState.portfolios);
            const idx = ids.indexOf(this.activePortfolioId);
            delete this.portfolioState.portfolios[this.activePortfolioId];

            const remaining = Object.keys(this.portfolioState.portfolios);
            this.activePortfolioId = remaining[0];
            this.portfolioState.activePortfolioId = this.activePortfolioId;
            this._syncActivePortfolio();

            await DB.save('portfolio_state', this.portfolioState);
            this._renderPortfolioSwitcher();
            await Exchange.prefetchRatesForPortfolio(this.portfolio);
await this._aggiornaDividendi();

            Toast.show('Portafoglio eliminato', 'ok');
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
await this._aggiornaDividendi();
Toast.show(`Portafoglio attivo: ${this._getActivePortfolio()?.name || '—'}`, 'ok');
            });
        });
    }

        _ensurePortfolioModal() {
        let modal = document.getElementById('portfolio-create-modal');
        if (modal) return;

        modal = document.createElement('div');
        modal.id = 'portfolio-create-modal';
        modal.className = 'portfolio-create-modal';
        modal.style.display = 'none';

        modal.innerHTML = `
            <div class="portfolio-create-backdrop" data-close="1"></div>
            <div class="portfolio-create-dialog">
                <div class="portfolio-create-header">
                    <h3>Nuovo portafoglio</h3>
                    <button type="button" class="portfolio-create-close" id="portfolio-create-close">✕</button>
                </div>

                <div class="portfolio-create-body">
                    <label class="portfolio-create-label" for="portfolio-create-name">
                        Nome portafoglio
                    </label>
                    <input
                        id="portfolio-create-name"
                        class="portfolio-create-input"
                        type="text"
                        placeholder="Es. Degiro lungo termine"
                        maxlength="60"
                    />

                    <div class="portfolio-create-label" style="margin-top: 14px;">
                        Regime fiscale
                    </div>

                    <div class="portfolio-regime-toggle" id="portfolio-regime-toggle">
                        <button
                            type="button"
                            class="portfolio-regime-btn active"
                            data-regime="amministrato">
                            Amministrato
                        </button>
                        <button
                            type="button"
                            class="portfolio-regime-btn"
                            data-regime="dichiarativo">
                            Dichiarativo
                        </button>
                    </div>

                    <div class="portfolio-create-help">
                        Scegli il regime del nuovo portafoglio prima di crearlo.
                    </div>
                </div>

                <div class="portfolio-create-footer">
                    <button type="button" class="portfolio-create-cancel" id="portfolio-create-cancel">
                        Annulla
                    </button>
                    <button type="button" class="portfolio-create-submit" id="portfolio-create-submit">
                        Crea portafoglio
                    </button>
                </div>
            </div>
        `;

        document.body.appendChild(modal);

        modal.querySelectorAll('[data-close], #portfolio-create-close, #portfolio-create-cancel')
            .forEach(el => {
                el.addEventListener('click', () => this._closeCreatePortfolioModal());
            });

        modal.querySelectorAll('.portfolio-regime-btn').forEach(btn => {
            btn.addEventListener('click', () => {
                modal.querySelectorAll('.portfolio-regime-btn')
                    .forEach(x => x.classList.remove('active'));
                btn.classList.add('active');
            });
        });

        document.getElementById('portfolio-create-submit')?.addEventListener('click', async () => {
            const nameInput = document.getElementById('portfolio-create-name');
            const activeBtn = modal.querySelector('.portfolio-regime-btn.active');

            const name = (nameInput?.value || '').trim();
            const regime = activeBtn?.dataset?.regime || 'amministrato';

            if (!name) {
                Toast.show('Inserisci un nome per il nuovo portafoglio', 'err');
                nameInput?.focus();
                return;
            }

            const id = makePortfolioId();
            this.portfolioState.portfolios[id] = {
                id,
                name,
                taxRegime: regime,
                assets: {},
                fiscal: { manualLosses: [] }
            };

              this.portfolioState.activePortfolioId = id;
  this.activePortfolioId = id;
  this._syncActivePortfolio();
  this.dividendi = {};
  await DB.save('portfolio_state', this.portfolioState);
  this._renderPortfolioSwitcher();
  this._closeCreatePortfolioModal();
  await this._render();
  Toast.show(`Creato portafoglio "${name}"`, 'ok');
        });
    }

    _openCreatePortfolioModal() {
        const modal = document.getElementById('portfolio-create-modal');
        if (!modal) return;

        modal.style.display = 'flex';

        const input = document.getElementById('portfolio-create-name');
        if (input) input.value = '';

        modal.querySelectorAll('.portfolio-regime-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.regime === 'amministrato');
        });

        setTimeout(() => input?.focus(), 0);
    }

    _closeCreatePortfolioModal() {
        const modal = document.getElementById('portfolio-create-modal');
        if (!modal) return;
        modal.style.display = 'none';
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

        this._docClickSuggest = e => {
            if (!e.target.closest('#input-titolo') && !e.target.closest('#ticker-suggestions')) {
                suggestBox.classList.remove('visible');
            }
        };
        document.addEventListener('click', this._docClickSuggest);

        document.getElementById('btn-add-titolo')?.addEventListener('click', () => {
    const ticker = hiddenTicker.value?.trim();
    const valuta = hiddenValuta.value?.trim() || 'EUR';
    const nome = inputTitolo.value?.trim();
    const tipoAsset = document.getElementById('input-tipo-asset')?.value?.trim() || 'stock';

    if (!ticker) {
        Toast.show('Seleziona prima un titolo dai suggerimenti', 'err');
        return;
    }

    this._aggiungiTitolo({
        id: ticker,
        ticker,
        nome: nome || ticker,
        valuta,
        tipoAsset
    });
});
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
                async () => { await this._save(); }, this._getActivePortfolio()),
            onSimulation: id => openSimModal(id, this.portfolio, this.prices),
            onDelete: id => this.elimina(id),
            onDividendi: id => openDividendiModal(id, this.portfolio, this.dividendi),
            onDividendiDashboard: () => openDividendiModal('__ALL__', this.portfolio, this.dividendi),
            onTransfer: id => openTransferModal(
                id,
                this.portfolio,
                this.portfolioState.portfolios,
                this.activePortfolioId,
                (params) => this._eseguiTrasferimento(params)
            ),
        };
    }
        async _eseguiTrasferimento({ sourceAssetId, destPortfolioId, qty }) {
        const { Toast } = await import('../../core/toast.js');
        const sourceAsset = this.portfolio[sourceAssetId];
        const destPortfolio = this.portfolioState.portfolios[destPortfolioId];
        if (!sourceAsset || !destPortfolio) {
            Toast.show('Portafoglio o asset non trovato', 'err');
            throw new Error('not found');
        }

        // PMC sorgente al momento del trasferimento
        const { pmc } = Calc.positionSync(sourceAsset);
        const today = new Date().toISOString().slice(0, 10);
        const transferId = 'T' + Date.now();

        // ── 1. Aggiorna sorgente ───────────────────────────────────
        sourceAsset.transferred = true;
        sourceAsset.transferredAt = today;
        sourceAsset.transferredTo = destPortfolioId;
        sourceAsset.transferredQuantity = (sourceAsset.transferredQuantity || 0) + qty;

        // ── 2. Scrivi transazione sintetica nel destinazione ───────
        if (!destPortfolio.assets) destPortfolio.assets = {};

        const destAssetId = sourceAssetId; // stesso id (ticker sanitizzato)
        if (!destPortfolio.assets[destAssetId]) {
            // Copia la struttura base dell'asset senza le transazioni originali
            destPortfolio.assets[destAssetId] = {
                nome:      sourceAsset.nome,
                ticker:    sourceAsset.ticker || sourceAsset.nome,
                valuta:    sourceAsset.valuta || 'EUR',
                tipoAsset: sourceAsset.tipoAsset || 'stock',
                isin:      sourceAsset.isin || '',
                transactions: [],
                commDefault: sourceAsset.commDefault || 7,
            };
        }

        const syntheticTx = {
            date:         today,
            type:         'buy',
            qty:          qty,
            price:        pmc,
            commission:   0,
            transferred:  true,
            sourcePortfolioId: this.activePortfolioId,
            transferId,
        };

        // Inserisci in ordine cronologico
        const txs = destPortfolio.assets[destAssetId].transactions;
        txs.push(syntheticTx);
        txs.sort((a, b) => a.date.localeCompare(b.date));

        // ── 3. Log trasferimento sul sorgente ─────────────────────
        const activePortfolio = this._getActivePortfolio();
        if (!activePortfolio.transfers) activePortfolio.transfers = {};
        activePortfolio.transfers[transferId] = {
            date:            today,
            toPortfolioId:   destPortfolioId,
            createdAt:       Date.now(),
            tickers: {
                [sourceAssetId]: {
                    quantity:       qty,
                    pmcAtTransfer:  pmc,
                    currency:       sourceAsset.valuta || 'EUR',
                }
            }
        };

        // ── 4. Salva e aggiorna UI ─────────────────────────────────
        await this._save();
        Toast.show(`🔀 ${sourceAsset.nome}: ${Calc.fmt(qty, 4)} unità trasferite`, 'ok');
    }

    async _aggiungiTitolo(item) {
    const active = this._getActivePortfolio();
    if (!active) {
        Toast.show('Portafoglio attivo non trovato', 'err');
        return;
    }

    if (!item) {
        Toast.show('Titolo non valido', 'err');
        return;
    }

    if (!active.assets) active.assets = {};

    const rawId = item.id || item.isin || item.ticker || item.symbol || item.nome || item.name;
    const id = rawId.replace(/[.$#[\]/]/g, '_');
    if (!id) {
        Toast.show('Titolo non valido', 'err');
        return;
    }

    if (active.assets[id]) {
        Toast.show('Titolo già presente in questo portafoglio', 'info');
        return;
    }

    active.assets[id] = {
        nome: item.nome || item.name || item.symbol || item.ticker || id,
        isin: item.isin || '',
        ticker: item.ticker || item.symbol || '',
        valuta: item.valuta || item.currency || 'EUR',
        tipoAsset: item.tipoAsset || item.assetClass || 'stock',
        transactions: [],
        commDefault: 7
    };

    this._syncActivePortfolio();
    await DB.save('portfolio_state', this.portfolioState);
    Toast.show(`Titolo aggiunto: ${active.assets[id].nome}`, 'ok');
    await this._refreshPrices(id);
    // Aggiorna dividendi solo per il nuovo ticker, senza invalidare tutta la cache
    const divsTicker = await Dividendi.fetchDividendi(item.ticker || item.nome);
    const nuovi = await Dividendi.calcolaDividendiRicevuti(this.portfolio[id], divsTicker);
    if (nuovi.length > 0) this.dividendi[id] = nuovi;
    Dividendi.salva(this.dividendi, this.activePortfolioId);
    await this._render();
}

    async elimina(id) {
  const nome = this.portfolio[id]?.nome;
  if (!confirm(`Eliminare ${nome} e tutto il suo storico?`)) return;
  delete this.portfolio[id];
  delete this.prices[id];
  delete this.prevClose[id];
  Dividendi.clear(this.activePortfolioId);
  await this._save();
  Toast.show(`${nome} rimosso`, 'ok');
}
}