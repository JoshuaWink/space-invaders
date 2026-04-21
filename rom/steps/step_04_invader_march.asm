; Step 04: invader march loop between two nearby horizontal positions.
; Quick validation target: lit pixel count stays in the same band as step 03,
; while behavior now includes visible movement.

.org 0x0000

start:
    ; Initialize stack for CALL/RET routines in RAM below VRAM.
    lxi sp, 0x23FF

    ; Draw initial static scene.
    call clear_vram
    call draw_player_and_bunkers

    ; Phase flag at RAM[0x2000]: 0 = left position, 1 = right position.
    mvi a, 0x00
    sta 0x2000
    call draw_invaders_left

main_loop:
    call delay_tick

    ; Toggle invader position each tick.
    lda 0x2000
    ani 0x01
    jz move_right

move_left:
    call erase_invaders_right
    call draw_invaders_left
    mvi a, 0x00
    sta 0x2000
    jmp main_loop

move_right:
    call erase_invaders_left
    call draw_invaders_right
    mvi a, 0x01
    sta 0x2000
    jmp main_loop

clear_vram:
    lxi h, 0x2400
clear_loop:
    mvi m, 0x00
    inx h
    mov a, h
    cpi 0x40
    jnz clear_loop
    ret

draw_player_and_bunkers:
    ; Player cannon
    lxi h, 0x31FF
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
    ; Shift right by one column (+0x20 in VRAM addressing).
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
    ; Keep most cycles in a stable displayed state so probe snapshots are consistent.
    mvi b, 0x18
delay_outer:
    mvi c, 0xFF
delay_inner:
    dcr c
    jnz delay_inner
    dcr b
    jnz delay_outer
    ret