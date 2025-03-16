document.addEventListener('DOMContentLoaded', () => {
  // Elements related to focus mode
  const toggleButton = document.getElementById('toggleFocusMode');
  const notification = document.querySelector('.notification');

  // Elements related to the block list
  const siteInput = document.getElementById('siteInput');
  const blockSiteForm = document.getElementById('blockSiteForm');
  const blockedSitesList = document.getElementById('blockedSitesList');
  const blockListError = document.getElementById('blockListError');
  const blockListSuccess = document.getElementById('blockListSuccess');

  // Elements related to the whitelist
  const whitelistInput = document.getElementById('whitelistInput');
  const whitelistForm = document.getElementById('whitelistForm');
  const whitelistList = document.getElementById('whitelistList');
  const whitelistError = document.getElementById('whitelistError');
  const whitelistSuccess = document.getElementById('whitelistSuccess');

  // Elements for collapsible panels
  const toggleBlockedSites = document.getElementById('toggleBlockedSites');
  const toggleWhitelist = document.getElementById('toggleWhitelist');

  const defaultSites = ["youtube.com", "netflix.com", "primevideo.com", "tiktok.com"];

  // Load state and lists from storage
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

  // Handle Block Site Form Submission
  blockSiteForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const site = siteInput.value.trim();
    if (!site) return;

    // Clear previous messages
    blockListError.style.display = 'none';
    blockListSuccess.style.display = 'none';

    // Validate domain name pattern
    const domainPattern = /^[a-z0-9.-]+\.[a-z]{2,}$/i;
    if (!domainPattern.test(site)) {
      blockListError.textContent = 'Please enter a valid domain name.';
      blockListError.style.display = 'block';
      return;
    }

    chrome.storage.sync.get('blockedSites', (data) => {
      const blockedSites = data.blockedSites || [];
      if (!blockedSites.includes(site)) {
        blockedSites.push(site);
        chrome.storage.sync.set({ blockedSites }, () => {
          renderBlockedSites(blockedSites);
          siteInput.value = '';
          blockListSuccess.textContent = 'Site added to block list.';
          blockListSuccess.style.display = 'block';
          setTimeout(() => {
            blockListSuccess.style.display = 'none';
          }, 3000);
        });
      } else {
        blockListError.textContent = 'This site is already in the block list.';
        blockListError.style.display = 'block';
      }
    });
  });

  // Handle Whitelist Form Submission
  whitelistForm.addEventListener('submit', (event) => {
    event.preventDefault();
    const site = whitelistInput.value.trim();
    if (!site) return;

    // Clear previous messages
    whitelistError.style.display = 'none';
    whitelistSuccess.style.display = 'none';

    try {
      // Validate the URL
      const parsedUrl = new URL(site);
      chrome.storage.sync.get('userWhitelist', (data) => {
        const userWhitelist = data.userWhitelist || [];
        if (!userWhitelist.includes(site)) {
          userWhitelist.push(site);
          chrome.storage.sync.set({ userWhitelist }, () => {
            renderWhitelist(userWhitelist);
            whitelistInput.value = '';
            whitelistSuccess.textContent = 'Site added to whitelist.';
            whitelistSuccess.style.display = 'block';
            setTimeout(() => {
              whitelistSuccess.style.display = 'none';
            }, 3000);
          });
        } else {
          whitelistError.textContent = 'This site is already in the whitelist.';
          whitelistError.style.display = 'block';
        }
      });
    } catch (e) {
      whitelistError.textContent = 'Invalid URL. Please enter a valid URL.';
      whitelistError.style.display = 'block';
    }
  });

  // Render blocked sites list with hyperlinks
  function renderBlockedSites(sites) {
    blockedSitesList.innerHTML = '';
    sites.forEach((site, index) => {
      const siteRow = document.createElement('div');
      siteRow.classList.add('site-row');

      // Create hyperlink for the site
      const siteLink = document.createElement('a');
      siteLink.classList.add('site-name');
      siteLink.href = `https://${site}`;
      siteLink.target = '_blank';
      siteLink.textContent = site;

      const removeButton = document.createElement('button');
      removeButton.classList.add('button', 'is-small', 'is-danger', 'is-outlined', 'remove-button');
      removeButton.textContent = 'Remove';
      removeButton.addEventListener('click', () => {
        sites.splice(index, 1);
        chrome.storage.sync.set({ blockedSites: sites }, () => {
          renderBlockedSites(sites);
        });
      });

      siteRow.appendChild(siteLink);
      siteRow.appendChild(removeButton);
      blockedSitesList.appendChild(siteRow);
    });
  }

  // Render whitelist with hyperlinks
  function renderWhitelist(sites) {
    whitelistList.innerHTML = '';
    sites.forEach((site, index) => {
      const siteRow = document.createElement('div');
      siteRow.classList.add('site-row');

      // Create hyperlink for the site
      const siteLink = document.createElement('a');
      siteLink.classList.add('site-name');
      siteLink.href = site;
      siteLink.target = '_blank';

      // Extract a friendly name for display
      let displayName = site;
      try {
        const parsedUrl = new URL(site);
        if (parsedUrl.hostname.includes('youtube.com')) {
          const pathParts = parsedUrl.pathname.split('/').filter(Boolean);
          if (pathParts.length > 0) {
            displayName = pathParts.join('/');
          } else {
            displayName = 'YouTube';
          }
        } else {
          displayName = parsedUrl.hostname;
        }
      } catch (e) {
        // Leave displayName as site if parsing fails
      }

      siteLink.textContent = displayName;

      const removeButton = document.createElement('button');
      removeButton.classList.add('button', 'is-small', 'is-danger', 'is-outlined', 'remove-button');
      removeButton.textContent = 'Remove';
      removeButton.addEventListener('click', () => {
        sites.splice(index, 1);
        chrome.storage.sync.set({ userWhitelist: sites }, () => {
          renderWhitelist(sites);
        });
      });

      siteRow.appendChild(siteLink);
      siteRow.appendChild(removeButton);
      whitelistList.appendChild(siteRow);
    });
  }

  function setFocusMode(isEnabled) {
    notification.style.display = isEnabled ? 'block' : 'none';
    toggleButton.className = isEnabled ? 'button is-danger' : 'button is-success';
    toggleButton.textContent = isEnabled ? 'Disable Focus Mode' : 'Enable Focus Mode';
  }

  // Event listeners for collapsible panels
  toggleBlockedSites.addEventListener('click', () => {
    blockedSitesList.classList.toggle('is-hidden');
  });

  toggleWhitelist.addEventListener('click', () => {
    whitelistList.classList.toggle('is-hidden');
  });
});
