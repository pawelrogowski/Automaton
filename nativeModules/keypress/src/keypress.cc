#include <napi.h>
#include <X11/Xlib.h>
#include <X11/keysym.h>
#include <X11/XKBlib.h>
#include <X11/Xatom.h>
#include <X11/extensions/XTest.h>
#include <string>
#include <map>
#include <vector>
#include <unordered_map>
#include <unistd.h>
#include <cctype>
#include <algorithm>
#include <cstdlib>
#include <ctime>
#include <iostream>
#include <thread>
#include <chrono>
#include <random>
#include <cmath>
#include <memory>

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

class HumanTimingGenerator {
private:
    std::mt19937 rng;
    std::normal_distribution<double> normal_dist;
    std::uniform_real_distribution<double> uniform_dist;

public:
    HumanTimingGenerator() : rng(std::random_device{}()), normal_dist(0.0, 1.0), uniform_dist(0.0, 1.0) {}

    int get_pro_gamer_delay(int base_ms, int max_variation_ms) {
        double rand_val = uniform_dist(rng);
        double variation;

        if (rand_val < 0.8) {
            variation = normal_dist(rng) * max_variation_ms;
        } else {
            variation = (uniform_dist(rng) - 0.5) * 2.0 * max_variation_ms;
        }

        int result = static_cast<int>(base_ms + variation);
        return std::max(1, std::min(result, base_ms + max_variation_ms));
    }

    bool should_add_micro_delay() {
        return uniform_dist(rng) < 0.02;
    }

    int get_micro_delay() {
        return get_pro_gamer_delay(10, 5);
    }
};

HumanTimingGenerator timing_generator;

class BehaviorProfile {
private:
    int typing_speed_preference;
    int error_rate;
    int correction_speed;

public:
    BehaviorProfile() {
        typing_speed_preference = rand() % 3;
        error_rate = rand() % 2;
        correction_speed = rand() % 3;
    }

    int get_base_delay() const {
        switch (typing_speed_preference) {
            case 0: return 35;
            case 1: return 25;
            case 2: return 15;
            default: return 25;
        }
    }

    int get_delay_variation() const {
        switch (typing_speed_preference) {
            case 0: return 15;
            case 1: return 10;
            case 2: return 5;
            default: return 10;
        }
    }

    bool should_make_error() const {
        return (rand() % 100) < error_rate;
    }

    int get_correction_delay() const {
        switch (correction_speed) {
            case 0: return 80;
            case 1: return 50;
            case 2: return 30;
            default: return 50;
        }
    }
};

class SessionManager {
private:
    static int session_counter;
    static std::unordered_map<int, std::shared_ptr<BehaviorProfile>> session_profiles;

public:
    static std::shared_ptr<BehaviorProfile> get_current_profile() {
        if (session_profiles.find(session_counter) == session_profiles.end()) {
            session_profiles[session_counter] = std::make_shared<BehaviorProfile>();
        }
        return session_profiles[session_counter];
    }

    static void new_session() {
        session_counter++;
        if (session_profiles.size() > 20) {
            session_profiles.clear();
        }
    }

    static int get_session_id() {
        return session_counter;
    }
};

int SessionManager::session_counter = 0;
std::unordered_map<int, std::shared_ptr<BehaviorProfile>> SessionManager::session_profiles;

