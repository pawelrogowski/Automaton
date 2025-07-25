// Automaton/electron/widget/renderer.js

// Function to get current state from main process
async function getInitialStates() {
  try {
    const states = await window.electronAPI.invoke('get-control-states');
    if (states) {
      document.getElementById('healing-switch').checked = states.isRulesEnabled;
      document.getElementById('cavebot-switch').checked =
        states.isCavebotEnabled;
      document.getElementById('targeting-switch').checked =
        states.isTargetingEnabled;
      document.getElementById('scripts-switch').checked = states.isLuaEnabled;
    }
  } catch (error) {
    console.error('Error getting initial states:', error);
  }
}

// Function to handle switch changes
function handleSwitchChange(switchId, feature) {
  const switchElement = document.getElementById(switchId);
  switchElement.addEventListener('change', () => {
    window.electronAPI.send('update-bot-status', {
      feature,
      isEnabled: switchElement.checked,
    });
  });
}

// Function to handle state updates from main process
function handleStateUpdates() {
  window.electronAPI.on('state-update', (event, action) => {
    // Update switches based on state changes from main process
    switch (action.type) {
      case 'rules/setenabled':
        document.getElementById('healing-switch').checked = action.payload;
        break;
      case 'cavebot/setenabled':
        document.getElementById('cavebot-switch').checked = action.payload;
        break;
      case 'targeting/setenabled':
        document.getElementById('targeting-switch').checked = action.payload;
        break;
      case 'lua/setenabled':
        document.getElementById('scripts-switch').checked = action.payload;
        break;
    }
  });
}

// Function to update main window toggle button
async function updateMainWindowToggle() {
  const isVisible = await window.electronAPI.invoke('is-main-window-visible');
  const toggleIcon = document.getElementById('toggle-main-icon');

  if (isVisible) {
    toggleIcon.textContent = '🗔';
  } else {
    toggleIcon.textContent = '🗔';
  }
}

// Function to handle main window toggle
function handleMainWindowToggle() {
  const toggleBtn = document.getElementById('toggle-main-btn');
  toggleBtn.addEventListener('click', async () => {
    await window.electronAPI.invoke('toggle-main-window');
    await updateMainWindowToggle();
  });
}

// Initialize the widget when DOM is loaded
document.addEventListener('DOMContentLoaded', async () => {
  // Get initial states
  await getInitialStates();
  await updateMainWindowToggle();

  // Set up switch change handlers
  handleSwitchChange('healing-switch', 'healing');
  handleSwitchChange('cavebot-switch', 'cavebot');
  handleSwitchChange('targeting-switch', 'targeting');
  handleSwitchChange('scripts-switch', 'scripts');

  // Set up state update listener
  handleStateUpdates();

  // Set up main window toggle
  handleMainWindowToggle();
});

// Clean up listeners when window is closed
window.addEventListener('beforeunload', () => {
  window.electronAPI.removeListener('state-update', handleStateUpdates);
});
