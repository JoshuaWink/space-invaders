; Step 06: add player fire + bullet travel + basic hit clearing.
; Quick validation target: lit pixel count remains stable without input.

.org 0x0000

start:
    ; Stack and scene init.
    lxi sp, 0x23FF
    call clear_vram

    ; Player pointer in RAM[0x2002..0x2003].
    lxi h, 0x31FF
    shld 0x2002
    call draw_player_and_bunkers

    ; Bullet state.
    mvi a, 0x00
    sta 0x2006

    ; Invader phase in RAM[0x2000]: 0 = left, 1 = right.
    mvi a, 0x00
    sta 0x2000
    call draw_invaders_left

main_loop:
    call delay_tick
    call handle_player_input
    call handle_fire_and_bullet
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

handle_fire_and_bullet:
    lda 0x2006
    ani 0x01
    jz maybe_spawn
    call advance_bullet
    ret

maybe_spawn:
    in 0x01
    ani 0x10
    jz fire_done
    call spawn_bullet

fire_done:
    ret

spawn_bullet:
    ; Spawn above the player center.
    lhld 0x2002
    inx h
    lxi d, 0xFC00
    dad d
    shld 0x2004
    mvi a, 0x01
    sta 0x2006
    lhld 0x2004
    mvi m, 0x18
    ret

advance_bullet:
    ; Erase previous bullet position.
    lhld 0x2004
    mvi m, 0x00

    ; Move upward.
    dcx h
    shld 0x2004

    ; Off-screen top.
    mov a, h
    cpi 0x24
    jc bullet_off

    ; Basic hit detect: any lit byte is a hit.
    mov a, m
    cpi 0x00
    jz draw_bullet

    ; Clear target byte and deactivate bullet.
    mvi m, 0x00
    mvi a, 0x00
    sta 0x2006
    ret

draw_bullet:
    mvi m, 0x18
    ret

bullet_off:
    mvi a, 0x00
    sta 0x2006
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
