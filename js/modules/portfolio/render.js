import { Calc } from './calc.js';
import { Exchange } from '../../api/exchange.js';

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
            <div class="form-field" style="flex:2; min-width:150px;">
                <label>Ticker Yahoo Finance</label>
                <input type="text" id="input-titolo" placeholder="AAPL, RACE.MI, BTC-USD ...">
            </div>
            <div class="form-field">
                <label>Tipo Asset</label>
                <select id="input-tipo-asset">
                    <option value="stock">Azione / ETF (26%)</option>
                    <option value="bond">Titolo di Stato (12.5%)</option>
                </select>
            </div>
            <div class="form-field">
                <label>Valuta</label>
                <select id="input-valuta">
                    <option value="EUR">EUR (€)</option>
                    <option value="USD">USD ($)</option>
                </select>
            </div>
            <div class="form-field" style="min-width:120px;">
                <label>Commissione Default (€)</label>
                <input type="number" id="input-comm-default" placeholder="7.00" step="0.01">
            </div>
            <button id="btn-add-titolo" class="btn btn-success" style="align-self:flex-end;">Aggiungi</button>
        </div>
    </div>

    <div class="card">
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

        const inv      = qta * pmc;
        const att      = qta * prLive;
        const pnl      = att - inv;
        const pnlP     = inv > 0 ? (pnl / inv) * 100 : 0;
        const tax      = Calc.taxOnGain(pnl, p.tipoAsset);
        const pnlAfterTax = pnl - tax;
        const varDay   = prPrev ? ((prLive - prPrev) / prPrev) * 100 : null;

        const cv = x => Exchange.convert(x, v, currency);

        const varHtml = varDay !== null
            ? `<span class="${varDay >= 0 ? 'pos-gain' : 'neg-loss'}">${Calc.fmtSign(varDay)}%</span>`
            : '<span class="text-muted">—</span>';

        const bondBadge = p.tipoAsset === 'bond' ? '<span class="badge badge-bond">BTP</span>' : '';

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td><div class="ticker-cell">
                <span class="ticker-name">${p.nome}</span>
                <span class="badge">${v}</span>${bondBadge}
            </div></td>
            <td>${Calc.fmt(qta, 4)}</td>
            <td>${Calc.fmt(pmc)}</td>
            <td><b>${Calc.fmt(prLive)}</b></td>
            <td>${varHtml}</td>
            <td>${s} ${Calc.fmt(cv(att))}</td>
            <td class="${pnl >= 0 ? 'pos-gain' : 'neg-loss'}">
                ${s} ${Calc.fmt(cv(pnl))}
                <br><span class="fs-xs">(${Calc.fmtSign(pnlP)}%)</span>
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

    const pnl        = totAtt - totInv;
    const pnlP       = totInv > 0 ? (pnl / totInv) * 100 : 0;
    const pnlAfterTax = pnl - totTax;
    const pnlAfterTaxP = totInv > 0 ? (pnlAfterTax / totInv) * 100 : 0;
    const totNetto   = pnlAfterTax + totReal;

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
