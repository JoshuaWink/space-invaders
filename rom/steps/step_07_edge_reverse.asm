; Step 07: fuller playable homebrew loop.
; Adds persistent invader kills, player score, enemy fire, UFO sweeps,
; and timed win/lose reset while keeping the simple clean-room sprite set.

.org 0x0000
    jmp start          ; jump past interrupt vector table

; RST 1 — mid-screen interrupt (fired by machine at half-frame)
.org 0x0008
rst1_handler:
    ei
    ret

; RST 2 — end-of-frame interrupt (fired by machine at full-frame)
.org 0x0010
rst2_handler:
    ei
    ret

; Main entry point — past all RST vectors
.org 0x0040
start:
    lxi sp, 0x23FF
    call init_game
    ei

main_loop:
    call delay_tick

    lda 0x200D
    ani 0xFF
    jz play_frame
    call tick_end_state
    jmp main_loop

play_frame:
    call handle_player_input
    call handle_fire_and_bullet
    lda 0x2020
    ani 0xFF
    jz do_enemy_fire
    dcr a
    sta 0x2020
    jmp skip_enemy_fire
do_enemy_fire:
    mvi a, 0x08
    sta 0x2020
    call handle_enemy_fire
skip_enemy_fire:
    lda 0x2023
    ani 0xFF
    jz do_march_step
    dcr a
    sta 0x2023
    jmp skip_march_step
do_march_step:
    mvi a, 0x80
    sta 0x2023
    call march_invaders
skip_march_step:
    lda 0x2022
    ani 0xFF
    jz do_update_ufo
    dcr a
    sta 0x2022
    jmp skip_ufo
do_update_ufo:
    mvi a, 0x60
    sta 0x2022
    call update_ufo
skip_ufo:
    call check_fleet_reach_player
    jmp main_loop

init_game:
    call clear_vram


    lxi h, 0x3182
    shld 0x2002

    xra a
    sta 0x2006
    sta 0x200A
    sta 0x200D
    sta 0x200E
    sta 0x200F
    sta 0x2012
    sta 0x2013
    sta 0x2017
    sta 0x2019
    sta 0x201B
    sta 0x201E
    sta 0x201F
    sta 0x2020
    sta 0x2021
    sta 0x2022
    sta 0x2023
    sta 0x2024
    sta 0x2025
    sta 0x2026

    mvi a, 0x01
    sta 0x2026

    mvi a, 0x59
    sta 0x200B
    mvi a, 0x03
    sta 0x200C

    lxi h, 0x2696
    shld 0x2010

    mvi a, 0xFF
    sta 0x2014
    sta 0x2024
    sta 0x2025
    mvi a, 0x80
    sta 0x2018
    call set_march_timer_from_alive

    call draw_bunkers
    call draw_player_from_ptr
    call draw_invaders_from_base
    ret

tick_end_state:
    lda 0x2019
    ani 0xFF
    jz restart_round
    dcr a
    sta 0x2019
    ret

restart_round:
    call init_game
    ret

handle_player_input:
    lda 0x201B
    ani 0xFF
    jz poll_player_input
    dcr a
    sta 0x201B
    ret

poll_player_input:
    mvi a, 0x12
    sta 0x201B
    in 0x01
    mov b, a

    mov a, b
    ani 0x20
    jz check_right
    call move_player_left

check_right:
    mov a, b
    ani 0x40
    jz input_done
    call move_player_right

input_done:
    ret

handle_fire_and_bullet:
    lda 0x2006
    ani 0x01
    jz maybe_spawn_player_bullet
    lda 0x201E
    ani 0xFF
    jz fire_advance_bullet
    dcr a
    sta 0x201E
    ret

fire_advance_bullet:
    mvi a, 0x08
    sta 0x201E
    call advance_player_bullet
    ret

maybe_spawn_player_bullet:
    in 0x01
    ani 0x10
    jz player_fire_done
    call spawn_player_bullet

player_fire_done:
    ret

spawn_player_bullet:
    lhld 0x2002
    lxi d, 0x0060
    dad d
    inx h
    shld 0x2004
    mvi a, 0x01
    sta 0x2006
    lhld 0x2004
    mvi m, 0x18
    ret

advance_player_bullet:
    lhld 0x2004
    mvi m, 0x00

    mov a, l
    ani 0x1F
    cpi 0x1F
    jz player_bullet_off

    inx h
    shld 0x2004

    call player_bullet_hits_ufo
    cpi 0x01
    jz consume_player_bullet

    call player_bullet_hits_invader
    cpi 0x01
    jz consume_player_bullet

    call bullet_hits_bunker
    cpi 0x01
    jz consume_player_bullet

    mvi m, 0x18
    ret

