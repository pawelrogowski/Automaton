// antiIdleModule.js
import { Worker } from 'worker_threads';
import { fileURLToPath } from 'url';
import { resolve, dirname } from 'path';

let worker = null;

function createAntiIdle(windowId) {
  const __filename = fileURLToPath(import.meta.url);
  const __dirname = dirname(__filename);
  const workerPath = resolve(__dirname, './antiIdleWorker.js');

  if (worker) {
    worker.terminate();
  }
  worker = new Worker(workerPath, { name: 'antiIdleWorker' });
  worker.on('message', (message) => {
    console.log(message);
  });

  function startAntiIdle() {
    worker.postMessage({ antiIdleEnabled: true, windowId });
  }

  function stopAntiIdle() {
    worker.postMessage({ antiIdleEnabled: false });
  }

  function terminate() {
    worker.terminate();
    worker = null;
  }

  return { startAntiIdle, stopAntiIdle, terminate };
}

function getOrCreateAntiIdle(windowId) {
  if (!worker) {
    worker = createAntiIdle(windowId);
  } else {
    worker.startAntiIdle();
  }
  return worker;
}

export default getOrCreateAntiIdle;
