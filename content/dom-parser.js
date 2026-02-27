import { IMAGE_MIN_SIZE } from '../shared/constants.js';

const SKIP_TAGS = new Set([
  'SCRIPT', 'STYLE', 'NOSCRIPT', 'TEMPLATE', 'HEAD', 'META', 'LINK',
  'SVG', 'IFRAME', 'OBJECT', 'EMBED',
]);

export function parseDom(root = document.body) {
  const engine = new LayoutEngine();
  engine.process(root);
  return engine.getBlocks();
}

// ── Unit helpers ─────────────────────────────

/** CSS value → px number */
function px(v) { return parseFloat(v) || 0; }

/** Approx char-cell width at 14px monospace ≈ 8.4 px */
const CW = 8.4;

/** px → character columns */
function col(p) { return Math.max(0, Math.round(p / CW)); }

/** px → text rows  (line-height ≈ 19.6 px) */
function row(p) { return Math.max(0, Math.round(p / 19.6)); }

/** sRGB relative luminance */
function lum(r, g, b) {
  const f = c => { c /= 255; return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4; };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function parseRGB(s) {
  if (!s || s === 'transparent' || s === 'rgba(0, 0, 0, 0)') return null;
  const m = s.match(/rgba?\(\s*(\d+),\s*(\d+),\s*(\d+)/);
  return m ? [+m[1], +m[2], +m[3]] : null;
}

function isInvisible(fg, bg) {
  const a = parseRGB(fg), b = parseRGB(bg);
  if (!a || !b) return false;
  const l1 = lum(...a), l2 = lum(...b);
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05) < 1.15;
}

// ── Formatting context ───────────────────────
// Every block element pushes a context that tracks
// the available content width, left indent, text-align, text-indent.

function mkCtx(width, indent, align, textIndent) {
  return { width, indent, align, textIndent, firstLine: true };
}

// ── LayoutEngine ─────────────────────────────

class LayoutEngine {
  constructor() {
    this.blocks   = [];
    this.inlineBuf   = '';
    this.inlineLinks = [];
    this.listStack   = [];
    this.quoteDepth  = 0;
    this.preDepth    = 0;
    // Use viewport width in character columns so CSS margins/padding stay proportional
    const vpPx = document.documentElement.clientWidth || window.innerWidth || 1024;
    const vpCols = Math.max(80, col(vpPx));
    this.ctxStack    = [mkCtx(vpCols, 0, 'left', 0)];
  }

  get _ctx() { return this.ctxStack[this.ctxStack.length - 1]; }

  process(root)  { this._walk(root); this._flush(); }

  getBlocks() {
    const o = [];
    for (const b of this.blocks) {
      if (b.type === 'blank' && o.length && o[o.length - 1].type === 'blank') continue;
      o.push(b);
    }
    while (o.length && o[0].type === 'blank') o.shift();
    while (o.length && o[o.length - 1].type === 'blank') o.pop();

    // ── Indent normalisation ──
    // 1. Subtract global minimum indent (removes CSS centering margin: 0 auto)
    const DISPLAY_WIDTH = 80;
    const nonBlank = o.filter(b => b.type !== 'blank');
    const indents = nonBlank.map(b => b.indent || 0);
    if (indents.length) {
      const minI = Math.min(...indents);
      if (minI > 0) {
        for (const b of o) {
          if (b.indent != null) b.indent = Math.max(0, b.indent - minI);
        }
      }
    }

    // 2. If max indent is still too large, scale all indents proportionally
    //    so the deepest indent uses at most 25% of display width.
    const MAX_INDENT = Math.floor(DISPLAY_WIDTH * 0.25); // 20 cols
    const indents2 = nonBlank.map(b => b.indent || 0);
    const maxI = indents2.length ? Math.max(...indents2) : 0;
    if (maxI > MAX_INDENT) {
      const scale = MAX_INDENT / maxI;
      for (const b of o) {
        if (b.indent != null && b.indent > 0) {
          b.indent = Math.round(b.indent * scale);
        }
      }
    }

    // 3. Cap wrapWidth so indent + text fits within display width
    for (const b of o) {
      if (b.type === 'blank') continue;
      const ind = b.indent || 0;
      if (b.wrapWidth != null) {
        b.wrapWidth = Math.min(b.wrapWidth, Math.max(1, DISPLAY_WIDTH - ind));
      }
    }

    return o;
  }

  // ── context push / pop ──

  _pushCtx(el, style) {
    const par  = this._ctx;
    const rect = el.getBoundingClientRect();
    const boxW = col(rect.width);
    const pl   = col(px(style.paddingLeft));
    const pr   = col(px(style.paddingRight));
    const ml   = col(px(style.marginLeft));
    const ti   = col(px(style.textIndent));
    const align = style.textAlign || par.align;

    // Trust CSS layout: use getBoundingClientRect width directly
    const cw = boxW > 0 ? Math.max(1, boxW - pl - pr) : Math.max(1, par.width - ml - pl);

    this.ctxStack.push(mkCtx(cw, par.indent + ml + pl, align, ti));
  }

  _popCtx() { if (this.ctxStack.length > 1) this.ctxStack.pop(); }

  // ── main walk ──────────────────────────────

  _walk(node) {
    if (node.nodeType === Node.TEXT_NODE) { this._text(node); return; }
    if (node.nodeType !== Node.ELEMENT_NODE) return;

    const el = node, tag = el.tagName;
    if (SKIP_TAGS.has(tag) || el.id === 'vimascii-host' || el.hidden) return;

    let s;
    try { s = window.getComputedStyle(el); } catch { return; }

    const d = s.display;
    if (d === 'none') return;
    if (s.visibility === 'hidden' || s.visibility === 'collapse') return;
    if (s.opacity === '0') return;
    if (el.offsetWidth === 0 && el.offsetHeight === 0 && s.overflow !== 'visible') return;
    if (isInvisible(s.color, s.backgroundColor)) return;
    if (d === 'contents') { this._kids(el); return; }

    const blk = this._isBlk(d);
    const ws  = s.whiteSpace || '';
    const pre = ws === 'pre' || ws === 'pre-wrap' || ws === 'pre-line';

    // ── block pre ──
    if (blk) {
      this._flush();
      this._mblank(s, 'Top');
      this._pushCtx(el, s);
    }

    // ── element dispatch ──
    this._dispatch(el, tag, s, d, blk, pre);

    // ── block post ──
    if (blk) {
      this._flush();
      this._popCtx();
      this._mblank(s, 'Bottom');
    }
  }

  _dispatch(el, tag, s, d, blk, pre) {
    // BR
    if (tag === 'BR') { this._flush(); return; }

    // HR
    if (tag === 'HR') {
      const c = this._ctx;
      this.blocks.push({ type: 'separator', text: '─'.repeat(Math.min(c.width, 80)), indent: c.indent });
      return;
    }

    // VIDEO
    if (tag === 'VIDEO') { this._video(el); return; }

    // IMG
    if (tag === 'IMG') { this._img(el, s, blk); return; }

    // TABLE
    if (tag === 'TABLE' || d === 'table' || d === 'inline-table') {
      this._table(el, s);
      return;
    }

    // Heading
    const hm = tag.match(/^H([1-6])$/);
    if (hm) { this._heading(el, s, +hm[1]); return; }

    // Lists
    if (tag === 'UL' || tag === 'OL') {
      this.listStack.push({ type: tag === 'OL' ? 'ol' : 'ul', counter: 0 });
      this._kids(el);
      this.listStack.pop();
      return;
    }
    if (tag === 'LI' || d === 'list-item') { this._li(el, s); return; }

    // Definition list
    if (tag === 'DL') { this._kids(el); return; }
    if (tag === 'DT') {
      const c = this._extractInline(el), x = this._ctx;
      this.blocks.push({ type: 'text', text: c.text, links: c.links,
                          indent: x.indent, wrapWidth: x.width, align: x.align });
      return;
    }
    if (tag === 'DD') {
      const c = this._extractInline(el), x = this._ctx;
      const ei = Math.max(4, col(px(s.marginLeft) + px(s.paddingLeft)));
      this.blocks.push({ type: 'text', text: c.text, links: c.links,
                          indent: x.indent + ei, wrapWidth: Math.max(1, x.width - ei), align: x.align });
      return;
    }

    // PRE / CODE
    if (tag === 'PRE') { this._pre(el); return; }
    if (tag === 'CODE' && !this._inPre(el)) { this.inlineBuf += el.textContent; return; }

    // Blockquote
    if (tag === 'BLOCKQUOTE') {
      this.quoteDepth++;
      this._kids(el);
      this._flush();
      this.quoteDepth--;
      return;
    }

    // Details / Summary
    if (tag === 'DETAILS') {
      const sm = el.querySelector(':scope > summary');
      if (sm) {
        const x = this._ctx;
        this.blocks.push({ type: 'text', text: (el.open ? '▼ ' : '▶ ') + sm.textContent.trim(),
                            links: [], indent: x.indent, wrapWidth: x.width });
      }
      if (el.open) for (const ch of el.childNodes) { if (ch !== sm) this._walk(ch); }
      return;
    }
    if (tag === 'SUMMARY') return;

    // Form elements (inline)
    if (tag === 'INPUT')    { if (el.type !== 'hidden') this.inlineBuf += `[${el.value || el.placeholder || el.type}]`; return; }
    if (tag === 'BUTTON')   { this.inlineBuf += `[${el.textContent.trim()}]`; return; }
    if (tag === 'SELECT')   { const o = el.options?.[el.selectedIndex]; this.inlineBuf += `[${o ? o.text : 'select'}]`; return; }
    if (tag === 'TEXTAREA') { this.blocks.push({ type: 'code', lines: (el.value || el.placeholder || '').split('\n'), indent: this._ctx.indent }); return; }

    // Link (inline)
    if (tag === 'A' && el.href) { this._link(el, s); return; }

    // Generic — just walk children
    if (pre) this.preDepth++;
    this._kids(el);
    if (pre) this.preDepth--;
  }

  _kids(el) { for (const ch of el.childNodes) this._walk(ch); }

  // ── text node ──────────────────────────────

  _text(node) {
    let t = node.textContent;
    if (this.preDepth > 0) { this.inlineBuf += t; return; }

    const p = node.parentElement;
    if (p) {
      let ps;
      try { ps = window.getComputedStyle(p); } catch { /* */ }
      if (ps) {
        t = this._tt(t, ps.textTransform);
        const ls = px(ps.letterSpacing);
        if (ls >= CW * 0.8) t = t.split('').join(' ');
        const ws = px(ps.wordSpacing);
        if (ws >= CW * 2) { const n = Math.round(ws / CW); t = t.replace(/ /g, ' '.repeat(n)); }
      }
    }
    t = t.replace(/[\r\n\t]+/g, ' ').replace(/ {2,}/g, ' ');
    if (t.startsWith(' ') && (!this.inlineBuf.length || this.inlineBuf.endsWith(' '))) t = t.trimStart();
    if (t) this.inlineBuf += t;
  }

  // ── heading ────────────────────────────────

  _heading(el, s, lv) {
    const c = this._extractInline(el), x = this._ctx;
    const pfx = '#'.repeat(lv) + ' ';
    this.blocks.push({
      type: 'heading', level: lv,
      text: pfx + c.text.trim(),
      links: this._off(c.links, pfx.length),
      indent: x.indent, wrapWidth: x.width, align: x.align,
    });
  }

  // ── list item ──────────────────────────────

  _li(el, s) {
    const ctx = this._ctx;
    const lc  = this.listStack[this.listStack.length - 1];
    let marker;
    if (lc && lc.type === 'ol') { lc.counter++; marker = `${lc.counter}. `; }
    else {
      const lt = s.listStyleType;
      marker = lt === 'disc' ? '● ' : lt === 'circle' ? '○ ' : lt === 'square' ? '■ ' : lt === 'none' ? '' : '- ';
    }
    this.inlineBuf = marker;

    for (const ch of el.childNodes) {
      if (ch.nodeType === Node.ELEMENT_NODE && (ch.tagName === 'UL' || ch.tagName === 'OL')) {
        this._flush();
        this._walk(ch);
      } else {
        this._walk(ch);
      }
    }
    // final flush handled by post-block in _walk
  }

  // ── link (inline) ──────────────────────────

  _link(el) {
    const start = this.inlineBuf.length;
    this._kids(el);
    const end = this.inlineBuf.length;
    if (end > start) this.inlineLinks.push({ start, end, href: el.href });
  }

  // ── image ──────────────────────────────────

  _img(el, s, blk) {
    const src = el.src || el.dataset?.src || '';
    const alt = el.alt || '';
    const r   = el.getBoundingClientRect();
    if (r.width > 0 && r.height > 0 && r.width < IMAGE_MIN_SIZE && r.height < IMAGE_MIN_SIZE) return;
    if (!src) return;

    // Always emit as image block (inline images too — flush inline buffer first)
    if (!blk) this._flush();

    const x = this._ctx;
    this.blocks.push({
      type: 'image', src, alt,
      domElement: el,
      width: r.width, height: r.height,
      artWidth: Math.max(1, col(r.width)),
      artHeight: Math.max(1, row(r.height)),
      indent: x.indent,
    });
  }

  // ── video ─────────────────────────────────

  _video(el) {
    const r = el.getBoundingClientRect();
    if (r.width <= 0 || r.height <= 0) return;
    const x = this._ctx;
    this._flush();
    this.blocks.push({
      type: 'video',
      domElement: el,
      width: r.width,
      height: r.height,
      indent: x.indent,
    });
  }

  // ── pre / code ─────────────────────────────

  _pre(el) {
    const raw = el.textContent;
    if (!raw.trim()) return;
    const lines = raw.split('\n');
    while (lines.length && !lines[0].trim()) lines.shift();
    while (lines.length && !lines[lines.length - 1].trim()) lines.pop();
    this.blocks.push({ type: 'code', lines, indent: this._ctx.indent });
  }

  // ── table ──────────────────────────────────

  _table(tableEl) {
    const ctx = this._ctx;
    const tblW = ctx.width;

    const trs = (tableEl.tagName === 'TABLE' && tableEl.rows)
      ? Array.from(tableEl.rows)
      : Array.from(tableEl.querySelectorAll('tr'));

    if (!trs.length) { this._kids(tableEl); return; }

    const rows = [], hdrs = [];
    for (const tr of trs) {
      const inH = tr.parentElement?.tagName === 'THEAD';
      const cells = [];
      for (const td of tr.children) {
        if (td.tagName !== 'TD' && td.tagName !== 'TH') continue;
        const c  = this._extractInline(td);
        const cw = col(td.getBoundingClientRect().width);
        cells.push({ text: c.text.trim().replace(/\s+/g, ' '), isH: td.tagName === 'TH' || inH, links: c.links, cw });
      }
      if (!cells.length) continue;
      rows.push(cells);
      if (inH || cells.every(c => c.isH)) hdrs.push(rows.length - 1);
    }
    if (!rows.length) return;

    const nC = Math.max(...rows.map(r => r.length));
    const cW = new Array(nC).fill(0);
    for (const r of rows) for (let i = 0; i < r.length; i++) {
      cW[i] = Math.max(cW[i], r[i].text.length, Math.min(r[i].cw || 0, r[i].text.length + 4));
    }
    const avail = Math.max(20, tblW - (nC + 1) - nC * 2);
    const tot = cW.reduce((a, b) => a + b, 0);
    if (tot > avail) { const sc = avail / tot; for (let i = 0; i < cW.length; i++) cW[i] = Math.max(1, Math.round(cW[i] * sc)); }

    const bdr  = '+' + cW.map(w => '-'.repeat(w + 2)).join('+') + '+';
    const hbdr = '+' + cW.map(w => '='.repeat(w + 2)).join('+') + '+';
    const ind = ctx.indent;

    this.blocks.push({ type: 'table-border', text: bdr, indent: ind });
    for (let ri = 0; ri < rows.length; ri++) {
      const r = rows[ri]; let ln = '|'; const ll = [];
      for (let ci = 0; ci < nC; ci++) {
        const c = r[ci] || { text: '', links: [] };
        const tr2 = c.text.slice(0, cW[ci]);
        const cs = ln.length + 1;
        ln += ' ' + tr2.padEnd(cW[ci]) + ' |';
        for (const lk of (c.links || [])) { const a = Math.max(0, lk.start), b = Math.min(lk.end, tr2.length); if (b > a) ll.push({ start: cs + a, end: cs + b, href: lk.href }); }
      }
      this.blocks.push({ type: 'table-row', text: ln, links: ll, indent: ind });
      if (hdrs.includes(ri)) this.blocks.push({ type: 'table-border', text: hbdr, indent: ind });
    }
    if (!hdrs.includes(rows.length - 1)) this.blocks.push({ type: 'table-border', text: bdr, indent: ind });
  }

  // ── flush inline buffer → block ────────────

  _flush() {
    let text = this.inlineBuf.trimEnd();
    const links = this.inlineLinks.slice();
    this.inlineBuf = '';
    this.inlineLinks = [];
    if (!text) return;

    const ctx = this._ctx;

    if (this.quoteDepth > 0) {
      const p = '> '.repeat(this.quoteDepth);
      text = p + text;
      for (let i = 0; i < links.length; i++) links[i] = { ...links[i], start: links[i].start + p.length, end: links[i].end + p.length };
    }

    this.blocks.push({
      type: 'text', text, links,
      indent: ctx.indent,
      wrapWidth: ctx.width,
      align: ctx.align,
      textIndent: ctx.firstLine ? ctx.textIndent : 0,
    });
    ctx.firstLine = false;
  }

  // ── helpers ────────────────────────────────

  _blank() {
    const l = this.blocks[this.blocks.length - 1];
    if (!l || l.type !== 'blank') this.blocks.push({ type: 'blank', text: '' });
  }

  _mblank(s, side) {
    const m = px(s['margin' + side]) + px(s['padding' + side]);
    const n = Math.min(3, Math.floor(m / 20));
    for (let i = 0; i < n; i++) this._blank();
    if (!n && m > 8) this._blank();
  }

  _isBlk(d) {
    return d !== 'inline' && d !== 'inline-block' && d !== 'inline-flex' &&
           d !== 'inline-grid' && d !== 'inline-table' && d !== 'contents' &&
           d !== 'ruby' && d !== 'ruby-text' && d !== '';
  }

  _inPre(el) { let n = el.parentElement; while (n) { if (n.tagName === 'PRE') return true; n = n.parentElement; } return false; }

  _tt(t, tf) {
    if (!tf || tf === 'none') return t;
    if (tf === 'uppercase') return t.toUpperCase();
    if (tf === 'lowercase') return t.toLowerCase();
    if (tf === 'capitalize') return t.replace(/\b\w/g, c => c.toUpperCase());
    return t;
  }

  _extractInline(el) {
    let text = ''; const links = [];
    const w = n => {
      if (n.nodeType === Node.TEXT_NODE) {
        let t = n.textContent.replace(/\s+/g, ' ');
        const p = n.parentElement;
        if (p) { try { t = this._tt(t, window.getComputedStyle(p).textTransform); } catch {} }
        text += t; return;
      }
      if (n.nodeType !== Node.ELEMENT_NODE) return;
      if (SKIP_TAGS.has(n.tagName)) return;
      let ns; try { ns = window.getComputedStyle(n); } catch { return; }
      if (ns.display === 'none' || ns.visibility === 'hidden') return;
      if (n.tagName === 'BR')  { text += ' '; return; }
      if (n.tagName === 'IMG') { if (n.alt) text += `[${n.alt}]`; return; }
      if (n.tagName === 'A' && n.href) {
        const s = text.length; for (const ch of n.childNodes) w(ch); const e = text.length;
        if (e > s) links.push({ start: s, end: e, href: n.href }); return;
      }
      for (const ch of n.childNodes) w(ch);
    };
    w(el);
    return { text, links };
  }

  _off(links, n) { return links.map(l => ({ start: l.start + n, end: l.end + n, href: l.href })); }
}
