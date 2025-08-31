#include <napi.h>
#include <X11/Xlib.h>
#include <X11/Xatom.h>
#include <X11/Xutil.h>
#include <X11/cursorfont.h>
#include <string>
#include <cstring>
#include <vector>
#include <utility>

// Structure to hold detailed window information
struct WindowInfo {
    Window windowId;
    std::string name;
    std::string className;
    int x;
    int y;
    int width;
    int height;
    bool visible;
    std::string display_name; // New field for display name

    // Extra attributes from XWindowAttributes
    int borderWidth;
    int depth;
    unsigned long colormap;

    // WM hints (from XGetWMHints)
    long wmFlags;
    bool wmInput;
    int wmInitialState;
    Window wmIconWindow;
    Window wmIconPixmap;
    Window wmIconMask;
    Window wmWindowGroup;

    // WM Normal Hints (from XGetWMNormalHints)
    int minWidth;
    int minHeight;
    int maxWidth;
    int maxHeight;
    int widthInc;
    int heightInc;
    int baseWidth;
    int baseHeight;

    // Extended properties
    std::vector<std::string> netWmState;
    std::vector<std::string> netWmWindowType;
    int netWmPid;
    bool hasNetWmPid;
};

// ---------------------------------------------------------------------
// Helper function to get display and window from N-API info
bool GetDisplayAndWindow(const Napi::CallbackInfo& info, Display** display, Window* window) {
    Napi::Env env = info.Env();
    if (info.Length() < 1 || !info[0].IsObject()) {
        Napi::TypeError::New(env, "Object with windowId and display is required").ThrowAsJavaScriptException();
        return false;
    }

    Napi::Object obj = info[0].As<Napi::Object>();
    if (!obj.Has("windowId") || !obj.Get("windowId").IsNumber() || !obj.Has("display") || !obj.Get("display").IsString()) {
        Napi::TypeError::New(env, "Object must have a numeric 'windowId' and a string 'display'").ThrowAsJavaScriptException();
        return false;
    }

    uint64_t window_id = obj.Get("windowId").As<Napi::Number>().Int64Value();
    std::string display_name = obj.Get("display").As<Napi::String>().Utf8Value();

    *window = (Window)window_id;
    *display = XOpenDisplay(display_name.c_str());

    if (!*display) {
        Napi::Error::New(env, "Cannot open display: " + display_name).ThrowAsJavaScriptException();
        return false;
    }
    return true;
}

// Existing helper functions

bool GetWindowProperty(Display* display, Window window, Atom property, Atom type,
                         unsigned char** value, unsigned long* nitems) {
    Atom actual_type;
    int actual_format;
    unsigned long bytes_after;

    if (XGetWindowProperty(display, window, property, 0, (~0L), False, type,
                           &actual_type, &actual_format, nitems, &bytes_after, value) == Success) {
        return actual_type != None;
    }
    return false;
}

std::string GetWindowClassName(Display* display, Window window) {
    XClassHint class_hint;
    std::string class_name;

    if (XGetClassHint(display, window, &class_hint)) {
        if (class_hint.res_class) {
            class_name = class_hint.res_class;
            XFree(class_hint.res_class);
        }
        if (class_hint.res_name) {
            XFree(class_hint.res_name);
        }
    }
    return class_name;
}

Window FindActualWindow(Display* display, Window start_window, int root_x, int root_y) {
    Window target = start_window;
    Window root_return, parent_return, *children;
    unsigned int nchildren;

    std::string class_name = GetWindowClassName(display, start_window);
    if (!class_name.empty()) {
        return start_window;
    }

    if (XQueryTree(display, start_window, &root_return, &parent_return, &children, &nchildren)) {
        for (unsigned int i = 0; i < nchildren; i++) {
            Window child = children[i];
            XWindowAttributes attrs;
            if (XGetWindowAttributes(display, child, &attrs)) {
                Window found = FindActualWindow(display, child, root_x, root_y);
                if (found != None) {
                    target = found;
                    break;
                }
            }
        }
        if (children) {
            XFree(children);
        }
    }
    return target;
}

