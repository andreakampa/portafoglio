import { Calc } from '../calc.js';
import { lockScroll, unlockScroll } from './helpers.js';

export function openDividendiModal(id, portfolio, dividendi) {
    const p = portfolio[id];
    const divs = (dividendi[id] || []).sort((a, b) => b.exDate.localeCompare(a.exDate));

    document.getElementById('modal-dividendi')?.remove();

    const wrap = document.createElement('div');
    wrap.id = 'modal-dividendi';
    wrap.className = 'overlay visible';
    document.body.appendChild(wrap);
    lockScroll();

    const close = () => { wrap.remove(); unlockScroll(); };

    const s = p.valuta === 'USD' ? '$' : '€';

    const ricevuti = divs.filter(d => d.pagato);
    const maturati = divs.filter(d => d.maturato);

    const totaleEur = ricevuti.reduce((sum, d) => sum + d.importoEur, 0);
    const totaleNativo = ricevuti.reduce((sum, d) => sum + d.importoNativo, 0);

    const ultimoPagato = ricevuti[0]?.payDate || '—';
    const ultimoMaturato = maturati[0]?.exDate || '—';

    wrap.innerHTML = `
        <div class="modal modal-wide" style="border-top: 3px solid var(--success);">
            <div class="modal-header">
                <h3>💰 Dividendi — ${p.nome}</h3>
                <button class="btn-x" id="div-close">✕</button>
            </div>
            <div class="modal-body">
                ${divs.length === 0 ? `
                    <div class="text-muted" style="text-align:center;padding:24px;">
                        Nessun dividendo registrato su questo titolo
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
                        ${p.valuta === 'USD' ? `<div class="text-muted fs-xs">≈ ${s} ${Calc.fmt(totaleNativo)}</div>` : ''}
                    </div>
                    <div class="preview-box" style="text-align:center;">
                        <div class="text-muted fs-xs">Ultimo pagamento</div>
                        <div class="fw-600">${ultimoPagato}</div>
                    </div>
                </div>
                <div class="table-wrapper" style="max-height:320px;overflow-y:auto;">
                    <table class="tx-table tx-table-compact">
                        <thead><tr>
                            <th>Ex-Date</th>
                            <th>Pagamento stimato</th>
                            <th>Stato</th>
                            <th>Div/Azione</th>
                            <th>Quantità</th>
                            <th>Importo Totale</th>
                            <th>Importo (€)</th>
                        </tr></thead>
                        <tbody>
                            ${divs.map(d => `
                            <tr style="${!d.pagato ? 'opacity:0.78;' : ''}">
                                <td>${d.exDate}</td>
                                <td>${d.payDate || '—'}</td>
                                <td>${
    d.pagato
        ? '<span style="color:var(--success);font-weight:600;">✅ Pagato</span>'
        : d.maturato
            ? '<span style="color:var(--warning);font-weight:600;">🟠 Maturato</span>'
            : '<span style="color:var(--text-muted);font-weight:600;">⏳ Atteso</span>'
}</td>
                                <td>${s} ${Calc.fmt(d.dividendoPerAzione, 4)}</td>
                                <td>${Calc.fmt(d.qta, 4)}</td>
                                <td><b>${s} ${Calc.fmt(d.importoNativo)}</b></td>
                                <td>${p.valuta === 'USD' ? `€ ${Calc.fmt(d.importoEur)}` : '—'}</td>
                            </tr>`).join('')}
                        </tbody>
                    </table>
                </div>`}
                <button id="div-close2" class="btn btn-ghost btn-full" style="margin-top:16px;">Chiudi</button>
            </div>
        </div>`;

    wrap.querySelector('#div-close').onclick = close;
    wrap.querySelector('#div-close2').onclick = close;
}