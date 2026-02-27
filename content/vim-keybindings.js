import { MODE, SCROLL, MULTI_KEY_TIMEOUT, HINT_CHARS, VIDEO_SEEK_STEP, VIDEO_VOLUME_STEP } from '../shared/constants.js';
import { VideoAsciiPlayer } from './video-ascii.js';

/**
 * Vim keybinding manager.
 * Handles NORMAL, COMMAND, VISUAL, and HINT modes.
 */
export class VimKeybindings {
  constructor(overlay) {
    this.overlay = overlay;
    this.mode = MODE.NORMAL;
    this.pendingKey = null;
    this.pendingTimer = null;
    this.searchPattern = '';
    this.searchMatches = [];
    this.searchIndex = -1;
    this.visualAnchor = null;
    this.hintMap = new Map();      // key → href
    this.hintLabelMap = new Map(); // href → label
    this.onQuit = null;

    // Command mode state
    this._cmdPrefix = '';

    this._handleKeyDown = this._handleKeyDown.bind(this);
  }

  attach() {
    window.addEventListener('keydown', this._handleKeyDown, true);
  }

  detach() {
    window.removeEventListener('keydown', this._handleKeyDown, true);
    this._clearPending();
  }

  _handleKeyDown(e) {
    // Don't intercept when overlay is hidden
    if (!this.overlay.isVisible) return;

    // Skip during IME composition (Japanese / CJK input)
    if (e.isComposing || e.keyCode === 229) return;

    const key = this._normalizeKey(e);
    if (!key) return;

    let handled = false;

    switch (this.mode) {
      case MODE.NORMAL:
        handled = this._handleNormal(key, e);
        break;
      case MODE.COMMAND:
        handled = this._handleCommand(key, e);
        break;
      case MODE.VISUAL:
        handled = this._handleVisual(key, e);
        break;
      case MODE.HINT:
        handled = this._handleHint(key, e);
        break;
      case MODE.VIDEO:
        handled = this._handleVideo(key, e);
        break;
    }

    if (handled) {
      e.preventDefault();
      e.stopPropagation();
    }
  }

  _normalizeKey(e) {
    if (e.key === 'Control' || e.key === 'Shift' || e.key === 'Alt' || e.key === 'Meta') {
      return null;
    }
    let key = e.key;
    if (e.ctrlKey) key = 'C-' + key.toLowerCase();
    return key;
  }

  // ── NORMAL mode ──

  _handleNormal(key, e) {
    const ov = this.overlay;
    const { row, col } = ov.getCursor();
    const totalLines = ov.getTotalLines();
    const vpRows = ov.getViewportRows();

    // Multi-key sequences
    if (this.pendingKey === 'g') {
      this._clearPending();
      if (key === 'g') { ov.setCursor(0, 0); ov.scrollTo(0); return true; }
      return false;
    }
    if (this.pendingKey === 'Z') {
      this._clearPending();
      if (key === 'Z') { if (this.onQuit) this.onQuit(); return true; }
      return false;
    }

    switch (key) {
      // Movement
      case 'j':
        ov.setCursor(row + 1, col);
        return true;
      case 'k':
        ov.setCursor(row - 1, col);
        return true;
      case 'h':
        ov.setCursor(row, col - 1);
        return true;
      case 'l':
        ov.setCursor(row, col + 1);
        return true;

      // Half page
      case 'C-d':
        ov.setCursor(row + SCROLL.HALF_PAGE, col);
        return true;
      case 'C-u':
        ov.setCursor(row - SCROLL.HALF_PAGE, col);
        return true;

      // Full page
      case 'C-f':
        ov.setCursor(row + SCROLL.PAGE, col);
        return true;
      case 'C-b':
        ov.setCursor(row - SCROLL.PAGE, col);
        return true;

      // Top/Bottom
      case 'g':
        this._setPending('g');
        return true;
      case 'G':
        ov.setCursor(totalLines - 1, 0);
        return true;

      // ZZ → quit
      case 'Z':
        this._setPending('Z');
        return true;

      // Line start/end
      case '0':
        ov.setCursor(row, 0);
        return true;
      case '$':
        ov.setCursor(row, Infinity);
        this._clampColToLineEnd();
        return true;
      case '^': {
        // First non-whitespace
        const line = ov.lines[row];
        const text = line?.text || '';
        const firstNonWs = text.search(/\S/);
        ov.setCursor(row, firstNonWs >= 0 ? firstNonWs : 0);
        return true;
      }

      // Word motion
      case 'w':
        this._wordForward();
        return true;
      case 'b':
        this._wordBackward();
        return true;

      // Enter: start video mode on video placeholder, or follow link
      case 'Enter': {
        const curLine = ov.lines[row];
        if (curLine?.type === 'video-placeholder' && curLine.videoElement) {
          this._enterVideoMode(curLine.videoElement);
          return true;
        }
        this._followLinkOnCursorLine();
        return true;
      }

      // Command mode
      case ':':
        this._enterCommandMode(':');
        return true;

      // Search
      case '/':
        this._enterCommandMode('/');
        return true;
      case 'n':
        this._nextSearchMatch(1);
        return true;
      case 'N':
        this._nextSearchMatch(-1);
        return true;

      // Visual mode
      case 'v':
        this._enterVisual();
        return true;

      // Hint mode
      case 'f':
        this._enterHintMode();
        return true;

      // Escape — clear search highlights, messages
      case 'Escape':
        this.searchMatches = [];
        this.overlay.clearSearch();
        this.overlay.getCommandline()?.clear();
        return true;

      default:
        return false;
    }
  }