class TypingMistakeSimulator {
private:
    std::unordered_map<char, std::vector<char>> nearby_keys;

public:
    TypingMistakeSimulator() {
        nearby_keys = {
            {'q', {'w', 'a'}},
            {'w', {'q', 'e', 'a', 's'}},
            {'e', {'w', 'r', 's', 'd'}},
            {'r', {'e', 't', 'd', 'f'}},
            {'t', {'r', 'y', 'f', 'g'}},
            {'y', {'t', 'u', 'g', 'h'}},
            {'u', {'y', 'i', 'h', 'j'}},
            {'i', {'u', 'o', 'j', 'k'}},
            {'o', {'i', 'p', 'k', 'l'}},
            {'p', {'o', '[', 'l', ';'}},
            {'a', {'q', 'w', 's', 'z'}},
            {'s', {'q', 'w', 'e', 'a', 'd', 'x', 'z'}},
            {'d', {'w', 'e', 'r', 's', 'f', 'c', 'x'}},
            {'f', {'e', 'r', 't', 'd', 'g', 'v', 'c'}},
            {'g', {'r', 't', 'y', 'f', 'h', 'b', 'v'}},
            {'h', {'t', 'y', 'u', 'g', 'j', 'n', 'b'}},
            {'j', {'y', 'u', 'i', 'h', 'k', 'm', 'n'}},
            {'k', {'u', 'i', 'o', 'j', 'l', ',', 'm'}},
            {'l', {'i', 'o', 'p', 'k', ';', '.', ','}},
            {'z', {'a', 's', 'x'}},
            {'x', {'a', 's', 'd', 'z', 'c'}},
            {'c', {'s', 'd', 'f', 'x', 'v'}},
            {'v', {'d', 'f', 'g', 'c', 'b'}},
            {'b', {'f', 'g', 'h', 'v', 'n'}},
            {'n', {'g', 'h', 'j', 'b', 'm'}},
            {'m', {'h', 'j', 'k', 'n', ','}}
        };
    }

    char get_nearby_key(char c) const {
        c = tolower(c);
        auto it = nearby_keys.find(c);
        if (it != nearby_keys.end() && !it->second.empty()) {
            return it->second[rand() % it->second.size()];
        }
        return c;
    }
};

TypingMistakeSimulator mistake_simulator;

bool initialize_xtest(Display* display) {
    int event_base, error_base, major, minor;
    return XTestQueryExtension(display, &event_base, &error_base, &major, &minor);
}

void send_xtest_key(Display* display, KeyCode keycode, bool press, unsigned int modifiers) {
    if (modifiers != 0) {
        if (modifiers & ShiftMask) {
            KeyCode shift_keycode = XKeysymToKeycode(display, XK_Shift_L);
            if (shift_keycode != 0) {
                XTestFakeKeyEvent(display, shift_keycode, True, CurrentTime);
                XFlush(display);
            }
        }
        if (modifiers & ControlMask) {
            KeyCode ctrl_keycode = XKeysymToKeycode(display, XK_Control_L);
            if (ctrl_keycode != 0) {
                XTestFakeKeyEvent(display, ctrl_keycode, True, CurrentTime);
                XFlush(display);
            }
        }
        if (modifiers & Mod1Mask) {
            KeyCode alt_keycode = XKeysymToKeycode(display, XK_Alt_L);
            if (alt_keycode != 0) {
                XTestFakeKeyEvent(display, alt_keycode, True, CurrentTime);
                XFlush(display);
            }
        }
        if (modifiers & Mod4Mask) {
            KeyCode super_keycode = XKeysymToKeycode(display, XK_Super_L);
            if (super_keycode != 0) {
                XTestFakeKeyEvent(display, super_keycode, True, CurrentTime);
                XFlush(display);
            }
        }
        usleep(5000);
    }

    XTestFakeKeyEvent(display, keycode, press, CurrentTime);
    XFlush(display);

    if (!press && modifiers != 0) {
        usleep(5000);
        if (modifiers & ShiftMask) {
            KeyCode shift_keycode = XKeysymToKeycode(display, XK_Shift_L);
            if (shift_keycode != 0) {
                XTestFakeKeyEvent(display, shift_keycode, False, CurrentTime);
                XFlush(display);
            }
        }
        if (modifiers & ControlMask) {
            KeyCode ctrl_keycode = XKeysymToKeycode(display, XK_Control_L);
            if (ctrl_keycode != 0) {
                XTestFakeKeyEvent(display, ctrl_keycode, False, CurrentTime);
                XFlush(display);
            }
        }
        if (modifiers & Mod1Mask) {
            KeyCode alt_keycode = XKeysymToKeycode(display, XK_Alt_L);
            if (alt_keycode != 0) {
                XTestFakeKeyEvent(display, alt_keycode, False, CurrentTime);
                XFlush(display);
            }
        }
        if (modifiers & Mod4Mask) {
            KeyCode super_keycode = XKeysymToKeycode(display, XK_Super_L);
            if (super_keycode != 0) {
                XTestFakeKeyEvent(display, super_keycode, False, CurrentTime);
                XFlush(display);
            }
        }
    }
}