// Get window dimensions
Napi::Object GetWindowDimensions(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object dimensions = Napi::Object::New(env);
    Display* display = nullptr;
    Window target_window = 0;

    if (!GetDisplayAndWindow(info, &display, &target_window)) {
        return dimensions;
    }

    XWindowAttributes attributes;
    if (XGetWindowAttributes(display, target_window, &attributes)) {
        dimensions.Set("width", attributes.width);
        dimensions.Set("height", attributes.height);
        dimensions.Set("x", attributes.x);
        dimensions.Set("y", attributes.y);
        dimensions.Set("visible", attributes.map_state == IsViewable);
    }
    XCloseDisplay(display);
    return dimensions;
}

// Get window name
Napi::String GetWindowName(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Display* display = nullptr;
    Window target_window = 0;

    if (!GetDisplayAndWindow(info, &display, &target_window)) {
        return Napi::String::New(env, "");
    }

    char* window_name = NULL;
    std::string name;
    if (XFetchName(display, target_window, &window_name)) {
        name = window_name ? window_name : "";
        XFree(window_name);
    }
    XCloseDisplay(display);
    return Napi::String::New(env, name);
}

// Get window class
Napi::Object GetWindowClass(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object classInfo = Napi::Object::New(env);
    Display* display = nullptr;
    Window target_window = 0;

    if (!GetDisplayAndWindow(info, &display, &target_window)) {
        return classInfo;
    }

    XClassHint class_hint;
    if (XGetClassHint(display, target_window, &class_hint)) {
        classInfo.Set("className", class_hint.res_class ? class_hint.res_class : "");
        classInfo.Set("instanceName", class_hint.res_name ? class_hint.res_name : "");
        XFree(class_hint.res_name);
        XFree(class_hint.res_class);
    }
    XCloseDisplay(display);
    return classInfo;
}

// Get window ID by clicking on it
Napi::Number GetWindowIdByClick(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Display* display = XOpenDisplay(NULL);
    if (!display) {
        return Napi::Number::New(env, 0);
    }
    Window root = DefaultRootWindow(display);
    Window target_window = 0;
    Cursor cursor = XCreateFontCursor(display, XC_crosshair);
    if (cursor) {
        int status;
        Window root_return, child_return;
        int root_x, root_y, win_x, win_y;
        unsigned int mask;
        XEvent event;
        status = XGrabPointer(display, root, False,
                              ButtonPressMask | ButtonReleaseMask,
                              GrabModeSync, GrabModeAsync,
                              root, cursor, CurrentTime);
        if (status == GrabSuccess) {
            XAllowEvents(display, SyncPointer, CurrentTime);
            XWindowEvent(display, root, ButtonPressMask, &event);
            if (event.type == ButtonPress) {
                XQueryPointer(display, root,
                              &root_return, &child_return,
                              &root_x, &root_y,
                              &win_x, &win_y,
                              &mask);
                if (child_return) {
                    target_window = FindActualWindow(display, child_return, root_x, root_y);
                }
            }
        }
        XUngrabPointer(display, CurrentTime);
        XFreeCursor(display, cursor);
    }
    XCloseDisplay(display);
    return Napi::Number::New(env, (double)target_window);
}

// Get active window ID
Napi::Number GetActiveWindow(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Display* display = XOpenDisplay(NULL);
    if (!display) {
        return Napi::Number::New(env, 0);
    }
    Window root = DefaultRootWindow(display);
    Window activeWindow = None;
    Atom netActiveWindowAtom = XInternAtom(display, "_NET_ACTIVE_WINDOW", False);
    Atom actualType;
    int actualFormat;
    unsigned long nItems;
    unsigned long bytesAfter;
    unsigned char* data = NULL;
    if (XGetWindowProperty(display, root, netActiveWindowAtom, 0, 1,
                           False, XA_WINDOW, &actualType, &actualFormat,
                           &nItems, &bytesAfter, &data) == Success) {
        if (actualType == XA_WINDOW && actualFormat == 32 && nItems == 1) {
            activeWindow = *((Window*)data);
        }
        if (data) {
            XFree(data);
        }
    }
    if (activeWindow == None || activeWindow == root) {
        Window focused;
        int revert_to;
        if (XGetInputFocus(display, &focused, &revert_to) && focused != None) {
            activeWindow = focused;
        }
    }
    if (activeWindow == None || activeWindow == root) {
        activeWindow = 0;
    }
    XCloseDisplay(display);
    return Napi::Number::New(env, (double)activeWindow);
}

