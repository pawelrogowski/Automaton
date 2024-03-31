module.exports = {
  packagerConfig: {
    asar: true,
  },
  rebuildConfig: {},
  makers: [
    {
      name: '@electron-forge/maker-deb',
      config: {
        options: {
          executableName: 'automaton',
          icon: './electron/icons/skull.png',
        },
      },
    },

    {
      name: '@electron-forge/maker-rpm',
      config: {
        options: {
          executableName: 'automaton',
          icon: './electron/icons/skull.png',
        },
      },
    },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
  ],
};
