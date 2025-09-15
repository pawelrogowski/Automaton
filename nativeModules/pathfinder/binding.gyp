{
  "targets": [
    {
      "target_name": "pathfinderNative",
      "sources": [
        "src/pathfinder.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],

      "defines": [
        "NODE_ADDON_API_CPP_EXCEPTIONS"
      ],

      "cflags_cc": [
        "-fexceptions",
        "-std=c++17",
        "-fPIC",
        "-O3",
        "-flto",
        "-fvisibility=hidden",
        "-march=native"
      ],
      "ldflags": [
        "-flto"
      ]
    }
  ]
}
