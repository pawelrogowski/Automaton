import x11 from 'x11';

async function createX11Client() {
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
}
export default createX11Client;