// Get window state
Napi::String GetWindowState(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Display* display = nullptr;
    Window target_window = 0;

    if (!GetDisplayAndWindow(info, &display, &target_window)) {
        return Napi::String::New(env, "unknown");
    }

    Atom* properties = NULL;
    unsigned char* data = NULL;
    unsigned long nitems;
    Atom _NET_WM_STATE = XInternAtom(display, "_NET_WM_STATE", False);
    std::string state = "normal";
    if (GetWindowProperty(display, target_window, _NET_WM_STATE, XA_ATOM, &data, &nitems)) {
        properties = (Atom*)data;
        Atom _NET_WM_STATE_HIDDEN = XInternAtom(display, "_NET_WM_STATE_HIDDEN", False);
        Atom _NET_WM_STATE_MAXIMIZED_VERT = XInternAtom(display, "_NET_WM_STATE_MAXIMIZED_VERT", False);
        Atom _NET_WM_STATE_MAXIMIZED_HORZ = XInternAtom(display, "_NET_WM_STATE_MAXIMIZED_HORZ", False);
        bool is_hidden = false;
        bool is_maximized_vert = false;
        bool is_maximized_horz = false;
        for (unsigned long i = 0; i < nitems; i++) {
            if (properties[i] == _NET_WM_STATE_HIDDEN) is_hidden = true;
            if (properties[i] == _NET_WM_STATE_MAXIMIZED_VERT) is_maximized_vert = true;
            if (properties[i] == _NET_WM_STATE_MAXIMIZED_HORZ) is_maximized_horz = true;
        }
        if (is_hidden) state = "minimized";
        else if (is_maximized_vert && is_maximized_horz) state = "maximized";
        XFree(data);
    }
    XCloseDisplay(display);
    return Napi::String::New(env, state);
}

Napi::Object GetWindowInfoByClick(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object allInfo = Napi::Object::New(env);
    Display* display = XOpenDisplay(NULL);
    if (!display) {
        Napi::Error::New(env, "Cannot open display").ThrowAsJavaScriptException();
        return allInfo;
    }
    Window root = DefaultRootWindow(display);
    Window target_window = 0;
    Cursor cursor = XCreateFontCursor(display, XC_crosshair);
    if (cursor) {
        int status;
        Window root_return, child_return;
        int root_x, root_y, win_x, win_y;
        unsigned int mask;
        status = XGrabPointer(display, root, False,
                              ButtonPressMask | ButtonReleaseMask,
                              GrabModeSync, GrabModeAsync,
                              root, cursor, CurrentTime);
        if (status == GrabSuccess) {
            XEvent event;
            XAllowEvents(display, SyncPointer, CurrentTime);
            XWindowEvent(display, root, ButtonPressMask, &event);
            if (event.type == ButtonPress) {
                XQueryPointer(display, root,
                              &root_return, &child_return,
                              &root_x, &root_y,
                              &win_x, &win_y,
                              &mask);
                target_window = child_return;
            }
        }
        XUngrabPointer(display, CurrentTime);
        XFreeCursor(display, cursor);
    }
    if (target_window != 0) {
        XWindowAttributes attrs;
        if (XGetWindowAttributes(display, target_window, &attrs)) {
            Napi::Object dimensions = Napi::Object::New(env);
            dimensions.Set("x", attrs.x);
            dimensions.Set("y", attrs.y);
            dimensions.Set("width", attrs.width);
            dimensions.Set("height", attrs.height);
            allInfo.Set("dimensions", dimensions);
        }
        char* window_name;
        if (XFetchName(display, target_window, &window_name) && window_name) {
            allInfo.Set("name", Napi::String::New(env, window_name));
            XFree(window_name);
        } else {
            allInfo.Set("name", Napi::String::New(env, "Unknown"));
        }
        XClassHint class_hint;
        if (XGetClassHint(display, target_window, &class_hint)) {
            Napi::Object classInfo = Napi::Object::New(env);
            classInfo.Set("class", Napi::String::New(env, class_hint.res_class ? class_hint.res_class : "Unknown"));
            classInfo.Set("instance", Napi::String::New(env, class_hint.res_name ? class_hint.res_name : "Unknown"));
            allInfo.Set("class", classInfo);
            if (class_hint.res_class) XFree(class_hint.res_class);
            if (class_hint.res_name) XFree(class_hint.res_name);
        } else {
            Napi::Object classInfo = Napi::Object::New(env);
            classInfo.Set("class", Napi::String::New(env, "Unknown"));
            classInfo.Set("instance", Napi::String::New(env, "Unknown"));
            allInfo.Set("class", classInfo);
        }
        allInfo.Set("state", Napi::String::New(env, "Unknown"));
    } else {
        Napi::Error::New(env, "No window selected").ThrowAsJavaScriptException();
    }
    XCloseDisplay(display);
    return allInfo;
}

