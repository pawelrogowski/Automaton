#include <napi.h>
#include <X11/Xlib.h>
#include <string>
#include <memory>
#include <stdexcept>
#include <algorithm>
#include <unistd.h>

// RAII wrapper for the X11 Display connection
struct DisplayDeleter {
    void operator()(Display* disp) {
        if (disp) XCloseDisplay(disp);
    }
};
using DisplayPtr = std::unique_ptr<Display, DisplayDeleter>;

/**
 * @brief The core logic for sending a synthetic mouse click.
 */
void DoSyntheticClick(const Napi::CallbackInfo& info, unsigned int button, const std::string& display_name) {
    Napi::Env env = info.Env();

    // --- Argument Validation ---
    if (info.Length() < 4 || !info[0].IsNumber() || !info[1].IsNumber() || !info[2].IsNumber() || !info[3].IsString()) {
        Napi::TypeError::New(env, "Requires at least 4 arguments: (windowId, x, y, display)").ThrowAsJavaScriptException();
        return;
    }

    // --- Connect to X Server ---
    DisplayPtr display(XOpenDisplay(display_name.empty() ? nullptr : display_name.c_str()));
    if (!display) {
        Napi::Error::New(env, "Failed to connect to X server on display: " + display_name).ThrowAsJavaScriptException();
        return;
    }

    // --- Parse Required Arguments ---
    const Window target_window = info[0].As<Napi::Number>().Int64Value();
    const int x = info[1].As<Napi::Number>().Int32Value();
    const int y = info[2].As<Napi::Number>().Int32Value();

    // --- Parse Optional Modifier Keys ---
    unsigned int modifier_mask = 0;
    for (size_t i = 3; i < info.Length(); ++i) {
        if (info[i].IsString()) {
            std::string mod = info[i].As<Napi::String>().Utf8Value();
            std::transform(mod.begin(), mod.end(), mod.begin(), ::tolower);
            if (mod == "ctrl")       modifier_mask |= ControlMask;
            else if (mod == "shift") modifier_mask |= ShiftMask;
            else if (mod == "alt")   modifier_mask |= Mod1Mask;
        }
    }

    // --- Get window position relative to root ---
    Window root = XDefaultRootWindow(display.get());
    int win_x, win_y;
    Window child;
    if (!XTranslateCoordinates(display.get(), target_window, root, 0, 0, &win_x, &win_y, &child)) {
        Napi::Error::New(env, "Failed to get window coordinates").ThrowAsJavaScriptException();
        return;
    }

    // --- Create the Synthetic Event ---
    XEvent event;
    memset(&event, 0, sizeof(event));

    event.xbutton.display     = display.get();
    event.xbutton.window      = target_window;
    event.xbutton.root        = root;
    event.xbutton.subwindow   = None;
    event.xbutton.time        = CurrentTime;
    event.xbutton.x           = x;
    event.xbutton.y           = y;
    event.xbutton.x_root      = win_x + x;
    event.xbutton.y_root      = win_y + y;
    event.xbutton.same_screen = True;
    event.xbutton.button      = button;
    event.xbutton.state       = modifier_mask;

    // --- Send ButtonPress ---
    event.type = ButtonPress;
    XSendEvent(display.get(), target_window, True, ButtonPressMask, &event);
    XFlush(display.get());
    usleep(30000);

    // --- Send ButtonRelease ---
    event.type = ButtonRelease;
    event.xbutton.state = modifier_mask;
    XSendEvent(display.get(), target_window, True, ButtonReleaseMask, &event);
    XFlush(display.get());

    // NOTE:
    // We intentionally do NOT warp the pointer back to a fixed position anymore.
    // The caller (e.g. inputOrchestrator / higher-level workers) is responsible
    // for deciding any post-click mouse positioning behavior based on regions
    // such as gameWorld.
}

/**
 * @brief The core logic for sending a synthetic mouse button press or release.
 */
