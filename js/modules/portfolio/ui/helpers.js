// Escape per testo inserito in innerHTML (contenuto e attributi tra virgolette).
// Da usare sempre per dati esterni: Yahoo, IBKR, nomi inseriti dagli utenti.
export function escapeHtml(s) {
    return String(s ?? '').replace(/[&<>"']/g, c => ({
        '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
}

export function todayISO() {
    return new Date().toISOString().slice(0, 10);
}

let _savedScrollY = 0;

export function lockScroll() {
    _savedScrollY = window.scrollY || document.documentElement.scrollTop || 0;
    document.body.style.top = `-${_savedScrollY}px`;
    document.body.classList.add('modal-open');
}

export function unlockScroll() {
    document.body.classList.remove('modal-open');
    document.body.style.top = '';
    window.scrollTo(0, _savedScrollY);
}