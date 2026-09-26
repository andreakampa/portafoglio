import { Calc } from '../calc.js';
import { Exchange } from '../../../api/exchange.js';
import { Toast } from '../../../core/toast.js';
import { lockScroll, unlockScroll } from './helpers.js';

let storicoState = {
    tab: 'compravendite', // 'compravendite' | 'dividendi' | 'interessi'
    range: null,          // giorni, null = Tutto
    customFrom: null,
    customTo: null,
    fxMode: 'broker',      // 'broker' | 'fiscale'
    ticker: null,          // null = tutti
    txType: null,          // null = tutti | 'buy' | 'sell' (solo compravendite)
    activePortfolio: null, // portafoglio attivo, per la tab Interessi
    onSave: null           // callback di salvataggio, per la tab Interessi
};

const RANGES = [
    { label: '7gg', days: 7 },
    { label: '30gg', days: 30 },
    { label: '60gg', days: 60 },
    { label: '90gg', days: 90 },
    { label: '180gg', days: 180 },
    { label: '365gg', days: 365 },
    { label: 'Tutto', days: null }
];

// Aliquote per il calcolo della tassa presunta sulla singola vendita.
// Stessa logica usata altrove nel sito (calc.js taxOnGain, history.js).
const TAX_RATES_BY_ASSET = { bond: 0.125, crypto: 0.33 };
function taxRateForAsset(tipoAsset) {
    return TAX_RATES_BY_ASSET[tipoAsset] ?? 0.26;
}

function daysAgo(dateStr) {
    const d = new Date(`${dateStr}T12:00:00`);
    return Math.round((new Date() - d) / 86400000);
}

function inRange(dateStr) {
    if (storicoState.customFrom || storicoState.customTo) {
        if (storicoState.customFrom && dateStr < storicoState.customFrom) return false;
        if (storicoState.customTo && dateStr > storicoState.customTo) return false;
        return true;
    }
    if (storicoState.range === null) return true;
    return daysAgo(dateStr) <= storicoState.range;
}

function buildCompravenditeRows(portfolio, taxRegime) {
    const rows = [];
    for (const id in portfolio) {
        const p = portfolio[id];
        for (const r of Calc.transactionRows(p, taxRegime)) {
            rows.push({ ...r, symbol: p.nome, id, tipoAsset: p.tipoAsset || 'stock' });
        }
    }
    rows.sort((a, b) => b.date.localeCompare(a.date));
    return rows;
}

function buildDividendiRows(portfolio, dividendi) {
    const rows = [];
    for (const id in (dividendi || {})) {
        const p = portfolio[id];
        if (!p) continue;
        for (const d of dividendi[id]) {
            rows.push({
                date: d.payDate || d.exDate,
                symbol: p.nome,
                perShare: d.dividendoPerAzione,
                qty: d.qta,
                totalEur: d.importoEur,
                pagato: d.pagato,
                maturato: d.maturato
            });
        }
    }
    rows.sort((a, b) => b.date.localeCompare(a.date));
    return rows;
}

const MESI_IT = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic'];
function formatPeriod(period) {
    const [y, m] = (period || '').split('-');
    const idx = parseInt(m, 10) - 1;
    return MESI_IT[idx] ? `${MESI_IT[idx]} ${y}` : period;
}

function buildInterestRows(activePortfolio) {
    const rows = (activePortfolio?.marginInterest || []).slice();
    rows.sort((a, b) => b.period.localeCompare(a.period) || a.currency.localeCompare(b.currency));
    return rows;
}

function uniqueSortedTickers(list) {
    return [...new Set(list.filter(Boolean))].sort((a, b) => a.localeCompare(b, 'it'));
}

function getCompravenditeTickers(portfolio) {
    return uniqueSortedTickers(Object.values(portfolio).map(p => p.nome));
}

function getDividendiTickers(portfolio, dividendi) {
    return uniqueSortedTickers(
        Object.keys(dividendi || {}).map(id => portfolio[id]?.nome)
    );
}

