; Step 02: add player cannon silhouette and four bunker blocks.
; Quick validation target: lit pixel count grows versus step 01.

.org 0x0000

start:
    ; Clear VRAM.
    lxi h, 0x2400
clear_loop:
    mvi m, 0x00
    inx h
    mov a, h
    cpi 0x40
    jnz clear_loop

    ; Player cannon (3 narrow columns).
    lxi h, 0x31ff
    mvi m, 0x03
    inx h
    mvi m, 0x07
    inx h
    mvi m, 0x03

    ; Bunker 1
    lxi h, 0x2906
    mvi m, 0x3C
    inx h
    mvi m, 0x3C

    ; Bunker 2
    lxi h, 0x2E06
    mvi m, 0x3C
    inx h
    mvi m, 0x3C

    ; Bunker 3
    lxi h, 0x3306
    mvi m, 0x3C
    inx h
    mvi m, 0x3C

    ; Bunker 4
    lxi h, 0x3806
    mvi m, 0x3C
    inx h
    mvi m, 0x3C

hang:
    jmp hang
