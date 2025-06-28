{
  "targets": [
    {
      "target_name": "x11RegionCapture",
      "sources": [ "./src/x11RegionCapture.cc" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "node_modules/node-addon-api"
      ],

      "libraries": [
        "-lxcb",
        "-lxcb-shm",
        "-lxcb-composite"
      ],
      "conditions": [
        ['OS=="linux"', {
          "cflags!": [ '-fno-exceptions' ],
          "cflags_cc!": [ '-fno-exceptions'],
          "cflags_cc+": [
            "-O3",
            "-mavx2",
            "-mfma",
            "-march=native",
            "-mtune=native",
            "-flto",
            "-DAVX2"
          ],
          "ldflags": [
            "-flto"
          ]
        }]
      ]
    }
  ]
}