class SendKeyWorker : public Napi::AsyncWorker {
public:
    SendKeyWorker(Napi::Env env, Napi::Promise::Deferred deferred, std::string key, std::string modifier, std::string display_name)
        : Napi::AsyncWorker(env), deferred(deferred), key(key), modifier(modifier), display_name(display_name) {}

protected:
    void Execute() override {
        Display *display = XOpenDisplay(display_name.empty() ? NULL : display_name.c_str());
        if (!display) {
            SetError("Cannot open display: " + display_name);
            return;
        }

        if (!initialize_xtest(display)) {
            XCloseDisplay(display);
            SetError("XTest extension not available");
            return;
        }

        auto behavior_profile = SessionManager::get_current_profile();

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

        int base_delay = behavior_profile->get_base_delay();
        int delay_variation = behavior_profile->get_delay_variation();
        int press_delay = timing_generator.get_pro_gamer_delay(base_delay, delay_variation);
        int release_delay = timing_generator.get_pro_gamer_delay(base_delay - 5, delay_variation - 2);

        if (timing_generator.should_add_micro_delay()) {
            usleep(timing_generator.get_micro_delay() * 1000);
        }

        send_xtest_key(display, keycode, true, modifiers_state);
        XFlush(display);
        usleep(press_delay * 1000);

        send_xtest_key(display, keycode, false, modifiers_state);
        XFlush(display);
        usleep(release_delay * 1000);

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
    std::string key;
    std::string modifier;
    std::string display_name;
};

class TypeStringWorker : public Napi::AsyncWorker {
public:
    TypeStringWorker(Napi::Env env, Napi::Promise::Deferred deferred,
                     std::string str, bool start_and_end_with_enter,
                     std::string display_name)
        : Napi::AsyncWorker(env), deferred_(deferred), str_(str),
          start_and_end_with_enter_(start_and_end_with_enter), display_name_(display_name) {}

protected:
    void Execute() override {
        Display *display = XOpenDisplay(display_name_.empty() ? NULL : display_name_.c_str());
        if (!display) {
            SetError("Cannot open display: " + display_name_);
            return;
        }

        if (!initialize_xtest(display)) {
            XCloseDisplay(display);
            SetError("XTest extension not available");
            return;
        }

        auto behavior_profile = SessionManager::get_current_profile();

        auto send_enter_key = [&](Display* d) {
            KeySym ks = XK_Return;
            KeyCode kc = XKeysymToKeycode(d, ks);
            if (kc != 0) {
                send_xtest_key(d, kc, true, 0);
                XFlush(d);
                usleep(timing_generator.get_pro_gamer_delay(25, 10) * 1000);
                send_xtest_key(d, kc, false, 0);
                XFlush(d);
                usleep(50 * 1000);
            }
        };

        if (start_and_end_with_enter_) {
            send_enter_key(display);
            usleep(timing_generator.get_pro_gamer_delay(40, 15) * 1000);
        }

        for (size_t i = 0; i < str_.length(); i++) {
            char c = str_[i];

            if (timing_generator.should_add_micro_delay()) {
                usleep(timing_generator.get_micro_delay() * 1000);
            }

            KeySym keysym = NoSymbol;
            unsigned int required_modifier = 0;

            if (c == ' ') {
                keysym = XK_space;
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
                switch (c) {
                    case '!': keysym = XK_1; required_modifier = ShiftMask; break;
                    case '@': keysym = XK_2; required_modifier = ShiftMask; break;
                    case '#': keysym = XK_3; required_modifier = ShiftMask; break;
                    case '$': keysym = XK_4; required_modifier = ShiftMask; break;
                    case '%': keysym = XK_5; required_modifier = ShiftMask; break;
                    case '^': keysym = XK_6; required_modifier = ShiftMask; break;
                    case '&': keysym = XK_7; required_modifier = ShiftMask; break;
                    case '*': keysym = XK_8; required_modifier = ShiftMask; break;
                    case '(': keysym = XK_9; required_modifier = ShiftMask; break;
                    case ')': keysym = XK_0; required_modifier = ShiftMask; break;
                    case '-': keysym = XK_minus; break;
                    case '_': keysym = XK_minus; required_modifier = ShiftMask; break;
                    case '=': keysym = XK_equal; break;
                    case '+': keysym = XK_equal; required_modifier = ShiftMask; break;
                    case '[': keysym = XK_bracketleft; break;
                    case ']': keysym = XK_bracketright; break;
                    case '{': keysym = XK_bracketleft; required_modifier = ShiftMask; break;
                    case '}': keysym = XK_bracketright; required_modifier = ShiftMask; break;
                    case ';': keysym = XK_semicolon; break;
                    case ':': keysym = XK_semicolon; required_modifier = ShiftMask; break;
                    case '\'': keysym = XK_apostrophe; break;
                    case '"': keysym = XK_apostrophe; required_modifier = ShiftMask; break;
                    case ',': keysym = XK_comma; break;
                    case '<': keysym = XK_comma; required_modifier = ShiftMask; break;
                    case '.': keysym = XK_period; break;
                    case '>': keysym = XK_period; required_modifier = ShiftMask; break;
                    case '/': keysym = XK_slash; break;
                    case '?': keysym = XK_slash; required_modifier = ShiftMask; break;
                    case '\\': keysym = XK_backslash; break;
                    case '|': keysym = XK_backslash; required_modifier = ShiftMask; break;
                    case '`': keysym = XK_grave; break;
                    case '~': keysym = XK_grave; required_modifier = ShiftMask; break;
                    default:
                        keysym = XStringToKeysym(std::string(1, c).c_str());
                        if (keysym == NoSymbol) {
                            keysym = XStringToKeysym(std::string(1, tolower(c)).c_str());
                            if (isupper(c)) {
                                required_modifier = ShiftMask;
                            }
                        }
                        break;
                }
            }

            if (keysym == NoSymbol) continue;

            KeyCode keycode = XKeysymToKeycode(display, keysym);
            if (keycode == 0) continue;

            int press_delay = timing_generator.get_pro_gamer_delay(15, 8);
            int release_delay = timing_generator.get_pro_gamer_delay(12, 5);

            send_xtest_key(display, keycode, true, required_modifier);
            XFlush(display);
            usleep(press_delay * 1000);

            send_xtest_key(display, keycode, false, required_modifier);
            XFlush(display);
            usleep(release_delay * 1000);
        }

        if (start_and_end_with_enter_) {
            usleep(timing_generator.get_pro_gamer_delay(50, 20) * 1000);
            send_enter_key(display);
        }

        XSync(display, False);
        usleep(100 * 1000);
        XCloseDisplay(display);
    }

