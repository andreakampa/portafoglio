import { Calc } from './calc.js';
import { Exchange } from '../../api/exchange.js';
import { Search } from '../../api/search.js';

window._logoFallback = function(el, base) {
    const colors = ['#2a7f5e','#1a6fa0','#7b4fa0','#a05c1a','#1a8a6a','#6a3fa0','#a03a3a','#2a5fa0'];
    const bg = colors[base.charCodeAt(0) % colors.length];
    const letters = base.slice(0, 3);
    const svg = `data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' width='28' height='28'><rect width='28' height='28' rx='6' fill='${encodeURIComponent(bg)}'/><text x='14' y='19' text-anchor='middle' font-size='9' font-weight='700' fill='white' font-family='Arial'>${letters}</text></svg>`;
    el.src = svg;
    el.onerror = null;
};

function logoImg(nome, cssClass) {
    const base = (nome || '').split('.')[0].split('-')[0].toUpperCase();
    return `<img
        src="https://financialmodelingprep.com/image-stock/${base}.png"
        class="${cssClass}"
        alt="${base}"
        onerror="this.src='https://assets.parqet.com/logos/symbol/${base}?format=jpg'; this.onerror=function(){this.src='https://eodhd.com/img/logos/US/${base}.png'; this.onerror=function(){window._logoFallback(this,'${base}');};};"
    >`;
}

// ── HELPER: ordina e raggruppa gli id del portfolio ────────────────────────
function groupedSortedIds(portfolio, positionMap) {
    const ids = Object.keys(portfolio);

    const active      = [];
    const closed      = [];
    const empty       = [];
    const transferred = [];

    for (const id of ids) {
        const p   = portfolio[id];
        const txs = p.transactions || [];
        const qta = positionMap ? (positionMap[id]?.qta ?? 0) : 0;

        // Calcola quantità trasferita dalle transazioni di tipo transfer in uscita
        const qtaTrasferita = txs
            .filter(tx => tx.type === 'transfer' && tx.destPortfolioId)
            .reduce((s, tx) => s + (+tx.qty || 0), 0);

        if (txs.length === 0) {
            empty.push(id);
        } else if (qtaTrasferita > 0 && qta < 0.00001) {
            // Interamente trasferito
            transferred.push(id);
        } else if (qtaTrasferita > 0 && qta >= 0.00001) {
            // Parzialmente trasferito: appare in entrambe
            active.push(id);
            transferred.push(id);
        } else if (qta < 0.00001) {
            closed.push(id);
        } else {
            active.push(id);
        }
    }

    const byName = (a, b) =>
        (portfolio[a].nome || '').localeCompare(portfolio[b].nome || '', 'it', { sensitivity: 'base' });

    active.sort(byName);
    closed.sort(byName);
    empty.sort(byName);
    transferred.sort(byName);

    return { active, closed, empty, transferred };
}

function getExtendedMarketInfo(id, valuta, preMarkets, postMarkets, prLive) {
    if (valuta !== 'USD') return null;
    const now = new Date();
    const utcHour = now.getUTCHours();
    const utcMin  = now.getUTCMinutes();
    const utcTime = utcHour * 60 + utcMin;

    // Orari in UTC: premarket 9:00-14:30 (IT 11:00-16:30), aftermarket 21:00-01:00 (IT 23:00-03:00)
    const isPreMarket  = utcTime >= 540  && utcTime < 870;
    const isPostMarket = utcTime >= 1260 || utcTime < 60;

    if (isPreMarket && preMarkets[id] != null) {
        const diff = ((preMarkets[id] - prLive) / prLive) * 100;
        return { label: '🌅', price: preMarkets[id], diff, type: 'pre' };
    }
    if (isPostMarket && postMarkets[id] != null) {
        const diff = ((postMarkets[id] - prLive) / prLive) * 100;
        return { label: '🌙', price: postMarkets[id], diff, type: 'post' };
    }
    return null;
}

function week52Bar(id, prLive, week52Lows, week52Highs) {
    const low  = week52Lows[id];
    const high = week52Highs[id];
    if (!low || !high || high <= low) return '';

    const pct = Math.max(0, Math.min(100, ((prLive - low) / (high - low)) * 100));
    const color = pct < 30 ? 'var(--danger)' : pct > 70 ? 'var(--success)' : 'var(--warning)';

    return `
        <div style="margin-top:3px;width:100%;min-width:80px;">
            <div style="position:relative;height:3px;background:var(--border);border-radius:2px;">
                <div style="position:absolute;left:${pct}%;top:-2px;width:7px;height:7px;border-radius:50%;background:${color};transform:translateX(-50%);"></div>
            </div>
            <div style="display:flex;justify-content:space-between;font-size:9px;color:var(--text-muted);margin-top:2px;">
                <span>${Calc.fmt(low)}</span>
                <span>${Calc.fmt(high)}</span>
            </div>
        </div>`;
}

