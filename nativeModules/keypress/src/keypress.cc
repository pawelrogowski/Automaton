#include <napi.h>
#include <X11/Xlib.h>
#include <X11/extensions/XTest.h>
#include <X11/keysym.h>
#include <X11/XKBlib.h>
#include <X11/Xatom.h>
#include <string.h>
#include <map>
#include <unistd.h>
#include <cctype>
#include <algorithm>
#include <cstdlib>
#include <ctime>
#include <iostream>

// Map for special keys (unchanged from your original)
std::map<std::string, KeySym> specialKeys = {
   {"f1", XK_F1}, {"f2", XK_F2}, {"f3", XK_F3}, {"f4", XK_F4},
   {"f5", XK_F5}, {"f6", XK_F6}, {"f7", XK_F7}, {"f8", XK_F8},
   {"f9", XK_F9}, {"f10", XK_F10}, {"f11", XK_F11}, {"f12", XK_F12},
   {"enter", XK_Return}, {"return", XK_Return}, {"tab", XK_Tab},
   {"space", XK_space}, {"backspace", XK_BackSpace}, {"delete", XK_Delete},
   {"escape", XK_Escape}, {"esc", XK_Escape}, {"=", XK_equal},
   {"-", XK_minus}, {".", XK_period}, {"/", XK_slash},
   {"\\", XK_backslash}, {";", XK_semicolon}, {"'", XK_apostrophe},
   {"[", XK_bracketleft}, {"]", XK_bracketright}, {"`", XK_grave},
   {"left", XK_Left}, {"right", XK_Right}, {"up", XK_Up},
   {"down", XK_Down}, {"home", XK_Home}, {"end", XK_End},
   {"pgup", XK_Page_Up}, {"pgdn", XK_Page_Down}, {"menu", XK_Menu},
};

// Map for modifier keys (unchanged from your original)
std::map<std::string, unsigned int> modifierKeys = {
    {"shift", ShiftMask}, {"control", ControlMask}, {"ctrl", ControlMask},
    {"alt", Mod1Mask}, {"super", Mod4Mask}, {"meta", Mod4Mask},
};


// --- AGGRESSIVE, UNCONDITIONAL FOCUS FUNCTION ---
// This function doesn't check anything. It uses the most direct X11 call
// to command the server to change the keyboard input focus.
void ForceFocus(Display* display, Window target_window) {
    // Forcefully set the keyboard input focus directly via the X server.
    XSetInputFocus(display, target_window, RevertToParent, CurrentTime);

    // Flush the request to the server and wait for it to be processed.
    // This helps ensure the focus has changed before we send key events.
    XSync(display, False);
    usleep(15000); // 15 millisecond delay, matching your original code's timing.
}


