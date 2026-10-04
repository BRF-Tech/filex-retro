; DOSPROBE.COM - a tiny DOS program written for the DOS player's tests, so no
; third-party game is needed. Build: nasm -f bin -o DOSPROBE.COM probe.asm
;
; - mode 13h; the screen is redrawn with shifting colour bands every timer
;   tick (about 18 times a second), so a test sees frames change;
; - the top 20 rows say what the program knows of SAVE.TXT: black when there
;   was none when it started, green (colour 2) when SAVE.TXT was there when it
;   started (a saved bundle, opened again), red (colour 4) once W wrote it;
; - the PC speaker beeps on and off every 32 frames (a sound to look for);
; - W writes SAVE.TXT ("SAVED") in the current directory: a file the player
;   has to carry back into the bundle; D deletes it (the top band goes black);
; - Esc returns to text mode and exits.
        org 100h

start:
        mov ax, 3D00h
        mov dx, fname
        int 21h
        jc .fresh
        mov bx, ax
        mov ah, 3Eh
        int 21h
        mov byte [marker], 2
.fresh:
        mov ax, 13h
        int 10h

main:
        mov ax, 0A000h
        mov es, ax
        xor di, di
        mov al, [marker]
        mov cx, 320 * 20
        rep stosb
        mov dx, 180
        mov bl, [frame]
row:
        mov al, bl
        mov cx, 320
        rep stosb
        inc bl
        dec dx
        jnz row
        inc byte [frame]

        push ds
        mov ax, 40h
        mov ds, ax
        mov ax, [6Ch]
tick:
        cmp ax, [6Ch]
        je tick
        pop ds

        mov al, [frame]
        test al, 20h
        jz spk_off
        mov al, 0B6h
        out 43h, al
        mov al, 98h
        out 42h, al
        mov al, 0Ah
        out 42h, al
        in al, 61h
        or al, 3
        out 61h, al
        jmp keys
spk_off:
        in al, 61h
        and al, 0FCh
        out 61h, al

keys:
        mov ah, 1
        int 16h
        jz main
        mov ah, 0
        int 16h
        cmp al, 27
        je quit
        cmp al, 'w'
        je write
        cmp al, 'W'
        je write
        cmp al, 'd'
        je delete
        cmp al, 'D'
        je delete
        jmp main

delete:
        mov ah, 41h
        mov dx, fname
        int 21h
        jc main
        mov byte [marker], 0
        jmp main

write:
        mov ah, 3Ch
        xor cx, cx
        mov dx, fname
        int 21h
        jc main
        mov bx, ax
        mov ah, 40h
        mov cx, msglen
        mov dx, msg
        int 21h
        mov ah, 3Eh
        int 21h
        mov byte [marker], 4
        jmp main

quit:
        in al, 61h
        and al, 0FCh
        out 61h, al
        mov ax, 3
        int 10h
        mov ax, 4C00h
        int 21h

frame   db 0
marker  db 0
fname   db 'SAVE.TXT', 0
msg     db 'SAVED', 13, 10
msglen  equ $ - msg
