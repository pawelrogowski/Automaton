#include <napi.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <xcb/xcb.h>
#include <xcb/shm.h>
#include <sys/ipc.h>
#include <sys/shm.h>
#include <unistd.h>
#include <stdint.h>
#include <atomic>
#include <thread>
#include <mutex>
#include <chrono>
#include <algorithm>
#include <system_error>
#include <memory>

// --- Shared Memory Handling (Unchanged from original) ---
typedef struct {
    xcb_shm_seg_t shmseg;
    uint8_t *data;
    uint64_t size;
    int shmid;
} shm_segment_info_t;

void free_segment_info(shm_segment_info_t *segment) {
    if (segment) {
        free(segment);
    }
}

void cleanup_shm(xcb_connection_t *connection, shm_segment_info_t *segment) {
    if (!segment) return;
    if (connection && segment->shmseg != XCB_NONE) {
        xcb_shm_detach(connection, segment->shmseg);
    }
    if (segment->data != nullptr && segment->data != (void*)-1) {
        shmdt(segment->data);
    }
    free_segment_info(segment);
}

shm_segment_info_t* init_shm(xcb_connection_t *connection, uint64_t requested_size) {
    uint64_t size = std::max(requested_size, static_cast<uint64_t>(4096));
    size = (size + 4095) & ~4095;

    shm_segment_info_t *segment = static_cast<shm_segment_info_t*>(malloc(sizeof(shm_segment_info_t)));
    if (!segment) {
        perror("Failed to allocate segment info");
        return nullptr;
    }
    segment->data = nullptr;
    segment->shmseg = XCB_NONE;
    segment->shmid = -1;
    segment->size = 0;

    segment->shmid = shmget(IPC_PRIVATE, size, IPC_CREAT | 0600);
    if (segment->shmid == -1) {
        perror("shmget failed");
        free_segment_info(segment);
        return nullptr;
    }

    segment->data = static_cast<uint8_t*>(shmat(segment->shmid, nullptr, 0));
    if (segment->data == reinterpret_cast<void*>(-1)) {
        perror("shmat failed");
        shmctl(segment->shmid, IPC_RMID, nullptr);
        free_segment_info(segment);
        return nullptr;
    }

    if (shmctl(segment->shmid, IPC_RMID, nullptr) == -1) {
        perror("shmctl(IPC_RMID) failed");
        shmdt(segment->data);
        free_segment_info(segment);
        return nullptr;
    }

    segment->shmseg = xcb_generate_id(connection);
    segment->size = size;

    xcb_void_cookie_t attach_cookie = xcb_shm_attach_checked(connection, segment->shmseg, segment->shmid, 0);
    xcb_generic_error_t *error = xcb_request_check(connection, attach_cookie);
    if (error) {
        fprintf(stderr, "XCB SHM attach failed: error code %d\n", error->error_code);
        free(error);
        shmdt(segment->data);
        free_segment_info(segment);
        return nullptr;
    }

    xcb_flush(connection);
    return segment;
}


// --- N-API Class ---

class X11RegionCapture : public Napi::ObjectWrap<X11RegionCapture> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        Napi::Function func = DefineClass(env, "X11RegionCapture", {
            InstanceMethod("startMonitorInstance", &X11RegionCapture::StartMonitorInstance),
            InstanceMethod("stopMonitorInstance", &X11RegionCapture::StopMonitorInstance),
            InstanceMethod("getLatestFrame", &X11RegionCapture::GetLatestFrame),
            InstanceMethod("isConnected", &X11RegionCapture::IsConnected)
        });

        Napi::FunctionReference* constructor = new Napi::FunctionReference();
        *constructor = Napi::Persistent(func);
        env.SetInstanceData(constructor);

        exports.Set("X11RegionCapture", func);
        return exports;
    }

    X11RegionCapture(const Napi::CallbackInfo& info) : Napi::ObjectWrap<X11RegionCapture>(info) {
        connection = nullptr;
        shm_segment = nullptr;
        is_connected = false;
        should_capture = false;
        is_capturing = false;
        target_window_id = XCB_NONE;
        target_frame_time_us = std::chrono::microseconds(1000000 / 60);
        display_name = "";
        shm_first_event = 0; // **MODIFICATION 1**: Initialize new member

        if (info.Length() > 0 && info[0].IsString()) {
            display_name = info[0].As<Napi::String>().Utf8Value();
        }

        readable_buffer_ptr = nullptr;
        writable_buffer_ptr = nullptr;
        frame_buffer_size = 0;
        latest_capture_timestamp_us = 0;
        latest_width = 0;
        latest_height = 0;

        Connect();
    }

    ~X11RegionCapture() {
        StopCaptureThread();
        Cleanup();
    }