  // ── COMMAND mode ──
  // Non-IME keys handled here in capture phase.
  // IME composition goes through the <input> element naturally (isComposing skips this handler).

  _handleCommand(key, e) {
    const cmdline = this.overlay.getCommandline();

    if (key === 'Escape') {
      this._exitCommandMode();
      return true;
    }

    if (key === 'Enter') {
      const val = cmdline?.getInputValue() || '';
      const cmd = this._cmdPrefix + val;
      this._exitCommandMode();
      this._executeCommand(cmd);
      return true;
    }

    if (key === 'Backspace') {
      const val = cmdline?.getInputValue() || '';
      if (val.length === 0) {
        this._exitCommandMode();
        return true;
      }
      // Remove last character from input
      if (cmdline?.inputEl) cmdline.inputEl.value = val.slice(0, -1);
      return true;
    }

    // Printable characters: write directly into the <input> value
    // (preventDefault so the char isn't doubled when input has focus)
    if (key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
      if (cmdline?.inputEl) cmdline.inputEl.value += key;
      return true;
    }

    return true; // consume all other keys in command mode
  }

  // ── VISUAL mode ──

  _handleVisual(key, e) {
    const ov = this.overlay;
    const { row, col } = ov.getCursor();

    switch (key) {
      case 'Escape':
      case 'v':
        this._exitVisual();
        return true;
      case 'j':
        ov.setCursor(row + 1, col);
        return true;
      case 'k':
        ov.setCursor(row - 1, col);
        return true;
      case 'h':
        ov.setCursor(row, col - 1);
        return true;
      case 'l':
        ov.setCursor(row, col + 1);
        return true;
      case 'y': {
        // Yank: copy selected text
        const text = this._getVisualText();
        if (text) {
          navigator.clipboard?.writeText(text).catch(() => {});
          this.overlay.getCommandline()?.showMessage(`${text.split('\n').length} lines yanked`);
        }
        this._exitVisual();
        return true;
      }
      default:
        return false;
    }
  }

  // ── HINT mode ──

  _handleHint(key, e) {
    if (key === 'Escape') {
      this._exitHintMode();
      return true;
    }

    const href = this.hintMap.get(key);
    if (href) {
      this._exitHintMode();
      this._navigate(href);
      return true;
    }

    // Invalid key — exit hint mode
    this._exitHintMode();
    return true;
  }

  // ── Multi-key ──

  _setPending(key) {
    this._clearPending();
    this.pendingKey = key;
    this.pendingTimer = setTimeout(() => {
      this.pendingKey = null;
    }, MULTI_KEY_TIMEOUT);
  }

  _clearPending() {
    this.pendingKey = null;
    if (this.pendingTimer) {
      clearTimeout(this.pendingTimer);
      this.pendingTimer = null;
    }
  }

  // ── Command mode helpers ──

  _enterCommandMode(prefix) {
    this.mode = MODE.COMMAND;
    this._cmdPrefix = prefix;
    this._cmdBuffer = '';
    this.overlay.getStatusline()?.setMode(MODE.COMMAND);
    this._updateCommandDisplay();
  }