consume_player_bullet:
player_bullet_off:
    mvi a, 0x00
    sta 0x2006
    ret

player_bullet_hits_ufo:
    push d
    lda 0x2017
    ani 0x01
    jz no_ufo_hit

    push h
    lhld 0x2015
    mov d, h
    mov e, l
    pop h
    call pointer_hits_8col_sprite
    cpi 0x01
    jnz no_ufo_hit

    lhld 0x2015
    call erase_8col_sprite
    xra a
    sta 0x2017
    mvi a, 0x70
    sta 0x2018
    call add_score_fifty
    pop d
    mvi a, 0x01
    ret

no_ufo_hit:
    pop d
    xra a
    ret

player_bullet_hits_invader:
    call hit_invader_row_top
    cpi 0x01
    jz player_hit_top_score

    call hit_invader_row_mid
    cpi 0x01
    jz player_hit_mid_score

    call hit_invader_row_bottom
    cpi 0x01
    jz player_hit_bottom_score

    xra a
    ret

player_hit_top_score:
    call add_score_thirty
    jmp player_hit_finalize

player_hit_mid_score:
    call add_score_twenty
    jmp player_hit_finalize

player_hit_bottom_score:
    call add_score_ten

player_hit_finalize:
    call check_all_invaders_dead
    cpi 0x01
    jnz player_hit_return_one
    mvi a, 0x01
    sta 0x200D
    mvi a, 0x40
    sta 0x2019

player_hit_return_one:
    mvi a, 0x01
    ret

hit_invader_row_top:
    lhld 0x2010
    inx h
    inx h
    inx h
    inx h
    mvi b, 0x08
    mvi c, 0x01

player_hit_top_loop:
    push b
    push h
    lda 0x2025
    ana c
    jz player_hit_top_skip

    lhld 0x2004
    pop d
    push d
    call pointer_hits_8col_sprite
    cpi 0x01
    jz player_hit_top_found

player_hit_top_skip:
    pop h
    lxi d, 0x0180
    dad d
    mov a, c
    add a
    mov c, a
    pop b
    dcr b
    jnz player_hit_top_loop

    xra a
    ret

player_hit_top_found:
    pop h
    push b
    call erase_8col_sprite
    pop b
    mov a, c
    cma
    mov d, a
    lda 0x2025
    ana d
    sta 0x2025
    pop b
    mvi a, 0x01
    ret

hit_invader_row_mid:
    lhld 0x2010
    inx h
    inx h
    mvi b, 0x08
    mvi c, 0x01

player_hit_mid_loop:
    push b
    push h
    lda 0x2024
    ana c
    jz player_hit_mid_skip

    lhld 0x2004
    pop d
    push d
    call pointer_hits_8col_sprite
    cpi 0x01
    jz player_hit_mid_found

player_hit_mid_skip:
    pop h
    lxi d, 0x0180
    dad d
    mov a, c
    add a
    mov c, a
    pop b
    dcr b
    jnz player_hit_mid_loop

    xra a
    ret

player_hit_mid_found:
    pop h
    push b
    call erase_8col_sprite
    pop b
    mov a, c
    cma
    mov d, a
    lda 0x2024
    ana d
    sta 0x2024
    pop b
    mvi a, 0x01
    ret

hit_invader_row_bottom:
    lhld 0x2010
    mvi b, 0x08
    mvi c, 0x01

player_hit_bottom_loop:
    push b
    push h
    lda 0x2014
    ana c
    jz player_hit_bottom_skip

    lhld 0x2004
    pop d
    push d
    call pointer_hits_8col_sprite
    cpi 0x01
    jz player_hit_bottom_found

player_hit_bottom_skip:
    pop h
    lxi d, 0x0180
    dad d
    mov a, c
    add a
    mov c, a
    pop b
    dcr b
    jnz player_hit_bottom_loop

    xra a
    ret

player_hit_bottom_found:
    pop h
    push b
    call erase_8col_sprite
    pop b
    mov a, c
    cma
    mov d, a
    lda 0x2014
    ana d
    sta 0x2014
    pop b
    mvi a, 0x01
    ret

check_all_invaders_dead:
    lda 0x2014
    mov b, a
    lda 0x2024
    ora b
    mov b, a
    lda 0x2025
    ora b
    ani 0xFF
    jz invaders_all_dead
    xra a
    ret

