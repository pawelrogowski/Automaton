{
  "targets": [{
    "target_name": "windowinfo",
    "sources": [ "src/windowinfo.cc" ],
    "include_dirs": [
      "<!@(node -p \"require('node-addon-api').include\")"
    ],
    "dependencies": [
      "<!(node -p \"require('node-addon-api').gyp\")"
    ],
    "libraries": [
      "-lX11"
    ],
    "cflags!": [ "-fno-exceptions" ],
    "cflags_cc!": [ "-fno-exceptions" ],
    "conditions": [
      ['OS=="linux"', {
        "cflags+": [
          "-std=c++17"
        ],
        "cflags_cc+": [
          "-std=c++17"
        ]
      }]
    ],
    'defines': [ 'NAPI_DISABLE_CPP_EXCEPTIONS' ]
  }]
}