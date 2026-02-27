import { COLORS, VIRTUAL_SCROLL_BUFFER } from '../shared/constants.js';
import { VimStatusline } from './vim-statusline.js';
import { VimCommandline } from './vim-commandline.js';

export class VimOverlay {
  constructor() {
    this.host = null;
    this.shadow = null;
    this.root = null;
    this.bufferEl = null;
    this.viewportEl = null;
    this.statusline = null;
    this.commandline = null;
    this.lines = [];
    this.scrollTop = 0;
    this.cursorRow = 0;
    this.cursorCol = 0;
    this.viewportRows = 0;
    this.isVisible = false;
    this._renderScheduled = false;
    this._originalOverflow = '';
    this._measuredLineHeight = 0;
    this._resizeObserver = null;
    this._wheelHandler = null;
    // Video mode state
    this.videoPlayer = null;
    this._savedVideoState = null;
    // Search highlight state
    this.searchPattern = '';
    this.searchMatchLines = new Set();
    this.searchCurrentLine = -1;
  }

  create() {
    this.host = document.createElement('div');
    this.host.id = 'vimascii-host';
    this.shadow = this.host.attachShadow({ mode: 'closed' });

    // Load CSS into shadow DOM
    const style = document.createElement('style');
    style.textContent = this._getCSS();
    this.shadow.appendChild(style);

    // Root container
    this.root = document.createElement('div');
    this.root.className = 'vimascii-root';

    // Buffer viewport
    this.bufferEl = document.createElement('div');
    this.bufferEl.className = 'vim-buffer';

    this.viewportEl = document.createElement('div');
    this.viewportEl.className = 'vim-buffer-viewport';
    this.bufferEl.appendChild(this.viewportEl);

    // Statusline
    this.statusline = new VimStatusline();
    const statusEl = this.statusline.create();

    // Commandline
    this.commandline = new VimCommandline();
    const commandEl = this.commandline.create();

    this.root.appendChild(this.bufferEl);
    this.root.appendChild(statusEl);
    this.root.appendChild(commandEl);
    this.shadow.appendChild(this.root);

    document.documentElement.appendChild(this.host);

    // Observe resize to recalculate viewport rows
    this._resizeObserver = new ResizeObserver(() => {
      this._calculateViewport();
      this.scheduleRender();
    });
    this._resizeObserver.observe(this.bufferEl);

    // Mouse wheel scrolling
    this._wheelHandler = (e) => {
      if (!this.isVisible) return;
      e.preventDefault();
      const delta = Math.sign(e.deltaY) * 3;
      this.cursorRow = Math.max(0, Math.min(this.cursorRow + delta, this.lines.length - 1));
      this._ensureCursorVisible();
      this.scheduleRender();
    };
    this.host.addEventListener('wheel', this._wheelHandler, { passive: false });
    // Capture wheel on window to prevent page scroll behind overlay
    this._windowWheelHandler = (e) => {
      if (!this.isVisible) return;
      e.preventDefault();
      const delta = Math.sign(e.deltaY) * 3;
      this.cursorRow = Math.max(0, Math.min(this.cursorRow + delta, this.lines.length - 1));
      this._ensureCursorVisible();
      this.scheduleRender();
    };
    window.addEventListener('wheel', this._windowWheelHandler, { passive: false, capture: true });

    return this;
  }

  show() {
    if (!this.host) this.create();
    this._originalOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    this.host.style.display = '';
    this.isVisible = true;
    // Defer viewport calculation to after layout
    requestAnimationFrame(() => {
      this._calculateViewport();
      this.render();
    });
  }

  hide() {
    if (this.host) {
      this.host.style.display = 'none';
      document.body.style.overflow = this._originalOverflow;
    }
    this.isVisible = false;
  }

