const { BrowserWindow, Menu, dialog } = require('electron');
const { exec, fork } = require('child_process');
const url = require('url');
const path = require('path');

let mainWindow;
let selectedWindowId;
let workerProcess;

const createWindow = () => {
  mainWindow = new BrowserWindow({
    width: 1000,
    height: 720,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: path.join(__dirname, 'preload.js'),
    },
  });

  const startUrl =
    process.env.ELECTRON_START_URL ||
    url.format({
      pathname: path.join(__dirname, '/../dist/index.html'),
      protocol: 'file:',
      slashes: true,
    });

  mainWindow.loadURL(startUrl);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  mainWindow.on('ready-to-show', () => {
    mainWindow.show();
  });

  const menu = Menu.buildFromTemplate([
    {
      label: 'Select Window',
      click: async () => {
        const electronWindowId = mainWindow.getNativeWindowHandle().readUInt32LE().toString();
        exec('xdotool search --name "Tibia"', async (error, stdout, stderr) => {
          if (error) {
            console.error(`exec error: ${error}`);
            return;
          }
          const windowIds = await Promise.all(
            stdout.split('\n').map(async (id) => {
              if (id && id !== electronWindowId) {
                const geometry = await new Promise((resolve, reject) => {
                  exec(`xdotool getwindowgeometry ${id}`, (error, stdout, stderr) => {
                    if (error) {
                      reject(error);
                    } else {
                      resolve(stdout.trim());
                    }
                  });
                });
                return !geometry.includes('1x1') ? id : null;
              }
              return null;
            }),
          );
          const validWindowIds = windowIds.filter((id) => id !== null);
          const windowNames = await Promise.all(
            validWindowIds.map((id) => {
              return new Promise((resolve, reject) => {
                exec(`xdotool getwindowname ${id}`, (error, stdout, stderr) => {
                  if (error) {
                    reject(error);
                  } else {
                    resolve(stdout.trim());
                  }
                });
              });
            }),
          );
          const windowList = validWindowIds.map((id, index) => `${windowNames[index]}`);
          dialog
            .showMessageBox({
              type: 'question',
              buttons: windowList,
              title: 'Select Tibia Client',
              checkboxLabel: 'Censor window title',
            })
            .then((result) => {
              selectedWindowId = validWindowIds[result.response];
              let windowTitle = windowNames[result.response];
              if (result.checkboxChecked) {
                const titleParts = windowTitle.split(' - ');
                if (titleParts.length > 1) {
                  windowTitle = `${titleParts[0]} - Censored`;
                }
              }
              mainWindow.setTitle(`Automaton - ${windowTitle}`);

              // If a worker process is already running, kill it
              if (workerProcess) {
                workerProcess.kill();
              }

              workerProcess = fork(path.join(__dirname, 'findHealthBar.js'));
              workerProcess.send({ command: 'start', windowId: selectedWindowId });

              // When the parent process is closed, kill the child process
              process.on('exit', () => {
                workerProcess.kill();
              });
            });
        });
      },
    },
  ]);
  Menu.setApplicationMenu(menu);
};

const getSelectedWindowId = () => selectedWindowId;

module.exports = { createWindow, mainWindow, getSelectedWindowId };
