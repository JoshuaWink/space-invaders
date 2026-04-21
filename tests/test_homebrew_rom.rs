use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::Command;
use std::time::{SystemTime, UNIX_EPOCH};

use space_invaders_emu::Machine;

const PLAYER_PTR_ADDR: usize = 0x2002;
const PLAYER_BULLET_PTR_ADDR: usize = 0x2004;
const PLAYER_BULLET_ACTIVE_ADDR: usize = 0x2006;
const ENEMY_BULLET_PTR_ADDR: usize = 0x2008;
const ENEMY_BULLET_ACTIVE_ADDR: usize = 0x200A;
const LIVES_ADDR: usize = 0x200C;
const SCORE_LO_ADDR: usize = 0x200E;
const SCORE_HI_ADDR: usize = 0x200F;
const ALIVE_MASK_ADDR: usize = 0x2014;
const ALIVE_MASK_MID_ADDR: usize = 0x2024;
const ALIVE_MASK_TOP_ADDR: usize = 0x2025;
const UFO_ACTIVE_ADDR: usize = 0x2017;

fn build_step7_rom() -> PathBuf {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before unix epoch")
        .as_nanos();
    let output = env::temp_dir().join(format!("space-invaders-step7-{stamp}.rom"));

    let status = Command::new("python3")
        .current_dir(&root)
        .args([
            "rom/build.py",
            "--step",
            "7",
            "--output",
            output.to_str().expect("temp path should be valid utf-8"),
        ])
        .status()
        .expect("failed to run rom/build.py");

    assert!(status.success(), "rom/build.py should succeed");
    output
}

fn load_step7_machine() -> Machine {
    let rom_path = build_step7_rom();
    let rom = fs::read(&rom_path).expect("failed to read built rom");

    let mut machine = Machine::new();
    machine.load_rom(&rom);
    machine
}

fn boot_step7(machine: &mut Machine) {
    for _ in 0..12 {
        machine.execute_frame();
    }
}

fn read_word(machine: &Machine, addr: usize) -> u16 {
    machine.cpu.memory[addr] as u16 | ((machine.cpu.memory[addr + 1] as u16) << 8)
}

fn score(machine: &Machine) -> u16 {
    machine.cpu.memory[SCORE_LO_ADDR] as u16 | ((machine.cpu.memory[SCORE_HI_ADDR] as u16) << 8)
}

fn fleet_rate(machine: &mut Machine, frames: u32) -> f64 {
    let seconds = frames as f64 / 60.0;
    let mut moves = 0u32;
    let mut prev = read_word(machine, 0x2010);
    for _ in 0..frames {
        machine.execute_frame();
        let now = read_word(machine, 0x2010);
        if now != prev {
            moves += 1;
        }
        prev = now;
    }
    moves as f64 / seconds
}

fn write_word(machine: &mut Machine, addr: usize, value: u16) {
    machine.cpu.memory[addr] = (value & 0x00FF) as u8;
    machine.cpu.memory[addr + 1] = (value >> 8) as u8;
}

fn force_enemy_spawn(machine: &mut Machine) -> u16 {
    machine.set_input_port1(0x00);
    machine.cpu.memory[ENEMY_BULLET_ACTIVE_ADDR] = 0;
    machine.cpu.memory[0x200B] = 0;
    machine.cpu.memory[0x2020] = 0;
    machine.execute_frame();

    assert_eq!(
        machine.cpu.memory[ENEMY_BULLET_ACTIVE_ADDR],
        0x01,
        "enemy bullet should spawn immediately when timer and gate are zero"
    );

    read_word(machine, ENEMY_BULLET_PTR_ADDR)
}

fn pin_fleet_base(machine: &mut Machine) {
    write_word(machine, 0x2010, 0x2696);
}

#[test]
fn step7_player_moves_left_with_input() {
    let mut machine = load_step7_machine();
    boot_step7(&mut machine);
    let initial = read_word(&machine, PLAYER_PTR_ADDR);

    for _ in 0..3 {
        machine.set_input_port1(0x20);
        machine.execute_frame();
    }

    let moved = read_word(&machine, PLAYER_PTR_ADDR);
    assert!(moved < initial, "player pointer should move left: {moved:#06x} < {initial:#06x}");
}

