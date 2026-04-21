use std::env;
use std::fs;
use std::path::PathBuf;
use std::process::{self, Command};
use std::time::{SystemTime, UNIX_EPOCH};

use space_invaders_emu::Machine;

const MACHINE_FPS: f64 = 60.0;
const DEFAULT_SAMPLE_FRAMES: u32 = 60;
const DEFAULT_BOOT_FRAMES: u32 = 12;

const PLAYER_PTR_ADDR: usize = 0x2002;
const PLAYER_BULLET_PTR_ADDR: usize = 0x2004;
const PLAYER_BULLET_ACTIVE_ADDR: usize = 0x2006;
const ENEMY_BULLET_PTR_ADDR: usize = 0x2008;
const ENEMY_BULLET_ACTIVE_ADDR: usize = 0x200A;
const FLEET_BASE_ADDR: usize = 0x2010;
const SCORE_LO_ADDR: usize = 0x200E;
const SCORE_HI_ADDR: usize = 0x200F;

fn usage() {
    eprintln!("usage: homebrew_clock [--frames N] [--boot-frames N]");
}

fn parse_u32(arg: Option<String>, flag: &str) -> u32 {
    match arg {
        Some(v) => match v.parse::<u32>() {
            Ok(n) => n,
            Err(_) => {
                eprintln!("invalid value for {}: {}", flag, v);
                process::exit(2);
            }
        },
        None => {
            eprintln!("missing value for {}", flag);
            process::exit(2);
        }
    }
}

fn build_step7_rom() -> PathBuf {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .expect("system clock before unix epoch")
        .as_nanos();
    let output = env::temp_dir().join(format!("space-invaders-clock-{stamp}.rom"));

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

    if !status.success() {
        eprintln!("rom/build.py failed for step 7");
        process::exit(2);
    }

    output
}

fn read_word(machine: &Machine, addr: usize) -> u16 {
    machine.cpu.memory[addr] as u16 | ((machine.cpu.memory[addr + 1] as u16) << 8)
}

fn score(machine: &Machine) -> u16 {
    machine.cpu.memory[SCORE_LO_ADDR] as u16 | ((machine.cpu.memory[SCORE_HI_ADDR] as u16) << 8)
}

fn boot(machine: &mut Machine, boot_frames: u32) {
    for _ in 0..boot_frames {
        machine.execute_frame();
    }
}

fn load_step7_machine(boot_frames: u32) -> Machine {
    let rom_path = build_step7_rom();
    let rom = fs::read(&rom_path).expect("failed to read built rom");

    let mut machine = Machine::new();
    machine.load_rom(&rom);
    boot(&mut machine, boot_frames);
    machine
}

