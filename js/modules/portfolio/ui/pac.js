import { Calc } from '../calc.js';
import { Exchange } from '../../../api/exchange.js';
import { Toast } from '../../../core/toast.js';
import { lockScroll, unlockScroll } from './helpers.js';

const PAC_SOURCE = 'pac';
const PROXY = 'https://finance-proxy.andrea-kampa.workers.dev';

export function openPacModal(id, portfolio, onSave) {
    const p = portfolio[id];
    const pac = p.pac || null;

    document.getElementById('modal-pac')?.remove();

    const wrap = document.createElement('div');
    wrap.id = 'modal-pac';
    wrap.className = 'overlay visible';
    document.body.appendChild(wrap);
    lockScroll();

    const close = () => { wrap.remove(); unlockScroll(); };

    if (pac) {
        renderPacDashboard(wrap, id, portfolio, pac, close, onSave);
    } else {
        renderPacForm(wrap, id, portfolio, null, close, onSave);
    }
}

function renderPacDashboard(wrap, id, portfolio, pac, close, onSave) {
    const p = portfolio[id];
    const rata = calcolaRata(pac.importoMensile, pac.cadenza);
    const oggi = new Date().toISOString().slice(0, 10);

    const txPac = (p.transactions || [])
        .filter(tx => tx.source === PAC_SOURCE)
        .sort((a, b) => b.date.localeCompare(a.date));

    const nRate = txPac.length;
    const totVersato = txPac.reduce((s, tx) => s + (tx.qty * tx.price), 0);
    const totComm = txPac.reduce((s, tx) => s + (tx.commission || 0), 0);
    const pmcPac = nRate > 0
        ? txPac.reduce((s, tx) => s + tx.price, 0) / nRate
        : 0;

    const prossima = calcolaDateFuture(pac.startDate, pac.cadenza, 9999, null, true)
        .find(d => d > oggi) || '—';

    const s = (p.valuta || 'EUR') === 'USD' ? '$' : '€';

    wrap.innerHTML = `
        <div class="modal modal-wide" style="border-top: 3px solid var(--accent);">
            <div class="modal-header">
                <h3>↻ PAC — ${p.nome}</h3>
                <button class="btn-x" id="pac-close">✕</button>
            </div>
            <div class="modal-body">

                <div style="display:grid; grid-template-columns: repeat(3, 1fr); gap:10px; margin-bottom:16px;">
                    <div class="preview-box" style="text-align:center;">
                        <div class="text-muted fs-xs">Data inizio</div>
                        <div class="fw-600">${pac.startDate}</div>
                    </div>
                    <div class="preview-box" style="text-align:center;">
                        <div class="text-muted fs-xs">Prossima rata</div>
                        <div class="fw-600">${prossima}</div>
                        <div class="text-muted fs-xs">${s} ${Calc.fmt(rata)}</div>
                    </div>
                    <div class="preview-box" style="text-align:center;">
                        <div class="text-muted fs-xs">Cadenza</div>
                        <div class="fw-600">${pac.cadenza}</div>
                        <div class="text-muted fs-xs">${s} ${Calc.fmt(pac.importoMensile)}/mese</div>
                    </div>
                    <div class="preview-box" style="text-align:center;">
                        <div class="text-muted fs-xs">Rate completate</div>
                        <div class="fw-600">${nRate}</div>
                    </div>
                    <div class="preview-box" style="text-align:center;">
                        <div class="text-muted fs-xs">Totale versato</div>
                        <div class="fw-600">${s} ${Calc.fmt(totVersato)}</div>
                    </div>
                    <div class="preview-box" style="text-align:center;">
                        <div class="text-muted fs-xs">Commissioni PAC</div>
                        <div class="fw-600 text-warning">€ ${Calc.fmt(totComm)}</div>
                    </div>
                </div>

                ${nRate > 0 ? `
                <div style="margin-bottom:8px; font-size:12px; color:var(--text-muted); font-weight:600; text-transform:uppercase; letter-spacing:.05em;">Rate eseguite</div>
                <div class="table-wrapper" style="max-height:280px; overflow-y:auto;">
                    <table class="tx-table tx-table-compact">
                        <thead><tr>
                            <th>#</th>
                            <th>Data</th>
                            <th>Azioni</th>
                            <th>Prezzo</th>
                            <th>Importo</th>
                            <th>Comm.</th>
                        </tr></thead>
                        <tbody>
                            ${txPac.map((tx, i) => `
                            <tr>
                                <td class="text-muted">${nRate - i}</td>
                                <td>${tx.date}</td>
                                <td>${Calc.fmt(tx.qty, 4)}</td>
                                <td>${s} ${Calc.fmt(tx.price)}</td>
                                <td><b>${s} ${Calc.fmt(tx.qty * tx.price)}</b></td>
                                <td>€ ${Calc.fmt(tx.commission || 0)}</td>
                                <td><button class="btn-del-pac" data-date="${tx.date}" title="Elimina rata" style="background:none;border:none;cursor:pointer;color:var(--danger);font-size:13px;">✕</button></td>
                            </tr>`).join('')}
                        </tbody>
                    </table>
                </div>` : `<div class="text-muted" style="text-align:center; padding:16px;">Nessuna rata ancora generata</div>`}

                <div style="display:flex; gap:8px; margin-top:16px;">
                    <button id="pac-edit" class="btn btn-accent" style="flex:1;">✎ Modifica configurazione</button>
                    <button id="pac-stop" class="btn btn-danger" style="flex:1;">✕ Interrompi PAC</button>
                </div>
                <button id="pac-cancel" class="btn btn-ghost btn-full" style="margin-top:8px;">Chiudi</button>
            </div>
        </div>`;

    wrap.querySelector('#pac-close').onclick  = close;
    wrap.querySelector('#pac-cancel').onclick = close;

    wrap.querySelectorAll('.btn-del-pac').forEach(btn => {
        btn.addEventListener('click', async () => {
            const date = btn.dataset.date;
            if (!confirm(`Eliminare la rata PAC del ${date}? Non verrà rigenerata automaticamente.`)) return;
            
            // Aggiungi la data alle eccezioni
            if (!portfolio[id].pac.skipDates) portfolio[id].pac.skipDates = [];
            portfolio[id].pac.skipDates.push(date);
            
            // Rimuovi la transazione
            portfolio[id].transactions = portfolio[id].transactions.filter(
                tx => !(tx.source === PAC_SOURCE && tx.date === date)
            );
            
            await onSave();
            wrap.remove();
            unlockScroll();
            openPacModal(id, portfolio, onSave);
        });
    });

    wrap.querySelector('#pac-edit').onclick = () => {
        wrap.innerHTML = '';
        renderPacForm(wrap, id, portfolio, pac, close, onSave);
    };

    wrap.querySelector('#pac-stop').onclick = async () => {
        if (!confirm('Interrompere il PAC? Le transazioni già generate verranno mantenute.')) return;
        delete portfolio[id].pac;
        close();
        await onSave();
        Toast.show('PAC interrotto', 'ok');
    };
}

