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
    const totaleEur = divs.filter(d => d.pagato).reduce((sum, d) => sum + d.importoEur, 0);
    const totaleNativo = divs.filter(d => d.pagato).reduce((sum, d) => sum + d.importoNativo, 0);

    wrap.innerHTML = `
        <div class="modal modal-wide" style="border-top: 3px solid var(--success);">
            <div class="modal-header">
                <h3>💰 Dividendi — ${p.nome}</h3>
                <button class="btn-x" id="div-close">✕</button>
            </div>
            <div class="modal-body">
                ${divs.length === 0 ? `
                    <div class="text-muted" style="text-align:center;padding:24px;">
                        Nessun dividendo ricevuto su questo titolo
                    </div>` : `
                <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;margin-bottom:16px;">
                    <div class="preview-box" style="text-align:center;">
                        <div class="text-muted fs-xs">Dividendi ricevuti</div>
                        <div class="fw-600">${divs.filter(d => d.pagato).length}</div>
                    </div>
                    <div class="preview-box" style="text-align:center;">
                        <div class="text-muted fs-xs">Totale ricevuto</div>
                        <div class="fw-600 pos-gain">€ ${Calc.fmt(totaleEur)}</div>
                        ${p.valuta === 'USD' ? `<div class="text-muted fs-xs">≈ ${s} ${Calc.fmt(totaleNativo)}</div>` : ''}
                    </div>
                    <div class="preview-box" style="text-align:center;">
                        <div class="text-muted fs-xs">Ultimo dividendo</div>
                        <div class="fw-600">${divs.find(d => d.pagato)?.payDate || '—'}</div>
                    </div>
                </div>
                <div class="table-wrapper" style="max-height:320px;overflow-y:auto;">
                    <table class="tx-table tx-table-compact">
                        <thead><tr>
                            <th>Ex-Date</th>
                            <th>Data Pagamento</th>
                            <th>Stato</th>
                            <th>Div/Azione</th>
                            <th>Quantità</th>
                            <th>Importo Totale</th>
                            <th>Importo (€)</th>
                        </tr></thead>
                        <tbody>
                            ${divs.map(d => `
                            <tr style="${!d.pagato ? 'opacity:0.5;' : ''}">
                                <td>${d.exDate}</td>
                                <td>${d.payDate}</td>
                                <td>${d.pagato
                                    ? '<span style="color:var(--success);font-weight:600;">✅ Pagato</span>'
                                    : '<span style="color:var(--warning);font-weight:600;">⏳ Stimato</span>'}</td>
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

    wrap.querySelector('#div-close').onclick  = close;
    wrap.querySelector('#div-close2').onclick = close;
}