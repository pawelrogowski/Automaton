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
#include <atomic>       // For std::atomic
#include <thread>       // For std::thread
#include <mutex>        // For std::mutex, std::lock_guard, std::unique_lock
#include <vector>       // For std::vector (image buffer)
#include <map>          // To store multiple regions
#include <string>       // For region names
#include <chrono>       // For FPS control and timestamps
#include <algorithm>    // For std::max
#include <system_error> // Required for std::system_error
#include <memory>       // For std::shared_ptr

#ifdef AVX2
#include <immintrin.h> // REQUIRED for AVX2 intrinsics
#endif

// --- Shared Memory Handling ---
// This segment will hold the FULL window capture data.

typedef struct {
    xcb_shm_seg_t shmseg;
    uint8_t *data;
    uint64_t size; // Use uint64_t for potentially large sizes
    int shmid;
} shm_segment_info_t;

// Helper to cleanup SHM segment info structure itself
void free_segment_info(shm_segment_info_t *segment) {
    if (segment) {
        free(segment);
    }
}

// Detaches, detaches mapping, and frees the segment info structure
void cleanup_shm(xcb_connection_t *connection, shm_segment_info_t *segment) {
    if (!segment) return;
    // Detach from X server first (if connection is valid)
    if (connection && segment->shmseg != XCB_NONE) {
        xcb_shm_detach(connection, segment->shmseg);
        // Note: shmctl(IPC_RMID) was called in init_shm after successful attach,
        // so the kernel will clean up the segment when the last process detaches
        // and the X server detaches. We only need to detach our mapping.
    }
    // Detach memory mapping
    if (segment->data != nullptr && segment->data != (void*)-1) {
        shmdt(segment->data);
    }
    // Free the tracking structure
    free_segment_info(segment);
}

// Initializes or reinitializes an SHM segment
shm_segment_info_t* init_shm(xcb_connection_t *connection, uint64_t requested_size) {
    // Ensure minimum size and alignment (page alignment)
    uint64_t size = requested_size; // Start with requested size
    // Add minimum size and align up to the next 4KB boundary
    size = std::max(size, static_cast<uint64_t>(4096)); // Ensure at least 4KB
    size = (size + 4095) & ~4095; // Align up to the next 4KB boundary

    // printf("Initializing SHM segment with size: %lu bytes\n", size);

    shm_segment_info_t *segment = static_cast<shm_segment_info_t*>(
        malloc(sizeof(shm_segment_info_t))
    );

    if (!segment) {
        perror("Failed to allocate segment info");
        return nullptr;
    }

    // Initialize all fields to safe values
    segment->data = nullptr;
    segment->shmseg = XCB_NONE;
    segment->shmid = -1;
    segment->size = 0; // Will be set upon successful init

    // Create shared memory segment
    segment->shmid = shmget(IPC_PRIVATE, size, IPC_CREAT | 0600); // More restricted permissions
    if (segment->shmid == -1) {
        perror("shmget failed");
        // No need to call shmctl(IPC_RMID, segment->shmid) here as shmget failed to create it
        free_segment_info(segment);
        return nullptr;
    }

    // printf("Created SHM segment with ID: %d\n", segment->shmid);

    // Attach the segment
    segment->data = static_cast<uint8_t*>(shmat(segment->shmid, nullptr, 0)); // SHM_RND removed, 0 is often fine
    if (segment->data == reinterpret_cast<void*>(-1)) {
        perror("shmat failed");
        // Clean up the segment if attach failed
        shmctl(segment->shmid, IPC_RMID, nullptr);
        free_segment_info(segment);
        return nullptr;
    }

    // printf("Successfully attached SHM segment at address: %p\n", (void*)segment->data);

    // Now that we've attached successfully, mark for deletion.
    // The segment will be destroyed when the last process detaches (us and the X server).
    if (shmctl(segment->shmid, IPC_RMID, nullptr) == -1) {
        perror("shmctl(IPC_RMID) failed");
        shmdt(segment->data); // Detach on failure
        free_segment_info(segment);
        return nullptr;
    }

    // Generate XCB segment ID
    segment->shmseg = xcb_generate_id(connection);
    segment->size = size; // Store the actual size allocated

    // Attach to X server
    xcb_void_cookie_t attach_cookie = xcb_shm_attach_checked(
        connection,
        segment->shmseg,
        segment->shmid,
        0  // read-only = false (server writes image data)
    );

    xcb_generic_error_t *error = xcb_request_check(connection, attach_cookie);
    if (error) {
        fprintf(stderr, "XCB SHM attach failed: error code %d\n", error->error_code);
        free(error);
        shmdt(segment->data); // Detach our mapping
        // IPC_RMID was already called, kernel will handle segment removal
        free_segment_info(segment);
        return nullptr;
    }

    // Ensure the attach request is processed by the server
    xcb_flush(connection);

    // printf("Successfully initialized SHM segment of size %lu bytes\n", size);
    return segment;
}

// --- Region Data Structure ---
// Renamed from MonitoredRegion to MonitoredRegionConfig for clarity (though original name kept in user code).
// Added shm_segment for direct region capture.
struct MonitoredRegion { // Renamed from MonitoredRegion to MonitoredRegionConfig in thoughts, but keeping original name for direct drop-in
    uint32_t winX;
    uint32_t winY;
    uint32_t width;
    uint32_t height;
    shm_segment_info_t *shm_segment; // NEW: Dedicated SHM segment for this specific region
    // Holds the latest processed RGB data for this region internally.
    std::unique_ptr<uint8_t[]> latestRgbDataBuffer; // NEW: Pre-allocated buffer for processed RGB data
    uint64_t latestRgbDataBufferSize; // NEW: Size of the allocated buffer
    std::atomic<bool> hasNewData; // Flag to signal new data for this specific region
    std::mutex dataMutex; // Mutex to protect latestRgbDataBuffer, latestRgbDataBufferSize, hasNewData, and captureTimestampUs
    uint64_t captureTimestampUs; // Timestamp (microseconds since epoch) of the capture

    // Constructor for emplace
    MonitoredRegion(uint32_t x, uint32_t y, uint32_t w, uint32_t h)
        : winX(x), winY(y), width(w), height(h), shm_segment(nullptr),
          latestRgbDataBuffer(nullptr), latestRgbDataBufferSize(0),
          hasNewData(false), captureTimestampUs(0)
    {}

    // Default constructor (needed if not using the parameterized one everywhere,
    // but emplace + parameterized constructor is preferred for map insertion)
    MonitoredRegion()
        : winX(0), winY(0), width(0), height(0), shm_segment(nullptr),
          latestRgbDataBuffer(nullptr), latestRgbDataBufferSize(0),
          hasNewData(false), captureTimestampUs(0)
    {}

    // MonitoredRegion is NOT Copyable or Assignable due to std::atomic and std::mutex
    // Explicitly delete copy/move constructors and assignment operators
    MonitoredRegion(const MonitoredRegion&) = delete;
    MonitoredRegion& operator=(const MonitoredRegion&) = delete;
    MonitoredRegion(MonitoredRegion&&) = delete; // Delete move constructor
    MonitoredRegion& operator=(MonitoredRegion&&) = delete; // Delete move assignment

    // Destructor will automatically clean up latestRgbDataBuffer via unique_ptr
    // SHM segment cleanup is handled by X11RegionCapture explicitly
    ~MonitoredRegion() = default;
};

// --- N-API Class ---

