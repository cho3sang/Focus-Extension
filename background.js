// Import the API key from config.js
import CONFIG from './config.js';

const apiKey = CONFIG.YOUTUBE_API_KEY;

// Cache for resolved channel IDs
const channelIdCache = {};

// Cache for resolved video channel IDs
const videoChannelIdCache = {};

// Set for whitelisted hostnames
const whitelistedHostnames = new Set();

// Global variables
let tabUpdateListener = null;

// Check the initial state and blocked sites from storage
chrome.storage.sync.get(['focusMode', 'blockedSites', 'userWhitelist'], (data) => {
  if (data.focusMode) {
    enableTabBlocking();
    closeBlockedTabs(); // Close preexisting blocked tabs
  }
});

// Listen for messages to enable or disable focus mode
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === 'enableFocusMode') {
    enableTabBlocking();
    closeBlockedTabs(); // Close preexisting blocked tabs
    chrome.storage.sync.set({ focusMode: true });
  } else if (request.action === 'disableFocusMode') {
    disableTabBlocking();
    chrome.storage.sync.set({ focusMode: false });
  }
});

// Listen for changes to blockedSites and userWhitelist to update blocking behavior
chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'sync' && (changes.blockedSites || changes.userWhitelist)) {
    chrome.storage.sync.get('focusMode', (data) => {
      if (data.focusMode) {
        // Re-enable tab blocking to pick up the new lists
        disableTabBlocking();
        enableTabBlocking();
        closeBlockedTabs();
      }
    });
  }
});

