# Space Invaders Homebrew — Authenticity Game Plan

> Reference document for remaining work. Check items off as completed.

---

## Current State (step_07)

What works:
- 3 rows × 8 columns (24 invaders), tiered scoring (10/20/30)
- Alive-based fleet acceleration (additive bit counting, no MUL)
- Bunker erosion (player + enemy bullets)
- UFO sweeps with gate timer
- Player lives, score, win/lose state transitions

What doesn't match the original:

---

## Phase 4 — Enemy Shooting Overhaul

### Problem

Our shooter uses a single rotating mask (`0x2026`) that cycles left-to-right
through columns 0→1→2→3→4→5→6→7→wrap. Every shot picks the next column in
sequence. This produces a predictable, mechanical pattern the player can easily
learn. The original 1978 game was far more threatening.

### How the Original Works

The arcade ROM has **three independent shot types**, each with its own bullet
slot, reload timer, column-selection strategy, and sprite:

| Shot | Column Strategy | Sprite | Behavior |
|------|----------------|--------|----------|
| **Rolling shot** | Aims at player's column | `─` squiggle | Tracks the player — always fires from the column directly above the cannon |
| **Plunger shot** | 16-entry column table, cycled sequentially | `│` plunger | Predictable but not sequential — the table is hand-tuned for coverage |
| **Squiggly shot** | 16-entry column table, different sequence | `~` squiggle | Same mechanism, different table, phase-offset from plunger |

Key behaviors:
- Up to **3 enemy bullets on screen simultaneously**
- Each type has an independent **reload counter** (different values per difficulty)
- The rolling shot **actively aims** — it finds the bottom-most alive invader in
  the column closest to the player's current X position
- The plunger and squiggly shots cycle through lookup tables:
  - Plunger table: `{0x01, 0x07, 0x01, 0x01, 0x01, 0x04, 0x0B, 0x01, 0x06, 0x03, 0x01, 0x01, 0x0B, 0x09, 0x02, 0x08}`
  - Squiggly table: `{0x07, 0x01, 0x04, 0x0B, 0x01, 0x06, 0x03, 0x01, 0x0B, 0x09, 0x02, 0x08, 0x02, 0x0B, 0x04, 0x07}`
  (column indices into the 11-column formation; our 8-col version will scale)
- The squiggly shot is also used as the UFO's shot — it doesn't fire while UFO
  is active

### Implementation Plan

#### 4A — Aimed Shot (Rolling)

The most impactful single change. One bullet type actively tracks the player.

1. **Add RAM slots for 3 bullet types:**
   - `0x2028` — rolling bullet ptr (2 bytes)
   - `0x202A` — rolling bullet active flag
   - `0x202C` — plunger bullet ptr (2 bytes)
   - `0x202E` — plunger bullet active flag
   - `0x2030` — squiggly bullet ptr (2 bytes)
   - `0x2032` — squiggly bullet active flag
   - `0x2034` — plunger table index (0–15, wraps)
   - `0x2035` — squiggly table index (0–15, wraps)
   - Keep existing `0x2008`/`0x200A` as aliases or migrate

2. **`find_column_above_player` routine:**
   - Read player X from `0x2002` high byte
   - Convert to column index: subtract fleet base column, divide by column
     spacing (repeated subtraction, no MUL)
   - Clamp to 0–7
   - Scan bottom→mid→top alive masks at that column bit
   - If no alive invader found, try adjacent columns (±1)