function dividendoDot(id, dividendi) {
    const divsAsset = dividendi?.[id] || [];
    const hasPaid = divsAsset.some(d => d.pagato);
    const hasMaturedPending = divsAsset.some(d => d.maturato && !d.pagato);

    if (!hasPaid && !hasMaturedPending) return '';

    const dotStyle = (color) =>
        `<span style="width:7px;height:7px;border-radius:50%;background:${color};display:inline-block;box-shadow:0 0 4px ${color};pointer-events:none;"></span>`;

    const wrapStyle = `display:inline-flex;align-items:center;gap:2px;padding:2px 5px;border-radius:999px;background:var(--bg2);border:1px solid var(--border);cursor:pointer;justify-content:center;min-width:18px;height:18px;`;

    if (hasPaid && hasMaturedPending) {
        return `<span title="Dividendi pagati e in maturazione" style="${wrapStyle}" data-action="dividendi" data-id="${id}">${dotStyle('var(--success)')}${dotStyle('var(--warning)')}</span>`;
    }
    if (hasPaid) {
        return `<span title="Dividendi pagati" style="${wrapStyle}" data-action="dividendi" data-id="${id}">${dotStyle('var(--success)')}</span>`;
    }
    return `<span title="Dividendo maturato non ancora pagato" style="${wrapStyle}" data-action="dividendi" data-id="${id}">${dotStyle('var(--warning)')}</span>`;
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
            
            <button id="btn-add-titolo" class="btn btn-success" style="align-self:flex-end;" disabled>Aggiungi</button>
        </div>
        <input type="hidden" id="input-ticker-final">
        <input type="hidden" id="input-valuta">
        <input type="hidden" id="input-tipo-asset">
        <input type="hidden" id="input-logo-url">
    </div>

    <div class="card desktop-only" id="card-table">
        <div class="card-title">💼 Posizioni</div>
        <div class="table-scroll-wrapper" id="table-scroll-wrapper" style="position:relative;">
            <button class="table-scroll-btn table-scroll-left" id="tbl-scroll-left" title="Scorri sinistra">&#8249;</button>
            <button class="table-scroll-btn table-scroll-right" id="tbl-scroll-right" title="Scorri destra">&#8250;</button>
            <div class="table-wrapper" id="table-wrapper-inner">
                <table id="portfolio-table">
                    <thead>
                        <tr>
                            <th>Symbol</th>
                            <th>Shares</th>
                            <th>AC/Share</th>
                            <th>Last Price</th>
                            <th>Daily P&L</th>
                            <th>Total Cost</th>
                            <th>Market Value</th>
                            <th>P&L Gross UNRL</th>
                            <th>P&L Net UNRL</th>
                            <th>P&L Gross REAL</th>
                            <th>P&L Net REAL</th>
                            <th>Trading Tools</th>
                        </tr>
                    </thead>
                    <tbody id="portfolio-tbody"></tbody>
                </table>
            </div>
        </div>
    </div>

    <div class="mobile-only">
        <div class="card-title" style="padding: 0 4px 10px;">💼 Posizioni</div>
        <div id="mobile-cards"></div>
    </div>

    <div id="modal-history"     class="overlay"></div>
    <div id="modal-transazione" class="overlay"></div>
    <div id="modal-simulazione" class="overlay"></div>

    <style>
        /* ── Tabella full-width ── */
        #card-table {
            padding-left: 0;
            padding-right: 0;
        }
        #card-table .card-title {
            padding-left: 1.25rem;
        }
        .table-scroll-wrapper {
            width: 100%;
            overflow: hidden;
        }
        #table-wrapper-inner {
            overflow-x: auto;
            overflow-y: visible;
            scroll-behavior: smooth;
            padding: 0 0.5rem 0.5rem;
        }
        /* Scrollbar visibile e stilizzata */
        #table-wrapper-inner::-webkit-scrollbar {
            height: 8px;
        }
        #table-wrapper-inner::-webkit-scrollbar-track {
            background: var(--bg2, #f1efe8);
            border-radius: 4px;
        }
        #table-wrapper-inner::-webkit-scrollbar-thumb {
            background: var(--border, #b4b2a9);
            border-radius: 4px;
            border: 2px solid var(--bg2, #f1efe8);
        }
        #table-wrapper-inner::-webkit-scrollbar-thumb:hover {
            background: var(--text-muted, #888780);
        }
        /* Firefox */
        #table-wrapper-inner {
            scrollbar-width: thin;
            scrollbar-color: var(--border, #b4b2a9) var(--bg2, #f1efe8);
        }
        /* Bottoni freccia scorrimento */
        .table-scroll-btn {
            position: absolute;
            top: 50%;
            transform: translateY(-50%);
            z-index: 10;
            width: 28px;
            height: 48px;
            border: 0.5px solid var(--border);
            border-radius: 6px;
            background: var(--bg, #fff);
            color: var(--text-muted);
            font-size: 22px;
            line-height: 1;
            cursor: pointer;
            display: flex;
            align-items: center;
            justify-content: center;
            opacity: 0.85;
            transition: opacity .15s, background .15s;
            padding: 0;
        }
        .table-scroll-btn:hover {
            opacity: 1;
            background: var(--bg2);
        }
        .table-scroll-left  { left: 0; }
        .table-scroll-right { right: 0; }

        /* Tabella compatta */
        #portfolio-table {
            min-width: 900px;
            width: 100%;
            border-collapse: collapse;
        }
        #portfolio-table th,
        #portfolio-table td {
            white-space: nowrap;
            padding: 8px 10px;
            font-size: 13px;
        }

        /* ── Separatori di gruppo ── */
        .tbody-group-header td {
            padding: 6px 10px 4px;
            font-size: 11px;
            font-weight: 500;
            text-transform: uppercase;
            letter-spacing: .05em;
            color: var(--text-muted);
            background: var(--bg2, #f8f8f6);
            border-top: 1px solid var(--border);
            border-bottom: none;
        }
        .row-closed {
            opacity: 0.55;
        }
        .row-empty {
            opacity: 0.38;
        }
        .badge-stato {
            font-size: 10px;
            font-weight: 500;
            padding: 1px 6px;
            border-radius: 10px;
            margin-left: 4px;
            vertical-align: middle;
        }
        .badge-closed {
            background: var(--bg2);
            color: var(--text-muted);
            border: 0.5px solid var(--border);
        }
        .badge-empty {
            background: var(--bg2);
            color: var(--text-muted);
            border: 0.5px dashed var(--border);
        }

        /* Toggle sezioni chiuse/vuote */
        .group-toggle-row td {
            padding: 4px 10px 8px;
            font-size: 12px;
            color: var(--text-muted);
            cursor: pointer;
            user-select: none;
        }
        .group-toggle-row td:hover {
            color: var(--text-primary);
        }
          .badge-transferred {
            background: #1a3a5c;
            color: #7bb8e8;
            border: 0.5px solid #2a5a8c;
        }
        .badge-partial-transfer {
            background: var(--bg2);
            color: var(--text-muted);
            border: 0.5px solid var(--border);
        }
        .row-transferred {
            opacity: 0.6;
        }  
    </style>
    `;

    // Frecce scorrimento tabella
    const wrapper = document.getElementById('table-wrapper-inner');
    const SCROLL_STEP = 220;

    document.getElementById('tbl-scroll-left')?.addEventListener('click', () => {
        if (wrapper) wrapper.scrollBy({ left: -SCROLL_STEP, behavior: 'smooth' });
    });
    document.getElementById('tbl-scroll-right')?.addEventListener('click', () => {
        if (wrapper) wrapper.scrollBy({ left: SCROLL_STEP, behavior: 'smooth' });
    });

    // Mostra/nascondi frecce in base alla posizione scroll
    if (wrapper) {
        const updateBtns = () => {
            const left  = document.getElementById('tbl-scroll-left');
            const right = document.getElementById('tbl-scroll-right');
            if (left)  left.style.display  = wrapper.scrollLeft > 10 ? 'flex' : 'none';
            if (right) right.style.display = (wrapper.scrollLeft + wrapper.clientWidth < wrapper.scrollWidth - 10) ? 'flex' : 'none';
        };
        wrapper.addEventListener('scroll', updateBtns);
        setTimeout(updateBtns, 300);
    }
}

export function renderSkeleton() {
    const tbody = document.getElementById('portfolio-tbody');
    if (!tbody) return;
    tbody.innerHTML = Array(3).fill(
        `<tr>${Array(11).fill('<td><div class="skeleton" style="height:14px;width:75%;"></div></td>').join('')}</tr>`
    ).join('');
}

export async function buildPositionMap(portfolio, prices) {
    const ids = Object.keys(portfolio);
    const positions = await Promise.all(ids.map(id => Calc.position(portfolio[id])));

    const map = {};
    ids.forEach((id, i) => {
        const p      = portfolio[id];
        const pos    = positions[i];
        const v      = (p.valuta || 'EUR').toUpperCase();
        const prLive = prices[id] ?? pos.pmc;
        const rate   = Exchange.rate || 1;

        const inv = pos.qta * pos.pmc;
const att = pos.qta * prLive;
const pnl = att - inv;

const invEur = v === 'EUR' ? inv : (pos.totalCostEur ?? inv / rate);
const attEur = v === 'EUR' ? att : att / rate;
const pnlEur = attEur - invEur;
const pnlEurPuro = pnlEur - (v === 'USD' && pos.totalCostNative > 0 && pos.totalCostEur > 0
    ? (() => {
        const tassoStorico = pos.totalCostNative / pos.totalCostEur;
        const valoreCorrentivoUSD = pos.qta * prLive;
        return (valoreCorrentivoUSD / (Exchange.rate || 1)) - (valoreCorrentivoUSD / tassoStorico);
    })()
    : 0);

const taxNative = Calc.taxOnGain(pnl, p.tipoAsset);
const pnlAfterTaxNative = pnl - taxNative;

const taxEur = Calc.taxOnGain(pnlEur, p.tipoAsset);
const pnlAfterTaxEur = pnlEur - taxEur;

// Effetto cambio per titoli USD
        let fxEffect = null;
        if (v === 'USD' && pos.totalCostNative > 0 && pos.totalCostEur > 0) {
            const tassoStorico = pos.totalCostNative / pos.totalCostEur;
            const valoreCorrentivoUSD = pos.qta * prLive;
            const attEurConTassoStorico = valoreCorrentivoUSD / tassoStorico;
            const attEurConTassoAttuale = valoreCorrentivoUSD / rate;
            fxEffect = attEurConTassoAttuale - attEurConTassoStorico;
        }

        // Effetto cambio realizzato
        let fxEffectRealized = null;
        if (v === 'USD' && pos.realizedPnL !== 0) {
            const tassoStorico = pos.totalCostNative > 0 && pos.totalCostEur > 0
                ? pos.totalCostNative / pos.totalCostEur
                : rate;
            const realizedUSD = pos.realizedPnL;
            fxEffectRealized = (realizedUSD / rate) - (realizedUSD / tassoStorico);
        }

map[id] = {
    ...pos,
    prLive,
    inv,
    att,
    pnl,
    pnlP: inv > 0 ? (pnl / inv) * 100 : 0,
    invEur,
    attEur,
    pnlEur,
    pnlEurPuro,
    tax: taxNative,
    pnlAfterTax: pnlAfterTaxNative,
    taxEur,
    pnlAfterTaxEur,
    valuta: v,
    fxEffect,
    fxEffectRealized,
};
    });

    return map;
}

export function renderTable({ portfolio, positionMap, prevClose, currency, preMarkets = {}, postMarkets = {}, week52Lows = {}, week52Highs = {}, dividendi = {} }, handlers) {
    const tbody = document.getElementById('portfolio-tbody');
    if (!tbody) return;
    const s = currency === 'EUR' ? '€' : '$';

    if (!Object.keys(portfolio).length) {
        tbody.innerHTML = `<tr><td colspan="12"><div class="empty-state"><div class="icon">📭</div>Nessun titolo — aggiungine uno sopra</div></td></tr>`;
        return;
    }

    tbody.innerHTML = '';

    const { active, closed, empty, transferred } = groupedSortedIds(portfolio, positionMap);

    // Stato visibilità gruppi collassabili
    if (typeof renderTable._showClosed === 'undefined') renderTable._showClosed = true;
    if (typeof renderTable._showEmpty  === 'undefined') renderTable._showEmpty  = true;
    // Nota: lo stato viene resettato ad ogni mount tramite resetRenderState()

    const renderGroup = (ids, groupClass, groupLabel, collapsible, showKey) => {
        if (!ids.length) return;

        // Header gruppo
        const headerRow = document.createElement('tr');
        headerRow.className = 'tbody-group-header';
        headerRow.innerHTML = `<td colspan="12">${groupLabel} <span style="font-weight:400;opacity:.7;">(${ids.length})</span></td>`;
        tbody.appendChild(headerRow);

        // Righe titoli
        for (const id of ids) {
            const p   = portfolio[id];
            const pos = positionMap[id];
            const {
    qta = 0,
    pmc = 0,
    realizedPnL = 0,
    prLive = 0,
    att = 0,
    pnl = 0,
    pnlP = 0,
    pnlEur = 0,
    pnlEurPuro = pnlEur,
    tax = 0,
    pnlAfterTax = 0,
    taxEur = 0,
    pnlAfterTaxEur = 0,
    invEur = 0,
    valuta: v = (p.valuta || 'EUR').toUpperCase()
} = pos || {};
            const prPrev = prevClose[id] ?? null;
            const cv     = x => Exchange.convert(x, v, currency);
            const varDay = prPrev ? ((prLive - prPrev) / prPrev) * 100 : null;

            // Costo totale da mostrare
            const costoDisplay = currency === 'EUR'
                ? `€ ${Calc.fmt(invEur)}`
                : `${s} ${Calc.fmt(cv(pos.inv))}`;

            const rowId = `row-pnlp-${id}`;
            if (groupClass !== 'row-closed' && groupClass !== 'row-empty') {
                Calc.pnlPercentWithFx(p, prLive, currency).then(pct => {
                    const el = document.getElementById(rowId);
                    if (el) {
                        el.textContent = `(${Calc.fmtSign(pct)}%)`;
                        el.className = `fs-xs ${pct >= 0 ? 'text-cyan' : 'neg-loss'}`;
                    }
                });
            }

            const extMarket = getExtendedMarketInfo(id, v, preMarkets, postMarkets, prLive);
            const varHtml = `
                <div style="display:flex;flex-direction:column;gap:2px;">
                    <b>${Calc.fmt(prLive)}</b>
                    ${varDay !== null
                        ? `<span class="${varDay >= 0 ? 'pos-gain' : 'neg-loss'} fs-xs">${Calc.fmtSign(varDay)}%</span>`
                        : '<span class="text-muted fs-xs">—</span>'}
                </div>`;

            const assetBadge =
                p.tipoAsset === 'bond'   ? '<span class="badge badge-bond">12.5%</span>'  :
                p.tipoAsset === 'crypto' ? '<span class="badge badge-crypto">33%</span>'  : '';

            const qtaTrasferita = (portfolio[id]?.transactions || [])
                .filter(tx => tx.type === 'transfer' && tx.destPortfolioId)
                .reduce((s, tx) => s + (+tx.qty || 0), 0);

            const statoBadge = groupClass === 'row-closed'
                ? '<span class="badge-stato badge-closed">Chiuso</span>'
                : groupClass === 'row-empty'
                ? '<span class="badge-stato badge-empty">Vuoto</span>'
                : groupClass === 'row-transferred'
                ? '<span class="badge-stato badge-transferred">Trasferito</span>'
                : qtaTrasferita > 0
                ? `<span class="badge-stato badge-partial-transfer" title="Parzialmente trasferito: ${Calc.fmt(qtaTrasferita, 4)} unità">🔀 Parz.</span>`
                : '';

            const tr = document.createElement('tr');
            if (groupClass) tr.className = groupClass;
            tr.innerHTML = `
                <td><div class="ticker-cell">
                    ${logoImg(p.nome, 'ticker-logo')}
                    <div style="display:flex;flex-direction:column;gap:1px;">
                        <div style="display:flex;align-items:center;gap:4px;">
                            <span class="ticker-name">${p.nome}</span>
                           ${dividendoDot(id, dividendi)}
                        </div>
                        <span><span class="badge">${v}</span>${assetBadge}${statoBadge}</span>
                    </div>
                </div></td>
                <td>${qta > 0 ? Calc.fmt(qta, 4) : '—'}</td>
                <td>${pmc > 0 ? Calc.fmt(pmc) : '—'}</td>
                <td>
                    ${varHtml}
                    ${week52Bar(id, prLive, week52Lows, week52Highs)}
                </td>
               <td>${(() => {
    const hasPosition = qta > 0 && prPrev !== null;
    const dailyPnL = hasPosition ? cv((prLive - prPrev) * qta) : null;

    const priceRow = prPrev !== null
        ? `<span class="${varDay >= 0 ? 'pos-gain' : 'neg-loss'} fs-xs">${Calc.fmtSign(varDay)}%</span>`
        : '<span class="text-muted fs-xs">—</span>';

    const pnlRow = dailyPnL !== null
        ? `<span class="${dailyPnL >= 0 ? 'pos-gain' : 'neg-loss'} fw-bold">${dailyPnL >= 0 ? '+' : ''}${s} ${Calc.fmt(dailyPnL)}</span>`
        : '';

    const extRow = extMarket ? (() => {
        const extPnL = hasPosition ? cv((extMarket.price - prLive) * qta) : null;
        const colorClass = extMarket.diff >= 0 ? 'text-success' : 'text-danger';
        const pnlPart = extPnL !== null
            ? ` <span style="color:var(--text-muted);">→ ${extPnL >= 0 ? '+' : ''}${s} ${Calc.fmt(extPnL)}</span>`
            : '';
        return `<span style="font-size:10px;color:var(--text-muted);">${extMarket.label} <b>${Calc.fmt(extMarket.price)}</b> <span class="${colorClass}">${Calc.fmtSign(extMarket.diff)}%</span>${pnlPart}</span>`;
    })() : '';

    if (!pnlRow && !extRow) return '—';

    return `<div style="display:flex;flex-direction:column;gap:2px;">
        ${pnlRow}
        ${priceRow}
        ${extRow}
    </div>`;
})()}</td>
                <td>${invEur > 0 ? costoDisplay : '—'}</td>
                <td>${att > 0 ? `<b>${s} ${Calc.fmt(cv(att))}</b>` : '—'}</td>
                <td class="${pnl >= 0 ? 'text-cyan fw-bold' : 'neg-loss'}">
                    ${att > 0
    ? `${currency === 'EUR' ? (pnlEurPuro < 0 ? '-' : '') : (cv(pnl) < 0 ? '-' : '')}${s} ${Calc.fmt(Math.abs(currency === 'EUR' ? pnlEurPuro : cv(pnl)))}<br><span id="${rowId}" class="fs-xs">(${Calc.fmtSign(pnlP)}%)</span>${pos?.fxEffect != null ? `<br><span style="font-size:9px;color:var(--text-muted);font-weight:400;">fx ⇄  ${pos.fxEffect >= 0 ? '+' : ''}€ ${Calc.fmt(pos.fxEffect)}</span>` : ''}`
    : '—'}
                </td>
                <td>
                    ${att > 0
    ? (() => {
        const netShown = currency === 'EUR' ? pnlAfterTaxEur : cv(pnlAfterTax);
        const taxShown = currency === 'EUR' ? taxEur : cv(tax);
        return `<span class="${netShown >= 0 ? 'pos-gain' : 'neg-loss'} fw-bold">${s} ${Calc.fmt(netShown)}</span>
                <br><span class="text-muted fs-xs">tasse: ${s} ${Calc.fmt(taxShown)}</span>`;
      })()
    : '—'}
                </td>
                <td class="${realizedPnL >= 0 ? 'pos-gain' : 'neg-loss'}">
                    ${realizedPnL !== 0
                        ? `${s} ${Calc.fmt(cv(realizedPnL))}${pos?.fxEffectRealized != null ? `<br><span style="font-size:9px;color:var(--text-muted);font-weight:400;">fx ⇄ ${pos.fxEffectRealized >= 0 ? '+' : ''}€ ${Calc.fmt(pos.fxEffectRealized)}</span>` : ''}`
                        : '—'}
                </td>
                <td>${(() => {
    if (realizedPnL === 0) return '—';

    const realizedEur =
        v === 'EUR' ? realizedPnL : Exchange.convert(realizedPnL, v, 'EUR');

    const breakdown = Calc.realizedTaxBreakdown({
        gainEur: realizedEur,
        assetType: p.tipoAsset,
        availableMinus: 0
    });

    const realNetEur = realizedEur > 0 ? breakdown.nettoTeorico : realizedEur;
    const realTaxEur = realizedEur > 0 ? breakdown.taxTeorica : 0;

    const realNetShown =
        currency === 'EUR' ? realNetEur : Exchange.convert(realNetEur, 'EUR', currency);

    const realTaxShown =
        currency === 'EUR' ? realTaxEur : Exchange.convert(realTaxEur, 'EUR', currency);

    const taxLbl =
        p.tipoAsset === 'bond' ? '12,5%' :
        p.tipoAsset === 'crypto' ? '33%' :
        '26%';

    return `<span class="${realNetShown >= 0 ? 'pos-gain' : 'neg-loss'} fw-bold">${s} ${Calc.fmt(realNetShown)}</span>
            <br><span class="text-muted fs-xs">tasse (${taxLbl}): ${s} ${Calc.fmt(realTaxShown)}</span>`;
})()}</td>
                <td>
                    <div class="action-btns">
                        <button class="btn-action btn-action-history" data-action="history" data-id="${id}" title="Storico">📜</button>
                        ${groupClass !== 'row-transferred' ? `
                        <button class="btn-action btn-action-buy"  data-action="buy"      data-id="${id}" title="Acquisto">＋</button>
                        <button class="btn-action btn-action-sell" data-action="sell"     data-id="${id}" title="Vendita">－</button>
                        <button class="btn-action btn-action-sim"  data-action="sim"      data-id="${id}" title="Simulazione">◎</button>
                        <button class="btn-action"                 data-action="transfer" data-id="${id}" title="Trasferisci">🔀</button>
                        <button class="btn-action btn-action-delete" data-action="delete" data-id="${id}" title="Elimina">✕</button>
                        ` : ''}
                    </div>
                </td>`;
            tbody.appendChild(tr);
        }

        // Toggle collassa/espandi per chiusi e vuoti
        if (collapsible) {
            const toggleRow = document.createElement('tr');
            toggleRow.className = 'group-toggle-row';
            const isShown = renderTable[showKey];
            toggleRow.innerHTML = `<td colspan="12">— ${isShown ? 'Nascondi' : 'Mostra'} ${groupLabel.toLowerCase()} —</td>`;
            toggleRow.addEventListener('click', () => {
                renderTable[showKey] = !renderTable[showKey];
                renderTable._refresh && renderTable._refresh();
            });
            tbody.appendChild(toggleRow);
        }
    };

    renderGroup(active, '', '📈 Titoli attivi', false, null);
    if (renderTable._showClosed) renderGroup(closed, 'row-closed', '🔒 Posizioni chiuse', true, '_showClosed');
    else if (closed.length) {
        const toggleRow = document.createElement('tr');
        toggleRow.className = 'group-toggle-row';
        toggleRow.innerHTML = `<td colspan="12">— Mostra posizioni chiuse (${closed.length}) —</td>`;
        toggleRow.addEventListener('click', () => {
            renderTable._showClosed = true;
            renderTable._refresh && renderTable._refresh();
        });
        tbody.appendChild(toggleRow);
    }
    if (renderTable._showEmpty) renderGroup(empty, 'row-empty', '👁 Watchlist', true, '_showEmpty');
    else if (empty.length) {
        const toggleRow = document.createElement('tr');
        toggleRow.className = 'group-toggle-row';
        toggleRow.innerHTML = `<td colspan="12">— Mostra watchlist (${empty.length}) —</td>`;
        toggleRow.addEventListener('click', () => {
            renderTable._showEmpty = true;
            renderTable._refresh && renderTable._refresh();
        });
        tbody.appendChild(toggleRow);
    }
    if (renderTable._showTransferred) renderGroup(transferred, 'row-transferred', '🔀 Titoli trasferiti', true, '_showTransferred');
    else if (transferred.length) {
        const toggleRow = document.createElement('tr');
        toggleRow.className = 'group-toggle-row';
        toggleRow.innerHTML = `<td colspan="12">— Mostra titoli trasferiti (${transferred.length}) —</td>`;
        toggleRow.addEventListener('click', () => {
            renderTable._showTransferred = true;
            renderTable._refresh && renderTable._refresh();
        });
        tbody.appendChild(toggleRow);
    }
    tbody.onclick = e => {
  const btn = e.target.closest('[data-action]');
  if (!btn) return;
  const { action, id } = btn.dataset;
  if (action === 'history') handlers.onHistory(id);
  if (action === 'buy') handlers.onTransaction(id, 'buy');
  if (action === 'sell') handlers.onTransaction(id, 'sell');
  if (action === 'sim') handlers.onSimulation(id);
  if (action === 'delete') handlers.onDelete(id);
  if (action === 'dividendi') handlers.onDividendi(id);
  if (action === 'transfer') handlers.onTransfer?.(id);
};

    // Aggiorna frecce scroll dopo render
    setTimeout(() => {
        const wrapper = document.getElementById('table-wrapper-inner');
        const left  = document.getElementById('tbl-scroll-left');
        const right = document.getElementById('tbl-scroll-right');
        if (!wrapper) return;
        if (left)  left.style.display  = wrapper.scrollLeft > 10 ? 'flex' : 'none';
        if (right) right.style.display = (wrapper.scrollLeft + wrapper.clientWidth < wrapper.scrollWidth - 10) ? 'flex' : 'none';
    }, 100);
}
export function resetRenderState() {
    renderTable._showClosed      = true;
    renderTable._showEmpty       = true;
    renderTable._showTransferred = true;
}
export function renderKPI({ portfolio, positionMap, currency, fiscalState, dividendi = {}, handlers = {} }) {
    const s = currency === 'EUR' ? '€' : '$';

    let totInv = 0;
    let totAtt = 0;
    let totTax = 0;
    let totComm = 0;
    let totInvEur = 0;
    let totAttEur = 0;

    for (const id in portfolio) {
        const p = portfolio[id];
        const pos = positionMap[id];
        if (!pos) continue;

        const {
            inv = 0,
            att = 0,
            tax = 0,
            totalComm = 0,
            invEur = 0,
            attEur = 0,
            valuta: v = (p.valuta || 'EUR').toUpperCase()
        } = pos;

        const cv = x => Exchange.convert(x, v, currency);

        totInv += cv(inv);
        totAtt += cv(att);
        totTax += cv(tax);
        totComm += cv(totalComm);

        totInvEur += invEur;
        totAttEur += attEur;
    }

    const {
        realizedLordoEur = 0,
        realizedNettoEffettivoEur = 0
    } = Calc.buildDashboardTaxMetrics(portfolio, fiscalState);

    const realizedLordo =
        currency === 'EUR'
            ? realizedLordoEur
            : Exchange.convert(realizedLordoEur, 'EUR', currency);

    const realizedNetto =
        currency === 'EUR'
            ? realizedNettoEffettivoEur
            : Exchange.convert(realizedNettoEffettivoEur, 'EUR', currency);

    const pnl = totAtt - totInv;
    const pnlP = totInv > 0 ? (pnl / totInv) * 100 : 0;

    const pnlAfterTax = pnl - totTax;
    const pnlAfterTaxP = totInv > 0 ? (pnlAfterTax / totInv) * 100 : 0;

    const totNetto = pnlAfterTax + realizedNetto;

    const pnlEurStorico = totAttEur - totInvEur;
    const pnlEurStoricoP = totInvEur > 0 ? (pnlEurStorico / totInvEur) * 100 : 0;

    const totaleDividendiEur = Object.values(dividendi || {})
    .flat()
    .filter(d => d?.pagato)
    .reduce((sum, d) => sum + Number(d?.importoEur || 0), 0);

const totaleDividendi = currency === 'EUR'
    ? totaleDividendiEur
    : Exchange.convert(totaleDividendiEur, 'EUR', currency);

    

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
            <div class="kpi-sep"></div>
            <div class="kpi-item" data-action="dividendi-dashboard" style="cursor:pointer;">
                <div class="kpi-title">Dividendi</div>
                <div class="kpi-value pos-gain">${s} ${Calc.fmt(totaleDividendi)}</div>
                <div class="kpi-sub">totale ricevuto finora</div>
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
                <div class="kpi-title">P&L Realizzato Lordo</div>
                <div class="kpi-value ${realizedLordo >= 0 ? 'pos-gain' : 'neg-loss'}">${s} ${Calc.fmt(realizedLordo)}</div>
            </div>
            <div class="kpi-sep"></div>
            <div class="kpi-item">
                <div class="kpi-title">P&L Realizzato Netto</div>
                <div class="kpi-value ${realizedNetto >= 0 ? 'pos-gain' : 'neg-loss'}">${s} ${Calc.fmt(realizedNetto)}</div>
            </div>
            <div class="kpi-sep"></div>
            <div class="kpi-item">
                <div class="kpi-title">P&L Totale After Tax</div>
                <div class="kpi-value ${totNetto >= 0 ? 'pos-gain' : 'neg-loss'} fw-bold">${s} ${Calc.fmt(totNetto)}</div>
                <div class="kpi-sub">realizzato netto + non realizzato netto</div>
            </div>
            <div class="kpi-sep"></div>
            <div class="kpi-item">
                <div class="kpi-title">P&L EUR storico 🏦</div>
                <div class="kpi-value ${pnlEurStorico >= 0 ? 'pos-gain' : 'neg-loss'}">€ ${Calc.fmt(pnlEurStorico)}</div>
                <div class="kpi-sub">${Calc.fmtSign(pnlEurStoricoP)}% · tasso BCE storico</div>
            </div>
        </div>
    </div>
`;

dash.onclick = e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;

    const { action } = btn.dataset;
    if (action === 'dividendi-dashboard') {
        handlers.onDividendiDashboard?.();
    }
};
}