invaders_all_dead:
    mvi a, 0x01
    ret

check_player_lane_score:
    push b
    push d
    lhld 0x2002
    lxi d, 0x0060
    dad d
    push h
    lhld 0x2010
    mov a, l
    ani 0x1F
    mov b, a
    pop h
    mov a, l
    ani 0xE0
    ora b
    mov l, a
    shld 0x201C

    lhld 0x2010
    mvi b, 0x08
    mvi c, 0x01

lane_score_loop:
    push b
    push h
    lda 0x2014
    ana c
    jz lane_score_skip

    lhld 0x201C
    pop d
    push d
    call pointer_hits_8col_sprite
    cpi 0x01
    jz lane_score_hit

lane_score_skip:
    pop h
    lxi d, 0x0180
    dad d
    mov a, c
    add a
    mov c, a
    pop b
    dcr b
    jnz lane_score_loop

    pop d
    pop b
    ret

lane_score_hit:
    pop h
    call erase_8col_sprite
    call clear_one_invader
    call add_score_ten

    lda 0x2014
    cpi 0x00
    jnz lane_score_done
    mvi a, 0x01
    sta 0x200D
    mvi a, 0x40
    sta 0x2019

lane_score_done:
    pop b
    pop d
    pop b
    ret

clear_one_invader:
    lda 0x2014
    ani 0x80
    jz clear_invader_40
    lda 0x2014
    ani 0x7F
    sta 0x2014
    ret

clear_invader_40:
    lda 0x2014
    ani 0x40
    jz clear_invader_20
    lda 0x2014
    ani 0xBF
    sta 0x2014
    ret

clear_invader_20:
    lda 0x2014
    ani 0x20
    jz clear_invader_10
    lda 0x2014
    ani 0xDF
    sta 0x2014
    ret

clear_invader_10:
    lda 0x2014
    ani 0x10
    jz clear_invader_08
    lda 0x2014
    ani 0xEF
    sta 0x2014
    ret

clear_invader_08:
    lda 0x2014
    ani 0x08
    jz clear_invader_04
    lda 0x2014
    ani 0xF7
    sta 0x2014
    ret

clear_invader_04:
    lda 0x2014
    ani 0x04
    jz clear_invader_02
    lda 0x2014
    ani 0xFB
    sta 0x2014
    ret

clear_invader_02:
    lda 0x2014
    ani 0x02
    jz clear_invader_01
    lda 0x2014
    ani 0xFD
    sta 0x2014
    ret

clear_invader_01:
    lda 0x2014
    ani 0xFE
    sta 0x2014
    ret

handle_enemy_fire:
    lda 0x200A
    ani 0x01
    jz maybe_spawn_enemy_bullet
    lda 0x201F
    ani 0xFF
    jz enemy_advance_bullet
    dcr a
    sta 0x201F
    ret

enemy_advance_bullet:
    mvi a, 0x14
    sta 0x201F
    call advance_enemy_bullet
    ret

maybe_spawn_enemy_bullet:
    lda 0x200B
    ani 0xFF
    jz spawn_enemy_bullet
    dcr a
    sta 0x200B
    ret

spawn_enemy_bullet:
    call check_all_invaders_dead
    cpi 0x01
    jz reset_enemy_timer

    call find_player_lane_enemy_slot
    cpi 0x01
    jz enemy_slot_found_aimed

    lda 0x2026
    ani 0xFF
    jnz shooter_mask_ready
    mvi a, 0x01

shooter_mask_ready:
    mov c, a
    mvi b, 0x08

find_enemy_column:
    lda 0x2014
    ana c
    jnz enemy_slot_bottom
    lda 0x2024
    ana c
    jnz enemy_slot_mid
    lda 0x2025
    ana c
    jnz enemy_slot_top
    call advance_enemy_shooter_mask_in_c
    dcr b
    jnz find_enemy_column
    jmp reset_enemy_timer

enemy_slot_bottom:
    call enemy_ptr_bottom_from_c
    jmp enemy_slot_found

enemy_slot_mid:
    call enemy_ptr_mid_from_c
    jmp enemy_slot_found

enemy_slot_top:
    call enemy_ptr_top_from_c
    jmp enemy_slot_found

find_player_lane_enemy_slot:
    push b
    push d
    call find_player_lane_bottom
    cpi 0x01
    jz find_player_lane_done
    call find_player_lane_mid
    cpi 0x01
    jz find_player_lane_done
    call find_player_lane_top