// Enable tab blocking with whitelist support
function enableTabBlocking() {
  if (!tabUpdateListener) {
    tabUpdateListener = async function (tabId, changeInfo, tab) {
      if (changeInfo.url) {
        const data = await chrome.storage.sync.get(['focusMode', 'blockedSites', 'userWhitelist']);
        if (data.focusMode) {
          const url = changeInfo.url;
          const blockedSites = data.blockedSites || [];
          const userWhitelist = data.userWhitelist || [];
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
function closeBlockedTabs() {
  chrome.storage.sync.get(['blockedSites', 'userWhitelist'], async (data) => {
    const blockedSites = data.blockedSites || [];
    const userWhitelist = data.userWhitelist || [];
    chrome.tabs.query({}, async (tabs) => {
      for (const tab of tabs) {
        const url = tab.url;
        const shouldBlock = await shouldBlockUrl(url, blockedSites, userWhitelist);
        if (shouldBlock) {
          chrome.tabs.remove(tab.id); // Optionally redirect instead of closing
        }
      }
    });
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

    if (videoChannelIdCache[videoId]) {
      return videoChannelIdCache[videoId];
    }

    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?id=${videoId}&part=snippet&key=${apiKey}`
    );

    if (!response.ok) {
      console.error(`API request failed: ${response.statusText}`);
      return null;
    }

    const data = await response.json();

    if (data.error) {
      console.error('API Error:', data.error);
      return null;
    }

    if (data.items && data.items.length > 0) {
      const channelId = data.items[0].snippet.channelId;
      videoChannelIdCache[videoId] = channelId;
      return channelId;
    } else {
      console.error('No data found for video ID:', videoId);
      return null;
    }
  } catch (error) {
    console.error('Error fetching video details:', error);
    return null;
  }
}

async function isWhitelisted(url, whitelist) {
  const parsedUrl = new URL(url);
  console.log('Checking URL:', parsedUrl.href);

  // Separate the whitelist into specific URLs, channel URLs, playlist IDs, and whitelisted hostnames
  const specificUrls = [];
  const channelUrls = [];
  const playlistIds = [];
  whitelistedHostnames.clear();

  for (const entry of whitelist) {
    try {
      const parsedEntryUrl = new URL(entry);
      const entryHostname = parsedEntryUrl.hostname;
      console.log('Whitelist Entry:', parsedEntryUrl.href);

      if (entryHostname.includes('youtube.com')) {
        const pathParts = parsedEntryUrl.pathname.split('/').filter(Boolean);

        if (
          pathParts[0] === 'channel' ||
          pathParts[0] === 'c' ||
          pathParts[0].startsWith('@')
        ) {
          // It's a channel URL
          channelUrls.push(parsedEntryUrl);
        } else if (pathParts[0] === 'playlist' || parsedEntryUrl.searchParams.has('list')) {
          // It's a playlist URL
          const playlistId = parsedEntryUrl.searchParams.get('list');
          if (playlistId && !playlistIds.includes(playlistId)) {
            playlistIds.push(playlistId);
          }
        } else if (parsedEntryUrl.pathname === '/watch' && parsedEntryUrl.searchParams.has('v')) {
          // It's a specific video URL
          specificUrls.push(parsedEntryUrl);
        } else {
          // Other URLs
          // Handle as needed
        }
      } else {
        // Non-YouTube URLs are treated as domain-level whitelist entries
        whitelistedHostnames.add(entryHostname);
      }
    } catch (e) {
      console.error('Invalid whitelist URL:', e);
    }
  }

  // Check if the URL's hostname is whitelisted
  if (whitelistedHostnames.has(parsedUrl.hostname)) {
    console.log('URL is on a whitelisted domain.');
    return true;
  }

  console.log('Specific URLs:', specificUrls.map((u) => u.href));
  console.log('Channel URLs:', channelUrls.map((u) => u.href));
  console.log('Playlist IDs:', playlistIds);

  // Check if the URL matches any specific URLs (e.g., specific video URLs)
  if (
    specificUrls.some((allowedUrl) => {
      try {
        return parsedUrl.href === allowedUrl.href;
      } catch (e) {
        return false;
      }
    })
  ) {
    console.log('URL is specifically whitelisted.');
    return true;
  }

  // If it's a YouTube URL
  if (parsedUrl.hostname.includes('youtube.com')) {
    const pathParts = parsedUrl.pathname.split('/').filter(Boolean);

    // Check if it's a video URL
    if (parsedUrl.pathname.includes('/watch')) {
      const videoId = parsedUrl.searchParams.get('v');
      console.log('Video ID:', videoId);

      if (videoId) {
        // Check if the video's channel is whitelisted
        const videoChannelId = await getVideoChannelId(url);
        console.log('Video Channel ID:', videoChannelId);

        if (videoChannelId) {
          // Resolve channel URLs to channel IDs
          const channelIdsWhitelist = await Promise.all(
            channelUrls.map(async (channelUrl) => {
              const channelId = await resolveChannelUrlToId(channelUrl.href);
              console.log(`Resolved Channel URL ${channelUrl.href} to ID: ${channelId}`);
              return channelId;
            })
          );

          console.log('Whitelisted Channel IDs:', channelIdsWhitelist);

          // Check if the video's channel ID matches any allowed channel ID
          if (channelIdsWhitelist.includes(videoChannelId)) {
            console.log('Video is from a whitelisted channel.');
            return true; // The video's channel is whitelisted
          }
        }

        // Check if the video is being accessed via a whitelisted playlist
        const listId = parsedUrl.searchParams.get('list');
        console.log('List ID in URL:', listId);
        console.log('Whitelisted Playlist IDs:', playlistIds);

        if (listId && playlistIds.includes(listId)) {
          console.log('Video is accessed via a whitelisted playlist.');
          return true; // The video is being accessed via a whitelisted playlist
        }

        console.log('Video is not allowed.');
        return false;
      } else {
        // It's a playlist being accessed via /watch without a video ID
        const listId = parsedUrl.searchParams.get('list');
        if (listId && playlistIds.includes(listId)) {
          console.log('Playlist is whitelisted.');
          return true; // The playlist is whitelisted
        }
      }
    } else if (pathParts[0] === 'playlist') {
      // It's a playlist page
      const listId = parsedUrl.searchParams.get('list');
      console.log('Playlist Page List ID:', listId);
      console.log('Whitelisted Playlist IDs:', playlistIds);

      if (listId && playlistIds.includes(listId)) {
        console.log('Playlist page is whitelisted.');
        return true; // The playlist page is whitelisted
      } else {
        console.log('Playlist page is not whitelisted.');
      }
    } else {
      // Check if the URL is the channel's homepage or subpage
      for (const channelUrl of channelUrls) {
        if (isChannelUrlMatch(parsedUrl, channelUrl)) {
          console.log('Channel page is whitelisted.');
          return true;
        }
      }
    }
  }

  // For all other URLs, they are not whitelisted
  console.log('URL is not whitelisted.');
  return false;
}


// Helper function to check if the URL matches a whitelisted channel URL
function isChannelUrlMatch(parsedUrl, channelUrl) {
  try {
    // Both URLs must be from YouTube
    if (
      !parsedUrl.hostname.includes('youtube.com') ||
      !channelUrl.hostname.includes('youtube.com')
    ) {
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

// Resolve different channel URL formats to a single channel ID
async function resolveChannelUrlToId(channelUrl) {
  if (channelIdCache[channelUrl]) {
    return channelIdCache[channelUrl];
  }

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

    channelIdCache[channelUrl] = channelId;
    return channelId;
  } catch (error) {
    console.error('Error resolving channel URL:', error);
    return null;
  }
}

// Resolve a channel handle to a channel ID using the YouTube Data API
async function resolveChannelHandleToId(channelHandle) {
  try {
    // Remove the '@' from the handle if present
    if (channelHandle.startsWith('@')) {
      channelHandle = channelHandle.substring(1);
    }

    const apiUrl = `https://www.googleapis.com/youtube/v3/channels?part=id&forUsername=${encodeURIComponent(
      channelHandle
    )}&key=${apiKey}`;

    let response = await fetch(apiUrl);

    if (!response.ok) {
      console.error(`API request failed: ${response.statusText}`);
      return null;
    }

    let data = await response.json();

    if (data.error) {
      console.error('API Error:', data.error);
      return null;
    }

    if (data.items && data.items.length > 0) {
      return data.items[0].id;
    }

    // If still no results, try searching by the handle
    const searchUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(
      channelHandle
    )}&type=channel&key=${apiKey}`;

    response = await fetch(searchUrl);

    if (!response.ok) {
      console.error(`API request failed: ${response.statusText}`);
      return null;
    }

    data = await response.json();

    if (data.error) {
      console.error('API Error:', data.error);
      return null;
    }

    if (data.items && data.items.length > 0) {
      return data.items[0].snippet.channelId;
    }

    console.error('No channel found for handle:', channelHandle);
    return null;
  } catch (error) {
    console.error('Error resolving channel handle to ID:', error);
    return null;
  }
}

// Resolve a channel name or custom URL to a channel ID using the YouTube Data API
async function resolveChannelNameToId(channelName) {
  try {
    // Try searching by username
    let apiUrl = `https://www.googleapis.com/youtube/v3/channels?part=id&forUsername=${encodeURIComponent(
      channelName
    )}&key=${apiKey}`;

    let response = await fetch(apiUrl);

    if (!response.ok) {
      console.error(`API request failed: ${response.statusText}`);
      return null;
    }

    let data = await response.json();

    if (data.error) {
      console.error('API Error:', data.error);
      return null;
    }

    if (data.items && data.items.length > 0) {
      return data.items[0].id;
    }

    // If still no results, try searching by custom URL
    apiUrl = `https://www.googleapis.com/youtube/v3/search?part=snippet&q=${encodeURIComponent(
      channelName
    )}&type=channel&key=${apiKey}`;

    response = await fetch(apiUrl);

    if (!response.ok) {
      console.error(`API request failed: ${response.statusText}`);
      return null;
    }

    data = await response.json();

    if (data.error) {
      console.error('API Error:', data.error);
      return null;
    }

    if (data.items && data.items.length > 0) {
      return data.items[0].snippet.channelId;
    }

    console.error('No channel found for name:', channelName);
    return null;
  } catch (error) {
    console.error('Error resolving channel name to ID:', error);
    return null;
  }
}

// Test function to check network access
async function testYouTubeApiAccess() {
  try {
    const testVideoId = 'Ks-_Mh1QhMc'; // Sample video ID
    const response = await fetch(
      `https://www.googleapis.com/youtube/v3/videos?id=${testVideoId}&part=snippet&key=${apiKey}`
    );

    if (!response.ok) {
      console.error(`Test Network response was not ok: ${response.statusText}`);
      return;
    }

    const data = await response.json();

    if (data.error) {
      console.error('Test API Error:', data.error);
    } else {
      console.log('Test API Access Successful:', data);
    }
  } catch (error) {
    console.error('Test Error fetching video details:', error);
  }
}

// Call the test function when the service worker starts
testYouTubeApiAccess();
