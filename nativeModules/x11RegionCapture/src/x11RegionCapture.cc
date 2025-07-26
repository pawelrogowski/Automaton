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
#include <vector>

// +++ ADDED FOR AVX +++
#ifdef __AVX2__
#include <immintrin.h> // Include for AVX2 intrinsics
#endif
// +++ END ADDED +++

// --- Shared Memory Handling (Identical to your original) ---
typedef struct {
    xcb_shm_seg_t shmseg;
    uint8_t *data;
    uint64_t size;
    int shmid;
} shm_segment_info_t;

void free_segment_info(shm_segment_info_t *segment) { if (segment) free(segment); }
void cleanup_shm(xcb_connection_t *connection, shm_segment_info_t *segment) {
    if (!segment) return;
    if (connection && segment->shmseg != XCB_NONE) xcb_shm_detach(connection, segment->shmseg);
    if (segment->data != nullptr && segment->data != (void*)-1) shmdt(segment->data);
    free_segment_info(segment);
}
shm_segment_info_t* init_shm(xcb_connection_t *connection, uint64_t requested_size) {
    uint64_t size = std::max(requested_size, static_cast<uint64_t>(4096));
    size = (size + 4095) & ~4095;
    shm_segment_info_t *segment = static_cast<shm_segment_info_t*>(malloc(sizeof(shm_segment_info_t)));
    if (!segment) { perror("Failed to allocate segment info"); return nullptr; }
    segment->data = nullptr; segment->shmseg = XCB_NONE; segment->shmid = -1; segment->size = 0;
    segment->shmid = shmget(IPC_PRIVATE, size, IPC_CREAT | 0600);
    if (segment->shmid == -1) { perror("shmget failed"); free_segment_info(segment); return nullptr; }
    segment->data = static_cast<uint8_t*>(shmat(segment->shmid, nullptr, 0));
    if (segment->data == reinterpret_cast<void*>(-1)) { perror("shmat failed"); shmctl(segment->shmid, IPC_RMID, nullptr); free_segment_info(segment); return nullptr; }
    if (shmctl(segment->shmid, IPC_RMID, nullptr) == -1) { perror("shmctl(IPC_RMID) failed"); shmdt(segment->data); free_segment_info(segment); return nullptr; }
    segment->shmseg = xcb_generate_id(connection);
    segment->size = size;
    xcb_void_cookie_t attach_cookie = xcb_shm_attach_checked(connection, segment->shmseg, segment->shmid, 0);
    xcb_generic_error_t *error = xcb_request_check(connection, attach_cookie);
    if (error) { fprintf(stderr, "XCB SHM attach failed: error code %d\n", error->error_code); free(error); shmdt(segment->data); free_segment_info(segment); return nullptr; }
    xcb_flush(connection);
    return segment;
}

// A simple struct to represent a rectangle
struct Rect {
    int x, y, width, height;
};

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
        connection = nullptr; shm_segment = nullptr; is_connected = false;
        should_capture = false; is_capturing = false; target_window_id = XCB_NONE;
        target_frame_time_us = std::chrono::microseconds(1000000 / 60);
        display_name = "";
        if (info.Length() > 0 && info[0].IsString()) display_name = info[0].As<Napi::String>().Utf8Value();
        readable_buffer_ptr = nullptr; writable_buffer_ptr = nullptr; frame_buffer_size = 0;
        latest_capture_timestamp_us = 0; latest_width = 0; latest_height = 0;
        Connect();
    }
    ~X11RegionCapture() { StopCaptureThread(); Cleanup(); }

