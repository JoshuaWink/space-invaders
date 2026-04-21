; Step 05: add input-driven player movement while keeping marching invaders.
; Quick validation target: lit pixel count remains in the invader+player band.

.org 0x0000

start:
    ; Stack and scene init.
    lxi sp, 0x23FF
    call clear_vram

    ; Player pointer in RAM[0x2002..0x2003].
    lxi h, 0x31FF
    shld 0x2002
    call draw_player_and_bunkers

    ; Invader phase in RAM[0x2000]: 0 = left, 1 = right.
    mvi a, 0x00
    sta 0x2000
    call draw_invaders_left

main_loop:
    call delay_tick
    call handle_player_input
    call march_invaders
    jmp main_loop

handle_player_input:
    ; Read controls from port 1.
    in 0x01
    mov b, a

    ; Left = bit 5.
    mov a, b
    ani 0x20
    jz check_right
    call move_player_left

check_right:
    ; Right = bit 6.
    mov a, b
    ani 0x40
    jz input_done
    call move_player_right

input_done:
    ret

move_player_left:
    lhld 0x2002
    mov a, h
    cpi 0x30
    jz left_done
    call erase_player_from_hl
    lxi d, 0xFFE0
    dad d
    shld 0x2002
    call draw_player_from_ptr
left_done:
    ret

move_player_right:
    lhld 0x2002
    mov a, h
    cpi 0x33
    jz right_done
    call erase_player_from_hl
    lxi d, 0x0020
    dad d
    shld 0x2002
    call draw_player_from_ptr
right_done:
    ret

erase_player_from_hl:
    mvi m, 0x00
    inx h
    mvi m, 0x00
    inx h
    mvi m, 0x00
    ret

draw_player_from_ptr:
    lhld 0x2002
    mvi m, 0x03
    inx h
    mvi m, 0x07
    inx h
    mvi m, 0x03
    ret

draw_player_and_bunkers:
    call draw_player_from_ptr

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
    ret

march_invaders:
    lda 0x2000
    ani 0x01
    jz move_right

move_left:
    call erase_invaders_right
    call draw_invaders_left
    mvi a, 0x00
    sta 0x2000
    ret

move_right:
    call erase_invaders_left
    call draw_invaders_right
    mvi a, 0x01
    sta 0x2000
    ret

clear_vram:
    lxi h, 0x2400
clear_loop:
    mvi m, 0x00
    inx h
    mov a, h
    cpi 0x40
    jnz clear_loop
    ret

draw_invaders_left:
    lxi h, 0x2715
    lxi d, 0x0180
    mvi b, 10
draw_left_loop:
    mvi m, 0x3C
    inx h
    mvi m, 0x7E
    dcx h
    dad d
    dcr b
    jnz draw_left_loop
    ret

erase_invaders_left:
    lxi h, 0x2715
    lxi d, 0x0180
    mvi b, 10
erase_left_loop:
    mvi m, 0x00
    inx h
    mvi m, 0x00
    dcx h
    dad d
    dcr b
    jnz erase_left_loop
    ret

draw_invaders_right:
    lxi h, 0x2735
    lxi d, 0x0180
    mvi b, 10
draw_right_loop:
    mvi m, 0x3C
    inx h
    mvi m, 0x7E
    dcx h
    dad d
    dcr b
    jnz draw_right_loop
    ret

erase_invaders_right:
    lxi h, 0x2735
    lxi d, 0x0180
    mvi b, 10
erase_right_loop:
    mvi m, 0x00
    inx h
    mvi m, 0x00
    dcx h
    dad d
    dcr b
    jnz erase_right_loop
    ret

delay_tick:
    mvi b, 0x18
delay_outer:
    mvi c, 0xFF
delay_inner:
    dcr c
    jnz delay_inner
    dcr b
    jnz delay_outer
    ret
