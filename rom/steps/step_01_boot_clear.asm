; Step 01: boot + clear VRAM + draw a tiny player marker.
; Quick validation target: lit pixel count should be very small (>0).

.org 0x0000

start:
    ; Clear VRAM range 0x2400..0x3FFF by iterating HL until H == 0x40.
    lxi h, 0x2400
clear_loop:
    mvi m, 0x00
    inx h
    mov a, h
    cpi 0x40
    jnz clear_loop

    ; Draw a tiny player marker near bottom-center.
    lxi h, 0x3200
    mvi m, 0x18

hang:
    jmp hang
