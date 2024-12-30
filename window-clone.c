#include <stdio.h>
#include <stdlib.h>
#include <string.h>
#include <stdbool.h>
#include <signal.h>
#include <time.h>
#include <unistd.h>
#include <xcb/xcb.h>

volatile bool running = true;

void signal_handler(int signum) {
    running = false;
}

void fatal(const char *msg) {
    fprintf(stderr, "%s\n", msg);
    exit(1);
}

bool get_window_geometry(xcb_window_t window_id, int *win_x, int *win_y, int *win_width, int *win_height) {
    char command[256];
    snprintf(command, sizeof(command),
             "xdotool getwindowgeometry --shell %lu", window_id);

    FILE *fp = popen(command, "r");
    if (!fp) {
        return false;
    }

    char line[256];
    while (fgets(line, sizeof(line), fp)) {
        if (strncmp(line, "X=", 2) == 0) {
            *win_x = atoi(line + 2);
        } else if (strncmp(line, "Y=", 2) == 0) {
            *win_y = atoi(line + 2);
        } else if (strncmp(line, "WIDTH=", 6) == 0) {
            *win_width = atoi(line + 6);
        } else if (strncmp(line, "HEIGHT=", 7) == 0) {
            *win_height = atoi(line + 7);
        }
    }

    pclose(fp);
    return true;
}

void send_click_xdotool(xcb_window_t source_window, int button, int x, int y) {
    char command[256];
    snprintf(command, sizeof(command),
             "xdotool mousemove %d %d click --window %lu %d",
             x, y, source_window, button);

    printf("Executing: %s\n", command);
    system(command);
}

