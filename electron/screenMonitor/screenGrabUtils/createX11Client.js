import x11 from 'x11';

let clientInstance = null;

async function createX11Client() {
  if (clientInstance) {
    return clientInstance;
  }

  const client = await new Promise((resolve, reject) => {
    x11.createClient((err, display) => {
      if (err) {
        console.log('error in x client');
        reject(err);
        return;
      }
      const X = display.client;
      resolve({ display, X });
    });
  });
  clientInstance = client;
  return clientInstance;
}

export default createX11Client;
