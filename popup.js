document.getElementById('clearAll').addEventListener('click', async () => {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  
  if (tab) {
    chrome.tabs.sendMessage(tab.id, { action: 'clearAll' });
    window.close();
  }
});

document.getElementById('openOptions').addEventListener('click', () => {
  chrome.tabs.create({ url: chrome.runtime.getURL('options.html') });
});