  _exitCommandMode() {
    this.mode = MODE.NORMAL;
    this._cmdPrefix = '';
    this._cmdBuffer = '';
    this.overlay.getStatusline()?.setMode(MODE.NORMAL);
    this.overlay.getCommandline()?.clear();
  }

  _updateCommandDisplay() {
    const cmdline = this.overlay.getCommandline();
    if (cmdline) {
      cmdline.showCommand(this._cmdPrefix, this._cmdBuffer);
    }
  }

  _executeCommand(cmd) {
    this._exitCommandMode();

    if (cmd.startsWith(':')) {
      const command = cmd.slice(1).trim();
      if (/^(q!?|quit!?|wq!?|x!?|xa!?)$/.test(command)) {
        if (this.onQuit) this.onQuit();
        return;
      }
      if (command.match(/^\d+$/)) {
        const lineNum = parseInt(command) - 1;
        this.overlay.setCursor(lineNum, 0);
        return;
      }
      this.overlay.getCommandline()?.showMessage(`E492: Not an editor command: ${command}`, true);
      return;
    }

    if (cmd.startsWith('/')) {
      const pattern = cmd.slice(1);
      if (pattern) {
        this.searchPattern = pattern;
        this._performSearch();
      }
    }
  }

  // ── Search ──

  _performSearch() {
    this.searchMatches = [];
    const pattern = this.searchPattern.toLowerCase();
    const lines = this.overlay.lines;

    for (let i = 0; i < lines.length; i++) {
      const text = (lines[i].text || '').toLowerCase();
      if (text.includes(pattern)) {
        this.searchMatches.push(i);
      }
    }

    if (this.searchMatches.length > 0) {
      // Jump to next match from current cursor
      const { row } = this.overlay.getCursor();
      this.searchIndex = this.searchMatches.findIndex(m => m >= row);
      if (this.searchIndex === -1) this.searchIndex = 0;
      this.overlay.setCursor(this.searchMatches[this.searchIndex], 0);
      this.overlay.setSearch(this.searchPattern, this.searchMatches, this.searchMatches[this.searchIndex]);
      this.overlay.getCommandline()?.showMessage(
        `/${this.searchPattern}  [${this.searchIndex + 1}/${this.searchMatches.length}]`
      );
    } else {
      this.overlay.clearSearch();
      this.overlay.getCommandline()?.showMessage(`Pattern not found: ${this.searchPattern}`, true);
    }
  }

  _nextSearchMatch(dir) {
    if (this.searchMatches.length === 0) return;
    this.searchIndex = (this.searchIndex + dir + this.searchMatches.length) % this.searchMatches.length;
    this.overlay.setCursor(this.searchMatches[this.searchIndex], 0);
    this.overlay.setSearch(this.searchPattern, this.searchMatches, this.searchMatches[this.searchIndex]);
    this.overlay.getCommandline()?.showMessage(
      `/${this.searchPattern}  [${this.searchIndex + 1}/${this.searchMatches.length}]`
    );
  }

  // ── Visual mode ──

  _enterVisual() {
    this.mode = MODE.VISUAL;
    this.visualAnchor = { ...this.overlay.getCursor() };
    this.overlay.getStatusline()?.setMode(MODE.VISUAL);
  }

  _exitVisual() {
    this.mode = MODE.NORMAL;
    this.visualAnchor = null;
    this.overlay.getStatusline()?.setMode(MODE.NORMAL);
    this.overlay.scheduleRender();
  }

  _getVisualText() {
    if (!this.visualAnchor) return '';
    const { row: r1 } = this.visualAnchor;
    const { row: r2 } = this.overlay.getCursor();
    const start = Math.min(r1, r2);
    const end = Math.max(r1, r2);
    const lines = [];
    for (let i = start; i <= end; i++) {
      lines.push(this.overlay.lines[i]?.text || '');
    }
    return lines.join('\n');
  }

  // ── Hint mode ──

  _enterHintMode() {
    this.mode = MODE.HINT;
    this.overlay.getStatusline()?.setMode(MODE.HINT);
    this.hintMap.clear();
    this.hintLabelMap.clear();

    // Collect unique links in visible lines
    const ov = this.overlay;
    const start = ov.scrollTop;
    const end = Math.min(start + ov.getViewportRows(), ov.lines.length);
    const hrefs = [];

    for (let i = start; i < end; i++) {
      const line = ov.lines[i];
      if (line.links) {
        for (const link of line.links) {
          if (!this.hintLabelMap.has(link.href)) {
            hrefs.push(link.href);
          }
        }
      }
    }

    // Assign single-char labels
    for (let i = 0; i < hrefs.length && i < HINT_CHARS.length; i++) {
      const ch = HINT_CHARS[i];
      this.hintMap.set(ch, hrefs[i]);
      this.hintLabelMap.set(hrefs[i], ch);
    }

    ov.showHints(this.hintLabelMap);
    ov.getCommandline()?.showMessage('-- LINKS --');
  }

