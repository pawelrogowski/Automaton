#include <napi.h>
#include <X11/Xlib.h>
#include <X11/keysym.h>
#include <X11/XKBlib.h>
#include <X11/Xatom.h>
#include <string>
#include <map>
#include <vector>
#include <unistd.h>
#include <cctype>
#include <algorithm>
#include <cstdlib>
#include <ctime>
#include <iostream>
#include <thread>
#include <chrono>
#include <random>

// --- KEY MAPS ---
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

std::map<std::string, unsigned int> modifierKeys = {
    {"shift", ShiftMask}, {"control", ControlMask}, {"ctrl", ControlMask},
    {"alt", Mod1Mask}, {"super", Mod4Mask}, {"meta", Mod4Mask},
};

std::map<char, KeySym> directionKeys = {
    {'n', XK_Up}, {'s', XK_Down}, {'e', XK_Right}, {'w', XK_Left}
};

// Random number generator for delays
std::mt19937 rng(std::chrono::steady_clock::now().time_since_epoch().count());

// Gets a human-like, fluctuating delay
int get_human_delay(int base_delay_ms, int fluctuation_ms) {
    std::uniform_int_distribution<int> dist(-fluctuation_ms, fluctuation_ms);
    return std::max(1, base_delay_ms + dist(rng));
}

// --- ASYNC WORKER for SendKey ---
class SendKeyWorker : public Napi::AsyncWorker {
public:
    SendKeyWorker(Napi::Env env, Napi::Promise::Deferred deferred, uint64_t window_id, std::string key, std::string modifier, std::string display_name)
        : Napi::AsyncWorker(env), deferred(deferred), window_id(window_id), key(key), modifier(modifier), display_name(display_name) {}

protected:
    void Execute() override {
        Display *display = XOpenDisplay(display_name.empty() ? NULL : display_name.c_str());
        if (!display) {
            SetError("Cannot open display: " + display_name);
            return;
        }
        Window target_window = (Window)window_id;

        unsigned int modifiers_state = 0;
        if (!modifier.empty()) {
            std::transform(modifier.begin(), modifier.end(), modifier.begin(), ::tolower);
            if (modifierKeys.count(modifier)) {
                modifiers_state = modifierKeys[modifier];
            } else {
                XCloseDisplay(display);
                SetError("Invalid modifier: " + modifier);
                return;
            }
        }

        std::transform(key.begin(), key.end(), key.begin(), ::tolower);
        KeySym keysym = (specialKeys.count(key)) ? specialKeys[key] : XStringToKeysym(key.c_str());
        if (keysym == NoSymbol) {
            XCloseDisplay(display);
            SetError("Invalid key: " + key);
            return;
        }

        KeyCode keycode = XKeysymToKeycode(display, keysym);
        if (keycode == 0) {
            XCloseDisplay(display);
            SetError("Could not get keycode for key: " + key);
            return;
        }

        XkbStateRec state;
        XkbGetState(display, XkbUseCoreKbd, &state);
        unsigned int current_base_mods = state.base_mods;

        XEvent event;
        memset(&event, 0, sizeof(event));
        event.xkey.display = display;
        event.xkey.window = target_window;
        event.xkey.root = XDefaultRootWindow(display);
        event.xkey.subwindow = None;
        event.xkey.time = CurrentTime;
        event.xkey.x = 1; event.xkey.y = 1;
        event.xkey.x_root = 1; event.xkey.y_root = 1;
        event.xkey.same_screen = True;
        event.xkey.keycode = keycode;
        event.xkey.state = current_base_mods | modifiers_state;

        // Key Press
        event.type = KeyPress;
        XSendEvent(display, target_window, True, KeyPressMask, &event);
        XSync(display, False);

        usleep(get_human_delay(50, 20) * 1000); // Default delay for single key presses

        // Key Release
        event.type = KeyRelease;
        XSendEvent(display, target_window, True, KeyReleaseMask, &event);
        XSync(display, False);

        XCloseDisplay(display);
    }