    void OnOK() override {
        deferred_.Resolve(Napi::Boolean::New(Env(), true));
    }

    void OnError(const Napi::Error& e) override {
        deferred_.Reject(Napi::Error::New(Env(), e.Message()).Value());
    }

private:
    Napi::Promise::Deferred deferred_;
    std::string str_;
    bool start_and_end_with_enter_;
    std::string display_name_;
};

class TypeStringArrayWorker : public Napi::AsyncWorker {
public:
    TypeStringArrayWorker(Napi::Env env, Napi::Promise::Deferred deferred,
                         std::vector<std::string> strings, bool start_and_end_with_enter,
                         std::string display_name)
        : Napi::AsyncWorker(env), deferred_(deferred), strings_(strings),
          start_and_end_with_enter_(start_and_end_with_enter), display_name_(display_name) {}

protected:
    void Execute() override {
        Display *display = XOpenDisplay(display_name_.empty() ? NULL : display_name_.c_str());
        if (!display) {
            SetError("Cannot open display: " + display_name_);
            return;
        }

        if (!initialize_xtest(display)) {
            XCloseDisplay(display);
            SetError("XTest extension not available");
            return;
        }

        // REMOVED: Unused variables to fix compiler warning
        // auto behavior_profile = SessionManager::get_current_profile();
        // int base_delay = behavior_profile->get_base_delay();
        // int delay_variation = behavior_profile->get_delay_variation();

        auto send_enter_key = [&](Display* d) {
            KeySym ks = XK_Return;
            KeyCode kc = XKeysymToKeycode(d, ks);
            if (kc != 0) {
                send_xtest_key(d, kc, true, 0);
                XFlush(d);
                usleep(timing_generator.get_pro_gamer_delay(25, 10) * 1000);
                send_xtest_key(d, kc, false, 0);
                XFlush(d);
                usleep(50 * 1000);
            }
        };

        for (size_t str_idx = 0; str_idx < strings_.size(); str_idx++) {
            const std::string& str = strings_[str_idx];

            if (start_and_end_with_enter_) {
                send_enter_key(display);
                usleep(timing_generator.get_pro_gamer_delay(40, 15) * 1000);
            }

            for (size_t i = 0; i < str.length(); i++) {
                char c = str[i];

                if (timing_generator.should_add_micro_delay()) {
                    usleep(timing_generator.get_micro_delay() * 1000);
                }

                KeySym keysym = NoSymbol;
                unsigned int required_modifier = 0;

                if (c == ' ') {
                    keysym = XK_space;
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
                    switch (c) {
                        case '!': keysym = XK_1; required_modifier = ShiftMask; break;
                        case '@': keysym = XK_2; required_modifier = ShiftMask; break;
                        case '#': keysym = XK_3; required_modifier = ShiftMask; break;
                        case '$': keysym = XK_4; required_modifier = ShiftMask; break;
                        case '%': keysym = XK_5; required_modifier = ShiftMask; break;
                        case '^': keysym = XK_6; required_modifier = ShiftMask; break;
                        case '&': keysym = XK_7; required_modifier = ShiftMask; break;
                        case '*': keysym = XK_8; required_modifier = ShiftMask; break;
                        case '(': keysym = XK_9; required_modifier = ShiftMask; break;
                        case ')': keysym = XK_0; required_modifier = ShiftMask; break;
                        case '-': keysym = XK_minus; break;
                        case '_': keysym = XK_minus; required_modifier = ShiftMask; break;
                        case '=': keysym = XK_equal; break;
                        case '+': keysym = XK_equal; required_modifier = ShiftMask; break;
                        case '[': keysym = XK_bracketleft; break;
                        case ']': keysym = XK_bracketright; break;
                        case '{': keysym = XK_bracketleft; required_modifier = ShiftMask; break;
                        case '}': keysym = XK_bracketright; required_modifier = ShiftMask; break;
                        case ';': keysym = XK_semicolon; break;
                        case ':': keysym = XK_semicolon; required_modifier = ShiftMask; break;
                        case '\'': keysym = XK_apostrophe; break;
                        case '"': keysym = XK_apostrophe; required_modifier = ShiftMask; break;
                        case ',': keysym = XK_comma; break;
                        case '<': keysym = XK_comma; required_modifier = ShiftMask; break;
                        case '.': keysym = XK_period; break;
                        case '>': keysym = XK_period; required_modifier = ShiftMask; break;
                        case '/': keysym = XK_slash; break;
                        case '?': keysym = XK_slash; required_modifier = ShiftMask; break;
                        case '\\': keysym = XK_backslash; break;
                        case '|': keysym = XK_backslash; required_modifier = ShiftMask; break;
                        case '`': keysym = XK_grave; break;
                        case '~': keysym = XK_grave; required_modifier = ShiftMask; break;
                        default:
                            keysym = XStringToKeysym(std::string(1, c).c_str());
                            if (keysym == NoSymbol) {
                                keysym = XStringToKeysym(std::string(1, tolower(c)).c_str());
                                if (isupper(c)) {
                                    required_modifier = ShiftMask;
                                }
                            }
                            break;
                    }
                }

                if (keysym == NoSymbol) continue;

                KeyCode keycode = XKeysymToKeycode(display, keysym);
                if (keycode == 0) continue;

                int press_delay = timing_generator.get_pro_gamer_delay(15, 8);
                int release_delay = timing_generator.get_pro_gamer_delay(12, 5);

                send_xtest_key(display, keycode, true, required_modifier);
                XFlush(display);
                usleep(press_delay * 1000);

                send_xtest_key(display, keycode, false, required_modifier);
                XFlush(display);
                usleep(release_delay * 1000);
            }

            if (start_and_end_with_enter_) {
                usleep(timing_generator.get_pro_gamer_delay(50, 20) * 1000);
                send_enter_key(display);
            }

            if (str_idx < strings_.size() - 1) {
                usleep(timing_generator.get_pro_gamer_delay(200, 50) * 1000);
            }
        }

        XSync(display, False);
        usleep(100 * 1000);
        XCloseDisplay(display);
    }

