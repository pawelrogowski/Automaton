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
            "NODE_ADDON_API_DISABLE_CPP_EXCEPTIONS=1"
          ],
          "cflags_cc": [
            # --- Build Optimizations ---
            "-O3",              # Maximum optimization level
            "-std=c++17",       # Explicitly set the C++ standard for consistency
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