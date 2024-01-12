import getDisplayGeometry from '../windowUtils/getDisplayGeometry.js';

async function grabScreen(X, root, region, logPixels = false) {
  let finalRegion;
  if (!region || region === 'screen') {
    finalRegion = await getDisplayGeometry();
  } else {
    finalRegion = region;
  }

  return new Promise((resolve, reject) => {
    X.GetImage(
      2,
      root,
      finalRegion.x,
      finalRegion.y,
      finalRegion.width,
      finalRegion.height,
      0xffffff,
      X.ZPixmapFormat,
      (er, img) => {
        if (er) {
          reject(er);
          return;
        }
        // Preprocess image data to RGB hex format
        const pixels = [];
        for (let i = 0; i < img.data.length; i += 4) {
          const r = img.data[i + 2].toString(16).padStart(2, '0');
          const g = img.data[i + 1].toString(16).padStart(2, '0');
          const b = img.data[i].toString(16).padStart(2, '0');
          const hex = `#${r}${g}${b}`;
          pixels.push(hex);
          if (logPixels) {
            console.log(hex);
          }
        }

        resolve(pixels);
      },
    );
  });
}

export default grabScreen;