export function openStoricoModal(portfolio, dividendi, taxRegime = 'amministrato', activePortfolio = null, onSave = null) {
    const overlay = document.getElementById('modal-storico');
    if (!overlay) return;

    storicoState.activePortfolio = activePortfolio;
    storicoState.onSave = onSave;

    overlay.innerHTML = `
        <div class="modal modal-wide">
            <div class="modal-header">
                <h3>📊 Movimenti</h3>
                <button class="btn-x" id="storico-close">✕</button>
            </div>
            <div class="modal-body">
                                <div style="display:flex; gap:8px; margin-bottom:14px;">
                    <button id="storico-tab-cv" class="btn-toggle">Compravendite</button>
                    <button id="storico-tab-div" class="btn-toggle">Dividendi</button>
                    <button id="storico-tab-int" class="btn-toggle">Interessi</button>
                </div>
                <div id="storico-filters" style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px;"></div>
                <div id="storico-custom-range" style="display:none; gap:8px; align-items:center; margin-bottom:12px;">
                    <input type="date" id="storico-from">
                    <span class="text-muted fs-sm">—</span>
                    <input type="date" id="storico-to">
                    <button id="storico-apply-range" class="btn btn-dark btn-sm">Applica</button>
                </div>
                <div id="storico-extra-filters" style="display:flex; flex-wrap:wrap; gap:10px; align-items:center; margin-bottom:12px;"></div>
                <div id="storico-fx-toggle-wrap" style="display:flex; justify-content:flex-end; margin-bottom:8px;"></div>
                <div class="table-wrapper">
                    <table class="tx-table tx-table-compact" id="storico-table"></table>
                </div>
            </div>
        </div>`;
    overlay.classList.add('visible');
    lockScroll();

    document.getElementById('storico-close').onclick = () => {
        overlay.classList.remove('visible');
        unlockScroll();
    };

    renderStorico(portfolio, dividendi, taxRegime);
}

function renderFilters(portfolio, dividendi, taxRegime) {
    const el = document.getElementById('storico-filters');
    const isCustom = storicoState.customFrom || storicoState.customTo;

    el.innerHTML = RANGES.map(r => `
        <button class="btn-toggle storico-range-btn ${!isCustom && storicoState.range === r.days ? 'active' : ''}"
                data-days="${r.days === null ? '' : r.days}">${r.label}</button>
    `).join('') + `<button class="btn-toggle ${isCustom ? 'active' : ''}" id="storico-range-custom">Intervallo</button>`;

    el.querySelectorAll('.storico-range-btn').forEach(btn => {
        btn.onclick = () => {
            storicoState.range = btn.dataset.days === '' ? null : parseInt(btn.dataset.days, 10);
            storicoState.customFrom = null;
            storicoState.customTo = null;
            document.getElementById('storico-custom-range').style.display = 'none';
            renderStorico(portfolio, dividendi, taxRegime);
        };
    });

    document.getElementById('storico-range-custom').onclick = () => {
        const box = document.getElementById('storico-custom-range');
        box.style.display = box.style.display === 'none' ? 'flex' : 'none';
    };

    document.getElementById('storico-apply-range').onclick = () => {
        storicoState.customFrom = document.getElementById('storico-from').value || null;
        storicoState.customTo = document.getElementById('storico-to').value || null;
        renderStorico(portfolio, dividendi, taxRegime);
    };
}