class X11RegionCapture : public Napi::ObjectWrap<X11RegionCapture> {
public:
    static Napi::Object Init(Napi::Env env, Napi::Object exports) {
        Napi::Function func = DefineClass(env, "X11RegionCapture", {
            // Define the required methods
            InstanceMethod("isConnected", &X11RegionCapture::IsConnected),
            InstanceMethod("addRegionToMonitor", &X11RegionCapture::AddRegionToMonitor),
            InstanceMethod("removeRegionToMonitor", &X11RegionCapture::RemoveRegionToMonitor),
            InstanceMethod("startMonitorInstance", &X11RegionCapture::StartMonitorInstance),
            InstanceMethod("stopMonitorInstance", &X11RegionCapture::StopMonitorInstance),
            // These methods now copy data into a JS-provided buffer
            InstanceMethod("getRegionRgbData", &X11RegionCapture::CopyRegionDataIntoBuffer),
            InstanceMethod("getFullWindowImageData", &X11RegionCapture::CopyFullWindowDataIntoBuffer),

            // Keep the original addRegion placeholder name for compatibility with the test file for now
            InstanceMethod("addRegion", &X11RegionCapture::AddRegionToMonitor)
        });

        Napi::FunctionReference* constructor = new Napi::FunctionReference();
        *constructor = Napi::Persistent(func);
        env.SetInstanceData(constructor);

        exports.Set("X11RegionCapture", func);
        return exports;
    }

    X11RegionCapture(const Napi::CallbackInfo& info) : Napi::ObjectWrap<X11RegionCapture>(info) {
        connection = nullptr;
        full_window_segment = nullptr; // SHM for the full window capture
        is_connected = false; // Atomic flag for connection status
        should_capture = false; // Flag to control capture thread
        is_capturing = false;   // Flag indicating if thread is active
        target_window_id = XCB_NONE; // Store the window ID
        // monitored_regions is empty by default
        target_frame_time_us = std::chrono::microseconds(1000000 / 60); // Default 60 FPS
        // Initialize new full frame data members
        latestFullFrameRgbDataTimestampUs = 0;
        hasNewFullFrame = false;
        full_window_capture_pending = false; // NEW: Initialize flag

        Connect(); // Attempt to connect on instantiation
    }

    ~X11RegionCapture() {
        StopCaptureThread(); // Ensure thread is stopped and joined
        Cleanup(); // Clean up resources
    }

private:
    // Constants
    static const int MAX_DIMENSION = 32767; // Sanity check for dimensions
    static const int DEFAULT_FPS = 60;
    static const int MIN_FPS = 1;
    static const int MAX_FPS = 1000;
    static const size_t IMAGE_HEADER_SIZE = 8; // 4 bytes width, 4 bytes height

    // Member Variables
    xcb_connection_t *connection;
    shm_segment_info_t *full_window_segment; // SHM segment for the full window
    std::atomic<bool> is_connected;
    std::atomic<bool> should_capture; // Controls the capture thread loop
    std::atomic<bool> is_capturing;   // Indicates if the capture thread is running
    std::thread capture_thread;       // The background capture thread
    xcb_window_t target_window_id;    // The ID of the window being monitored

    std::mutex regions_mutex; // Protects the map of monitored regions
    std::map<std::string, MonitoredRegion> monitored_regions; // MonitoredRegion struct now contains SHM segment for itself

    // Data for the latest full window frame (processed RGB + header)
    std::unique_ptr<uint8_t[]> latestFullFrameRgbDataBuffer; // NEW: Pre-allocated buffer for processed RGB data
    uint64_t latestFullFrameRgbDataBufferSize; // NEW: Size of the allocated buffer
    uint64_t latestFullFrameRgbDataTimestampUs; // Timestamp of this full frame data
    std::atomic<bool> hasNewFullFrame; // Flag for new full frame data
    std::mutex fullFrameMutex; // Mutex to protect latestFullFrameRgbDataBuffer, latestFullFrameRgbDataBufferSize, timestamp, and hasNewFullFrame
    std::atomic<bool> full_window_capture_pending; // NEW: Flag to signal a one-off full window capture request

    // For FPS control of the main window capture
    std::mutex fps_mutex;
    std::chrono::microseconds target_frame_time_us;


    // --- Core X11 Logic ---

    // Check if SHM extension is available
    bool CheckSHM() {
        if (!connection) return false;
        const xcb_query_extension_reply_t* shm_ext = xcb_get_extension_data(connection, &xcb_shm_id);
        if (!shm_ext || !shm_ext->present) {
            fprintf(stderr, "XCB SHM extension not available.\n");
            return false;
        }
        // printf("XCB SHM extension is available.\n");
        return true;
    }

    void Connect() {
        Cleanup(); // Ensure clean state before connecting

        int screen_num;
        connection = xcb_connect(NULL, &screen_num); // Connect to default display

        if (!connection || xcb_connection_has_error(connection)) {
            fprintf(stderr, "Failed to connect to X server.\n");
            if (connection) xcb_disconnect(connection); // Disconnect if partially connected
            connection = nullptr;
            is_connected = false;
            return;
        }

        // Prefetch SHM extension data
        xcb_prefetch_extension_data(connection, &xcb_shm_id);

        if (!CheckSHM()) {
            Cleanup(); // Clean up connection if SHM is not available
            return;
        }

        // printf("X11RegionCapture: Connected to X server and SHM is available.\n");
        is_connected = true;
    }

    void Cleanup() {
        // Stop thread first if running
        StopCaptureThread();

        // Clean up the full window SHM segment
        if (full_window_segment) {
            cleanup_shm(connection, full_window_segment); // Pass connection if it's valid
            full_window_segment = nullptr;
            // printf("X11RegionCapture: Cleaned up main SHM segment.\n");
        }

        // Clear latest full frame data (reset unique_ptr)
        {
            std::lock_guard<std::mutex> lock(fullFrameMutex);
            latestFullFrameRgbDataBuffer.reset(); // Release the unique_ptr
            latestFullFrameRgbDataBufferSize = 0;
            latestFullFrameRgbDataTimestampUs = 0; // Reset timestamp
            hasNewFullFrame = false;
            full_window_capture_pending = false; // NEW: Reset the pending flag
        }


        // Clear all monitored regions (reset unique_ptr for each and clean up their SHM)
        {
            std::lock_guard<std::mutex> lock(regions_mutex);
            for (auto& pair : monitored_regions) {
                // Lock the specific region's mutex before resetting its unique_ptr
                std::lock_guard<std::mutex> data_lock(pair.second.dataMutex);
                pair.second.latestRgbDataBuffer.reset(); // Release the unique_ptr
                pair.second.latestRgbDataBufferSize = 0;
                pair.second.captureTimestampUs = 0; // Reset timestamp
                pair.second.hasNewData = false;

                // NEW: Clean up region's SHM segment
                if (pair.second.shm_segment) {
                    cleanup_shm(connection, pair.second.shm_segment);
                    pair.second.shm_segment = nullptr;
                }
            }
            monitored_regions.clear();
        }

        // Disconnect from X server
        if (connection) {
            xcb_disconnect(connection);
            connection = nullptr;
            // printf("X11RegionCapture: Disconnected from X server.\n");
        }
        is_connected = false; // Set flag to false
        target_window_id = XCB_NONE; // Reset window ID
    }

    // Attempts to reconnect to the X server. Returns true on success, false otherwise.
    bool TryReconnect() {
        printf("X11RegionCapture: Attempting to reconnect to X server...\n");
        Connect(); // Connect calls Cleanup internally first
        return (connection != nullptr && !xcb_connection_has_error(connection));
    }

