// Definitions behind retro_compat.h (filex-retro, GPL-2.0-only): the small
// helpers Chocolate Doom 3.1.1 has and doomgeneric's copy does not.

#include <stdio.h>
#include <stdlib.h>

#include "retro_compat.h"
#include "i_system.h"

FILE *M_fopen(const char *filename, const char *mode)
{
    return fopen(filename, mode);
}

int M_remove(const char *path)
{
    return remove(path);
}

void *I_Realloc(void *ptr, size_t size)
{
    void *next = realloc(ptr, size);

    if (size != 0 && next == NULL)
    {
        I_Error("I_Realloc: failed on reallocation of %zu bytes", size);
    }
    return next;
}
