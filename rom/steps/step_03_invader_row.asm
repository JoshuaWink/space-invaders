; Step 03: add a static invader row inspired by the original formation.
; Quick validation target: lit pixel count rises significantly.

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

    ; Player cannon
    lxi h, 0x31ff
    mvi m, 0x03
    inx h
    mvi m, 0x07
    inx h
    mvi m, 0x03

    ; Bunkers
    lxi h, 0x2906
    mvi m, 0x3C
    inx h
    mvi m, 0x3C

    lxi h, 0x2E06
    mvi m, 0x3C
    inx h
    mvi m, 0x3C

    lxi h, 0x3306
    mvi m, 0x3C
    inx h
    mvi m, 0x3C

    lxi h, 0x3806
    mvi m, 0x3C
    inx h
    mvi m, 0x3C

    ; Invader row: 10 sprites, each 2 bytes tall, spaced by 12 columns.
    lxi h, 0x2715
    lxi d, 0x0180
    mvi b, 10
invader_loop:
    mvi m, 0x3C
    inx h
    mvi m, 0x7E
    dcx h
    dad d
    dcr b
    jnz invader_loop

hang:
    jmp hang
