document.addEventListener('DOMContentLoaded', () => {
  const toggleButton = document.getElementById('toggleFocusMode');
  const notification = document.querySelector('.notification');
  const siteInput = document.getElementById('siteInput');
  const addSiteButton = document.getElementById('addSite');
  const blockedSitesList = document.getElementById('blockedSitesList');
  const whitelistInput = document.getElementById('whitelistInput');
  const addWhitelistButton = document.getElementById('addWhitelistSite');
  const whitelistList = document.getElementById('whitelistList');

  const defaultSites = ["youtube.com", "netflix.com", "primevideo.com", "tiktok.com"];

  // Load state and block list from storage
  chrome.storage.sync.get(['focusMode', 'blockedSites', 'userWhitelist'], (data) => {
    const focusModeEnabled = data.focusMode || false;
    const blockedSites = data.blockedSites && data.blockedSites.length > 0 ? data.blockedSites : defaultSites;
    const userWhitelist = data.userWhitelist || [];

    if (!data.blockedSites || data.blockedSites.length === 0) {
      chrome.storage.sync.set({ blockedSites });
    }

    setFocusMode(focusModeEnabled);
    renderBlockedSites(blockedSites);
    renderWhitelist(userWhitelist);
  });

  // Toggle focus mode
  toggleButton.addEventListener('click', () => {
    chrome.storage.sync.get('focusMode', (data) => {
      const focusModeEnabled = !data.focusMode;
      chrome.storage.sync.set({ focusMode: focusModeEnabled }, () => {
        setFocusMode(focusModeEnabled);
        chrome.runtime.sendMessage({
          action: focusModeEnabled ? 'enableFocusMode' : 'disableFocusMode'
        });
      });
    });
  });

  // Add a site to the block list
  addSiteButton.addEventListener('click', () => {
    const site = siteInput.value.trim();
    if (site) {
      chrome.storage.sync.get('blockedSites', (data) => {
        const blockedSites = data.blockedSites || [];
        if (!blockedSites.includes(site)) {
          blockedSites.push(site);
          chrome.storage.sync.set({ blockedSites }, () => {
            renderBlockedSites(blockedSites);
            siteInput.value = '';
          });
        }
      });
    }
  });

  // Add a site to the whitelist
  addWhitelistButton.addEventListener('click', () => {
    const site = whitelistInput.value.trim();
    if (site) {
      chrome.storage.sync.get('userWhitelist', (data) => {
        const userWhitelist = data.userWhitelist || [];
        if (!userWhitelist.includes(site)) {
          userWhitelist.push(site);
          chrome.storage.sync.set({ userWhitelist }, () => {
            renderWhitelist(userWhitelist);
            whitelistInput.value = '';
          });
        }
      });
    }
  });

  // Render blocked sites list
  function renderBlockedSites(sites) {
    blockedSitesList.innerHTML = '';
    sites.forEach((site, index) => {
      const siteRow = document.createElement('div');
      siteRow.classList.add('site-row');
      const siteName = document.createElement('span');
      siteName.classList.add('site-name');
      siteName.textContent = site;
      const removeButton = document.createElement('button');
      removeButton.classList.add('button', 'is-small', 'is-danger', 'is-outlined', 'remove-button');
      removeButton.textContent = 'Remove';
      removeButton.addEventListener('click', () => {
        sites.splice(index, 1);
        chrome.storage.sync.set({ blockedSites: sites }, () => {
          renderBlockedSites(sites);
        });
      });
      siteRow.appendChild(siteName);
      siteRow.appendChild(removeButton);
      blockedSitesList.appendChild(siteRow);
    });
  }

  // Render whitelist
  function renderWhitelist(sites) {
    whitelistList.innerHTML = '';
    sites.forEach((site, index) => {
      const siteRow = document.createElement('div');
      siteRow.classList.add('site-row');
      const siteName = document.createElement('span');
      siteName.classList.add('site-name');
      siteName.textContent = site;
      const removeButton = document.createElement('button');
      removeButton.classList.add('button', 'is-small', 'is-danger', 'is-outlined', 'remove-button');
      removeButton.textContent = 'Remove';
      removeButton.addEventListener('click', () => {
        sites.splice(index, 1);
        chrome.storage.sync.set({ userWhitelist: sites }, () => {
          renderWhitelist(sites);
        });
      });
      siteRow.appendChild(siteName);
      siteRow.appendChild(removeButton);
      whitelistList.appendChild(siteRow);
    });
  }

  function setFocusMode(isEnabled) {
    notification.style.display = isEnabled ? 'block' : 'none';
    toggleButton.className = isEnabled ? 'button is-danger' : 'button is-success';
    toggleButton.textContent = isEnabled ? 'Disable Focus Mode' : 'Enable Focus Mode';
  }
});
