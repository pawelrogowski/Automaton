#include <napi.h>
#include <X11/Xlib.h>
#include <X11/extensions/XTest.h>
#include <string>
#include <memory>
#include <stdexcept>
#include <algorithm>
#include <unistd.h>
#include <cmath>
#include <random>
#include <vector>
#include <chrono>
#include <ctime>
#include <iostream>

// RAII wrapper for the X11 Display connection
struct DisplayDeleter {
    void operator()(Display* disp) {
        if (disp) XCloseDisplay(disp);
    }
};
using DisplayPtr = std::unique_ptr<Display, DisplayDeleter>;

// ==================== HUMANIZATION SYSTEM ====================

class HumanTimingGenerator {
private:
    std::mt19937 rng;
    std::normal_distribution<double> normal_dist;
    std::uniform_real_distribution<double> uniform_dist;

public:
    HumanTimingGenerator() : rng(std::random_device{}()), normal_dist(0.0, 1.0), uniform_dist(0.0, 1.0) {}

    int get_delay(int base_ms, int max_variation_ms) {
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
        return uniform_dist(rng) < 0.03;
    }

    int get_micro_delay() {
        return get_delay(8, 4);
    }

    double get_random() {
        return uniform_dist(rng);
    }

    double get_normal() {
        return normal_dist(rng);
    }
};

class BehaviorProfile {
private:
    int speed_preference;
    int precision_level;
    int overshoot_tendency;

public:
    BehaviorProfile() {
        speed_preference = rand() % 3;  // 0=slow, 1=medium, 2=fast
        precision_level = rand() % 3;   // 0=sloppy, 1=normal, 2=precise
        overshoot_tendency = rand() % 3; // 0=rare, 1=occasional, 2=frequent
    }

    double get_speed_multiplier() const {
        switch (speed_preference) {
            case 0: return 0.7;
            case 1: return 1.0;
            case 2: return 1.3;
            default: return 1.0;
        }
    }

    int get_jitter_amount() const {
        switch (precision_level) {
            case 0: return 3;  // ±3 pixels
            case 1: return 2;  // ±2 pixels
            case 2: return 1;  // ±1 pixel
            default: return 2;
        }
    }

    bool should_overshoot() const {
        int threshold = (overshoot_tendency + 1) * 5; // 5%, 10%, or 15%
        return (rand() % 100) < threshold;
    }

    int get_overshoot_amount() const {
        return 2 + (rand() % 7); // 2-8 pixels
    }
};

class SessionManager {
private:
    static int session_counter;
    static std::shared_ptr<BehaviorProfile> current_profile;

public:
    static std::shared_ptr<BehaviorProfile> get_current_profile() {
        if (!current_profile) {
            current_profile = std::make_shared<BehaviorProfile>();
        }
        return current_profile;
    }

    static void new_session() {
        session_counter++;
        current_profile = std::make_shared<BehaviorProfile>();
    }
};

int SessionManager::session_counter = 0;
std::shared_ptr<BehaviorProfile> SessionManager::current_profile = nullptr;

HumanTimingGenerator timing_generator;

// Track last cursor position for distance calculations
struct CursorState {
    int last_x = -1;
    int last_y = -1;
    bool initialized = false;
} cursor_state;

// ==================== BEZIER CURVE SYSTEM ====================

struct Point {
    double x, y;
};

Point cubic_bezier(const Point& p0, const Point& p1, const Point& p2, const Point& p3, double t) {
    double u = 1.0 - t;
    double tt = t * t;
    double uu = u * u;
    double uuu = uu * u;
    double ttt = tt * t;

    Point p;
    p.x = uuu * p0.x + 3 * uu * t * p1.x + 3 * u * tt * p2.x + ttt * p3.x;
    p.y = uuu * p0.y + 3 * uu * t * p1.y + 3 * u * tt * p2.y + ttt * p3.y;
    return p;
}

