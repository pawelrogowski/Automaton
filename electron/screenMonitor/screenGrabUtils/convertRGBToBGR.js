/**
 * Converts an RGB color value to BGR format.
 *
 * @param {number[]} rgbColor - An array representing the RGB color value.
 * @returns {number[]} An array representing the BGR color value.
 */
const convertRGBToBGR = (rgbColor) => {
  return [rgbColor[2], rgbColor[1], rgbColor[0]];
};

export default convertRGBToBGR;