find_player_lane_done:
    pop d
    pop b
    ret

set_player_lane_ptr_for_hl:
    mov a, l
    ani 0x1F
    mov b, a
    push h
    lhld 0x2002
    lxi d, 0x0060
    dad d
    mov a, l
    ani 0xE0
    ora b
    mov l, a
    shld 0x201C
    pop h
    ret

find_player_lane_bottom:
    lhld 0x2010
    call set_player_lane_ptr_for_hl
    mvi b, 0x08
    mvi c, 0x01

find_player_lane_bottom_loop:
    push b
    push h
    lda 0x2014
    ana c
    jz find_player_lane_bottom_skip

    lhld 0x201C
    pop d
    push d
    call pointer_hits_8col_sprite
    cpi 0x01
    jz find_player_lane_bottom_found

find_player_lane_bottom_skip:
    pop h
    lxi d, 0x0180
    dad d
    mov a, c
    add a
    mov c, a
    pop b
    dcr b
    jnz find_player_lane_bottom_loop

    xra a
    ret

find_player_lane_bottom_found:
    pop h
    pop b
    mvi a, 0x01
    ret

find_player_lane_mid:
    lhld 0x2010
    inx h
    inx h
    call set_player_lane_ptr_for_hl
    mvi b, 0x08
    mvi c, 0x01

find_player_lane_mid_loop:
    push b
    push h
    lda 0x2024
    ana c
    jz find_player_lane_mid_skip

    lhld 0x201C
    pop d
    push d
    call pointer_hits_8col_sprite
    cpi 0x01
    jz find_player_lane_mid_found

find_player_lane_mid_skip:
    pop h
    lxi d, 0x0180
    dad d
    mov a, c
    add a
    mov c, a
    pop b
    dcr b
    jnz find_player_lane_mid_loop

    xra a
    ret

find_player_lane_mid_found:
    pop h
    pop b
    mvi a, 0x01
    ret

find_player_lane_top:
    lhld 0x2010
    inx h
    inx h
    inx h
    inx h
    call set_player_lane_ptr_for_hl
    mvi b, 0x08
    mvi c, 0x01

find_player_lane_top_loop:
    push b
    push h
    lda 0x2025
    ana c
    jz find_player_lane_top_skip

    lhld 0x201C
    pop d
    push d
    call pointer_hits_8col_sprite
    cpi 0x01
    jz find_player_lane_top_found

find_player_lane_top_skip:
    pop h
    lxi d, 0x0180
    dad d
    mov a, c
    add a
    mov c, a
    pop b
    dcr b
    jnz find_player_lane_top_loop

    xra a
    ret

find_player_lane_top_found:
    pop h
    pop b
    mvi a, 0x01
    ret

reset_enemy_timer:
    mvi a, 0x59
    sta 0x200B
    ret

enemy_slot_found:
    call advance_enemy_shooter_mask_in_c
    mov a, c
    sta 0x2026

enemy_slot_found_aimed:
    lxi d, 0x0060
    dad d
    dcx h
    shld 0x2008
    mvi a, 0x01
    sta 0x200A
    mvi a, 0x59
    sta 0x200B
    lhld 0x2008
    mvi m, 0x18
    ret

advance_enemy_bullet:
    lhld 0x2008
    mvi m, 0x00

    mov a, l
    ani 0x1F
    cpi 0x00
    jz enemy_bullet_off

    dcx h
    shld 0x2008

    call bullet_hits_bunker
    cpi 0x01
    jz enemy_bullet_off

    mov a, l
    ani 0x1F
    cpi 0x02
    jz check_enemy_bullet_hit

    jmp draw_enemy_bullet

check_enemy_bullet_hit:
    ; Bullet reached player row — check column overlap
    push h
    lhld 0x2002
    xchg
    pop h
    call pointer_hits_8col_sprite
    cpi 0x01
    jz enemy_hit_player
    jmp draw_enemy_bullet

draw_enemy_bullet:
    mvi m, 0x18
    ret

enemy_hit_player:
    call lose_life

enemy_bullet_off:
    mvi a, 0x00
    sta 0x200A
    ret

advance_enemy_shooter_mask_in_c:
    mov a, c
    add a
    jnc shooter_mask_no_wrap
    mvi a, 0x01

shooter_mask_no_wrap:
    mov c, a
    ret

enemy_ptr_bottom_from_c:
    lhld 0x2010
    jmp enemy_ptr_from_c

