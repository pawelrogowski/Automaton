import { ipcMain } from 'electron';
import { fork } from 'child_process';
import path from 'path';
import { getSelectedWindowId } from './createWindow.js';

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
    monitorProcess.kill(); // Kill the child process
    delete monitoringIntervals[ruleId];
  }
});