// Internal helper for keyDown and keyUp, now calling ForceFocus
void SendKeyEvent(const Napi::CallbackInfo& info, bool is_press) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsString()) {
        Napi::TypeError::New(env, "Invalid arguments (window_id, key required)").ThrowAsJavaScriptException();
        return;
    }
    uint64_t window_id = info[0].As<Napi::Number>().Int64Value();
    std::string key = info[1].As<Napi::String>().Utf8Value();
    unsigned int modifiers_state = 0;
    if (info.Length() > 2 && !info[2].IsUndefined()) {
        if (!info[2].IsString()) {
            Napi::TypeError::New(env, "Modifier must be a string").ThrowAsJavaScriptException();
            return;
        }
        std::string modifier_str = info[2].As<Napi::String>().Utf8Value();
        std::transform(modifier_str.begin(), modifier_str.end(), modifier_str.begin(), ::tolower);
        if (modifierKeys.count(modifier_str)) {
            modifiers_state = modifierKeys[modifier_str];
        } else {
            Napi::Error::New(env, "Invalid modifier: " + modifier_str).ThrowAsJavaScriptException();
            return;
        }
    }
    std::transform(key.begin(), key.end(), key.begin(), ::tolower);
    Display *display = XOpenDisplay(NULL);
    if (!display) {
        Napi::Error::New(env, "Cannot open display").ThrowAsJavaScriptException();
        return;
    }
    Window target_window = (Window)window_id;

    ForceFocus(display, target_window); // <-- UPDATED CALL

    KeySym keysym = (specialKeys.count(key)) ? specialKeys[key] : XStringToKeysym(key.c_str());
    if (keysym == NoSymbol) {
        XCloseDisplay(display);
        Napi::Error::New(env, "Invalid key: " + key).ThrowAsJavaScriptException();
        return;
    }
    KeyCode keycode = XKeysymToKeycode(display, keysym);
    XkbStateRec state;
    XkbGetState(display, XkbUseCoreKbd, &state);
    unsigned int current_base_mods = state.base_mods;
    XEvent event;
    memset(&event, 0, sizeof(event));
    event.xkey.display = display; event.xkey.window = target_window; event.xkey.root = XDefaultRootWindow(display);
    event.xkey.subwindow = None; event.xkey.time = CurrentTime; event.xkey.x = 1; event.xkey.y = 1;
    event.xkey.x_root = 1; event.xkey.y_root = 1; event.xkey.same_screen = True;
    event.xkey.keycode = keycode; event.xkey.state = current_base_mods | modifiers_state;
    event.type = is_press ? KeyPress : KeyRelease;
    XSendEvent(display, target_window, True, is_press ? KeyPressMask : KeyReleaseMask, &event);
    XSync(display, False);
    XCloseDisplay(display);
}

void KeyDown(const Napi::CallbackInfo& info) { SendKeyEvent(info, true); }
void KeyUp(const Napi::CallbackInfo& info) { SendKeyEvent(info, false); }

void SendKeypress(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsString()) {
        Napi::TypeError::New(env, "Invalid arguments").ThrowAsJavaScriptException();
        return;
    }
    uint64_t window_id = info[0].As<Napi::Number>().Int64Value();
    std::string key = info[1].As<Napi::String>().Utf8Value();
    unsigned int modifiers_state = 0;
    if (info.Length() > 2 && !info[2].IsUndefined()) {
        if (!info[2].IsString()) {
            Napi::TypeError::New(env, "Modifier must be a string").ThrowAsJavaScriptException();
            return;
        }
        std::string modifier_str = info[2].As<Napi::String>().Utf8Value();
        std::transform(modifier_str.begin(), modifier_str.end(), modifier_str.begin(), ::tolower);
        if (modifierKeys.count(modifier_str)) {
            modifiers_state = modifierKeys[modifier_str];
        } else {
            Napi::Error::New(env, "Invalid modifier: " + modifier_str).ThrowAsJavaScriptException();
            return;
        }
    }
    std::transform(key.begin(), key.end(), key.begin(), ::tolower);
    Display *display = XOpenDisplay(NULL);
    if (!display) {
        Napi::Error::New(env, "Cannot open display").ThrowAsJavaScriptException();
        return;
    }
    Window target_window = (Window)window_id;

    ForceFocus(display, target_window); // <-- UPDATED CALL

    KeySym keysym = (specialKeys.count(key)) ? specialKeys[key] : XStringToKeysym(key.c_str());
    if (keysym == NoSymbol) {
        XCloseDisplay(display);
        Napi::Error::New(env, "Invalid key: " + key).ThrowAsJavaScriptException();
        return;
    }
    KeyCode keycode = XKeysymToKeycode(display, keysym);
    XkbStateRec state;
    XkbGetState(display, XkbUseCoreKbd, &state);
    unsigned int current_base_mods = state.base_mods;
    XEvent event;
    memset(&event, 0, sizeof(event));
    event.xkey.display = display; event.xkey.window = target_window; event.xkey.root = XDefaultRootWindow(display);
    event.xkey.subwindow = None; event.xkey.time = CurrentTime; event.xkey.x = 1; event.xkey.y = 1;
    event.xkey.x_root = 1; event.xkey.y_root = 1; event.xkey.same_screen = True;
    event.xkey.keycode = keycode; event.xkey.state = current_base_mods | modifiers_state;
    event.type = KeyPress;
    XSendEvent(display, target_window, True, KeyPressMask, &event);
    XSync(display, False);
    event.type = KeyRelease;
    XSendEvent(display, target_window, True, KeyReleaseMask, &event);
    XSync(display, False);
    XCloseDisplay(display);
}

