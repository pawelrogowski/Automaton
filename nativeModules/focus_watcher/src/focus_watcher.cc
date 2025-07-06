#include <napi.h>
#include <X11/Xlib.h>
#include <X11/Xatom.h>
#include <unistd.h>
#include <thread>
#include <atomic>
#include <mutex>
#include <iostream>

// --- Global State ---
std::thread g_watcher_thread;
std::atomic<bool> g_is_watcher_running(false);
std::atomic<Window> g_target_window_id(0);
std::mutex g_thread_management_mutex;

// The aggressive "force focus" logic from your original keypress addon
void force_actual_focus(Display* display, Window target_window) {
    // 1. The Polite Request to activate the window
    Atom net_active_window = XInternAtom(display, "_NET_ACTIVE_WINDOW", False);
    XEvent event;
    memset(&event, 0, sizeof(event));

    event.xclient.type = ClientMessage;
    event.xclient.window = target_window;
    event.xclient.message_type = net_active_window;
    event.xclient.format = 32;
    event.xclient.data.l[0] = 1; // 1 for "normal" applications
    event.xclient.data.l[1] = CurrentTime;
    event.xclient.data.l[2] = 0; // The currently active window (if known)

    XSendEvent(display, XDefaultRootWindow(display), False, SubstructureRedirectMask | SubstructureNotifyMask, &event);

    // 2. The Forceful Command to set the input focus
    XSetInputFocus(display, target_window, RevertToParent, CurrentTime);

    // We must flush the request to the server
    XFlush(display);
}

// The background thread's main loop
void force_focus_loop() {
    Display* display = XOpenDisplay(NULL);
    if (!display) {
        std::cerr << "FocusWatcher [Thread]: Cannot open display. Thread exiting." << std::endl;
        g_is_watcher_running = false;
        return;
    }

    Atom net_wm_state = XInternAtom(display, "_NET_WM_STATE", False);
    Atom net_wm_state_focused = XInternAtom(display, "_NET_WM_STATE_FOCUSED", False);

    std::cout << "FocusWatcher [Thread]: Aggressive focus watcher thread started." << std::endl;

    while (g_is_watcher_running) {
        Window current_target = g_target_window_id.load();
        if (current_target == 0) {
            usleep(100000); // No target, sleep longer
            continue;
        }

        // Check if the property is already set. If not, we fight back.
        bool is_focused_prop_present = false;
        Atom* prop_data = NULL;
        Atom actual_type;
        int actual_format;
        unsigned long nitems, bytes_after;

        int status = XGetWindowProperty(display, current_target, net_wm_state, 0, 1024, False, XA_ATOM,
                                        &actual_type, &actual_format, &nitems, &bytes_after, (unsigned char**)&prop_data);

        if (status == Success && prop_data) {
            for (unsigned long i = 0; i < nitems; i++) {
                if (prop_data[i] == net_wm_state_focused) {
                    is_focused_prop_present = true;
                    break;
                }
            }
            XFree(prop_data);
        }

        // If the compositor has removed our focus, we take it back forcefully.
        if (!is_focused_prop_present) {
            // std::cout << "FocusWatcher [Thread]: Focus lost. Re-asserting control..." << std::endl;
            force_actual_focus(display, current_target);
        }

        usleep(100000); // Check every 100ms. Adjust if needed.
    }

    XCloseDisplay(display);
    std::cout << "FocusWatcher [Thread]: Watcher thread stopped." << std::endl;
}

// --- N-API Bindings (no changes needed here) ---

Napi::Value UpdateWatcher(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    std::lock_guard<std::mutex> lock(g_thread_management_mutex);
    if (info.Length() < 1 || !info[0].IsNumber()) {
        Napi::TypeError::New(env, "Window ID (Number) is required.").ThrowAsJavaScriptException();
        return env.Null();
    }
    uint64_t new_window_id = info[0].As<Napi::Number>().Int64Value();
    g_target_window_id.store((Window)new_window_id);
    if (new_window_id != 0 && !g_is_watcher_running) {
        g_is_watcher_running = true;
        std::thread(force_focus_loop).detach();
    } else if (new_window_id == 0 && g_is_watcher_running) {
        g_is_watcher_running = false;
    }
    return env.Undefined();
}

void StopWatcher(const Napi::CallbackInfo& info) {
    std::lock_guard<std::mutex> lock(g_thread_management_mutex);
    if (g_is_watcher_running) {
        g_target_window_id.store(0);
        g_is_watcher_running = false;
    }
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    if (!XInitThreads()) {
        std::cerr << "FATAL: XInitThreads() failed." << std::endl;
    }
    exports.Set("update", Napi::Function::New(env, UpdateWatcher));
    exports.Set("stop", Napi::Function::New(env, StopWatcher));
    return exports;
}

NODE_API_MODULE(focus_watcher, Init);