import { Calc } from '../calc.js';
import { Exchange } from '../../../api/exchange.js';
import { Toast } from '../../../core/toast.js';
import { lockScroll, unlockScroll } from './helpers.js';
import { openPacModal, generaPacTransazioni } from './pac.js';

export function openHistoryModal(id, portfolio, onSave, currency = 'EUR') {
    const p = portfolio[id];
    const overlay = document.getElementById('modal-history');

    overlay.innerHTML = `
        <div class="modal modal-wide">
            <div class="modal-header">
                <h3>📜 Storico — ${p.nome}${p.valuta === 'USD' ? ` <button id="hist-fix-valuta" title="Correggi valuta a EUR" style="margin-left:8px;padding:2px 8px;font-size:11px;font-weight:700;background:var(--warning);color:#fff;border:none;border-radius:4px;cursor:pointer;">$ → €</button>` : ''} <button id="hist-pac-btn" title="Gestisci PAC" style="margin-left:6px;padding:2px 8px;font-size:11px;font-weight:600;background:var(--accent-dim);color:var(--accent);border:1px solid var(--accent);border-radius:4px;cursor:pointer;">↻ PAC</button></h3>
                <button class="btn-x" id="hist-close">✕</button>
            </div>
            <div class="modal-body">
                <div class="preview-box" id="hist-summary" style="margin-bottom:14px;"></div>
                <div class="table-wrapper">
                    <table class="tx-table tx-table-compact">
                        <thead><tr>
                            <th>Data</th><th>Tipo</th><th>Q.tà</th>
                            <th>Prezzo</th><th>Comm.</th><th>Totale</th>
                            ${portfolio[id]?.valuta === 'USD' ? '<th>Tasso €/$</th>' : ''}
                            <th>PMC</th><th>P&L Lordo</th><th>P&L Netto</th><th></th>
                        </tr></thead>
                        <tbody id="hist-tbody"></tbody>
                    </table>
                </div>
            </div>
        </div>`;
    overlay.classList.add('visible');
    lockScroll();
    document.getElementById('hist-close').onclick = () => {
        overlay.classList.remove('visible');
        unlockScroll();
    };

    document.getElementById('hist-pac-btn')?.addEventListener('click', () => {
        openPacModal(id, portfolio, async () => {
            await onSave();
            renderHistoryContent(id, portfolio, onSave, currency);
        });
    });

    document.getElementById('hist-fix-valuta')?.addEventListener('click', async () => {
        if (!confirm(`Cambiare la valuta di ${p.nome} da USD a EUR?\nAttenzione: i tassi di cambio salvati sulle transazioni verranno rimossi.`)) return;
        p.valuta = 'EUR';
        p.transactions = (p.transactions || []).map(tx => {
            const { exchangeRate, ...rest } = tx;
            return rest;
        });
        await onSave();
        overlay.classList.remove('visible');
        unlockScroll();
        Toast.show(`${p.nome} ora è in EUR`, 'ok');
    });

    renderHistoryContent(id, portfolio, onSave, currency);
}

