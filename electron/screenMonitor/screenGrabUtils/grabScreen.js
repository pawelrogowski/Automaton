async function grabScreen(X, root, region) {
  if (!region) {
    throw new Error('Region is undefined');
  }
  return new Promise((resolve, reject) => {
    X.GetImage(
      2,
      root,
      region.x,
      region.y,
      region.width,
      region.height,
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
        }

        resolve(pixels);
      },
    );
  });
}

export default grabScreen;
