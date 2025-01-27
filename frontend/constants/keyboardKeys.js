const keyboardKeys = [
  // Function keys
  'F1',
  'F2',
  'F3',
  'F4',
  'F5',
  'F6',
  'F7',
  'F8',
  'F9',
  'F10',
  'F11',
  'F12',

  // Number keys
  '1',
  '2',
  '3',
  '4',
  '5',
  '6',
  '7',
  '8',
  '9',
  '0',

  // Alphabet keys
  'a',
  'b',
  'c',
  'd',
  'e',
  'f',
  'g',
  'h',
  'i',
  'j',
  'k',
  'l',
  'm',
  'n',
  'o',
  'p',
  'q',
  'r',
  's',
  't',
  'u',
  'v',
  'w',
  'x',
  'y',
  'z',

  // Special character keys
  '=',
  '-',
  '.',
  '/',
  '\\',
  ';',
  "'",
  '[',
  ']',

  // Navigation keys
  'left',
  'right',
  'up',
  'down',
  'home',
  'end',
  'pgup',
  'pgdn',

  // Menu key
  'menu',

  // Other keys
  'enter',
  'tab',
  'space',
  'backspace',
  'delete',
  'escape',
].map((key) => ({ value: key, label: key }));

export default keyboardKeys;
