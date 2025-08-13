document.addEventListener('DOMContentLoaded', async () => {
  const windowList = document.getElementById('window-list');
  const selectButton = document.getElementById('select-button');
  const refreshButton = document.getElementById('refresh-button');
  const exitButton = document.getElementById('exit-button');
  const messageElement = document.getElementById('message');

  let availableWindows = [];

  const fetchWindows = async () => {
    messageElement.textContent = 'Searching for Tibia windows...';
    selectButton.disabled = true;
    windowList.innerHTML = ''; // Clear previous list

    try {
      availableWindows = await window.electronAPI.getTibiaWindowList();
      if (availableWindows.length > 0) {
        availableWindows.forEach((win) => {
          const option = document.createElement('option');
          option.value = win.windowId;
          option.textContent = `${win.name} (ID: ${win.windowId}, Display: ${win.display})`; // Assuming display info is added
          windowList.appendChild(option);
        });
        windowList.selectedIndex = 0; // Select the first one by default
        selectButton.disabled = false;
        messageElement.textContent = `${availableWindows.length} Tibia window(s) found.`;
      } else {
        const option = document.createElement('option');
        option.value = '';
        option.textContent = 'No Tibia windows found.';
        windowList.appendChild(option);
        messageElement.textContent =
          'No Tibia windows found. Please ensure Tibia is running.';
      }
    } catch (error) {
      console.error('Failed to fetch window list:', error);
      messageElement.textContent = `Error: ${error.message}. Could not retrieve window list.`;
      const option = document.createElement('option');
      option.value = '';
      option.textContent = 'Error loading windows.';
      windowList.appendChild(option);
    }
  };

  selectButton.addEventListener('click', () => {
    const selectedIndex = windowList.selectedIndex;
    if (selectedIndex !== -1) {
      const selectedWindow = availableWindows[selectedIndex];
      if (selectedWindow) {
        window.electronAPI.selectTibiaWindow(
          selectedWindow.windowId,
          selectedWindow.display,
          selectedWindow.name,
        ); // Pass ID, display, and window title
      }
    }
  });

  refreshButton.addEventListener('click', fetchWindows);
  exitButton.addEventListener('click', () => {
    window.electronAPI.exitApp();
  });

  // Initial fetch
  fetchWindows();
});