std::vector<Point> generate_bezier_path(int start_x, int start_y, int end_x, int end_y, int steps) {
    std::vector<Point> path;
    
    Point p0 = {(double)start_x, (double)start_y};
    Point p3 = {(double)end_x, (double)end_y};
    
    // Generate random control points
    double dx = end_x - start_x;
    double dy = end_y - start_y;
    double dist = std::sqrt(dx * dx + dy * dy);
    
    // Control point 1: 1/3 along the path with perpendicular offset
    double offset1 = (timing_generator.get_random() - 0.5) * dist * 0.3;
    Point p1;
    p1.x = start_x + dx * 0.33 - dy / dist * offset1;
    p1.y = start_y + dy * 0.33 + dx / dist * offset1;
    
    // Control point 2: 2/3 along the path with perpendicular offset
    double offset2 = (timing_generator.get_random() - 0.5) * dist * 0.3;
    Point p2;
    p2.x = start_x + dx * 0.67 - dy / dist * offset2;
    p2.y = start_y + dy * 0.67 + dx / dist * offset2;
    
    // Generate path points
    for (int i = 0; i <= steps; i++) {
        double t = (double)i / steps;
        path.push_back(cubic_bezier(p0, p1, p2, p3, t));
    }
    
    return path;
}

// ==================== XTEST HELPERS ====================

bool initialize_xtest(Display* display) {
    int event_base, error_base, major, minor;
    return XTestQueryExtension(display, &event_base, &error_base, &major, &minor);
}

void get_current_cursor_position(Display* display, int& x, int& y) {
    Window root, child;
    int root_x, root_y, win_x, win_y;
    unsigned int mask;
    
    root = XDefaultRootWindow(display);
    if (XQueryPointer(display, root, &root, &child, &root_x, &root_y, &win_x, &win_y, &mask)) {
        x = root_x;
        y = root_y;
    } else {
        x = cursor_state.last_x;
        y = cursor_state.last_y;
    }
}

void update_cursor_state(Display* display) {
    int x, y;
    get_current_cursor_position(display, x, y);
    cursor_state.last_x = x;
    cursor_state.last_y = y;
    cursor_state.initialized = true;
}

// ==================== ADAPTIVE MOVEMENT SYSTEM ====================

struct MovementPlan {
    enum Type { FAST_BEZIER, FULL_BEZIER } type;
    std::vector<Point> path;
    int total_time_ms;
    bool should_overshoot;
    Point overshoot_target;
};

MovementPlan plan_movement(Display* display, int target_x, int target_y, int max_duration_ms, 
                          const std::shared_ptr<BehaviorProfile>& profile) {
    MovementPlan plan;
    
    // Get current cursor position
    int start_x, start_y;
    if (cursor_state.initialized) {
        start_x = cursor_state.last_x;
        start_y = cursor_state.last_y;
    } else {
        get_current_cursor_position(display, start_x, start_y);
    }
    
    // Calculate distance
    double dx = target_x - start_x;
    double dy = target_y - start_y;
    double distance = std::sqrt(dx * dx + dy * dy);
    
    // Apply jitter to target position
    int jitter = profile->get_jitter_amount();
    int jitter_x = (rand() % (jitter * 2 + 1)) - jitter;
    int jitter_y = (rand() % (jitter * 2 + 1)) - jitter;
    int final_x = target_x + jitter_x;
    int final_y = target_y + jitter_y;
    
    // Decide movement strategy based on distance and time budget
    // ALWAYS use Bezier curves - no instant teleport for detection avoidance
    if (distance < 150 || max_duration_ms < 200) {
        // FAST_BEZIER: Quick movements with minimal Bezier curve
        plan.type = MovementPlan::FAST_BEZIER;
        
        // Calculate steps based on time budget and distance
        // Minimum 2 steps even for very short distances to avoid straight lines
        int steps;
        if (distance < 30) {
            steps = 2; // Ultra-short: minimal curve but still not instant
        } else if (distance < 80) {
            steps = 3; // Short: light curve
        } else {
            steps = std::min(10, std::max(4, (int)(distance / 20)));
        }
        
        double speed_mult = profile->get_speed_multiplier();
        int base_time = (int)(distance * 1.2 / speed_mult);
        
        // For very short distances with tight time budget, use minimum time
        if (distance < 30 && max_duration_ms < 100) {
            plan.total_time_ms = std::max(20, std::min(max_duration_ms - 10, base_time));
        } else {
            plan.total_time_ms = std::min(max_duration_ms - 30, base_time);
        }
        
        plan.path = generate_bezier_path(start_x, start_y, final_x, final_y, steps);
        plan.should_overshoot = false; // Skip overshoot for fast mode
    } else {
        // FULL_BEZIER: Long distance and sufficient time
        plan.type = MovementPlan::FULL_BEZIER;
        
        // More steps for smoother movement
        int steps = std::min(25, std::max(8, (int)(distance / 15)));
        double speed_mult = profile->get_speed_multiplier();
        int base_time = (int)(distance * 1.5 / speed_mult);
        plan.total_time_ms = std::min(max_duration_ms - 50, base_time);
        
        // Check if we should overshoot
        plan.should_overshoot = profile->should_overshoot();
        if (plan.should_overshoot) {
            int overshoot_amount = profile->get_overshoot_amount();
            double angle = std::atan2(dy, dx);
            plan.overshoot_target.x = final_x + std::cos(angle) * overshoot_amount;
            plan.overshoot_target.y = final_y + std::sin(angle) * overshoot_amount;
            
            // First path: to overshoot position
            plan.path = generate_bezier_path(start_x, start_y, 
                                            (int)plan.overshoot_target.x, 
                                            (int)plan.overshoot_target.y, steps);
        } else {
            plan.path = generate_bezier_path(start_x, start_y, final_x, final_y, steps);
        }
    }
    
    return plan;
}

