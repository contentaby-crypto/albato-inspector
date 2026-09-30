const ALBATO_URL = /^https:\/\/(?:[^/]+\.)?albato\.(?:com|ru)\//i;

function delay(milliseconds) {
  return new Promise(resolve => setTimeout(resolve, milliseconds));
}

function waitForTabComplete(tabId, timeout = 15000) {
  return new Promise((resolve, reject) => {
    let finished = false;
    const timer = setTimeout(() => finish(new Error('Журнал не загрузился за отведенное время.')), timeout);

    function cleanup() {
      clearTimeout(timer);
      chrome.tabs.onUpdated.removeListener(onUpdated);
    }

    function finish(error, tab) {
      if (finished) return;
      finished = true;
      cleanup();
      if (error) reject(error);
      else resolve(tab);
    }

    function onUpdated(updatedTabId, changeInfo, tab) {
      if (updatedTabId === tabId && changeInfo.status === 'complete') finish(null, tab);
    }

    chrome.tabs.onUpdated.addListener(onUpdated);
    chrome.tabs.get(tabId)
      .then(tab => {
        if (tab.status === 'complete') finish(null, tab);
      })
      .catch(error => finish(error));
  });
}

async function captureJournal(url, sourceTabId) {
  if (!ALBATO_URL.test(url)) throw new Error('Недопустимый URL журнала Albato.');
  let tab = null;
  let originalWindowId = null;
  try {
    if (sourceTabId) {
      try { originalWindowId = (await chrome.tabs.get(sourceTabId)).windowId; } catch (_) { /* optional */ }
    }
    tab = await chrome.tabs.create({ url, active: false });
    await waitForTabComplete(tab.id);
    let lastAudit = null;

    // First try without focus. Albato often does not render SPA rows in a hidden tab.
    for (let attempt = 0; attempt < 4; attempt += 1) {
      await delay(attempt === 0 ? 800 : 700);
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: 'CAPTURE_AUDIT', mode: 'journal' });
        if (response?.ok && response.audit) {
          lastAudit = response.audit;
          await chrome.storage.local.set({ latestJournalAudit: lastAudit });
          if (response.audit.page?.readability?.status === 'readable') return response.audit;
        }
      } catch (_) {
        // Retry while the SPA content script is loading.
      }
    }

    // Explicit journal mode may temporarily activate the tab so Albato renders rows.
    await chrome.tabs.update(tab.id, { active: true });
    await delay(900);
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await delay(attempt === 0 ? 300 : 700);
      try {
        const response = await chrome.tabs.sendMessage(tab.id, { type: 'CAPTURE_AUDIT', mode: 'journal' });
        if (response?.ok && response.audit) {
          lastAudit = response.audit;
          await chrome.storage.local.set({ latestJournalAudit: lastAudit });
          if (response.audit.page?.readability?.status === 'readable') return response.audit;
        }
      } catch (_) {
        // Retry while the SPA refreshes its visible journal.
      }
    }
    if (lastAudit) return lastAudit;
    throw new Error('Вкладка журнала не вернула данные.');
  } finally {
    if (sourceTabId) {
      try { await chrome.tabs.update(sourceTabId, { active: true }); } catch (_) { /* optional */ }
    }
    if (tab?.id) {
      try { await chrome.tabs.remove(tab.id); } catch (_) { /* tab may already be closed */ }
    }
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type !== 'CAPTURE_JOURNAL') return undefined;
  captureJournal(message.url, sender?.tab?.id)
    .then(audit => sendResponse({ ok: true, audit }))
    .catch(error => sendResponse({ ok: false, error: error?.message || String(error) }));
  return true;
});