private:
    static const int MAX_DIMENSION = 32767; static const int DEFAULT_FPS = 60;
    static const int MIN_FPS = 1; static const int MAX_FPS = 1000;
    static const size_t IMAGE_HEADER_SIZE = 8;
    xcb_connection_t *connection; shm_segment_info_t *shm_segment;
    std::atomic<bool> is_connected; std::atomic<bool> should_capture; std::atomic<bool> is_capturing;
    std::thread capture_thread; xcb_window_t target_window_id;
    std::chrono::microseconds target_frame_time_us; std::string display_name;
    std::unique_ptr<uint8_t[]> buffer_a; std::unique_ptr<uint8_t[]> buffer_b;
    std::atomic<uint8_t*> readable_buffer_ptr; uint8_t* writable_buffer_ptr;
    std::mutex buffer_mutex; uint64_t frame_buffer_size;
    uint64_t latest_capture_timestamp_us; uint32_t latest_width; uint32_t latest_height;
    std::vector<Rect> latest_dirty_rects;

    bool CheckSHM() {
        if (!connection) return false;
        const xcb_query_extension_reply_t* shm_ext = xcb_get_extension_data(connection, &xcb_shm_id);
        return shm_ext && shm_ext->present;
    }
    void Connect() {
        Cleanup(); int screen_num;
        connection = xcb_connect(display_name.empty() ? NULL : display_name.c_str(), &screen_num);
        if (!connection || xcb_connection_has_error(connection)) {
            if (connection) xcb_disconnect(connection);
            connection = nullptr; is_connected = false; return;
        }
        xcb_prefetch_extension_data(connection, &xcb_shm_id);
        if (!CheckSHM()) { Cleanup(); return; }
        is_connected = true;
    }

    void Cleanup() {
        StopCaptureThread();
        if (shm_segment) { cleanup_shm(connection, shm_segment); shm_segment = nullptr; }
        { std::lock_guard<std::mutex> lock(buffer_mutex); buffer_a.reset(); buffer_b.reset();
          readable_buffer_ptr = nullptr; writable_buffer_ptr = nullptr; frame_buffer_size = 0;
          latest_dirty_rects.clear();
        }
        if (connection) { xcb_disconnect(connection); connection = nullptr; }
        is_connected = false; target_window_id = XCB_NONE;
    }
    bool EnsureBufferSizes(uint32_t width, uint32_t height) {
        if (!connection) return false;
        uint64_t required_shm_size = static_cast<uint64_t>(width) * height * 4;
        uint64_t required_frame_buffer_size = required_shm_size + IMAGE_HEADER_SIZE;
        if (!shm_segment || shm_segment->size < required_shm_size) {
            if (shm_segment) cleanup_shm(connection, shm_segment);
            shm_segment = init_shm(connection, required_shm_size);
            if (!shm_segment) { fprintf(stderr, "Error: Failed to initialize SHM segment.\n"); return false; }
        }
        if (frame_buffer_size < required_frame_buffer_size) {
            std::lock_guard<std::mutex> lock(buffer_mutex);
            try {
                buffer_a.reset(new uint8_t[required_frame_buffer_size]);
                buffer_b.reset(new uint8_t[required_frame_buffer_size]);
            } catch (const std::bad_alloc& e) { fprintf(stderr, "Error: Failed to allocate frame buffers: %s\n", e.what()); return false; }
            frame_buffer_size = required_frame_buffer_size;
            readable_buffer_ptr = buffer_a.get(); writable_buffer_ptr = buffer_b.get();
            latest_dirty_rects.clear();
        }
        return true;
    }

    // --- START OF MODIFIED/NEW CODE ---

    // The original scalar implementation for fallback or non-AVX2 builds.
    void DiffFramesScalar(const uint8_t* prev_frame, const uint8_t* curr_frame, int width, int height) {
        // This is your original DiffFrames implementation, kept for compatibility.
        // (Code is identical to your provided version)
        latest_dirty_rects.clear();
        if (!prev_frame || !curr_frame) {
            latest_dirty_rects.push_back({0, 0, width, height});
            return;
        }
        const int stride = width * 4;
        std::vector<Rect> active_rects;
        for (int y = 0; y < height; ++y) {
            const uint8_t* p1_row = prev_frame + y * stride;
            const uint8_t* p2_row = curr_frame + y * stride;
            if (memcmp(p1_row, p2_row, stride) == 0) {
                for (const auto& rect : active_rects) { latest_dirty_rects.push_back(rect); }
                active_rects.clear();
                continue;
            }
            std::vector<Rect> new_active_rects;
            int x = 0;
            while (x < width) {
                const uint64_t* p1_64 = reinterpret_cast<const uint64_t*>(p1_row + x * 4);
                const uint64_t* p2_64 = reinterpret_cast<const uint64_t*>(p2_row + x * 4);
                int start_x = -1;
                while (x < width) {
                    if (x + 1 < width) {
                        if (*p1_64 != *p2_64) { start_x = x; break; }
                        p1_64++; p2_64++; x += 2;
                    } else {
                        if (*reinterpret_cast<const uint32_t*>(p1_64) != *reinterpret_cast<const uint32_t*>(p2_64)) { start_x = x; }
                        x++; break;
                    }
                }
                if (start_x == -1) break;
                int end_x = start_x;
                while (x < width) {
                    if (x + 1 < width) {
                        if (*p1_64 == *p2_64) { end_x = x; break; }
                        p1_64++; p2_64++; x += 2;
                    } else {
                        if (*reinterpret_cast<const uint32_t*>(p1_64) == *reinterpret_cast<const uint32_t*>(p2_64)) { end_x = x; } else { end_x = x + 1; }
                        x++; break;
                    }
                }
                if (end_x <= start_x) end_x = width;
                bool merged = false;
                for (auto it = active_rects.begin(); it != active_rects.end(); ) {
                    if (start_x < it->x + it->width && end_x > it->x) {
                        int new_x = std::min(start_x, it->x);
                        it->width = std::max(end_x, it->x + it->width) - new_x;
                        it->x = new_x; it->height++;
                        new_active_rects.push_back(*it);
                        it = active_rects.erase(it);
                        merged = true; break;
                    } else { ++it; }
                }
                if (!merged) { new_active_rects.push_back({start_x, y, end_x - start_x, 1}); }
                x = end_x;
            }
            for (const auto& rect : active_rects) { latest_dirty_rects.push_back(rect); }
            active_rects = new_active_rects;
        }
        for (const auto& rect : active_rects) { latest_dirty_rects.push_back(rect); }
    }