    // Ensures SHM segment exists and is large enough for the given dimensions
    // This applies to the *full window* segment.
    bool EnsureFullWindowSHMSize(uint32_t width, uint32_t height) {
        if (!connection) return false; // Cannot proceed without connection

        uint64_t required_size = static_cast<uint64_t>(width) * static_cast<uint64_t>(height) * 4; // BGRA format

        if (!full_window_segment || full_window_segment->size < required_size) {
            /* printf("SHM segment invalid or too small (req: %lu, has: %lu). Re-initializing...\n",
                   required_size, full_window_segment ? full_window_segment->size : 0);
            */
            // Clean up the old segment if it exists
            if (full_window_segment) {
                cleanup_shm(connection, full_window_segment);
                full_window_segment = nullptr;
            }

            // Initialize a new one with the required size
            full_window_segment = init_shm(connection, required_size);
            if (!full_window_segment) {
                fprintf(stderr, "X11RegionCapture: Failed to initialize full window SHM segment.\n");
                // Attempt to reconnect if SHM init fails, might be connection issue
                TryReconnect();
                return false; // Indicate failure after trying
            }
        }
        // If segment exists and size is sufficient, we're good
        return true;
    }

    // NEW: Ensures SHM segment exists and is large enough for a *specific region*
    bool EnsureRegionSHMSize(MonitoredRegion& region_info, uint32_t width, uint32_t height) {
        if (!connection) return false;
        uint64_t required_size = static_cast<uint64_t>(width) * height * 4; // BGRA format

        if (!region_info.shm_segment || region_info.shm_segment->size < required_size) {
            // printf("Region SHM segment invalid or too small (req: %lu, has: %lu). Re-initializing...\n",
            //        required_size, region_info.shm_segment ? region_info.shm_segment->size : 0);

            if (region_info.shm_segment) {
                cleanup_shm(connection, region_info.shm_segment);
                region_info.shm_segment = nullptr;
            }
            region_info.shm_segment = init_shm(connection, required_size);
            if (!region_info.shm_segment) {
                fprintf(stderr, "X11RegionCapture: Failed to initialize SHM segment for region.\n");
                return false;
            }
        }
        return true;
    }


#ifdef AVX2
    // Function to convert 8 BGRA pixels (32 bytes) to 8 RGB pixels (24 bytes) using AVX2
    // This version correctly handles the packing to 24 bytes without buffer overflows.
    // It relies on _mm_shuffle_epi8 generating 12 valid bytes followed by 4 junk bytes
    // in each 128-bit lane, and then explicitly stores only the 12 valid bytes.
    static inline void bgra_to_rgb_avx2_8pixels(const uint8_t* src_bgra, uint8_t* dst_rgb) {
        // Load 8 BGRA pixels (32 bytes) into a 256-bit AVX2 register.
        __m256i bgra_pixels = _mm256_loadu_si256((const __m256i*)src_bgra);

        // Define the shuffle mask for a 16-byte lane (4 BGRA pixels).
        // This mask reorders bytes from BGRA to RGB (B,G,R,A -> R,G,B,X), effectively dropping A.
        // The indices are into the 16-byte source lane (0-15).
        // For each 4-byte pixel (B,G,R,A) at index 'i': R is at 'i+2', G at 'i+1', B at 'i'.
        // So for 4 pixels, (0,1,2,3), (4,5,6,7), (8,9,10,11), (12,13,14,15),
        // we want (2,1,0), (6,5,4), (10,9,8), (14,13,12).
        // Indices greater than 15 (e.g., 0x80 or -1) will result in a zero in the corresponding output byte.
        // We use -1 here, which is often preferred for readability and consistent zeroing behavior.
        const __m128i kShuffleMask = _mm_setr_epi8(
            2, 1, 0,    // R0 G0 B0
            6, 5, 4,    // R1 G1 B1
            10, 9, 8,   // R2 G2 B2
            14, 13, 12, // R3 G3 B3
            -1, -1, -1, -1 // Fill remaining 4 bytes of 16-byte lane with zeros
        );

        // Apply the shuffle mask to both 128-bit lanes of the 256-bit register.
        // `_mm256_set_m128i` creates a 256-bit mask by placing `kShuffleMask` in both high and low 128-bit lanes.
        __m256i shuffled = _mm256_shuffle_epi8(bgra_pixels, _mm256_set_m128i(kShuffleMask, kShuffleMask));

        // Extract the two 128-bit lanes from the shuffled 256-bit result.
        __m128i low_lane_rgb = _mm256_castsi256_si128(shuffled);  // Contains R0..R3 G0..G3 B0..B3 + zeros
        __m128i high_lane_rgb = _mm256_extracti128_si256(shuffled, 1); // Contains R4..R7 G4..G7 B4..B7 + zeros

        // Store the first 12 bytes from `low_lane_rgb` (for pixels P0-P3)
        // Store first 8 bytes (2 pixels) using `_mm_storeu_si64`.
        _mm_storeu_si64((__m128i*)dst_rgb, low_lane_rgb);
        // Store next 4 bytes (1 pixel) using `_mm_extract_epi32` and `_mm_storeu_si32`.
        // `_mm_extract_epi32(reg, 2)` extracts the third 32-bit integer (bytes at index 8,9,10,11).
        // Corrected: Convert the 'int' return value to '__m128i' using _mm_cvtsi32_si128
        _mm_storeu_si32((uint32_t*)(dst_rgb + 8), _mm_cvtsi32_si128(_mm_extract_epi32(low_lane_rgb, 2)));

        // Store the first 12 bytes from `high_lane_rgb` (for pixels P4-P7)
        // Store first 8 bytes (2 pixels) to `dst_rgb + 12`.
        _mm_storeu_si64((__m128i*)(dst_rgb + 12), high_lane_rgb);
        // Store next 4 bytes (1 pixel) to `dst_rgb + 20`.
        // Corrected: Convert the 'int' return value to '__m128i' using _mm_cvtsi32_si128
        _mm_storeu_si32((uint32_t*)(dst_rgb + 20), _mm_cvtsi32_si128(_mm_extract_epi32(high_lane_rgb, 2)));
    }
#endif // AVX2

