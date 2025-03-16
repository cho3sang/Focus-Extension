// Check the initial state and blocked sites from storage
chrome.storage.sync.get(['focusMode', 'blockedSites'], (data) => {
  if (data.focusMode) {
    enableTabBlocking(data.blockedSites || []);
    closeBlockedTabs(data.blockedSites || []); // Close preexisting blocked tabs
  }
});

// Listen for messages to enable or disable focus mode
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  chrome.storage.sync.get('blockedSites', (data) => {
    const blockedSites = data.blockedSites || [];
    if (request.action === 'enableFocusMode') {
      enableTabBlocking(blockedSites);
      closeBlockedTabs(blockedSites); // Close preexisting blocked tabs
      chrome.storage.sync.set({ focusMode: true });
    } else if (request.action === 'disableFocusMode') {
      disableTabBlocking();
      chrome.storage.sync.set({ focusMode: false });
    }
  });
});

// Enable tab blocking
function enableTabBlocking(blockedSites) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    chrome.storage.sync.get('focusMode', (data) => {
      if (data.focusMode && changeInfo.url) {
        // Check if the tab's hostname matches any blocked site or its subdomain
        const tabHostname = new URL(changeInfo.url).hostname;
        if (blockedSites.some(site => tabHostname.endsWith(site))) {
          chrome.tabs.remove(tabId);
        }
      }
    });
  });
}

// Disable tab blocking
function disableTabBlocking() {
  chrome.tabs.onUpdated.removeListener();
}

// Close or redirect any preexisting blocked tabs when enabling focus mode
function closeBlockedTabs(blockedSites) {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      const tabHostname = new URL(tab.url).hostname;
      if (blockedSites.some(site => tabHostname.endsWith(site))) {
        chrome.tabs.remove(tab.id); // Optionally redirect instead of closing
        // chrome.tabs.update(tab.id, { url: "chrome://newtab" }); // Redirect to new tab
      }
    });
  });
}
