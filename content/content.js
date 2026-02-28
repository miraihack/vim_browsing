import browserAPI from '../shared/browser-api.js';
import { parseDom } from './dom-parser.js';
import { convertAllImages } from './ascii-converter.js';
import { renderBlocks } from './vim-renderer.js';
import { VimOverlay } from './vim-overlay.js';
import { VimKeybindings } from './vim-keybindings.js';

let overlay = null;
let keybindings = null;
let isActive = false;

/**
 * Main activation: parse DOM → convert images → render in Vim overlay.
 */
async function activate() {
  if (isActive) return;
  isActive = true;

  // Create overlay with loading screen
  overlay = new VimOverlay();
  overlay.create();
  overlay.show();

  showLoading();

  try {
    // Phase 1: Parse DOM
    const blocks = parseDom(document.body);

    // Phase 1.5: YouTube fallback — if no video blocks found, try direct <video> detection
    if (!blocks.some(b => b.type === 'video')) {
      const vid = document.querySelector('video');
      if (vid) {
        const r = vid.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) {
          blocks.push({ type: 'video', domElement: vid, width: r.width, height: r.height, indent: 0 });
        }
      }
    }

    // Phase 2: Convert images to ASCII
    await convertAllImages(blocks);

    // Guard: overlay may have been destroyed during async image conversion
    if (!overlay) return;

    // Phase 3: Render blocks to buffer lines
    const lines = renderBlocks(blocks);

    // Phase 4: Display in overlay
    overlay.setLines(lines);

    // Phase 5: Attach keybindings
    keybindings = new VimKeybindings(overlay);
    keybindings.onQuit = deactivate;
    keybindings.attach();

    overlay.render();

    // Auto-enter video mode if a video is present
    const videoBlock = blocks.find(b => b.type === 'video' && b.domElement);
    if (videoBlock) {
      keybindings.enterVideoMode(videoBlock.domElement);
    }
  } catch (e) {
    console.error('[VimAscii] Error during activation:', e);
    overlay?.getCommandline()?.showMessage('Error: ' + e.message, true);
  }
}

function showLoading() {
  if (!overlay || !overlay.viewportEl) return;
  overlay.viewportEl.innerHTML = '';
  const loading = document.createElement('div');
  loading.className = 'vim-loading';

  const spinner = document.createElement('div');
  spinner.className = 'vim-loading-spinner';

  const text = document.createElement('div');
  text.className = 'vim-loading-text';
  text.textContent = 'Converting page to ASCII...';

  loading.appendChild(spinner);
  loading.appendChild(text);
  overlay.viewportEl.appendChild(loading);
}

function deactivate() {
  if (!isActive) return;
  isActive = false;

  if (keybindings) {
    keybindings.detach();
    keybindings = null;
  }

  if (overlay) {
    overlay.destroy();
    overlay = null;
  }

  // Notify background script
  try {
    browserAPI.runtime.sendMessage({ type: 'DEACTIVATE' });
  } catch (e) {
    // Ignore
  }
}

// Listen for toggle messages from background
browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'TOGGLE_VIMASCII') {
    if (message.active) {
      activate();
    } else {
      deactivate();
    }
  }
  return false;
});

// Auto-activate if this tab was already in Vim mode (persists across navigations).
// Background tracks activeTabs per tab ID, which survives page navigations.
Promise.resolve()
  .then(() => browserAPI.runtime.sendMessage({ type: 'GET_STATE' }))
  .then((response) => {
    if (response?.active && !isActive) {
      activate();
    }
  })
  .catch(() => {});