function renderExtraFilters(portfolio, dividendi, taxRegime) {
    const el = document.getElementById('storico-extra-filters');

    const tickers = storicoState.tab === 'compravendite'
        ? getCompravenditeTickers(portfolio)
        : getDividendiTickers(portfolio, dividendi);

    // Se il titolo selezionato non esiste in questa vista, resetta.
    if (storicoState.ticker && !tickers.includes(storicoState.ticker)) {
        storicoState.ticker = null;
    }

    const tickerSelectHtml = `
        <div style="display:flex; align-items:center; gap:6px;">
            <span class="text-muted fs-sm">Titolo:</span>
            <select id="storico-ticker-select">
                <option value="">Tutti i titoli</option>
                ${tickers.map(t => `<option value="${t}" ${storicoState.ticker === t ? 'selected' : ''}>${t}</option>`).join('')}
            </select>
        </div>`;

    const typeFilterHtml = storicoState.tab === 'compravendite' ? `
        <div style="display:flex; align-items:center; gap:6px;">
            <span class="text-muted fs-sm">Tipo:</span>
            <button class="btn-toggle storico-type-btn ${!storicoState.txType ? 'active' : ''}" data-type="">Tutti</button>
            <button class="btn-toggle storico-type-btn ${storicoState.txType === 'buy' ? 'active' : ''}" data-type="buy">Buy</button>
            <button class="btn-toggle storico-type-btn ${storicoState.txType === 'sell' ? 'active' : ''}" data-type="sell">Sell</button>
        </div>` : '';

    el.innerHTML = tickerSelectHtml + typeFilterHtml;

    document.getElementById('storico-ticker-select').onchange = (e) => {
        storicoState.ticker = e.target.value || null;
        renderStorico(portfolio, dividendi, taxRegime);
    };

    el.querySelectorAll('.storico-type-btn').forEach(btn => {
        btn.onclick = () => {
            storicoState.txType = btn.dataset.type || null;
            renderStorico(portfolio, dividendi, taxRegime);
        };
    });
}

function renderInterestTab(table) {
    const activePortfolio = storicoState.activePortfolio;
    if (!activePortfolio) {
        table.innerHTML = `<tbody><tr><td style="text-align:center;padding:20px;color:var(--text-muted);">Portafoglio non disponibile</td></tr></tbody>`;
        return;
    }

    const rows = buildInterestRows(activePortfolio);
    const rate = Exchange.rate || 1;
    const totaleEur = rows.reduce((sum, r) => sum + (r.currency === 'USD' ? r.amount / rate : r.amount), 0);

    table.innerHTML = `
        <thead><tr>
            <th>Periodo</th><th>Valuta</th><th>Importo</th><th></th>
        </tr></thead>
        <tbody>
            <tr>
                <td><input type="month" id="mi-period" style="width:130px;"></td>
                <td>
                    <select id="mi-currency">
                        <option value="EUR">EUR</option>
                        <option value="USD">USD</option>
                    </select>
                </td>
                <td><input type="number" id="mi-amount" step="0.01" min="0" placeholder="0.00" style="width:100px;"></td>
                <td><button id="mi-add" class="btn btn-success btn-sm">+ Aggiungi</button></td>
            </tr>
            ${rows.length ? rows.map(r => `
                <tr>
                    <td>${formatPeriod(r.period)}</td>
                    <td>${r.currency}</td>
                    <td>${r.currency === 'USD' ? '$' : '€'} ${Calc.fmt(r.amount)}</td>
                    <td><button class="btn-del-mi" data-id="${r.id}" title="Elimina">✕</button></td>
                </tr>
            `).join('') : `<tr><td colspan="4" style="text-align:center;padding:14px;color:var(--text-muted);">Nessun interesse registrato</td></tr>`}
            <tr>
                <td colspan="2" style="text-align:right;font-weight:600;">Totale (≈ EUR)</td>
                <td colspan="2" style="font-weight:600;">€ ${Calc.fmt(totaleEur)}</td>
            </tr>
        </tbody>`;

    document.getElementById('mi-add').onclick = async () => {
        const period = document.getElementById('mi-period').value;
        const currency = document.getElementById('mi-currency').value;
        const amount = parseFloat(document.getElementById('mi-amount').value);
        if (!period || isNaN(amount) || amount <= 0) {
            Toast.show('Inserisci periodo e importo validi', 'err');
            return;
        }
        if (!activePortfolio.marginInterest) activePortfolio.marginInterest = [];
        activePortfolio.marginInterest.push({ id: 'MI' + Date.now(), period, currency, amount });
        await storicoState.onSave?.();
        renderInterestTab(table);
        Toast.show('Interesse registrato', 'ok');
    };

    table.querySelectorAll('.btn-del-mi').forEach(btn => {
        btn.onclick = async () => {
            const idx = (activePortfolio.marginInterest || []).findIndex(r => r.id === btn.dataset.id);
            if (idx > -1) activePortfolio.marginInterest.splice(idx, 1);
            await storicoState.onSave?.();
            renderInterestTab(table);
            Toast.show('Interesse rimosso', 'ok');
        };
    });
}