    void OnOK() override {
        deferred.Resolve(Env().Undefined());
    }

    void OnError(const Napi::Error& e) override {
        deferred.Reject(Napi::Error::New(Env(), e.Message()).Value());
    }

private:
    Napi::Promise::Deferred deferred;
    uint64_t window_id;
    std::string key;
    std::string modifier;
    std::string display_name; // New member for display name
};

// --- ASYNC WORKER for TypeString ---
class TypeStringWorker : public Napi::AsyncWorker {
public:
    TypeStringWorker(Napi::Env env, Napi::Promise::Deferred deferred, uint64_t window_id, std::string str, bool start_and_end_with_enter, std::string display_name)
        : Napi::AsyncWorker(env), deferred(deferred), window_id(window_id), str(str), start_and_end_with_enter(start_and_end_with_enter), display_name(display_name) {}

protected:
    void Execute() override {
        Display *display = XOpenDisplay(display_name.empty() ? NULL : display_name.c_str());
        if (!display) {
            SetError("Cannot open display: " + display_name);
            return;
        }
        Window target_window = (Window)window_id;

        XkbDescPtr desc = XkbGetMap(display, XkbAllMapComponentsMask, XkbUseCoreKbd);
        if (!desc) {
            XCloseDisplay(display);
            SetError("Cannot get keyboard mapping");
            return;
        }

        XkbStateRec state;
        XkbGetState(display, XkbUseCoreKbd, &state);
        unsigned int current_base_mods = state.base_mods;

        // Helper to send an instantaneous key press/release
        auto send_key_event = [&](Display* d, Window w, KeyCode kc, unsigned int mods) {
            XEvent ev;
            memset(&ev, 0, sizeof(ev));
            ev.xkey.display = d;
            ev.xkey.window = w;
            ev.xkey.root = XDefaultRootWindow(d);
            ev.xkey.subwindow = None;
            ev.xkey.time = CurrentTime;
            ev.xkey.x = 1; ev.xkey.y = 1;
            ev.xkey.x_root = 1; ev.xkey.y_root = 1;
            ev.xkey.same_screen = True;
            ev.xkey.keycode = kc;
            ev.xkey.state = mods;

            ev.type = KeyPress;
            XSendEvent(d, w, True, KeyPressMask, &ev);
            XSync(d, False);

            usleep(get_human_delay(20, 10) * 1000);

            ev.type = KeyRelease;
            XSendEvent(d, w, True, KeyReleaseMask, &ev);
            XSync(d, False);
        };

        // Helper to send an instantaneous Enter key press
        auto send_enter_key = [&](Display* d, Window w, unsigned int mods) {
            KeySym ks = XK_Return;
            KeyCode kc = XKeysymToKeycode(d, ks);
            if (kc != 0) {
                send_key_event(d, w, kc, mods);
            }
        };

        if (start_and_end_with_enter) {
            send_enter_key(display, target_window, current_base_mods);
            usleep(get_human_delay(50, 10) * 1000); // Small delay after initial enter
        }

        for (char c : str) {
            KeySym keysym = NoSymbol;
            unsigned int required_modifier = 0;

            // --- FIX: Properly handle all characters including special symbols using correct key mappings ---
            if (c == ' ') {
                keysym = XK_space;
            } else if (c == '\'') {
                keysym = XK_apostrophe;
            } else if (c == '.') {
                keysym = XK_period;
            } else if (c == '@') {
                // '@' is Shift+2 on US keyboards
                keysym = XK_2;
                required_modifier = ShiftMask;
            } else if (c == ',') {
                keysym = XK_comma;
            } else if (c == '-') {
                keysym = XK_minus;
            } else if (c == '_') {
                // '_' is Shift+- on US keyboards
                keysym = XK_minus;
                required_modifier = ShiftMask;
            } else if (c == '+') {
                // '+' is Shift+= on US keyboards
                keysym = XK_equal;
                required_modifier = ShiftMask;
            } else if (c == '=') {
                keysym = XK_equal;
            } else if (c == '!') {
                // '!' is Shift+1 on US keyboards
                keysym = XK_1;
                required_modifier = ShiftMask;
            } else if (c == '#') {
                // '#' is Shift+3 on US keyboards
                keysym = XK_3;
                required_modifier = ShiftMask;
            } else if (c == '$') {
                // '$' is Shift+4 on US keyboards
                keysym = XK_4;
                required_modifier = ShiftMask;
            } else if (c == '%') {
                // '%' is Shift+5 on US keyboards
                keysym = XK_5;
                required_modifier = ShiftMask;
            } else if (c == '^') {
                // '^' is Shift+6 on US keyboards
                keysym = XK_6;
                required_modifier = ShiftMask;
            } else if (c == '&') {
                // '&' is Shift+7 on US keyboards
                keysym = XK_7;
                required_modifier = ShiftMask;
            } else if (c == '*') {
                // '*' is Shift+8 on US keyboards
                keysym = XK_8;
                required_modifier = ShiftMask;
            } else if (c == '(') {
                // '(' is Shift+9 on US keyboards
                keysym = XK_9;
                required_modifier = ShiftMask;
            } else if (c == ')') {
                // ')' is Shift+0 on US keyboards
                keysym = XK_0;
                required_modifier = ShiftMask;
            } else if (c == '{') {
                // '{' is Shift+[ on US keyboards
                keysym = XK_bracketleft;
                required_modifier = ShiftMask;
            } else if (c == '}') {
                // '}' is Shift+] on US keyboards
                keysym = XK_bracketright;
                required_modifier = ShiftMask;
            } else if (c == '|') {
                // '|' is Shift+\ on US keyboards
                keysym = XK_backslash;
                required_modifier = ShiftMask;
            } else if (c == ':') {
                // ':' is Shift+; on US keyboards
                keysym = XK_semicolon;
                required_modifier = ShiftMask;
            } else if (c == '"') {
                // '"' is Shift+' on US keyboards
                keysym = XK_apostrophe;
                required_modifier = ShiftMask;
            } else if (c == '<') {
                // '<' is Shift+, on US keyboards
                keysym = XK_comma;
                required_modifier = ShiftMask;
            } else if (c == '>') {
                // '>' is Shift+. on US keyboards
                keysym = XK_period;
                required_modifier = ShiftMask;
            } else if (c == '?') {
                // '?' is Shift+/ on US keyboards
                keysym = XK_slash;
                required_modifier = ShiftMask;
            } else if (c == '~') {
                // '~' is Shift+` on US keyboards
                keysym = XK_grave;
                required_modifier = ShiftMask;
            } else if (c == '`') {
                keysym = XK_grave;
            } else if (c == '/') {
                keysym = XK_slash;
            } else if (c == '\\') {
                keysym = XK_backslash;
            } else if (c == ';') {
                keysym = XK_semicolon;
            } else if (c == '[') {
                keysym = XK_bracketleft;
            } else if (c == ']') {
                keysym = XK_bracketright;
            } else if (isalpha(c)) {
                if (isupper(c)) {
                    keysym = XK_a + (tolower(c) - 'a');
                    required_modifier = ShiftMask;
                } else {
                    keysym = XK_a + (c - 'a');
                }
            } else if (isdigit(c)) {
                keysym = XK_0 + (c - '0');
            } else {
                // Fallback for any other characters using XStringToKeysym
                keysym = XStringToKeysym(std::string(1, c).c_str());
                if (keysym == NoSymbol) {
                    // If XStringToKeysym fails, try the shifted version
                    keysym = XStringToKeysym(std::string(1, tolower(c)).c_str());
                    if (isupper(c)) {
                        required_modifier = ShiftMask;
                    }
                }
            }

            if (keysym == NoSymbol) continue;

            KeyCode keycode = XKeysymToKeycode(display, keysym);
            if (keycode == 0) continue;

            send_key_event(display, target_window, keycode, current_base_mods | required_modifier);

            int base_delay = 70;
            int fluctuation = 30;
            if (str.length() > 10) {
                base_delay = 50;
                fluctuation = 20;
            }
            usleep(get_human_delay(base_delay, fluctuation) * 1000);
        }

        if (start_and_end_with_enter) {
            usleep(get_human_delay(50, 10) * 1000);
            send_enter_key(display, target_window, current_base_mods);
            usleep(get_human_delay(50, 10) * 1000);
        }

        XkbFreeKeyboard(desc, XkbAllComponentsMask, True);
        XCloseDisplay(display);
    }

