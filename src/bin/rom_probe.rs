use std::env;
use std::fs;
use std::process;

use space_invaders_emu::Machine;

fn usage() {
    eprintln!(
        "usage: rom_probe <rom_path> [--frames N] [--expect-lit-min N] [--expect-lit-max N]"
    );
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

fn parse_usize(arg: Option<String>, flag: &str) -> usize {
    match arg {
        Some(v) => match v.parse::<usize>() {
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

fn main() {
    let mut args = env::args().skip(1);
    let rom_path = match args.next() {
        Some(p) => p,
        None => {
            usage();
            process::exit(2);
        }
    };

    let mut frames: u32 = 1;
    let mut expect_lit_min: Option<usize> = None;
    let mut expect_lit_max: Option<usize> = None;

    while let Some(flag) = args.next() {
        match flag.as_str() {
            "--frames" => {
                frames = parse_u32(args.next(), "--frames");
            }
            "--expect-lit-min" => {
                expect_lit_min = Some(parse_usize(args.next(), "--expect-lit-min"));
            }
            "--expect-lit-max" => {
                expect_lit_max = Some(parse_usize(args.next(), "--expect-lit-max"));
            }
            _ => {
                eprintln!("unknown flag: {}", flag);
                usage();
                process::exit(2);
            }
        }
    }

    let rom = match fs::read(&rom_path) {
        Ok(bytes) => bytes,
        Err(err) => {
            eprintln!("failed to read ROM {}: {}", rom_path, err);
            process::exit(2);
        }
    };

    let mut machine = Machine::new();
    machine.load_rom(&rom);

    for _ in 0..frames {
        machine.execute_frame();
    }

    let rgba = machine.render_rgba();

    let mut lit_pixels: usize = 0;
    let mut min_x = usize::MAX;
    let mut min_y = usize::MAX;
    let mut max_x = 0usize;
    let mut max_y = 0usize;

    for y in 0..256usize {
        for x in 0..224usize {
            let idx = (y * 224 + x) * 4;
            let r = rgba[idx];
            let g = rgba[idx + 1];
            let b = rgba[idx + 2];

            if r != 0 || g != 0 || b != 0 {
                lit_pixels += 1;
                if x < min_x {
                    min_x = x;
                }
                if y < min_y {
                    min_y = y;
                }
                if x > max_x {
                    max_x = x;
                }
                if y > max_y {
                    max_y = y;
                }
            }
        }
    }

    println!("rom={}", rom_path);
    println!("rom_bytes={}", rom.len());
    println!("frames={}", frames);
    println!("cycles={}", machine.cpu.cycles);
    println!("lit_pixels={}", lit_pixels);

    if lit_pixels > 0 {
        println!("bbox={},{} to {},{}", min_x, min_y, max_x, max_y);
    } else {
        println!("bbox=none");
    }

    if let Some(min) = expect_lit_min {
        if lit_pixels < min {
            eprintln!(
                "lit pixel count too low: {} < expected min {}",
                lit_pixels, min
            );
            process::exit(3);
        }
    }

    if let Some(max) = expect_lit_max {
        if lit_pixels > max {
            eprintln!(
                "lit pixel count too high: {} > expected max {}",
                lit_pixels, max
            );
            process::exit(3);
        }
    }
}
