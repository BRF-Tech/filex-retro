// Retro's platform layer for doomgeneric: the DOOM-engine player in a filex
// app frame (filex-retro, GPL-2.0-only).
//
// doomgeneric asks its platform for six things (doomgeneric.h); this file
// answers them for a browser page that drives the engine from JavaScript:
//
//   DG_DrawFrame      hands the 320x200 frame to the page (Module.retroDraw),
//                     which puts it on a 2D canvas - no WebGL, no SDL video;
//   DG_SleepMs        returns at once: the engine never waits on the page's
//                     only thread (the upstream port's SDL_Delay busy-waits);
//   DG_GetTicksMs     the page's clock, minus the time spent paused, so a
//                     paused game does not run its missed tics on return;
//   DG_GetKey         keys the page queued with retro_key();
//   DG_SetWindowTitle the game's name, to the page (Module.retroTitle).
//
// and tells the page when the engine exits (Module.retroExit).
//
// The main loop runs a tic only when the 35 Hz game clock has moved (one
// animation frame at 60 Hz or more often runs nothing), and nothing while
// paused or after the game quit. Sound is SDL_mixer's: effects through its
// channels, music through Chocolate Doom's OPL emulation (opl_sdl.c, added
// as a post-mix effect). The page switches each off and on with
// retro_set_sfx() / retro_set_music().

#include <stdint.h>
#include <stdio.h>

#include <emscripten.h>
#include <SDL_mixer.h>

#include "doomgeneric.h"
#include "m_config.h"

extern int I_GetTime(void);

// Read by opl_sdl.c (patch 0003): while set, the OPL chip is not rendered.
int retro_opl_muted = 0;

static int sfx_muted = 0;
static int halted = 0;
static int last_tic = -1;
static double paused_at = -1.0;
static double paused_total = 0.0;

#define KEYQUEUE_SIZE 64
static unsigned short key_queue[KEYQUEUE_SIZE];
static unsigned int key_write = 0;
static unsigned int key_read = 0;

EM_JS(void, retro_js_draw, (const uint32_t *buffer, int width, int height), {
  if (Module.retroDraw) Module.retroDraw(buffer, width, height);
});

EM_JS(void, retro_js_title, (const char *title), {
  if (Module.retroTitle) Module.retroTitle(UTF8ToString(title));
});

EM_JS(void, retro_js_exit, (int code), {
  if (Module.retroExit) Module.retroExit(code);
});

void DG_Init(void)
{
}

void DG_DrawFrame(void)
{
    retro_js_draw(DG_ScreenBuffer, DOOMGENERIC_RESX, DOOMGENERIC_RESY);
}

void DG_SleepMs(uint32_t ms)
{
    (void) ms;
}

uint32_t DG_GetTicksMs(void)
{
    double now = paused_at >= 0.0 ? paused_at : emscripten_get_now();
    return (uint32_t) (now - paused_total);
}

int DG_GetKey(int *pressed, unsigned char *key)
{
    unsigned short data;

    if (key_read == key_write)
    {
        return 0;
    }
    data = key_queue[key_read];
    key_read = (key_read + 1) % KEYQUEUE_SIZE;
    *pressed = data >> 8;
    *key = data & 0xff;
    return 1;
}

void DG_SetWindowTitle(const char *title)
{
    retro_js_title(title);
}

static void apply_sfx(void)
{
    int freq;
    Uint16 format;
    int channels;

    if (Mix_QuerySpec(&freq, &format, &channels))
    {
        Mix_Volume(-1, sfx_muted ? 0 : MIX_MAX_VOLUME);
    }
}

// A key from the page: `key` is a DOOM key code (doomkeys.h, or lower-case
// ASCII). A full queue drops the key rather than overwrite an unread one.
EMSCRIPTEN_KEEPALIVE void retro_key(int pressed, int key)
{
    unsigned int next = (key_write + 1) % KEYQUEUE_SIZE;

    if (next == key_read)
    {
        return;
    }
    key_queue[key_write] = (unsigned short) (((pressed ? 1 : 0) << 8) | (key & 0xff));
    key_write = next;
}

EMSCRIPTEN_KEEPALIVE void retro_pause(int on)
{
    double now = emscripten_get_now();

    if (on && paused_at < 0.0)
    {
        paused_at = now;
    }
    else if (!on && paused_at >= 0.0)
    {
        paused_total += now - paused_at;
        paused_at = -1.0;
    }
}

EMSCRIPTEN_KEEPALIVE void retro_set_music(int on)
{
    retro_opl_muted = !on;
}

EMSCRIPTEN_KEEPALIVE void retro_set_sfx(int on)
{
    sfx_muted = !on;
    apply_sfx();
}

// Writes default.cfg and doomgeneric.cfg now (the engine does it only on
// quit), so a pack saved mid-game keeps the person's keys and volumes.
EMSCRIPTEN_KEEPALIVE void retro_save_config(void)
{
    M_SaveDefaults();
}

// The game quit (or failed): nothing runs any more.
EMSCRIPTEN_KEEPALIVE void retro_halt(void)
{
    halted = 1;
    emscripten_cancel_main_loop();
}

// The engine leaves through exit(): the menu's Quit (I_Quit, 0) and every
// fatal error (I_Error, -1, its message already on stderr). The link wraps
// exit (-Wl,--wrap=exit) so the page hears of it - Emscripten tells the page
// nothing while a main loop keeps the runtime alive - and the loop stops;
// then the real exit unwinds the engine's stack as usual.
void __real_exit(int status) __attribute__((noreturn));

void __wrap_exit(int status)
{
    retro_halt();
    retro_js_exit(status);
    __real_exit(status);
}

static void tick(void)
{
    int now;

    if (halted || paused_at >= 0.0)
    {
        return;
    }
    now = I_GetTime();
    if (now == last_tic)
    {
        return;
    }
    last_tic = now;
    doomgeneric_Tick();
}

int main(int argc, char **argv)
{
    doomgeneric_Create(argc, argv);
    apply_sfx();
    emscripten_set_main_loop(tick, 0, 1);
    return 0;
}
