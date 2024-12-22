#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <xcb/xcb.h>

void fatal(const char *msg) {
    fprintf(stderr, "%s\n", msg);
    exit(1);
}

int main(int argc, char *argv[]) {
    if (argc < 6 || argc > 7) {
        fatal("Usage: program <window_id> <x> <y> <width> <height> [output_file]");
    }

    xcb_connection_t *connection = xcb_connect(NULL, NULL);
    if (xcb_connection_has_error(connection)) {
        fatal("Failed to connect to X server");
    }

    xcb_window_t window = (xcb_window_t)strtoul(argv[1], NULL, 0);
    int x = atoi(argv[2]);
    int y = atoi(argv[3]);
    int width = atoi(argv[4]);
    int height = atoi(argv[5]);

    // Get the image
    xcb_get_image_cookie_t img_cookie = xcb_get_image(
        connection, XCB_IMAGE_FORMAT_Z_PIXMAP, window, x, y, width, height, ~0);

    xcb_get_image_reply_t *img_reply = xcb_get_image_reply(connection, img_cookie, NULL);
    if (!img_reply) {
        fatal("Failed to get image");
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

    // Save RGB data
    if (argc == 7) {
        const char *output_file = argv[6];
        FILE *file = fopen(output_file, "wb");
        if (!file) {
            free(rgb_data);
            free(img_reply);
            xcb_disconnect(connection);
            fatal("Failed to open output file");
        }

        // Write dimensions as little-endian integers
        fwrite(&width, sizeof(uint32_t), 1, file);
        fwrite(&height, sizeof(uint32_t), 1, file);

        // Write RGB data
        fwrite(rgb_data, 1, width * height * 3, file);
        fclose(file);

        printf("RGB data saved to %s\n", output_file);
    } else {
        fwrite(&width, sizeof(int), 1, stdout);
        fwrite(&height, sizeof(int), 1, stdout);
        fwrite(rgb_data, 1, width * height * 3, stdout);
    }

    // Cleanup
    free(rgb_data);
    free(img_reply);
    xcb_disconnect(connection);

    return 0;
}
