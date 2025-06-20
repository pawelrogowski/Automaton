{
  "targets": [
    {
      "target_name": "minimapMatcherNative",
      "sources": [
        "src/minimapMatcherNative.cc"
      ],
      "include_dirs": [
        "<!@(node -p \"require('node-addon-api').include\")"
      ],


      "cflags!": [ "-fno-exceptions" ],
      "cflags_cc!": [ "-fno-exceptions" ],
      "defines": [ "NAPI_DISABLE_CPP_EXCEPTIONS" ],

      "conditions": [
        ['OS!="win"', {

          "cflags_cc": [
            "-std=c++17",     # Use a modern C++ standard
            "-O3",            # Aggressive optimization level
            "-flto",          # Enable Link-Time Optimization
            "-fvisibility=hidden", # Improve load times and reduce binary size
            "-march=native"   # IMPORTANT: See explanation below
          ],
          "ldflags": [
            "-flto"           # Linker flag for LTO
          ]
        }],
        ['OS=="win"', {
          # Flags for MSVC (Windows)
          "msvs_settings": {
            "VCCLCompilerTool": {
              "ExceptionHandling": 1,
              "Optimization": 2,      # /O2 - Maximize speed
              "InlineFunctionExpansion": 2, # /Ob2 - Aggressive inlining
              "EnableIntrinsicFunctions": "true", # /Oi - Use fast intrinsic functions
              "FavorSizeOrSpeed": 2, # /Ot - Favor speed over size
              "AdditionalOptions": [
                "/arch:AVX2"      # IMPORTANT: See explanation below
              ]
            },
            "VCLinkerTool": {
              "LinkTimeCodeGeneration": 1 # /LTCG - Enable Link-Time Optimization
            }
          }
        }]
      ],
      # This part is needed to make N-API work with the above settings
      "xcode_settings": {
        "GCC_ENABLE_CPP_EXCEPTIONS": "YES",
        'GCC_SYMBOLS_PRIVATE_EXTERN': 'YES' # Corresponds to -fvisibility=hidden
      }
    }
  ]
}