function renderStorico(portfolio, dividendi, taxRegime) {
    document.getElementById('storico-tab-cv').classList.toggle('active', storicoState.tab === 'compravendite');
    document.getElementById('storico-tab-div').classList.toggle('active', storicoState.tab === 'dividendi');
    document.getElementById('storico-tab-int').classList.toggle('active', storicoState.tab === 'interessi');
    document.getElementById('storico-tab-cv').onclick = () => { storicoState.tab = 'compravendite'; renderStorico(portfolio, dividendi, taxRegime); };
    document.getElementById('storico-tab-div').onclick = () => { storicoState.tab = 'dividendi'; renderStorico(portfolio, dividendi, taxRegime); };
    document.getElementById('storico-tab-int').onclick = () => { storicoState.tab = 'interessi'; renderStorico(portfolio, dividendi, taxRegime); };

    const fxWrap = document.getElementById('storico-fx-toggle-wrap');
    const table  = document.getElementById('storico-table');

    if (storicoState.tab === 'interessi') {
        document.getElementById('storico-filters').innerHTML = '';
        document.getElementById('storico-extra-filters').innerHTML = '';
        fxWrap.innerHTML = '';
        renderInterestTab(table);
        return;
    }

    renderFilters(portfolio, dividendi, taxRegime);
    renderExtraFilters(portfolio, dividendi, taxRegime);

    if (storicoState.tab === 'compravendite') {
        fxWrap.innerHTML = `<button id="storico-fx-toggle" class="btn-toggle">
            Cambio: ${storicoState.fxMode === 'broker' ? 'al momento della transazione' : 'fiscale (storico per lotto)'}
        </button>`;
        document.getElementById('storico-fx-toggle').onclick = () => {
            storicoState.fxMode = storicoState.fxMode === 'broker' ? 'fiscale' : 'broker';
            renderStorico(portfolio, dividendi, taxRegime);
        };

                let rows = buildCompravenditeRows(portfolio, taxRegime).filter(r => inRange(r.date));
        if (storicoState.ticker) rows = rows.filter(r => r.symbol === storicoState.ticker);
        if (storicoState.txType) rows = rows.filter(r => r.type === storicoState.txType);

        // Tassa presunta e esito (plus/minus): sempre calcolati sul P&L fiscale
        // (cambio storico), indipendentemente dal toggle broker/fiscale usato
        // per la colonna "Profitto €" — la tassazione italiana usa sempre il fiscale.
        const totaleTassaPresunta = rows
            .filter(r => r.type === 'sell' && r.pnlEurFiscal > 0)
            .reduce((s, r) => s + r.pnlEurFiscal * taxRateForAsset(r.tipoAsset), 0);
        const totaleMinusGenerate = rows
            .filter(r => r.type === 'sell' && r.pnlEurFiscal < 0)
            .reduce((s, r) => s + Math.abs(r.pnlEurFiscal), 0);

        table.innerHTML = `
            <thead><tr>
                <th>Data</th><th>Tipo</th><th>Simbolo</th><th>Quantità</th><th>Importo Totale</th>
                <th>Profitto %</th><th>Profitto €</th><th>Esito</th><th>Tassa Presunta</th>
            </tr></thead>
            <tbody>
                ${rows.length ? rows.map(r => {
                    const pnlEur = storicoState.fxMode === 'broker' ? r.pnlEurBroker : r.pnlEurFiscal;
                    const isSell  = r.type === 'sell' && r.pnlEurFiscal !== null && r.pnlEurFiscal !== undefined;
                    const isPlus  = isSell && r.pnlEurFiscal > 0;
                    const isMinus = isSell && r.pnlEurFiscal < 0;
                    const tassaPresunta = isPlus ? r.pnlEurFiscal * taxRateForAsset(r.tipoAsset) : null;
                    return `<tr>
                        <td>${r.date}</td>
                        <td class="${r.type === 'buy' ? 'tx-buy' : 'tx-sell'}">${r.type === 'buy' ? '🟢 Buy' : '🔴 Sell'}</td>
                        <td>${r.symbol}</td>
                        <td>${Calc.fmt(r.qty, 4)}</td>
                        <td>${r.currency === 'USD'
                            ? `$ ${Calc.fmt(r.totalNative)} <span style="font-size:10px;color:var(--text-muted)">(€ ${Calc.fmt(r.totalEur)})</span>`
                            : `€ ${Calc.fmt(r.totalEur)}`}</td>
                        <td>${r.pnlPercent !== null ? `<span class="${r.pnlPercent >= 0 ? 'pos-gain' : 'neg-loss'}">${Calc.fmtSign(r.pnlPercent)}%</span>` : '—'}</td>
                        <td>${pnlEur !== null && pnlEur !== undefined ? `<span class="${pnlEur >= 0 ? 'pos-gain' : 'neg-loss'}">€ ${Calc.fmt(pnlEur)}</span>` : '—'}</td>
                        <td>${isPlus ? '<span class="pos-gain">📈 Plus</span>' : isMinus ? '<span class="neg-loss">📉 Minus</span>' : '—'}</td>
                        <td>${tassaPresunta !== null ? `<span class="text-warning">€ ${Calc.fmt(tassaPresunta)}</span>` : '—'}</td>
                    </tr>`;
                }).join('') : `<tr><td colspan="9" style="text-align:center;padding:20px;color:var(--text-muted);">Nessuna compravendita nel periodo/filtro selezionato</td></tr>`}
            </tbody>
            ${rows.length ? `<tfoot>
                <tr style="border-top:2px solid var(--border);font-weight:600;">
                    <td colspan="7" style="text-align:right;">Totale minus generate (periodo) &nbsp;/&nbsp; Totale tassa presunta lorda (senza compensazione)</td>
                    <td class="neg-loss">− € ${Calc.fmt(totaleMinusGenerate)}</td>
                    <td class="text-warning">€ ${Calc.fmt(totaleTassaPresunta)}</td>
                </tr>
            </tfoot>` : ''}`;
    } else {
        fxWrap.innerHTML = '';
        let rows = buildDividendiRows(portfolio, dividendi).filter(r => inRange(r.date));
        if (storicoState.ticker) rows = rows.filter(r => r.symbol === storicoState.ticker);

        table.innerHTML = `
            <thead><tr>
                <th>Data</th><th>Simbolo</th><th>Dividendo €</th><th>Quantità</th><th>Importo Totale €</th>
            </tr></thead>
            <tbody>
                ${rows.length ? rows.map(r => `
                    <tr>
                        <td>${r.date} ${r.pagato
                            ? '<span title="Pagato" style="color:var(--success);">●</span>'
                            : r.maturato ? '<span title="Maturato, non ancora pagato" style="color:var(--warning);">●</span>' : ''}</td>
                        <td>${r.symbol}</td>
                        <td>€ ${Calc.fmt(r.perShare, 4)}</td>
                        <td>${Calc.fmt(r.qty, 4)}</td>
                        <td>€ ${Calc.fmt(r.totalEur)}</td>
                    </tr>
                `).join('') : `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted);">Nessun dividendo nel periodo/filtro selezionato</td></tr>`}
            </tbody>`;
    }
}