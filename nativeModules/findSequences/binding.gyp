{
  "targets": [
    {
      "target_name": "findSequences",
      "sources": [ "./src/findSequences.cc" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "node_modules/node-addon-api"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "libraries": [],
      "conditions": [
        [ "OS==\"linux\"", {
          "cflags!": [ "-fno-exceptions" ],
          "cflags_cc!": [ "-fno-exceptions" ],
          "cflags": [
            "-fPIC",
            "-pthread"
          ],
          "cflags_cc+": [
            "-std=c++17",
            "-O3",
            "-march=native",
            "-mtune=native",
            "-mavx2",
            "-mfma",
            "-funroll-loops",
            "-fno-strict-aliasing",
            "-falign-functions=64",
            "-falign-jumps=32",
            "-falign-loops=32",
            "-falign-labels=32",
            "-flto"
          ],
          "ldflags": [
            "-flto",
            "-pthread"
          ]
        }]
      ]
    }
  ]
}
