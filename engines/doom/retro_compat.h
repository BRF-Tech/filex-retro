// What Chocolate Doom 3.1.1's OPL music code (i_oplmusic.c, midifile.c)
// expects from the rest of Chocolate Doom and doomgeneric's older copy
// does not have. Force-included (-include) into those two files only;
// the definitions are in retro_compat.c (filex-retro, GPL-2.0-only).

#ifndef RETRO_COMPAT_H
#define RETRO_COMPAT_H

#include <stddef.h>
#include <stdio.h>

// Chocolate Doom 3.x's i_swap.h includes SDL_endian.h; midifile.c reads
// big-endian MIDI with SDL_SwapBE16/32.
#include <SDL_endian.h>

// doomtype.h in Chocolate Doom 3.x (PACKEDATTR itself is in doomgeneric's).
#define PACKED_STRUCT(...) struct __VA_ARGS__ PACKEDATTR

FILE *M_fopen(const char *filename, const char *mode);
int M_remove(const char *path);
void *I_Realloc(void *ptr, size_t size);

// i_sound.h in Chocolate Doom 3.x
typedef enum
{
    opl_doom1_1_666,
    opl_doom2_1_666,
    opl_doom_1_9
} opl_driver_ver_t;

void I_SetOPLDriverVer(opl_driver_ver_t ver);
extern char *snd_dmxoption;

#endif
