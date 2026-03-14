import { Calc } from './calc.js';
import { Exchange } from '../../api/exchange.js';
import { Search } from '../../api/search.js';

function logoImg(nome, cssClass) {
    const base = (nome || '').split('.')[0].split('-')[0].toUpperCase();
    const primary   = `https://img.logo.dev/ticker/${base}?token=pk_free&size=32`;
    const secondary = `https://financialmodelingprep.com/image-stock/${base}.png`;
    return `<img 
        src="${primary}" 
        class="${cssClass}" 
        alt=""
        onerror="this.src='${secondary}'; this.onerror=function(){this.style.display='none';}"
    >`;
}

export function renderPage(container) {
    container.innerHTML = `
    <div class="controls-bar">
        <div class="exchange-info" id="exchange-info">Cambio: <span>—</span></div>
        <div class="controls-right">
            <span class="text-muted fs-sm">Mostra in:</span>
            <button id="btn-eur" class="btn-toggle active">€ EUR</button>
            <button id="btn-usd" class="btn-toggle">$ USD</button>
            <button id="btn-refresh" class="btn btn-success btn-sm">🔄 Aggiorna prezzi</button>
            <span class="text-muted fs-xs" id="last-update"></span>
        </div>
    </div>

    <div class="dashboard" id="dashboard"></div>

    <div class="card">
        <div class="card-title">➕ Aggiungi Titolo</div>
        <div class="form-row">
            <div class="form-field" style="flex:2; min-width:150px; position:relative;">
                <label>Cerca Titolo</label>
                <input type="text" id="input-titolo" placeholder="Cerca per nome, ticker, ISIN: Apple, RACE, BTC, IT0005534308..." autocomplete="off">
                <div id="ticker-suggestions" class="ticker-suggestions"></div>
            </div>
            <div class="form-field" style="min-width:220px;">
                <label>Titolo Selezionato</label>
                <div id="ticker-selected" class="ticker-selected-box">— nessuno selezionato —</div>
            </div>
            <div class="form-field" style="min-width:120px;">
                <label>Commissione Default (€)</label>
                <input type="number" id="input-comm-default" placeholder="7.00" step="0.01">
            </div>
            <button id="btn-add-titolo" class="btn btn-success" style="align-self:flex-end;" disabled>Aggiungi</button>
        </div>
        <input type="hidden" id="input-ticker-final">
        <input type="hidden" id="input-valuta">
        <input type="hidden" id="input-tipo-asset">
        <input type="hidden" id="input-logo-url">
    </div>

    <div class="card desktop-only">
        <div class="card-title">💼 Posizioni</div>
        <div class="table-wrapper">
            <table>
                <thead>
                    <tr>
                        <th>Titolo</th>
                        <th>Q.tà</th>
                        <th>PMC</th>
                        <th>Prezzo Live</th>
                        <th>Var. Oggi</th>
                        <th>Controvalore</th>
                        <th>P&L Posizione</th>
                        <th>P&L After Tax</th>
                        <th>P&L Realizzato</th>
                        <th>Azioni</th>
                    </tr>
                </thead>
                <tbody id="portfolio-tbody"></tbody>
            </table>
        </div>
    </div>

    <div class="mobile-only">
        <div class="card-title" style="padding: 0 4px 10px;">💼 Posizioni</div>
        <div id="mobile-cards"></div>
    </div>

    <div id="modal-history"     class="overlay"></div>
    <div id="modal-transazione" class="overlay"></div>
    <div id="modal-simulazione" class="overlay"></div>
    `;
}

export function renderSkeleton() {
    const tbody = document.getElementById('portfolio-tbody');
    if (!tbody) return;
    tbody.innerHTML = Array(3).fill(
        `<tr>${Array(10).fill('<td><div class="skeleton" style="height:14px;width:75%;"></div></td>').join('')}</tr>`
    ).join('');
}