    void OnOK() override {
        deferred.Resolve(Env().Undefined());
    }

    void OnError(const Napi::Error& e) override {
        deferred.Reject(Napi::Error::New(Env(), e.Message()).Value());
    }

private:
    Napi::Promise::Deferred deferred;
    uint64_t window_id;
    std::string str;
    bool start_and_end_with_enter;
    std::string display_name; // New member for display name
};


// --- ASYNC WORKER for Rotate ---
class RotateWorker : public Napi::AsyncWorker {
public:
    RotateWorker(Napi::Env env, Napi::Promise::Deferred deferred, uint64_t window_id, char direction, std::string display_name)
        : Napi::AsyncWorker(env), deferred(deferred), window_id(window_id), direction(direction), display_name(display_name) {}

protected:
    void Execute() override {
        Display *display = XOpenDisplay(display_name.empty() ? NULL : display_name.c_str());
        if (!display) {
            SetError("Cannot open display: " + display_name);
            return;
        }
        Window target_window = (Window)window_id;

        std::vector<KeySym> key_sequence;
        key_sequence.push_back(XK_Down);
        bool go_left = (rand() % 2 == 0);
        key_sequence.push_back(go_left ? XK_Left : XK_Right);
        key_sequence.push_back(go_left ? XK_Right : XK_Left);
        key_sequence.push_back(XK_Up);
        key_sequence.push_back(XK_Down);

        if (direction != '\0') {
            auto it = directionKeys.find(direction);
            if (it != directionKeys.end()) {
                key_sequence.back() = it->second;
            }
        }

        KeyCode ctrl_keycode = XKeysymToKeycode(display, XK_Control_L);
        if (ctrl_keycode == 0) {
            XCloseDisplay(display);
            SetError("Could not find keycode for Control_L key.");
            return;
        }

        XEvent event;
        memset(&event, 0, sizeof(event));
        event.xkey.display = display;
        event.xkey.window = target_window;
        event.xkey.root = XDefaultRootWindow(display);
        event.xkey.keycode = ctrl_keycode;

        event.type = KeyPress;
        XSendEvent(display, target_window, True, KeyPressMask, &event);
        XSync(display, False);
        usleep(20 * 1000);

        for (KeySym keysym : key_sequence) {
            KeyCode keycode = XKeysymToKeycode(display, keysym);
            if (keycode == 0) continue;
            event.xkey.keycode = keycode;
            event.xkey.state = ControlMask;

            event.type = KeyPress;
            XSendEvent(display, target_window, True, KeyPressMask, &event);
            XSync(display, False);
            usleep(((rand() % 41) + 30) * 1000);

            event.type = KeyRelease;
            XSendEvent(display, target_window, True, KeyReleaseMask, &event);
            XSync(display, False);
            usleep(((rand() % 41) + 25) * 1000);
        }

        event.xkey.keycode = ctrl_keycode;
        event.type = KeyRelease;
        XSendEvent(display, target_window, True, KeyReleaseMask, &event);
        XSync(display, False);

        XCloseDisplay(display);
    }

