use std::io::{self, Read};
use std::process::{Child, Command, Output, Stdio};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

/// A GUI app on Windows opens a console window for every child process unless it
/// asks not to; git and ollama are run this way.
pub fn hide_window(command: &mut Command) -> &mut Command {
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const CREATE_NO_WINDOW: u32 = 0x0800_0000;
        command.creation_flags(CREATE_NO_WINDOW);
    }
    command
}

/// `Command::output` within `limit`: past it, the command is stopped with every process it
/// started, and the call fails with `TimedOut`. A CLI waiting on a network that never
/// answers must not hold its caller forever.
pub fn output_within(command: &mut Command, limit: Duration) -> io::Result<Output> {
    let mut child = command
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()?;
    // Read as it comes: a full pipe would block the command before it ends.
    let stdout = read_all(child.stdout.take());
    let stderr = read_all(child.stderr.take());
    let deadline = Instant::now() + limit;
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if Instant::now() >= deadline {
            kill_tree(&mut child);
            return Err(io::Error::new(
                io::ErrorKind::TimedOut,
                format!("no answer within {} s", limit.as_secs()),
            ));
        }
        thread::sleep(Duration::from_millis(20));
    };
    Ok(Output {
        status,
        stdout: stdout.join().unwrap_or_default(),
        stderr: stderr.join().unwrap_or_default(),
    })
}

fn read_all(pipe: Option<impl Read + Send + 'static>) -> JoinHandle<Vec<u8>> {
    thread::spawn(move || {
        let mut bytes = Vec::new();
        if let Some(mut pipe) = pipe {
            let _ = pipe.read_to_end(&mut bytes);
        }
        bytes
    })
}

/// Stops `child` and, on Windows, the processes under it: `taskkill /T` finds them from
/// their parent, so it runs while the parent still does.
fn kill_tree(child: &mut Child) {
    #[cfg(windows)]
    {
        let pid = child.id().to_string();
        let _ = hide_window(Command::new("taskkill").args(["/F", "/T", "/PID", &pid])).output();
    }
    let _ = child.kill();
    let _ = child.wait();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn stops_a_command_past_its_limit() {
        let mut command = if cfg!(windows) {
            let mut ping = Command::new("ping");
            ping.args(["-n", "30", "127.0.0.1"]);
            ping
        } else {
            let mut sleep = Command::new("sleep");
            sleep.arg("30");
            sleep
        };
        let started = Instant::now();
        let error = output_within(&mut command, Duration::from_millis(500)).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        assert!(started.elapsed() < Duration::from_secs(10));
    }

    #[test]
    fn gives_the_output_of_a_command_that_ends_in_time() {
        let output = output_within(
            Command::new("git").arg("--version"),
            Duration::from_secs(30),
        )
        .unwrap();
        assert!(output.status.success());
        assert!(String::from_utf8_lossy(&output.stdout).starts_with("git version"));
    }

    #[cfg(windows)]
    #[test]
    fn stops_the_processes_the_command_started_too() {
        use std::os::windows::process::CommandExt;
        let dir = tempfile::tempdir().unwrap();
        let beats = dir.path().join("beats.txt");
        // A shell under the shell, writing a line a second for a minute: stopping only
        // its parent would leave it writing.
        let mut command = Command::new("cmd");
        command.current_dir(dir.path()).raw_arg(
            r#"/C cmd /C "for /L %i in (1,1,60) do @(echo %i>>beats.txt & ping -n 2 127.0.0.1 >nul)""#,
        );
        let error = output_within(&mut command, Duration::from_millis(2500)).unwrap_err();
        assert_eq!(error.kind(), io::ErrorKind::TimedOut);
        let written = std::fs::read_to_string(&beats).unwrap();
        assert!(!written.is_empty(), "the inner shell never started");
        thread::sleep(Duration::from_millis(2500));
        assert_eq!(std::fs::read_to_string(&beats).unwrap(), written);
    }
}
