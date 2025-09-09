{
  "targets": [
    {
      "target_name": "findTarget",
      "sources": [ "./src/findTarget.cc" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")",
        "node_modules/node-addon-api"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "libraries": [],
      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "conditions": [
        [ "OS==\"linux\"", {
          "cflags": [
            "-fPIC",
            "-pthread"
          ],
          "cflags_cc": [
            "-std=c++17",
            "-O3",
            "-march=native",
            "-mtune=native",
            "-mavx2",
            "-mfma",
            "-funroll-loops",
            "-funroll-all-loops",
            "-fpeel-loops",
            "-fmove-loop-invariants",
            "-ftree-vectorize",
            "-fvect-cost-model=unlimited",
            "-ffast-math",
            "-funsafe-math-optimizations",
            "-falign-functions=32",
            "-falign-loops=32",
            "-falign-jumps=32",
            "-falign-labels=32",
            "-fomit-frame-pointer",
            "-fif-conversion",
            "-fif-conversion2",
            "-flto=auto",
            "-fwhole-program",
            "-fuse-linker-plugin",
            "-fdevirtualize-at-ltrans",
            "-fipa-pta",
            "-fipa-icf",
            "-fno-stack-protector",
            "-fno-strict-aliasing",
            "-DNDEBUG",
            "-D_FORTIFY_SOURCE=0",
            "-fprefetch-loop-arrays",


            "-fprofile-use",
            "-fprofile-correction",
            "-fprofile-dir=/home/feiron/Dokumenty/Automaton/nativeModules/findSequences/pgo-data"
          ],
          "ldflags": [
            "-flto=auto",
            "-fuse-linker-plugin",
            "-Wl,-O3",
            "-Wl,--gc-sections",
            "-Wl,--as-needed",
            "-pthread",
            "-s"

          ],
          "defines": [
            "NAPI_DISABLE_CPP_EXCEPTIONS"
          ]
        }]
      ]
    }
  ]
}