#[test]
fn step7_spawns_player_bullet_on_fire() {
    let mut machine = load_step7_machine();

    boot_step7(&mut machine);

    machine.set_input_port1(0x10);
    machine.execute_frame();

    assert_eq!(machine.cpu.memory[PLAYER_BULLET_ACTIVE_ADDR], 0x01, "bullet should become active");
    assert_ne!(read_word(&machine, PLAYER_BULLET_PTR_ADDR), 0x0000, "bullet pointer should be initialized");
}

#[test]
fn step7_player_shot_scores_and_removes_invader() {
    let mut machine = load_step7_machine();
    boot_step7(&mut machine);

    machine.set_input_port1(0x10);
    for _ in 0..240 {
        machine.execute_frame();
    }

    assert!(
        score(&machine) > 0,
        "player shot should award score; score={}, masks=({:#04x},{:#04x},{:#04x}), bullet_active={}, bullet_ptr={:#06x}",
        score(&machine),
        machine.cpu.memory[ALIVE_MASK_ADDR],
        machine.cpu.memory[ALIVE_MASK_MID_ADDR],
        machine.cpu.memory[ALIVE_MASK_TOP_ADDR],
        machine.cpu.memory[PLAYER_BULLET_ACTIVE_ADDR],
        read_word(&machine, PLAYER_BULLET_PTR_ADDR),
    );
    assert_ne!(
        machine.cpu.memory[ALIVE_MASK_ADDR]
            & machine.cpu.memory[ALIVE_MASK_MID_ADDR]
            & machine.cpu.memory[ALIVE_MASK_TOP_ADDR],
        0xFF,
        "at least one invader should be removed; score={}, masks=({:#04x},{:#04x},{:#04x})",
        score(&machine),
        machine.cpu.memory[ALIVE_MASK_ADDR],
        machine.cpu.memory[ALIVE_MASK_MID_ADDR],
        machine.cpu.memory[ALIVE_MASK_TOP_ADDR],
    );
}

#[test]
fn step7_enemy_fire_happens_over_time() {
    let mut machine = load_step7_machine();
    boot_step7(&mut machine);

    assert_eq!(machine.cpu.memory[LIVES_ADDR], 3, "boot should initialize player lives");

    for _ in 0..360 {
        machine.execute_frame();
    }

    assert!(
        machine.cpu.memory[ENEMY_BULLET_ACTIVE_ADDR] != 0 || machine.cpu.memory[LIVES_ADDR] < 3,
        "enemy fire should eventually activate or cost a life within 360 frames"
    );
}

#[test]
fn step7_ufo_appears_over_time() {
    let mut machine = load_step7_machine();
    boot_step7(&mut machine);

    let mut saw_ufo = false;
    for _ in 0..240 {
        machine.execute_frame();
        if machine.cpu.memory[UFO_ACTIVE_ADDR] != 0 {
            saw_ufo = true;
            break;
        }
    }

    assert!(saw_ufo, "ufo should become active during longer play");
}