enemy_ptr_mid_from_c:
    lhld 0x2010
    inx h
    inx h
    jmp enemy_ptr_from_c

enemy_ptr_top_from_c:
    lhld 0x2010
    inx h
    inx h
    inx h
    inx h
    jmp enemy_ptr_from_c

enemy_ptr_from_c:
    mvi b, 0x01

enemy_ptr_loop:
    mov a, b
    cmp c
    jz enemy_ptr_done
    lxi d, 0x0180
    dad d
    mov a, b
    add a
    mov b, a
    jmp enemy_ptr_loop

enemy_ptr_done:
    ret

lose_life:
    lhld 0x2002
    call erase_player_from_hl
    lda 0x200C
    dcr a
    sta 0x200C
    cpi 0x00
    jnz life_remaining

    mvi a, 0x02
    sta 0x200D
    mvi a, 0x40
    sta 0x2019
    ret

life_remaining:
    xra a
    sta 0x2006
    sta 0x200A
    lxi h, 0x3182
    shld 0x2002
    call draw_player_from_ptr
    mvi a, 0x40
    sta 0x200B
    ret

move_player_left:
    lhld 0x2002
    mov a, h
    cpi 0x25
    jc left_done
    jnz can_move_left
    mov a, l
    cpi 0x02
    jc left_done
    jz left_done

can_move_left:
    push h
    call erase_player_from_hl
    pop h
    lxi d, 0xFFE0
    dad d
    shld 0x2002
    call draw_player_from_ptr

left_done:
    ret

move_player_right:
    lhld 0x2002
    mov a, h
    cpi 0x3E
    jc can_move_right
    jnz right_done
    mov a, l
    cpi 0x02
    jnc right_done

can_move_right:
    push h
    call erase_player_from_hl
    pop h
    lxi d, 0x0020
    dad d
    shld 0x2002
    call draw_player_from_ptr

right_done:
    ret

march_invaders:
    lda 0x201A
    ani 0xFF
    jz do_march_invaders
    dcr a
    sta 0x201A
    ret

do_march_invaders:
    call set_march_timer_from_alive
    call erase_invaders_from_base

    lhld 0x2010
    lda 0x2012
    ani 0x01
    jz march_right

march_left:
    mov a, h
    cpi 0x25
    jc reverse_to_right
    jnz move_left_ok
    mov a, l
    cpi 0x96
    jc reverse_to_right
    jz reverse_to_right

move_left_ok:
    lxi d, 0xFFE0
    dad d
    shld 0x2010
    call toggle_invader_anim
    jmp march_draw

reverse_to_right:
    mvi a, 0x00
    sta 0x2012
    lxi d, 0xfff8
    dad d
    shld 0x2010
    call toggle_invader_anim
    jmp march_draw

march_right:
    mov a, h
    cpi 0x33
    jc move_right_ok
    jnz reverse_to_left
    mov a, l
    cpi 0x96
    jc move_right_ok

reverse_to_left:
    mvi a, 0x01
    sta 0x2012
    lxi d, 0xfff8
    dad d
    shld 0x2010
    call toggle_invader_anim
    jmp march_draw

move_right_ok:
    lxi d, 0x0020
    dad d
    shld 0x2010
    call toggle_invader_anim

march_draw:
    call draw_invaders_from_base
    ret

set_march_timer_from_alive:
    ; Timer is based on alive invader count across 3 rows (24 total).
    ; Uses only additive steps and repeated subtraction.
    mvi c, 0x00

    lda 0x2014
    ani 0x80
    jz count_mask_40
    inr c
count_mask_40:
    lda 0x2014
    ani 0x40
    jz count_mask_20
    inr c
count_mask_20:
    lda 0x2014
    ani 0x20
    jz count_mask_10
    inr c
count_mask_10:
    lda 0x2014
    ani 0x10
    jz count_mask_08
    inr c
count_mask_08:
    lda 0x2014
    ani 0x08
    jz count_mask_04
    inr c
count_mask_04:
    lda 0x2014
    ani 0x04
    jz count_mask_02
    inr c
count_mask_02:
    lda 0x2014
    ani 0x02
    jz count_mask_01
    inr c
count_mask_01:
    lda 0x2014
    ani 0x01
    jz count_masks_mid_80
    inr c

count_masks_mid_80:
    lda 0x2024
    ani 0x80
    jz count_masks_mid_40
    inr c
count_masks_mid_40:
    lda 0x2024
    ani 0x40
    jz count_masks_mid_20
    inr c