// Rewritten for efficiency and to take display into account
Napi::Object GetAllWindowInfo(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Object allInfo = Napi::Object::New(env);
    Display* display = nullptr;
    Window target_window = 0;

    if (!GetDisplayAndWindow(info, &display, &target_window)) {
        return allInfo;
    }

    // Get Dimensions
    XWindowAttributes attributes;
    if (XGetWindowAttributes(display, target_window, &attributes)) {
        Napi::Object dimensions = Napi::Object::New(env);
        dimensions.Set("width", attributes.width);
        dimensions.Set("height", attributes.height);
        dimensions.Set("x", attributes.x);
        dimensions.Set("y", attributes.y);
        dimensions.Set("visible", attributes.map_state == IsViewable);
        allInfo.Set("dimensions", dimensions);
    }

    // Get Name
    char* window_name = NULL;
    std::string name;
    if (XFetchName(display, target_window, &window_name) && window_name) {
        name = window_name;
        XFree(window_name);
    }
    allInfo.Set("name", Napi::String::New(env, name));

    // Get Class
    XClassHint class_hint;
    Napi::Object classInfo = Napi::Object::New(env);
    if (XGetClassHint(display, target_window, &class_hint)) {
        classInfo.Set("className", class_hint.res_class ? class_hint.res_class : "");
        classInfo.Set("instanceName", class_hint.res_name ? class_hint.res_name : "");
        if (class_hint.res_name) XFree(class_hint.res_name);
        if (class_hint.res_class) XFree(class_hint.res_class);
    }
    allInfo.Set("class", classInfo);

    // Get State
    Atom* properties = NULL;
    unsigned char* data = NULL;
    unsigned long nitems;
    Atom _NET_WM_STATE = XInternAtom(display, "_NET_WM_STATE", False);
    std::string state = "normal";
    if (GetWindowProperty(display, target_window, _NET_WM_STATE, XA_ATOM, &data, &nitems)) {
        properties = (Atom*)data;
        Atom _NET_WM_STATE_HIDDEN = XInternAtom(display, "_NET_WM_STATE_HIDDEN", False);
        Atom _NET_WM_STATE_MAXIMIZED_VERT = XInternAtom(display, "_NET_WM_STATE_MAXIMIZED_VERT", False);
        Atom _NET_WM_STATE_MAXIMIZED_HORZ = XInternAtom(display, "_NET_WM_STATE_MAXIMIZED_HORZ", False);
        bool is_hidden = false;
        bool is_maximized_vert = false;
        bool is_maximized_horz = false;
        for (unsigned long i = 0; i < nitems; i++) {
            if (properties[i] == _NET_WM_STATE_HIDDEN) is_hidden = true;
            if (properties[i] == _NET_WM_STATE_MAXIMIZED_VERT) is_maximized_vert = true;
            if (properties[i] == _NET_WM_STATE_MAXIMIZED_HORZ) is_maximized_horz = true;
        }
        if (is_hidden) state = "minimized";
        else if (is_maximized_vert && is_maximized_horz) state = "maximized";
        XFree(data);
    }
    allInfo.Set("state", Napi::String::New(env, state));

    XCloseDisplay(display);
    return allInfo;
}


