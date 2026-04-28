import { Calc } from './calc.js';
import { openTransactionModal } from './ui/transactions.js';
import { openHistoryModal } from './ui/history.js';

export function renderPage(portfolio, prices, currency = 'EUR', fiscalState = null) {
    const root = document.getElementById('app');
    if (!root) return;

    const taxMetrics = Calc.buildDashboardTaxMetrics(portfolio, fiscalState);

    root.innerHTML = `
        <main class="app-shell">
            <section class="kpi-grid">
                <article class="kpi-card"><span class="kpi-label">P&L Realizzato Lordo</span><span class="kpi-value ${taxMetrics.realizedLordoEur >= 0 ? 'pos-gain' : 'neg-loss'}">€ ${Calc.fmt(taxMetrics.realizedLordoEur)}</span></article>
                <article class="kpi-card"><span class="kpi-label">Netto Teorico</span><span class="kpi-value ${taxMetrics.realizedNettoTeoricoEur >= 0 ? 'pos-gain' : 'neg-loss'}">€ ${Calc.fmt(taxMetrics.realizedNettoTeoricoEur)}</span></article>
                <article class="kpi-card"><span class="kpi-label">Netto Effettivo</span><span class="kpi-value ${taxMetrics.realizedNettoEffettivoEur >= 0 ? 'pos-gain' : 'neg-loss'}">€ ${Calc.fmt(taxMetrics.realizedNettoEffettivoEur)}</span></article>
            </section>
            <section class="portfolio-section">
                <div class="section-head"><h2>Portafoglio</h2></div>
                <div class="portfolio-list">
                    ${Object.entries(portfolio || {}).map(([id, p]) => {
                        const live = prices?.[id];
                        const priceLabel = live?.price ?? p.lastPrice ?? 0;
                        return `
                            <article class="portfolio-row">
                                <div class="portfolio-title">
                                    <strong>${p.nome || id}</strong>
                                    <span class="text-muted">${p.valuta || 'EUR'}</span>
                                </div>
                                <div class="portfolio-metrics">
                                    <span>Prezzo: ${priceLabel}</span>
                                    <span>Q.tà: ${Calc.fmt((p.transactions || []).length ? Calc.positionSync(p).qta : 0, 4)}</span>
                                </div>
                                <div class="portfolio-actions">
                                    <button class="btn btn-primary btn-sm" data-open-tx="${id}">Operazione</button>
                                    <button class="btn btn-ghost btn-sm" data-open-history="${id}">Storico</button>
                                </div>
                            </article>`;
                    }).join('')}
                </div>
            </section>
        </main>`;

    root.querySelectorAll('[data-open-tx]').forEach(btn => {
        btn.addEventListener('click', () => openTransactionModal(btn.dataset.openTx, 'buy', portfolio, prices, async () => {}, fiscalState));
    });
    root.querySelectorAll('[data-open-history]').forEach(btn => {
        btn.addEventListener('click', () => openHistoryModal(btn.dataset.openHistory, portfolio, async () => {}, currency, fiscalState));
    });
}
