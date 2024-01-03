import { ipcMain } from 'electron';
import { fork } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';
import { getSelectedWindowId } from './menu/windowSelection/windowSelection.js';

const filename = fileURLToPath(import.meta.url);
const dirname = path.dirname(filename);

const monitoringIntervals = {};

ipcMain.handle('startMonitoring', (_, rule) => {
  console.log('rule enabled', rule);
  const selectedWindowId = getSelectedWindowId();
  if (!selectedWindowId) {
    console.log('no window selected, canceling');
    return;
  }
  const monitorRuleProcess = fork(path.join(dirname, 'monitor.js'));
  monitorRuleProcess.send({ type: 'start', rule, windowId: getSelectedWindowId() });
  console.log('process started');
  monitoringIntervals[rule.id] = monitorRuleProcess;
});

ipcMain.handle('stopMonitoring', (_, ruleId) => {
  const ruleMonitorStatsProcess = monitoringIntervals[ruleId];
  if (ruleMonitorStatsProcess) {
    ruleMonitorStatsProcess.kill(); // Kill the child process
    delete monitoringIntervals[ruleId];
  }
});