#ifdef __AVX2__
    // AVX2-optimized version of the diffing algorithm.
    void DiffFramesAVX2(const uint8_t* prev_frame, const uint8_t* curr_frame, int width, int height) {
        latest_dirty_rects.clear();
        if (!prev_frame || !curr_frame) {
            latest_dirty_rects.push_back({0, 0, width, height});
            return;
        }

        const int stride = width * 4;
        const int pixels_per_avx_chunk = 8; // 256 bits / 32 bits per pixel
        const int avx_width_limit = width - (width % pixels_per_avx_chunk);
        std::vector<Rect> active_rects;

        for (int y = 0; y < height; ++y) {
            const uint8_t* p1_row = prev_frame + y * stride;
            const uint8_t* p2_row = curr_frame + y * stride;

            // Quick check for the whole row (memcmp is highly optimized)
            if (memcmp(p1_row, p2_row, stride) == 0) {
                for (const auto& rect : active_rects) { latest_dirty_rects.push_back(rect); }
                active_rects.clear();
                continue;
            }

            std::vector<Rect> new_active_rects;
            int current_dirty_start_x = -1;

            // Process the row in 8-pixel (32-byte) chunks using AVX2
            for (int x = 0; x < avx_width_limit; x += pixels_per_avx_chunk) {
                const __m256i* p1_vec = reinterpret_cast<const __m256i*>(p1_row + x * 4);
                const __m256i* p2_vec = reinterpret_cast<const __m256i*>(p2_row + x * 4);

                __m256i v1 = _mm256_loadu_si256(p1_vec);
                __m256i v2 = _mm256_loadu_si256(p2_vec);
                __m256i cmp = _mm256_cmpeq_epi32(v1, v2); // Compare 8x32-bit integers
                int mask = _mm256_movemask_epi8(cmp);     // Create a mask from the result

                if (mask != 0xFFFFFFFF) { // 0xFFFFFFFF means all 8 pixels were identical
                    if (current_dirty_start_x == -1) {
                        current_dirty_start_x = x; // Start of a new dirty segment
                    }
                } else {
                    if (current_dirty_start_x != -1) {
                        // End of a dirty segment. Coalesce it.
                        int start_x = current_dirty_start_x;
                        int end_x = x;
                        // (Coalescing logic is inlined here for clarity)
                        bool merged = false;
                        for (auto it = active_rects.begin(); it != active_rects.end(); ) {
                            if (start_x < it->x + it->width && end_x > it->x) {
                                int new_x = std::min(start_x, it->x);
                                it->width = std::max(end_x, it->x + it->width) - new_x;
                                it->x = new_x; it->height++;
                                new_active_rects.push_back(*it);
                                it = active_rects.erase(it);
                                merged = true; break;
                            } else { ++it; }
                        }
                        if (!merged) { new_active_rects.push_back({start_x, y, end_x - start_x, 1}); }
                        current_dirty_start_x = -1;
                    }
                }
            }

            // Handle the remainder pixels (0 to 7) with scalar logic
            for (int x = avx_width_limit; x < width; ++x) {
                const uint32_t* p1_pixel = reinterpret_cast<const uint32_t*>(p1_row + x * 4);
                const uint32_t* p2_pixel = reinterpret_cast<const uint32_t*>(p2_row + x * 4);
                if (*p1_pixel != *p2_pixel) {
                    if (current_dirty_start_x == -1) {
                        current_dirty_start_x = x;
                    }
                } else {
                    if (current_dirty_start_x != -1) {
                        int start_x = current_dirty_start_x;
                        int end_x = x;
                        // (Coalescing logic)
                        bool merged = false;
                        for (auto it = active_rects.begin(); it != active_rects.end(); ) {
                            if (start_x < it->x + it->width && end_x > it->x) {
                                int new_x = std::min(start_x, it->x);
                                it->width = std::max(end_x, it->x + it->width) - new_x;
                                it->x = new_x; it->height++;
                                new_active_rects.push_back(*it);
                                it = active_rects.erase(it);
                                merged = true; break;
                            } else { ++it; }
                        }
                        if (!merged) { new_active_rects.push_back({start_x, y, end_x - start_x, 1}); }
                        current_dirty_start_x = -1;
                    }
                }
            }

            // If a dirty segment extends to the end of the row
            if (current_dirty_start_x != -1) {
                int start_x = current_dirty_start_x;
                int end_x = width;
                // (Coalescing logic)
                bool merged = false;
                for (auto it = active_rects.begin(); it != active_rects.end(); ) {
                    if (start_x < it->x + it->width && end_x > it->x) {
                        int new_x = std::min(start_x, it->x);
                        it->width = std::max(end_x, it->x + it->width) - new_x;
                        it->x = new_x; it->height++;
                        new_active_rects.push_back(*it);
                        it = active_rects.erase(it);
                        merged = true; break;
                    } else { ++it; }
                }
                if (!merged) { new_active_rects.push_back({start_x, y, end_x - start_x, 1}); }
            }

            // Finalize any old active rects that weren't merged
            for (const auto& rect : active_rects) {
                latest_dirty_rects.push_back(rect);
            }
            active_rects = new_active_rects;
        }

        // Add any remaining active rects from the last row
        for (const auto& rect : active_rects) {
            latest_dirty_rects.push_back(rect);
        }
    }