int main(int argc, char *argv[]) {
    if (argc != 2) {
        fatal("Usage: program <window_id>");
    }

    // Connect to X server
    int screen_num;
    xcb_connection_t *connection = xcb_connect(NULL, &screen_num);
    if (xcb_connection_has_error(connection)) {
        fatal("Failed to connect to X server");
    }

    // Get the first screen
    xcb_screen_t *screen = xcb_setup_roots_iterator(xcb_get_setup(connection)).data;
    if (!screen) {
        fatal("Failed to get screen");
    }

    // Parse window ID
    xcb_window_t source_window = (xcb_window_t)strtoul(argv[1], NULL, 0);

    // Get source window geometry
    int win_x, win_y, win_width, win_height;
    if (!get_window_geometry(source_window, &win_x, &win_y, &win_width, &win_height)) {
        fatal("Failed to get window geometry");
    }
    printf("Window geometry: x=%d, y=%d, width=%d, height=%d\n",
           win_x, win_y, win_width, win_height);

    // Run slurp and get the output
    FILE *slurp = popen("slurp", "r");
    if (!slurp) {
        fatal("Failed to run slurp");
    }

    char slurp_output[256];
    if (!fgets(slurp_output, sizeof(slurp_output), slurp)) {
        fatal("Failed to read slurp output");
    }
    pclose(slurp);

    // Parse slurp output (format: x,y wxh)
    int slurp_x, slurp_y, width, height;
    if (sscanf(slurp_output, "%d,%d %dx%d", &slurp_x, &slurp_y, &width, &height) != 4) {
        fatal("Failed to parse slurp output");
    }

    // Convert absolute coordinates to window-relative coordinates
    int relative_x = slurp_x - win_x;
    int relative_y = slurp_y - win_y;

    printf("Selected region (absolute): x=%d, y=%d, width=%d, height=%d\n",
           slurp_x, slurp_y, width, height);
    printf("Selected region (relative): x=%d, y=%d, width=%d, height=%d\n",
           relative_x, relative_y, width, height);

    signal(SIGINT, signal_handler);
    signal(SIGTERM, signal_handler);

    // Create the clone window
    xcb_window_t clone_window = xcb_generate_id(connection);
    uint32_t mask = XCB_CW_BACK_PIXEL | XCB_CW_EVENT_MASK;
    uint32_t values[] = {
        screen->white_pixel,
        XCB_EVENT_MASK_EXPOSURE |
        XCB_EVENT_MASK_KEY_PRESS |
        XCB_EVENT_MASK_BUTTON_PRESS |
        XCB_EVENT_MASK_BUTTON_RELEASE |
        XCB_EVENT_MASK_POINTER_MOTION |
        XCB_EVENT_MASK_BUTTON_MOTION
    };

    xcb_create_window(connection,
                     XCB_COPY_FROM_PARENT,
                     clone_window,
                     screen->root,
                     0, 0,
                     width, height,
                     0,
                     XCB_WINDOW_CLASS_INPUT_OUTPUT,
                     screen->root_visual,
                     mask, values);



    // Create a graphics context
    xcb_gcontext_t gc = xcb_generate_id(connection);
    mask = XCB_GC_FOREGROUND | XCB_GC_BACKGROUND;
    values[0] = screen->black_pixel;
    values[1] = screen->white_pixel;
    xcb_create_gc(connection, gc, clone_window, mask, values);

    // Set window title
    const char *title = "Window Clone (with xdotool click passthrough)";
    xcb_change_property(connection,
                       XCB_PROP_MODE_REPLACE,
                       clone_window,
                       XCB_ATOM_WM_NAME,
                       XCB_ATOM_STRING,
                       8,
                       strlen(title),
                       title);

    // Make the window borderless using hints
    xcb_intern_atom_cookie_t wm_state_cookie = xcb_intern_atom(connection, 0, strlen("_NET_WM_STATE"), "_NET_WM_STATE");
    xcb_intern_atom_cookie_t wm_state_above_cookie = xcb_intern_atom(connection, 0, strlen("_NET_WM_STATE_ABOVE"), "_NET_WM_STATE_ABOVE");
    xcb_intern_atom_cookie_t wm_state_skip_taskbar_cookie = xcb_intern_atom(connection, 0, strlen("_NET_WM_STATE_SKIP_TASKBAR"), "_NET_WM_STATE_SKIP_TASKBAR");

    xcb_intern_atom_reply_t *wm_state_reply = xcb_intern_atom_reply(connection, wm_state_cookie, NULL);
    xcb_intern_atom_reply_t *wm_state_above_reply = xcb_intern_atom_reply(connection, wm_state_above_cookie, NULL);
    xcb_intern_atom_reply_t *wm_state_skip_taskbar_reply = xcb_intern_atom_reply(connection, wm_state_skip_taskbar_cookie, NULL);

    if (!wm_state_reply || !wm_state_above_reply || !wm_state_skip_taskbar_reply) {
        fatal("Failed to get WM_STATE atoms");
    }

    xcb_atom_t wm_state = wm_state_reply->atom;
    xcb_atom_t wm_state_above = wm_state_above_reply->atom;
    xcb_atom_t wm_state_skip_taskbar = wm_state_skip_taskbar_reply->atom;

    xcb_change_property(connection,
                        XCB_PROP_MODE_REPLACE,
                        clone_window,
                        wm_state,
                        XCB_ATOM_ATOM,
                        32,
                        2,
                        (xcb_atom_t[]){wm_state_above, wm_state_skip_taskbar});

    free(wm_state_reply);
    free(wm_state_above_reply);
    free(wm_state_skip_taskbar_reply);

    // Make the window floating by default
    xcb_intern_atom_cookie_t window_type_cookie = xcb_intern_atom(connection, 0, strlen("_NET_WM_WINDOW_TYPE"), "_NET_WM_WINDOW_TYPE");
    xcb_intern_atom_cookie_t dialog_cookie = xcb_intern_atom(connection, 0, strlen("_NET_WM_WINDOW_TYPE_DIALOG"), "_NET_WM_WINDOW_TYPE_DIALOG");

    xcb_intern_atom_reply_t *window_type_reply = xcb_intern_atom_reply(connection, window_type_cookie, NULL);
    xcb_intern_atom_reply_t *dialog_reply = xcb_intern_atom_reply(connection, dialog_cookie, NULL);

    if (!window_type_reply || !dialog_reply) {
        fatal("Failed to get window type atoms");
    }

    xcb_atom_t window_type = window_type_reply->atom;
    xcb_atom_t dialog_type = dialog_reply->atom;

    xcb_change_property(connection,
                        XCB_PROP_MODE_REPLACE,
                        clone_window,
                        window_type,
                        XCB_ATOM_ATOM,
                        32,
                        1,
                        &dialog_type);

    free(window_type_reply);
    free(dialog_reply);


    // Map the window
    xcb_map_window(connection, clone_window);
    xcb_flush(connection);

    // Create pixmap for double buffering
    xcb_pixmap_t pixmap = xcb_generate_id(connection);
    xcb_create_pixmap(connection,
                     screen->root_depth,
                     pixmap,
                     clone_window,
                     width, height);

    printf("Starting capture and display (with xdotool click passthrough)...\n");
    printf("Click events will be forwarded using xdotool\n");

    while (running) {
        // Handle X events
        xcb_generic_event_t *event;
        while ((event = xcb_poll_for_event(connection))) {
            switch (event->response_type & ~0x80) {
                case XCB_BUTTON_PRESS: {
                    xcb_button_press_event_t *bp = (xcb_button_press_event_t *)event;
                    int absolute_click_x = slurp_x + bp->event_x;  // Use slurp coordinates directly
                    int absolute_click_y = slurp_y + bp->event_y;

                    printf("Received button press: button=%d, relative_x=%d, relative_y=%d\n",
                           bp->detail, bp->event_x, bp->event_y);
                    printf("Forwarding click to absolute coordinates: x=%d, y=%d\n",
                           absolute_click_x, absolute_click_y);

                    // Forward click using absolute coordinates
                    senxdod_click_xdotool(source_window, bp->detail,
                                     absolute_click_x,
                                     absolute_click_y);
                    break;
                }
            }
            free(event);
        }

        // Capture source window content using relative coordinates
        xcb_get_image_cookie_t img_cookie = xcb_get_image(
            connection, XCB_IMAGE_FORMAT_Z_PIXMAP,
            source_window, relative_x, relative_y, width, height, ~0);

        xcb_get_image_reply_t *img_reply = xcb_get_image_reply(connection, img_cookie, NULL);
        if (!img_reply) {
            fprintf(stderr, "Failed to get image\n");
            break;
        }

        // Put image data into pixmap
        xcb_put_image(connection,
                     XCB_IMAGE_FORMAT_Z_PIXMAP,
                     pixmap,
                     gc,
                     width,
                     height,
                     0, 0, 0,
                     screen->root_depth,
                     xcb_get_image_data_length(img_reply),
                     xcb_get_image_data(img_reply));

        // Copy pixmap to window
        xcb_copy_area(connection,
                     pixmap,
                     clone_window,
                     gc,
                     0, 0,
                     0, 0,
                     width, height);

        xcb_flush(connection);
        free(img_reply);

        usleep(16666);  // Target ~60 FPS
    }

    // Cleanup
    xcb_free_pixmap(connection, pixmap);
    xcb_free_gc(connection, gc);
    xcb_destroy_window(connection, clone_window);
    xcb_disconnect(connection);
    printf("\nCapture stopped\n");

    return 0;
}