void TypeString(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsString()) {
        Napi::TypeError::New(env, "Invalid arguments").ThrowAsJavaScriptException();
        return;
    }
    uint64_t window_id = info[0].As<Napi::Number>().Int64Value();
    std::string str = info[1].As<Napi::String>().Utf8Value();
    int delay_ms = 0;
    bool finish_with_enter = false;
    if (info.Length() > 2 && !info[2].IsUndefined()) {
        if (!info[2].IsNumber()) { Napi::TypeError::New(env, "Delay must be a number").ThrowAsJavaScriptException(); return; }
        delay_ms = info[2].As<Napi::Number>().Int32Value();
    }
    if (info.Length() > 3 && !info[3].IsUndefined()) {
        if (!info[3].IsBoolean()) { Napi::TypeError::New(env, "finish_with_enter must be a boolean").ThrowAsJavaScriptException(); return; }
        finish_with_enter = info[3].As<Napi::Boolean>().Value();
    }
    Display *display = XOpenDisplay(NULL);
    if (!display) { Napi::Error::New(env, "Cannot open display").ThrowAsJavaScriptException(); return; }
    Window target_window = (Window)window_id;

    ForceFocus(display, target_window); // <-- UPDATED CALL

    XkbDescPtr desc = XkbGetMap(display, XkbAllMapComponentsMask, XkbUseCoreKbd);
    if (!desc) { XCloseDisplay(display); Napi::Error::New(env, "Cannot get keyboard mapping").ThrowAsJavaScriptException(); return; }
    auto send_enter = [&](Display* d, Window w) {
        KeySym ks = XK_Return; KeyCode kc = XKeysymToKeycode(d, ks);
        if (kc != 0) {
            XEvent ev; memset(&ev, 0, sizeof(ev));
            ev.xkey.display = d; ev.xkey.window = w; ev.xkey.root = XDefaultRootWindow(d);
            ev.xkey.subwindow = None; ev.xkey.time = CurrentTime; ev.xkey.x = 1; ev.xkey.y = 1;
            ev.xkey.x_root = 1; ev.xkey.y_root = 1; ev.xkey.same_screen = True;
            ev.xkey.keycode = kc; ev.xkey.state = 0;
            ev.type = KeyPress; XSendEvent(d, w, True, KeyPressMask, &ev); XSync(d, False);
            ev.type = KeyRelease; XSendEvent(d, w, True, KeyReleaseMask, &ev); XSync(d, False);
        }
    };
    if (finish_with_enter) { send_enter(display, target_window); usleep(100 * 1000); }
    XkbStateRec state; XkbGetState(display, XkbUseCoreKbd, &state);
    unsigned int current_base_mods = state.base_mods;
    for (char c : str) {
        KeyCode keycode = 0; unsigned int required_modifier = 0; bool found = false; KeySym keysym = NoSymbol;
        if (c == ' ') { keysym = XK_space; required_modifier = 0; found = true; } else { switch (c) { case '(': keysym = XK_parenleft; required_modifier = ShiftMask; found = true; break; case ')': keysym = XK_parenright; required_modifier = ShiftMask; found = true; break; case '!': keysym = XK_exclam; required_modifier = ShiftMask; found = true; break; case '@': keysym = XK_at; required_modifier = ShiftMask; found = true; break; case '#': keysym = XK_numbersign; required_modifier = ShiftMask; found = true; break; case '$': keysym = XK_dollar; required_modifier = ShiftMask; found = true; break; case '%': keysym = XK_percent; required_modifier = ShiftMask; found = true; break; case '^': keysym = XK_asciicircum; required_modifier = ShiftMask; found = true; break; case '&': keysym = XK_ampersand; required_modifier = ShiftMask; found = true; break; case '*': keysym = XK_asterisk; required_modifier = ShiftMask; found = true; break; case '_': keysym = XK_underscore; required_modifier = ShiftMask; found = true; break; case '+': keysym = XK_plus; required_modifier = ShiftMask; found = true; break; case '{': keysym = XK_braceleft; required_modifier = ShiftMask; found = true; break; case '}': keysym = XK_braceright; required_modifier = ShiftMask; found = true; break; case ':': keysym = XK_colon; required_modifier = ShiftMask; found = true; break; case '"': keysym = XK_quotedbl; required_modifier = ShiftMask; found = true; break; case '<': keysym = XK_less; required_modifier = ShiftMask; found = true; break; case '>': keysym = XK_greater; required_modifier = ShiftMask; found = true; break; case '?': keysym = XK_question; required_modifier = ShiftMask; found = true; break; case '~': keysym = XK_asciitilde; required_modifier = ShiftMask; found = true; break; case '|': keysym = XK_bar; required_modifier = ShiftMask; found = true; break; case '=': keysym = XK_equal; required_modifier = 0; found = true; break; case '-': keysym = XK_minus; required_modifier = 0; found = true; break; case '.': keysym = XK_period; required_modifier = 0; found = true; break; case '/': keysym = XK_slash; required_modifier = 0; found = true; break; case '\\': keysym = XK_backslash; required_modifier = 0; found = true; break; case ';': keysym = XK_semicolon; required_modifier = 0; found = true; break; case '\'': keysym = XK_apostrophe; required_modifier = 0; found = true; break; case '[': keysym = XK_bracketleft; required_modifier = 0; found = true; break; case ']': keysym = XK_bracketright; required_modifier = 0; found = true; break; case '`': keysym = XK_grave; required_modifier = 0; found = true; break; case ',': keysym = XK_comma; required_modifier = 0; found = true; break; default: break; } if (found) { keycode = XKeysymToKeycode(display, keysym); if (keycode == 0) found = false; } }
        if (!found) { for (KeyCode kc = desc->min_key_code; kc <= desc->max_key_code; ++kc) { KeySym ks0 = XkbKeycodeToKeysym(display, kc, state.group, 0); if (ks0 != NoSymbol) { char* s = XKeysymToString(ks0); if (s && strlen(s) == 1 && s[0] == c) { keysym = ks0; keycode = kc; required_modifier = 0; found = true; break; } } KeySym ks1 = XkbKeycodeToKeysym(display, kc, state.group, 1); if (ks1 != NoSymbol) { char* s = XKeysymToString(ks1); if (s && strlen(s) == 1 && s[0] == c) { keysym = ks1; keycode = kc; required_modifier = ShiftMask; found = true; break; } } } }
        if (found && keycode == 0) { keycode = XKeysymToKeycode(display, keysym); if (keycode == 0) found = false; }
        if (!found) continue;
        XEvent pressEvent; memset(&pressEvent, 0, sizeof(pressEvent));
        pressEvent.type = KeyPress; pressEvent.xkey.display = display; pressEvent.xkey.window = target_window;
        pressEvent.xkey.root = XDefaultRootWindow(display); pressEvent.xkey.subwindow = None; pressEvent.xkey.time = CurrentTime;
        pressEvent.xkey.x = 1; pressEvent.xkey.y = 1; pressEvent.xkey.x_root = 1; pressEvent.xkey.y_root = 1;
        pressEvent.xkey.same_screen = True; pressEvent.xkey.keycode = keycode;
        pressEvent.xkey.state = current_base_mods | required_modifier;
        XSendEvent(display, target_window, True, KeyPressMask, &pressEvent); XSync(display, False);
        XEvent releaseEvent = pressEvent; releaseEvent.type = KeyRelease;
        XSendEvent(display, target_window, True, KeyReleaseMask, &releaseEvent); XSync(display, False);
        if (delay_ms > 0) usleep(delay_ms * 1000);
    }
    if (finish_with_enter) { usleep(100 * 1000); send_enter(display, target_window); usleep(100 * 1000); }
    XkbFreeKeyboard(desc, XkbAllComponentsMask, True);
    XCloseDisplay(display);
}

