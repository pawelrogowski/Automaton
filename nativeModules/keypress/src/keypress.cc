#include <napi.h>
#include <X11/Xlib.h>
#include <X11/extensions/XTest.h>
#include <X11/keysym.h>
#include <X11/XKBlib.h>
#include <X11/Xatom.h> // For Atom and XInternAtom
#include <string.h>
#include <map>
#include <unistd.h> // For usleep
#include <cctype> // For isupper, tolower
#include <algorithm> // For std::transform
#include <cstdlib> // For rand, srand
#include <ctime> // For time

// Map for special keys - Note: This map is primarily used by SendKeypress. TypeString uses explicit checks and Xkb.
std::map<std::string, KeySym> specialKeys = {
   {"f1", XK_F1},
    {"f2", XK_F2},
    {"f3", XK_F3},
    {"f4", XK_F4},\
    {"f5", XK_F5},
    {"f6", XK_F6},
    {"f7", XK_F7},
    {"f8", XK_F8},
    {"f9", XK_F9},
    {"f10", XK_F10},
    {"f11", XK_F11},
    {"f12", XK_F12},
    {"enter", XK_Return},
    {"return", XK_Return},
    {"tab", XK_Tab},
    {"space", XK_space},
    {"backspace", XK_BackSpace},
    {"delete", XK_Delete},
    {"escape", XK_Escape},
    {"esc", XK_Escape},
    {"=", XK_equal},
    {"-", XK_minus},
    {".", XK_period},
    {"/", XK_slash},
    {"\\", XK_backslash},
    {";", XK_semicolon},
    {"'", XK_apostrophe},
    {"[", XK_bracketleft},
    {"]", XK_bracketright},
    {"`", XK_grave},
    {"left", XK_Left},
    {"right", XK_Right},
    {"up", XK_Up},
    {"down", XK_Down},
    {"home", XK_Home},
    {"end", XK_End},
    {"pgup", XK_Page_Up},
    {"pgdn", XK_Page_Down},
    {"menu", XK_Menu},
};

// Map for modifier keys
std::map<std::string, unsigned int> modifierKeys = {
    {"shift", ShiftMask},
    {"control", ControlMask},
    {"ctrl", ControlMask},
    {"alt", Mod1Mask}, // Mod1Mask is typically Alt
    {"super", Mod4Mask}, // Mod4Mask is typically the Windows/Super key
    {"meta", Mod4Mask}, // Alias for super
};

void SendKeypress(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Wrong number of arguments (window_id, key are required)")
            .ThrowAsJavaScriptException();
        return;
    }

    if (!info[0].IsNumber() || !info[1].IsString()) {
        Napi::TypeError::New(env, "Wrong argument types (window_id must be number, key must be string)")
            .ThrowAsJavaScriptException();
        return;
    }

    uint64_t window_id = info[0].As<Napi::Number>().Int64Value();
    std::string key = info[1].As<Napi::String>().Utf8Value();

    // Optional modifiers argument
    unsigned int modifiers_state = 0;
    if (info.Length() > 2 && !info[2].IsUndefined()) {
        if (!info[2].IsString()) {
            Napi::TypeError::New(env, "Optional argument modifier must be a string")
                .ThrowAsJavaScriptException();
            return;
        }
        std::string modifier_str = info[2].As<Napi::String>().Utf8Value();
        std::transform(modifier_str.begin(), modifier_str.end(), modifier_str.begin(), ::tolower);

        if (modifierKeys.count(modifier_str)) {
            modifiers_state = modifierKeys[modifier_str];
        } else {
            Napi::Error::New(env, "Invalid modifier: " + modifier_str)
                .ThrowAsJavaScriptException();
            return;
        }
    }

    // Convert key to lowercase for consistent mapping
    std::transform(key.begin(), key.end(), key.begin(), ::tolower);

    Display *display = XOpenDisplay(NULL);
    if (!display) {
        Napi::Error::New(env, "Cannot open display")
            .ThrowAsJavaScriptException();
        return;
    }

    KeySym keysym;
    // Check if it's a special key
    if (specialKeys.find(key) != specialKeys.end()) {
        keysym = specialKeys[key];
    } else {
        keysym = XStringToKeysym(key.c_str());
    }

    if (keysym == NoSymbol) {
        XCloseDisplay(display);
        Napi::Error::New(env, "Invalid key: " + key)
            .ThrowAsJavaScriptException();
        return;
    }

    KeyCode keycode = XKeysymToKeycode(display, keysym);
    Window target_window = (Window)window_id;

    // Get current keyboard state to preserve existing modifiers (e.g., NumLock, CapsLock)
    XkbStateRec state;
    XkbGetState(display, XkbUseCoreKbd, &state);
    unsigned int current_base_mods = state.base_mods;

    XEvent event;
    memset(&event, 0, sizeof(event));

    // Key Press
    event.type = KeyPress;
    event.xkey.display = display;
    event.xkey.window = target_window;
    event.xkey.root = XDefaultRootWindow(display);
    event.xkey.subwindow = None;
    event.xkey.time = CurrentTime;
    event.xkey.x = 1;
    event.xkey.y = 1;
    event.xkey.x_root = 1;
    event.xkey.y_root = 1;
    event.xkey.same_screen = True;
    event.xkey.keycode = keycode;
    // Combine current base modifiers with explicitly requested modifiers
    event.xkey.state = current_base_mods | modifiers_state;

    XSendEvent(display, target_window, True, KeyPressMask, &event);
    XSync(display, False);

    // Key Release
    event.type = KeyRelease;
    // For release, use the same state as press for consistency
    event.xkey.state = current_base_mods | modifiers_state;
    XSendEvent(display, target_window, True, KeyReleaseMask, &event);
    XSync(display, False);

    XCloseDisplay(display);
}

