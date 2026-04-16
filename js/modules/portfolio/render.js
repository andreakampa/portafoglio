import { Calc } from './calc.js';
import { Exchange } from '../../api/exchange.js';
import { Search } from '../../api/search.js';

window._logoFallback = function(el, base) {
    const colors = ['#2a7f5e','#1a6fa0','#7b4fa0','#a05c1a','#9a3d3d','#3d6b7a'];
    const idx = (base || '').split('').reduce((a, c) => a + c.charCodeAt(0), 0) % colors.length;
    const bg = colors[idx];
    const txt = (base || '?').slice(0, 2).toUpperCase();
    const svg = encodeURIComponent(`
        <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64">
            <rect width="64" height="64" rx="14" fill="${bg}"/>
            <text x="50%" y="53%" dominant-baseline="middle" text-anchor="middle"
                  font-family="Arial" font-size="22" font-weight="700" fill="white">${txt}</text>
        </svg>`);
    el.onerror = null;
    el.src = `data:image/svg+xml;charset=UTF-8,${svg}`;
};

function logoImg(p, cssClass = 'asset-logo') {
    const baseName = (p.nome || '?');
    const ticker = String(p.ticker || p.symbol || p.simbolo || '').trim().toUpperCase();
    const src = p.logoUrl
        ? p.logoUrl
        : (ticker
            ? `https://img.logo.dev/ticker/${encodeURIComponent(ticker)}?token=pk_free`
            : 'data:image/gif;base64,R0lGODlhAQABAAAAACw=');

    return `<img
        src="${src}"
        class="${cssClass}"
        alt=""
        loading="lazy"
        style="width:40px;height:40px;min-width:40px;max-width:40px;object-fit:contain;display:block;border-radius:12px;"
        onerror="_logoFallback(this, ${JSON.stringify(baseName)})"
    >`;
}