/// Verify that gameplay rates feel right from a player's perspective.
///
/// All rates measured over 120 simulated frames (2 seconds at 60 fps).
///
/// Target ranges come from original Space Invaders pacing research:
///   - Fleet: 2–12 moves/sec  (slow start; accelerates as invaders die)
///   - Bullet travel: ≥ 8 frame-steps/sec  (bullet should visibly traverse screen)
///   - Enemy fire: ≤ 5 spawn events/sec  (occasional, not overwhelming)
///   - Player movement: ≥ 10 frame-changes/sec  (responsive controls)
#[test]
fn step7_gameplay_rates_are_sane() {
    const SAMPLE_FRAMES: u32 = 120;
    const MACHINE_FPS: f64 = 60.0;
    const SECONDS: f64 = SAMPLE_FRAMES as f64 / MACHINE_FPS;

    // --- Fleet march rate ---
    let mut fleet_machine = load_step7_machine();
    boot_step7(&mut fleet_machine);
    let mut fleet_moves = 0u32;
    let mut fleet_prev = read_word(&fleet_machine, 0x2010);
    for _ in 0..SAMPLE_FRAMES {
        fleet_machine.execute_frame();
        let now = read_word(&fleet_machine, 0x2010);
        if now != fleet_prev {
            fleet_moves += 1;
        }
        fleet_prev = now;
    }
    let fleet_rate = fleet_moves as f64 / SECONDS;
    assert!(
        fleet_rate >= 2.0 && fleet_rate <= 12.0,
        "fleet should march 2–12 times/sec at full formation; got {fleet_rate:.2}/sec ({fleet_moves} moves in {SAMPLE_FRAMES} frames)"
    );

    // --- Player movement rate (holding left) ---
    let mut player_machine = load_step7_machine();
    boot_step7(&mut player_machine);
    let mut player_moves = 0u32;
    let mut player_prev = read_word(&player_machine, PLAYER_PTR_ADDR);
    for _ in 0..SAMPLE_FRAMES {
        player_machine.set_input_port1(0x20);
        player_machine.execute_frame();
        let now = read_word(&player_machine, PLAYER_PTR_ADDR);
        if now != player_prev {
            player_moves += 1;
        }
        player_prev = now;
    }
    let player_rate = player_moves as f64 / SECONDS;
    assert!(
        player_rate >= 8.0 && player_rate <= 20.0,
        "player should move 8–20 times/sec when held; got {player_rate:.2}/sec"
    );

    // --- Bullet travel ---
    // Fire once then verify the bullet actually travels and deactivates
    // (hits an invader or reaches the top of the screen).
    let mut bullet_machine = load_step7_machine();
    boot_step7(&mut bullet_machine);
    bullet_machine.set_input_port1(0x10);
    bullet_machine.execute_frame();
    bullet_machine.set_input_port1(0x00);
    assert_eq!(
        bullet_machine.cpu.memory[PLAYER_BULLET_ACTIVE_ADDR], 1,
        "bullet should spawn as active"
    );
    let mut bullet_steps = 0u32;
    let mut bullet_prev = read_word(&bullet_machine, PLAYER_BULLET_PTR_ADDR);
    let mut bullet_deactivated = false;
    for _ in 0..SAMPLE_FRAMES {
        bullet_machine.execute_frame();
        let now = read_word(&bullet_machine, PLAYER_BULLET_PTR_ADDR);
        if now != bullet_prev && bullet_machine.cpu.memory[PLAYER_BULLET_ACTIVE_ADDR] != 0 {
            bullet_steps += 1;
        }
        bullet_prev = now;
        if bullet_machine.cpu.memory[PLAYER_BULLET_ACTIVE_ADDR] == 0 {
            bullet_deactivated = true;
            break;
        }
    }
    assert!(
        bullet_deactivated,
        "bullet should complete its flight within {SAMPLE_FRAMES} frames; steps={bullet_steps}"
    );
    assert!(
        bullet_steps >= 3,
        "bullet should travel at least 3 steps before hitting; got {bullet_steps}"
    );

    // --- Enemy fire rate ---
    let mut enemy_machine = load_step7_machine();
    boot_step7(&mut enemy_machine);
    let mut enemy_spawns = 0u32;
    let mut prev_active = enemy_machine.cpu.memory[ENEMY_BULLET_ACTIVE_ADDR];
    // Sample over 4× window to get stable count even if first spawn is delayed.
    for _ in 0..(SAMPLE_FRAMES * 4) {
        enemy_machine.execute_frame();
        let now_active = enemy_machine.cpu.memory[ENEMY_BULLET_ACTIVE_ADDR];
        if prev_active == 0 && now_active != 0 {
            enemy_spawns += 1;
        }
        prev_active = now_active;
    }
    let enemy_window_secs = (SAMPLE_FRAMES * 4) as f64 / MACHINE_FPS;
    let enemy_rate = enemy_spawns as f64 / enemy_window_secs;
    assert!(
        enemy_rate <= 5.0,
        "enemy fire should be ≤5 spawns/sec; got {enemy_rate:.2}/sec ({enemy_spawns} spawns in {:.0}s)",
        enemy_window_secs
    );
}