    void OnOK() override {
        deferred.Resolve(Env().Undefined());
    }

    void OnError(const Napi::Error& e) override {
        deferred.Reject(Napi::Error::New(Env(), e.Message()).Value());
    }

private:
    Napi::Promise::Deferred deferred;
    uint64_t window_id;
    char direction;
    std::string display_name; // New member for display name
};

// --- N-API WRAPPERS ---
Napi::Value SendKeyAsync(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    auto deferred = Napi::Promise::Deferred::New(env);

    if (info.Length() < 3 || !info[0].IsNumber() || !info[1].IsString() || !info[2].IsString()) { // Added display_name as required
        deferred.Reject(Napi::TypeError::New(env, "sendKey(windowId, key, display, [modifier]) requires windowId, key, and display.").Value());
        return deferred.Promise();
    }

    uint64_t window_id = info[0].As<Napi::Number>().Int64Value();
    std::string key = info[1].As<Napi::String>().Utf8Value();
    std::string display_name = info[2].As<Napi::String>().Utf8Value(); // Get display_name
    std::string modifier = "";

    if (info.Length() > 3 && info[3].IsString()) { // Adjusted index for modifier
        modifier = info[3].As<Napi::String>().Utf8Value();
    }

    SendKeyWorker* worker = new SendKeyWorker(env, deferred, window_id, key, modifier, display_name);
    worker->Queue();
    return deferred.Promise();
}

