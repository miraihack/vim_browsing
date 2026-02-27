/**
 * Convert parsed content blocks into flat buffer lines for the Vim overlay.
 *
 * Each block from dom-parser may carry CSS-derived layout metadata:
 *   indent     – left indent in character columns
 *   wrapWidth  – content wrap width in characters
 *   align      – text-align (left | center | right)
 *   textIndent – first-line extra indent in characters
 */
export function renderBlocks(blocks, maxWidth = 80) {
  const lines = [];

  for (const block of blocks) {
    const ind = block.indent || 0;

    switch (block.type) {
      case 'heading': {
        const w = block.wrapWidth || maxWidth;
        const wrapped = wrapPlain(block.text, w);
        for (const wl of wrapped) {
          lines.push({
            type: 'heading', level: block.level,
            text: pad(ind) + alignLine(wl, block.align, w),
            links: shiftLinks(block.links, ind, block.text, wl),
          });
        }
        break;
      }

      case 'text':
        wrapText(block, maxWidth, lines);
        break;

      case 'video':
        lines.push({
          type: 'video-placeholder',
          text: pad(ind) + '[VIDEO - Enterで再生]',
          links: [],
          videoElement: block.domElement,
        });
        break;

      case 'image':
        if (block.asciiLines && block.asciiLines.length > 0) {
          for (const artLine of block.asciiLines) {
            lines.push({ type: 'ascii-art', text: pad(ind) + artLine });
          }
          if (block.alt) {
            lines.push({ type: 'text', text: pad(ind) + `  [${block.alt}]`, links: [] });
          }
        } else {
          const label = block.alt ? `[IMAGE: ${block.alt}]` : '[IMAGE]';
          lines.push({ type: 'text', text: pad(ind) + label, links: [] });
        }
        break;

      case 'separator':
        lines.push({ type: 'separator', text: pad(ind) + block.text });
        break;

      case 'code':
        if (block.lines) {
          lines.push({ type: 'separator', text: pad(ind) + '```' });
          for (const cl of block.lines) {
            lines.push({ type: 'code', text: pad(ind) + cl });
          }
          lines.push({ type: 'separator', text: pad(ind) + '```' });
        }
        break;

      case 'table-border':
        lines.push({ type: 'separator', text: pad(ind) + block.text });
        break;

      case 'table-row':
        lines.push({ type: 'text', text: pad(ind) + block.text,
                      links: (block.links || []).map(l => ({ ...l, start: l.start + ind, end: l.end + ind })) });
        break;

      case 'blank':
        if (!lines.length || lines[lines.length - 1].type !== 'blank') {
          lines.push({ type: 'blank', text: '' });
        }
        break;

      default:
        if (block.text) {
          lines.push({ type: 'text', text: pad(ind) + block.text,
                        links: (block.links || []).map(l => ({ ...l, start: l.start + ind, end: l.end + ind })) });
        }
        break;
    }
  }

  while (lines.length && lines[lines.length - 1].type === 'blank') lines.pop();
  return lines;
}

// ── helpers ──────────────────────────────────

function pad(n) { return n > 0 ? ' '.repeat(n) : ''; }

/** Align text within width. */
function alignLine(text, align, width) {
  if (!align || align === 'left' || align === 'start') return text;
  const gap = Math.max(0, width - text.length);
  if (align === 'center') return pad(Math.floor(gap / 2)) + text;
  if (align === 'right' || align === 'end') return pad(gap) + text;
  return text;
}

/** Simple word wrap without metadata, returns string[]. */
function wrapPlain(text, width) {
  if (text.length <= width) return [text];
  const out = []; let pos = 0;
  while (pos < text.length) {
    let end = pos + width;
    if (end >= text.length) { end = text.length; }
    else { const sp = text.lastIndexOf(' ', end); if (sp > pos) end = sp + 1; }
    if (end === pos) end = pos + width;
    out.push(text.slice(pos, end)); pos = end;
  }
  return out;
}

/** Only return links that overlap with a single wrapped line.  Very rough. */
function shiftLinks(allLinks, indentCols, fullText, lineText) {
  if (!allLinks || !allLinks.length) return [];
  return allLinks
    .filter(l => lineText.includes(fullText.slice(l.start, l.end)))
    .map(l => {
      const idx = lineText.indexOf(fullText.slice(l.start, l.end));
      return idx >= 0 ? { start: idx + indentCols, end: idx + (l.end - l.start) + indentCols, href: l.href } : null;
    })
    .filter(Boolean);
}

/**
 * Word-wrap a text block respecting its CSS-derived metadata.
 */
function wrapText(block, maxWidth, out) {
  const text = block.text || '';
  const links = block.links || [];
  const ind = block.indent || 0;
  const wrapW = block.wrapWidth || (maxWidth - ind);
  const align = block.align || 'left';
  const ti = block.textIndent || 0;

  // Detect hanging indent for list markers
  const markerMatch = text.match(/^([●○■\-*] |\d+\.\s)/);
  const hangW = markerMatch ? markerMatch[1].length : 0;

  if (text.length + ti <= wrapW && !ti) {
    // Fits on one line — just indent + align
    const aligned = alignLine(text, align, wrapW);
    out.push({ type: 'text', text: pad(ind) + aligned,
               links: links.map(l => ({ ...l, start: l.start + ind, end: l.end + ind })) });
    return;
  }

  let pos = 0;
  let first = true;

  while (pos < text.length) {
    const extra = first ? ti : (hangW ? hangW : 0);
    const lineW = Math.max(1, wrapW - extra);
    let end = pos + lineW;

    if (end >= text.length) { end = text.length; }
    else { const sp = text.lastIndexOf(' ', end); if (sp > pos) end = sp + 1; }
    if (end === pos) end = pos + lineW; // prevent infinite loop

    const slice = text.slice(pos, end);
    const prefix = first ? pad(extra) : (hangW ? pad(extra) : '');
    const raw = prefix + slice;
    const aligned = alignLine(raw, align, wrapW);
    const totalPad = ind;

    // Map links
    const lineLinks = [];
    for (const lk of links) {
      if (lk.end <= pos || lk.start >= end) continue;
      const off = prefix.length + totalPad;
      lineLinks.push({
        start: Math.max(0, lk.start - pos) + off,
        end:   Math.min(slice.length, lk.end - pos) + off,
        href: lk.href,
      });
    }

    out.push({ type: 'text', text: pad(totalPad) + aligned, links: lineLinks });
    pos = end;
    first = false;
  }
}
