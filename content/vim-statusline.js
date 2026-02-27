import { MODE, COLORS } from '../shared/constants.js';

export class VimStatusline {
  constructor() {
    this.el = null;
    this.modeEl = null;
    this.fileEl = null;
    this.posEl = null;
    this.scrollEl = null;
    this.mode = MODE.NORMAL;
  }

  create() {
    this.el = document.createElement('div');
    this.el.className = 'vim-statusline';

    this.modeEl = document.createElement('span');
    this.modeEl.className = 'vim-statusline-mode vim-statusline-mode-normal';
    this.modeEl.textContent = ' NORMAL ';

    this.fileEl = document.createElement('span');
    this.fileEl.className = 'vim-statusline-file';
    this.fileEl.textContent = '';

    this.posEl = document.createElement('span');
    this.posEl.className = 'vim-statusline-pos';
    this.posEl.textContent = '1,1';

    this.scrollEl = document.createElement('span');
    this.scrollEl.className = 'vim-statusline-scroll';
    this.scrollEl.textContent = 'Top';

    this.el.appendChild(this.modeEl);
    this.el.appendChild(this.fileEl);
    this.el.appendChild(this.posEl);
    this.el.appendChild(this.scrollEl);

    return this.el;
  }

  setMode(mode) {
    this.mode = mode;
    const modeClass = mode.toLowerCase();
    this.modeEl.className = `vim-statusline-mode vim-statusline-mode-${modeClass}`;
    this.modeEl.textContent = ` ${mode} `;
  }

  update({ cursor, scroll, file }) {
    if (cursor) {
      this.posEl.textContent = `${cursor.row},${cursor.col}`;
    }
    if (scroll !== undefined) {
      this.scrollEl.textContent = scroll;
    }
    if (file !== undefined) {
      this.fileEl.textContent = file;
    }
  }
}
