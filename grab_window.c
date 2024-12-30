#include <xcb/xcb.h>
#include <stdio.h>
#include <stdlib.h>
#include <string.h>

// Function to check window existence with xcb
int check_window_exists_xcb(xcb_connection_t *conn, xcb_window_t window) {
    xcb_get_window_attributes_cookie_t attr_cookie = xcb_get_window_attributes(conn, window);
    xcb_get_window_attributes_reply_t *attr_reply = xcb_get_window_attributes_reply(conn, attr_cookie, NULL);

    if (attr_reply) {
        free(attr_reply);
        return 1; // Window exists
    }
    return 0; // Window does not exist
}

// Function to check window existence with xdotool
int check_window_exists_xdotool(xcb_window_t window) {
    char command[256];
    snprintf(command, sizeof(command), "xdotool search --onlyvisible --name %lu", window);
    return (system(command) == 0); // Check if xdotool succeeds
}

// Revised main function
int main(int argc, char **argv) {
    if (argc != 2) {
        fprintf(stderr, "Usage: %s <window-id>\n", argv[0]);
        return EXIT_FAILURE;
    }

    // Parse window ID as hexadecimal
    xcb_window_t window = (xcb_window_t)strtoul(argv[1], NULL, 16);
    xcb_connection_t *conn = xcb_connect(NULL, NULL);

    if (xcb_connection_has_error(conn)) {
        fprintf(stderr, "Failed to connect to X server\n");
        return EXIT_FAILURE;
    }

    // First check with xcb
    if (check_window_exists_xcb(conn, window)) {
        printf("Window with ID 0x%x exists (verified via xcb).\n", window);
    } else {
        // Fallback to xdotool
        if (check_window_exists_xdotool(window)) {
            printf("Window with ID 0x%x exists (verified via xdotool).\n", window);
        } else {
            fprintf(stderr, "Window with ID 0x%x does not exist.\n", window);
            xcb_disconnect(conn);
            return EXIT_FAILURE;
        }
    }

    printf("Success! Window ID 0x%x is valid and accessible.\n", window);
    xcb_disconnect(conn);
    return EXIT_SUCCESS;
}
