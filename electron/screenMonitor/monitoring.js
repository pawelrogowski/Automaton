import { ipcMain } from 'electron';
import { fork } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSelectedWindowId } from '../menus/windowSelection.js';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

global.monitoringProcesses = {};
const monitoringProcesses = {};

ipcMain.handle('startMonitoring', (_, rule) => {
  console.log('rule enabled', rule);
  const selectedWindowId = getSelectedWindowId();
  if (!selectedWindowId) {
    console.log('no window selected, canceling');
    return;
  }
  const monitorRuleProcess = fork(path.join(dirname, 'monitor.js'));
  monitorRuleProcess.send({ type: 'start', rule, windowId: getSelectedWindowId() });
  global.monitoringProcesses[rule.id] = monitorRuleProcess;
  console.log('process started');
  monitoringProcesses[rule.id] = monitorRuleProcess;
});

ipcMain.handle('stopMonitoring', (_, ruleId) => {
  const ruleMonitorStatsProcess = monitoringProcesses[ruleId];
  if (ruleMonitorStatsProcess) {
    ruleMonitorStatsProcess.kill(); // Kill the child process
    delete monitoringProcesses[ruleId];
    delete global.monitoringProcesses[ruleId];
  }
});
