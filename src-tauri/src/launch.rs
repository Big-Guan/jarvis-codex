#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum LaunchMode {
    Manual,
    Background,
    Wake,
}

impl LaunchMode {
    pub fn from_args(args: &[String]) -> Self {
        if args.iter().any(|arg| arg == "--jarvis-wake") {
            Self::Wake
        } else if args.iter().any(|arg| arg == "--background") {
            Self::Background
        } else {
            Self::Manual
        }
    }

    pub fn opens_panel(self) -> bool {
        self == Self::Manual
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn wake_and_login_launches_keep_the_panel_hidden() {
        for (flags, expected) in [
            (vec![], LaunchMode::Manual),
            (vec!["--background"], LaunchMode::Background),
            (vec!["--jarvis-wake"], LaunchMode::Wake),
            (vec!["--background", "--jarvis-wake"], LaunchMode::Wake),
        ] {
            let args = std::iter::once("jarvis-next")
                .chain(flags)
                .map(String::from)
                .collect::<Vec<_>>();
            let mode = LaunchMode::from_args(&args);
            assert_eq!(mode, expected);
            assert_eq!(mode.opens_panel(), expected == LaunchMode::Manual);
        }
    }

    #[test]
    fn native_windows_start_hidden_before_launch_routing() {
        let config: serde_json::Value =
            serde_json::from_str(include_str!("../tauri.conf.json")).unwrap();
        let windows = config["app"]["windows"].as_array().unwrap();
        for label in ["main", "avatar"] {
            let window = windows
                .iter()
                .find(|window| window["label"] == label)
                .unwrap();
            assert_eq!(
                window["visible"], false,
                "{label} can flash during a wake launch"
            );
        }
    }
}
