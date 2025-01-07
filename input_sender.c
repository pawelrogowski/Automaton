#include <X11/Xlib.h>
#include <X11/extensions/XTest.h>
#include <X11/keysym.h>
#include <X11/XKBlib.h>
#include <string.h>
#include <stdio.h>
#include <stdlib.h>
#include <unistd.h>
#include <time.h>

void send_keypress(Display *display, KeyCode keycode, Window target_window) {
    XEvent event;
    memset(&event, 0, sizeof(event));

    XkbStateRec state;
    XkbGetState(display, XkbUseCoreKbd, &state);

    event.type = KeyPress;
    event.xkey.display = display;
    event.xkey.window = target_window;
    event.xkey.root = XDefaultRootWindow(display);
    event.xkey.subwindow = None;
    event.xkey.time = CurrentTime;
    event.xkey.x = 1;
    event.xkey.y = 1;
    event.xkey.x_root = 1;
    event.xkey.y_root = 1;
    event.xkey.same_screen = True;
    event.xkey.keycode = keycode;
    event.xkey.state = state.group;

    XSendEvent(display, target_window, True, KeyPressMask, &event);
    XSync(display, False);

    event.type = KeyRelease;
    XSendEvent(display, target_window, True, KeyReleaseMask, &event);
    XSync(display, False);
}

void send_synthetic_click(Display *display, Window target_window, int x, int y) {
    XEvent event;
    memset(&event, 0, sizeof(event));

    event.type = ButtonPress;
    event.xbutton.display = display;
    event.xbutton.window = target_window;
    event.xbutton.root = XDefaultRootWindow(display);
    event.xbutton.subwindow = None;
    event.xbutton.time = CurrentTime;
    event.xbutton.x = x;
    event.xbutton.y = y;
    event.xbutton.x_root = x;
    event.xbutton.y_root = y;
    event.xbutton.same_screen = True;
    event.xbutton.button = Button1;
    event.xbutton.state = 0;

    XSendEvent(display, target_window, True, ButtonPressMask, &event);
    XSync(display, False);
    event.type = ButtonRelease;
    XSendEvent(display, target_window, True, ButtonReleaseMask, &event);
    XSync(display, False);
}

int main(int argc, char *argv[]) {
    if (argc != 5) {
        printf("Usage: %s <window_id> <key> <x> <y>\n", argv[0]);
        return 1;
    }

    struct timespec start, end;
    clock_gettime(CLOCK_MONOTONIC, &start);

    Display *display = XOpenDisplay(NULL);
    if (!display) {
        fprintf(stderr, "Cannot open display\n");
        return 1;
    }

    Window target_window = (Window)strtoul(argv[1], NULL, 10);
    int x = atoi(argv[3]);
    int y = atoi(argv[4]);

    KeySym keysym = XStringToKeysym(argv[2]);
    if (keysym == NoSymbol) {
        fprintf(stderr, "Invalid key: %s\n", argv[2]);
        XCloseDisplay(display);
        return 1;
    }
    KeyCode keycode = XKeysymToKeycode(display, keysym);

    send_keypress(display, keycode, target_window);
    send_synthetic_click(display, target_window, x, y);

    XCloseDisplay(display);

    clock_gettime(CLOCK_MONOTONIC, &end);
    double elapsed_time = (end.tv_sec - start.tv_sec) +
                         (end.tv_nsec - start.tv_nsec) / 1e9;
    printf("Execution Time: %.6f seconds\n", elapsed_time);

    return 0;
}