function renderHistoryContent(id, portfolio, onSave, currency = 'EUR') {
    const p = portfolio[id];
    const { qta, pmc, pmcEur, realizedPnL, totalComm } = Calc.positionSync(p);
    const isUSD = p.valuta === 'USD';
    const s = isUSD ? '$' : '€';
    const rate = Exchange.rate || 1;
    const txsSorted = (p.transactions || []).slice().sort((a, b) => a.date.localeCompare(b.date));

    const pmcEurHint = isUSD && pmcEur > 0
        ? ` <span style="font-size:11px;color:var(--text-muted)">(≈ € ${Calc.fmt(pmcEur)})</span>` : '';
    const pnlEurHint = isUSD && realizedPnL !== 0
        ? ` <span style="font-size:11px;color:var(--text-muted)">(≈ € ${Calc.fmt(realizedPnL)})</span>` : '';

    document.getElementById('hist-summary').innerHTML =
        `Q.tà: <b>${Calc.fmt(qta, 4)}</b> &nbsp;|&nbsp;
         PMC: <b>${s} ${Calc.fmt(pmc)}</b>${pmcEurHint} &nbsp;|&nbsp;
         P&L Realizzato: <b class="${realizedPnL >= 0 ? 'pos-gain' : 'neg-loss'}">${s} ${Calc.fmt(realizedPnL)}</b>${pnlEurHint} &nbsp;|&nbsp;
         Commissioni tot.: <b>€ ${Calc.fmt(totalComm)}</b>`;

    const tbody = document.getElementById('hist-tbody');
    if (!txsSorted.length) {
        tbody.innerHTML = `<tr><td colspan="9" style="text-align:center;padding:20px;color:var(--text-muted);">Nessuna transazione</td></tr>`;
        return;
    }

    let rQta = 0, rPmc = 0, rCostEur = 0;
    tbody.innerHTML = '';

    txsSorted.forEach((tx, i) => {
        const q = +tx.qty, pr = +tx.price, c = +(tx.commission || 0);
        const txRate = tx.exchangeRate
            ? parseFloat(tx.exchangeRate)
            : Exchange._memoryCache.get(tx.date)?.rate || rate;

        let tradePnL = null;
        let tradePnLEur = null;

        if (tx.type === 'buy') {
            const newCost = (rQta * rPmc) + (q * pr) + c;
            rPmc = (rQta + q) > 0 ? newCost / (rQta + q) : 0;
            rQta += q;
            if (isUSD) {
                rCostEur += (q * pr + c) / txRate;
            } else {
                rCostEur += (q * pr + c);
            }
        } else {
            tradePnL = Calc.round((pr - rPmc) * q - c);
            if (isUSD) {
                const ricavoEur = (pr * q - c) / txRate;
                const rPmcEur = rQta > 0 ? rCostEur / rQta : 0;
                tradePnLEur = Calc.round(ricavoEur - (rPmcEur * q));
                if (rQta > 0) rCostEur -= (rCostEur / rQta) * q;
            } else {
                tradePnLEur = tradePnL;
            }
            rQta -= q;
            if (rQta < 0.00001) { rQta = 0; rPmc = 0; rCostEur = 0; }
        }
        const totale = tx.type === 'buy' ? q * pr + c : q * pr - c;
        const taxPct  = p.tipoAsset === 'bond' ? 0.125 : p.tipoAsset === 'crypto' ? 0.33 : 0.26;
        const pnlTax  = tradePnLEur !== null && tradePnLEur > 0 ? tradePnLEur * taxPct : 0;
        const pnlNetto = tradePnLEur !== null ? tradePnLEur - pnlTax : null;

        const tr = document.createElement('tr');
        tr.innerHTML = `
            <td>${tx.date}${tx.source === 'pac' ? ' <span style="display:inline-flex;align-items:center;gap:2px;margin-left:5px;background:var(--accent-dim);color:var(--accent);font-size:10px;font-weight:600;padding:1px 5px;border-radius:4px;">↻ PAC</span>' : ''}${(() => {
    if (!isUSD) return '';
    const isRecent = !Exchange._memoryCache.get(tx.date)?.rate;
    const hasManual = tx.exchangeRate > 0;
    if (!hasManual && isRecent) return ' <span title="Tasso BCE non disponibile per questa data — considera di inserire il tasso manualmente" style="cursor:help;color:var(--warning);">⚠️</span>';
    return '';
})()}</td>
            <td class="${tx.type === 'buy' ? 'tx-buy' : 'tx-sell'}">${tx.type === 'buy' ? '🟢 Acq.' : '🔴 Vend.'}</td>
            <td>${Calc.fmt(q, 4)}</td>
            <td>${s} ${Calc.fmt(pr)}</td>
            <td>${(tx.commissionCurrency === 'USD' ? '$ ' : '€ ')}${Calc.fmt(c)}</td>
            <td>${s} ${Calc.fmt(totale)}</td>
            ${isUSD ? `<td style="font-size:11px;color:var(--text-muted);">${tx.exchangeRate ? Calc.fmt(parseFloat(tx.exchangeRate), 4) : (Exchange._memoryCache.get(tx.date)?.rate ? Calc.fmt(Exchange._memoryCache.get(tx.date).rate, 4) : '—')}</td>` : ''}
            <td>${s} ${Calc.fmt(rPmc)}</td>
            <td>${tradePnL !== null
                ? `<span class="${tradePnL >= 0 ? 'pos-gain' : 'neg-loss'}">${s} ${Calc.fmt(tradePnL)}</span>
                   ${isUSD && tradePnLEur !== null
                       ? `<br><span style="font-size:10px;color:var(--text-muted)">€ ${Calc.fmt(tradePnLEur)}</span>`
                       : ''}`
                : '—'}</td>
            <td>${pnlNetto !== null
                ? `<span class="${pnlNetto >= 0 ? 'pos-gain' : 'neg-loss'}">€ ${Calc.fmt(pnlNetto)}</span>
                   ${pnlTax > 0 ? `<br><span style="font-size:10px;color:var(--text-muted)">tasse: € ${Calc.fmt(pnlTax)}</span>` : ''}`
                : '—'}</td>
            <td style="display:flex; gap:4px;">
                <button class="btn btn-dark btn-sm btn-icon btn-edit-tx" data-idx="${i}" title="Modifica">✏️</button>
                <button class="btn-del-tx" data-idx="${i}" title="Elimina">✕</button>
            </td>`;
        tbody.appendChild(tr);
    });

    tbody.onclick = async e => {
        const delBtn  = e.target.closest('.btn-del-tx');
        const editBtn = e.target.closest('.btn-edit-tx');
        if (delBtn) {
            const origTx = txsSorted[+delBtn.dataset.idx];
            if (!confirm(`Eliminare la transazione del ${origTx.date}?`)) return;
            const realIdx = portfolio[id].transactions.findIndex(
                t => t.date === origTx.date && t.qty === origTx.qty &&
                     t.price === origTx.price && t.type === origTx.type
            );
            if (realIdx > -1) {
                const isPac = portfolio[id].transactions[realIdx].source === 'pac';
                portfolio[id].transactions.splice(realIdx, 1);
                if (isPac && portfolio[id].pac) {
                    if (!portfolio[id].pac.skipDates) portfolio[id].pac.skipDates = [];
                    portfolio[id].pac.skipDates.push(origTx.date);
                }
            }
            await onSave();
            renderHistoryContent(id, portfolio, onSave, currency);
            Toast.show('Transazione rimossa', 'ok');
        }
        if (editBtn) {
            const origTx = txsSorted[+editBtn.dataset.idx];
            openEditModal(id, origTx, portfolio, onSave, currency);
        }
    };
}

