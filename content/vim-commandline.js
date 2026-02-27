export class VimCommandline {
  constructor() {
    this.el = null;
    this.prefixEl = null;
    this.inputEl = null;
    this.messageEl = null;
  }

  create() {
    this.el = document.createElement('div');
    this.el.className = 'vim-commandline';

    this.prefixEl = document.createElement('span');
    this.prefixEl.className = 'vim-commandline-prefix';
    this.prefixEl.textContent = '';

    this.inputEl = document.createElement('input');
    this.inputEl.type = 'text';
    this.inputEl.className = 'vim-commandline-input';
    this.inputEl.style.display = 'none';
    this.inputEl.setAttribute('autocomplete', 'off');
    this.inputEl.setAttribute('autocorrect', 'off');
    this.inputEl.setAttribute('spellcheck', 'false');

    this.messageEl = document.createElement('span');
    this.messageEl.className = 'vim-commandline-message';
    this.messageEl.textContent = '';

    this.el.appendChild(this.prefixEl);
    this.el.appendChild(this.inputEl);
    this.el.appendChild(this.messageEl);

    return this.el;
  }

  /** Show prefix and focus input for typing (including IME). */
  activate(prefix) {
    if (!this.prefixEl) return;
    this.prefixEl.textContent = prefix;
    this.inputEl.value = '';
    this.inputEl.style.display = '';
    this.messageEl.style.display = 'none';
    this.messageEl.textContent = '';
    // Defer focus to next frame — required inside Shadow DOM during event handling
    setTimeout(() => {
      if (this.inputEl) this.inputEl.focus();
    }, 0);
  }

  deactivate() {
    if (!this.prefixEl) return;
    this.prefixEl.textContent = '';
    this.inputEl.style.display = 'none';
    this.inputEl.value = '';
    this.messageEl.style.display = '';
  }

  /** Get the current text in the input. */
  getInputValue() {
    return this.inputEl?.value || '';
  }

  showMessage(text, isError = false) {
    if (!this.prefixEl) return;
    this.prefixEl.textContent = '';
    this.inputEl.style.display = 'none';
    this.messageEl.style.display = '';
    this.messageEl.textContent = text;
    this.messageEl.className = isError
      ? 'vim-commandline-error'
      : 'vim-commandline-message';
  }

  clear() {
    if (!this.prefixEl) return;
    this.prefixEl.textContent = '';
    this.inputEl.style.display = 'none';
    this.inputEl.value = '';
    this.messageEl.textContent = '';
  }

  isInputActive() {
    return false; // Command mode is handled by keybindings, not by input events
  }
}