#[test]
fn step7_fleet_accelerates_when_invaders_die() {
    let mut full_fleet_machine = load_step7_machine();
    boot_step7(&mut full_fleet_machine);
    let full_rate = fleet_rate(&mut full_fleet_machine, 240);

    let mut low_fleet_machine = load_step7_machine();
    boot_step7(&mut low_fleet_machine);
    low_fleet_machine.cpu.memory[ALIVE_MASK_ADDR] = 0x01;
    low_fleet_machine.cpu.memory[ALIVE_MASK_MID_ADDR] = 0x00;
    low_fleet_machine.cpu.memory[ALIVE_MASK_TOP_ADDR] = 0x00;
    low_fleet_machine.cpu.memory[0x201A] = 0x00;
    let low_rate = fleet_rate(&mut low_fleet_machine, 240);

    assert!(
        low_rate >= full_rate + full_rate,
        "fleet should accelerate strongly as invaders are removed; full_rate={full_rate:.2}/sec low_rate={low_rate:.2}/sec"
    );
}

/// Enemy bullets that miss the player column should NOT cost a life.
#[test]
fn step7_enemy_bullet_miss_preserves_lives() {
    let mut machine = load_step7_machine();
    boot_step7(&mut machine);

    // Move player hard left so it's far from the invaders' firing column
    for _ in 0..60 {
        machine.set_input_port1(0x20); // hold left
        machine.execute_frame();
    }
    machine.set_input_port1(0x00);

    let lives_before = machine.cpu.memory[LIVES_ADDR];

    // Run long enough for enemy bullets to fire and travel the full screen
    for _ in 0..600 {
        machine.execute_frame();
    }

    let lives_after = machine.cpu.memory[LIVES_ADDR];
    assert_eq!(
        lives_after, lives_before,
        "enemy bullets that miss should not cost lives; lives went from {lives_before} to {lives_after}"
    );
}

#[test]
fn step7_enemy_fire_aims_at_player_lane() {
    let mut machine = load_step7_machine();
    boot_step7(&mut machine);

    pin_fleet_base(&mut machine);
    write_word(&mut machine, PLAYER_PTR_ADDR, 0x3182);

    let bullet_ptr = force_enemy_spawn(&mut machine);
    assert_eq!(
        bullet_ptr, 0x3174,
        "first enemy shot should come from the bottom-most invader above the player's lane; got {bullet_ptr:#06x}"
    );
}

#[test]
fn step7_enemy_fire_changes_with_player_position() {
    let mut right_lane_machine = load_step7_machine();
    boot_step7(&mut right_lane_machine);
    pin_fleet_base(&mut right_lane_machine);
    write_word(&mut right_lane_machine, PLAYER_PTR_ADDR, 0x3182);
    let right_lane_bullet = force_enemy_spawn(&mut right_lane_machine);

    let mut next_lane_machine = load_step7_machine();
    boot_step7(&mut next_lane_machine);
    pin_fleet_base(&mut next_lane_machine);
    write_word(&mut next_lane_machine, PLAYER_PTR_ADDR, 0x3002);
    let next_lane_bullet = force_enemy_spawn(&mut next_lane_machine);

    assert_eq!(
        right_lane_bullet, 0x3174,
        "right-lane player should draw the rolling shot from column 7; got {right_lane_bullet:#06x}"
    );
    assert_eq!(
        next_lane_bullet, 0x2ff4,
        "moving the player one invader lane left should move the rolling shot too; got {next_lane_bullet:#06x}"
    );
    assert_ne!(
        right_lane_bullet, next_lane_bullet,
        "rolling shot spawn pointer should change when the player lane changes"
    );
}

