{
  "targets": [{
    "target_name": "focus_watcher",
    "cflags!": [ "-fno-exceptions" ],
    "cflags_cc!": [ "-fno-exceptions" ],
    "sources": [ "src/focus_watcher.cc" ],
    "include_dirs": [
      "<!@(node -p \"require('node-addon-api').include\")",
      "<!@(pkg-config --cflags-only-I x11 xtst | sed 's/-I//g')"
    ],
    "libraries": [
      "<!@(pkg-config --libs x11 xtst)"
    ],
    'defines': [ 'NAPI_DISABLE_CPP_EXCEPTIONS' ]
  }]
}