function renderPacForm(wrap, id, portfolio, existing, close, onSave) {
    const p = portfolio[id];

    wrap.innerHTML = `
        <div class="modal" style="border-top: 3px solid var(--accent);">
            <div class="modal-header">
                <h3>${existing ? '✎ Modifica PAC' : '↻ Nuovo PAC'} — ${p.nome}</h3>
                <button class="btn-x" id="pac-close">✕</button>
            </div>
            <div class="modal-body">
                <div class="form-grid-2">
                    <div>
                        <span class="modal-label">Importo mensile (€)</span>
                        <input type="number" id="pac-importo" step="any" placeholder="120" value="${existing?.importoMensile || ''}">
                    </div>
                    <div>
                        <span class="modal-label">Cadenza</span>
                        <select id="pac-cadenza">
                            <option value="settimanale"   ${existing?.cadenza === 'settimanale'   ? 'selected' : ''}>Settimanale (÷ 4)</option>
                            <option value="bisettimanale" ${existing?.cadenza === 'bisettimanale' ? 'selected' : ''}>Bisettimanale (÷ 2)</option>
                            <option value="mensile"       ${existing?.cadenza === 'mensile'       ? 'selected' : ''}>Mensile (÷ 1)</option>
                        </select>
                    </div>
                    <div>
                        <span class="modal-label">Data primo acquisto</span>
                        <input type="date" id="pac-start" value="${existing?.startDate || ''}">
                    </div>
                    <div>
                        <span class="modal-label">Data fine (opzionale)</span>
                        <input type="date" id="pac-end" value="${existing?.endDate || ''}">
                    </div>
                    <div>
                        <span class="modal-label">Commissione per rata (€)</span>
                        <input type="number" id="pac-comm" step="any" placeholder="0" value="${existing?.commissione ?? 0}">
                    </div>
                </div>
                <div id="pac-preview" class="preview-box" style="margin-top:14px; display:none;"></div>
                <button id="pac-save" class="btn btn-accent btn-full" style="margin-top:16px;">
                    ${existing ? '↻ Aggiorna PAC' : '↻ Attiva PAC'}
                </button>
                <button id="pac-cancel" class="btn btn-ghost btn-full" style="margin-top:8px;">Annulla</button>
            </div>
        </div>`;

    wrap.querySelector('#pac-close').onclick  = close;
    wrap.querySelector('#pac-cancel').onclick = close;

    const updatePreview = () => {
        const importo = parseFloat(document.getElementById('pac-importo').value);
        const cadenza = document.getElementById('pac-cadenza').value;
        const start   = document.getElementById('pac-start').value;
        const box     = document.getElementById('pac-preview');
        if (!importo || !start) { box.style.display = 'none'; return; }
        const rata = calcolaRata(importo, cadenza);
        const prossime = calcolaDateFuture(start, cadenza, 3, null, true);
        box.style.display = 'block';
        box.innerHTML = `Rata: <b>€ ${Calc.fmt(rata)}</b> · Cadenza: <b>${cadenza}</b><br>
            Prime date: <b>${prossime.join(', ')}</b>`;
    };

    ['pac-importo', 'pac-cadenza', 'pac-start'].forEach(elId => {
        document.getElementById(elId)?.addEventListener('input', updatePreview);
        document.getElementById(elId)?.addEventListener('change', updatePreview);
    });
    updatePreview();

    wrap.querySelector('#pac-save').onclick = async () => {
        const importo = parseFloat(document.getElementById('pac-importo').value);
        const cadenza = document.getElementById('pac-cadenza').value;
        const start   = document.getElementById('pac-start').value;
        const end     = document.getElementById('pac-end').value || null;
        const comm    = parseFloat(document.getElementById('pac-comm').value) || 0;

        if (!importo || importo <= 0 || !start) {
            Toast.show('Inserisci importo e data di inizio', 'err');
            return;
        }

        portfolio[id].pac = { importoMensile: importo, cadenza, startDate: start, endDate: end, commissione: comm };

        Toast.show('Generazione transazioni PAC...', 'info');
        close();
        await generaPacTransazioni(id, portfolio);
        await onSave();
        Toast.show('PAC attivato ✅', 'ok');
    };
}

