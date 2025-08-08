{
  "targets": [
    {
      "target_name": "findHealthBars",
      "sources": [ "./src/findHealthBars.cc" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "node_modules/node-addon-api"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "libraries": [],
      "conditions": [
        ['OS=="linux"', {
          "cflags!": [ '-fno-exceptions' ],
          "cflags_cc!": [ '-fno-exceptions'],
          "cflags_cc+": [
            "-O3",
            "-msse2",
            "-march=native",
            "-mtune=native",
            "-flto"
           ],
          "ldflags": [
            "-flto"
          ]
        }]
      ]
    }
  ]
}