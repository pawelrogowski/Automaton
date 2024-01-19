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
        const client = await new Promise((resolve, reject) => {
          x11.createClient((err, display) => {
            if (err) {
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
        await new Promise((resolve) => setTimeout(resolve, 10));
      }
    }
    throw new Error('Failed to create X11 client after 5 attempts');
  } catch (error) {
    console.error('An error occurred:', error);
    throw error;
  }
}

export default createX11Client;