  destroy() {
    if (this._resizeObserver) {
      this._resizeObserver.disconnect();
      this._resizeObserver = null;
    }
    if (this._windowWheelHandler) {
      window.removeEventListener('wheel', this._windowWheelHandler, { capture: true });
      this._windowWheelHandler = null;
    }
    if (this.host && this.host.parentNode) {
      this.host.parentNode.removeChild(this.host);
      document.body.style.overflow = this._originalOverflow;
    }
    this.host = null;
    this.shadow = null;
    this.isVisible = false;
  }

  setLines(lines) {
    this.lines = lines;
    this.scrollTop = 0;
    this.cursorRow = 0;
    this.cursorCol = 0;
    this.scheduleRender();
  }

  setCursor(row, col) {
    this.cursorRow = Math.max(0, Math.min(row, this.lines.length - 1));
    this.cursorCol = Math.max(0, col);
    this._ensureCursorVisible();
    this.scheduleRender();
  }

  getCursor() {
    return { row: this.cursorRow, col: this.cursorCol };
  }

  getViewportRows() {
    return this.viewportRows;
  }

  getTotalLines() {
    return this.lines.length;
  }

  scrollTo(row) {
    this.scrollTop = Math.max(0, Math.min(row, this.lines.length - 1));
    this.scheduleRender();
  }

  scrollBy(delta) {
    this.scrollTo(this.scrollTop + delta);
  }

  _ensureCursorVisible() {
    const vp = this.viewportRows || 30;
    if (this.cursorRow < this.scrollTop) {
      this.scrollTop = this.cursorRow;
    } else if (this.cursorRow >= this.scrollTop + vp) {
      this.scrollTop = this.cursorRow - vp + 1;
    }
    this.scrollTop = Math.max(0, this.scrollTop);
  }

  _calculateViewport() {
    if (!this.bufferEl) return;

    // Measure actual line height from a rendered line, or use computed value
    let lineHeight = this._measuredLineHeight;
    if (!lineHeight) {
      const probe = document.createElement('div');
      probe.className = 'vim-line';
      probe.style.visibility = 'hidden';
      probe.style.position = 'absolute';
      probe.textContent = 'X';
      this.bufferEl.appendChild(probe);
      lineHeight = probe.getBoundingClientRect().height;
      this.bufferEl.removeChild(probe);
      if (lineHeight > 0) {
        this._measuredLineHeight = lineHeight;
      }
    }

    if (!lineHeight || lineHeight <= 0) {
      lineHeight = 19.6; // fallback: 14px * 1.4
    }

    const height = this.bufferEl.clientHeight || this.bufferEl.getBoundingClientRect().height;
    const rows = Math.floor(height / lineHeight);
    this.viewportRows = rows > 0 ? rows : 30;
  }

  scheduleRender() {
    if (this._renderScheduled) return;
    this._renderScheduled = true;
    requestAnimationFrame(() => {
      this._renderScheduled = false;
      this.render();
    });
  }

  render() {
    if (!this.viewportEl || !this.isVisible) return;
    if (this.videoPlayer) return; // Video mode handles its own rendering

    // Recalculate viewport rows from actual layout on every render
    this._calculateViewport();

    // Clamp scrollTop
    const maxScroll = Math.max(0, this.lines.length - 1);
    this.scrollTop = Math.max(0, Math.min(this.scrollTop, maxScroll));

    const fragment = document.createDocumentFragment();
    const vpRows = this.viewportRows || 30;

    // Render visible lines
    for (let i = this.scrollTop; i < this.scrollTop + vpRows; i++) {
      const lineEl = document.createElement('div');
      lineEl.className = 'vim-line';

      const gutterEl = document.createElement('span');
      gutterEl.className = 'vim-gutter';

      const contentEl = document.createElement('span');
      contentEl.className = 'vim-line-content';

      if (i < this.lines.length) {
        gutterEl.textContent = String(i + 1);
        const line = this.lines[i];
        this._renderLineContent(contentEl, line, i);
      } else {
        // Tilde lines beyond content
        gutterEl.textContent = '';
        contentEl.textContent = '~';
        contentEl.classList.add('vim-tilde');
      }

      lineEl.appendChild(gutterEl);
      lineEl.appendChild(contentEl);
      fragment.appendChild(lineEl);
    }

    this.viewportEl.innerHTML = '';
    this.viewportEl.appendChild(fragment);

    // Update statusline
    this._updateStatusline();
  }