    // Helper function to convert BGRA data to RGB and add header.
    // Writes directly into a provided destination buffer.
    // Returns true on success, false on failure (e.g., buffer too small).
    bool ProcessImageData(
        const uint8_t* src_data, uint32_t width, uint32_t height, uint64_t src_stride,
        uint8_t* dst_buffer, uint64_t dst_capacity)
    {
        uint64_t rgb_data_size = static_cast<uint64_t>(width) * height * 3;
        uint64_t total_buffer_size = IMAGE_HEADER_SIZE + rgb_data_size;

        // Check if source data is available and dimensions are valid
        if (!src_data || width == 0 || height == 0 || src_stride < static_cast<uint64_t>(width) * 4) {
            fprintf(stderr, "X11RegionCapture ProcessImageData: Invalid input data/dimensions (w=%u, h=%u, stride=%lu). Returning false.\n", width, height, src_stride);
            return false;
        }

        // Check if destination buffer is large enough
        if (dst_capacity < total_buffer_size) {
            fprintf(stderr, "X11RegionCapture ProcessImageData: Destination buffer too small. Required: %lu, Has: %lu. Returning false.\n", total_buffer_size, dst_capacity);
            return false;
        }

        uint8_t* dst_ptr = dst_buffer;

        // --- Write Header (Little Endian) ---
        // Width
        dst_ptr[0] = static_cast<uint8_t>(width & 0xFF);
        dst_ptr[1] = static_cast<uint8_t>((width >> 8) & 0xFF);
        dst_ptr[2] = static_cast<uint8_t>((width >> 16) & 0xFF);
        dst_ptr[3] = static_cast<uint8_t>((width >> 24) & 0xFF);
        // Height
        dst_ptr[4] = static_cast<uint8_t>(height & 0xFF);
        dst_ptr[5] = static_cast<uint8_t>((height >> 8) & 0xFF);
        dst_ptr[6] = static_cast<uint8_t>((height >> 16) & 0xFF);
        dst_ptr[7] = static_cast<uint8_t>((height >> 24) & 0xFF);

        // --- Convert and Copy RGB data ---
        uint8_t* rgb_start = dst_ptr + IMAGE_HEADER_SIZE;
        uint64_t dst_stride = static_cast<uint64_t>(width) * 3; // Bytes per row in RGB

        for (uint32_t y = 0; y < height; ++y) {
            const uint8_t* row_src = src_data + (static_cast<uint64_t>(y) * src_stride);
            uint8_t* row_dst = rgb_start + (static_cast<uint64_t>(y) * dst_stride);

            uint32_t x = 0;
#ifdef AVX2
            // Process 8 pixels at a time using AVX2 SIMD
            for (; x + 7 < width; x += 8) {
                bgra_to_rgb_avx2_8pixels(row_src + x * 4, row_dst + x * 3);
            }
#endif
            // Scalar fallback for remaining pixels (0 to 7 pixels or if AVX2 is not enabled)
            for (; x < width; ++x) {
                uint64_t src_pixel_offset = static_cast<uint64_t>(x) * 4; // BGRA
                uint64_t dst_pixel_offset = static_cast<uint64_t>(x) * 3; // RGB

                row_dst[dst_pixel_offset + 0] = row_src[src_pixel_offset + 2]; // R (BGRA is Blue, Green, Red, Alpha)
                row_dst[dst_pixel_offset + 1] = row_src[src_pixel_offset + 1]; // G
                row_dst[dst_pixel_offset + 2] = row_src[src_pixel_offset + 0]; // B
            }
        }
        return true; // Indicate success
    }


