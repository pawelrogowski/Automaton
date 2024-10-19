import commandExecutor from '../utils/commandExecutor.js';

async function getMouseLocation() {
  try {
    const command = 'getmouselocation';

    const result = await new Promise((resolve, reject) => {
      let dataBuffer = '';

      const xdotoolProcess = commandExecutor.addCommand(command);
      xdotoolProcess
        .then(() => {
          xdotoolProcess.stdout.on('data', (data) => {
            dataBuffer += data.toString();
          });

          xdotoolProcess.stdout.on('end', () => {
            const location = dataBuffer.split(' ').reduce((obj, item) => {
              const [key, value] = item.split(':');
              obj[key] = Number(value);
              return obj;
            }, {});
            resolve(location);
          });
        })
        .catch((error) => reject(error));
    });

    return result;
  } catch (error) {
    console.error(`Error: ${error.message}`);
    return null;
  }
}

export default getMouseLocation;