  _renderLineContent(container, line, rowIndex) {
    if (!line) {
      container.textContent = '';
      return;
    }

    const text = line.text || '';

    if (line.type === 'video-placeholder') {
      container.classList.add('line-video-placeholder');
      container.textContent = text;
      this._applyCursor(container, text, rowIndex);
      return;
    }

    if (line.type === 'ascii-art') {
      container.classList.add('line-ascii-art');
      container.textContent = text;
      this._applyCursor(container, text, rowIndex);
      return;
    }

    if (line.type === 'separator') {
      container.classList.add('line-separator');
      container.textContent = text;
      return;
    }

    if (line.type === 'code') {
      container.classList.add('line-code');
      container.textContent = text;
      this._applySearchHighlight(container, rowIndex);
      this._applyCursor(container, text, rowIndex);
      return;
    }

    // Headings
    if (line.type && line.type.startsWith('heading')) {
      const level = line.level || 1;
      container.classList.add('line-heading', `line-heading-${level}`);
    }

    // Render text with links
    if (line.links && line.links.length > 0) {
      this._renderTextWithLinks(container, text, line.links, rowIndex);
    } else {
      container.textContent = text;
      this._applySearchHighlight(container, rowIndex);
      this._applyCursor(container, text, rowIndex);
    }
  }

  _renderTextWithLinks(container, text, links, rowIndex) {
    let pos = 0;
    const parts = [];

    // Sort links by start position
    const sorted = [...links].sort((a, b) => a.start - b.start);

    for (const link of sorted) {
      if (link.start > pos) {
        parts.push({ text: text.slice(pos, link.start), type: 'text' });
      }
      parts.push({
        text: text.slice(link.start, link.end),
        type: 'link',
        href: link.href,
      });
      pos = link.end;
    }
    if (pos < text.length) {
      parts.push({ text: text.slice(pos), type: 'text' });
    }

    for (const part of parts) {
      if (part.type === 'link') {
        const span = document.createElement('span');
        span.className = 'line-link';
        span.textContent = part.text;
        span.dataset.href = part.href;
        span.addEventListener('click', (e) => {
          e.preventDefault();
          e.stopPropagation();
          window.location.href = part.href;
        });
        container.appendChild(span);
      } else {
        container.appendChild(document.createTextNode(part.text));
      }
    }

    this._applySearchHighlight(container, rowIndex);
    this._applyCursor(container, text, rowIndex);
  }

  /**
   * Walk all text nodes inside container and wrap search pattern matches
   * in highlight spans. Current match line gets a distinct color.
   */
  _applySearchHighlight(container, rowIndex) {
    const pat = this.searchPattern;
    if (!pat) return;

    const isCurrent = rowIndex === this.searchCurrentLine;
    const cls = isCurrent ? 'vim-search-current' : 'vim-search-match';

    // Collect text nodes (snapshot to avoid live mutation issues)
    const textNodes = [];
    const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT);
    let n;
    while ((n = walker.nextNode())) textNodes.push(n);

