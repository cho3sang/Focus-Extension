// Check the initial state and blocked sites from storage
chrome.storage.sync.get(['focusMode', 'blockedSites', 'userWhitelist'], (data) => {
  if (data.focusMode) {
    enableTabBlocking(data.blockedSites || [], data.userWhitelist || []);
    closeBlockedTabs(data.blockedSites || [], data.userWhitelist || []); // Close preexisting blocked tabs
  }
});

// Listen for messages to enable or disable focus mode
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  chrome.storage.sync.get(['blockedSites', 'userWhitelist'], (data) => {
    const blockedSites = data.blockedSites || [];
    const userWhitelist = data.userWhitelist || [];
    if (request.action === 'enableFocusMode') {
      enableTabBlocking(blockedSites, userWhitelist);
      closeBlockedTabs(blockedSites, userWhitelist); // Close preexisting blocked tabs
      chrome.storage.sync.set({ focusMode: true });
    } else if (request.action === 'disableFocusMode') {
      disableTabBlocking();
      chrome.storage.sync.set({ focusMode: false });
    }
  });
});

// Enable tab blocking with whitelist support
function enableTabBlocking(blockedSites, userWhitelist) {
  chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
    chrome.storage.sync.get('focusMode', (data) => {
      if (data.focusMode && changeInfo.url) {
        const tabHostname = new URL(changeInfo.url).hostname;
        
        // Only block if it's not in the whitelist
        if (
          blockedSites.some(site => tabHostname.endsWith(site)) &&
          !isWhitelisted(changeInfo.url, userWhitelist)
        ) {
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
function closeBlockedTabs(blockedSites, userWhitelist) {
  chrome.tabs.query({}, (tabs) => {
    tabs.forEach((tab) => {
      const tabHostname = new URL(tab.url).hostname;
      if (
        blockedSites.some(site => tabHostname.endsWith(site)) &&
        !isWhitelisted(tab.url, userWhitelist)
      ) {
        chrome.tabs.remove(tab.id); // Optionally redirect instead of closing
        // chrome.tabs.update(tab.id, { url: "chrome://newtab" }); // Redirect to new tab
      }
    });
  });
}

// Check if a URL is whitelisted based on user-provided entries, including specific videos and playlists
function isWhitelisted(url, whitelist) {
  return whitelist.some(allowedUrl => {
    try {
      const parsedAllowedUrl = new URL(allowedUrl);
      const parsedUrl = new URL(url);

      // Check if the same domain (e.g., youtube.com)
      if (parsedUrl.hostname.includes(parsedAllowedUrl.hostname)) {
        
        // Check for exact match for video URLs
        if (parsedUrl.href === parsedAllowedUrl.href) {
          return true;
        }

        // Check for playlist match: if the URL is part of a playlist, ignore specific video IDs
        if (parsedUrl.pathname === parsedAllowedUrl.pathname && parsedUrl.searchParams.get('list') === parsedAllowedUrl.searchParams.get('list')) {
          return true;
        }
      }
      return false;
    } catch (e) {
      // Fallback to basic string match if URL parsing fails
      return url.includes(allowedUrl);
    }
  });
}
