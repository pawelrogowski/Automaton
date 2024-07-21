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
          icon: './electron/icons/greenSkull.png',
        },
      },
    },
    // {
    //   name: '@electron-forge/maker-rpm',
    //   config: {
    //     options: {
    //       executableName: 'automaton',
    //       icon: './electron/icons/greenSkull.png',
    //     },
    //   },
    // },
  ],
  plugins: [
    {
      name: '@electron-forge/plugin-auto-unpack-natives',
      config: {},
    },
  ],
};