    for (const tNode of textNodes) {
      const src = tNode.textContent;
      const lower = src.toLowerCase();
      const idx = lower.indexOf(pat);
      if (idx === -1) continue;

      // Split: before | match | rest (rest will be revisited in next iteration via new nodes)
      const frag = document.createDocumentFragment();
      let pos = 0;
      let searchPos = idx;
      const parent = tNode.parentNode;

      let remaining = src;
      let lowerRemaining = lower;
      let offset = 0;

      while (true) {
        const i = lowerRemaining.indexOf(pat);
        if (i === -1) break;

        if (i > 0) frag.appendChild(document.createTextNode(remaining.slice(0, i)));

        const span = document.createElement('span');
        span.className = cls;
        span.textContent = remaining.slice(i, i + pat.length);
        frag.appendChild(span);

        remaining = remaining.slice(i + pat.length);
        lowerRemaining = lowerRemaining.slice(i + pat.length);
      }

      if (remaining) frag.appendChild(document.createTextNode(remaining));
      parent.replaceChild(frag, tNode);
    }
  }

  _applyCursor(container, text, rowIndex) {
    if (rowIndex !== this.cursorRow) return;

    const col = this.cursorCol;
    const fullText = text || '';

    // Empty line: show block cursor as a space
    if (fullText.length === 0) {
      const cursorSpan = document.createElement('span');
      cursorSpan.className = 'vim-cursor';
      cursorSpan.textContent = ' ';
      container.textContent = '';
      container.appendChild(cursorSpan);
      return;
    }

    // For simple text nodes (single text child), rebuild with cursor span
    if (container.childNodes.length === 1 && container.childNodes[0].nodeType === Node.TEXT_NODE) {
      const t = container.textContent;
      const before = t.slice(0, col);
      const cursorChar = col < t.length ? t[col] : ' ';
      const after = col < t.length ? t.slice(col + 1) : '';

      container.textContent = '';
      if (before) container.appendChild(document.createTextNode(before));
      const cursorSpan = document.createElement('span');
      cursorSpan.className = 'vim-cursor';
      cursorSpan.textContent = cursorChar;
      container.appendChild(cursorSpan);
      if (after) container.appendChild(document.createTextNode(after));
      return;
    }

    // Mixed content (links + text nodes): walk child nodes to find
    // the character at col and wrap it with cursor span
    let charIdx = 0;
    const nodes = Array.from(container.childNodes);
    for (const node of nodes) {
      const nodeText = node.textContent || '';
      const nodeLen = nodeText.length;

      if (col >= charIdx && col < charIdx + nodeLen) {
        const offsetInNode = col - charIdx;
        if (node.nodeType === Node.TEXT_NODE) {
          const before = nodeText.slice(0, offsetInNode);
          const cursorChar = nodeText[offsetInNode];
          const after = nodeText.slice(offsetInNode + 1);
          const frag = document.createDocumentFragment();
          if (before) frag.appendChild(document.createTextNode(before));
          const cursorSpan = document.createElement('span');
          cursorSpan.className = 'vim-cursor';
          cursorSpan.textContent = cursorChar;
          frag.appendChild(cursorSpan);
          if (after) frag.appendChild(document.createTextNode(after));
          container.replaceChild(frag, node);
        } else if (node.nodeType === Node.ELEMENT_NODE) {
          // Insert cursor inside the element (e.g., link span)
          const innerText = node.textContent;
          const before = innerText.slice(0, offsetInNode);
          const cursorChar = innerText[offsetInNode];
          const after = innerText.slice(offsetInNode + 1);
          node.textContent = '';
          if (before) node.appendChild(document.createTextNode(before));
          const cursorSpan = document.createElement('span');
          cursorSpan.className = 'vim-cursor';
          cursorSpan.textContent = cursorChar;
          node.appendChild(cursorSpan);
          if (after) node.appendChild(document.createTextNode(after));
        }
        return;
      }
      charIdx += nodeLen;
    }

    // Cursor past end of line: append block cursor
    const cursorSpan = document.createElement('span');
    cursorSpan.className = 'vim-cursor';
    cursorSpan.textContent = ' ';
    container.appendChild(cursorSpan);
  }

  _updateStatusline() {
    if (!this.statusline) return;

    const total = this.lines.length;
    const vp = this.viewportRows || 30;
    let scrollPos;
    if (total <= vp) {
      scrollPos = 'All';
    } else if (this.scrollTop === 0) {
      scrollPos = 'Top';
    } else if (this.scrollTop + vp >= total) {
      scrollPos = 'Bot';
    } else {
      scrollPos = Math.round((this.scrollTop / (total - vp)) * 100) + '%';
    }

    this.statusline.update({
      cursor: { row: this.cursorRow + 1, col: this.cursorCol + 1 },
      scroll: scrollPos,
      file: window.location.href,
    });
  }

  // Inject link hints over visible links
  showHints(hintMap) {
    this._clearHints();
    const linkEls = this.viewportEl.querySelectorAll('.line-link');
    for (const el of linkEls) {
      const href = el.dataset.href;
      const hint = hintMap.get(href);
      if (hint) {
        const label = document.createElement('span');
        label.className = 'vim-hint-label';
        label.textContent = hint;
        // Position relative to the link element
        const rect = el.getBoundingClientRect();
        const bufferRect = this.bufferEl.getBoundingClientRect();
        label.style.left = (rect.left - bufferRect.left) + 'px';
        label.style.top = (rect.top - bufferRect.top) + 'px';
        this.bufferEl.appendChild(label);
      }
    }
  }

  _clearHints() {
    const hints = this.bufferEl?.querySelectorAll('.vim-hint-label');
    if (hints) hints.forEach(h => h.remove());
  }

  clearHints() {
    this._clearHints();
  }

  setSearch(pattern, matchLines, currentLine) {
    this.searchPattern = pattern.toLowerCase();
    this.searchMatchLines = new Set(matchLines);
    this.searchCurrentLine = currentLine;
    this.scheduleRender();
  }

  clearSearch() {
    this.searchPattern = '';
    this.searchMatchLines.clear();
    this.searchCurrentLine = -1;
    this.scheduleRender();
  }

  startVideoMode(player) {
    // Save current state
    this._savedVideoState = {
      scrollTop: this.scrollTop,
      cursorRow: this.cursorRow,
      cursorCol: this.cursorCol,
    };
    this.videoPlayer = player;
    // Start player in the viewport container
    player.start(this.viewportEl);
  }

  stopVideoMode() {
    if (this.videoPlayer) {
      this.videoPlayer.stop();
      this.videoPlayer = null;
    }
    // Restore state
    if (this._savedVideoState) {
      this.scrollTop = this._savedVideoState.scrollTop;
      this.cursorRow = this._savedVideoState.cursorRow;
      this.cursorCol = this._savedVideoState.cursorCol;
      this._savedVideoState = null;
    }
    this.render();
  }

  getCommandline() {
    return this.commandline;
  }

  getStatusline() {
    return this.statusline;
  }

  _getCSS() {
    // Return inline CSS for shadow DOM
    return `
:host {
  all: initial;
  font-family: 'Menlo', 'Monaco', 'Courier New', 'Consolas', monospace;
  font-size: 14px;
  line-height: 1.4;
  color: ${COLORS.text};
  background: ${COLORS.bg};
}

.vimascii-root {
  position: fixed;
  top: 0; left: 0;
  width: 100vw; height: 100vh;
  z-index: 2147483647;
  display: grid;
  grid-template-rows: 1fr auto auto;
  background: ${COLORS.bg};
  font-family: 'Menlo','Monaco','Courier New','Consolas',monospace;
  font-size: 14px;
  line-height: 1.4;
  color: ${COLORS.text};
  overflow: hidden;
}

.vim-buffer {
  display: flex;
  flex-direction: column;
  overflow: hidden;
  position: relative;
  cursor: text;
  min-height: 0;
  min-width: 0;
}

.vim-buffer-viewport { flex: 1; overflow: hidden; min-height: 0; }

.vim-line {
  display: flex;
  white-space: pre;
  height: 1.4em;
  min-height: 1.4em;
}

.vim-gutter {
  display: inline-block;
  width: 5ch; min-width: 5ch;
  text-align: right;
  padding-right: 1ch;
  color: ${COLORS.gutter};
  background: ${COLORS.gutterBg};
  user-select: none;
  flex-shrink: 0;
}

.vim-line-content {
  flex: 1;
  padding-left: 1ch;
  overflow: hidden;
}

.vim-tilde { color: ${COLORS.tilde}; }

.line-heading { font-weight: bold; }
.line-heading-1 { color: ${COLORS.heading}; }
.line-heading-2 { color: #fab387; }
.line-heading-3 { color: ${COLORS.keyword}; }
.line-heading-4 { color: ${COLORS.string}; }
.line-heading-5 { color: ${COLORS.link}; }
.line-heading-6 { color: ${COLORS.linkVisited}; }

.line-link {
  color: ${COLORS.link};
  text-decoration: underline;
  cursor: pointer;
}
.line-link:hover { color: #b4d0fb; }

.line-separator { color: ${COLORS.separator}; }
.line-code { color: ${COLORS.code}; background: ${COLORS.codeBg}; }
.line-ascii-art { color: ${COLORS.string}; letter-spacing: 0; }
.line-video-placeholder { color: ${COLORS.modeVideo}; font-weight: bold; }
.line-list-marker { color: ${COLORS.keyword}; }

.vim-cursor { background: ${COLORS.cursor}; color: ${COLORS.bg}; }
.vim-visual-select { background: ${COLORS.visual}; }
.vim-search-match { background: ${COLORS.search}; color: ${COLORS.bg}; }
.vim-search-current { background: #fab387; color: ${COLORS.bg}; }

.vim-statusline {
  display: flex;
  align-items: center;
  background: ${COLORS.statusBg};
  color: ${COLORS.statusText};
  height: 1.4em;
  padding: 0 1ch;
  user-select: none;
  white-space: nowrap;
  overflow: hidden;
}

.vim-statusline-mode {
  font-weight: bold;
  padding: 0 1ch;
  margin-right: 1ch;
}

.vim-statusline-mode-normal { background: ${COLORS.modeNormal}; color: ${COLORS.bg}; }
.vim-statusline-mode-visual { background: ${COLORS.modeVisual}; color: ${COLORS.bg}; }
.vim-statusline-mode-command { background: ${COLORS.modeCommand}; color: ${COLORS.bg}; }
.vim-statusline-mode-hint { background: ${COLORS.modeInsert}; color: ${COLORS.bg}; }
.vim-statusline-mode-video { background: ${COLORS.modeVideo}; color: ${COLORS.bg}; }

.vim-statusline-file {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
}

.vim-statusline-pos { margin-left: 2ch; color: ${COLORS.subtext}; }
.vim-statusline-scroll { margin-left: 2ch; width: 5ch; text-align: right; color: ${COLORS.subtext}; }

.vim-commandline {
  display: flex;
  align-items: center;
  background: ${COLORS.commandBg};
  color: ${COLORS.commandText};
  height: 1.4em;
  padding: 0 1ch;
  white-space: nowrap;
}

.vim-commandline-prefix { color: ${COLORS.keyword}; }

.vim-commandline-input {
  flex: 1;
  background: none;
  border: none;
  outline: none;
  color: ${COLORS.commandText};
  font-family: inherit;
  font-size: inherit;
  padding: 0; margin: 0;
}

.vim-commandline-message { color: ${COLORS.subtext}; }
.vim-commandline-error { color: ${COLORS.heading}; }

.vim-hint-label {
  position: absolute;
  background: ${COLORS.keyword};
  color: ${COLORS.bg};
  font-weight: bold;
  font-size: 12px;
  padding: 0 3px;
  z-index: 10;
  border-radius: 2px;
}

.vim-loading {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: ${COLORS.subtext};
}

@keyframes vim-spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

.vim-loading-spinner {
  margin-bottom: 1em;
  animation: vim-spin 1s linear infinite;
  width: 24px; height: 24px;
  border: 2px solid ${COLORS.overlay};
  border-top-color: ${COLORS.link};
  border-radius: 50%;
}

.vim-loading-text { font-size: 16px; }
`;
  }
}