  _exitHintMode() {
    this.mode = MODE.NORMAL;
    this.hintMap.clear();
    this.hintLabelMap.clear();
    this.overlay.clearHints();
    this.overlay.getStatusline()?.setMode(MODE.NORMAL);
    this.overlay.getCommandline()?.clear();
  }

  // ── VIDEO mode ──

  _handleVideo(key, e) {
    switch (key) {
      case ' ':
        this.overlay.videoPlayer?.togglePlay();
        return true;
      case 'h':
        this.overlay.videoPlayer?.seek(-VIDEO_SEEK_STEP);
        return true;
      case 'l':
        this.overlay.videoPlayer?.seek(VIDEO_SEEK_STEP);
        return true;
      case 'j':
        this.overlay.videoPlayer?.adjustVolume(-VIDEO_VOLUME_STEP);
        return true;
      case 'k':
        this.overlay.videoPlayer?.adjustVolume(VIDEO_VOLUME_STEP);
        return true;
      case 'm':
        this.overlay.videoPlayer?.toggleMute();
        return true;
      case '[':
        this.overlay.videoPlayer?.adjustSpeed(-0.25);
        return true;
      case ']':
        this.overlay.videoPlayer?.adjustSpeed(0.25);
        return true;
      case 'q':
      case 'Escape':
        this._exitVideoMode();
        return true;
      default:
        return true; // consume all keys in video mode
    }
  }

  _enterVideoMode(videoElement) {
    const player = new VideoAsciiPlayer(videoElement);
    this.mode = MODE.VIDEO;
    this.overlay.getStatusline()?.setMode(MODE.VIDEO);
    this.overlay.startVideoMode(player);
    this.overlay.getCommandline()?.showMessage('VIDEO: Space=play/pause h/l=seek j/k=vol m=mute [/]=speed q=quit');
  }

  _exitVideoMode() {
    this.mode = MODE.NORMAL;
    this.overlay.stopVideoMode();
    this.overlay.getStatusline()?.setMode(MODE.NORMAL);
    this.overlay.getCommandline()?.clear();
  }

  // ── Word motion ──

  _wordForward() {
    const ov = this.overlay;
    let { row, col } = ov.getCursor();
    const text = ov.lines[row]?.text || '';

    // Find next word boundary
    const rest = text.slice(col);
    const match = rest.match(/^\S*\s+/);
    if (match) {
      ov.setCursor(row, col + match[0].length);
    } else if (row + 1 < ov.getTotalLines()) {
      // Move to start of next line
      ov.setCursor(row + 1, 0);
    }
  }

  _wordBackward() {
    const ov = this.overlay;
    let { row, col } = ov.getCursor();

    if (col === 0 && row > 0) {
      // Go to end of previous line
      const prevText = ov.lines[row - 1]?.text || '';
      ov.setCursor(row - 1, Math.max(0, prevText.length - 1));
      return;
    }

    const text = ov.lines[row]?.text || '';
    const before = text.slice(0, col);
    const match = before.match(/\s+\S*$/);
    if (match) {
      const spaceStart = col - match[0].length;
      const wordStart = before.slice(spaceStart).search(/\S/);
      ov.setCursor(row, spaceStart + (wordStart >= 0 ? wordStart : 0));
    } else {
      ov.setCursor(row, 0);
    }
  }

  _clampColToLineEnd() {
    const ov = this.overlay;
    const { row } = ov.getCursor();
    const line = ov.lines[row];
    const len = (line?.text || '').length;
    if (ov.cursorCol >= len) {
      ov.cursorCol = Math.max(0, len - 1);
    }
  }

  _followLinkOnCursorLine() {
    const { row } = this.overlay.getCursor();
    const line = this.overlay.lines[row];
    if (line?.links && line.links.length > 0) {
      this._navigate(line.links[0].href);
    }
  }

  /** Navigate to href. Vim mode persists via background activeTabs. */
  _navigate(href) {
    window.location.href = href;
  }
}