count_masks_mid_20:
    lda 0x2024
    ani 0x20
    jz count_masks_mid_10
    inr c
count_masks_mid_10:
    lda 0x2024
    ani 0x10
    jz count_masks_mid_08
    inr c
count_masks_mid_08:
    lda 0x2024
    ani 0x08
    jz count_masks_mid_04
    inr c
count_masks_mid_04:
    lda 0x2024
    ani 0x04
    jz count_masks_mid_02
    inr c
count_masks_mid_02:
    lda 0x2024
    ani 0x02
    jz count_masks_mid_01
    inr c
count_masks_mid_01:
    lda 0x2024
    ani 0x01
    jz count_masks_top_80
    inr c

count_masks_top_80:
    lda 0x2025
    ani 0x80
    jz count_masks_top_40
    inr c
count_masks_top_40:
    lda 0x2025
    ani 0x40
    jz count_masks_top_20
    inr c
count_masks_top_20:
    lda 0x2025
    ani 0x20
    jz count_masks_top_10
    inr c
count_masks_top_10:
    lda 0x2025
    ani 0x10
    jz count_masks_top_08
    inr c
count_masks_top_08:
    lda 0x2025
    ani 0x08
    jz count_masks_top_04
    inr c
count_masks_top_04:
    lda 0x2025
    ani 0x04
    jz count_masks_top_02
    inr c
count_masks_top_02:
    lda 0x2025
    ani 0x02
    jz count_masks_top_01
    inr c
count_masks_top_01:
    lda 0x2025
    ani 0x01
    jz count_masks_done
    inr c

count_masks_done:
    mov a, c
    ani 0xFF
    jz set_march_timer_zero
    dcr a
    mvi b, 0x00

march_div_loop:
    cpi 0x03
    jc march_div_done
    sui 0x03
    inr b
    jmp march_div_loop

march_div_done:
    mov a, b
    sta 0x201A
    ret

set_march_timer_zero:
    xra a
    sta 0x201A
    ret

check_fleet_reach_player:
    lhld 0x2010
    mov a, l
    ani 0x1F
    cpi 0x05
    jnc fleet_safe
    mvi a, 0x02
    sta 0x200D
    mvi a, 0x40
    sta 0x2019

fleet_safe:
    ret

update_ufo:
    lda 0x2017
    ani 0x01
    jz maybe_spawn_ufo
    lda 0x2021
    ani 0xFF
    jz do_move_ufo
    dcr a
    sta 0x2021
    ret

do_move_ufo:
    mvi a, 0x30
    sta 0x2021
    call move_ufo
    ret

maybe_spawn_ufo:
    lda 0x2018
    cpi 0x00
    jz spawn_ufo
    dcr a
    sta 0x2018
    ret

spawn_ufo:
    lxi h, 0x241B
    shld 0x2015
    mvi a, 0x01
    sta 0x2017
    lhld 0x2015
    xchg
    lxi h, ufo_sprite
    call draw_8col_sprite
    ret

move_ufo:
    lhld 0x2015
    call erase_8col_sprite
    mov a, h
    cpi 0x3F
    jnc ufo_offscreen
    lxi d, 0x0020
    dad d
    shld 0x2015
    xchg
    lxi h, ufo_sprite
    call draw_8col_sprite
    ret

ufo_offscreen:
    xra a
    sta 0x2017
    mvi a, 0x70
    sta 0x2018
    ret

toggle_invader_anim:
    lda 0x2013
    xri 0x01
    ani 0x01
    sta 0x2013
    ret

add_score_ten:
    lda 0x200E
    adi 0x0A
    sta 0x200E
    jnc add_ten_done
    lda 0x200F
    inr a
    sta 0x200F

add_ten_done:
    ret

add_score_twenty:
    lda 0x200E
    adi 0x14
    sta 0x200E
    jnc add_twenty_done
    lda 0x200F
    inr a
    sta 0x200F

add_twenty_done:
    ret

add_score_thirty:
    lda 0x200E
    adi 0x1E
    sta 0x200E
    jnc add_thirty_done
    lda 0x200F
    inr a
    sta 0x200F

add_thirty_done:
    ret

add_score_fifty:
    lda 0x200E
    adi 0x32
    sta 0x200E
    jnc add_fifty_done
    lda 0x200F
    inr a
    sta 0x200F

add_fifty_done:
    ret

draw_player_from_ptr:
    lhld 0x2002
    xchg
    lxi h, player_sprite
    call draw_8col_sprite
    ret

erase_player_from_hl:
    call erase_8col_sprite
    ret

