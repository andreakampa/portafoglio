import { Calc } from '../calc.js';
import { lockScroll, unlockScroll } from './helpers.js';

let storicoState = {
    tab: 'compravendite', // 'compravendite' | 'dividendi'
    range: null,          // giorni, null = Tutto
    customFrom: null,
    customTo: null,
    fxMode: 'broker'      // 'broker' | 'fiscale'
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
            rows.push({ ...r, symbol: p.nome, id });
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

export function openStoricoModal(portfolio, dividendi, taxRegime = 'amministrato') {
    const overlay = document.getElementById('modal-storico');
    if (!overlay) return;

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
                </div>
                <div id="storico-filters" style="display:flex; flex-wrap:wrap; gap:6px; margin-bottom:10px;"></div>
                <div id="storico-custom-range" style="display:none; gap:8px; align-items:center; margin-bottom:12px;">
                    <input type="date" id="storico-from">
                    <span class="text-muted fs-sm">—</span>
                    <input type="date" id="storico-to">
                    <button id="storico-apply-range" class="btn btn-dark btn-sm">Applica</button>
                </div>
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

function renderStorico(portfolio, dividendi, taxRegime) {
    document.getElementById('storico-tab-cv').classList.toggle('active', storicoState.tab === 'compravendite');
    document.getElementById('storico-tab-div').classList.toggle('active', storicoState.tab === 'dividendi');
    document.getElementById('storico-tab-cv').onclick = () => { storicoState.tab = 'compravendite'; renderStorico(portfolio, dividendi, taxRegime); };
    document.getElementById('storico-tab-div').onclick = () => { storicoState.tab = 'dividendi'; renderStorico(portfolio, dividendi, taxRegime); };

    renderFilters(portfolio, dividendi, taxRegime);

    const fxWrap = document.getElementById('storico-fx-toggle-wrap');
    const table  = document.getElementById('storico-table');

    if (storicoState.tab === 'compravendite') {
        fxWrap.innerHTML = `<button id="storico-fx-toggle" class="btn-toggle">
            Cambio: ${storicoState.fxMode === 'broker' ? 'al momento della transazione' : 'fiscale (storico per lotto)'}
        </button>`;
        document.getElementById('storico-fx-toggle').onclick = () => {
            storicoState.fxMode = storicoState.fxMode === 'broker' ? 'fiscale' : 'broker';
            renderStorico(portfolio, dividendi, taxRegime);
        };

        const rows = buildCompravenditeRows(portfolio, taxRegime).filter(r => inRange(r.date));
        table.innerHTML = `
            <thead><tr>
                <th>Data</th><th>Tipo</th><th>Simbolo</th><th>Importo Totale</th>
                <th>Profitto %</th><th>Profitto €</th>
            </tr></thead>
            <tbody>
                ${rows.length ? rows.map(r => {
                    const pnlEur = storicoState.fxMode === 'broker' ? r.pnlEurBroker : r.pnlEurFiscal;
                    return `<tr>
                        <td>${r.date}</td>
                        <td class="${r.type === 'buy' ? 'tx-buy' : 'tx-sell'}">${r.type === 'buy' ? '🟢 Buy' : '🔴 Sell'}</td>
                        <td>${r.symbol}</td>
                        <td>${r.currency === 'USD'
                            ? `$ ${Calc.fmt(r.totalNative)} <span style="font-size:10px;color:var(--text-muted)">(€ ${Calc.fmt(r.totalEur)})</span>`
                            : `€ ${Calc.fmt(r.totalEur)}`}</td>
                        <td>${r.pnlPercent !== null ? `<span class="${r.pnlPercent >= 0 ? 'pos-gain' : 'neg-loss'}">${Calc.fmtSign(r.pnlPercent)}%</span>` : '—'}</td>
                        <td>${pnlEur !== null && pnlEur !== undefined ? `<span class="${pnlEur >= 0 ? 'pos-gain' : 'neg-loss'}">€ ${Calc.fmt(pnlEur)}</span>` : '—'}</td>
                    </tr>`;
                }).join('') : `<tr><td colspan="6" style="text-align:center;padding:20px;color:var(--text-muted);">Nessuna compravendita nel periodo selezionato</td></tr>`}
            </tbody>`;
    } else {
        fxWrap.innerHTML = '';
        const rows = buildDividendiRows(portfolio, dividendi).filter(r => inRange(r.date));
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
                `).join('') : `<tr><td colspan="5" style="text-align:center;padding:20px;color:var(--text-muted);">Nessun dividendo nel periodo selezionato</td></tr>`}
            </tbody>`;
    }
}