    // The main capture thread function
    void CaptureLoop() {
        is_capturing = true;

        // printf("X11RegionCapture: Capture thread started for window 0x%x.\n", target_window_id);

        while (should_capture) {
            auto loop_start_time = std::chrono::steady_clock::now(); // For FPS control

            // --- Connection Check ---
            if (!connection || xcb_connection_has_error(connection)) {
                fprintf(stderr, "X11RegionCapture Capture thread: Connection error detected.\n");
                if (!TryReconnect()) {
                    fprintf(stderr, "X11RegionCapture Capture thread: Reconnect failed. Sleeping before retry...\n");
                    std::this_thread::sleep_for(std::chrono::seconds(1));
                    continue; // Try again in the next loop iteration
                }

                // printf("X11RegionCapture Capture thread: Reconnect successful.\n");
                // Reset last known dimensions to force SHM check after reconnect
                // After reconnect, invalidate all data (full frame and regions)
                {
                    std::lock_guard<std::mutex> lock(fullFrameMutex);
                    latestFullFrameRgbDataBuffer.reset(); // Reset unique_ptr
                    latestFullFrameRgbDataBufferSize = 0;
                    latestFullFrameRgbDataTimestampUs = 0;
                    hasNewFullFrame = false;
                    full_window_capture_pending = false; // Reset the pending flag
                }
                {
                    std::lock_guard<std::mutex> regions_lock(regions_mutex);
                    for (auto& pair : monitored_regions) {
                        std::lock_guard<std::mutex> data_lock(pair.second.dataMutex);
                        pair.second.latestRgbDataBuffer.reset(); // Reset unique_ptr
                        pair.second.latestRgbDataBufferSize = 0;
                        pair.second.captureTimestampUs = 0;
                        pair.second.hasNewData = false;
                        // NEW: Clean up region's SHM segment on global reconnect as well
                        if (pair.second.shm_segment) {
                            cleanup_shm(connection, pair.second.shm_segment);
                            pair.second.shm_segment = nullptr;
                        }
                    }
                }
            }

            // --- Get Window Geometry ---
            xcb_get_geometry_cookie_t geom_cookie = xcb_get_geometry(connection, target_window_id);
            xcb_get_geometry_reply_t *geom_reply = xcb_get_geometry_reply(connection, geom_cookie, NULL);

            if (!geom_reply) {
                int conn_error = xcb_connection_has_error(connection);
                if (conn_error) {
                    fprintf(stderr, "X11RegionCapture Capture thread: Failed to get geometry due to connection error %d. Will attempt reconnect.\n", conn_error);
                } else {
                    fprintf(stderr, "X11RegionCapture Capture thread: Failed to get geometry for window 0x%x (is window valid?). Retrying shortly.\n", target_window_id);
                    std::this_thread::sleep_for(std::chrono::milliseconds(200));
                }
                if (geom_reply) free(geom_reply);
                // On geometry error, invalidate all data (full frame and regions)
                {
                    std::lock_guard<std::mutex> lock(fullFrameMutex);
                    latestFullFrameRgbDataBuffer.reset();
                    latestFullFrameRgbDataBufferSize = 0;
                    latestFullFrameRgbDataTimestampUs = 0;
                    hasNewFullFrame = false;
                    full_window_capture_pending = false;
                }
                {
                    std::lock_guard<std::mutex> regions_lock(regions_mutex);
                    for (auto& pair : monitored_regions) {
                        std::lock_guard<std::mutex> data_lock(pair.second.dataMutex);
                        pair.second.latestRgbDataBuffer.reset();
                        pair.second.latestRgbDataBufferSize = 0;
                        pair.second.captureTimestampUs = 0;
                        pair.second.hasNewData = false;
                        if (pair.second.shm_segment) { // Clean up region's SHM
                            cleanup_shm(connection, pair.second.shm_segment);
                            pair.second.shm_segment = nullptr;
                        }
                    }
                }
                continue; // Skip to next iteration
            }

            uint32_t current_width = geom_reply->width;
            uint32_t current_height = geom_reply->height;
            free(geom_reply); // Free reply memory

            // --- Basic Validation ---
            if (current_width < 1 || current_height < 1 || current_width > MAX_DIMENSION || current_height > MAX_DIMENSION) {
                fprintf(stderr, "X11RegionCapture Capture thread: Invalid window dimensions: %ux%u. Skipping frame.\n", current_width, current_height);
                std::this_thread::sleep_for(std::chrono::milliseconds(100)); // Avoid spamming logs
                // On invalid dimensions, invalidate all data (full frame and regions)
                {
                    std::lock_guard<std::mutex> lock(fullFrameMutex);
                    latestFullFrameRgbDataBuffer.reset();
                    latestFullFrameRgbDataBufferSize = 0;
                    latestFullFrameRgbDataTimestampUs = 0;
                    hasNewFullFrame = false;
                    full_window_capture_pending = false;
                }
                {
                    std::lock_guard<std::mutex> regions_lock(regions_mutex);
                    for (auto& pair : monitored_regions) {
                        std::lock_guard<std::mutex> data_lock(pair.second.dataMutex);
                        pair.second.latestRgbDataBuffer.reset();
                        pair.second.latestRgbDataBufferSize = 0;
                        pair.second.captureTimestampUs = 0;
                        pair.second.hasNewData = false;
                        if (pair.second.shm_segment) {
                            cleanup_shm(connection, pair.second.shm_segment);
                            pair.second.shm_segment = nullptr;
                        }
                    }
                }
                continue;
            }

            // --- Conditional Full Window Capture ---
            // This is triggered only when JS explicitly calls getFullWindowImageData
            if (full_window_capture_pending.load()) {
                // Ensure full_window_segment is sized
                if (!EnsureFullWindowSHMSize(current_width, current_height)) {
                    fprintf(stderr, "X11RegionCapture Capture thread: Failed to ensure SHM size for full window. Will try again.\n");
                    full_window_capture_pending = false; // Reset flag so it can be re-requested
                    // Invalidate full frame data
                    {
                        std::lock_guard<std::mutex> lock(fullFrameMutex);
                        latestFullFrameRgbDataBuffer.reset();
                        latestFullFrameRgbDataBufferSize = 0;
                        latestFullFrameRgbDataTimestampUs = 0;
                        hasNewFullFrame = false;
                    }
                } else {
                    xcb_shm_get_image_cookie_t img_cookie = xcb_shm_get_image(
                        connection, target_window_id, 0, 0, current_width, current_height, ~0,
                        XCB_IMAGE_FORMAT_Z_PIXMAP, full_window_segment->shmseg, 0);

                    xcb_generic_error_t *error = nullptr;
                    xcb_shm_get_image_reply_t *img_reply = xcb_shm_get_image_reply(connection, img_cookie, &error);

                    if (error) {
                        fprintf(stderr, "X11RegionCapture Capture thread: xcb_shm_get_image_reply for full window failed: %d\n", error->error_code);
                        free(error);
                        // Invalidate full frame data
                        {
                            std::lock_guard<std::mutex> lock(fullFrameMutex);
                            latestFullFrameRgbDataBuffer.reset();
                            latestFullFrameRgbDataBufferSize = 0;
                            latestFullFrameRgbDataTimestampUs = 0;
                            hasNewFullFrame = false;
                        }
                    } else if (img_reply) {
                        uint8_t* full_bgra_data = full_window_segment->data;
                        uint64_t full_window_stride = static_cast<uint64_t>(current_width) * 4;
                        uint64_t required_rgb_size = static_cast<uint64_t>(current_width) * current_height * 3 + IMAGE_HEADER_SIZE;

                        // Ensure the destination buffer is large enough
                        {
                            std::lock_guard<std::mutex> lock(fullFrameMutex);
                            if (!latestFullFrameRgbDataBuffer || latestFullFrameRgbDataBufferSize < required_rgb_size) {
                                latestFullFrameRgbDataBuffer.reset(new (std::nothrow) uint8_t[required_rgb_size]);
                                if (!latestFullFrameRgbDataBuffer) {
                                    fprintf(stderr, "X11RegionCapture Capture thread: Failed to allocate full window RGB buffer of size %lu.\n", required_rgb_size);
                                    latestFullFrameRgbDataBufferSize = 0;
                                    latestFullFrameRgbDataTimestampUs = 0;
                                    hasNewFullFrame = false;
                                    free(img_reply);
                                    full_window_capture_pending = false;
                                    continue; // Skip to next iteration
                                }
                                latestFullFrameRgbDataBufferSize = required_rgb_size;
                            }
                        }

                        auto capture_time_point = std::chrono::steady_clock::now();
                        uint64_t capture_timestamp_us = std::chrono::duration_cast<std::chrono::microseconds>(
                            capture_time_point.time_since_epoch()
                        ).count();

                        bool processed_success = false;
                        {
                            std::lock_guard<std::mutex> lock(fullFrameMutex);
                            processed_success = ProcessImageData(
                                full_bgra_data, current_width, current_height, full_window_stride,
                                latestFullFrameRgbDataBuffer.get(), latestFullFrameRgbDataBufferSize);
                        }

                        {
                            std::lock_guard<std::mutex> lock(fullFrameMutex);
                            if (processed_success) {
                                latestFullFrameRgbDataTimestampUs = capture_timestamp_us;
                                hasNewFullFrame = true;
                            } else {
                                latestFullFrameRgbDataBuffer.reset(); // Clear buffer on processing failure
                                latestFullFrameRgbDataBufferSize = 0;
                                latestFullFrameRgbDataTimestampUs = 0;
                                hasNewFullFrame = false;
                            }
                        }
                        free(img_reply);
                    }
                    full_window_capture_pending = false; // Reset flag after attempt
                }
            }


            // --- Capture and Process EACH Monitored Region Directly ---
            { // Scope for regions_mutex
                std::lock_guard<std::mutex> regions_lock(regions_mutex);
                for (auto& pair : monitored_regions) { // Use reference to modify the region struct
                    const std::string& region_name = pair.first;
                    MonitoredRegion& region_config = pair.second;

                    // Check region bounds against current window dimensions
                    if (region_config.winX + region_config.width > current_width ||
                        region_config.winY + region_config.height > current_height ||
                        region_config.width == 0 || region_config.height == 0)
                    {
                        // Region out of bounds or invalid, clear its data
                        std::lock_guard<std::mutex> data_lock(region_config.dataMutex);
                        region_config.latestRgbDataBuffer.reset();
                        region_config.latestRgbDataBufferSize = 0;
                        region_config.captureTimestampUs = 0;
                        region_config.hasNewData = false;
                        if (region_config.shm_segment) { // Also clean its SHM
                            cleanup_shm(connection, region_config.shm_segment);
                            region_config.shm_segment = nullptr;
                        }
                        fprintf(stderr, "X11RegionCapture Capture thread: Region '%s' (%u,%u %ux%u) is out of window bounds (%ux%u). Data cleared.\n",
                                region_name.c_str(), region_config.winX, region_config.winY, region_config.width, region_config.height,
                                current_width, current_height);
                        continue; // Skip to next region
                    }

                    // Ensure SHM segment for this specific region is large enough
                    if (!EnsureRegionSHMSize(region_config, region_config.width, region_config.height)) {
                        fprintf(stderr, "X11RegionCapture Capture thread: Failed to ensure SHM size for region '%s'. Skipping.\n", region_name.c_str());
                        // Invalidate region data on SHM failure
                        std::lock_guard<std::mutex> data_lock(region_config.dataMutex);
                        region_config.latestRgbDataBuffer.reset();
                        region_config.latestRgbDataBufferSize = 0;
                        region_config.captureTimestampUs = 0;
                        region_config.hasNewData = false;
                        continue; // Skip to next region
                    }

                    uint64_t required_rgb_size = static_cast<uint64_t>(region_config.width) * region_config.height * 3 + IMAGE_HEADER_SIZE;
                    // Ensure the destination buffer for this region is large enough
                    {
                        std::lock_guard<std::mutex> data_lock(region_config.dataMutex);
                        if (!region_config.latestRgbDataBuffer || region_config.latestRgbDataBufferSize < required_rgb_size) {
                            region_config.latestRgbDataBuffer.reset(new (std::nothrow) uint8_t[required_rgb_size]);
                            if (!region_config.latestRgbDataBuffer) {
                                fprintf(stderr, "X11RegionCapture Capture thread: Failed to allocate RGB buffer for region '%s' of size %lu.\n", region_name.c_str(), required_rgb_size);
                                region_config.latestRgbDataBufferSize = 0;
                                region_config.captureTimestampUs = 0;
                                region_config.hasNewData = false;
                                continue; // Skip to next region
                            }
                            region_config.latestRgbDataBufferSize = required_rgb_size;
                        }
                    }

                    // Perform direct capture for THIS region
                    xcb_shm_get_image_cookie_t region_img_cookie = xcb_shm_get_image(
                        connection, target_window_id,
                        region_config.winX, region_config.winY, // x, y relative to window
                        region_config.width, region_config.height,
                        ~0, XCB_IMAGE_FORMAT_Z_PIXMAP,
                        region_config.shm_segment->shmseg, 0
                    );

                    xcb_generic_error_t *region_error = nullptr; // Corrected variable name from &region_error
                    xcb_shm_get_image_reply_t *region_img_reply = xcb_shm_get_image_reply(
                        connection, region_img_cookie, &region_error
                    );

                    if (region_error) {
                        fprintf(stderr, "X11RegionCapture Capture thread: xcb_shm_get_image_reply for region '%s' failed: %d\n", region_name.c_str(), region_error->error_code);
                        free(region_error);
                        // Invalidate region data on capture error
                        std::lock_guard<std::mutex> data_lock(region_config.dataMutex);
                        region_config.latestRgbDataBuffer.reset();
                        region_config.latestRgbDataBufferSize = 0;
                        region_config.captureTimestampUs = 0;
                        region_config.hasNewData = false;
                    } else if (region_img_reply) {
                        uint8_t* region_bgra_data = region_config.shm_segment->data;
                        uint64_t region_stride = static_cast<uint64_t>(region_config.width) * 4; // Stride is per-region width

                        auto capture_time_point = std::chrono::steady_clock::now();
                        uint64_t capture_timestamp_us = std::chrono::duration_cast<std::chrono::microseconds>(
                            capture_time_point.time_since_epoch()
                        ).count();

                        bool processed_success = false;
                        { // Scope for region_config.dataMutex
                            std::lock_guard<std::mutex> data_lock(region_config.dataMutex);
                            processed_success = ProcessImageData(
                                region_bgra_data, region_config.width, region_config.height, region_stride,
                                region_config.latestRgbDataBuffer.get(), region_config.latestRgbDataBufferSize);
                        }

                        { // Scope for region_config.dataMutex
                            std::lock_guard<std::mutex> data_lock(region_config.dataMutex);
                            if (processed_success) {
                                region_config.captureTimestampUs = capture_timestamp_us;
                                region_config.hasNewData = true;
                            } else {
                                region_config.latestRgbDataBuffer.reset(); // Clear buffer on processing failure
                                region_config.latestRgbDataBufferSize = 0;
                                region_config.captureTimestampUs = 0;
                                region_config.hasNewData = false;
                            }
                        }
                        free(region_img_reply);
                    } else {
                        fprintf(stderr, "X11RegionCapture Capture thread: xcb_shm_get_image_reply for region '%s' returned null reply without error.\n", region_name.c_str());
                        std::lock_guard<std::mutex> data_lock(region_config.dataMutex);
                        region_config.latestRgbDataBuffer.reset();
                        region_config.latestRgbDataBufferSize = 0;
                        region_config.captureTimestampUs = 0;
                        region_config.hasNewData = false;
                    }
                }
            } // End regions_mutex scope

            // --- Delay to control FPS ---
            // Read the current target frame time safely
            std::chrono::microseconds current_target_frame_time;
            {
                std::lock_guard<std::mutex> lock(fps_mutex);
                current_target_frame_time = target_frame_time_us;
            }

            // Calculate time spent so far in this loop iteration
            auto loop_end_time = std::chrono::steady_clock::now();
            auto elapsed_time = std::chrono::duration_cast<std::chrono::microseconds>(loop_end_time - loop_start_time);

            // printf("X11RegionCapture Capture thread: Frame loop took %lld us. Target interval %lld us.\n",
            //        (long long)elapsed_time.count(), (long long)current_target_frame_time.count());

            // Sleep for the remaining time to meet the target frame time
            if (elapsed_time < current_target_frame_time && current_target_frame_time.count() > 0) {
                auto sleep_duration = current_target_frame_time - elapsed_time;
                // printf("X11RegionCapture Capture thread: Sleeping for %lld us.\n", (long long)sleep_duration.count());
                std::this_thread::sleep_for(sleep_duration);
            }
            // else {
            //      printf("X11RegionCapture Capture thread: No sleep needed, capture took longer than target interval.\n");
            // }


        } // End of while(should_capture) loop

        // printf("X11RegionCapture: Capture thread stopped for window 0x%x.\n", target_window_id);
        is_capturing = false;
    }