; Each bunker = 16x16px: 2 cols wide (arch_l + arch_r) x 2 rows tall (arch + base).
; byte_idx=6 (arch top, screen_y 200-207), byte_idx=5 (solid base, screen_y 208-215).
draw_bunkers:
    ; Bunker 1 — screen_x 32..47
    lxi d, 0x2806
    lxi h, bunker_arch_l
    call draw_8col_sprite
    lxi d, 0x2906
    lxi h, bunker_arch_r
    call draw_8col_sprite
    lxi d, 0x2805
    lxi h, bunker_base
    call draw_8col_sprite
    lxi d, 0x2905
    lxi h, bunker_base
    call draw_8col_sprite

    ; Bunker 2 — screen_x 72..87
    lxi d, 0x2D06
    lxi h, bunker_arch_l
    call draw_8col_sprite
    lxi d, 0x2E06
    lxi h, bunker_arch_r
    call draw_8col_sprite
    lxi d, 0x2D05
    lxi h, bunker_base
    call draw_8col_sprite
    lxi d, 0x2E05
    lxi h, bunker_base
    call draw_8col_sprite

    ; Bunker 3 — screen_x 112..127
    lxi d, 0x3206
    lxi h, bunker_arch_l
    call draw_8col_sprite
    lxi d, 0x3306
    lxi h, bunker_arch_r
    call draw_8col_sprite
    lxi d, 0x3205
    lxi h, bunker_base
    call draw_8col_sprite
    lxi d, 0x3305
    lxi h, bunker_base
    call draw_8col_sprite

    ; Bunker 4 — screen_x 152..167
    lxi d, 0x3706
    lxi h, bunker_arch_l
    call draw_8col_sprite
    lxi d, 0x3806
    lxi h, bunker_arch_r
    call draw_8col_sprite
    lxi d, 0x3705
    lxi h, bunker_base
    call draw_8col_sprite
    lxi d, 0x3805
    lxi h, bunker_base
    call draw_8col_sprite
    ret

draw_invaders_from_base:
    call draw_invader_row_bottom
    call draw_invader_row_mid
    call draw_invader_row_top
    ret

draw_invader_row_bottom:
    lhld 0x2010
    mvi b, 0x08
    mvi c, 0x01

draw_invader_loop_bottom:
    push b
    push h
    lda 0x2014
    ana c
    jz skip_draw_invader_bottom

    pop d
    push d
    lda 0x2013
    ani 0x01
    jz use_invader_a_bottom
    lxi h, invader_b
    jmp invader_ready_bottom

use_invader_a_bottom:
    lxi h, invader_a

invader_ready_bottom:
    call draw_8col_sprite

skip_draw_invader_bottom:
    pop h
    lxi d, 0x0180
    dad d
    mov a, c
    add a
    mov c, a
    pop b
    dcr b
    jnz draw_invader_loop_bottom
    ret

draw_invader_row_mid:
    lhld 0x2010
    inx h
    inx h
    mvi b, 0x08
    mvi c, 0x01

draw_invader_loop_mid:
    push b
    push h
    lda 0x2024
    ana c
    jz skip_draw_invader_mid

    pop d
    push d
    lda 0x2013
    ani 0x01
    jz use_invader_a_mid
    lxi h, invader_b
    jmp invader_ready_mid

use_invader_a_mid:
    lxi h, invader_a

invader_ready_mid:
    call draw_8col_sprite

skip_draw_invader_mid:
    pop h
    lxi d, 0x0180
    dad d
    mov a, c
    add a
    mov c, a
    pop b
    dcr b
    jnz draw_invader_loop_mid
    ret

draw_invader_row_top:
    lhld 0x2010
    inx h
    inx h
    inx h
    inx h
    mvi b, 0x08
    mvi c, 0x01

draw_invader_loop_top:
    push b
    push h
    lda 0x2025
    ana c
    jz skip_draw_invader_top

    pop d
    push d
    lda 0x2013
    ani 0x01
    jz use_invader_a_top
    lxi h, invader_b
    jmp invader_ready_top

use_invader_a_top:
    lxi h, invader_a

invader_ready_top:
    call draw_8col_sprite

skip_draw_invader_top:
    pop h
    lxi d, 0x0180
    dad d
    mov a, c
    add a
    mov c, a
    pop b
    dcr b
    jnz draw_invader_loop_top
    ret

erase_invaders_from_base:
    call erase_invader_row_bottom
    call erase_invader_row_mid
    call erase_invader_row_top
    ret