#endif

    // This function will dispatch to the best available implementation.
    void DiffFrames(const uint8_t* prev_frame, const uint8_t* curr_frame, int width, int height) {
#ifdef __AVX2__
        // If compiled with AVX2 support, use the optimized version.
        DiffFramesAVX2(prev_frame, curr_frame, width, height);
#else
        // Otherwise, fall back to the original scalar version.
        DiffFramesScalar(prev_frame, curr_frame, width, height);
#endif
    }

    // --- END OF MODIFIED/NEW CODE ---

    void CaptureLoop() {
        is_capturing = true;
        bool first_frame = true;

        while (should_capture) {
            auto loop_start_time = std::chrono::steady_clock::now();
            if (!connection || xcb_connection_has_error(connection)) { Connect(); std::this_thread::sleep_for(std::chrono::seconds(1)); continue; }
            xcb_get_geometry_cookie_t geom_cookie = xcb_get_geometry(connection, target_window_id);
            xcb_get_geometry_reply_t *geom_reply = xcb_get_geometry_reply(connection, geom_cookie, NULL);
            if (!geom_reply) { free(geom_reply); std::this_thread::sleep_for(std::chrono::milliseconds(500)); continue; }
            uint32_t width = geom_reply->width; uint32_t height = geom_reply->height; free(geom_reply);
            if (width < 1 || height < 1 || width > MAX_DIMENSION || height > MAX_DIMENSION) { std::this_thread::sleep_for(std::chrono::milliseconds(500)); continue; }

            bool dimensions_changed = (latest_width != width || latest_height != height);
            if (!EnsureBufferSizes(width, height)) { std::this_thread::sleep_for(std::chrono::seconds(1)); continue; }

            xcb_shm_get_image_cookie_t img_cookie = xcb_shm_get_image(
                connection, target_window_id, 0, 0, width, height, ~0,
                XCB_IMAGE_FORMAT_Z_PIXMAP, shm_segment->shmseg, 0);
            xcb_shm_get_image_reply_t *img_reply = xcb_shm_get_image_reply(connection, img_cookie, NULL);

            if (img_reply) {
                free(xcb_get_input_focus_reply(connection, xcb_get_input_focus(connection), NULL));

                uint8_t* bgra_data_from_shm = shm_segment->data;
                uint64_t bgra_data_size = static_cast<uint64_t>(width) * height * 4;
                memcpy(writable_buffer_ptr, &width, sizeof(uint32_t));
                memcpy(writable_buffer_ptr + 4, &height, sizeof(uint32_t));
                memcpy(writable_buffer_ptr + IMAGE_HEADER_SIZE, bgra_data_from_shm, bgra_data_size);
                uint64_t timestamp = std::chrono::duration_cast<std::chrono::microseconds>(std::chrono::steady_clock::now().time_since_epoch()).count();

                uint8_t* current_image_data = writable_buffer_ptr + IMAGE_HEADER_SIZE;
                uint8_t* previous_image_data = readable_buffer_ptr.load();
                if (previous_image_data) previous_image_data += IMAGE_HEADER_SIZE;

                if (first_frame || dimensions_changed) {
                    latest_dirty_rects.clear();
                    latest_dirty_rects.push_back({0, 0, (int)width, (int)height});
                    first_frame = false;
                } else {
                    // This now calls our dispatcher function
                    DiffFrames(previous_image_data, current_image_data, width, height);
                }

                {
                    std::lock_guard<std::mutex> lock(buffer_mutex);
                    uint8_t* previously_readable = readable_buffer_ptr.exchange(writable_buffer_ptr);
                    writable_buffer_ptr = previously_readable;
                    latest_capture_timestamp_us = timestamp; latest_width = width; latest_height = height;
                }
                free(img_reply);
            }
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
            try { capture_thread.join(); }
            catch (const std::system_error& e) { fprintf(stderr, "Error joining capture thread: %s\n", e.what()); }
        }
        is_capturing = false;
    }
    Napi::Value IsConnected(const Napi::CallbackInfo& info) { return Napi::Boolean::New(info.Env(), is_connected.load()); }
    Napi::Value StartMonitorInstance(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        if (info.Length() < 1 || !info[0].IsNumber()) { Napi::TypeError::New(env, "Window ID (Number) expected").ThrowAsJavaScriptException(); return env.Null(); }
        uint32_t windowId = info[0].As<Napi::Number>().Uint32Value();
        uint32_t fps = (info.Length() > 1 && info[1].IsNumber()) ? info[1].As<Napi::Number>().Uint32Value() : DEFAULT_FPS;
        fps = std::max((uint32_t)MIN_FPS, std::min(fps, (uint32_t)MAX_FPS));
        if (is_capturing) { Napi::Error::New(env, "Monitoring is already running").ThrowAsJavaScriptException(); return env.Null(); }
        if (!is_connected) { Napi::Error::New(env, "Not connected to X server").ThrowAsJavaScriptException(); return env.Null(); }
        target_window_id = windowId; target_frame_time_us = std::chrono::microseconds(1000000 / fps);
        StopCaptureThread(); should_capture = true;
        try { capture_thread = std::thread(&X11RegionCapture::CaptureLoop, this); }
        catch (const std::system_error& e) { should_capture = false; Napi::Error::New(env, std::string("Failed to create capture thread: ") + e.what()).ThrowAsJavaScriptException(); return env.Null(); }
        return env.Undefined();
    }
    Napi::Value StopMonitorInstance(const Napi::CallbackInfo& info) { StopCaptureThread(); return info.Env().Undefined(); }

    Napi::Value GetLatestFrame(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        Napi::Object result = Napi::Object::New(env);
        if (info.Length() < 1 || !info[0].IsBuffer()) { Napi::TypeError::New(env, "Expected a Buffer as the first argument").ThrowAsJavaScriptException(); result.Set("success", Napi::Boolean::New(env, false)); return result; }
        Napi::Buffer<uint8_t> targetBuffer = info[0].As<Napi::Buffer<uint8_t>>();
        uint8_t* source_ptr = readable_buffer_ptr.load();
        if (!source_ptr) { result.Set("success", Napi::Boolean::New(env, false)); return result; }

        uint64_t source_size; uint64_t timestamp; uint32_t width, height;
        Napi::Array changedRegions = Napi::Array::New(env);

        {
            std::lock_guard<std::mutex> lock(buffer_mutex);
            if (readable_buffer_ptr.load() != source_ptr) { result.Set("success", Napi::Boolean::New(env, false)); return result; }

            width = latest_width; height = latest_height;
            source_size = static_cast<uint64_t>(width) * height * 4 + IMAGE_HEADER_SIZE;
            timestamp = latest_capture_timestamp_us;

            if (targetBuffer.Length() < source_size) {
                result.Set("success", Napi::Boolean::New(env, false));
                result.Set("reason", Napi::String::New(env, "Target buffer too small."));
                return result;
            }

            memcpy(targetBuffer.Data(), source_ptr, source_size);

            for (size_t i = 0; i < latest_dirty_rects.size(); ++i) {
                const auto& rect = latest_dirty_rects[i];
                Napi::Object regionObj = Napi::Object::New(env);
                regionObj.Set("x", Napi::Number::New(env, rect.x));
                regionObj.Set("y", Napi::Number::New(env, rect.y));
                regionObj.Set("width", Napi::Number::New(env, rect.width));
                regionObj.Set("height", Napi::Number::New(env, rect.height));
                changedRegions[i] = regionObj;
            }
        }

        result.Set("success", Napi::Boolean::New(env, true));
        result.Set("width", Napi::Number::New(env, width));
        result.Set("height", Napi::Number::New(env, height));
        result.Set("captureTimestampUs", Napi::Number::New(env, static_cast<double>(timestamp)));
        result.Set("changedRegions", changedRegions);
        return result;
    }
};

Napi::Object Init(Napi::Env env, Napi::Object exports) { return X11RegionCapture::Init(env, exports); }
NODE_API_MODULE(x11regioncapture, Init)