Napi::Value TypeStringAsync(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    auto deferred = Napi::Promise::Deferred::New(env);

    if (info.Length() < 3 || !info[0].IsNumber() || !info[1].IsString() || !info[2].IsString()) { // Added display_name as required
        deferred.Reject(Napi::TypeError::New(env, "type(windowId, text, display, [startAndEndWithEnter]) requires windowId, text, and display.").Value());
        return deferred.Promise();
    }

    uint64_t window_id = info[0].As<Napi::Number>().Int64Value();
    std::string str = info[1].As<Napi::String>().Utf8Value();
    std::string display_name = info[2].As<Napi::String>().Utf8Value(); // Get display_name
    bool start_and_end_with_enter = false;

    if (info.Length() > 3 && info[3].IsBoolean()) { // Adjusted index for start_and_end_with_enter
        start_and_end_with_enter = info[3].As<Napi::Boolean>().Value();
    }

    TypeStringWorker* worker = new TypeStringWorker(env, deferred, window_id, str, start_and_end_with_enter, display_name);
    worker->Queue();
    return deferred.Promise();
}

Napi::Value RotateAsync(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    auto deferred = Napi::Promise::Deferred::New(env);

    if (info.Length() < 2 || !info[0].IsNumber() || !info[1].IsString()) { // Added display_name as required
        deferred.Reject(Napi::TypeError::New(env, "rotate(windowId, display, [direction]) requires windowId and display.").Value());
        return deferred.Promise();
    }

    uint64_t window_id = info[0].As<Napi::Number>().Int64Value();
    std::string display_name = info[1].As<Napi::String>().Utf8Value(); // Get display_name
    char direction_char = '\0';

    if (info.Length() > 2 && info[2].IsString()) { // Adjusted index for direction
        std::string direction_str = info[2].As<Napi::String>().Utf8Value();
        if (direction_str.length() == 1) {
            char c = tolower(direction_str[0]);
            if (directionKeys.count(c)) {
                direction_char = c;
            }
        }
    }

    RotateWorker* worker = new RotateWorker(env, deferred, window_id, direction_char, display_name);
    worker->Queue();
    return deferred.Promise();
}

// --- MODULE INITIALIZATION ---
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    if (!XInitThreads()) {
      std::cerr << "keypress-native: Warning - XInitThreads() failed." << std::endl;
    }
    srand(time(NULL));

    exports.Set("sendKey", Napi::Function::New(env, SendKeyAsync));
    exports.Set("rotate", Napi::Function::New(env, RotateAsync));
    exports.Set("type", Napi::Function::New(env, TypeStringAsync));
    return exports;
}

NODE_API_MODULE(keypress, Init);