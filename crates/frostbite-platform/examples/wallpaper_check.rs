//! Manual check: apply the winter wallpaper, hold it, then restore.
//! cargo run -p frostbite-platform --example wallpaper_check -- <image> [seconds]

fn current() -> String {
    let out = std::process::Command::new("reg")
        .args(["query", r"HKCU\Control Panel\Desktop", "/v", "Wallpaper"])
        .output()
        .expect("reg query");
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .find(|l| l.contains("Wallpaper"))
        .map(|l| l.split("REG_SZ").nth(1).unwrap_or("").trim().to_string())
        .unwrap_or_default()
}

fn main() {
    let mut args = std::env::args().skip(1);
    let image = std::path::PathBuf::from(args.next().expect("image path"));
    let hold: u64 = args.next().and_then(|s| s.parse().ok()).unwrap_or(10);
    let p = frostbite_platform::current();

    let before = current();
    println!("before:   {before:?}");
    p.set_wallpaper(&image).expect("set_wallpaper");
    let during = current();
    println!("applied:  {during:?}");
    std::thread::sleep(std::time::Duration::from_secs(hold));
    p.restore_wallpaper().expect("restore_wallpaper");
    let after = current();
    println!("restored: {after:?}");
    println!(
        "RESULT: changed={} restored={}",
        during != before && during.contains("Frostbite"),
        // A wallpaper Windows only had in its cache comes back from our saved copy.
        after == before || after.ends_with("Previous Wallpaper.jpg")
    );
}