void RotateFunction(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) { Napi::TypeError::New(env, "Window ID must be a number").ThrowAsJavaScriptException(); return; }
    uint64_t window_id = info[0].As<Napi::Number>().Int64Value();
    Display *display = XOpenDisplay(NULL);
    if (!display) { Napi::Error::New(env, "Cannot open display").ThrowAsJavaScriptException(); return; }
    Window target_window = (Window)window_id;

    ForceFocus(display, target_window); // <-- UPDATED CALL

    srand(time(NULL));
    KeySym arrows[5];
    arrows[0] = XK_Down; arrows[3] = XK_Up; arrows[4] = XK_Down;
    arrows[1] = (rand() % 2 == 0) ? XK_Left : XK_Right;
    arrows[2] = (arrows[1] == XK_Left) ? XK_Right : XK_Left;
    for (int i = 0; i < 5; ++i) {
        KeyCode keycode = XKeysymToKeycode(display, arrows[i]);
        if (keycode == 0) continue;
        XEvent ev; memset(&ev, 0, sizeof(ev));
        ev.xkey.display = display; ev.xkey.window = target_window; ev.xkey.root = XDefaultRootWindow(display);
        ev.xkey.subwindow = None; ev.xkey.time = CurrentTime; ev.xkey.x = 1; ev.xkey.y = 1;
        ev.xkey.x_root = 1; ev.xkey.y_root = 1; ev.xkey.same_screen = True;
        ev.xkey.keycode = keycode; ev.xkey.state = ControlMask;
        ev.type = KeyPress; XSendEvent(display, target_window, True, KeyPressMask, &ev); XSync(display, False);
        ev.type = KeyRelease; XSendEvent(display, target_window, True, KeyReleaseMask, &ev); XSync(display, False);
        usleep(((rand() % 16) + 10) * 1000);
    }
    XCloseDisplay(display);
}

