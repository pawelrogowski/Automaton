import x11 from 'x11';

let clientInstance = null;

async function createX11Client() {
  if (clientInstance) {
    return clientInstance;
  }

  try {
    let retries = 0;
    while (retries < 5) {
      try {
        // eslint-disable-next-line no-await-in-loop
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
      } catch (error) {
        console.error('An error occurred:', error);
        retries += 1;
        // eslint-disable-next-line no-await-in-loop
        await new Promise((resolve) => setTimeout(resolve, 10));
        if (clientInstance) {
          clientInstance.X.terminate();
          clientInstance = null;
        }
      }
    }
    throw new Error('Failed to create X11 client after 5 attempts');
  } catch (error) {
    console.error('ailed to create X11 client:', error);
    throw error;
  }
}

export default createX11Client;
