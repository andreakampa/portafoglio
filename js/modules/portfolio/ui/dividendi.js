import { Calc } from '../calc.js';
import { lockScroll, unlockScroll } from './helpers.js';

export function openDividendiModal(id, portfolio, dividendi, annoPreselezionato = 'Tutti') {
    const isGlobal = id === '__ALL__';
    const p = isGlobal ? null : portfolio[id];

    const allDivs = isGlobal
        ? Object.entries(dividendi || {})
            .flatMap(([assetId, rows]) =>
                (rows || []).map(d => ({
                    ...d,
                    assetId,
                    nome: portfolio?.[assetId]?.nome || assetId,
                    ticker: portfolio?.[assetId]?.ticker || assetId,
                    valutaTitolo: portfolio?.[assetId]?.valuta || 'EUR'
                }))
            )
        : (dividendi?.[id] || []).map(d => ({
            ...d,
            assetId: id,
            nome: p?.nome || id,
            ticker: p?.ticker || id,
            valutaTitolo: p?.valuta || 'EUR'
        }));

    const anni = [...new Set(
        allDivs
            .filter(d => isGlobal ? d.pagato : true)
            .map(d => (d.payDate || d.exDate || '').slice(0, 4))
            .filter(Boolean)
    )].sort((a, b) => b.localeCompare(a));

    const annoSelezionato = annoPreselezionato;

    const divs = allDivs
        .filter(d => isGlobal ? d.pagato : true)
        .filter(d => {
            if (annoSelezionato === 'Tutti') return true;
            const dataRef = d.payDate || d.exDate || '';
            return dataRef.startsWith(annoSelezionato);
        })
        .sort((a, b) => {
            const da = b.payDate || b.exDate || '';
            const db = a.payDate || a.exDate || '';
            return da.localeCompare(db);
        });

    document.getElementById('modal-dividendi')?.remove();

    const wrap = document.createElement('div');
    wrap.id = 'modal-dividendi';
    wrap.className = 'overlay visible';
    document.body.appendChild(wrap);
    lockScroll();

    const close = () => {
        wrap.remove();
        unlockScroll();
    };

    const s = isGlobal ? '€' : (p?.valuta === 'USD' ? '$' : '€');

    const ricevuti = divs.filter(d => d.pagato);
    const maturati = divs.filter(d => d.maturato);

    const totaleEur = ricevuti.reduce((sum, d) => sum + Number(d.importoEur || 0), 0);
    const totaleNativo = isGlobal ? 0 : ricevuti.reduce((sum, d) => sum + Number(d.importoNativo || 0), 0);

    const ultimoPagato = ricevuti[0]?.payDate || '—';
    const ultimoMaturato = maturati[0]?.exDate || '—';

    const filtroHtml = anni.length > 1 ? `
        <div style="display:flex;justify-content:space-between;align-items:center;gap:12px;margin:0 0 14px;flex-wrap:wrap;">
            <div class="text-muted fs-xs">Filtra per anno</div>
            <select id="dividendi-anno-filter" class="input" style="min-width:140px;">
                <option value="Tutti" ${annoSelezionato === 'Tutti' ? 'selected' : ''}>Tutti</option>
                ${anni.map(a => `<option value="${a}" ${annoSelezionato === a ? 'selected' : ''}>${a}</option>`).join('')}
            </select>
        </div>
    ` : '';

    wrap.innerHTML = `
        <div class="modal modal-wide" style="border-top: 3px solid var(--success);">
            <div class="modal-header">
                <h3>💰 ${isGlobal ? 'Dividendi del portafoglio' : `Dividendi — ${p.nome}`}</h3>
                <button class="btn-x" id="div-close">✕</button>
            </div>
            <div class="modal-body">
                ${divs.length === 0 ? `
                    <div class="text-muted" style="text-align:center;padding:24px;">
                        ${isGlobal ? 'Nessun dividendo pagato registrato nel portafoglio per questo filtro' : 'Nessun dividendo registrato su questo titolo'}
                    </div>` : `
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;">
                    <div class="preview-box" style="text-align:center;">
                        <div class="text-muted fs-xs">Dividendi maturati</div>
                        <div class="fw-600">${maturati.length}</div>
                        <div class="text-muted fs-xs">ultimo ex-date: ${ultimoMaturato}</div>
                    </div>
                    <div class="preview-box" style="text-align:center;">
                        <div class="text-muted fs-xs">Totale pagato</div>
                        <div class="fw-600 pos-gain">€ ${Calc.fmt(totaleEur)}</div>
                        ${!isGlobal && p?.valuta === 'USD' ? `<div class="text-muted fs-xs">≈ ${s} ${Calc.fmt(totaleNativo)}</div>` : ''}
                    </div>
                    <div class="preview-box" style="text-align:center;">
                        <div class="text-muted fs-xs">Ultimo pagamento</div>
                        <div class="fw-600">${ultimoPagato}</div>
                    </div>
                </div>

                ${filtroHtml}

                <div class="table-wrapper" style="max-height:320px;overflow-y:auto;">
                    <table class="tx-table tx-table-compact">
                        <thead>
                            <tr>
                                ${isGlobal ? '<th>Titolo</th>' : ''}
                                <th>Ex-Date</th>
                                <th>Pagamento</th>
                                ${!isGlobal ? '<th>Stato</th>' : ''}
                                <th>Div/Azione</th>
                                <th>Quantità</th>
                                <th>Importo Totale</th>
                                <th>Importo (€)</th>
                            </tr>
                        </thead>
                        <tbody>
                            ${divs.map(d => {
                                const rowSymbol = isGlobal
                                    ? (d.valutaTitolo === 'USD' ? '$' : '€')
                                    : s;

                                return `
                                <tr style="${!isGlobal && !d.pagato ? 'opacity:0.78;' : ''}">
                                    ${isGlobal ? `<td><b>${d.nome}</b><div class="text-muted fs-xs">${d.ticker}</div></td>` : ''}
                                    <td>${d.exDate || '—'}</td>
                                    <td>${d.payDate || '—'}</td>
                                    ${!isGlobal ? `<td>${
                                        d.pagato
                                            ? '<span style="color:var(--success);font-weight:600;">✅ Pagato</span>'
                                            : d.maturato
                                                ? '<span style="color:var(--warning);font-weight:600;">🟠 Maturato</span>'
                                                : '<span style="color:var(--text-muted);font-weight:600;">⏳ Atteso</span>'
                                    }</td>` : ''}
                                    <td>${rowSymbol} ${Calc.fmt(d.dividendoPerAzione, 4)}</td>
                                    <td>${Calc.fmt(d.qta, 4)}</td>
                                    <td><b>${rowSymbol} ${Calc.fmt(d.importoNativo)}</b></td>
                                    <td>${d.importoEur != null ? `€ ${Calc.fmt(d.importoEur)}` : '—'}</td>
                                </tr>`;
                            }).join('')}
                        </tbody>
                    </table>
                </div>`}
                <button id="div-close2" class="btn btn-ghost btn-full" style="margin-top:16px;">Chiudi</button>
            </div>
        </div>`;

    wrap.querySelector('#div-close').onclick = close;
    wrap.querySelector('#div-close2').onclick = close;

    wrap.querySelector('#dividendi-anno-filter')?.addEventListener('change', e => {
        openDividendiModal(id, portfolio, dividendi, e.target.value);
    });
}