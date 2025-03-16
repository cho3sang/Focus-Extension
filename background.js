// Import the API key from config.js
import CONFIG from './config.js';

const apiKey = CONFIG.YOUTUBE_API_KEY;

// Global variables
let tabUpdateListener = null;

// Check the initial state and blocked sites from storage
chrome.storage.sync.get(['focusMode', 'blockedSites', 'userWhitelist'], (data) => {
  if (data.focusMode) {
    const blockedSites = data.blockedSites || [];
    const userWhitelist = data.userWhitelist || [];
    enableTabBlocking(blockedSites, userWhitelist);
    closeBlockedTabs(blockedSites, userWhitelist); // Close preexisting blocked tabs
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
  if (!tabUpdateListener) {
    tabUpdateListener = async function (tabId, changeInfo, tab) {
      if (changeInfo.url) {
        const data = await chrome.storage.sync.get('focusMode');
        if (data.focusMode) {
          const url = changeInfo.url;
          const shouldBlock = await shouldBlockUrl(url, blockedSites, userWhitelist);
          if (shouldBlock) {
            chrome.tabs.remove(tabId); // Remove the tab if it's blocked
          }
        }
      }
    };
    chrome.tabs.onUpdated.addListener(tabUpdateListener);
  }
}

// Disable tab blocking
function disableTabBlocking() {
  if (tabUpdateListener) {
    chrome.tabs.onUpdated.removeListener(tabUpdateListener);
    tabUpdateListener = null;
  }
}

// Close or redirect any preexisting blocked tabs when enabling focus mode
function closeBlockedTabs(blockedSites, userWhitelist) {
  chrome.tabs.query({}, async (tabs) => {
    for (const tab of tabs) {
      const url = tab.url;
      const shouldBlock = await shouldBlockUrl(url, blockedSites, userWhitelist);
      if (shouldBlock) {
        chrome.tabs.remove(tab.id); // Optionally redirect instead of closing
        // chrome.tabs.update(tab.id, { url: "chrome://newtab" }); // Redirect to new tab
      }
    }
  });
}

// Determine if a URL should be blocked
async function shouldBlockUrl(url, blockedSites, userWhitelist) {
  try {
    const parsedUrl = new URL(url);
    const tabHostname = parsedUrl.hostname;

    // Check if the site is in the blocked sites list
    const isBlockedSite = blockedSites.some((site) => tabHostname.endsWith(site));

    if (!isBlockedSite) {
      return false; // Not a blocked site
    }

    // Check if the URL is whitelisted
    const isAllowed = await isWhitelisted(url, userWhitelist);

    return !isAllowed; // Block if not whitelisted
  } catch (e) {
    console.error('Error parsing URL:', e);
    return false;
  }
}

// Fetch video details to get the channel ID
async function getVideoChannelId(videoUrl) {
  try {
    const videoId = new URL(videoUrl).searchParams.get('v');
    if (!videoId) return null;

    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=snippet&key=${apiKey}`
    );
    const data = await response.json();

    if (data.items && data.items.length > 0) {
      return data.items[0].snippet.channelId; // Return the channel ID of the video
    } else {
      console.error('No data found for video ID:', videoId);
      return null;
    }
  } catch (error) {
    console.error('Error fetching video details:', error);
    return null;
  }
}

// Resolve different channel URL formats to a single channel ID
async function resolveChannelUrlToId(channelUrl) {
  try {
    const parsedChannelUrl = new URL(channelUrl);
    const hostname = parsedChannelUrl.hostname;
    const pathname = parsedChannelUrl.pathname;
    const pathParts = pathname.split('/').filter(Boolean); // Remove empty strings

    if (!hostname.includes('youtube.com') || pathParts.length === 0) {
      return null;
    }

    const firstPart = pathParts[0];
    let channelId = null;

    if (firstPart === 'channel' && pathParts.length >= 2) {
      // URL like https://www.youtube.com/channel/UCabc123...
      channelId = pathParts[1];
    } else if (firstPart === 'c' && pathParts.length >= 2) {
      // URL like https://www.youtube.com/c/ChannelName
      const channelName = pathParts[1];
      channelId = await resolveChannelNameToId(channelName);
    } else if (firstPart.startsWith('@')) {
      // URL like https://www.youtube.com/@ChannelHandle
      const channelHandle = firstPart;
      channelId = await resolveChannelHandleToId(channelHandle);
    } else {
      // URL like https://www.youtube.com/ChannelName or a vanity URL
      const channelName = firstPart;
      channelId = await resolveChannelNameToId(channelName);
    }

    return channelId;
  } catch (error) {
    console.error('Error resolving channel URL:', error);
    return null;
  }
}

// Resolve a channel handle to a channel ID by fetching the channel page
async function resolveChannelHandleToId(channelHandle) {
  try {
    // Remove the '@' from the handle if present
    if (channelHandle.startsWith('@')) {
      channelHandle = channelHandle.substring(1);
    }
    const channelPageUrl = `https://www.youtube.com/@${channelHandle}`;

    const response = await fetch(channelPageUrl);
    const pageText = await response.text();

    // Use regex to find the canonical link
    const canonicalLinkMatch = pageText.match(/<link rel="canonical" href="(.*?)">/);
    if (canonicalLinkMatch && canonicalLinkMatch[1]) {
      const canonicalUrl = canonicalLinkMatch[1];
      const canonicalParsedUrl = new URL(canonicalUrl);
      const canonicalPathParts = canonicalParsedUrl.pathname.split('/').filter(Boolean);
      if (canonicalPathParts[0] === 'channel' && canonicalPathParts.length >= 2) {
        return canonicalPathParts[1]; // This is the channel ID
      }
    }

    console.error('Channel ID not found in canonical link');
    return null;
  } catch (error) {
    console.error('Error resolving channel handle to ID:', error);
    return null;
  }
}

// Resolve a channel name or handle to a channel ID using the YouTube Data API
async function resolveChannelNameToId(channelName) {
  try {
    // Try searching by username
    let apiUrl = `https://www.googleapis.com/youtube/v3/channels?part=id&forUsername=${encodeURIComponent(
      channelName
    )}&key=${apiKey}`;

    let response = await fetch(apiUrl);
    let data = await response.json();

    if (data.items && data.items.length > 0) {
      return data.items[0].id;
    }

    // If still no results, try searching by custom URL
    apiUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(
      channelName
    )}&type=channel&key=${apiKey}`;

    response = await fetch(apiUrl);
    data = await response.json();

    if (data.items && data.items.length > 0) {
      return data.items[0].id.channelId;
    }

    console.error('No channel found for name:', channelName);
    return null;
  } catch (error) {
    console.error('Error resolving channel name to ID:', error);
    return null;
  }
}

// Check if a URL is whitelisted
async function isWhitelisted(url, whitelist) {
  const parsedUrl = new URL(url);

  // Separate the whitelist into specific URLs and channel URLs
  const specificUrls = [];
  const channelUrls = [];

  for (const entry of whitelist) {
    try {
      const parsedEntryUrl = new URL(entry);
      const entryHostname = parsedEntryUrl.hostname;

      if (entryHostname.includes('youtube.com')) {
        const pathParts = parsedEntryUrl.pathname.split('/').filter(Boolean);

        if (
          pathParts[0] === 'channel' ||
          pathParts[0] === 'c' ||
          pathParts[0].startsWith('@') ||
          pathParts.length === 1
        ) {
          // It's a channel URL
          channelUrls.push(parsedEntryUrl);
        } else {
          // It's a specific video or playlist URL
          specificUrls.push(parsedEntryUrl);
        }
      } else {
        // Non-YouTube URLs are treated as specific URLs
        specificUrls.push(parsedEntryUrl);
      }
    } catch (e) {
      // If entry is not a valid URL, skip it or handle as needed
      console.error('Invalid whitelist URL:', e);
    }
  }

  // Check if the URL matches any specific URLs
  if (
    specificUrls.some((allowedUrl) => {
      try {
        if (parsedUrl.href === allowedUrl.href) return true;
        if (
          parsedUrl.hostname === allowedUrl.hostname &&
          parsedUrl.pathname === allowedUrl.pathname &&
          parsedUrl.search === allowedUrl.search
        ) {
          return true;
        }
        return false;
      } catch (e) {
        return false;
      }
    })
  ) {
    return true;
  }

  // If it's a YouTube URL, check if it's part of a whitelisted channel
  if (parsedUrl.hostname.includes('youtube.com')) {
    // Check if the URL is the channel's homepage or subpage
    for (const channelUrl of channelUrls) {
      if (isChannelUrlMatch(parsedUrl, channelUrl)) {
        return true;
      }
    }

    // If it's a video, check if the video's channel is whitelisted
    if (parsedUrl.pathname.includes('/watch')) {
      const videoChannelId = await getVideoChannelId(url);
      if (!videoChannelId) return false;

      // Resolve channel URLs to channel IDs
      const channelIdsWhitelist = await Promise.all(
        channelUrls.map(async (channelUrl) => {
          const channelId = await resolveChannelUrlToId(channelUrl.href);
          return channelId;
        })
      );

      // Check if the video's channel ID matches any allowed channel ID
      return channelIdsWhitelist.includes(videoChannelId);
    }
  }

  return false;
}

// Helper function to check if the URL matches a whitelisted channel URL
function isChannelUrlMatch(parsedUrl, channelUrl) {
  try {
    // Both URLs must be from YouTube
    if (!parsedUrl.hostname.includes('youtube.com') || !channelUrl.hostname.includes('youtube.com')) {
      return false;
    }

    // Extract the base path of the channel URL
    const channelBasePath = channelUrl.pathname.endsWith('/')
      ? channelUrl.pathname.slice(0, -1)
      : channelUrl.pathname;

    // Check if the current URL's path starts with the channel's base path
    return parsedUrl.pathname.startsWith(channelBasePath);
  } catch (e) {
    console.error('Error matching channel URL:', e);
    return false;
  }
}