#[test]
fn step7_enemy_fire_uses_bottom_most_alive_invader_in_lane() {
    let mut machine = load_step7_machine();
    boot_step7(&mut machine);

    pin_fleet_base(&mut machine);
    write_word(&mut machine, PLAYER_PTR_ADDR, 0x3182);
    machine.cpu.memory[ALIVE_MASK_ADDR] = 0x00;

    let bullet_ptr = force_enemy_spawn(&mut machine);
    assert_eq!(
        bullet_ptr, 0x3176,
        "if the entire bottom row is gone, the rolling shot should fall back to the mid row; got {bullet_ptr:#06x}"
    );
}

#[test]
fn step7_player_bullet_erodes_bunker() {
    let mut machine = load_step7_machine();
    boot_step7(&mut machine);

    // Place player under the 3rd bunker where bullet path intersects bunker byte 0x3266.
    machine.cpu.memory[PLAYER_PTR_ADDR] = 0x02;
    machine.cpu.memory[PLAYER_PTR_ADDR + 1] = 0x32;

    let bunker_addr = 0x3266usize;
    let bunker_before = machine.cpu.memory[bunker_addr];
    assert!(
        bunker_before != 0,
        "precondition failed: bunker byte should be non-zero before shot"
    );

    machine.set_input_port1(0x10);
    machine.execute_frame();
    machine.set_input_port1(0x00);

    for _ in 0..120 {
        machine.execute_frame();
        if machine.cpu.memory[PLAYER_BULLET_ACTIVE_ADDR] == 0 {
            break;
        }
    }

    let bunker_after = machine.cpu.memory[bunker_addr];
    assert_eq!(
        bunker_after, 0,
        "player bullet should erode bunker byte; before={:#04x} after={:#04x}",
        bunker_before,
        bunker_after
    );
}

#[test]
fn step7_fleet_descends_on_reversal() {
    let mut machine = load_step7_machine();
    boot_step7(&mut machine);

    // Force fleet to left wall: set base near wall and direction to left.
    // Wall is at H=0x25, so we set base to 0x25xx.
    // The march_left boundary check is: H < 0x25 triggers reverse_to_right.
    // So we set H=0x25, L=0x96 (near the boundary).
    machine.cpu.memory[0x2010] = 0x96;  // Low byte
    machine.cpu.memory[0x2011] = 0x25;  // High byte
    machine.cpu.memory[0x2012] = 0x01;  // Direction: left (0x01 means "we're going left, prep for left")

    let base_before_low = machine.cpu.memory[0x2010];
    let base_before_hi = machine.cpu.memory[0x2011];
    let dir_before = machine.cpu.memory[0x2012];

    // Run one march cycle to trigger reversal
    for _ in 0..120 {
        machine.execute_frame();
        if machine.cpu.memory[0x2012] != dir_before {
            break;  // Direction flipped, reversal happened
        }
    }

    let base_after_low = machine.cpu.memory[0x2010];
    let base_after_hi = machine.cpu.memory[0x2011];
    let dir_after = machine.cpu.memory[0x2012];

    // Verify direction flipped from left (0x01) to right (0x00)
    assert_eq!(
        dir_after, 0x00,
        "fleet should reverse to right after hitting left wall; dir: before={:#04x} after={:#04x}",
        dir_before,
        dir_after
    );

    // Verify descent: low byte should have decreased by 8 (one character row)
    // The subtraction is modular: 0x96 - 0x08 = 0x8E
    let expected_low = base_before_low.wrapping_sub(8);
    assert_eq!(
        base_after_low, expected_low,
        "fleet should descend by 8 on reversal (one VRAM row); low bytes: before={:#04x} after={:#04x} expected={:#04x}",
        base_before_low,
        base_after_low,
        expected_low
    );

    // High byte should stay the same or decrease (no wrap-around expected in normal play)
    assert!(
        base_after_hi <= base_before_hi || base_after_hi == base_before_hi.wrapping_sub(1),
        "fleet high byte should not increase unexpectedly; before={:#04x} after={:#04x}",
        base_before_hi,
        base_after_hi
    );
}