#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <xcb/xcb.h>
#include <xcb/shm.h>
#include <xcb/xproto.h>
#include <sys/ipc.h>
#include <sys/shm.h>
#include <sys/time.h>
#include <unistd.h>
#include <stdint.h>

// Function to get current time in microseconds
uint64_t get_time_usec() {
    struct timeval tv;
    gettimeofday(&tv, NULL);
    return (uint64_t)tv.tv_sec * 1000000 + tv.tv_usec;
}

// Function to log timing with millisecond precision
void log_timing(const char* operation, uint64_t start_time, uint64_t end_time) {
    double ms = (end_time - start_time) / 1000.0;
    fprintf(stderr, "TIME: %-30s %.3f ms\n", operation, ms);
}

// Structure to hold SHM segment info
typedef struct {
    xcb_shm_seg_t shmseg;
    uint8_t *data;
    int size;
    int shmid;
} shm_segment_info_t;

// Initialize shared memory segment
shm_segment_info_t* init_shm(xcb_connection_t *connection, int size) {
    uint64_t start_time = get_time_usec();

    shm_segment_info_t *segment = malloc(sizeof(shm_segment_info_t));

    // Create shared memory segment
    segment->shmid = shmget(IPC_PRIVATE, size, IPC_CREAT | 0777);
    if (segment->shmid == -1) {
        perror("shmget");
        free(segment);
        return NULL;
    }

    // Attach the segment
    segment->data = shmat(segment->shmid, 0, 0);
    if (segment->data == (void *)-1) {
        perror("shmat");
        shmctl(segment->shmid, IPC_RMID, 0);
        free(segment);
        return NULL;
    }

    // Generate XID for the shm segment
    segment->shmseg = xcb_generate_id(connection);
    segment->size = size;

    // Attach the segment to X server
    xcb_shm_attach(connection, segment->shmseg, segment->shmid, 0);
    xcb_flush(connection);

    // Mark segment for deletion after detach
    shmctl(segment->shmid, IPC_RMID, 0);

    uint64_t end_time = get_time_usec();
    log_timing("SHM initialization", start_time, end_time);

    return segment;
}

// Cleanup shared memory segment
void cleanup_shm(xcb_connection_t *connection, shm_segment_info_t *segment) {
    if (segment) {
        xcb_shm_detach(connection, segment->shmseg);
        shmdt(segment->data);
        free(segment);
    }
}

int main() {
    // Set stdout to unbuffered mode
    setvbuf(stdout, NULL, _IONBF, 0);

    xcb_connection_t *connection = xcb_connect(NULL, NULL);
    if (xcb_connection_has_error(connection)) {
        fprintf(stderr, "Failed to connect to X server\n");
        exit(1);
    }

    // Check for SHM extension
    xcb_shm_query_version_cookie_t shm_cookie = xcb_shm_query_version(connection);
    xcb_shm_query_version_reply_t *shm_reply = xcb_shm_query_version_reply(connection, shm_cookie, NULL);

    if (!shm_reply) {
        fprintf(stderr, "MIT-SHM extension not available\n");
        xcb_disconnect(connection);
        exit(1);
    }
    free(shm_reply);

    shm_segment_info_t *segment = NULL;
    char buffer[256];

    while (fgets(buffer, sizeof(buffer), stdin)) {
        if (strncmp(buffer, "exit", 4) == 0) break;

        uint64_t frame_start_time = get_time_usec();
        xcb_window_t window;
        int x, y, width, height;

        uint64_t parse_start = get_time_usec();
        if (sscanf(buffer, "%u %d %d %d %d", &window, &x, &y, &width, &height) != 5) {
            fprintf(stderr, "Invalid input format\n");
            continue;
        }
        uint64_t parse_end = get_time_usec();
        log_timing("Input parsing", parse_start, parse_end);

        // Calculate required size and initialize/resize shared memory if needed
        int required_size = width * height * 4;
        if (!segment || segment->size < required_size) {
            if (segment) {
                cleanup_shm(connection, segment);
            }
            segment = init_shm(connection, required_size);
            if (!segment) {
                fprintf(stderr, "Failed to initialize shared memory\n");
                continue;
            }
        }

        // Get the image using SHM
        uint64_t image_get_start = get_time_usec();
        xcb_shm_get_image_cookie_t img_cookie = xcb_shm_get_image(
            connection, window, x, y, width, height, ~0,
            XCB_IMAGE_FORMAT_Z_PIXMAP, segment->shmseg, 0);

        xcb_shm_get_image_reply_t *img_reply = xcb_shm_get_image_reply(connection, img_cookie, NULL);

        if (!img_reply) {
            fprintf(stderr, "Failed to get image\n");
            continue;
        }
        free(img_reply);
        uint64_t image_get_end = get_time_usec();
        log_timing("Image data retrieval", image_get_start, image_get_end);

        // Write header
        uint32_t delimiter = 0xDEADBEEF;
        write(STDOUT_FILENO, &delimiter, sizeof(uint32_t));
        write(STDOUT_FILENO, &width, sizeof(int));
        write(STDOUT_FILENO, &height, sizeof(int));

        // Allocate buffer for the entire converted image
        int total_size = width * height * 3;
        uint8_t *converted_buffer = malloc(total_size);

        // Convert BGRA to RGB
        uint64_t conversion_start = get_time_usec();
        for (int row = 0; row < height; row++) {
            for (int col = 0; col < width; col++) {
                int src_idx = (row * width + col) * 4;
                int dst_idx = (row * width + col) * 3;
                converted_buffer[dst_idx] = segment->data[src_idx + 2];     // Red
                converted_buffer[dst_idx + 1] = segment->data[src_idx + 1]; // Green
                converted_buffer[dst_idx + 2] = segment->data[src_idx];     // Blue
            }
        }
        uint64_t conversion_end = get_time_usec();
        log_timing("RGB conversion", conversion_start, conversion_end);

        // Write the converted buffer
        uint64_t write_start = get_time_usec();
        write(STDOUT_FILENO, converted_buffer, total_size);
        uint64_t write_end = get_time_usec();
        log_timing("Buffer writing", write_start, write_end);

        free(converted_buffer);

        // Write end delimiter
        write(STDOUT_FILENO, &delimiter, sizeof(uint32_t));

        uint64_t frame_end_time = get_time_usec();
        log_timing("Total frame processing", frame_start_time, frame_end_time);
        fprintf(stderr, "----------------------------------------\n");
    }

    if (segment) {
        cleanup_shm(connection, segment);
    }
    xcb_disconnect(connection);
    return 0;
}