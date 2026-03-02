import { PortfolioPage } from '../modules/portfolio/index.js';
import { SettingsPage } from '../modules/settings/index.js';

const PAGES = {
    'portfolio': PortfolioPage,
    'settings':  SettingsPage,
};

export class Router {
    constructor() {
        this.current = null;
        this.container = document.getElementById('page-container');
    }

    init() {
        const hash = location.hash.replace('#', '') || 'portfolio';
        this.navigate(hash);
        window.addEventListener('popstate', () => {
            const page = location.hash.replace('#', '') || 'portfolio';
            this._load(page);
        });
    }

    navigate(page) {
        if (!PAGES[page]) page = 'portfolio';
        history.pushState(null, '', '#' + page);
        this._load(page);
    }

    _load(page) {
        // aggiorna link navbar
        document.querySelectorAll('.nav-link').forEach(l => {
            l.classList.toggle('active', l.dataset.page === page);
        });

        // distruggi pagina precedente se serve
        if (this.current?.destroy) this.current.destroy();

        // monta nuova pagina
        const PageClass = PAGES[page] || PAGES['portfolio'];
        this.current = new PageClass(this.container);
        this.current.mount();
    }
}