    void StopCaptureThread() {
        should_capture = false; // Signal the thread to stop
        if (capture_thread.joinable()) {
            try {
                capture_thread.join(); // Wait for the thread to finish
            } catch (const std::system_error& e) {
                fprintf(stderr, "X11RegionCapture Error joining capture thread: %s\n", e.what());
            }
        }
        is_capturing = false;
    }

    // --- N-API Methods Implementation ---

    Napi::Value IsConnected(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        return Napi::Boolean::New(env, is_connected.load());
    }

    Napi::Value AddRegionToMonitor(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        // --- Argument Validation ---
        if (info.Length() < 1 || !info[0].IsObject()) {
            Napi::TypeError::New(env, "Region configuration object expected as first argument").ThrowAsJavaScriptException();
            return env.Null();
        }

        Napi::Object regionConfig = info[0].As<Napi::Object>();

        // Validate required properties
        if (!regionConfig.Has("regionName") || !regionConfig.Get("regionName").IsString()) {
            Napi::TypeError::New(env, "regionName (String) property is required").ThrowAsJavaScriptException();
            return env.Null();
        }
        if (!regionConfig.Has("winX") || !regionConfig.Get("winX").IsNumber()) {
            Napi::TypeError::New(env, "winX (Number) property is required").ThrowAsJavaScriptException();
            return env.Null();
        }
        if (!regionConfig.Has("winY") || !regionConfig.Get("winY").IsNumber()) {
            Napi::TypeError::New(env, "winY (Number) property is required").ThrowAsJavaScriptException();
            return env.Null();
        }
        if (!regionConfig.Has("regionWidth") || !regionConfig.Get("regionWidth").IsNumber()) {
            Napi::TypeError::New(env, "regionWidth (Number) property is required").ThrowAsJavaScriptException();
            return env.Null();
        }
        if (!regionConfig.Has("regionHeight") || !regionConfig.Get("regionHeight").IsNumber()) {
            Napi::TypeError::New(env, "regionHeight (Number) property is required").ThrowAsJavaScriptException();
            return env.Null();
        }

        // Get values
        std::string regionName = regionConfig.Get("regionName").As<Napi::String>().Utf8Value();
        uint32_t winX = regionConfig.Get("winX").As<Napi::Number>().Uint32Value();
        uint32_t winY = regionConfig.Get("winY").As<Napi::Number>().Uint32Value();
        uint32_t regionWidth = regionConfig.Get("regionWidth").As<Napi::Number>().Uint32Value();
        uint32_t regionHeight = regionConfig.Get("regionHeight").As<Napi::Number>().Uint32Value();

        // Basic sanity check for dimensions (can expand this later)
        if (regionWidth == 0 || regionHeight == 0 || winX > MAX_DIMENSION || winY > MAX_DIMENSION || regionWidth > MAX_DIMENSION || regionHeight > MAX_DIMENSION) {
            Napi::RangeError::New(env, "Invalid region dimensions or coordinates").ThrowAsJavaScriptException();
            return env.Null();
        }

        // Add or update the region
        { // Scope for map lock guard
            std::lock_guard<std::mutex> lock(regions_mutex);

            auto it = monitored_regions.find(regionName);

            if (it != monitored_regions.end()) {
                // Region name already exists, update its configuration
                MonitoredRegion& existing_region = it->second;
                std::lock_guard<std::mutex> data_lock(existing_region.dataMutex); // Lock its data

                // Check if dimensions or position changed significantly, requiring SHM re-init
                bool config_changed = (existing_region.width != regionWidth || existing_region.height != regionHeight ||
                                       existing_region.winX != winX || existing_region.winY != winY);

                existing_region.winX = winX;
                existing_region.winY = winY;
                existing_region.width = regionWidth;
                existing_region.height = regionHeight;
                // No need to clear data/flag/timestamp here, the capture loop will overwrite if dimensions are valid.

                if (config_changed) {
                    // Clean up old SHM if config changed, then init new one
                    if (!EnsureRegionSHMSize(existing_region, regionWidth, regionHeight)) { // Use helper
                        fprintf(stderr, "X11RegionCapture: Failed to re-initialize SHM for existing region '%s'.\n", regionName.c_str());
                        // It's still in the map, but its SHM is null, capture loop will deal with it.
                        Napi::Error::New(env, "Failed to re-initialize SHM for region '" + regionName + "'").ThrowAsJavaScriptException();
                        return env.Null();
                    }
                    existing_region.latestRgbDataBuffer.reset(); // Clear old data
                    existing_region.captureTimestampUs = 0;
                    existing_region.hasNewData = false;
                }
                // printf("X11RegionCapture: Updated region '%s': x=%u, y=%u, w=%u, h=%u\n", regionName.c_str(), winX, winY, regionWidth, regionHeight);

            } else {
                // Region name does not exist, insert a new one.
                // Emplace creates the MonitoredRegion in place using its constructor
                auto emplace_result = monitored_regions.emplace(
                    std::piecewise_construct,
                    std::forward_as_tuple(regionName),
                    std::forward_as_tuple(winX, winY, regionWidth, regionHeight) // Uses MonitoredRegion constructor
                );

                if (!emplace_result.second) {
                    fprintf(stderr, "X11RegionCapture: Error emplacing new region '%s'.\n", regionName.c_str());
                    Napi::Error::New(env, "Failed to add region '" + regionName + "'").ThrowAsJavaScriptException();
                    return env.Null();
                }

                // Now that it's emplaced, initialize its SHM segment
                MonitoredRegion& new_region = emplace_result.first->second;
                if (!EnsureRegionSHMSize(new_region, regionWidth, regionHeight)) { // Use helper
                    fprintf(stderr, "X11RegionCapture: Failed to initialize SHM for new region '%s'. Removing from map.\n", regionName.c_str());
                    // Remove the partially added entry if SHM fails
                    monitored_regions.erase(emplace_result.first);
                    Napi::Error::New(env, "Failed to add region '" + regionName + "': SHM initialization failed.").ThrowAsJavaScriptException();
                    return env.Null();
                }
                // printf("X11RegionCapture: Added region '%s': x=%u, y=%u, w=%u, h=%u\n", regionName.c_str(), winX, winY, regionWidth, regionHeight);
            }
        } // Map mutex released

        return env.Undefined();
    }