void DoSyntheticMouseEvent(const Napi::CallbackInfo& info, unsigned int button, bool is_press, const std::string& display_name) {
    Napi::Env env = info.Env();

    // --- Argument Validation ---
    if (info.Length() < 4 || !info[0].IsNumber() || !info[1].IsNumber() || !info[2].IsNumber() || !info[3].IsString()) {
        Napi::TypeError::New(env, "Requires at least 4 arguments: (windowId, x, y, display)").ThrowAsJavaScriptException();
        return;
    }

    // --- Connect to X Server ---
    DisplayPtr display(XOpenDisplay(display_name.empty() ? nullptr : display_name.c_str()));
    if (!display) {
        Napi::Error::New(env, "Failed to connect to X server on display: " + display_name).ThrowAsJavaScriptException();
        return;
    }

    // --- Parse Required Arguments ---
    const Window target_window = info[0].As<Napi::Number>().Int64Value();
    const int x = info[1].As<Napi::Number>().Int32Value();
    const int y = info[2].As<Napi::Number>().Int32Value();

    // --- Get window position relative to root ---
    Window root = XDefaultRootWindow(display.get());
    int win_x, win_y;
    Window child;
    if (!XTranslateCoordinates(display.get(), target_window, root, 0, 0, &win_x, &win_y, &child)) {
        Napi::Error::New(env, "Failed to get window coordinates").ThrowAsJavaScriptException();
        return;
    }

    // --- Create the Synthetic Event ---
    XEvent event;
    memset(&event, 0, sizeof(event));

    event.xbutton.display     = display.get();
    event.xbutton.window      = target_window;
    event.xbutton.root        = root;
    event.xbutton.subwindow   = None;
    event.xbutton.time        = CurrentTime;
    event.xbutton.x           = x;
    event.xbutton.y           = y;
    event.xbutton.x_root      = win_x + x;
    event.xbutton.y_root      = win_y + y;
    event.xbutton.same_screen = True;
    event.xbutton.button      = button;
    event.xbutton.state       = 0;

    // --- Send ButtonPress or ButtonRelease ---
    event.type = is_press ? ButtonPress : ButtonRelease;
    XSendEvent(display.get(), target_window, True, is_press ? ButtonPressMask : ButtonReleaseMask, &event);
    XFlush(display.get());
}

/**
 * @brief The core logic for moving the mouse cursor.
 */
void DoSyntheticMouseMove(const Napi::CallbackInfo& info, const std::string& display_name) {
    Napi::Env env = info.Env();

    // --- Argument Validation ---
    if (info.Length() < 4 || !info[0].IsNumber() || !info[1].IsNumber() || !info[2].IsNumber() || !info[3].IsString()) {
        Napi::TypeError::New(env, "Requires at least 4 arguments: (windowId, x, y, display)").ThrowAsJavaScriptException();
        return;
    }

    // --- Connect to X Server ---
    DisplayPtr display(XOpenDisplay(display_name.empty() ? nullptr : display_name.c_str()));
    if (!display) {
        Napi::Error::New(env, "Failed to connect to X server on display: " + display_name).ThrowAsJavaScriptException();
        return;
    }

    // --- Parse Required Arguments ---
    const Window target_window = info[0].As<Napi::Number>().Int64Value();
    const int x = info[1].As<Napi::Number>().Int32Value();
    const int y = info[2].As<Napi::Number>().Int32Value();

    // --- Get window position relative to root ---
    Window root = XDefaultRootWindow(display.get());
    int win_x, win_y;
    Window child;
    if (!XTranslateCoordinates(display.get(), target_window, root, 0, 0, &win_x, &win_y, &child)) {
        Napi::Error::New(env, "Failed to get window coordinates").ThrowAsJavaScriptException();
        return;
    }

    // --- Create the Synthetic Motion Event ---
    XEvent event;
    memset(&event, 0, sizeof(event));

    event.xmotion.display     = display.get();
    event.xmotion.window      = target_window;
    event.xmotion.root        = root;
    event.xmotion.subwindow   = None;
    event.xmotion.time        = CurrentTime;
    event.xmotion.x           = x;
    event.xmotion.y           = y;
    event.xmotion.x_root      = win_x + x;
    event.xmotion.y_root      = win_y + y;
    event.xmotion.same_screen = True;
    event.xmotion.state       = 0;
    event.xmotion.is_hint     = NotifyNormal;

    // --- Send Motion Event ---
    event.type = MotionNotify;
    XSendEvent(display.get(), target_window, True, PointerMotionMask, &event);
    XFlush(display.get());
}

