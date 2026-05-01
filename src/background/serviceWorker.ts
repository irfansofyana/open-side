chrome.runtime.onInstalled.addListener(() => {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
});

chrome.action.onClicked.addListener((tab) => {
  if (typeof tab.windowId !== "number") {
    return;
  }

  void chrome.sidePanel.open({ windowId: tab.windowId });
});