erase_invader_row_bottom:
    lhld 0x2010
    mvi b, 0x08
    mvi c, 0x01

erase_invader_loop_bottom:
    push b
    push h
    lda 0x2014
    ana c
    jz skip_erase_invader_bottom
    call erase_8col_sprite

skip_erase_invader_bottom:
    pop h
    lxi d, 0x0180
    dad d
    mov a, c
    add a
    mov c, a
    pop b
    dcr b
    jnz erase_invader_loop_bottom
    ret

erase_invader_row_mid:
    lhld 0x2010
    inx h
    inx h
    mvi b, 0x08
    mvi c, 0x01

erase_invader_loop_mid:
    push b
    push h
    lda 0x2024
    ana c
    jz skip_erase_invader_mid
    call erase_8col_sprite

skip_erase_invader_mid:
    pop h
    lxi d, 0x0180
    dad d
    mov a, c
    add a
    mov c, a
    pop b
    dcr b
    jnz erase_invader_loop_mid
    ret

erase_invader_row_top:
    lhld 0x2010
    inx h
    inx h
    inx h
    inx h
    mvi b, 0x08
    mvi c, 0x01

erase_invader_loop_top:
    push b
    push h
    lda 0x2025
    ana c
    jz skip_erase_invader_top
    call erase_8col_sprite

skip_erase_invader_top:
    pop h
    lxi d, 0x0180
    dad d
    mov a, c
    add a
    mov c, a
    pop b
    dcr b
    jnz erase_invader_loop_top
    ret

pointer_hits_8col_sprite:
    push b
    xchg
    mvi b, 0x08

hit_check_loop:
    mov a, h
    cmp d
    jnz hit_check_next
    mov a, l
    cmp e
    jz hit_check_yes

hit_check_next:
    mov a, l
    adi 0x20
    mov l, a
    jnc hit_check_no_carry
    inr h

hit_check_no_carry:
    dcr b
    jnz hit_check_loop
    xchg
    pop b
    xra a
    ret

hit_check_yes:
    xchg
    pop b
    mvi a, 0x01
    ret

bullet_hits_bunker:
    ; Hit byte_idx=6 (arch top) or byte_idx=5 (solid base).
    mov a, l
    ani 0x1F
    cpi 0x06
    jz do_bunker_hit
    cpi 0x05
    jnz bullet_no_bunker
do_bunker_hit:
    mov a, m
    cpi 0x00
    jz bullet_no_bunker
    mvi m, 0x00
    mvi a, 0x01
    ret

bullet_no_bunker:
    xra a
    ret

draw_8col_sprite:
    ; HL = sprite data, DE = target VRAM address for the left-most column.
    mvi c, 0x08

draw_8col_loop:
    mov a, m
    xchg
    mov m, a
    mov a, l
    adi 0x20
    mov l, a
    jnc draw_no_carry
    inr h

draw_no_carry:
    xchg
    inx h
    dcr c
    jnz draw_8col_loop
    ret

erase_8col_sprite:
    ; HL = target VRAM address for the left-most column.
    mvi c, 0x08

erase_8col_loop:
    mvi m, 0x00
    mov a, l
    adi 0x20
    mov l, a
    jnc erase_no_carry
    inr h

erase_no_carry:
    dcr c
    jnz erase_8col_loop
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

delay_tick:
    ret

player_sprite:
    .byte 0x18, 0x39, 0x7E, 0xFC, 0xFC, 0x7E, 0x39, 0x18

; Left arch half: solid pillar left 4 cols, arch opening opens right.
; Right arch half: mirror — arch opening closes back to solid pillar right 4 cols.
; Combined 16-wide bunker has single arch opening at bottom-center (8px wide).
bunker_arch_l:
    .byte 0xFF, 0xFF, 0xFF, 0xFF, 0xF8, 0xF0, 0xF0, 0xF0

bunker_arch_r:
    .byte 0xF0, 0xF0, 0xF0, 0xF8, 0xFF, 0xFF, 0xFF, 0xFF

bunker_base:
    .byte 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF, 0xFF

ufo_sprite:
    .byte 0x18, 0x3C, 0x7E, 0xDB, 0xDB, 0x7E, 0x24, 0x00

invader_a:
    .byte 0x32, 0x75, 0xDA, 0xF4, 0xF4, 0xDA, 0x75, 0x32

invader_b:
    .byte 0x31, 0x76, 0xD8, 0xF4, 0xF4, 0xD8, 0x76, 0x31
