const rgbaToHex = (rgba) => {
  let r = rgba.R.toString(16);
  let g = rgba.G.toString(16);
  let b = rgba.B.toString(16);

  if (r.length === 1) r = `0${r}`;
  if (g.length === 1) g = `0${g}`;
  if (b.length === 1) b = `0${b}`;

  return `#${r}${g}${b}`;
};
module.exports = { rgbaToHex };