3. **Rolling shot fires from the column above the player,** using the bottom-most
   alive invader in that column. If no invader is alive in that column, skip
   (don't fire rolling shot this cycle).

4. **Independent reload timers** — each shot type has its own cooldown gate:
   - Rolling: `0x2036` (fast, ~0x40)
   - Plunger: `0x2037` (medium, ~0x50)
   - Squiggly: `0x2038` (slow, ~0x60)

#### 4B — Table-Driven Shots (Plunger + Squiggly)

5. **Column lookup tables in ROM:**
   ```
   plunger_columns:  db 0x01, 0x06, 0x01, 0x01, 0x01, 0x04, 0x07, 0x01
                     db 0x06, 0x03, 0x01, 0x01, 0x07, 0x07, 0x02, 0x05
   squiggly_columns: db 0x06, 0x01, 0x04, 0x07, 0x01, 0x05, 0x03, 0x01
                     db 0x07, 0x07, 0x02, 0x05, 0x02, 0x07, 0x04, 0x06
   ```
   (Scaled from original 11-col indices to our 8-col range: 0x00–0x07)

6. **Table index advances** after each successful spawn (when bullet becomes
   active). Wraps at 16 → 0.

7. **Squiggly shot is suppressed while UFO is active** (matches original — the
   squiggly timer is "borrowed" by the UFO).

#### 4C — Multi-Bullet Management

8. **Advance all 3 bullets independently** each frame (separate throttle timers).

9. **Each bullet checks bunker erosion and player collision independently.**

10. **Draw all 3 bullets** — use different VRAM byte patterns:
    - Rolling:  `0x18`  (current pattern, centered dot)
    - Plunger:  `0x7E`  (wider bar)
    - Squiggly: `0x5A`  (zigzag)

#### Tests for Phase 4

- `step7_rolling_shot_aims_at_player` — fire player near column 3, verify
  rolling bullet spawns from column 3's bottom-most alive invader
- `step7_plunger_cycles_column_table` — kill specific invaders, verify plunger
  visits columns in table order
- `step7_squiggly_suppressed_during_ufo` — activate UFO, verify no squiggly
  shots spawn
- `step7_three_bullets_simultaneous` — run enough frames for all 3 to be active
  at once, verify all 3 active flags set
- `step7_each_bullet_erodes_bunker` — verify each bullet type independently
  erodes bunker pixels

---

## Phase 5 — Fleet Descent on Reversal

### Problem

When the fleet hits a wall, `reverse_to_right` and `reverse_to_left` currently
do `DCX H` on the base pointer. This decrements by 1 address byte — which drops
the formation by ~1 pixel vertically. The original drops a **full 8-pixel row**
on each reversal.

### Plan

1. On reversal, instead of `DCX H`, subtract a full row offset from the base
   pointer. In our VRAM layout one row = `0x0001` in the low 5 bits (column
   bytes are in bits 5–12). A full 8-pixel drop means decrement low byte by
   `0x08` (or whatever maps to 8 scan lines in our rotation).

2. **Actually:** In the rotated VRAM the low 5 bits are the Y scan line within a
   column-byte. Moving "down" one pixel means `DCX H` (decrement by 1).
   Moving down 8 pixels = subtract 8 from the low byte's row component. That's
   what we should do on reversal: `LXI D, 0xFFF8 → DAD D` instead of `DCX H`.

3. After descent, check if the fleet's lowest row has reached the player row
   (`0x02` in the low 5 bits). If so → game over (invasion).

4. **Bottom-row detection**: After reversal + descent, compute the bottom-most
   alive invader's Y position. If ≤ player row → set game state to lose.

#### Tests for Phase 5

- `step7_fleet_descends_on_reversal` — march fleet to wall, verify base pointer
  drops by 8 scan lines (not 1)
- `step7_invasion_triggers_game_over` — force fleet low enough that descent
  reaches player row, verify game_state goes to 0x02
- `step7_descent_amount_is_consistent` — reverse left and right both produce
  same descent offset

---

## Phase 6 — Wave Carry-Over

### Problem

When all invaders die, `restart_round` calls `init_game` which resets
everything: score goes to 0, lives go to 3, fleet resets to top. The original
game preserves score and lives across waves, and each new wave starts slightly
faster (lower base march timer) and slightly lower (fleet starts one row lower
per wave up to a cap).

### Plan

1. **Add wave counter** at `0x203A`. Starts at 0, increments on wave clear.

2. **`restart_wave` (not `init_game`)** — new routine that:
   - Preserves score (`0x200E/F`), lives (`0x200C`), wave counter
   - Resets alive masks to `0xFF`
   - Resets bullet states
   - Resets fleet base to starting position minus `wave_counter × 8` rows
     (using additive subtraction loop, capped at ~4 waves lower)
   - Sets base march timer ceiling = `max(0x10, default - wave_counter × 0x08)`
     so each wave is faster

3. **Change the wave-clear transition** (`check_all_invaders_dead` → state 0x01)
   to call `restart_wave` instead of `init_game`.

4. **Wave cap**: After wave 8+, stop lowering start position and speed cap —
   difficulty plateaus.

#### Tests for Phase 6

- `step7_wave_clear_preserves_score` — earn points, clear wave, verify score
  persists
- `step7_wave_clear_preserves_lives` — lose a life, clear wave, verify lives
  count carries
- `step7_wave_counter_increments` — clear 3 waves, verify counter = 3
- `step7_wave_speed_increases` — clear a wave, verify march timer ceiling is
  lower

---

## Phase 7 — Extra Life + High Score

### Plan

1. **Extra life at 1500 points:**
   - After every `add_score_*` call, check if score crossed 1500 (BCD compare)
   - If yes, increment lives (cap at 5), set flag so it only triggers once
   - RAM: `0x203B` — extra life awarded flag

2. **High score tracking:**
   - `0x203C/3D` — high score (2 bytes, BCD)
   - On game over, compare score vs high score, update if higher
   - Display high score in a fixed VRAM location (top center)

#### Tests for Phase 7

- `step7_extra_life_at_1500` — accumulate 1500 points, verify life count goes
  from 3 → 4
- `step7_extra_life_only_once` — cross 1500 twice in same game, verify only 1
  extra life
- `step7_high_score_updates` — play game, die, verify high score stored

---

## Phase 8 — Polish

### Plan

1. **Death explosion pause** — when player is hit, freeze the frame for ~1
   second with an explosion sprite before respawning
2. **Attract mode** — title screen with "PRESS FIRE TO START", high score
   display, cycling demo
3. **Sound hooks** — ensure port writes exist at key events (shoot, hit,
   explosion, march step, UFO) even if the browser side doesn't play audio yet

---

## Implementation Order

| # | Phase | Priority | Complexity | Status |
|---|-------|----------|------------|--------|
| 4A | Aimed rolling shot | **High** | Medium | Not started |
| 4B | Table-driven plunger + squiggly | High | Medium | Not started |
| 4C | Multi-bullet management | High | High | Not started |
| 5 | Fleet descent on reversal | **High** | Low | Not started |
| 6 | Wave carry-over | Medium | Medium | Not started |
| 7 | Extra life + high score | Medium | Low | Not started |
| 8 | Polish (death pause, attract, sound) | Low | Medium | Not started |

**Recommended start: Phase 5 (descent)** — it's small, self-contained, and
fixes the most visible gap. Then Phase 4A (aimed shot) for the biggest gameplay
improvement. Then 4B/4C together for full shot system.

---

## RAM Map (Current + Planned)

| Address | Name | Current | Planned |
|---------|------|---------|---------|
| `0x2002` | player_ptr | ✓ | |
| `0x2004` | bullet_ptr | ✓ | Player bullet only |
| `0x2006` | bullet_active | ✓ | Player bullet only |
| `0x2008` | enemy_bullet_ptr | ✓ | → Rolling bullet ptr (Phase 4) |
| `0x200A` | enemy_bullet_active | ✓ | → Rolling active (Phase 4) |
| `0x200B` | enemy_spawn_timer | ✓ | → Rolling reload (Phase 4) |
| `0x200C` | lives | ✓ | |
| `0x200D` | game_state | ✓ | |
| `0x200E/F` | score (BCD) | ✓ | |
| `0x2010/11` | fleet_base | ✓ | |
| `0x2012` | direction | ✓ | |
| `0x2013` | anim_frame | ✓ | |
| `0x2014` | bottom_alive | ✓ | |
| `0x2015/16` | ufo_ptr | ✓ | |
| `0x2017` | ufo_active | ✓ | |
| `0x2018` | ufo_spawn_timer | ✓ | |
| `0x2019` | end_state_timer | ✓ | |
| `0x201A` | march_timer | ✓ | |
| `0x201B` | input_cooldown | ✓ | |
| `0x201C/D` | (temp lane check) | ✓ | |
| `0x201E` | player_bullet_throttle | ✓ | |
| `0x201F` | enemy_bullet_throttle | ✓ | → Rolling bullet throttle |
| `0x2020` | enemy_fire_gate | ✓ | → Rolling fire gate |
| `0x2021` | ufo_move_timer | ✓ | |
| `0x2022` | ufo_gate | ✓ | |
| `0x2023` | march_gate | ✓ | |
| `0x2024` | mid_alive | ✓ | |
| `0x2025` | top_alive | ✓ | |
| `0x2026` | shooter_rotation | ✓ | → Remove (Phase 4) |
| `0x2028/29` | | — | Rolling bullet ptr |
| `0x202A` | | — | Rolling bullet active |
| `0x202C/2D` | | — | Plunger bullet ptr |
| `0x202E` | | — | Plunger bullet active |
| `0x2030/31` | | — | Squiggly bullet ptr |
| `0x2032` | | — | Squiggly bullet active |
| `0x2034` | | — | Plunger table index |
| `0x2035` | | — | Squiggly table index |
| `0x2036` | | — | Rolling reload timer |
| `0x2037` | | — | Plunger reload timer |
| `0x2038` | | — | Squiggly reload timer |
| `0x203A` | | — | Wave counter |
| `0x203B` | | — | Extra life flag |
| `0x203C/3D` | | — | High score (BCD) |
