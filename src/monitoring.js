const { ipcMain } = require('electron');
const { fork } = require('child_process');
const path = require('path');
const { getSelectedWindowId } = require('./createWindow.js'); // Import getSelectedWindowId here

const monitoringIntervals = {};

ipcMain.handle('startMonitoring', (event, rule) => {
  const selectedWindowId = getSelectedWindowId();
  if (!selectedWindowId) {
    console.log('No window selected');
    return;
  }

  const monitorProcess = fork(path.join(__dirname, 'monitor.js'));

  monitorProcess.send({ ...rule, windowId: selectedWindowId });

  monitorProcess.send(rule);

  monitorProcess.on('message', (message) => {
    if (message.error) {
      console.log(message.error);
    }
  });

  monitoringIntervals[rule.id] = monitorProcess;
});

ipcMain.handle('stopMonitoring', (event, ruleId) => {
  const monitorProcess = monitoringIntervals[ruleId];
  if (monitorProcess) {
    monitorProcess.kill();
    delete monitoringIntervals[ruleId];
  }
});
