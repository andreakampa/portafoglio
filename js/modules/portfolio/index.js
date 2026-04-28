import { Calc } from './calc.js';
import { buildFiscalState } from './fiscale.js';
import { renderPage } from './render.js';
import { openTransactionModal } from './ui/transactions.js';
import { openHistoryModal } from './ui/history.js';

// PATCH da integrare nel tuo index esistente
// 1) quando apri storico/transazione passa fiscalState attivo
_handlers() {
  return {
    onHistory: (id) => openHistoryModal(id, this.portfolio, this._save.bind(this), this.currency, this.fiscalState),
    onTransaction: (id, type) => openTransactionModal(id, type, this.portfolio, this.prices, async () => { await this._save(); }, this.fiscalState),
    onSimulation: (id) => openSimModal(id, this.portfolio, this.prices, async () => { await this._save(); }),
    onDelete: (id) => this.elimina(id)
  };
}

// 2) dentro _render aggiorna fiscalState prima dei render
this.fiscalState = this._getActivePortfolio()?.fiscal || this.fiscalState || null;

// 3) passa fiscalState anche a renderKPI/renderTable/renderMobileCards se li hai estesi


export class PortfolioApp {
    constructor() {
        this.portfolio = {};
        this.prices = {};
        this.currency = 'EUR';
        this.fiscalState = null;
    }

    async init() {
        await this.loadData();
        this.refreshFiscalState();
        this.render();
    }

    async loadData() {
        return true;
    }

    refreshFiscalState() {
        this.fiscalState = buildFiscalState(this.portfolio);
    }

    render() {
        renderPage(this.portfolio, this.prices, this.currency, this.fiscalState);
    }

    openTx(id, type) {
        openTransactionModal(id, type, this.portfolio, this.prices, this.save.bind(this), this.fiscalState);
    }

    openHistory(id) {
        openHistoryModal(id, this.portfolio, this.save.bind(this), this.currency, this.fiscalState);
    }

    async save() {
        this.refreshFiscalState();
        this.render();
    }
}

export const app = new PortfolioApp();
