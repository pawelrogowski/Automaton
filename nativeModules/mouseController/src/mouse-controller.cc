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
void DoSyntheticClick(const Napi::CallbackInfo& info, unsigned int button) {
    Napi::Env env = info.Env();

    // --- Argument Validation ---
    if (info.Length() < 3 || !info[0].IsNumber() || !info[1].IsNumber() || !info[2].IsNumber()) {
        Napi::TypeError::New(env, "Requires at least 3 arguments: (windowId, x, y)").ThrowAsJavaScriptException();
        return;
    }

    // --- Connect to X Server ---
    DisplayPtr display(XOpenDisplay(nullptr));
    if (!display) {
        Napi::Error::New(env, "Failed to connect to X server").ThrowAsJavaScriptException();
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

    // --- Create the Synthetic Event ---
    XEvent event;
    memset(&event, 0, sizeof(event));

    event.xbutton.display     = display.get();
    event.xbutton.window      = target_window;
    event.xbutton.root        = XDefaultRootWindow(display.get());
    event.xbutton.subwindow   = None;
    event.xbutton.time        = CurrentTime;
    event.xbutton.x           = x;
    event.xbutton.y           = y;
    event.xbutton.x_root      = 1;
    event.xbutton.y_root      = 1;
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
}

/**
 * @brief The core logic for sending a synthetic mouse button press or release.
 */
void DoSyntheticMouseEvent(const Napi::CallbackInfo& info, unsigned int button, bool is_press) {
    Napi::Env env = info.Env();

    // --- Argument Validation ---
    if (info.Length() < 3 || !info[0].IsNumber() || !info[1].IsNumber() || !info[2].IsNumber()) {
        Napi::TypeError::New(env, "Requires at least 3 arguments: (windowId, x, y)").ThrowAsJavaScriptException();
        return;
    }

    // --- Connect to X Server ---
    DisplayPtr display(XOpenDisplay(nullptr));
    if (!display) {
        Napi::Error::New(env, "Failed to connect to X server").ThrowAsJavaScriptException();
        return;
    }

    // --- Parse Required Arguments ---
    const Window target_window = info[0].As<Napi::Number>().Int64Value();
    const int x = info[1].As<Napi::Number>().Int32Value();
    const int y = info[2].As<Napi::Number>().Int32Value();

    // --- Create the Synthetic Event ---
    XEvent event;
    memset(&event, 0, sizeof(event));

    event.xbutton.display     = display.get();
    event.xbutton.window      = target_window;
    event.xbutton.root        = XDefaultRootWindow(display.get());
    event.xbutton.subwindow   = None;
    event.xbutton.time        = CurrentTime;
    event.xbutton.x           = x;
    event.xbutton.y           = y;
    event.xbutton.x_root      = 1;
    event.xbutton.y_root      = 1;
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
void DoSyntheticMouseMove(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();

    // --- Argument Validation ---
    if (info.Length() < 3 || !info[0].IsNumber() || !info[1].IsNumber() || !info[2].IsNumber()) {
        Napi::TypeError::New(env, "Requires at least 3 arguments: (windowId, x, y)").ThrowAsJavaScriptException();
        return;
    }

    // --- Connect to X Server ---
    DisplayPtr display(XOpenDisplay(nullptr));
    if (!display) {
        Napi::Error::New(env, "Failed to connect to X server").ThrowAsJavaScriptException();
        return;
    }

    // --- Parse Required Arguments ---
    const Window target_window = info[0].As<Napi::Number>().Int64Value();
    const int x = info[1].As<Napi::Number>().Int32Value();
    const int y = info[2].As<Napi::Number>().Int32Value();

    // --- Create the Synthetic Motion Event ---
    XEvent event;
    memset(&event, 0, sizeof(event));

    event.xmotion.display     = display.get();
    event.xmotion.window      = target_window;
    event.xmotion.root        = XDefaultRootWindow(display.get());
    event.xmotion.subwindow   = None;
    event.xmotion.time        = CurrentTime;
    event.xmotion.x           = x;
    event.xmotion.y           = y;
    event.xmotion.x_root      = 1;
    event.xmotion.y_root      = 1;
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
    DoSyntheticClick(info, 1); // Button 1 is Left Click
    return info.Env().Null();
}

Napi::Value RightClick(const Napi::CallbackInfo& info) {
    DoSyntheticClick(info, 3); // Button 3 is Right Click
    return info.Env().Null();
}

Napi::Value MouseDown(const Napi::CallbackInfo& info) {
    DoSyntheticMouseEvent(info, 1, true); // Button 1 down
    return info.Env().Null();
}

Napi::Value MouseUp(const Napi::CallbackInfo& info) {
    DoSyntheticMouseEvent(info, 1, false); // Button 1 up
    return info.Env().Null();
}

Napi::Value RightMouseDown(const Napi::CallbackInfo& info) {
    DoSyntheticMouseEvent(info, 3, true); // Button 3 down
    return info.Env().Null();
}

Napi::Value RightMouseUp(const Napi::CallbackInfo& info) {
    DoSyntheticMouseEvent(info, 3, false); // Button 3 up
    return info.Env().Null();
}

Napi::Value MouseMove(const Napi::CallbackInfo& info) {
    DoSyntheticMouseMove(info);
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

NODE_API_MODULE(mouse_controller, Init) // Make sure this matches your target_name