fn main() {
    let mut args = env::args().skip(1);
    let mut sample_frames = DEFAULT_SAMPLE_FRAMES;
    let mut boot_frames = DEFAULT_BOOT_FRAMES;

    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--frames" => sample_frames = parse_u32(args.next(), "--frames"),
            "--boot-frames" => boot_frames = parse_u32(args.next(), "--boot-frames"),
            _ => {
                usage();
                process::exit(2);
            }
        }
    }

    let seconds = sample_frames as f64 / MACHINE_FPS;

    let mut fleet_machine = load_step7_machine(boot_frames);
    let fleet_start = read_word(&fleet_machine, FLEET_BASE_ADDR);
    let mut fleet_moves = 0u32;
    let mut fleet_descents = 0u32;
    let mut fleet_prev = fleet_start;
    for _ in 0..sample_frames {
        fleet_machine.execute_frame();
        let now = read_word(&fleet_machine, FLEET_BASE_ADDR);
        if now != fleet_prev {
            fleet_moves += 1;
            if now.wrapping_add(1) == fleet_prev {
                fleet_descents += 1;
            }
        }
        fleet_prev = now;
    }

    let mut player_machine = load_step7_machine(boot_frames);
    let player_start = read_word(&player_machine, PLAYER_PTR_ADDR);
    let mut player_moves = 0u32;
    let mut player_prev = player_start;
    for _ in 0..sample_frames {
        player_machine.set_input_port1(0x20);
        player_machine.execute_frame();
        let now = read_word(&player_machine, PLAYER_PTR_ADDR);
        if now != player_prev {
            player_moves += 1;
        }
        player_prev = now;
    }

    let mut bullet_machine = load_step7_machine(boot_frames);
    bullet_machine.set_input_port1(0x10);
    bullet_machine.execute_frame();
    bullet_machine.set_input_port1(0x00);
    let bullet_start = read_word(&bullet_machine, PLAYER_BULLET_PTR_ADDR);
    let mut bullet_steps = 0u32;
    let mut bullet_prev = bullet_start;
    let mut bullet_active_frames = 0u32;
    for _ in 0..sample_frames {
        bullet_machine.execute_frame();
        if bullet_machine.cpu.memory[PLAYER_BULLET_ACTIVE_ADDR] != 0 {
            bullet_active_frames += 1;
        }
        let now = read_word(&bullet_machine, PLAYER_BULLET_PTR_ADDR);
        if now != bullet_prev {
            bullet_steps += 1;
        }
        bullet_prev = now;
    }

    let mut enemy_machine = load_step7_machine(boot_frames);
    let mut enemy_spawn_events = 0u32;
    let mut enemy_steps = 0u32;
    let mut enemy_prev_active = enemy_machine.cpu.memory[ENEMY_BULLET_ACTIVE_ADDR];
    let mut enemy_prev_ptr = read_word(&enemy_machine, ENEMY_BULLET_PTR_ADDR);
    for _ in 0..(sample_frames * 4) {
        enemy_machine.execute_frame();
        let now_active = enemy_machine.cpu.memory[ENEMY_BULLET_ACTIVE_ADDR];
        let now_ptr = read_word(&enemy_machine, ENEMY_BULLET_PTR_ADDR);
        if enemy_prev_active == 0 && now_active != 0 {
            enemy_spawn_events += 1;
        }
        if now_active != 0 && now_ptr != enemy_prev_ptr {
            enemy_steps += 1;
        }
        enemy_prev_active = now_active;
        enemy_prev_ptr = now_ptr;
    }

    println!("homebrew_clock");
    println!("machine_fps={:.2}", MACHINE_FPS);
    println!("boot_frames={}", boot_frames);
    println!("sample_frames={}", sample_frames);
    println!("sample_seconds={:.3}", seconds);
    println!();
    println!("fleet_start_base={:#06x}", fleet_start);
    println!("fleet_end_base={:#06x}", fleet_prev);
    println!("fleet_move_events={}", fleet_moves);
    println!("fleet_descents={}", fleet_descents);
    println!("fleet_moves_per_second={:.2}", fleet_moves as f64 / seconds);
    println!();
    println!("player_start_ptr={:#06x}", player_start);
    println!("player_end_ptr={:#06x}", player_prev);
    println!("player_move_events={}", player_moves);
    println!("player_moves_per_second={:.2}", player_moves as f64 / seconds);
    println!();
    println!("player_bullet_start_ptr={:#06x}", bullet_start);
    println!("player_bullet_end_ptr={:#06x}", bullet_prev);
    println!("player_bullet_steps={}", bullet_steps);
    println!("player_bullet_active_frames={}", bullet_active_frames);
    println!("player_bullet_steps_per_second={:.2}", bullet_steps as f64 / seconds);
    println!("score_after_bullet_window={}", score(&bullet_machine));
    println!();
    println!("enemy_sample_seconds={:.3}", (sample_frames * 4) as f64 / MACHINE_FPS);
    println!("enemy_spawn_events={}", enemy_spawn_events);
    println!("enemy_steps={}", enemy_steps);
    println!("enemy_spawn_events_per_second={:.2}", enemy_spawn_events as f64 / ((sample_frames * 4) as f64 / MACHINE_FPS));
    println!("enemy_steps_per_second={:.2}", enemy_steps as f64 / ((sample_frames * 4) as f64 / MACHINE_FPS));
}