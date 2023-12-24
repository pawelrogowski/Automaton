import { useEffect } from 'react';

const { ipcRenderer } = require('electron');

const useColorPicker = () => {
  const pickColor = () => {
    ipcRenderer.send('start-color-picking');
    return new Promise((resolve) => {
      const listener = (_, pixelColor) => {
        // eslint-disable-next-line no-console
        console.log('color-picked event listener called with color:', pixelColor);
        ipcRenderer.removeListener('color-picked', listener);
        resolve(pixelColor);
      };
      ipcRenderer.on('color-picked', listener);
    });
  };

  useEffect(() => {
    const stopPicking = () => {
      ipcRenderer.send('stop-color-picking');
    };

    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') {
        stopPicking();
      }
    });

    return () => {
      ipcRenderer.removeAllListeners('color-picked');
      window.removeEventListener('keydown', stopPicking);
    };
  }, []);

  return { pickColor };
};

export default useColorPicker;
