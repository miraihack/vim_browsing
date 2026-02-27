// Unified browser API wrapper for Chrome and Firefox
const api = typeof browser !== 'undefined' ? browser : chrome;

export const browserAPI = {
  runtime: {
    onMessage: api.runtime.onMessage,
    sendMessage: (...args) => api.runtime.sendMessage(...args),
    onInstalled: api.runtime.onInstalled,
  },
  action: api.action || api.browserAction,
  tabs: api.tabs,
};

export default browserAPI;