void execute_movement(Display* display, const MovementPlan& plan, int final_x, int final_y) {
    // Always use Bezier path movement - no instant warps
    if (true) {
        // Bezier path movement
        int time_per_step = plan.total_time_ms / std::max(1, (int)plan.path.size());
        
        for (size_t i = 0; i < plan.path.size(); i++) {
            const Point& p = plan.path[i];
            
            XTestFakeMotionEvent(display, -1, (int)p.x, (int)p.y, CurrentTime);
            XFlush(display);
            
            // Variable delay between motion events
            int delay_ms = timing_generator.get_delay(time_per_step, time_per_step / 4);
            usleep(delay_ms * 1000);
            
            // Occasional micro-pause
            if (timing_generator.should_add_micro_delay()) {
                usleep(timing_generator.get_micro_delay() * 1000);
            }
        }
        
        // Handle overshoot correction
        if (plan.should_overshoot) {
            usleep(timing_generator.get_delay(15, 8) * 1000);
            
            // Correction movement
            int correction_steps = 3;
            std::vector<Point> correction = generate_bezier_path(
                (int)plan.overshoot_target.x, (int)plan.overshoot_target.y,
                final_x, final_y, correction_steps);
            
            for (const Point& p : correction) {
                XTestFakeMotionEvent(display, -1, (int)p.x, (int)p.y, CurrentTime);
                XFlush(display);
                usleep(timing_generator.get_delay(12, 6) * 1000);
            }
        }
    }
    
    // Update cursor state
    cursor_state.last_x = final_x;
    cursor_state.last_y = final_y;
    cursor_state.initialized = true;
}

// ==================== MOUSE ACTION FUNCTIONS ====================

/**
 * @brief The core logic for sending a synthetic mouse click with adaptive humanization.
 */
