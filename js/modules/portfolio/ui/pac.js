import { Calc } from '../calc.js';
import { Exchange } from '../../../api/exchange.js';
import { Yahoo } from '../../../api/yahoo.js';
import { Toast } from '../../../core/toast.js';
import { lockScroll, unlockScroll } from './helpers.js';

const PAC_SOURCE = 'pac';

export function openPacModal(id, portfolio, onSave) {
    const p = portfolio[id];
    const pac = p.pac || null;

    document.getElementById('modal-pac')?.remove();

    const wrap = document.createElement('div');
    wrap.id = 'modal-pac';
    wrap.className = 'overlay visible';
    wrap.innerHTML = `
        <div class="modal" style="border-top: 3px solid var(--accent);">
            <div class="modal-header">
                <h3>↻ PAC — ${p.nome}</h3>
                <button class="btn-x" id="pac-close">✕</button>
            </div>
            <div class="modal-body">
                ${pac ? `
                <div class="preview-box" style="margin-bottom:14px; display:flex; justify-content:space-between; align-items:center;">
                    <span>PAC attivo dal <b>${pac.startDate}</b> · <b>${pac.importoMensile}€</b>/mese · <b>${pac.cadenza}</b></span>
                    <button id="pac-stop" class="btn btn-danger btn-sm">Interrompi</button>
                </div>` : ''}
                <div class="form-grid-2">
                    <div>
                        <span class="modal-label">Importo mensile (€)</span>
                        <input type="number" id="pac-importo" step="any" placeholder="120" value="${pac?.importoMensile || ''}">
                    </div>
                    <div>
                        <span class="modal-label">Cadenza</span>
                        <select id="pac-cadenza">
                            <option value="settimanale" ${pac?.cadenza === 'settimanale' ? 'selected' : ''}>Settimanale (÷ 4)</option>
                            <option value="bisettimanale" ${pac?.cadenza === 'bisettimanale' ? 'selected' : ''}>Bisettimanale (÷ 2)</option>
                            <option value="mensile" ${pac?.cadenza === 'mensile' ? 'selected' : ''}>Mensile (÷ 1)</option>
                        </select>
                    </div>
                    <div>
                        <span class="modal-label">Data primo acquisto</span>
                        <input type="date" id="pac-start" value="${pac?.startDate || ''}">
                    </div>
                    <div>
                        <span class="modal-label">Data fine (opzionale)</span>
                        <input type="date" id="pac-end" value="${pac?.endDate || ''}">
                    </div>
                    <div>
                        <span class="modal-label">Commissione per rata (€)</span>
                        <input type="number" id="pac-comm" step="any" placeholder="0" value="${pac?.commissione ?? 0}">
                    </div>
                </div>
                <div id="pac-preview" class="preview-box" style="margin-top:14px; display:none;"></div>
                <button id="pac-save" class="btn btn-accent btn-full" style="margin-top:16px;">
                    ${pac ? '↻ Aggiorna PAC' : '↻ Attiva PAC'}
                </button>
                <button id="pac-cancel" class="btn btn-ghost btn-full" style="margin-top:8px;">Annulla</button>
            </div>
        </div>`;
    document.body.appendChild(wrap);
    lockScroll();

    const close = () => { wrap.remove(); unlockScroll(); };
    document.getElementById('pac-close').onclick  = close;
    document.getElementById('pac-cancel').onclick = close;

    // Preview rata
    const updatePreview = () => {
        const importo = parseFloat(document.getElementById('pac-importo').value);
        const cadenza = document.getElementById('pac-cadenza').value;
        const start   = document.getElementById('pac-start').value;
        const box     = document.getElementById('pac-preview');
        if (!importo || !start) { box.style.display = 'none'; return; }
        const rata = calcolaRata(importo, cadenza);
        const prossime = calcolaDateFuture(start, cadenza, 3);
        box.style.display = 'block';
        box.innerHTML = `
            Rata: <b>€ ${Calc.fmt(rata)}</b> · Cadenza: <b>${cadenza}</b><br>
            Prossime date: <b>${prossime.join(', ')}</b>`;
    };

    ['pac-importo', 'pac-cadenza', 'pac-start'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', updatePreview);
        document.getElementById(id)?.addEventListener('change', updatePreview);
    });
    updatePreview();

    // Interrompi PAC
    document.getElementById('pac-stop')?.addEventListener('click', async () => {
        if (!confirm('Interrompere il PAC? Le transazioni già generate verranno mantenute.')) return;
        delete portfolio[id].pac;
        close();
        await onSave();
        Toast.show('PAC interrotto', 'ok');
    });

    // Salva PAC
    document.getElementById('pac-save').onclick = async () => {
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

    // Rimuovi transazioni PAC esistenti e rigenera
    p.transactions = (p.transactions || []).filter(tx => tx.source !== PAC_SOURCE);

    for (const data of date) {
        const prezzo = await fetchPrezzoPacData(p.nome, data);
        if (!prezzo || prezzo <= 0) continue;

        const qty = rata / prezzo;

        p.transactions.push({
            date: data,
            type: 'buy',
            qty: Math.round(qty * 10000) / 10000,
            price: prezzo,
            commission: pac.commissione || 0,
            source: PAC_SOURCE
        });
    }
}

export function calcolaRata(importoMensile, cadenza) {
    if (cadenza === 'settimanale')   return importoMensile / 4;
    if (cadenza === 'bisettimanale') return importoMensile / 2;
    return importoMensile;
}

export function calcolaDateFuture(startDate, cadenza, max = 9999, fineDate = null) {
    const date = [];
    const oggi = new Date();
    oggi.setHours(0, 0, 0, 0);

    let current = new Date(startDate);
    current.setHours(0, 0, 0, 0);

    const fine = fineDate ? new Date(fineDate) : oggi;
    fine.setHours(0, 0, 0, 0);

    while (current <= fine && date.length < max) {
        date.push(current.toISOString().slice(0, 10));

        if (cadenza === 'settimanale')        current.setDate(current.getDate() + 7);
        else if (cadenza === 'bisettimanale') current.setDate(current.getDate() + 14);
        else                                   current.setMonth(current.getMonth() + 1);
    }

    return date;
}

async function fetchPrezzoPacData(ticker, dateStr) {
    try {
        // Prova a prendere il prezzo storico da Yahoo
        const PROXY = 'https://finance-proxy.andrea-kampa.workers.dev';
        const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&period1=${toUnix(dateStr)}&period2=${toUnix(dateStr, 1)}`;
        const proxyUrl = `${PROXY}?url=${encodeURIComponent(url)}`;

        const r = await fetch(proxyUrl, { signal: AbortSignal.timeout(7000) });
        const raw = await r.json();
        const closes = raw?.chart?.result?.[0]?.indicators?.quote?.[0]?.close?.filter(Boolean);
        if (closes?.length) return closes[0];
    } catch (e) {}
    return null;
}

function toUnix(dateStr, addDays = 0) {
    const d = new Date(dateStr);
    d.setDate(d.getDate() + addDays);
    return Math.floor(d.getTime() / 1000);
}