function openEditModal(id, origTx, portfolio, onSave, currency) {
    document.getElementById('modal-edit-tx')?.remove();

    const isUSD = portfolio[id].valuta === 'USD';

    const wrap = document.createElement('div');
    wrap.id = 'modal-edit-tx';
    wrap.className = 'overlay visible';
    wrap.innerHTML = `
        <div class="modal" style="border-top: 3px solid var(--warning);">
            <div class="modal-header">
                <h3>✏️ Modifica Transazione — ${portfolio[id].nome}</h3>
                <button class="btn-x" id="edit-tx-close">✕</button>
            </div>
            <div class="modal-body">
                <div class="form-grid-2">
                    <div>
                        <span class="modal-label">Data</span>
                        <input type="date" id="edit-tx-data" value="${origTx.date}">
                    </div>
                    <div>
                        <span class="modal-label">Tipo</span>
                        <select id="edit-tx-tipo">
                            <option value="buy"  ${origTx.type === 'buy'  ? 'selected' : ''}>🟢 Acquisto</option>
                            <option value="sell" ${origTx.type === 'sell' ? 'selected' : ''}>🔴 Vendita</option>
                        </select>
                    </div>
                    <div>
                        <span class="modal-label">Quantità</span>
                        <input type="number" id="edit-tx-qta" step="any" value="${origTx.qty}">
                    </div>
                    <div>
                        <span class="modal-label">Prezzo</span>
                        <input type="number" id="edit-tx-prezzo" step="any" value="${origTx.price}">
                    </div>
                    <div>
                        <span class="modal-label">Commissione</span>
                        <div style="display:flex; gap:6px;">
                            <input type="number" id="edit-tx-comm" step="any" value="${origTx.commission || 0}" style="flex:1;">
                            <select id="edit-tx-comm-currency" style="width:80px;">
                                <option value="EUR" ${(origTx.commissionCurrency || 'EUR') === 'EUR' ? 'selected' : ''}>€ EUR</option>
                                <option value="USD" ${origTx.commissionCurrency === 'USD' ? 'selected' : ''}>$ USD</option>
                            </select>
                        </div>
                    </div>
                    ${isUSD ? `
                    <div>
                        <span class="modal-label">
                            Tasso EUR/USD
                            <span class="text-muted fs-xs">(modifica se la banca differisce)</span>
                        </span>
                        <div style="display:flex; gap:6px; align-items:center;">
                            <input type="number" id="edit-tx-fx" step="any" placeholder="caricamento...">
                            <button type="button" id="edit-tx-fx-reset"
                                title="Ripristina tasso BCE automatico"
                                style="display:none; padding:4px 10px; font-size:11px;
                                       border:1px solid var(--border); border-radius:4px;
                                       background:none; cursor:pointer; white-space:nowrap;
                                       color:var(--text-muted);">↺ Auto</button>
                        </div>
                        <span id="edit-tx-fx-hint" style="font-size:10px; color:var(--text-muted); margin-top:2px; display:block;"></span>
                    </div>` : ''}
                </div>
                <button id="edit-tx-save" class="btn btn-warning btn-full" style="margin-top:16px;">💾 Salva Modifiche</button>
                <button id="edit-tx-cancel" class="btn btn-ghost btn-full" style="margin-top:8px;">Annulla</button>
            </div>
        </div>`;
    document.body.appendChild(wrap);
    lockScroll();

    const close = () => { wrap.remove(); unlockScroll(); };
    document.getElementById('edit-tx-close').onclick  = close;
    document.getElementById('edit-tx-cancel').onclick = close;

    if (isUSD) {
        const fxField = document.getElementById('edit-tx-fx');
        const fxReset = document.getElementById('edit-tx-fx-reset');
        const fxHint  = document.getElementById('edit-tx-fx-hint');
        let autoRate  = null;

        const setAutoMode = (rate) => {
            autoRate = rate;
            fxField.value = rate.toFixed(4);
            fxField.style.color = 'var(--text-muted)';
            fxHint.textContent  = 'Tasso BCE storico — modifica se la banca differisce';
            fxReset.style.display = 'none';
        };

        const setManualMode = (value, hint) => {
            fxField.value = value;
            fxField.style.color = 'var(--warning)';
            fxHint.textContent  = hint || 'Tasso modificato manualmente';
            fxReset.style.display = autoRate ? '' : 'none';
        };

        if (origTx.exchangeRate) {
            fxField.value = parseFloat(origTx.exchangeRate).toFixed(4);
            fxField.style.color = 'var(--warning)';
            fxHint.textContent = 'Tasso modificato manualmente';
            fxReset.style.display = 'none';
            autoRate = null;

            Exchange._fetchHistoricRate(origTx.date)
                .then(rate => {
                    if (!rate || rate <= 0) return;
                    autoRate = rate;
                    fxHint.textContent = `Tasso manuale salvato · BCE per questa data: ${rate.toFixed(4)}`;
                    fxReset.style.display = '';
                })
                .catch(() => {});
        } else {
            Exchange._fetchHistoricRate(origTx.date)
                .then(rate => {
                    if (!rate || rate <= 0) throw new Error();
                    Exchange._memoryCache.set(origTx.date, { rate, ts: Date.now() });
                    Exchange._saveFxCache();
                    autoRate = rate;
                    setAutoMode(rate);
                })
                .catch(() => {
                    fxHint.textContent = 'Tasso BCE non trovato per questa data';
                    fxField.placeholder = 'non disponibile';
                });
        }

        document.getElementById('edit-tx-data').addEventListener('change', e => {
            fxField.value = '';
            fxField.placeholder = 'caricamento...';
            fxField.style.color = '';
            fxHint.textContent = '';
            fxReset.style.display = 'none';
            autoRate = null;

            Exchange._fetchHistoricRate(e.target.value)
                .then(rate => {
                    if (!rate || rate <= 0) throw new Error();
                    Exchange._memoryCache.set(e.target.value, { rate, ts: Date.now() });
                    Exchange._saveFxCache();
                    setAutoMode(rate);
                })
                .catch(() => {
                    fxField.placeholder = 'non disponibile';
                    fxHint.textContent = 'Tasso BCE non trovato per questa data';
                });
        });

        fxField.addEventListener('input', () => {
            setManualMode(fxField.value, 'Tasso modificato manualmente');
        });

        fxReset.addEventListener('click', () => {
            if (autoRate) setAutoMode(autoRate);
        });
    }

    document.getElementById('edit-tx-save').onclick = async () => {
        const newDate = document.getElementById('edit-tx-data').value;
        const newType = document.getElementById('edit-tx-tipo').value;
        const newQty  = parseFloat(document.getElementById('edit-tx-qta').value);
        const newPr   = parseFloat(document.getElementById('edit-tx-prezzo').value);
        const newComm = parseFloat(document.getElementById('edit-tx-comm').value) || 0;

        if (!newDate || isNaN(newQty) || newQty <= 0 || isNaN(newPr) || newPr <= 0) {
            Toast.show('Compila tutti i campi correttamente', 'err');
            return;
        }

       const fxInput  = document.getElementById('edit-tx-fx');
        const fxHint   = document.getElementById('edit-tx-fx-hint');
        const fxVal    = fxInput ? parseFloat(fxInput.value) : NaN;
        const isManual = fxVal > 0 && fxInput !== null;

        const realIdx = portfolio[id].transactions.findIndex(
            t => t.date === origTx.date && t.qty === origTx.qty &&
                 t.price === origTx.price && t.type === origTx.type
        );

        const editCommCurrency = document.getElementById('edit-tx-comm-currency')?.value || 'EUR';
        if (realIdx > -1) {
            const isPac = origTx.source === 'pac';
            portfolio[id].transactions[realIdx] = {
                date: newDate, type: newType,
                qty: newQty, price: newPr, commission: newComm,
                ...(isPac ? { source: 'pac' } : {}),
                ...(editCommCurrency !== 'EUR' ? { commissionCurrency: editCommCurrency } : {}),
                ...(isManual && fxVal > 0 ? { exchangeRate: fxVal } : {})
            };
        }

        close();
        await onSave();
        renderHistoryContent(id, portfolio, onSave, currency);
        Toast.show('Transazione aggiornata', 'ok');
    };
}