void TypeString(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 2) {
        Napi::TypeError::New(env, "Wrong number of arguments (window_id, string are required)").ThrowAsJavaScriptException();
        return;
    }

    if (!info[0].IsNumber() || !info[1].IsString()) {
        Napi::TypeError::New(env, "Wrong argument types (window_id must be number, string must be string)").ThrowAsJavaScriptException();
        return;
    }

    uint64_t window_id = info[0].As<Napi::Number>().Int64Value();
    std::string str = info[1].As<Napi::String>().Utf8Value();

    // Optional parameters with defaults
    int delay_ms = 0; // Default 0ms delay
    bool finish_with_enter = false; // Default false

    if (info.Length() > 2 && !info[2].IsUndefined()) {
        if (!info[2].IsNumber()) {
             Napi::TypeError::New(env, "Optional argument delay must be a number").ThrowAsJavaScriptException();
             return;
        }
        delay_ms = info[2].As<Napi::Number>().Int32Value();
    }

    if (info.Length() > 3 && !info[3].IsUndefined()) {
        if (!info[3].IsBoolean()) {
             Napi::TypeError::New(env, "Optional argument finish_with_enter must be a boolean").ThrowAsJavaScriptException();
             return;
        }
        finish_with_enter = info[3].As<Napi::Boolean>().Value();
    }


    Display *display = XOpenDisplay(NULL);
    if (!display) {
        Napi::Error::New(env, "Cannot open display").ThrowAsJavaScriptException();
        return;
    }

    Window target_window = (Window)window_id;

    // Get the current keyboard mapping
    XkbDescPtr desc = XkbGetMap(display, XkbAllMapComponentsMask, XkbUseCoreKbd);
    if (!desc) {
        XCloseDisplay(display);
        Napi::Error::New(env, "Cannot get keyboard mapping").ThrowAsJavaScriptException();
        return;
    }


    // Press Enter before typing if finish_with_enter is true
    if (finish_with_enter) {
        KeySym enter_keysym = XK_Return;
        KeyCode enter_keycode = XKeysymToKeycode(display, enter_keysym);
         if (enter_keycode != 0) {
            XEvent enterPressEvent;
            memset(&enterPressEvent, 0, sizeof(enterPressEvent));
            enterPressEvent.type = KeyPress;
            enterPressEvent.xkey.display = display;
            enterPressEvent.xkey.window = target_window;
            enterPressEvent.xkey.root = XDefaultRootWindow(display);
            enterPressEvent.xkey.subwindow = None;
            enterPressEvent.xkey.time = CurrentTime;
            enterPressEvent.xkey.x = 1;
            enterPressEvent.xkey.y = 1;
            enterPressEvent.xkey.x_root = 1;
            enterPressEvent.xkey.y_root = 1;
            enterPressEvent.xkey.same_screen = True;
            enterPressEvent.xkey.keycode = enter_keycode;
            enterPressEvent.xkey.state = 0; // Enter key itself has no standard modifier state

            XSendEvent(display, target_window, True, KeyPressMask, &enterPressEvent);
            XSync(display, False);

            XEvent enterReleaseEvent = enterPressEvent;
            enterReleaseEvent.type = KeyRelease;
             enterReleaseEvent.xkey.state = 0; // Enter key itself has no standard modifier state
            XSendEvent(display, target_window, True, KeyReleaseMask, &enterReleaseEvent);
            XSync(display, False);
        }
        // Add a 100ms delay after initial enter if requested
        usleep(100 * 1000); // 100ms delay
    }

    XkbStateRec state;
    XkbGetState(display, XkbUseCoreKbd, &state);
    unsigned int current_base_mods = state.base_mods; // Get current base modifiers

    for (char c : str) {
        KeyCode keycode = 0;
        unsigned int required_modifier = 0; // Modifier needed for this specific char (e.g., Shift for uppercase)
        bool found = false;
        KeySym keysym = NoSymbol;

        // Attempt to find keycode and modifiers
        if (c == ' ') {
            keysym = XK_space;
            required_modifier = 0;
            found = true;
        } else {
            // Try explicit symbols/shifted characters
            switch (c) {
                case '(': keysym = XK_parenleft; required_modifier = ShiftMask; found = true; break;
                case ')': keysym = XK_parenright; required_modifier = ShiftMask; found = true; break;
                case '!': keysym = XK_exclam; required_modifier = ShiftMask; found = true; break;
                case '@': keysym = XK_at; required_modifier = ShiftMask; found = true; break;
                case '#': keysym = XK_numbersign; required_modifier = ShiftMask; found = true; break;
                case '$': keysym = XK_dollar; required_modifier = ShiftMask; found = true; break;
                case '%': keysym = XK_percent; required_modifier = ShiftMask; found = true; break;
                case '^': keysym = XK_asciicircum; required_modifier = ShiftMask; found = true; break;
                case '&': keysym = XK_ampersand; required_modifier = ShiftMask; found = true; break;
                case '*': keysym = XK_asterisk; required_modifier = ShiftMask; found = true; break;
                case '_': keysym = XK_underscore; required_modifier = ShiftMask; found = true; break;
                case '+': keysym = XK_plus; required_modifier = ShiftMask; found = true; break;
                case '{': keysym = XK_braceleft; required_modifier = ShiftMask; found = true; break;
                case '}': keysym = XK_braceright; required_modifier = ShiftMask; found = true; break;
                case ':': keysym = XK_colon; required_modifier = ShiftMask; found = true; break;
                case '"': keysym = XK_quotedbl; required_modifier = ShiftMask; found = true; break;
                case '<': keysym = XK_less; required_modifier = ShiftMask; found = true; break;
                case '>': keysym = XK_greater; required_modifier = ShiftMask; found = true; break;
                case '?': keysym = XK_question; required_modifier = ShiftMask; found = true; break;
                case '~': keysym = XK_asciitilde; required_modifier = ShiftMask; found = true; break;
                case '|': keysym = XK_bar; required_modifier = ShiftMask; found = true; break; // Added pipe
                 case '=': keysym = XK_equal; required_modifier = 0; found = true; break;
                case '-': keysym = XK_minus; required_modifier = 0; found = true; break;
                case '.': keysym = XK_period; required_modifier = 0; found = true; break;
                case '/': keysym = XK_slash; required_modifier = 0; found = true; break;
                case '\\': keysym = XK_backslash; required_modifier = 0; found = true; break;
                case ';': keysym = XK_semicolon; required_modifier = 0; found = true; break;
                case '\'': keysym = XK_apostrophe; required_modifier = 0; found = true; break;
                case '[': keysym = XK_bracketleft; required_modifier = 0; found = true; break;
                case ']': keysym = XK_bracketright; required_modifier = 0; found = true; break;
                case '`': keysym = XK_grave; required_modifier = 0; found = true; break;
                case ',': keysym = XK_comma; required_modifier = 0; found = true; break; // Added comma
                default: break;
            }

            if (found) {
                 keycode = XKeysymToKeycode(display, keysym);
                 if (keycode == 0) {
                     found = false; // Keycode lookup failed for this keysym
                 }
            }
        }

        // 3. If still not found, try the general Xkb lookup
        if (!found) {
             for (KeyCode kc = desc->min_key_code; kc <= desc->max_key_code; ++kc) {
                KeySym ks_level0 = XkbKeycodeToKeysym(display, kc, state.group, 0); // Level 0 (no shift)
                KeySym ks_level1 = XkbKeycodeToKeysym(display, kc, state.group, 1); // Level 1 (with shift)

                // Check level 0 (no shift)
                if (ks_level0 != NoSymbol) {
                    char* ks0_str = XKeysymToString(ks_level0);
                    if (ks0_str && strlen(ks0_str) == 1 && ks0_str[0] == c) {
                        keysym = ks_level0; // Set keysym from lookup
                        keycode = kc;
                        required_modifier = 0;
                        found = true;
                        break;
                    }
                }

                // Check level 1 (with shift)
                if (ks_level1 != NoSymbol) {
                    char* ks1_str = XKeysymToString(ks_level1); // Corrected from ks1_level
                     if (ks1_str && strlen(ks1_str) == 1 && ks1_str[0] == c) {
                        keysym = ks_level1; // Set keysym from lookup
                        keycode = kc;
                        required_modifier = ShiftMask;
                        found = true;
                        break;
                    }
                }
            }
        }

        // Get keycode for keys found explicitly (space and symbols/shifted chars)
        if (found && keycode == 0) {
             keycode = XKeysymToKeycode(display, keysym);
             if (keycode == 0) {
                 found = false; // Keycode lookup failed
             }
        }


        if (!found) {
            // Skip characters that cannot be mapped
            continue;
        }

        // Key Press for the character
        XEvent pressEvent;
        memset(&pressEvent, 0, sizeof(pressEvent));
        pressEvent.type = KeyPress;
        pressEvent.xkey.display = display;
        pressEvent.xkey.window = target_window;
        pressEvent.xkey.root = XDefaultRootWindow(display);
        pressEvent.xkey.subwindow = None;
        pressEvent.xkey.time = CurrentTime;
        pressEvent.xkey.x = 1;
        pressEvent.xkey.y = 1;
        pressEvent.xkey.x_root = 1;
        pressEvent.xkey.y_root = 1;
        pressEvent.xkey.same_screen = True;
        pressEvent.xkey.keycode = keycode;
        // Set state to current base modifiers PLUS required modifier for this key
        pressEvent.xkey.state = current_base_mods | required_modifier;

        XSendEvent(display, target_window, True, KeyPressMask, &pressEvent);
        XSync(display, False);

        // Key Release for the character
        XEvent releaseEvent = pressEvent; // Copy the press event
        releaseEvent.type = KeyRelease;
        // State for release should probably be the same as press for consistency
        releaseEvent.xkey.state = current_base_mods | required_modifier;
        XSendEvent(display, target_window, True, KeyReleaseMask, &releaseEvent);
        XSync(display, False);

        if (delay_ms > 0) {
            usleep(delay_ms * 1000); // Convert ms to microseconds
        }
    }

    // Add a 100ms delay before final enter if finish_with_enter is true
    if (finish_with_enter) {
        usleep(100 * 1000); // 100ms delay
    }

    // Press Enter after typing if finish_with_enter is true
    if (finish_with_enter) {
        KeySym enter_keysym = XK_Return;
        KeyCode enter_keycode = XKeysymToKeycode(display, enter_keysym);
         if (enter_keycode != 0) {
            XEvent enterPressEvent;
            memset(&enterPressEvent, 0, sizeof(enterPressEvent));
            enterPressEvent.type = KeyPress;
            enterPressEvent.xkey.display = display;
            enterPressEvent.xkey.window = target_window;
            enterPressEvent.xkey.root = XDefaultRootWindow(display);
            enterPressEvent.xkey.subwindow = None;
            enterPressEvent.xkey.time = CurrentTime;
            enterPressEvent.xkey.x = 1;
            enterPressEvent.xkey.y = 1;
            enterPressEvent.xkey.x_root = 1;
            enterPressEvent.xkey.y_root = 1;
            enterPressEvent.xkey.same_screen = True;
            enterPressEvent.xkey.keycode = enter_keycode;
            enterPressEvent.xkey.state = 0; // Enter key itself has no standard modifier state

            XSendEvent(display, target_window, True, KeyPressMask, &enterPressEvent);
            XSync(display, False);

            XEvent enterReleaseEvent = enterPressEvent;
            enterReleaseEvent.type = KeyRelease;
             enterReleaseEvent.xkey.state = 0; // Enter key itself has no standard modifier state
            XSendEvent(display, target_window, True, KeyReleaseMask, &enterReleaseEvent);
            XSync(display, False);
            usleep(100 * 1000); // 100ms delay after final enter release
        }
    }

    XkbFreeKeyboard(desc, XkbAllComponentsMask, True);
    XCloseDisplay(display);
}

