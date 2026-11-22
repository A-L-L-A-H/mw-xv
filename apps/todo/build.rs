use std::path::Path;
use std::process::Command;

fn main() {
    println!("cargo:rerun-if-changed=web/dist/index.html");
    println!("cargo:rerun-if-changed=web/dist/assets/app.js");
    println!("cargo:rerun-if-changed=web/dist/assets/style.css");

    let dist_index = Path::new("web/dist/index.html");
    let dist_js = Path::new("web/dist/assets/app.js");
    let dist_css = Path::new("web/dist/assets/style.css");

    if !dist_index.exists() || !dist_js.exists() || !dist_css.exists() {
        let status = Command::new("node")
            .args(["node_modules/vite/bin/vite.js", "build"])
            .current_dir("web")
            .status()
            .expect("failed to invoke vite build for apps/todo/web");
        assert!(status.success(), "vite build failed in apps/todo/web");
    }
}
