{
  "targets": [
    {
      "target_name": "mouse-controller",
      "sources": [ "./src/mouse-controller.cc" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],

      "libraries": [
        "-lX11",
        "-lXtst"
      ],

      "cflags_cc": [
        "-std=c++17",
        "-fPIC",
        "-O3",
        "-march=native",
        "-flto",
        "-Wall",
        "-Wextra"
      ],


      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ]
    }
  ]
}