// --- N-API Exported Functions ---
Napi::Value LeftClick(const Napi::CallbackInfo& info) {
    if (info.Length() < 4 || !info[3].IsString()) {
        Napi::TypeError::New(info.Env(), "LeftClick requires display name as 4th argument").ThrowAsJavaScriptException();
        return info.Env().Null();
    }
    DoSyntheticClick(info, 1, info[3].As<Napi::String>().Utf8Value());
    return info.Env().Null();
}

Napi::Value RightClick(const Napi::CallbackInfo& info) {
    if (info.Length() < 4 || !info[3].IsString()) {
        Napi::TypeError::New(info.Env(), "RightClick requires display name as 4th argument").ThrowAsJavaScriptException();
        return info.Env().Null();
    }
    DoSyntheticClick(info, 3, info[3].As<Napi::String>().Utf8Value());
    return info.Env().Null();
}

Napi::Value MouseDown(const Napi::CallbackInfo& info) {
    if (info.Length() < 4 || !info[3].IsString()) {
        Napi::TypeError::New(info.Env(), "MouseDown requires display name as 4th argument").ThrowAsJavaScriptException();
        return info.Env().Null();
    }
    DoSyntheticMouseEvent(info, 1, true, info[3].As<Napi::String>().Utf8Value());
    return info.Env().Null();
}

Napi::Value MouseUp(const Napi::CallbackInfo& info) {
    if (info.Length() < 4 || !info[3].IsString()) {
        Napi::TypeError::New(info.Env(), "MouseUp requires display name as 4th argument").ThrowAsJavaScriptException();
        return info.Env().Null();
    }
    DoSyntheticMouseEvent(info, 1, false, info[3].As<Napi::String>().Utf8Value());
    return info.Env().Null();
}

Napi::Value RightMouseDown(const Napi::CallbackInfo& info) {
    if (info.Length() < 4 || !info[3].IsString()) {
        Napi::TypeError::New(info.Env(), "RightMouseDown requires display name as 4th argument").ThrowAsJavaScriptException();
        return info.Env().Null();
    }
    DoSyntheticMouseEvent(info, 3, true, info[3].As<Napi::String>().Utf8Value());
    return info.Env().Null();
}

Napi::Value RightMouseUp(const Napi::CallbackInfo& info) {
    if (info.Length() < 4 || !info[3].IsString()) {
        Napi::TypeError::New(info.Env(), "RightMouseUp requires display name as 4th argument").ThrowAsJavaScriptException();
        return info.Env().Null();
    }
    DoSyntheticMouseEvent(info, 3, false, info[3].As<Napi::String>().Utf8Value());
    return info.Env().Null();
}

Napi::Value MouseMove(const Napi::CallbackInfo& info) {
    if (info.Length() < 4 || !info[3].IsString()) {
        Napi::TypeError::New(info.Env(), "MouseMove requires display name as 4th argument").ThrowAsJavaScriptException();
        return info.Env().Null();
    }
    DoSyntheticMouseMove(info, info[3].As<Napi::String>().Utf8Value());
    return info.Env().Null();
}

// --- Module Initialization ---
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("leftClick", Napi::Function::New(env, LeftClick));
    exports.Set("rightClick", Napi::Function::New(env, RightClick));
    exports.Set("mouseDown", Napi::Function::New(env, MouseDown));
    exports.Set("mouseUp", Napi::Function::New(env, MouseUp));
    exports.Set("rightMouseDown", Napi::Function::New(env, RightMouseDown));
    exports.Set("rightMouseUp", Napi::Function::New(env, RightMouseUp));
    exports.Set("mouseMove", Napi::Function::New(env, MouseMove));
    return exports;
}

NODE_API_MODULE(mouse_controller, Init)