export function renderPage(container) {
    container.innerHTML = `
        <div class="portfolio-shell">
            <div class="controls-bar">
                <div class="controls-left">
                    <button id="btn-refresh" class="btn btn-primary">🔄 Aggiorna</button>
                    <div class="currency-switch">
                        <button id="btn-eur" class="btn btn-toggle active">EUR</button>
                        <button id="btn-usd" class="btn btn-toggle">USD</button>
                    </div>
                </div>
                <div class="controls-right">
                    <div id="exchange-info" class="fx-info">Cambio Real-Time: <span>1 EUR = ${Exchange.rate.toFixed(4)} USD</span></div>
                    <div id="last-update" class="last-update">—</div>
                </div>
            </div>

            <div class="add-box">
                <div class="add-grid">
                    <div class="add-search-wrap">
                        <label class="field-label">Titolo</label>
                        <input type="text" id="input-titolo" placeholder="Cerca per nome, ticker o ISIN: Apple, RACE, IT0005534308..." autocomplete="off">
                        <div id="ticker-suggestions" class="ticker-suggestions"></div>
                    </div>

                    <div>
                        <label class="field-label">Commissione default</label>
                        <input type="number" id="input-comm-default" step="any" value="7">
                    </div>

                    <div class="add-btn-wrap">
                        <button id="btn-add-titolo" class="btn btn-success btn-full" disabled>➕ Aggiungi titolo</button>
                    </div>
                </div>

                <input type="hidden" id="input-ticker-final">
                <input type="hidden" id="input-valuta">
                <input type="hidden" id="input-tipo-asset">
                <input type="hidden" id="input-logo-url">

                <div id="ticker-selected" class="ticker-selected-box">— nessuno selezionato —</div>
            </div>

            <div id="portfolio-kpi" class="kpi-grid"></div>

                                   <div class="desktop-only">
                <div class="table-panel">
                    <div class="table-wrapper">
                        <table class="portfolio-table">
                            <thead>
                                <tr>
                                    <th>Titolo</th>
                                    <th>Prezzo</th>
                                    <th>Q.tà</th>
                                    <th>PMC</th>
                                    <th>PMC EUR 🏦</th>
                                    <th>P&L %</th>
                                    <th>P&L</th>
                                    <th>Azioni</th>
                                </tr>
                            </thead>
                            <tbody id="portfolio-body"></tbody>
                        </table>
                    </div>
                </div>
            </div>

            <div class="mobile-only">
                <div id="portfolio-mobile" class="mobile-cards"></div>
            </div>
}

export function renderSkeleton() {
    const kpi = document.getElementById('portfolio-kpi');
    const tbody = document.getElementById('portfolio-body');
    const mobile = document.getElementById('portfolio-mobile');
    if (kpi) {
        kpi.innerHTML = new Array(4).fill(0).map(() => `
            <div class="kpi-card skeleton-card">
                <div class="skeleton-line w40"></div>
                <div class="skeleton-line w70"></div>
            </div>`).join('');
    }
    if (tbody) {
        tbody.innerHTML = new Array(5).fill(0).map(() => `
            <tr>
                <td colspan="8"><div class="skeleton-line w100" style="height:28px;"></div></td>
            </tr>`).join('');
    }
    if (mobile) {
        mobile.innerHTML = new Array(3).fill(0).map(() => `
            <div class="mobile-card skeleton-card">
                <div class="skeleton-line w50"></div>
                <div class="skeleton-line w80"></div>
                <div class="skeleton-line w60"></div>
            </div>`).join('');
    }
}

export async function buildPositionMap(portfolio, prices) {
    const entries = await Promise.all(
        Object.entries(portfolio).map(async ([id, p]) => {
            const pos = await Calc.position(p);
            return [id, {
                ...pos,
                currentPrice: +(prices[id] || 0),
                marketValue: Calc.marketValue(pos, prices[id]),
                marketValueEur: Calc.marketValueEur(pos, prices[id], p.valuta || 'EUR'),
                unrealizedPnL: Calc.unrealizedPnL(pos, prices[id]),
                unrealizedPnLEur: Calc.unrealizedPnLEur(pos, prices[id], p.valuta || 'EUR'),
                pnlPct: Calc.pnlPercent(pos, prices[id]),
                pnlPctEur: Calc.pnlPercentWithFx(pos, prices[id], p.valuta || 'EUR')
            }];
        })
    );
    return Object.fromEntries(entries);
}

export function renderKPI({ portfolio, positionMap, currency }) {
    const kpi = document.getElementById('portfolio-kpi');
    if (!kpi) return;

    let totalValueEur = 0;
    let totalCostEur = 0;
    let totalRealized = 0;
    let totalRealizedNet = 0;

    Object.entries(portfolio).forEach(([id, p]) => {
        const pos = positionMap[id];
        if (!pos) return;

        totalValueEur += pos.marketValueEur || 0;
        totalCostEur += (pos.qta || 0) * (pos.pmcEur || 0);
        totalRealized += pos.realizedPnL || 0;
        totalRealizedNet += (pos.realizedPnL || 0) - Calc.taxOnGain(pos.realizedPnL || 0, p.tipoAsset);
    });

    const totalUnrealizedEur = totalValueEur - totalCostEur;
    const totalPct = totalCostEur > 0 ? (totalUnrealizedEur / totalCostEur) * 100 : 0;

    const displayValue = currency === 'USD' ? Exchange.convert(totalValueEur, 'EUR', 'USD') : totalValueEur;
    const displayUnr   = currency === 'USD' ? Exchange.convert(totalUnrealizedEur, 'EUR', 'USD') : totalUnrealizedEur;
    const sym = currency === 'USD' ? '$' : '€';

    kpi.innerHTML = `
        <div class="kpi-card">
            <span class="kpi-label">Valore portafoglio</span>
            <b class="kpi-value">${sym} ${Calc.fmt(displayValue)}</b>
        </div>
        <div class="kpi-card">
            <span class="kpi-label">P&L %</span>
            <b class="kpi-value ${totalPct >= 0 ? 'pos-gain' : 'neg-loss'}">${Calc.fmt(totalPct)}%</b>
        </div>
        <div class="kpi-card">
            <span class="kpi-label">P&L non realizzato</span>
            <b class="kpi-value ${displayUnr >= 0 ? 'pos-gain' : 'neg-loss'}">${sym} ${Calc.fmt(displayUnr)}</b>
        </div>
        <div class="kpi-card">
            <span class="kpi-label">P&L EUR storico 🏦</span>
            <b class="kpi-value ${totalRealizedNet >= 0 ? 'pos-gain' : 'neg-loss'}">€ ${Calc.fmt(totalRealizedNet)}</b>
        </div>`;
}

export function renderTable({ portfolio, positionMap, prices, currency }, handlers) {
    const tbody = document.getElementById('portfolio-body');
    if (!tbody) return;
    tbody.innerHTML = '';

    Object.entries(portfolio).forEach(([id, p]) => {
        const pos = positionMap[id];
        if (!pos) return;

        const priceNative = +(prices[id] || 0);
        const symNative = p.valuta === 'USD' ? '$' : '€';
        const row = document.createElement('tr');

        const shownPrice = currency === p.valuta
            ? priceNative
            : Exchange.convert(priceNative, p.valuta || 'EUR', currency);

        const shownPmc = currency === p.valuta
            ? pos.pmc
            : (currency === 'EUR' ? pos.pmcEur : Exchange.convert(pos.pmcEur, 'EUR', 'USD'));

        const shownPnl = currency === 'EUR'
            ? pos.unrealizedPnLEur
            : Exchange.convert(pos.unrealizedPnLEur, 'EUR', 'USD');

        const pnlPct = currency === 'EUR' ? pos.pnlPctEur : pos.pnlPct;
        const sym = currency === 'USD' ? '$' : '€';

        row.innerHTML = `
            <td>
                <div class="asset-cell">
                    ${logoImg(p, 'asset-logo')}
                    <div>
                        <div class="asset-name">${p.nome}</div>
                        <div class="asset-meta">${p.tipoAsset || 'stock'} · ${p.valuta || 'EUR'}</div>
                    </div>
                </div>
            </td>
            <td>${sym} ${Calc.fmt(shownPrice)}</td>
            <td>${Calc.fmt(pos.qta, 4)}</td>
            <td>${sym} ${Calc.fmt(shownPmc)}</td>
            <td>€ ${Calc.fmt(pos.pmcEur)}</td>
            <td class="${pnlPct >= 0 ? 'pos-gain' : 'neg-loss'}">${Calc.fmt(pnlPct)}%</td>
            <td class="${shownPnl >= 0 ? 'pos-gain' : 'neg-loss'}">${sym} ${Calc.fmt(shownPnl)}</td>
            <td>
                <div class="row-actions">
                    <button class="btn btn-dark btn-sm" data-action="history">Storico</button>
                    <button class="btn btn-success btn-sm" data-action="buy">Buy</button>
                    <button class="btn btn-purple btn-sm" data-action="sell">Sell</button>
                    <button class="btn btn-warning btn-sm" data-action="sim">Sim</button>
                    <button class="btn btn-danger btn-sm" data-action="delete">✕</button>
                </div>
            </td>`;

        row.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                if (action === 'history') handlers.onHistory(id);
                if (action === 'buy')     handlers.onTransaction(id, 'buy');
                if (action === 'sell')    handlers.onTransaction(id, 'sell');
                if (action === 'sim')     handlers.onSimulation(id);
                if (action === 'delete')  handlers.onDelete(id);
            });
        });

        tbody.appendChild(row);
    });
}

export function renderMobileCards({ portfolio, positionMap, prices, currency }, handlers) {
    const container = document.getElementById('portfolio-mobile');
    if (!container) return;
    container.innerHTML = '';

    Object.entries(portfolio).forEach(([id, p]) => {
        const pos = positionMap[id];
        if (!pos) return;

        const priceNative = +(prices[id] || 0);
        const shownPrice = currency === p.valuta
            ? priceNative
            : Exchange.convert(priceNative, p.valuta || 'EUR', currency);

        const shownPnl = currency === 'EUR'
            ? pos.unrealizedPnLEur
            : Exchange.convert(pos.unrealizedPnLEur, 'EUR', 'USD');

        const pnlPct = currency === 'EUR' ? pos.pnlPctEur : pos.pnlPct;
        const sym = currency === 'USD' ? '$' : '€';

        const card = document.createElement('div');
        card.className = 'mobile-card';

        card.innerHTML = `
            <div class="mobile-head">
                <div class="asset-cell">
                    ${logoImg(p, 'asset-logo')}
                    <div>
                        <div class="asset-name">${p.nome}</div>
                        <div class="asset-meta">${p.tipoAsset || 'stock'} · ${p.valuta || 'EUR'}</div>
                    </div>
                </div>
                <div class="mobile-price">${sym} ${Calc.fmt(shownPrice)}</div>
            </div>

            <div class="mobile-stats">
                <div><span>Q.tà</span><b>${Calc.fmt(pos.qta, 4)}</b></div>
                <div><span>PMC</span><b>${sym} ${Calc.fmt(currency === 'EUR' ? pos.pmcEur : pos.pmc)}</b></div>
                <div><span>PMC EUR 🏦</span><b>€ ${Calc.fmt(pos.pmcEur)}</b></div>
                <div><span>P&L</span><b class="${shownPnl >= 0 ? 'pos-gain' : 'neg-loss'}">${sym} ${Calc.fmt(shownPnl)}</b></div>
                <div><span>P&L %</span><b class="${pnlPct >= 0 ? 'pos-gain' : 'neg-loss'}">${Calc.fmt(pnlPct)}%</b></div>
            </div>

            <div class="mobile-actions">
                <button class="btn btn-dark btn-sm" data-action="history">Storico</button>
                <button class="btn btn-success btn-sm" data-action="buy">Buy</button>
                <button class="btn btn-purple btn-sm" data-action="sell">Sell</button>
                <button class="btn btn-warning btn-sm" data-action="sim">Sim</button>
                <button class="btn btn-danger btn-sm" data-action="delete">✕</button>
            </div>`;

        card.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', () => {
                const action = btn.dataset.action;
                if (action === 'history') handlers.onHistory(id);
                if (action === 'buy')     handlers.onTransaction(id, 'buy');
                if (action === 'sell')    handlers.onTransaction(id, 'sell');
                if (action === 'sim')     handlers.onSimulation(id);
                if (action === 'delete')  handlers.onDelete(id);
            });
        });

        container.appendChild(card);
    });
}
