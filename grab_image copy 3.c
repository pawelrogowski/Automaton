#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <xcb/xcb.h>
#include <stdint.h>

// Function to handle fatal errors and exit
void fatal(const char *msg) {
    fprintf(stderr, "ERROR: %s\n", msg);
    fflush(stderr);
    exit(1);
}

int main() {
    xcb_connection_t *connection = xcb_connect(NULL, NULL);
    if (xcb_connection_has_error(connection)) {
        fatal("Failed to connect to X server");
    }

    uint32_t frame_marker = 0xDEADBEEF; // Frame marker

    char buffer[256]; // Command buffer
    while (fgets(buffer, sizeof(buffer), stdin)) {
        if (strncmp(buffer, "exit", 4) == 0) {
            break;
        }

        xcb_window_t window;
        int x, y, width, height;

        // Parse input for window ID and region
        if (sscanf(buffer, "%u %d %d %d %d", &window, &x, &y, &width, &height) != 5) {
            fprintf(stderr, "ERROR: Invalid input format\n");
            fflush(stderr);
            continue;
        }

        // Get the image from the specified region
        xcb_get_image_cookie_t img_cookie = xcb_get_image(
            connection, XCB_IMAGE_FORMAT_Z_PIXMAP, window, x, y, width, height, ~0);

        xcb_get_image_reply_t *img_reply = xcb_get_image_reply(connection, img_cookie, NULL);
        if (!img_reply) {
            fprintf(stderr, "ERROR: Failed to get image\n");
            fflush(stderr);
            continue;
        }

        // Extract and convert image data to RGB
        uint8_t *image_data = xcb_get_image_data(img_reply);
        size_t image_size = xcb_get_image_data_length(img_reply);
        uint8_t *rgb_data = malloc(width * height * 3);

        for (size_t i = 0, j = 0; i < image_size; i += 4, j += 3) {
            rgb_data[j] = image_data[i + 2];       // Red
            rgb_data[j + 1] = image_data[i + 1];  // Green
            rgb_data[j + 2] = image_data[i];      // Blue
        }

        // Write the frame marker, dimensions, and RGB data
        fwrite(&frame_marker, sizeof(frame_marker), 1, stdout);
        fwrite(&width, sizeof(int), 1, stdout);
        fwrite(&height, sizeof(int), 1, stdout);
        fwrite(rgb_data, 1, width * height * 3, stdout);
        fflush(stdout);

        // Cleanup memory
        free(rgb_data);
        free(img_reply);
    }

    // Disconnect from X server and exit
    xcb_disconnect(connection);
    return 0;
}
