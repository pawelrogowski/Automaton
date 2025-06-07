// /home/orimorfus/Documents/Automaton/frontend/scriptEditorPlain.js

// Assuming window.electron.ipcRenderer is available via preload.js
const { ipcRenderer } = window.electron;

let currentScript = null;

// Function to parse command line arguments to get the script ID
function getScriptIdFromArgs() {
  const args = process.argv;
  const scriptIdArg = args.find(arg => arg.startsWith('--script-id='));
  if (scriptIdArg) {
    return scriptIdArg.split('=')[1];
  }
  return null;
}

const scriptId = getScriptIdFromArgs();
console.log('Script Editor Window started for script ID:', scriptId);

// Listen for the script data from the main process
ipcRenderer.on('load-script-data', (event, scriptData) => {
  console.log('Received script data in renderer:', scriptData);
  currentScript = scriptData;

  // Update the UI with script data (placeholder)
  const editorDiv = document.getElementById('editor');
  if (editorDiv) {
    editorDiv.innerHTML = `
      <h2>Editing Script: ${scriptData.name}</h2>
      <p>ID: ${scriptData.id}</p>
      <textarea id="script-code" style="width: 100%; height: 400px;">${scriptData.code}</textarea>
    `;
  }
});

// Handle saving the script
const saveButton = document.getElementById('save-button');
if (saveButton) {
  saveButton.addEventListener('click', () => {
    if (currentScript) {
      const updatedCode = document.getElementById('script-code').value;
      const updatedScript = { ...currentScript, code: updatedCode };
      console.log('Attempting to save script:', updatedScript);
      // Send the updated script data back to the main process
      ipcRenderer.send('save-script-update', updatedScript);
       // Optionally, close the window after saving or show a success message
       // window.close();
    }
  });
}

// Request the script data from the main process once the window is ready
// We can do this here or rely on the 'did-finish-load' event in the main process
// For now, let's rely on the main process sending it after 'did-finish-load'

// If you wanted to request from here, you would do something like:
// ipcRenderer.send('request-script-data', scriptId);