export async function generaPacTransazioni(id, portfolio) {
    const p = portfolio[id];
    const pac = p.pac;
    if (!pac) return;

    const rata = calcolaRata(pac.importoMensile, pac.cadenza);
    const oggi = new Date().toISOString().slice(0, 10);
    const fine = pac.endDate && pac.endDate < oggi ? pac.endDate : oggi;

    const date = calcolaDateFuture(pac.startDate, pac.cadenza, 9999, fine);

    // Date già coperte da transazioni PAC esistenti
    const datePacEsistenti = new Set([
        ...(p.transactions || [])
            .filter(tx => tx.source === PAC_SOURCE)
            .map(tx => tx.date),
        ...(pac.skipDates || [])
    ]);

    for (const data of date) {
        if (datePacEsistenti.has(data)) continue;

        const prezzo = await fetchPrezzoPacData(p.nome, data);
        if (!prezzo || prezzo <= 0) continue;

        const qty = rata / prezzo;

        if (!p.transactions) p.transactions = [];
        p.transactions.push({
            date: data,
            type: 'buy',
            qty: Math.round(qty * 10000) / 10000,
            price: Math.round(prezzo * 10000) / 10000,
            commission: pac.commissione || 0,
            source: PAC_SOURCE
        });

        datePacEsistenti.add(data);
    }
}

export function calcolaRata(importoMensile, cadenza) {
    if (cadenza === 'settimanale')   return importoMensile / 4;
    if (cadenza === 'bisettimanale') return importoMensile / 2;
    return importoMensile;
}

export function calcolaDateFuture(startDate, cadenza, max = 9999, fineDate = null, includiFuture = false) {
    const date = [];
    const oggi = new Date();
    oggi.setHours(0, 0, 0, 0);

    const parts = startDate.split('-');
    let current = new Date(parseInt(parts[0]), parseInt(parts[1]) - 1, parseInt(parts[2]));
    current.setHours(0, 0, 0, 0);

    const fine = fineDate
        ? (() => { const d = new Date(fineDate); d.setHours(0,0,0,0); return d; })()
        : includiFuture ? new Date(oggi.getTime() + 366 * 24 * 60 * 60 * 1000)
        : oggi;

    while (current <= fine && date.length < max) {
        const y = current.getFullYear();
        const m = String(current.getMonth() + 1).padStart(2, '0');
        const d = String(current.getDate()).padStart(2, '0');
        date.push(`${y}-${m}-${d}`);

        if (cadenza === 'settimanale')        current.setDate(current.getDate() + 7);
        else if (cadenza === 'bisettimanale') current.setDate(current.getDate() + 14);
        else                                   current.setMonth(current.getMonth() + 1);
    }

    return date;
}

async function fetchPrezzoPacData(ticker, dateStr) {
    try {
        const t1 = toUnix(dateStr);
        const t2 = toUnix(dateStr, 3);
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&period1=${t1}&period2=${t2}`;
        const proxyUrl = `${PROXY}?url=${encodeURIComponent(url)}`;
        const r = await fetch(proxyUrl, { signal: AbortSignal.timeout(7000) });
        const raw = await r.json();
        const closes = raw?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter(v => v != null);
        if (closes?.length) return closes[0];
    } catch (e) {}
    return null;
}

function toUnix(dateStr, addDays = 0) {
    const parts = dateStr.split('-');
    const d = new Date(
        parseInt(parts[0]),
        parseInt(parts[1]) - 1,
        parseInt(parts[2]) + addDays,
        12, 0, 0
    );
    return Math.floor(d.getTime() / 1000);
}