private:
    // Constants
    static const int MAX_DIMENSION = 32767;
    static const int DEFAULT_FPS = 60;
    static const int MIN_FPS = 1;
    static const int MAX_FPS = 1000;
    static const size_t IMAGE_HEADER_SIZE = 8;

    // Member Variables
    xcb_connection_t *connection;
    shm_segment_info_t *shm_segment;
    std::atomic<bool> is_connected;
    std::atomic<bool> should_capture;
    std::atomic<bool> is_capturing;
    std::thread capture_thread;
    xcb_window_t target_window_id;
    std::chrono::microseconds target_frame_time_us;
    std::string display_name;
    uint8_t shm_first_event; // **MODIFICATION 1**: New member to hold event ID

    // Double Buffering members
    std::unique_ptr<uint8_t[]> buffer_a;
    std::unique_ptr<uint8_t[]> buffer_b;
    std::atomic<uint8_t*> readable_buffer_ptr;
    uint8_t* writable_buffer_ptr;
    std::mutex buffer_mutex;
    uint64_t frame_buffer_size;
    uint64_t latest_capture_timestamp_us;
    uint32_t latest_width;
    uint32_t latest_height;

    // **MODIFICATION 2**: Connect() now gets the SHM event ID. CheckSHM() is no longer needed.
    void Connect() {
        Cleanup();
        int screen_num;
        connection = xcb_connect(display_name.empty() ? NULL : display_name.c_str(), &screen_num);
        if (!connection || xcb_connection_has_error(connection)) {
            if (connection) xcb_disconnect(connection);
            connection = nullptr;
            is_connected = false;
            return;
        }

        xcb_prefetch_extension_data(connection, &xcb_shm_id);
        const xcb_query_extension_reply_t* shm_ext = xcb_get_extension_data(connection, &xcb_shm_id);
        if (!shm_ext || !shm_ext->present) {
            fprintf(stderr, "X SHM extension not available\n");
            Cleanup();
            return;
        }

        shm_first_event = shm_ext->first_event;
        is_connected = true;
    }

    void Cleanup() {
        StopCaptureThread();
        if (shm_segment) {
            cleanup_shm(connection, shm_segment);
            shm_segment = nullptr;
        }
        {
            std::lock_guard<std::mutex> lock(buffer_mutex);
            buffer_a.reset();
            buffer_b.reset();
            readable_buffer_ptr = nullptr;
            writable_buffer_ptr = nullptr;
            frame_buffer_size = 0;
        }
        if (connection) {
            xcb_disconnect(connection);
            connection = nullptr;
        }
        is_connected = false;
        target_window_id = XCB_NONE;
    }

    bool EnsureBufferSizes(uint32_t width, uint32_t height) {
        if (!connection) return false;
        uint64_t required_shm_size = static_cast<uint64_t>(width) * height * 4;
        uint64_t required_frame_buffer_size = required_shm_size + IMAGE_HEADER_SIZE;

        if (!shm_segment || shm_segment->size < required_shm_size) {
            if (shm_segment) {
                cleanup_shm(connection, shm_segment);
            }
            shm_segment = init_shm(connection, required_shm_size);
            if (!shm_segment) {
                fprintf(stderr, "Error: Failed to initialize SHM segment.\n");
                return false;
            }
        }

        if (frame_buffer_size < required_frame_buffer_size) {
            std::lock_guard<std::mutex> lock(buffer_mutex);
            try {
                buffer_a.reset(new uint8_t[required_frame_buffer_size]);
                buffer_b.reset(new uint8_t[required_frame_buffer_size]);
            } catch (const std::bad_alloc& e) {
                fprintf(stderr, "Error: Failed to allocate frame buffers: %s\n", e.what());
                return false;
            }
            frame_buffer_size = required_frame_buffer_size;
            readable_buffer_ptr = buffer_a.get();
            writable_buffer_ptr = buffer_b.get();
        }
        return true;
    }

    // **MODIFICATION 3**: CaptureLoop() now uses the correct event-based synchronization
    void CaptureLoop() {
        is_capturing = true;

        while (should_capture) {
            auto loop_start_time = std::chrono::steady_clock::now();

            if (!connection || xcb_connection_has_error(connection)) {
                fprintf(stderr, "Capture thread: Connection error. Attempting to reconnect...\n");
                Connect();
                std::this_thread::sleep_for(std::chrono::seconds(1));
                continue;
            }

            xcb_get_geometry_cookie_t geom_cookie = xcb_get_geometry(connection, target_window_id);
            xcb_get_geometry_reply_t *geom_reply = xcb_get_geometry_reply(connection, geom_cookie, NULL);

            if (!geom_reply) {
                fprintf(stderr, "Capture thread: Failed to get geometry for window 0x%x. Retrying.\n", target_window_id);
                free(geom_reply);
                std::this_thread::sleep_for(std::chrono::milliseconds(500));
                continue;
            }

            uint32_t width = geom_reply->width;
            uint32_t height = geom_reply->height;
            free(geom_reply);

            if (width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION) {
                fprintf(stderr, "Capture thread: Invalid window dimensions: %ux%u.\n", width, height);
                std::this_thread::sleep_for(std::chrono::milliseconds(500));
                continue;
            }

            if (!EnsureBufferSizes(width, height)) {
                fprintf(stderr, "Capture thread: Failed to ensure buffer sizes. Retrying.\n");
                std::this_thread::sleep_for(std::chrono::seconds(1));
                continue;
            }

            // --- THIS ENTIRE BLOCK IS THE FIX ---
            const uint8_t shm_completion_type = shm_first_event + XCB_SHM_COMPLETION;
            bool a_frame_is_ready = false;

            // 1. Send request, but don't wait for the (useless) reply
            xcb_shm_get_image(
                connection, target_window_id, 0, 0, width, height, ~0,
                XCB_IMAGE_FORMAT_Z_PIXMAP, shm_segment->shmseg, 0);
            xcb_flush(connection);

            // 2. Wait for the actual COMPLETION event
            xcb_generic_event_t *event = nullptr;
            while ((event = xcb_wait_for_event(connection))) {
                if ((event->response_type & ~0x80) == shm_completion_type) {
                    xcb_shm_completion_event_t *completion_event = (xcb_shm_completion_event_t*)event;
                    if (completion_event->shmseg == shm_segment->shmseg) {
                        a_frame_is_ready = true;
                        free(event);
                        break;
                    }
                } else if (event->response_type == XCB_DESTROY_NOTIFY) {
                    xcb_destroy_notify_event_t *destroy_event = (xcb_destroy_notify_event_t*)event;
                    if (destroy_event->window == target_window_id) {
                        should_capture = false;
                        free(event);
                        break;
                    }
                }
                free(event);
            }
            if (!event || !should_capture) break;

            // 3. If frame is ready, perform the copy. This logic is IDENTICAL to your original.
            if (a_frame_is_ready) {
                uint8_t* bgra_data_from_shm = shm_segment->data;
                uint64_t bgra_data_size = static_cast<uint64_t>(width) * height * 4;

                memcpy(writable_buffer_ptr, &width, sizeof(uint32_t));
                memcpy(writable_buffer_ptr + 4, &height, sizeof(uint32_t));
                memcpy(writable_buffer_ptr + IMAGE_HEADER_SIZE, bgra_data_from_shm, bgra_data_size);

                uint64_t timestamp = std::chrono::duration_cast<std::chrono::microseconds>(
                    std::chrono::steady_clock::now().time_since_epoch()
                ).count();

                {
                    std::lock_guard<std::mutex> lock(buffer_mutex);
                    uint8_t* previously_readable = readable_buffer_ptr.exchange(writable_buffer_ptr);
                    writable_buffer_ptr = previously_readable;
                    latest_capture_timestamp_us = timestamp;
                    latest_width = width;
                    latest_height = height;
                }
            }

            // --- FPS Control (Identical to your original) ---
            auto loop_end_time = std::chrono::steady_clock::now();
            auto elapsed_time = std::chrono::duration_cast<std::chrono::microseconds>(loop_end_time - loop_start_time);
            if (elapsed_time < target_frame_time_us) {
                std::this_thread::sleep_for(target_frame_time_us - elapsed_time);
            }
        }
        is_capturing = false;
    }

    void StopCaptureThread() {
        should_capture = false;
        if (capture_thread.joinable()) {
            try {
                capture_thread.join();
            } catch (const std::system_error& e) {
                fprintf(stderr, "Error joining capture thread: %s\n", e.what());
            }
        }
        is_capturing = false;
    }

    // --- N-API Methods Implementation (Identical to your original) ---

    Napi::Value IsConnected(const Napi::CallbackInfo& info) {
        return Napi::Boolean::New(info.Env(), is_connected.load());
    }

    Napi::Value StartMonitorInstance(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (info.Length() < 1 || !info[0].IsNumber()) {
            Napi::TypeError::New(env, "Window ID (Number) expected").ThrowAsJavaScriptException();
            return env.Null();
        }
        uint32_t windowId = info[0].As<Napi::Number>().Uint32Value();
        uint32_t fps = (info.Length() > 1 && info[1].IsNumber()) ? info[1].As<Napi::Number>().Uint32Value() : DEFAULT_FPS;
        fps = std::max((uint32_t)MIN_FPS, std::min(fps, (uint32_t)MAX_FPS));

        if (is_capturing) {
            Napi::Error::New(env, "Monitoring is already running").ThrowAsJavaScriptException();
            return env.Null();
        }
        if (!is_connected) {
            Napi::Error::New(env, "Not connected to X server").ThrowAsJavaScriptException();
            return env.Null();
        }

        target_window_id = windowId;
        target_frame_time_us = std::chrono::microseconds(1000000 / fps);

        StopCaptureThread();
        should_capture = true;

        try {
            capture_thread = std::thread(&X11RegionCapture::CaptureLoop, this);
        } catch (const std::system_error& e) {
            should_capture = false;
            Napi::Error::New(env, std::string("Failed to create capture thread: ") + e.what()).ThrowAsJavaScriptException();
            return env.Null();
        }

        return env.Undefined();
    }

    Napi::Value StopMonitorInstance(const Napi::CallbackInfo& info) {
        StopCaptureThread();
        return info.Env().Undefined();
    }

    Napi::Value GetLatestFrame(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        Napi::Object result = Napi::Object::New(env);

        if (info.Length() < 1 || !info[0].IsBuffer()) {
            Napi::TypeError::New(env, "Expected a Buffer as the first argument").ThrowAsJavaScriptException();
            result.Set("success", Napi::Boolean::New(env, false));
            return result;
        }
        Napi::Buffer<uint8_t> targetBuffer = info[0].As<Napi::Buffer<uint8_t>>();

        uint8_t* source_ptr = readable_buffer_ptr.load();
        if (!source_ptr) {
            result.Set("success", Napi::Boolean::New(env, false));
            return result;
        }

        uint64_t source_size;
        uint64_t timestamp;
        uint32_t width, height;

        {
            std::lock_guard<std::mutex> lock(buffer_mutex);
            if (readable_buffer_ptr.load() != source_ptr) {
                 result.Set("success", Napi::Boolean::New(env, false));
                 return result;
            }
            source_size = static_cast<uint64_t>(latest_width) * latest_height * 4 + IMAGE_HEADER_SIZE;
            timestamp = latest_capture_timestamp_us;
            width = latest_width;
            height = latest_height;
        }

        if (targetBuffer.Length() < source_size) {
            fprintf(stderr, "JS buffer too small. Required: %lu, Provided: %zu\n", source_size, targetBuffer.Length());
            result.Set("success", Napi::Boolean::New(env, false));
            return result;
        }

        memcpy(targetBuffer.Data(), source_ptr, source_size);

        result.Set("success", Napi::Boolean::New(env, true));
        result.Set("width", Napi::Number::New(env, width));
        result.Set("height", Napi::Number::New(env, height));
        result.Set("captureTimestampUs", Napi::Number::New(env, static_cast<double>(timestamp)));

        return result;
    }
};

// --- Module Initialization ---
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    return X11RegionCapture::Init(env, exports);
}

NODE_API_MODULE(x11regioncapture, Init)