    void OnOK() override {
        deferred_.Resolve(Napi::Boolean::New(Env(), true));
    }

    void OnError(const Napi::Error& e) override {
        deferred_.Reject(Napi::Error::New(Env(), e.Message()).Value());
    }

private:
    Napi::Promise::Deferred deferred_;
    std::vector<std::string> strings_;
    bool start_and_end_with_enter_;
    std::string display_name_;
};

class RotateWorker : public Napi::AsyncWorker {
public:
    RotateWorker(Napi::Env env, Napi::Promise::Deferred deferred, char direction, std::string display_name)
        : Napi::AsyncWorker(env), deferred(deferred), direction(direction), display_name(display_name) {}

protected:
    void Execute() override {
        Display *display = XOpenDisplay(display_name.empty() ? NULL : display_name.c_str());
        if (!display) {
            SetError("Cannot open display: " + display_name);
            return;
        }

        if (!initialize_xtest(display)) {
            XCloseDisplay(display);
            SetError("XTest extension not available");
            return;
        }

        auto behavior_profile = SessionManager::get_current_profile();

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

        send_xtest_key(display, ctrl_keycode, true, 0);
        XFlush(display);
        usleep(timing_generator.get_pro_gamer_delay(10, 5) * 1000);

        for (size_t i = 0; i < key_sequence.size(); i++) {
            KeySym keysym = key_sequence[i];
            KeyCode keycode = XKeysymToKeycode(display, keysym);
            if (keycode == 0) continue;

            int press_delay, release_delay;

            if (i == 0) {
                press_delay = timing_generator.get_pro_gamer_delay(25, 12);
                release_delay = timing_generator.get_pro_gamer_delay(20, 10);
            } else if (i == key_sequence.size() - 1) {
                press_delay = timing_generator.get_pro_gamer_delay(20, 10);
                release_delay = timing_generator.get_pro_gamer_delay(15, 8);
            } else {
                press_delay = timing_generator.get_pro_gamer_delay(22, 11);
                release_delay = timing_generator.get_pro_gamer_delay(18, 9);
            }

            if (timing_generator.should_add_micro_delay()) {
                usleep(timing_generator.get_micro_delay() * 1000);
            }

            send_xtest_key(display, keycode, true, ControlMask);
            XFlush(display);
            usleep(press_delay * 1000);

            send_xtest_key(display, keycode, false, ControlMask);
            XFlush(display);
            usleep(release_delay * 1000);
        }

        usleep(timing_generator.get_pro_gamer_delay(15, 8) * 1000);
        send_xtest_key(display, ctrl_keycode, false, 0);
        XFlush(display);

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
    char direction;
    std::string display_name;
};

class KeyDownWorker : public Napi::AsyncWorker {
public:
    KeyDownWorker(Napi::Env env, Napi::Promise::Deferred deferred, std::string key, std::string modifier, std::string display_name)
        : Napi::AsyncWorker(env), deferred(deferred), key(key), modifier(modifier), display_name(display_name) {}

protected:
    void Execute() override {
        Display *display = XOpenDisplay(display_name.empty() ? NULL : display_name.c_str());
        if (!display) {
            SetError("Cannot open display: " + display_name);
            return;
        }

        if (!initialize_xtest(display)) {
            XCloseDisplay(display);
            SetError("XTest extension not available");
            return;
        }

        auto behavior_profile = SessionManager::get_current_profile();

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

        if (timing_generator.should_add_micro_delay()) {
            usleep(timing_generator.get_micro_delay() * 1000);
        }

        send_xtest_key(display, keycode, true, modifiers_state);
        XFlush(display);

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
    std::string key;
    std::string modifier;
    std::string display_name;
};

class KeyUpWorker : public Napi::AsyncWorker {
public:
    KeyUpWorker(Napi::Env env, Napi::Promise::Deferred deferred, std::string key, std::string modifier, std::string display_name)
        : Napi::AsyncWorker(env), deferred(deferred), key(key), modifier(modifier), display_name(display_name) {}

protected:
    void Execute() override {
        Display *display = XOpenDisplay(display_name.empty() ? NULL : display_name.c_str());
        if (!display) {
            SetError("Cannot open display: " + display_name);
            return;
        }

        if (!initialize_xtest(display)) {
            XCloseDisplay(display);
            SetError("XTest extension not available");
            return;
        }

        auto behavior_profile = SessionManager::get_current_profile();

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

        if (timing_generator.should_add_micro_delay()) {
            usleep(timing_generator.get_micro_delay() * 1000);
        }

        send_xtest_key(display, keycode, false, modifiers_state);
        XFlush(display);

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
    std::string key;
    std::string modifier;
    std::string display_name;
};

Napi::Value SendKeyAsync(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    auto deferred = Napi::Promise::Deferred::New(env);
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
        deferred.Reject(Napi::TypeError::New(env, "sendKey(key, display, [modifier]) requires key and display.").Value());
        return deferred.Promise();
    }
    std::string key = info[0].As<Napi::String>().Utf8Value();
    std::string display_name = info[1].As<Napi::String>().Utf8Value();
    std::string modifier = "";
    if (info.Length() > 2 && info[2].IsString()) {
        modifier = info[2].As<Napi::String>().Utf8Value();
    }
    SendKeyWorker* worker = new SendKeyWorker(env, deferred, key, modifier, display_name);
    worker->Queue();
    return deferred.Promise();
}

Napi::Value TypeStringAsync(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    auto deferred = Napi::Promise::Deferred::New(env);
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
        deferred.Reject(Napi::TypeError::New(env, "type(text, display, [startAndEndWithEnter]) requires text and display.").Value());
        return deferred.Promise();
    }
    std::string str = info[0].As<Napi::String>().Utf8Value();
    std::string display_name = info[1].As<Napi::String>().Utf8Value();
    bool start_and_end_with_enter = false;
    if (info.Length() > 2 && info[2].IsBoolean()) {
        start_and_end_with_enter = info[2].As<Napi::Boolean>().Value();
    }
    TypeStringWorker* worker = new TypeStringWorker(env, deferred, str, start_and_end_with_enter, display_name);
    worker->Queue();
    return deferred.Promise();
}

Napi::Value TypeStringArrayAsync(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    auto deferred = Napi::Promise::Deferred::New(env);

    if (info.Length() < 2) {
        deferred.Reject(Napi::TypeError::New(env, "typeArray(strings, display, [startAndEndWithEnter]) requires strings array and display.").Value());
        return deferred.Promise();
    }

    std::vector<std::string> strings;

    if (info[0].IsArray()) {
        Napi::Array arr = info[0].As<Napi::Array>();
        uint32_t len = arr.Length();
        for (uint32_t i = 0; i < len; i++) {
            Napi::Value val = arr[i];
            if (val.IsString()) {
                strings.push_back(val.As<Napi::String>().Utf8Value());
            }
        }
    } else if (info[0].IsString()) {
        strings.push_back(info[0].As<Napi::String>().Utf8Value());
    } else {
        deferred.Reject(Napi::TypeError::New(env, "First argument must be string or array of strings").Value());
        return deferred.Promise();
    }

    std::string display_name = info[1].As<Napi::String>().Utf8Value();
    bool start_and_end_with_enter = true;
    if (info.Length() > 2 && info[2].IsBoolean()) {
        start_and_end_with_enter = info[2].As<Napi::Boolean>().Value();
    }

    TypeStringArrayWorker* worker = new TypeStringArrayWorker(env, deferred, strings, start_and_end_with_enter, display_name);
    worker->Queue();
    return deferred.Promise();
}
Napi::Value RotateAsync(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    auto deferred = Napi::Promise::Deferred::New(env);
    if (info.Length() < 1 || !info[0].IsString()) {
        deferred.Reject(Napi::TypeError::New(env, "rotate(display, [direction]) requires display.").Value());
        return deferred.Promise();
    }
    std::string display_name = info[0].As<Napi::String>().Utf8Value();
    char direction_char = '\0';
    if (info.Length() > 1 && info[1].IsString()) {
        std::string direction_str = info[1].As<Napi::String>().Utf8Value();
        if (direction_str.length() == 1) {
            char c = tolower(direction_str[0]);
            if (directionKeys.count(c)) {
                direction_char = c;
            }
        }
    }
    RotateWorker* worker = new RotateWorker(env, deferred, direction_char, display_name);
    worker->Queue();
    return deferred.Promise();
}

Napi::Value KeyDownAsync(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    auto deferred = Napi::Promise::Deferred::New(env);
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
        deferred.Reject(Napi::TypeError::New(env, "keyDown(key, display, [modifier]) requires key and display.").Value());
        return deferred.Promise();
    }
    std::string key = info[0].As<Napi::String>().Utf8Value();
    std::string display_name = info[1].As<Napi::String>().Utf8Value();
    std::string modifier = "";
    if (info.Length() > 2 && info[2].IsString()) {
        modifier = info[2].As<Napi::String>().Utf8Value();
    }
    KeyDownWorker* worker = new KeyDownWorker(env, deferred, key, modifier, display_name);
    worker->Queue();
    return deferred.Promise();
}

Napi::Value KeyUpAsync(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    auto deferred = Napi::Promise::Deferred::New(env);
    if (info.Length() < 2 || !info[0].IsString() || !info[1].IsString()) {
        deferred.Reject(Napi::TypeError::New(env, "keyUp(key, display, [modifier]) requires key and display.").Value());
        return deferred.Promise();
    }
    std::string key = info[0].As<Napi::String>().Utf8Value();
    std::string display_name = info[1].As<Napi::String>().Utf8Value();
    std::string modifier = "";
    if (info.Length() > 2 && info[2].IsString()) {
        modifier = info[2].As<Napi::String>().Utf8Value();
    }
    KeyUpWorker* worker = new KeyUpWorker(env, deferred, key, modifier, display_name);
    worker->Queue();
    return deferred.Promise();
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    if (!XInitThreads()) {
      std::cerr << "keypress-native: Warning - XInitThreads() failed." << std::endl;
    }

    std::random_device rd;
    std::seed_seq seq{rd(), rd(), rd(), rd(), rd(), rd(), rd(), rd()};
    timing_generator = HumanTimingGenerator();

    SessionManager::new_session();

    srand(time(NULL));

    exports.Set("sendKey", Napi::Function::New(env, SendKeyAsync));
    exports.Set("rotate", Napi::Function::New(env, RotateAsync));
    exports.Set("type", Napi::Function::New(env, TypeStringAsync));
    exports.Set("typeArray", Napi::Function::New(env, TypeStringArrayAsync));
    exports.Set("keyDown", Napi::Function::New(env, KeyDownAsync));
    exports.Set("keyUp", Napi::Function::New(env, KeyUpAsync));

    return exports;
}

NODE_API_MODULE(keypress, Init)