void RotateFunction(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1) {
        Napi::TypeError::New(env, "Wrong number of arguments").ThrowAsJavaScriptException();
        return;
    }

    if (!info[0].IsNumber()) {
        Napi::TypeError::New(env, "Window ID must be a number").ThrowAsJavaScriptException();
        return;
    }

    uint64_t window_id = info[0].As<Napi::Number>().Int64Value();

    Display *display = XOpenDisplay(NULL);
    if (!display) {
        Napi::Error::New(env, "Cannot open display").ThrowAsJavaScriptException();
        return;
    }

    Window target_window = (Window)window_id;

    // Seed random number generator
    srand(time(NULL));

    // Determine random sequence for Left/Right
    KeySym arrows[5];
    arrows[0] = XK_Down;
    arrows[3] = XK_Up;
    arrows[4] = XK_Down;

    if (rand() % 2 == 0) { // Randomly choose Left then Right, or Right then Left
        arrows[1] = XK_Left;
        arrows[2] = XK_Right;
    } else {
        arrows[1] = XK_Right;
        arrows[2] = XK_Left;
    }

    int num_arrows = sizeof(arrows)/sizeof(arrows[0]);

    for (int i = 0; i < num_arrows; ++i) {
        KeySym keysym = arrows[i];
        KeyCode keycode = XKeysymToKeycode(display, keysym);
        if (keycode == 0) {
            XCloseDisplay(display);
            Napi::Error::New(env, "Invalid keycode for arrow").ThrowAsJavaScriptException();
            return;
        }

        // Key Press Event
        XEvent pressEvent;\
        memset(&pressEvent, 0, sizeof(pressEvent));
        pressEvent.type = KeyPress;
        pressEvent.xkey.display = display;
        pressEvent.xkey.window = target_window;
        pressEvent.xkey.root = XDefaultRootWindow(display);
        pressEvent.xkey.subwindow = None;
        pressEvent.xkey.time = CurrentTime;
        pressEvent.xkey.x = 1;
        pressEvent.xkey.y = 1;
        pressEvent.xkey.x_root = 1;
        pressEvent.xkey.y_root = 1;
        pressEvent.xkey.same_screen = True;
        pressEvent.xkey.keycode = keycode;
        pressEvent.xkey.state = ControlMask;  // Apply Control modifier

        XSendEvent(display, target_window, True, KeyPressMask, &pressEvent);
        XSync(display, False);

        // Key Release Event
        XEvent releaseEvent = pressEvent;  // Copy the press event
        releaseEvent.type = KeyRelease;
        XSendEvent(display, target_window, True, KeyReleaseMask, &releaseEvent);
        XSync(display, False);

        // Add randomized delay between 10 and 25ms
        int delay_ms = (rand() % 16) + 10; // Generates a number between 0 and 15, then adds 10
        usleep(delay_ms * 1000); // Convert ms to microseconds
    }

    XCloseDisplay(display);
}

