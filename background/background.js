import browserAPI from '../shared/browser-api.js';

// Track which tabs have VimAscii active
const activeTabs = new Set();

// Handle toolbar icon click → toggle VimAscii on the active tab
browserAPI.action.onClicked.addListener(async (tab) => {
  if (!tab.id) return;

  const isActive = activeTabs.has(tab.id);

  if (isActive) {
    activeTabs.delete(tab.id);
  } else {
    activeTabs.add(tab.id);
  }

  try {
    await browserAPI.tabs.sendMessage(tab.id, {
      type: 'TOGGLE_VIMASCII',
      active: !isActive,
    });
  } catch (e) {
    // Content script not yet injected; ignore
    activeTabs.delete(tab.id);
  }
});

// Clean up when tabs are closed
browserAPI.tabs.onRemoved?.addListener((tabId) => {
  activeTabs.delete(tabId);
});

// Handle messages from content scripts
browserAPI.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.type === 'GET_STATE' && sender.tab) {
    sendResponse({ active: activeTabs.has(sender.tab.id) });
    return false;
  }
  if (message.type === 'ACTIVATE' && sender.tab) {
    activeTabs.add(sender.tab.id);
    return false;
  }
  if (message.type === 'DEACTIVATE' && sender.tab) {
    activeTabs.delete(sender.tab.id);
    return false;
  }

  // Fetch image as data URL to bypass CORS for content scripts
  if (message.type === 'FETCH_IMAGE') {
    fetchImageAsDataURL(message.url).then((dataUrl) => {
      sendResponse({ dataUrl });
    }).catch(() => {
      sendResponse({ dataUrl: null });
    });
    return true; // keep message channel open for async response
  }

  return false;
});

/**
 * Fetch an image URL and convert to a base64 data URL.
 * Runs in the background (service worker / background script) which has
 * host_permissions and is not subject to page-level CORS restrictions.
 */
async function fetchImageAsDataURL(url) {
  if (!url || url.startsWith('data:') || url.startsWith('blob:')) return null;

  const response = await fetch(url, { credentials: 'include' });
  if (!response.ok) return null;

  const contentType = response.headers.get('content-type') || 'image/png';
  // Skip non-image responses (e.g. HTML error pages)
  if (!contentType.startsWith('image/')) return null;

  const buffer = await response.arrayBuffer();
  if (buffer.byteLength === 0) return null;

  const bytes = new Uint8Array(buffer);

  // Convert to base64 in chunks to avoid call stack overflow
  let binary = '';
  const chunkSize = 8192;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, i + chunkSize);
    binary += String.fromCharCode.apply(null, chunk);
  }

  return `data:${contentType};base64,${btoa(binary)}`;
}