// ---------------------------------------------------------------------
// Extended window info collection for GetWindowList

void CollectWindowInfo(Display* display, Window window, std::vector<WindowInfo>& results, const std::string& current_display_name) {
    XWindowAttributes attrs;
    if (!XGetWindowAttributes(display, window, &attrs))
        return;

    WindowInfo info;
    info.windowId = window;
    info.display_name = current_display_name; // Store the display name

    // Basic info: name & class
    {
        char* name = nullptr;
        if (XFetchName(display, window, &name) && name) {
            info.name = name;
            XFree(name);
        }
        info.className = GetWindowClassName(display, window);
    }

    // Geometry & visibility
    info.x = attrs.x;
    info.y = attrs.y;
    info.width = attrs.width;
    info.height = attrs.height;
    info.visible = (attrs.map_state == IsViewable);

    // Extra attributes from XWindowAttributes
    info.borderWidth = attrs.border_width;
    info.depth = attrs.depth;
    info.colormap = attrs.colormap;

    // WM hints via XGetWMHints
    XWMHints* hints = XGetWMHints(display, window);
    if (hints) {
        info.wmFlags = hints->flags;
        info.wmInput = (hints->flags & InputHint) ? hints->input : false;
        info.wmInitialState = (hints->flags & StateHint) ? hints->initial_state : -1;
        info.wmIconWindow = (hints->flags & IconWindowHint) ? hints->icon_window : 0;
        info.wmIconPixmap = (hints->flags & IconPixmapHint) ? hints->icon_pixmap : 0;
        info.wmIconMask = (hints->flags & IconMaskHint) ? hints->icon_mask : 0;
        info.wmWindowGroup = (hints->flags & WindowGroupHint) ? hints->window_group : 0;
        XFree(hints);
    } else {
        info.wmFlags = 0;
        info.wmInput = false;
        info.wmInitialState = -1;
        info.wmIconWindow = 0;
        info.wmIconPixmap = 0;
        info.wmIconMask = 0;
        info.wmWindowGroup = 0;
    }

    // Normal hints via XGetWMNormalHints
    XSizeHints sizeHints;
    long supplied = 0;
    if (XGetWMNormalHints(display, window, &sizeHints, &supplied)) {
        if (supplied & PMinSize) {
            info.minWidth = sizeHints.min_width;
            info.minHeight = sizeHints.min_height;
        } else {
            info.minWidth = info.minHeight = 0;
        }
        if (supplied & PMaxSize) {
            info.maxWidth = sizeHints.max_width;
            info.maxHeight = sizeHints.max_height;
        } else {
            info.maxWidth = info.maxHeight = 0;
        }
        if (supplied & PResizeInc) {
            info.widthInc = sizeHints.width_inc;
            info.heightInc = sizeHints.height_inc;
        } else {
            info.widthInc = info.heightInc = 0;
        }
        if (supplied & PBaseSize) {
            info.baseWidth = sizeHints.base_width;
            info.baseHeight = sizeHints.base_height;
        } else {
            info.baseWidth = info.baseHeight = 0;
        }
    } else {
        info.minWidth = info.minHeight = info.maxWidth = info.maxHeight = 0;
        info.widthInc = info.heightInc = info.baseWidth = info.baseHeight = 0;
    }

    // Extended properties: _NET_WM_STATE
    {
        Atom netWmStateAtom = XInternAtom(display, "_NET_WM_STATE", False);
        Atom actualType;
        int actualFormat;
        unsigned long nitems, bytesAfter;
        unsigned char* prop = NULL;
        if (XGetWindowProperty(display, window, netWmStateAtom, 0, (~0L), False, XA_ATOM,
                               &actualType, &actualFormat, &nitems, &bytesAfter, &prop) == Success && prop) {
            Atom* atoms = (Atom*)prop;
            for (unsigned long j = 0; j < nitems; j++) {
                char* atomName = XGetAtomName(display, atoms[j]);
                if (atomName) {
                    info.netWmState.push_back(std::string(atomName));
                    XFree(atomName);
                }
            }
            XFree(prop);
        }
    }

    // Extended properties: _NET_WM_WINDOW_TYPE
    {
        Atom netWmWindowTypeAtom = XInternAtom(display, "_NET_WM_WINDOW_TYPE", False);
        Atom actualType;
        int actualFormat;
        unsigned long nitems, bytesAfter;
        unsigned char* prop = NULL;
        if (XGetWindowProperty(display, window, netWmWindowTypeAtom, 0, (~0L), False, XA_ATOM,
                               &actualType, &actualFormat, &nitems, &bytesAfter, &prop) == Success && prop) {
            Atom* atoms = (Atom*)prop;
            for (unsigned long j = 0; j < nitems; j++) {
                char* atomName = XGetAtomName(display, atoms[j]);
                if (atomName) {
                    info.netWmWindowType.push_back(std::string(atomName));
                    XFree(atomName);
                }
            }
            XFree(prop);
        }
    }

    // Extended property: _NET_WM_PID
    {
        Atom netWmPidAtom = XInternAtom(display, "_NET_WM_PID", False);
        Atom actualType;
        int actualFormat;
        unsigned long nitems, bytesAfter;
        unsigned char* prop = NULL;
        if (XGetWindowProperty(display, window, netWmPidAtom, 0, 1, False, XA_CARDINAL,
                               &actualType, &actualFormat, &nitems, &bytesAfter, &prop) == Success && prop && nitems == 1) {
            info.netWmPid = *((unsigned long*)prop);
            info.hasNetWmPid = true;
            XFree(prop);
        } else {
            info.netWmPid = 0;
            info.hasNetWmPid = false;
        }
    }

    results.push_back(info);

    // Recurse for child windows
    Window root_return, parent_return;
    Window* children = nullptr;
    unsigned int nchildren = 0;
    if (XQueryTree(display, window, &root_return, &parent_return, &children, &nchildren)) {
        for (unsigned int i = 0; i < nchildren; i++) {
            CollectWindowInfo(display, children[i], results, current_display_name); // Pass display name to recursive calls
        }
        if (children) {
            XFree(children);
        }
    }
}

