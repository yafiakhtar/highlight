// Create context menu on install
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "highlight-text",
      title: "Highlight",
      contexts: ["selection"]
      });
  chrome.contextMenus.create({
    id: "remove-highlight",
    title: "Remove Highlight",
    contexts: ["selection"]
    });
  });
});

// Handle context menu clicks
chrome.contextMenus.onClicked.addListener((info, tab) => {
  if (info.menuItemId === "highlight-text") {
    chrome.tabs.sendMessage(tab.id, { action: "highlight" }).catch(() => {});
  } else if (info.menuItemId === "remove-highlight") {
    chrome.tabs.sendMessage(tab.id, { action: "removeSelected" }).catch(() => {});
  }
});

// Handle keyboard shortcut
chrome.commands.onCommand.addListener((command, tab) => {
  if (command === "highlight-selection") {
    chrome.tabs.sendMessage(tab.id, { action: "highlight" }).catch(() => {});
  }
});