void FocusWindow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Window ID must be a number").ThrowAsJavaScriptException();
        return;
    }

    uint64_t window_id = info[0].As<Napi::Number>().Int64Value();

    Display *display = XOpenDisplay(NULL);
    if (!display) {
        Napi::Error::New(env, "Cannot open display").ThrowAsJavaScriptException();
        return;
    }

    Window target_window = (Window)window_id;
    Window root_window = XDefaultRootWindow(display);

    Atom net_active_window = XInternAtom(display, "_NET_ACTIVE_WINDOW", False);

    XEvent event;
    memset(&event, 0, sizeof(event));
    event.xclient.type = ClientMessage;
    event.xclient.window = target_window;
    event.xclient.message_type = net_active_window;
    event.xclient.format = 32;
    event.xclient.data.l[0] = 1; // Source indication: 1 for normal application
    event.xclient.data.l[1] = CurrentTime;
    event.xclient.data.l[2] = 0; // Unused
    event.xclient.data.l[3] = 0; // Unused
    event.xclient.data.l[4] = 0; // Unused

    XSendEvent(display, root_window, False, SubstructureNotifyMask | SubstructureRedirectMask, &event);
    XSync(display, False);

    XCloseDisplay(display);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("sendKey", Napi::Function::New(env, SendKeypress));
    exports.Set("rotate", Napi::Function::New(env, RotateFunction));
    exports.Set("type", Napi::Function::New(env, TypeString));
    exports.Set("focusWindow", Napi::Function::New(env, FocusWindow));
    return exports;
}

NODE_API_MODULE(keypress, Init)