Napi::Array GetWindowList(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    Napi::Array windowArray = Napi::Array::New(env);
    std::vector<WindowInfo> all_results;

    // Iterate through common display numbers
    for (int i = 0; i <= 10; ++i) {
        std::string display_name = ":" + std::to_string(i);
        Display* display = XOpenDisplay(display_name.c_str());
        if (!display) {
            continue;
        }

        Window root = DefaultRootWindow(display);
        CollectWindowInfo(display, root, all_results, display_name); // Pass display name
        XCloseDisplay(display);
    }

    uint32_t index = 0;
    for (size_t i = 0; i < all_results.size(); i++) {
        if (all_results[i].name.find("Tibia") != std::string::npos && all_results[i].width > 100 && all_results[i].height > 100) {
            Napi::Object obj = Napi::Object::New(env);
            obj.Set("windowId", Napi::Number::New(env, (double)all_results[i].windowId));
            obj.Set("name", Napi::String::New(env, all_results[i].name));
            obj.Set("class", Napi::String::New(env, all_results[i].className));
            obj.Set("display", Napi::String::New(env, all_results[i].display_name)); // Add display name

            // Geometry & basic attributes
            Napi::Object dimensions = Napi::Object::New(env);
            dimensions.Set("x", Napi::Number::New(env, all_results[i].x));
            dimensions.Set("y", Napi::Number::New(env, all_results[i].y));
            dimensions.Set("width", Napi::Number::New(env, all_results[i].width));
            dimensions.Set("height", Napi::Number::New(env, all_results[i].height));
            dimensions.Set("visible", Napi::Boolean::New(env, all_results[i].visible));
            dimensions.Set("borderWidth", Napi::Number::New(env, all_results[i].borderWidth));
            dimensions.Set("depth", Napi::Number::New(env, all_results[i].depth));
            dimensions.Set("colormap", Napi::Number::New(env, all_results[i].colormap));
            obj.Set("dimensions", dimensions);

            // WM hints
            Napi::Object wmHints = Napi::Object::New(env);
            wmHints.Set("wmFlags", Napi::Number::New(env, all_results[i].wmFlags));
            wmHints.Set("wmInput", Napi::Boolean::New(env, all_results[i].wmInput));
            wmHints.Set("wmInitialState", Napi::Number::New(env, all_results[i].wmInitialState));
            wmHints.Set("wmIconWindow", Napi::Number::New(env, (double)all_results[i].wmIconWindow));
            wmHints.Set("wmIconPixmap", Napi::Number::New(env, (double)all_results[i].wmIconPixmap));
            wmHints.Set("wmIconMask", Napi::Number::New(env, (double)all_results[i].wmIconMask));
            wmHints.Set("wmWindowGroup", Napi::Number::New(env, (double)all_results[i].wmWindowGroup));
            obj.Set("wmHints", wmHints);

            // Normal hints
            Napi::Object normalHints = Napi::Object::New(env);
            normalHints.Set("minWidth", Napi::Number::New(env, all_results[i].minWidth));
            normalHints.Set("minHeight", Napi::Number::New(env, all_results[i].minHeight));
            normalHints.Set("maxWidth", Napi::Number::New(env, all_results[i].maxWidth));
            normalHints.Set("maxHeight", Napi::Number::New(env, all_results[i].maxHeight));
            normalHints.Set("widthInc", Napi::Number::New(env, all_results[i].widthInc));
            normalHints.Set("heightInc", Napi::Number::New(env, all_results[i].heightInc));
            normalHints.Set("baseWidth", Napi::Number::New(env, all_results[i].baseWidth));
            normalHints.Set("baseHeight", Napi::Number::New(env, all_results[i].baseHeight));
            obj.Set("normalHints", normalHints);

            // Extended properties
            Napi::Array netWmStateArr = Napi::Array::New(env, all_results[i].netWmState.size());
            for (size_t j = 0; j < all_results[i].netWmState.size(); j++) {
                netWmStateArr.Set(j, Napi::String::New(env, all_results[i].netWmState[j]));
            }
            obj.Set("netWmState", netWmStateArr);

            Napi::Array netWmWindowTypeArr = Napi::Array::New(env, all_results[i].netWmWindowType.size());
            for (size_t j = 0; j < all_results[i].netWmWindowType.size(); j++) {
                netWmWindowTypeArr.Set(j, Napi::String::New(env, all_results[i].netWmWindowType[j]));
            }
            obj.Set("netWmWindowType", netWmWindowTypeArr);

            if (all_results[i].hasNetWmPid) {
                obj.Set("netWmPid", Napi::Number::New(env, all_results[i].netWmPid));
            }
            windowArray.Set(index++, obj);
        }
    }
    return windowArray;
}

Napi::Object Init(Napi::Env env, Napi::Object exports) {
    exports.Set("getDimensions", Napi::Function::New(env, GetWindowDimensions));
    exports.Set("getName", Napi::Function::New(env, GetWindowName));
    exports.Set("getClass", Napi::Function::New(env, GetWindowClass));
    exports.Set("getState", Napi::Function::New(env, GetWindowState));
    exports.Set("getAllInfo", Napi::Function::New(env, GetAllWindowInfo));
    exports.Set("getActiveWindow", Napi::Function::New(env, GetActiveWindow));
    exports.Set("getWindowIdByClick", Napi::Function::New(env, GetWindowIdByClick));
    exports.Set("getWindowInfoByClick", Napi::Function::New(env, GetWindowInfoByClick));
    exports.Set("getWindowList", Napi::Function::New(env, GetWindowList));
    return exports;
}

NODE_API_MODULE(windowinfo, Init)