void DoSyntheticClick(const Napi::CallbackInfo& info, unsigned int button, const std::string& display_name) {
    Napi::Env env = info.Env();

    // --- Argument Validation ---
    if (info.Length() < 4 || !info[0].IsNumber() || !info[1].IsNumber() || !info[2].IsNumber() || !info[3].IsString()) {
        Napi::TypeError::New(env, "Requires at least 4 arguments: (windowId, x, y, display, [maxDuration])").ThrowAsJavaScriptException();
        return;
    }

    // --- Connect to X Server ---
    DisplayPtr display(XOpenDisplay(display_name.empty() ? nullptr : display_name.c_str()));
    if (!display) {
        Napi::Error::New(env, "Failed to connect to X server on display: " + display_name).ThrowAsJavaScriptException();
        return;
    }

    // --- Check XTest Extension ---
    if (!initialize_xtest(display.get())) {
        Napi::Error::New(env, "XTest extension not available").ThrowAsJavaScriptException();
        return;
    }

    // --- Parse Required Arguments ---
    const Window target_window = info[0].As<Napi::Number>().Int64Value();
    const int x = info[1].As<Napi::Number>().Int32Value();
    const int y = info[2].As<Napi::Number>().Int32Value();

    // --- Parse Optional Arguments ---
    int max_duration_ms = 300; // Default 300ms
    if (info.Length() > 4 && info[4].IsNumber()) {
        max_duration_ms = info[4].As<Napi::Number>().Int32Value();
    }
    
    // Optional return position (window-relative coordinates)
    int return_x = -1;
    int return_y = -1;
    if (info.Length() > 5 && info[5].IsObject()) {
        Napi::Object returnPos = info[5].As<Napi::Object>();
        if (returnPos.Has("x") && returnPos.Has("y")) {
            return_x = returnPos.Get("x").As<Napi::Number>().Int32Value();
            return_y = returnPos.Get("y").As<Napi::Number>().Int32Value();
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

    // --- Calculate absolute screen coordinates ---
    int target_x = win_x + x;
    int target_y = win_y + y;

    // --- Get behavior profile ---
    auto profile = SessionManager::get_current_profile();

    // --- Plan and execute movement ---
    MovementPlan movement = plan_movement(display.get(), target_x, target_y, max_duration_ms, profile);
    execute_movement(display.get(), movement, target_x, target_y);

    // --- Variable delay before click ---
    usleep(timing_generator.get_delay(8, 4) * 1000);

    // --- Send ButtonPress with XTest ---
    XTestFakeButtonEvent(display.get(), button, True, CurrentTime);
    XFlush(display.get());

    // --- Variable button press duration ---
    int press_duration = timing_generator.get_delay(25, 15); // 15-50ms
    usleep(press_duration * 1000);

    // --- Send ButtonRelease with XTest ---
    XTestFakeButtonEvent(display.get(), button, False, CurrentTime);
    XFlush(display.get());

    // --- Post-click behavior ---
    usleep(timing_generator.get_delay(80, 40) * 1000);
    
    // If a return position was specified, move there
    if (return_x >= 0 && return_y >= 0) {
        // Convert window-relative to absolute coordinates
        int abs_return_x = win_x + return_x;
        int abs_return_y = win_y + return_y;
        
        // Move to specified position with moderate speed
        MovementPlan return_plan = plan_movement(display.get(), abs_return_x, abs_return_y, 150, profile);
        execute_movement(display.get(), return_plan, abs_return_x, abs_return_y);
    }
    // Note: If no return position specified, mouse stays at click location
    // This allows JavaScript layer to have full control over cursor positioning
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

// XTest-based absolute cursor movement (for mouse noise/natural movement)
Napi::Value XTestMoveCursor(const Napi::CallbackInfo& info) {
    Napi::Env env = info.Env();
    
    // Requires: x, y (absolute screen coords), display
    if (info.Length() < 3 || !info[0].IsNumber() || !info[1].IsNumber() || !info[2].IsString()) {
        Napi::TypeError::New(env, "XTestMoveCursor requires 3 arguments: (x, y, display)").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    const int abs_x = info[0].As<Napi::Number>().Int32Value();
    const int abs_y = info[1].As<Napi::Number>().Int32Value();
    const std::string display_name = info[2].As<Napi::String>().Utf8Value();
    
    // Connect to X Server
    DisplayPtr display(XOpenDisplay(display_name.empty() ? nullptr : display_name.c_str()));
    if (!display) {
        Napi::Error::New(env, "Failed to connect to X server").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    // Check XTest Extension
    if (!initialize_xtest(display.get())) {
        Napi::Error::New(env, "XTest extension not available").ThrowAsJavaScriptException();
        return env.Null();
    }
    
    // Move cursor to absolute position using XTest
    XTestFakeMotionEvent(display.get(), -1, abs_x, abs_y, CurrentTime);
    XFlush(display.get());
    
    // Update cursor state
    cursor_state.last_x = abs_x;
    cursor_state.last_y = abs_y;
    cursor_state.initialized = true;
    
    return env.Null();
}

// --- Module Initialization ---
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    // Initialize X11 threading
    if (!XInitThreads()) {
        std::cerr << "mouse-controller: Warning - XInitThreads() failed." << std::endl;
    }
    
    // Seed random number generator
    srand(time(NULL));
    
    // Initialize timing generator (already done in constructor, but ensure it's ready)
    timing_generator = HumanTimingGenerator();
    
    // Initialize session
    SessionManager::new_session();
    
    exports.Set("leftClick", Napi::Function::New(env, LeftClick));
    exports.Set("rightClick", Napi::Function::New(env, RightClick));
    exports.Set("mouseDown", Napi::Function::New(env, MouseDown));
    exports.Set("mouseUp", Napi::Function::New(env, MouseUp));
    exports.Set("rightMouseDown", Napi::Function::New(env, RightMouseDown));
    exports.Set("rightMouseUp", Napi::Function::New(env, RightMouseUp));
    exports.Set("mouseMove", Napi::Function::New(env, MouseMove));
    exports.Set("xtestMoveCursor", Napi::Function::New(env, XTestMoveCursor));
    return exports;
}

NODE_API_MODULE(mouse_controller, Init)