export function renderTable({ portfolio, prices, prevClose, currency }, handlers) {
    const tbody = document.getElementById('portfolio-tbody');
    if (!tbody) return;
    const s = currency === 'EUR' ? '€' : '$';

    if (!Object.keys(portfolio).length) {
        tbody.innerHTML = `<tr><td colspan="10"><div class="empty-state"><div class="icon">📭</div>Nessun titolo — aggiungine uno sopra</div></td></tr>`;
        return;
    }
    tbody.innerHTML = '';

    for (const id in portfolio) {
        const p = portfolio[id];
        const v = p.valuta || 'EUR';
        const { qta, pmc, realizedPnL } = Calc.position(p);
        const prLive = prices[id] ?? pmc;
        const prPrev = prevClose[id] ?? null;

        const inv         = qta * pmc;
        const att         = qta * prLive;
        const pnl         = att - inv;
        const tax         = Calc.taxOnGain(pnl, p.tipoAsset);
        const pnlAfterTax = pnl - tax;
        const varDay      = prPrev ? ((prLive - prPrev) / prPrev) * 100 : null;
        const cv          = x => Exchange.convert(x, v, currency);

        const pnlP = inv > 0 ? (pnl / inv) * 100 : 0;
        const rowId = `row-pnlp-${id}`;
        Calc.pnlPercentWithFx(p, prLive, currency).then(pct => {
            const el = document.getElementById(rowId);
            if (el) {
                el.textContent = `(${Calc.fmtSign(pct)}%)`;
                el.className = `fs-xs ${pct >= 0 ? 'text-cyan' : 'neg-loss'}`;
            }
        });

        const varHtml = varDay !== null
            ? `<span class="${varDay >= 0 ? 'pos-gain' : 'neg-loss'}">${Calc.fmtSign(varDay)}%</span>`
            : '<span class="text-muted">—</span>';

        const assetBadge =
            p.tipoAsset === 'bond'   ? '<span class="badge badge-bond">12.5%</span>' :
            p.tipoAsset === 'crypto' ? '<span class="badge badge-crypto">33%</span>' : '';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><div class="ticker-cell">
                ${logoImg(p.nome, 'ticker-logo')}
                <span class="ticker-name">${p.nome}</span>
                <span class="badge">${v}</span>${assetBadge}
            </div></td>
            <td>${Calc.fmt(qta, 4)}</td>
            <td>${Calc.fmt(pmc)}</td>
            <td><b>${Calc.fmt(prLive)}</b></td>
            <td>${varHtml}</td>
            <td>${s} ${Calc.fmt(cv(att))}</td>
            <td class="${pnl >= 0 ? 'text-cyan fw-bold' : 'neg-loss'}">
                ${s} ${Calc.fmt(cv(pnl))}
                <br><span id="${rowId}" class="fs-xs">(${Calc.fmtSign(pnlP)}%)</span>
            </td>
            <td>
                <span class="${pnlAfterTax >= 0 ? 'pos-gain' : 'neg-loss'} fw-bold">${s} ${Calc.fmt(cv(pnlAfterTax))}</span>
                <br><span class="text-muted fs-xs">tasse: ${s} ${Calc.fmt(cv(tax))}</span>
            </td>
            <td class="${realizedPnL >= 0 ? 'pos-gain' : 'neg-loss'}">${s} ${Calc.fmt(cv(realizedPnL))}</td>
            <td>
                <div class="action-btns">
                    <button class="btn-action btn-action-history"  data-action="history" data-id="${id}" title="Storico">📜</button>
                    <button class="btn-action btn-action-buy"      data-action="buy"     data-id="${id}" title="Acquisto">＋</button>
                    <button class="btn-action btn-action-sell"     data-action="sell"    data-id="${id}" title="Vendita">－</button>
                    <button class="btn-action btn-action-sim"      data-action="sim"     data-id="${id}" title="Simulazione">◎</button>
                    <button class="btn-action btn-action-delete"   data-action="delete"  data-id="${id}" title="Elimina">✕</button>
                </div>
            </td>`;
        tbody.appendChild(tr);
    }

    tbody.onclick = e => {
        const btn = e.target.closest('[data-action]');
        if (!btn) return;
        const { action, id } = btn.dataset;
        if (action === 'history')  handlers.onHistory(id);
        if (action === 'buy')      handlers.onTransaction(id, 'buy');
        if (action === 'sell')     handlers.onTransaction(id, 'sell');
        if (action === 'sim')      handlers.onSimulation(id);
        if (action === 'delete')   handlers.onDelete(id);
    };
}

export function renderKPI({ portfolio, prices, currency }) {
    const s = currency === 'EUR' ? '€' : '$';
    let totInv = 0, totAtt = 0, totReal = 0, totTax = 0, totComm = 0;

    for (const id in portfolio) {
        const p = portfolio[id];
        const v = p.valuta || 'EUR';
        const { qta, pmc, realizedPnL, totalComm } = Calc.position(p);
        const prLive = prices[id] ?? pmc;
        const inv = qta * pmc, att = qta * prLive;
        const tax = Calc.taxOnGain(att - inv, p.tipoAsset);
        const cv = x => Exchange.convert(x, v, currency);
        totInv  += cv(inv);
        totAtt  += cv(att);
        totReal += cv(realizedPnL);
        totTax  += cv(tax);
        totComm += cv(totalComm);
    }

    const pnl          = totAtt - totInv;
    const pnlP         = totInv > 0 ? (pnl / totInv) * 100 : 0;
    const pnlAfterTax  = pnl - totTax;
    const pnlAfterTaxP = totInv > 0 ? (pnlAfterTax / totInv) * 100 : 0;
    const totNetto     = pnlAfterTax + totReal;

    const dash = document.getElementById('dashboard');
    if (!dash) return;
    dash.innerHTML = `
        <div class="kpi-group">
            <div class="kpi-label">💼 Portafoglio</div>
            <div class="kpi-row">
                <div class="kpi-item">
                    <div class="kpi-title">Investito</div>
                    <div class="kpi-value">${s} ${Calc.fmt(totInv)}</div>
                </div>
                <div class="kpi-sep"></div>
                <div class="kpi-item">
                    <div class="kpi-title">Controvalore</div>
                    <div class="kpi-value">${s} ${Calc.fmt(totAtt)}</div>
                </div>
                <div class="kpi-sep"></div>
                <div class="kpi-item">
                    <div class="kpi-title">Commissioni Pagate</div>
                    <div class="kpi-value text-warning">${s} ${Calc.fmt(totComm)}</div>
                </div>
            </div>
        </div>

        <div class="kpi-group">
            <div class="kpi-label">📈 Performance</div>
            <div class="kpi-row">
                <div class="kpi-item">
                    <div class="kpi-title">P&L Non Realizzato</div>
                    <div class="kpi-value ${pnl >= 0 ? 'pos-gain' : 'neg-loss'}">${s} ${Calc.fmt(pnl)}</div>
                    <div class="kpi-sub">${Calc.fmtSign(pnlP)}%</div>
                </div>
                <div class="kpi-sep"></div>
                <div class="kpi-item">
                    <div class="kpi-title">P&L After Tax</div>
                    <div class="kpi-value ${pnlAfterTax >= 0 ? 'pos-gain' : 'neg-loss'}">${s} ${Calc.fmt(pnlAfterTax)}</div>
                    <div class="kpi-sub">${Calc.fmtSign(pnlAfterTaxP)}% &nbsp;·&nbsp; tasse: ${s} ${Calc.fmt(totTax)}</div>
                </div>
                <div class="kpi-sep"></div>
                <div class="kpi-item">
                    <div class="kpi-title">P&L Realizzato</div>
                    <div class="kpi-value ${totReal >= 0 ? 'pos-gain' : 'neg-loss'}">${s} ${Calc.fmt(totReal)}</div>
                </div>
                <div class="kpi-sep"></div>
                <div class="kpi-item">
                    <div class="kpi-title">P&L Totale After Tax</div>
                    <div class="kpi-value ${totNetto >= 0 ? 'pos-gain' : 'neg-loss'} fw-bold">${s} ${Calc.fmt(totNetto)}</div>
                    <div class="kpi-sub">realizzato + non realizzato</div>
                </div>
            </div>
        </div>`;
}

export function renderMobileCards({ portfolio, prices, prevClose, currency }, handlers) {
    const container = document.getElementById('mobile-cards');
    if (!container) return;
    const s = currency === 'EUR' ? '€' : '$';

    if (!Object.keys(portfolio).length) {
        container.innerHTML = `<div class="empty-state"><div class="icon">📭</div>Nessun titolo — aggiungine uno sopra</div>`;
        return;
    }

    container.innerHTML = '';
    for (const id in portfolio) {
        const p = portfolio[id];
        const v = p.valuta || 'EUR';
        const { qta, pmc, realizedPnL } = Calc.position(p);
        const prLive = prices[id]    ?? pmc;
        const prPrev = prevClose[id] ?? null;
        const inv    = qta * pmc;
        const att    = qta * prLive;
        const pnl    = att - inv;
        const pnlP   = inv > 0 ? (pnl / inv) * 100 : 0;
        const tax    = Calc.taxOnGain(pnl, p.tipoAsset);
        const pnlAT  = pnl - tax;
        const varDay = prPrev ? ((prLive - prPrev) / prPrev) * 100 : null;
        const cv     = x => Exchange.convert(x, v, currency);

        const assetBadge =
            p.tipoAsset === 'bond'   ? '<span class="badge badge-bond">12.5%</span>' :
            p.tipoAsset === 'crypto' ? '<span class="badge badge-crypto">33%</span>' : '';

        const varHtml = varDay !== null
            ? `<span class="${varDay >= 0 ? 'pos-gain' : 'neg-loss'} fw-bold">${Calc.fmtSign(varDay)}%</span>`
            : '<span class="text-muted">—</span>';

        const card = document.createElement('div');
        card.className = 'mobile-card';
        card.innerHTML = `
            <div class="mobile-card-header" data-id="${id}">
                <div class="mobile-card-left">
                    ${logoImg(p.nome, 'ticker-logo')}
                    <span class="ticker-name">${p.nome}</span>
                    <span class="badge">${v}</span>${assetBadge}
                </div>
                <div class="mobile-card-right">
                    <span class="${pnl >= 0 ? 'pos-gain' : 'neg-loss'} fw-bold">${s} ${Calc.fmt(cv(pnl))}</span>
                    <span class="fs-xs ${pnl >= 0 ? 'pos-gain' : 'neg-loss'}">(${Calc.fmtSign(pnlP)}%)</span>
                </div>
                <span class="mobile-card-arrow">›</span>
            </div>
            <div class="mobile-card-summary">
                <div class="mobile-card-row">
                    <span class="text-muted">Prezzo</span>
                    <span><b>${Calc.fmt(prLive)}</b> &nbsp; Var: ${varHtml}</span>
                </div>
                <div class="mobile-card-row">
                    <span class="text-muted">Q.tà / PMC</span>
                    <span>${Calc.fmt(qta, 4)} / ${Calc.fmt(pmc)}</span>
                </div>
                <div class="mobile-card-row">
                    <span class="text-muted">Controvalore</span>
                    <span>${s} ${Calc.fmt(cv(att))}</span>
                </div>
            </div>
            <div class="mobile-card-detail" id="detail-${id}" style="display:none;">
                <div class="mobile-card-row">
                    <span class="text-muted">P&L After Tax</span>
                    <span class="${pnlAT >= 0 ? 'pos-gain' : 'neg-loss'} fw-bold">${s} ${Calc.fmt(cv(pnlAT))}</span>
                </div>
                <div class="mobile-card-row">
                    <span class="text-muted">Tasse stimate</span>
                    <span class="text-warning">${s} ${Calc.fmt(cv(tax))}</span>
                </div>
                <div class="mobile-card-row">
                    <span class="text-muted">P&L Realizzato</span>
                    <span class="${realizedPnL >= 0 ? 'pos-gain' : 'neg-loss'}">${s} ${Calc.fmt(cv(realizedPnL))}</span>
                </div>
                <div class="mobile-card-actions">
                    <button class="btn btn-dark btn-sm"    data-action="history" data-id="${id}">📜 Storico</button>
                    <button class="btn btn-success btn-sm" data-action="buy"     data-id="${id}">＋ Compra</button>
                    <button class="btn btn-purple btn-sm"  data-action="sell"    data-id="${id}">－ Vendi</button>
                    <button class="btn btn-sm"             data-action="sim"     data-id="${id}" style="background:#2a7f5e;">◎ Sim</button>
                    <button class="btn btn-danger btn-sm"  data-action="delete"  data-id="${id}">🗑 Elimina</button>
                </div>
            </div>`;

        card.querySelector('.mobile-card-header').addEventListener('click', () => {
            const detail = document.getElementById(`detail-${id}`);
            const arrow  = card.querySelector('.mobile-card-arrow');
            const isOpen = detail.style.display !== 'none';
            detail.style.display = isOpen ? 'none' : 'block';
            arrow.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(90deg)';
        });

        card.querySelectorAll('[data-action]').forEach(btn => {
            btn.addEventListener('click', e => {
                e.stopPropagation();
                const { action, id } = btn.dataset;
                if (action === 'history')  handlers.onHistory(id);
                if (action === 'buy')      handlers.onTransaction(id, 'buy');
                if (action === 'sell')     handlers.onTransaction(id, 'sell');
                if (action === 'sim')      handlers.onSimulation(id);
                if (action === 'delete')   handlers.onDelete(id);
            });
        });

        container.appendChild(card);
    }
}