export function renderMobileCards({ portfolio, positionMap, prevClose, currency, preMarkets = {}, postMarkets = {}, week52Lows = {}, week52Highs = {}, dividendi = {} }, handlers) {
    const container = document.getElementById('mobile-cards');
    if (!container) return;
    const s = currency === 'EUR' ? '€' : '$';

    if (!Object.keys(portfolio).length) {
        container.innerHTML = `<div class="empty-state"><div class="icon">📭</div>Nessun titolo — aggiungine uno sopra</div>`;
        return;
    }

    container.innerHTML = '';

    const { active, closed, empty, transferred } = groupedSortedIds(portfolio, positionMap);

    const renderMobileGroup = (ids, groupClass, groupLabel) => {
        if (!ids.length) return;

        const labelEl = document.createElement('div');
        labelEl.style.cssText = 'font-size:11px;font-weight:500;text-transform:uppercase;letter-spacing:.05em;color:var(--text-muted);padding:12px 4px 6px;border-top:1px solid var(--border);margin-top:8px;';
        labelEl.textContent = groupLabel;
        container.appendChild(labelEl);

        for (const id of ids) {
            const p = portfolio[id];
            const pos = positionMap[id];

            const {
                qta = 0,
                pmc = 0,
                realizedPnL = 0,
                prLive = 0,
                att = 0,
                pnl = 0,
                pnlP = 0,
                tax = 0,
                pnlAfterTax = 0,
                taxEur = 0,
                pnlAfterTaxEur = 0,
                invEur = 0,
                inv = 0,
                valuta: v = (p.valuta || 'EUR').toUpperCase()
            } = pos || {};

            const prPrev = prevClose[id] ?? null;
            const cv = x => Exchange.convert(x, v, currency);
            const varDay = prPrev ? ((prLive - prPrev) / prPrev) * 100 : null;

            const costoDisplay = currency === 'EUR'
                ? `€ ${Calc.fmt(invEur)}`
                : `${s} ${Calc.fmt(cv(inv))}`;

            const assetBadge =
                p.tipoAsset === 'bond' ? '<span class="badge badge-bond">12.5%</span>' :
                p.tipoAsset === 'crypto' ? '<span class="badge badge-crypto">33%</span>' : '';

            const varHtml = varDay !== null
                ? `<span class="${varDay >= 0 ? 'pos-gain' : 'neg-loss'} fw-bold">${Calc.fmtSign(varDay)}%</span>`
                : '<span class="text-muted">—</span>';

            const unrealizedNetShown = currency === 'EUR' ? pnlAfterTaxEur : cv(pnlAfterTax);
            const unrealizedTaxShown = currency === 'EUR' ? taxEur : cv(tax);

            const realizedEur = v === 'EUR' ? realizedPnL : Exchange.convert(realizedPnL, v, 'EUR');
            const realizedBreakdown = Calc.realizedTaxBreakdown({
                gainEur: realizedEur,
                assetType: p.tipoAsset,
                availableMinus: 0
            });

            const realizedNetEur = realizedEur > 0 ? realizedBreakdown.nettoTeorico : realizedEur;
            const realizedNetShown = currency === 'EUR'
                ? realizedNetEur
                : Exchange.convert(realizedNetEur, 'EUR', currency);

            const realizedNetClass = realizedNetShown >= 0 ? 'pos-gain' : 'neg-loss';

            const card = document.createElement('div');
            card.className = `mobile-card${groupClass ? ' ' + groupClass : ''}`;
            if (groupClass === 'row-closed') card.style.opacity = '0.6';
            if (groupClass === 'row-empty') card.style.opacity = '0.4';

            card.innerHTML = `
                <div class="mobile-card-header" data-id="${id}">
                    <div class="mobile-card-left">
                        ${logoImg(p.nome, 'ticker-logo')}
                        <div style="display:flex;flex-direction:column;gap:1px;">
                            <div style="display:flex;align-items:center;gap:4px;">
                                <span class="ticker-name">${p.nome}</span>
                               ${dividendoDot(id, dividendi)}
                            </div>
                            <span><span class="badge">${v}</span>${assetBadge}</span>
                            ${(() => {
                                const ext = getExtendedMarketInfo(id, v, preMarkets, postMarkets, prLive);
                                if (!ext) return '';
                                return `<span style="font-size:10px;color:var(--text-muted);">${ext.label} ${Calc.fmt(ext.price)} <span class="${ext.diff >= 0 ? 'text-success' : 'text-danger'}">${Calc.fmtSign(ext.diff)}%</span></span>`;
                            })()}
                        </div>
                    </div>
                    <div class="mobile-card-right">
                        <span class="${pnl >= 0 ? 'pos-gain' : 'neg-loss'} fw-bold">${att > 0 ? `${s} ${Calc.fmt(cv(pnl))}` : '—'}</span>
                        <span class="fs-xs ${pnl >= 0 ? 'pos-gain' : 'neg-loss'}">${att > 0 ? `(${Calc.fmtSign(pnlP)}%)` : ''}</span>
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
                        <span>${qta > 0 ? `${Calc.fmt(qta, 4)} / ${Calc.fmt(pmc)}` : '—'}</span>
                    </div>
                    <div class="mobile-card-row">
                        <span class="text-muted">Costo Totale</span>
                        <span>${invEur > 0 ? costoDisplay : '—'}</span>
                    </div>
                    <div class="mobile-card-row">
                        <span class="text-muted">Controvalore</span>
                        <span>${att > 0 ? `${s} ${Calc.fmt(cv(att))}` : '—'}</span>
                    </div>
                    <div class="mobile-card-row">
                        <span class="text-muted">52 settimane</span>
                        <span style="flex:1;">${week52Bar(id, prLive, week52Lows, week52Highs) || '—'}</span>
                    </div>
                </div>
                <div class="mobile-card-detail" id="detail-${id}" style="display:none;">
                    <div class="mobile-card-row">
                        <span class="text-muted">P&L After Tax</span>
                        <span class="${unrealizedNetShown >= 0 ? 'pos-gain' : 'neg-loss'} fw-bold">
                            ${att > 0 ? `${s} ${Calc.fmt(unrealizedNetShown)}` : '—'}
                        </span>
                    </div>
                    <div class="mobile-card-row">
                        <span class="text-muted">Tasse stimate</span>
                        <span class="text-warning">
                            ${att > 0 ? `${s} ${Calc.fmt(unrealizedTaxShown)}` : '—'}
                        </span>
                    </div>
                    <div class="mobile-card-row">
                        <span class="text-muted">P&L Realizzato Lordo</span>
                        <span class="${realizedPnL >= 0 ? 'pos-gain' : 'neg-loss'}">
                            ${realizedPnL !== 0 ? `${s} ${Calc.fmt(cv(realizedPnL))}` : '—'}
                        </span>
                    </div>
                    <div class="mobile-card-row">
                        <span class="text-muted">P&L Realizzato Netto</span>
                        <span class="${realizedNetClass} fw-bold">
                            ${realizedPnL !== 0 ? `${s} ${Calc.fmt(realizedNetShown)}` : '—'}
                        </span>
                    </div>
                    <div class="mobile-card-actions">
                        <button class="btn btn-dark btn-sm" data-action="history" data-id="${id}">📜 Storico</button>
                        <button class="btn btn-success btn-sm" data-action="buy" data-id="${id}">＋ Compra</button>
                        <button class="btn btn-purple btn-sm" data-action="sell" data-id="${id}">－ Vendi</button>
                        <button class="btn btn-sm" data-action="sim" data-id="${id}" style="background:#2a7f5e;">◎ Sim</button>
                        <button class="btn btn-danger btn-sm" data-action="delete" data-id="${id}">🗑 Elimina</button>
                    </div>
                </div>
            `;

            card.querySelector('.mobile-card-header').addEventListener('click', () => {
                const detail = document.getElementById(`detail-${id}`);
                const arrow = card.querySelector('.mobile-card-arrow');
                const isOpen = detail.style.display !== 'none';
                detail.style.display = isOpen ? 'none' : 'block';
                arrow.style.transform = isOpen ? 'rotate(0deg)' : 'rotate(90deg)';
            });

            card.querySelectorAll('[data-action]').forEach(btn =>
  btn.addEventListener('click', e => {
    e.stopPropagation();
    const { action, id } = btn.dataset;
    if (action === 'history') handlers.onHistory(id);
    if (action === 'buy') handlers.onTransaction(id, 'buy');
    if (action === 'sell') handlers.onTransaction(id, 'sell');
    if (action === 'sim') handlers.onSimulation(id);
    if (action === 'delete') handlers.onDelete(id);
    if (action === 'dividendi') handlers.onDividendi(id);
  })
);

            container.appendChild(card);
        }
    };

    renderMobileGroup(active, '', '📈 Titoli attivi');
    renderMobileGroup(closed, 'row-closed', '🔒 Posizioni chiuse');
    renderMobileGroup(empty, 'row-empty', '⬜ Senza operazioni');
}