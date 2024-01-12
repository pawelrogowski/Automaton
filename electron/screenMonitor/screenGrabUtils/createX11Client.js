import x11 from 'x11';

async function createX11Client() {
  try {
    let retries = 0;
    while (retries < 5) {
      try {
        return new Promise((resolve, reject) => {
          x11.createClient((err, display) => {
            if (err) {
              reject(err);
              return;
            }
            const X = display.client;
            resolve({ display, X });
          });
        });
      } catch (error) {
        console.error('An error occurred:', error);
        retries += 1;
        await new Promise((resolve) => setTimeout(resolve, 100)); // Wait for 100ms before retrying
      }
    }
    throw new Error('Failed to create X11 client after 5 attempts');
  } catch (error) {
    console.error('An error occurred:', error);
    throw error;
  }
}

export default createX11Client;