    Napi::Value RemoveRegionToMonitor(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        // --- Argument Validation ---
        if (info.Length() < 1 || !info[0].IsString()) {
            Napi::TypeError::New(env, "Region name (String) expected as first argument").ThrowAsJavaScriptException();
            return env.Null();
        }

        std::string regionName = info[0].As<Napi::String>().Utf8Value();

        // Remove the region
        { // Scope for lock guard
            std::lock_guard<std::mutex> lock(regions_mutex);
            auto it = monitored_regions.find(regionName);
            if (it != monitored_regions.end()) {
                MonitoredRegion& region_to_remove = it->second;
                std::lock_guard<std::mutex> data_lock(region_to_remove.dataMutex); // Lock its data

                region_to_remove.latestRgbDataBuffer.reset(); // Release unique_ptr
                region_to_remove.captureTimestampUs = 0;
                region_to_remove.hasNewData = false;

                // NEW: Clean up region's SHM segment
                if (region_to_remove.shm_segment) {
                    cleanup_shm(connection, region_to_remove.shm_segment);
                    region_to_remove.shm_segment = nullptr;
                }
                monitored_regions.erase(it);
                // printf("X11RegionCapture: Removed region '%s'.\n", regionName.c_str());
            } else {
                // Region not found
                Napi::Error::New(env, "Region '" + regionName + "' not found.").ThrowAsJavaScriptException();
                return env.Null();
            }
        } // Mutex released

        return env.Undefined();
    }

    Napi::Value StartMonitorInstance(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        // --- Argument Validation ---
        if (info.Length() < 1 || !info[0].IsNumber()) {
            Napi::TypeError::New(env, "Window ID (Number) expected as first argument").ThrowAsJavaScriptException();
            return env.Null();
        }

        uint32_t windowId = info[0].As<Napi::Number>().Uint32Value();

        uint32_t fps = DEFAULT_FPS; // Default FPS
        if (info.Length() > 1) {
            if (!info[1].IsNumber()) {
                Napi::TypeError::New(env, "Optional FPS (Number) expected as second argument").ThrowAsJavaScriptException();
                return env.Null();
            }
            int32_t requested_fps = info[1].As<Napi::Number>().Int32Value();
            if (requested_fps < MIN_FPS || requested_fps > MAX_FPS) {
                Napi::RangeError::New(env, "FPS must be between " + std::to_string(MIN_FPS) + " and " + std::to_string(MAX_FPS)).ThrowAsJavaScriptException();
                return env.Null();
            }
            fps = static_cast<uint32_t>(requested_fps);
        }


        // --- State Checks ---
        if (is_capturing) {
            Napi::Error::New(env, "Monitoring is already running").ThrowAsJavaScriptException();
            return env.Null();
        }
        if (!connection || xcb_connection_has_error(connection)) {
            Napi::Error::New(env, "Not connected to X server. Cannot start monitoring.").ThrowAsJavaScriptException();
            return env.Null();
        }

        target_window_id = windowId; // Store the target window ID

        // Stop any potentially lingering thread first (shouldn't happen, but defensive)
        StopCaptureThread();

        // --- Set Target FPS Safely ---
        {
            std::lock_guard<std::mutex> lock(fps_mutex);
            if (fps > 0) {
                target_frame_time_us = std::chrono::microseconds(1000000 / fps);
            } else {
                target_frame_time_us = std::chrono::microseconds(1000000 / DEFAULT_FPS);
                fprintf(stderr, "X11RegionCapture Warning: Invalid FPS %u provided, defaulting to %d\n", fps, DEFAULT_FPS);
            }

            // printf("X11RegionCapture: Starting monitoring for window 0x%x with target FPS: %u (Interval: %lld us)\n",
            // target_window_id, fps, (long long)target_frame_time_us.count());
        }

        should_capture = true;
        // The CaptureLoop will handle SHM initialization and size checks dynamically

        try {
            capture_thread = std::thread(&X11RegionCapture::CaptureLoop, this);
        } catch (const std::system_error& e) {
            should_capture = false; // Ensure flag is reset if thread creation fails
            is_capturing = false;
            Napi::Error::New(env, std::string("Failed to create capture thread: ") + e.what()).ThrowAsJavaScriptException();
            return env.Null();
        }

        return env.Undefined();
    }

    Napi::Value StopMonitorInstance(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();

        if (!is_capturing && !capture_thread.joinable()) {
            // Don't throw an error if already stopped, just do nothing.
            return env.Undefined();
        }

        // printf("X11RegionCapture: Stopping monitoring thread...\n");
        StopCaptureThread(); // Handles setting flags and joining
        // printf("X11RegionCapture: Monitoring thread stopped.\n");

        return env.Undefined();
    }

