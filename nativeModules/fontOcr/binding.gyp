{
  "targets": [
    {
      "target_name": "fontOcr",
      "sources": [ "./src/fontOcr.cc" ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],
      "dependencies": [
        "<!(node -p \"require('node-addon-api').gyp\")"
      ],
      "conditions": [
        ['OS=="linux"', {
          "defines": [
            # --- FIX: Tell node-addon-api that we are disabling exceptions ---
            "NODE_ADDON_API_DISABLE_CPP_EXCEPTIONS=1"
          ],
          "cflags_cc": [
            # --- Build Optimizations from the Guide ---
            "-O3",              # Maximum optimization level
            "-march=native",    # Generate code for the specific CPU it's compiled on
            "-mtune=native",    # Tune instruction scheduling for the specific CPU
            "-flto",            # Enable Link-Time Optimization
            "-fno-exceptions"   # Disable C++ exceptions for smaller, faster code
          ]
        }]
      ]
    }
  ]
}