void FocusWindow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsNumber()) { Napi::TypeError::New(env, "Window ID must be a number").ThrowAsJavaScriptException(); return; }
    // --- THIS IS THE FIX ---
    uint64_t window_id = info[0].As<Napi::Number>().Int64Value();
    // --- END FIX ---
    Display *display = XOpenDisplay(NULL);
    if (!display) { Napi::Error::New(env, "Cannot open display").ThrowAsJavaScriptException(); return; }

    ForceFocus(display, (Window)window_id); // <-- UPDATED CALL

    XCloseDisplay(display);
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    // CRITICAL: Initialize X11 for multi-threaded access.
    // This is essential for stability within a complex application like Electron.
    if (!XInitThreads()) {
      std::cerr << "keypress-native: Warning - XInitThreads() failed. This could lead to instability." << std::endl;
    }

    exports.Set("sendKey", Napi::Function::New(env, SendKeypress));
    exports.Set("rotate", Napi::Function::New(env, RotateFunction));
    exports.Set("type", Napi::Function::New(env, TypeString));
    exports.Set("focusWindow", Napi::Function::New(env, FocusWindow));
    exports.Set("keyDown", Napi::Function::New(env, KeyDown));
    exports.Set("keyUp", Napi::Function::New(env, KeyUp));
    return exports;
}

NODE_API_MODULE(keypress, Init);