    // This method now copies data from internal storage into a JS-provided Buffer
    Napi::Value CopyRegionDataIntoBuffer(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        Napi::Object result = Napi::Object::New(env);

        // Default to failure result
        result.Set("success", Napi::Boolean::New(env, false));
        result.Set("width", Napi::Number::New(env, 0));
        result.Set("height", Napi::Number::New(env, 0));
        result.Set("bytesCopied", Napi::Number::New(env, 0));
        result.Set("captureTimestampUs", Napi::Number::New(env, 0));

        // Argument Validation: regionName, targetBuffer
        if (info.Length() < 2 || !info[0].IsString() || !info[1].IsBuffer()) {
            Napi::TypeError::New(env, "Expected (string regionName, Buffer targetBuffer)").ThrowAsJavaScriptException();
            return result;
        }

        std::string regionName = info[0].As<Napi::String>().Utf8Value();
        Napi::Buffer<uint8_t> targetBuffer = info[1].As<Napi::Buffer<uint8_t>>();
        uint64_t targetBufferCapacity = targetBuffer.Length();

        std::lock_guard<std::mutex> regions_lock(regions_mutex); // Lock the map for finding the region

        auto it = monitored_regions.find(regionName);
        if (it != monitored_regions.end()) {
            MonitoredRegion& region = it->second; // Get reference to the MonitoredRegion struct

            std::lock_guard<std::mutex> data_lock(region.dataMutex); // Lock specific region's data

            if (region.hasNewData.load() && region.latestRgbDataBuffer && region.latestRgbDataBufferSize > 0) {
                const uint8_t* source_data = region.latestRgbDataBuffer.get();
                uint64_t source_data_size = region.latestRgbDataBufferSize;

                if (targetBufferCapacity >= source_data_size) {
                    uint8_t* dest_data = targetBuffer.Data();
                    memcpy(dest_data, source_data, source_data_size);

                    // Set success and return dimensions
                    result.Set("success", Napi::Boolean::New(env, true));
                    result.Set("width", Napi::Number::New(env, region.width));
                    result.Set("height", Napi::Number::New(env, region.height));
                    result.Set("bytesCopied", Napi::Number::New(env, source_data_size));
                    result.Set("captureTimestampUs", Napi::Number::New(env, static_cast<double>(region.captureTimestampUs)));

                    // IMPORTANT: Reset the flag after copying to JS buffer.
                    // The buffer itself is kept for reuse.
                    region.hasNewData = false;
                } else {
                    fprintf(stderr, "X11RegionCapture CopyRegionDataIntoBuffer: Target buffer too small for region '%s'. Required: %lu, Has: %lu.\n",
                            regionName.c_str(), source_data_size, targetBufferCapacity);
                }
            } else {
                // No new data or data was already cleared/invalid, return default failure object.
                // fprintf(stderr, "X11RegionCapture CopyRegionDataIntoBuffer: No new data available for region '%s'.\n", regionName.c_str());
            }
        } else {
            fprintf(stderr, "X11RegionCapture CopyRegionDataIntoBuffer: Region '%s' not found.\n", regionName.c_str());
        }

        return result;
    }

    // MODIFIED: This method now triggers a one-off full window capture and waits for it
    Napi::Value CopyFullWindowDataIntoBuffer(const Napi::CallbackInfo& info) {
        Napi::Env env = info.Env();
        Napi::Object result = Napi::Object::New(env);

        // Default to failure result
        result.Set("success", Napi::Boolean::New(env, false));
        result.Set("width", Napi::Number::New(env, 0));
        result.Set("height", Napi::Number::New(env, 0));
        result.Set("bytesCopied", Napi::Number::New(env, 0));
        result.Set("captureTimestampUs", Napi::Number::New(env, 0));

        // Argument Validation: targetBuffer
        if (info.Length() < 1 || !info[0].IsBuffer()) {
            Napi::TypeError::New(env, "Expected (Buffer targetBuffer)").ThrowAsJavaScriptException();
            return result;
        }

        Napi::Buffer<uint8_t> targetBuffer = info[0].As<Napi::Buffer<uint8_t>>();
        uint64_t targetBufferCapacity = targetBuffer.Length();

        // Get the timestamp of the *last* captured full frame before we request a new one.
        // This allows us to wait for a *newer* frame.
        uint64_t timestamp_before_request;
        {
            std::lock_guard<std::mutex> lock(fullFrameMutex);
            timestamp_before_request = latestFullFrameRgbDataTimestampUs;
        }

        // Signal the capture thread to perform a full window capture
        full_window_capture_pending = true;

        // Wait for the capture thread to process the request and update the data
        const std::chrono::milliseconds timeout = std::chrono::milliseconds(500); // 500ms timeout
        auto start_wait_time = std::chrono::steady_clock::now();

        // Use std::unique_lock for manual lock/unlock in the polling loop
        std::unique_lock<std::mutex> lock(fullFrameMutex); // Acquire lock initially

        while (std::chrono::steady_clock::now() - start_wait_time < timeout) {
            // Check if new data is available AND if its timestamp is newer than when we made the request
            if (hasNewFullFrame.load() && latestFullFrameRgbDataTimestampUs > timestamp_before_request && latestFullFrameRgbDataBuffer && latestFullFrameRgbDataBufferSize > 0) {
                const uint8_t* source_data = latestFullFrameRgbDataBuffer.get();
                uint64_t source_data_size = latestFullFrameRgbDataBufferSize;

                // Read dimensions from the source buffer header (if valid)
                uint32_t src_width = 0;
                uint32_t src_height = 0;
                if (source_data_size >= IMAGE_HEADER_SIZE) {
                    src_width = (source_data[0] | (source_data[1] << 8) | (source_data[2] << 16) | (source_data[3] << 24));
                    src_height = (source_data[4] | (source_data[5] << 8) | (source_data[6] << 16) | (source_data[7] << 24));
                }

                if (targetBufferCapacity >= source_data_size) {
                    uint8_t* dest_data = targetBuffer.Data();
                    memcpy(dest_data, source_data, source_data_size);

                    result.Set("success", Napi::Boolean::New(env, true));
                    result.Set("width", Napi::Number::New(env, src_width));
                    result.Set("height", Napi::Number::New(env, src_height));
                    result.Set("bytesCopied", Napi::Number::New(env, source_data_size));
                    result.Set("captureTimestampUs", Napi::Number::New(env, static_cast<double>(latestFullFrameRgbDataTimestampUs)));

                    hasNewFullFrame = false; // Mark as consumed for next request
                    // The buffer itself is kept for reuse, no reset needed here.
                } else {
                    fprintf(stderr, "X11RegionCapture CopyFullWindowDataIntoBuffer: Target buffer too small. Required: %lu, Has: %lu.\n",
                            source_data_size, targetBufferCapacity);
                }
                return result; // Data copied or buffer too small, exit loop.
            }

            // If no new data or data not newer, release the lock and sleep
            lock.unlock(); // Release lock before sleeping to allow capture thread to proceed
            std::this_thread::sleep_for(std::chrono::milliseconds(10)); // Poll every 10ms
            lock.lock(); // Re-acquire lock before checking condition again
        }

        // If loop finishes without new data, it means timeout occurred or data not available.
        // Result object remains default failure state.
        // fprintf(stderr, "X11RegionCapture CopyFullWindowDataIntoBuffer: No new full window data available after timeout.\n");
        return result;
    }
}; // End of X11RegionCapture class

// --- Module Initialization ---
Napi::Object Init(Napi::Env env, Napi::Object exports) {
    return X11RegionCapture::Init(env, exports);
}

NODE_API_MODULE(x11regioncapture, Init) // Module name should match the target in binding.gyp