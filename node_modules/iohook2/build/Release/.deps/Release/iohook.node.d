cmd_Release/iohook.node := ln -f "Release/obj.target/iohook.node" "Release/iohook.node" 2>/dev/null || (rm -rf "Release/iohook.node" && cp -af "Release/obj.target/iohook.node" "Release/iohook.node")
