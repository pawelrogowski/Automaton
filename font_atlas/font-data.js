// font-data.js

import fs from 'fs';
import path from 'path';
import { PNG } from 'pngjs';
import { fileURLToPath } from 'url';

// This is necessary to get the correct directory path in ES Modules
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Loads the raw RGBA pixel data for a character's PNG file.
 * @param {string} charFilenameBase - The base name of the PNG file (e.g., 'A', 'bracket_open').
 * @returns {Buffer} The raw RGBA pixel data.
 */
function loadCharData(charFilenameBase) {
  try {
    const imagePath = path.join(__dirname, 'png', `${charFilenameBase}.png`); // Assuming PNGs are in a 'png' subfolder
    const buffer = fs.readFileSync(imagePath);
    const png = PNG.sync.read(buffer);
    return png.data; // Return the raw RGBA buffer, which C++ expects
  } catch (error) {
    console.error(`Failed to load font character: ${charFilenameBase}.png`, error);
    // Return an empty buffer on failure so the app doesn't crash
    return Buffer.from([]);
  }
}

export default {
  '!': {
    width: 2,
    height: 8,
    offset: 1,
    data: loadCharData('exclamation'),
  },
  '"': {
    width: 5,
    height: 3,
    offset: 0,
    data: loadCharData('quote'),
  },
  '#': {
    width: 7,
    height: 8,
    offset: 1,
    data: loadCharData('hash'),
  },
  $: {
    width: 6,
    height: 11,
    offset: 0,
    data: loadCharData('dollar'),
  },
  '%': {
    width: 12,
    height: 8,
    offset: 1,
    data: loadCharData('percent'),
  },
  '&': {
    width: 8,
    height: 8,
    offset: 1,
    data: loadCharData('ampersand'),
  },
  "'": {
    width: 2,
    height: 3,
    offset: 0,
    data: loadCharData('apostrophe'),
  },
  '(': {
    width: 4,
    height: 11,
    offset: 0,
    data: loadCharData('paren_open'),
  },
  ')': {
    width: 4,
    height: 11,
    offset: 0,
    data: loadCharData('paren_close'),
  },
  '*': {
    width: 5,
    height: 5,
    offset: 0,
    data: loadCharData('asterisk'),
  },
  '+': {
    width: 7,
    height: 7,
    offset: 2,
    data: loadCharData('plus'),
  },
  ',': {
    width: 2,
    height: 4,
    offset: 7,
    data: loadCharData('comma'),
  },
  '-': {
    width: 4,
    height: 1,
    offset: 5,
    data: loadCharData('hyphen'),
  },
  '.': {
    width: 2,
    height: 2,
    offset: 7,
    data: loadCharData('period'),
  },
  '/': {
    width: 6,
    height: 11,
    offset: 0,
    data: loadCharData('slash'),
  },
  0: {
    width: 6,
    height: 8,
    offset: 1,
    data: loadCharData('0'),
  },
  1: {
    width: 4,
    height: 8,
    offset: 1,
    data: loadCharData('1'),
  },
  2: {
    width: 6,
    height: 8,
    offset: 1,
    data: loadCharData('2'),
  },
  3: {
    width: 6,
    height: 8,
    offset: 1,
    data: loadCharData('3'),
  },
  4: {
    width: 6,
    height: 8,
    offset: 1,
    data: loadCharData('4'),
  },
  5: {
    width: 6,
    height: 8,
    offset: 1,
    data: loadCharData('5'),
  },
  6: {
    width: 6,
    height: 8,
    offset: 1,
    data: loadCharData('6'),
  },
  7: {
    width: 6,
    height: 8,
    offset: 1,
    data: loadCharData('7'),
  },
  8: {
    width: 6,
    height: 8,
    offset: 1,
    data: loadCharData('8'),
  },
  9: {
    width: 6,
    height: 8,
    offset: 1,
    data: loadCharData('9'),
  },
  ':': {
    width: 2,
    height: 6,
    offset: 3,
    data: loadCharData('colon'),
  },
  ';': {
    width: 2,
    height: 8,
    offset: 3,
    data: loadCharData('semicolon'),
  },
  '<': {
    width: 7,
    height: 7,
    offset: 2,
    data: loadCharData('less_than'),
  },
  '=': {
    width: 7,
    height: 4,
    offset: 3,
    data: loadCharData('equals'),
  },
  '>': {
    width: 7,
    height: 7,
    offset: 2,
    data: loadCharData('greater_than'),
  },
  '?': {
    width: 5,
    height: 8,
    offset: 1,
    data: loadCharData('question'),
  },
  '@': {
    width: 9,
    height: 9,
    offset: 1,
    data: loadCharData('at_symbol'),
  },
  A: {
    width: 7,
    height: 8,
    offset: 1,
    data: loadCharData('A'),
  },
  B: {
    width: 6,
    height: 8,
    offset: 1,
    data: loadCharData('B'),
  },
  C: {
    width: 6,
    height: 8,
    offset: 1,
    data: loadCharData('C'),
  },
  D: {
    width: 7,
    height: 8,
    offset: 1,
    data: loadCharData('D'),
  },
  E: {
    width: 6,
    height: 8,
    offset: 1,
    data: loadCharData('E'),
  },
  F: {
    width: 6,
    height: 8,
    offset: 1,
    data: loadCharData('F'),
  },
  G: {
    width: 7,
    height: 8,
    offset: 1,
    data: loadCharData('G'),
  },
  H: {
    width: 7,
    height: 8,
    offset: 1,
    data: loadCharData('H'),
  },
  I: {
    width: 4,
    height: 8,
    offset: 1,
    data: loadCharData('I'),
  },
  J: {
    width: 5,
    height: 8,
    offset: 1,
    data: loadCharData('J'),
  },
  K: {
    width: 6,
    height: 8,
    offset: 1,
    data: loadCharData('K'),
  },
  L: {
    width: 6,
    height: 8,
    offset: 1,
    data: loadCharData('L'),
  },
  M: {
    width: 8,
    height: 8,
    offset: 1,
    data: loadCharData('M'),
  },
  N: {
    width: 7,
    height: 8,
    offset: 1,
    data: loadCharData('N'),
  },
  O: {
    width: 7,
    height: 8,
    offset: 1,
    data: loadCharData('O'),
  },
  P: {
    width: 6,
    height: 8,
    offset: 1,
    data: loadCharData('P'),
  },
  Q: {
    width: 7,
    height: 10,
    offset: 1,
    data: loadCharData('Q'),
  },
  R: {
    width: 7,
    height: 8,
    offset: 1,
    data: loadCharData('R'),
  },
  S: {
    width: 6,
    height: 8,
    offset: 1,
    data: loadCharData('S'),
  },
  T: {
    width: 8,
    height: 8,
    offset: 1,
    data: loadCharData('T'),
  },
  U: {
    width: 7,
    height: 8,
    offset: 1,
    data: loadCharData('U'),
  },
  V: {
    width: 6,
    height: 8,
    offset: 0,
    data: loadCharData('V'),
  },
  W: {
    width: 10,
    height: 8,
    offset: 1,
    data: loadCharData('W'),
  },
  X: {
    width: 6,
    height: 8,
    offset: 1,
    data: loadCharData('X'),
  },
  Y: {
    width: 6,
    height: 8,
    offset: 1,
    data: loadCharData('Y'),
  },
  Z: {
    width: 6,
    height: 8,
    offset: 1,
    data: loadCharData('Z'),
  },
  '[': {
    width: 4,
    height: 11,
    offset: 0,
    data: loadCharData('bracket_open'),
  },
  '\\': {
    width: 6,
    height: 11,
    offset: 0,
    data: loadCharData('backslash'),
  },
  ']': {
    width: 4,
    height: 11,
    offset: 0,
    data: loadCharData('bracket_close'),
  },
  '^': {
    width: 8,
    height: 4,
    offset: 1,
    data: loadCharData('caret'),
  },
  _: {
    width: 8,
    height: 1,
    offset: 10,
    data: loadCharData('underscore'),
  },
  '`': {
    width: 3,
    height: 2,
    offset: 0,
    data: loadCharData('backtick'),
  },
  a: {
    width: 6,
    height: 6,
    offset: 3,
    data: loadCharData('a'),
  },
  b: {
    width: 6,
    height: 9,
    offset: 0,
    data: loadCharData('b'),
  },
  c: {
    width: 5,
    height: 6,
    offset: 3,
    data: loadCharData('c'),
  },
  d: {
    width: 6,
    height: 9,
    offset: 0,
    data: loadCharData('d'),
  },
  e: {
    width: 6,
    height: 6,
    offset: 3,
    data: loadCharData('e'),
  },
  f: {
    width: 5,
    height: 9,
    offset: 0,
    data: loadCharData('f'),
  },
  g: {
    width: 6,
    height: 8,
    offset: 3,
    data: loadCharData('g'),
  },
  h: {
    width: 6,
    height: 9,
    offset: 0,
    data: loadCharData('h'),
  },
  i: {
    width: 2,
    height: 8,
    offset: 1,
    data: loadCharData('i'),
  },
  j: {
    width: 4,
    height: 10,
    offset: 1,
    data: loadCharData('j'),
  },
  k: {
    width: 6,
    height: 9,
    offset: 0,
    data: loadCharData('k'),
  },
  l: {
    width: 2,
    height: 9,
    offset: 0,
    data: loadCharData('l'),
  },
  m: {
    width: 10,
    height: 6,
    offset: 3,
    data: loadCharData('m'),
  },
  n: {
    width: 6,
    height: 6,
    offset: 3,
    data: loadCharData('n'),
  },
  o: {
    width: 6,
    height: 6,
    offset: 3,
    data: loadCharData('o'),
  },
  p: {
    width: 6,
    height: 8,
    offset: 3,
    data: loadCharData('p'),
  },
  q: {
    width: 6,
    height: 8,
    offset: 3,
    data: loadCharData('q'),
  },
  r: {
    width: 5,
    height: 6,
    offset: 3,
    data: loadCharData('r'),
  },
  s: {
    width: 5,
    height: 6,
    offset: 3,
    data: loadCharData('s'),
  },
  t: {
    width: 5,
    height: 8,
    offset: 1,
    data: loadCharData('t'),
  },
  u: {
    width: 6,
    height: 6,
    offset: 3,
    data: loadCharData('u'),
  },
  v: {
    width: 6,
    height: 6,
    offset: 3,
    data: loadCharData('v'),
  },
  w: {
    width: 8,
    height: 6,
    offset: 3,
    data: loadCharData('w'),
  },
  x: {
    width: 6,
    height: 6,
    offset: 3,
    data: loadCharData('x'),
  },
  y: {
    width: 6,
    height: 8,
    offset: 3,
    data: loadCharData('y'),
  },
  z: {
    width: 5,
    height: 6,
    offset: 3,
    data: loadCharData('z'),
  },
  '{': {
    width: 6,
    height: 11,
    offset: 0,
    data: loadCharData('brace_open'),
  },
  '|': {
    width: 2,
    height: 11,
    offset: 0,
    data: loadCharData('pipe'),
  },
  '}': {
    width: 6,
    height: 11,
    offset: 0,
    data: loadCharData('brace_close'),
  },
};
